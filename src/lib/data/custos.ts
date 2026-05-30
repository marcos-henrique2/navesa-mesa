"use client";

import type { CustoDetalhado } from "@/lib/parsers/nbs-custos-xls";
import { getSupabase, chunk, selectAll, parseDate } from "./supabase";

type CustoRow = Omit<CustoDetalhado, "data_fatura" | "data_venda"> & {
  data_fatura: string | null;
  data_venda: string | null;
};

function toRow(c: CustoDetalhado): Record<string, unknown> {
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

function fromRow(r: CustoRow): CustoDetalhado {
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

/** Lista TODOS os custos detalhados (paginando). */
export async function listCustos(): Promise<CustoDetalhado[]> {
  const sb = getSupabase();
  const rows = await selectAll<CustoRow>(sb, "custos_detalhados", { orderBy: "placa" });
  return rows.map(fromRow);
}

/** Lista custos como mapa { placa → custo } pra cruzamento rápido. */
export async function listCustosPorPlaca(): Promise<Record<string, CustoDetalhado>> {
  const out: Record<string, CustoDetalhado> = {};
  for (const c of await listCustos()) if (c.placa) out[c.placa] = c;
  return out;
}

/**
 * Upsert em lote por placa. Custos antigos com a mesma placa são sobrescritos;
 * placas não presentes no novo lote são mantidas (igual mergeCustos do localStorage).
 *
 * Dedup interno: se houver placas repetidas, mantém a última.
 */
export async function upsertCustos(custos: CustoDetalhado[]): Promise<{ total: number; duplicatasIgnoradas: number }> {
  if (custos.length === 0) return { total: 0, duplicatasIgnoradas: 0 };

  const porPlaca = new Map<string, CustoDetalhado>();
  for (const c of custos) {
    if (!c.placa) continue;
    porPlaca.set(c.placa, c);
  }
  const unicos = [...porPlaca.values()];
  const duplicatasIgnoradas = custos.length - unicos.length;

  const sb = getSupabase();
  for (const lote of chunk(unicos.map(toRow), 500)) {
    const { error } = await sb.from("custos_detalhados").upsert(lote, { onConflict: "placa" });
    if (error) throw new Error(`upsertCustos: ${error.message}`);
  }
  return { total: unicos.length, duplicatasIgnoradas };
}

export async function clearCustos(): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from("custos_detalhados").delete().neq("placa", "__never__");
  if (error) throw new Error(`clearCustos: ${error.message}`);
}

export async function contarCustos(): Promise<number> {
  const sb = getSupabase();
  const { count, error } = await sb.from("custos_detalhados").select("*", { count: "exact", head: true });
  if (error) throw new Error(`contarCustos: ${error.message}`);
  return count ?? 0;
}
