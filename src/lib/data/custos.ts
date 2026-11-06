"use client";

import type { CustoDetalhado } from "@/lib/parsers/nbs-custos-xls";
import { getSupabase, chunk, selectAll } from "@/lib/data/supabase";
import { custoToRow as toRow, custoFromRow as fromRow, type CustoRow } from "@/lib/data/mappers/custos";

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
