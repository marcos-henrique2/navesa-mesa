"use client";

/**
 * VENDAS USADOS MATRIZ — orquestra Supabase (vendas + custos_detalhados + fipe_batch +
 * veiculos_origem) e monta tudo que `gerar-workbook.ts` precisa pras 9 abas.
 *
 * Decisão: em vez de disparar uma query por período (mês selecionado + ano corrente pra
 * aba 8 + mapa cod_empresa→nome), busca TODAS as vendas uma única vez via `listVendas()`
 * (já pagina corretamente) e filtra tudo em JS com `Date.getTime()`. Isso elimina de vez
 * a armadilha de `listVendasPorPeriodo`/`replaceVendasNoPeriodo` (fim de dia em UTC vs
 * local) — comparar instantes já parseados é inequívoco desde que os LIMITES do período
 * estejam corretos, o que é resolvido abaixo com offset `-03:00` explícito (Brasil não
 * tem mais horário de verão desde 2019 — o offset de Brasília é fixo).
 */

import type { VendaParsed } from "@/lib/parsers/nbs-vendas-xlsx";
import type { CustoDetalhado } from "@/lib/parsers/nbs-custos-xls";
import { listVendas } from "@/lib/data/vendas";
import { listCustos } from "@/lib/data/custos";
import { loadBatchFromSupabase } from "@/lib/data/fipe-batch";
import { listLojaOrigemPorChassis } from "@/lib/data/veiculos";
import { normalizarPlaca, normalizarIdentificador } from "@/lib/utils/placa";
import { hojeLocal } from "@/lib/utils/data-local";
import type { ColetarVendasMatrizInput, LinhaVendaMatriz } from "./tipos";
import type { VendaParaMediaVendedor } from "./aba-media-vendedor";

// ═══════════════════════════════════════════════════════════════════════════
// Limites de período em America/Sao_Paulo (offset fixo -03:00, sem DST desde 2019)
// ═══════════════════════════════════════════════════════════════════════════

function inicioMesBrasilia(ano: number, mes: number): Date {
  const mm = String(mes).padStart(2, "0");
  return new Date(`${ano}-${mm}-01T00:00:00-03:00`);
}

function inicioAnoBrasilia(ano: number): Date {
  return new Date(`${ano}-01-01T00:00:00-03:00`);
}

/** Fim do dia de HOJE em Brasília (usa `hojeLocal()` — nunca `new Date()` cru). */
function fimHojeBrasilia(): Date {
  return new Date(`${hojeLocal()}T23:59:59.999-03:00`);
}

function fimMesBrasilia(ano: number, mes: number): Date {
  const proxAno = mes === 12 ? ano + 1 : ano;
  const proxMes = mes === 12 ? 1 : mes + 1;
  return new Date(inicioMesBrasilia(proxAno, proxMes).getTime() - 1);
}

// ═══════════════════════════════════════════════════════════════════════════
// Conversão VendaParsed → LinhaVendaMatriz
// ═══════════════════════════════════════════════════════════════════════════

function formatarAnoModelo(v: VendaParsed): string {
  if (v.ano_fabricacao == null || v.ano_modelo == null) return "";
  const aa = (n: number): string => String(n).slice(-2).padStart(2, "0");
  return `${aa(v.ano_fabricacao)}/${aa(v.ano_modelo)}`;
}

