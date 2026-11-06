/**
 * Mapper PURO de `custos_estoque_detalhado` ↔ `CustoEstoqueDetalhado`.
 * Sem "use client", sem Supabase: usado pelo client e pelo cérebro (Node).
 */
import type { CustoEstoqueDetalhado } from "@/lib/parsers/nbs-custos-estoque-pdf";

export type CustoEstoqueRow = CustoEstoqueDetalhado & {
  cod_empresa: number | null;
};

/** Custos de estoque + loja de cada placa (a loja vem na linha, não no tipo de domínio). */
export type CustosEstoqueCarregados = {
  itens: CustoEstoqueDetalhado[];
  codEmpresaPorPlaca: Record<string, number>;
};

export function custoEstoqueToRow(c: CustoEstoqueDetalhado, codEmpresa: number | null): Record<string, unknown> {
  return {
    placa: c.placa,
    cod_empresa: codEmpresa,
    modelo: c.modelo,
    dias_patio: c.dias_patio,
    nota_fabrica: c.nota_fabrica,
    revisoes: c.revisoes,
    forplan: c.forplan,
    holdback: c.holdback,
    acessorios: c.acessorios,
    adm: c.adm,
    impostos: c.impostos,
    comissoes: c.comissoes,
    desp_gerais: c.desp_gerais,
    custo_total: c.custo_total,
    tabela: c.tabela,
    lucro_bruto: c.lucro_bruto,
    bonus: c.bonus,
    ganhos_indiretos: c.ganhos_indiretos,
  };
}

export function custoEstoqueFromRow(r: CustoEstoqueRow): CustoEstoqueDetalhado {
  return {
    placa: r.placa,
    modelo: r.modelo,
    dias_patio: r.dias_patio,
    nota_fabrica: r.nota_fabrica,
    revisoes: r.revisoes,
    forplan: r.forplan,
    holdback: r.holdback,
    acessorios: r.acessorios,
    adm: r.adm,
    impostos: r.impostos,
    comissoes: r.comissoes,
    desp_gerais: r.desp_gerais,
    custo_total: r.custo_total,
    tabela: r.tabela,
    lucro_bruto: r.lucro_bruto,
    bonus: r.bonus,
    ganhos_indiretos: r.ganhos_indiretos,
  };
}

/** Mapeia as linhas cruas e separa o `cod_empresa` por placa. */
export function montarCustosEstoque(rows: CustoEstoqueRow[]): CustosEstoqueCarregados {
  const codEmpresaPorPlaca: Record<string, number> = {};
  const itens = rows.map((r) => {
    if (r.cod_empresa != null) codEmpresaPorPlaca[r.placa] = r.cod_empresa;
    return custoEstoqueFromRow(r);
  });
  return { itens, codEmpresaPorPlaca };
}
