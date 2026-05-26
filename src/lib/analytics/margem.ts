/**
 * MARGEM — Função canônica oficial usada em TODAS as telas.
 *
 * Equação descoberta a partir do "Relatório de Custos" do NBS, validada centavo a centavo
 * (610 vendas seminovos, período 01/04 a 26/05/2026):
 *
 *   Custo Total = Nota Fábrica + Desp Oficina + Frete + Forplan
 *               + Impostos + Comissões + ADM + Despesas Gerais
 *               − Ganhos Indiretos (Bônus de fábrica + Valorização)
 *
 *   Margem      = Valor Vendido − Custo Total
 *   Margem %    = Margem / Valor Vendido × 100   ← sobre faturamento (igual NBS)
 *
 * IMPORTANTE:
 * - Ganhos Indiretos REDUZ o custo (bônus de fábrica é receita que abate aquisição)
 * - Comissão JÁ ESTÁ DENTRO do custo (NBS desconta na conta)
 * - % é sobre faturamento, não sobre custo (definição NBS)
 *
 * FALLBACK: quando não há relatório de custos subido, usa custo_total_final do parser
 * de vendas (campo já consolidado pelo NBS). Marca origem como "fallback" para a UI poder
 * avisar que é estimativa.
 */

import type { VendaParsed } from "@/lib/parsers/nbs-vendas-xlsx";
import type { CustoDetalhado } from "@/lib/parsers/nbs-custos-xls";

export type MargemFonte = "oficial" | "fallback";

export type MargemDetalhada = {
  /** Valor da venda. */
  valor: number;
  /** Custo total consolidado. */
  custo: number;
  /** Margem em R$ = valor − custo. */
  margem: number;
  /** Margem % sobre faturamento. */
  margemPct: number;
  /** "oficial" = veio do relatório de custos, "fallback" = estimativa pelo parser de vendas. */
  fonte: MargemFonte;
  /** Decomposição dos componentes do custo (só preenchido quando fonte = "oficial"). */
  componentes: {
    nota_fabrica: number;
    despesas_oficina: number;
    frete: number;
    forplan: number;
    impostos: number;
    comissoes: number;
    adm: number;
    despesas_gerais: number;
    /** Negativo no impacto — reduz o custo. */
    ganhos_indiretos: number;
  } | null;
};

/**
 * Calcula margem para uma venda específica.
 * Se houver custos detalhados no mapa, usa equação oficial. Senão, fallback.
 */
export function calcMargemVenda(
  venda: VendaParsed,
  custosPorPlaca: Record<string, CustoDetalhado>,
): MargemDetalhada {
  const custo = custosPorPlaca[venda.placa];
  const valor = custo?.valor_vendido ?? venda.valor_venda ?? 0;

  if (custo) {
    // Equação oficial — usa diretamente o custo total do NBS (já validado bate centavo a centavo)
    const margem = valor - custo.custo_total;
    return {
      valor,
      custo: custo.custo_total,
      margem,
      margemPct: valor > 0 ? (margem / valor) * 100 : 0,
      fonte: "oficial",
      componentes: {
        nota_fabrica: custo.nota_fabrica_taxa_icms,
        despesas_oficina: custo.despesas_oficina,
        frete: custo.frete_icms_frete,
        forplan: custo.forplan,
        impostos: custo.impostos,
        comissoes: custo.comissoes,
        adm: custo.adm,
        despesas_gerais: custo.despesas_gerais,
        ganhos_indiretos: custo.ganhos_indiretos,
      },
    };
  }

  // Fallback: usa custo_total_final do parser de vendas
  const custoFallback = venda.custo_total_final ?? 0;
  const margem = valor - custoFallback;
  return {
    valor,
    custo: custoFallback,
    margem,
    margemPct: valor > 0 ? (margem / valor) * 100 : 0,
    fonte: "fallback",
    componentes: null,
  };
}

/**
 * Agrega margem para um conjunto de vendas (KPI principal, ranking de lojas, etc).
 */
export type MargemAgregada = {
  qt: number;
  qtComCustoOficial: number;
  valor: number;
  custo: number;
  margem: number;
  margemPct: number;
  /** Soma de cada componente (só quando há ao menos uma venda com custos oficiais). */
  componentes: {
    nota_fabrica: number;
    despesas_oficina: number;
    frete: number;
    forplan: number;
    impostos: number;
    comissoes: number;
    adm: number;
    despesas_gerais: number;
    ganhos_indiretos: number;
  };
  /** Porcentagem de vendas com custos oficiais (não-fallback). */
  cobertura: number;
};

export function agregarMargem(
  vendas: VendaParsed[],
  custosPorPlaca: Record<string, CustoDetalhado>,
): MargemAgregada {
  let valor = 0, custo = 0;
  let qtComCustoOficial = 0;
  const comp = {
    nota_fabrica: 0, despesas_oficina: 0, frete: 0, forplan: 0,
    impostos: 0, comissoes: 0, adm: 0, despesas_gerais: 0, ganhos_indiretos: 0,
  };

  for (const v of vendas) {
    const m = calcMargemVenda(v, custosPorPlaca);
    valor += m.valor;
    custo += m.custo;
    if (m.fonte === "oficial" && m.componentes) {
      qtComCustoOficial++;
      comp.nota_fabrica += m.componentes.nota_fabrica;
      comp.despesas_oficina += m.componentes.despesas_oficina;
      comp.frete += m.componentes.frete;
      comp.forplan += m.componentes.forplan;
      comp.impostos += m.componentes.impostos;
      comp.comissoes += m.componentes.comissoes;
      comp.adm += m.componentes.adm;
      comp.despesas_gerais += m.componentes.despesas_gerais;
      comp.ganhos_indiretos += m.componentes.ganhos_indiretos;
    }
  }

  const margem = valor - custo;
  return {
    qt: vendas.length,
    qtComCustoOficial,
    valor,
    custo,
    margem,
    margemPct: valor > 0 ? (margem / valor) * 100 : 0,
    componentes: comp,
    cobertura: vendas.length > 0 ? qtComCustoOficial / vendas.length : 0,
  };
}
