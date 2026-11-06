/**
 * Mapper PURO de `custos_detalhados` ↔ `CustoDetalhado`.
 * Sem "use client", sem Supabase: usado pelo client e pelo cérebro (Node).
 */
import type { CustoDetalhado } from "@/lib/parsers/nbs-custos-xls";
import { parseDate } from "@/lib/data/mappers/datas";

export type CustoRow = Omit<CustoDetalhado, "data_fatura" | "data_venda"> & {
  data_fatura: string | null;
  data_venda: string | null;
};

export function custoToRow(c: CustoDetalhado): Record<string, unknown> {
  return {
    placa: c.placa,
    modelo: c.modelo,
    data_fatura: c.data_fatura?.toISOString() ?? null,
    data_venda: c.data_venda?.toISOString() ?? null,
    dias_patio: c.dias_patio,
    nota_fabrica_taxa_icms: c.nota_fabrica_taxa_icms,
    despesas_oficina: c.despesas_oficina,
    frete_icms_frete: c.frete_icms_frete,
    forplan: c.forplan,
    impostos: c.impostos,
    comissoes: c.comissoes,
    ganhos_indiretos: c.ganhos_indiretos,
    adm: c.adm,
    despesas_gerais: c.despesas_gerais,
    custo_total: c.custo_total,
    valor_vendido: c.valor_vendido,
    margem_real: c.margem_real,
    margem_pct: c.margem_pct,
  };
}

export function custoFromRow(r: CustoRow): CustoDetalhado {
  return {
    placa: r.placa,
    modelo: r.modelo,
    data_fatura: parseDate(r.data_fatura),
    data_venda: parseDate(r.data_venda),
    dias_patio: r.dias_patio,
    nota_fabrica_taxa_icms: r.nota_fabrica_taxa_icms,
    despesas_oficina: r.despesas_oficina,
    frete_icms_frete: r.frete_icms_frete,
    forplan: r.forplan,
    impostos: r.impostos,
    comissoes: r.comissoes,
    ganhos_indiretos: r.ganhos_indiretos,
    adm: r.adm,
    despesas_gerais: r.despesas_gerais,
    custo_total: r.custo_total,
    valor_vendido: r.valor_vendido,
    margem_real: r.margem_real,
    margem_pct: r.margem_pct,
  };
}
