import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";
import type { CustoEstoqueDetalhado } from "@/lib/parsers/nbs-custos-estoque-pdf";
import { resolverCustoComFallbackManual } from "@/lib/export/custo-estoque-fallback";

/**
 * View-model do card `ComposicaoCustosEstoque` (detalhe de um carro em estoque).
 *
 * SEM `bonus`/`ganhos_indiretos` — ambos removidos de propósito: `bonus` é
 * campo morto (sempre 0, nunca preenchido por nenhuma fonte); `ganhos_indiretos`
 * é o mesmo abatimento financeiro que `Valoriza` (bônus Ford), só que
 * potencialmente desatualizado quando vem do PDF manual — a linha própria de
 * Valoriza (fonte ao vivo, `veiculo.valoriza`) já cobre esse abatimento.
 */
export type CustoEstoqueView = {
  nota_fabrica: number;
  revisoes: number;
  forplan: number;
  holdback: number;
  acessorios: number;
  adm: number;
  impostos: number;
  comissoes: number;
  desp_gerais: number;
  custo_total: number;
  tabela: number;
  lucro_bruto: number;
  dias_patio: number;
  /** De onde veio esse breakdown — controla a badge/copy do card. */
  fonte: "automatico" | "manual";
};

/**
 * Monta o view-model do card de composição de custos pra um carro em estoque.
 *
 * FONTE PRIMÁRIA (automático): cálculo oficial NBS
 * (PKG_MARKUP_VEIC.CALCULAR_MARKUP_ESTOQUE, sync Oracle a cada 2h — ver
 * docs/sync-custos-markup-acesso.md), já gravado em `veiculos.custo_*`.
 * Cobre 100% do estoque atual (1097/1097 carros validado). Usado sempre que
 * `veiculo.custo_total` e `veiculo.preco_venda` vierem preenchidos.
 *
 * HoldBack/Acessórios/ADM usam o mesmo fallback do catálogo de exportação
 * (`resolverCustoComFallbackManual`, ver `colunas-estoque.ts`): essas 3
 * categorias ainda não têm confirmação de valor não-zero no cálculo
 * automático, então quando ele vier 0 usa o PDF manual (upload em /upload),
 * se existir, como alternativa mais precisa.
 *
 * FALLBACK (manual): quando o automático ainda não está disponível pra esse
 * carro (ex. entrada muito recente, ainda não passou pelo sync), usa o PDF
 * "Custos de Veículos em Estoque" completo, igual ao comportamento anterior.
 *
 * Retorna `null` quando nenhuma das duas fontes tem dado suficiente.
 */
export function montarCustoEstoqueView(
  veiculo: VeiculoParsed,
  manual: CustoEstoqueDetalhado | null,
): CustoEstoqueView | null {
  if (veiculo.custo_total != null && veiculo.preco_venda != null) {
    return {
      nota_fabrica: veiculo.valor_aquisicao ?? 0,
      revisoes: veiculo.custo_revisoes,
      forplan: veiculo.custo_forplan,
      holdback: resolverCustoComFallbackManual(veiculo.custo_holdback, manual?.holdback) ?? 0,
      acessorios: resolverCustoComFallbackManual(veiculo.custo_acessorios, manual?.acessorios) ?? 0,
      adm: resolverCustoComFallbackManual(veiculo.custo_adm, manual?.adm) ?? 0,
      impostos: veiculo.custo_impostos,
      comissoes: veiculo.custo_comissoes,
      desp_gerais: veiculo.custo_despesas_gerais,
      custo_total: veiculo.custo_total,
      tabela: veiculo.preco_venda,
      lucro_bruto: veiculo.preco_venda - veiculo.custo_total,
      dias_patio: veiculo.dias_patio ?? 0,
      fonte: "automatico",
    };
  }

  if (manual) {
    return {
      nota_fabrica: manual.nota_fabrica,
      revisoes: manual.revisoes,
      forplan: manual.forplan,
      holdback: manual.holdback,
      acessorios: manual.acessorios,
      adm: manual.adm,
      impostos: manual.impostos,
      comissoes: manual.comissoes,
      desp_gerais: manual.desp_gerais,
      custo_total: manual.custo_total,
      tabela: manual.tabela,
      lucro_bruto: manual.lucro_bruto,
      dias_patio: manual.dias_patio,
      fonte: "manual",
    };
  }

  return null;
}