function mapearLinha(
  v: VendaParsed,
  custosPorPlaca: Map<string, CustoDetalhado>,
  fipePorChassi: Map<string, { precoFipe: number; confirmado: boolean }>,
  lojaOrigemPorChassi: Map<string, number>,
  nomePorCodEmpresa: Map<number, string>,
): LinhaVendaMatriz {
  const custo = custosPorPlaca.get(normalizarPlaca(v.placa));
  const fipe = fipePorChassi.get(normalizarIdentificador(v.chassi));
  const codEmpresaOrigem = lojaOrigemPorChassi.get(normalizarIdentificador(v.chassi)) ?? null;

  return {
    chassi: v.chassi,
    placa: v.placa,

    lojaOrigemNome: codEmpresaOrigem != null ? (nomePorCodEmpresa.get(codEmpresaOrigem) ?? `Loja ${codEmpresaOrigem}`) : "(origem desconhecida)",
    lojaOrigemCodEmpresa: codEmpresaOrigem,

    descricaoVeiculo: v.modelo,
    cor: v.cor_externa,
    marca: v.marca,
    anoModelo: formatarAnoModelo(v),

    km: v.km,
    diasEstoque: v.dias_estoque,

    nfEntrada: custo?.nota_fabrica_taxa_icms ?? (v.total_nota_fabrica ?? null),
    // Valor real do sync Oracle (NBS.VEICULOS_CUSTOS_ESPECIFICOS, CODIGO_CUSTO
    // 620/462 — ver scripts/sync-nbs/valoriza.ts), não a aproximação antiga via
    // "Ganhos Indiretos" (custo?.ganhos_indiretos, 27% de erro validado).
    valoriza: v.valoriza,

    valorFipe: fipe?.confirmado ? fipe.precoFipe : null,

    valorVenda: v.valor_venda,

    despesaGeral: custo?.despesas_gerais ?? null,
    forplan: custo?.forplan ?? null,
    impostos: custo?.impostos ?? null,
    comissao: custo?.comissoes ?? (v.comissao_vendedor ?? null),

    usadoNaTroca: v.placa_troca != null,
    financiou: v.financiado,
    clienteNome: v.cliente_nome,
    lojista: v.cliente_tipo === "PJ" ? true : v.cliente_tipo === "PF" ? false : null,
    vendedorNome: v.vendedor_nome,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Coleta
// ═══════════════════════════════════════════════════════════════════════════

export type ColetarVendasMatrizResult = {
  /** Aba 1 — todas as vendas da loja no mês selecionado. */
  linhasMes: LinhaVendaMatriz[];
  /**
   * Nome da loja do relatório (`codEmpresa`), igual ao que aparece na coluna C (Loja de
   * Origem) quando a origem é a própria loja — usado nas abas 4/5/6 pra montar critérios
   * SUMIFS/COUNTIFS de "origem própria" vs "outras lojas" comparando pelo NOME (a aba de
   * detalhe não tem coluna de cod_empresa).
   */
  nomeLojaPropria: string;
  /** Ano corrente real (não o `ano` do input) — usado no título/nome de aba 8. */
  anoAtual: number;
  /** Mês corrente real (1-12) — até onde a aba 8 vai. */
  mesAtualIndex: number;
  /** Vendas da loja no ano corrente inteiro até hoje — matéria-prima da aba 8. */
  vendasAnoAtual: VendaParaMediaVendedor[];
};

export async function coletarVendasMatriz(input: ColetarVendasMatrizInput): Promise<ColetarVendasMatrizResult> {
  const { codEmpresa, mes, ano } = input;

  const [todasVendas, custos, fipeBatch] = await Promise.all([listVendas(), listCustos(), loadBatchFromSupabase()]);

  const custosPorPlaca = new Map<string, CustoDetalhado>();
  for (const c of custos) {
    if (c.placa) custosPorPlaca.set(normalizarPlaca(c.placa), c);
  }

  // "Só preenche Valor FIPE se plausibilidade_verificada = true" — regra literal do
  // relatório, mais restrita que `isFipeConfirmado` (que também exige score/referência).
  const fipePorChassi = new Map<string, { precoFipe: number; confirmado: boolean }>();
  if (fipeBatch) {
    for (const item of Object.values(fipeBatch.items)) {
      fipePorChassi.set(normalizarIdentificador(item.chassi), {
        precoFipe: item.precoFipe,
        confirmado: item.plausibilidadeVerificada === true,
      });
    }
  }

  // Mapa cod_empresa → nome, estável a partir da própria tabela vendas (sem hardcode).
  const nomePorCodEmpresa = new Map<number, string>();
  for (const v of todasVendas) {
    if (v.empresa_nome && !nomePorCodEmpresa.has(v.cod_empresa)) {
      nomePorCodEmpresa.set(v.cod_empresa, v.empresa_nome);
    }
  }

  // ─── Vendas do mês selecionado, só da loja escolhida ───
  const iniMes = inicioMesBrasilia(ano, mes);
  const fimMes = fimMesBrasilia(ano, mes);
  const vendasMes = todasVendas.filter(
    (v) => v.cod_empresa === codEmpresa && v.data_venda != null && v.data_venda.getTime() >= iniMes.getTime() && v.data_venda.getTime() <= fimMes.getTime(),
  );

  const chassisMes = vendasMes.map((v) => v.chassi).filter((c) => c.length > 0);
  const lojaOrigemPorChassi = await listLojaOrigemPorChassis(chassisMes);

  const linhasMes = vendasMes.map((v) =>
    mapearLinha(v, custosPorPlaca, fipePorChassi, lojaOrigemPorChassi, nomePorCodEmpresa),
  );

  const nomeLojaPropria = nomePorCodEmpresa.get(codEmpresa) ?? `Loja ${codEmpresa}`;

  // ─── Vendas do ANO CORRENTE REAL (não o mês/ano do input) — aba 8 ───
  const hojeISO = hojeLocal();
  const anoAtual = Number(hojeISO.slice(0, 4));
  const mesAtualIndex = Number(hojeISO.slice(5, 7));

  const iniAno = inicioAnoBrasilia(anoAtual);
  const fimHoje = fimHojeBrasilia();
  const vendasAnoAtual: VendaParaMediaVendedor[] = todasVendas
    .filter(
      (v) =>
        v.cod_empresa === codEmpresa &&
        v.data_venda != null &&
        v.data_venda.getTime() >= iniAno.getTime() &&
        v.data_venda.getTime() <= fimHoje.getTime(),
    )
    .map((v) => ({ vendedorNome: v.vendedor_nome, dataVenda: v.data_venda }));

  return { linhasMes, nomeLojaPropria, anoAtual, mesAtualIndex, vendasAnoAtual };
}
