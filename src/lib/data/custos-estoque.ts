"use client";

import type { CustoEstoqueDetalhado } from "@/lib/parsers/nbs-custos-estoque-pdf";
import { getSupabase, chunk, selectAll } from "@/lib/data/supabase";
import {
  custoEstoqueToRow as toRow,
  montarCustosEstoque,
  type CustoEstoqueRow,
  type CustosEstoqueCarregados,
} from "@/lib/data/mappers/custos-estoque";

/** Lista TODOS os custos de estoque (paginando). */
export async function listCustosEstoque(): Promise<CustosEstoqueCarregados> {
  const sb = getSupabase();
  const rows = await selectAll<CustoEstoqueRow>(sb, "custos_estoque_detalhado", { orderBy: "placa" });
  return montarCustosEstoque(rows);
}

/**
 * Upsert em lote por placa. Custos antigos com a mesma placa são sobrescritos;
 * placas não presentes no novo lote são mantidas (igual a outros datasets).
 *
 * codEmpresa é gravado em todas as linhas (vem da meta do PDF — cada PDF cobre 1 loja).
 */
export async function upsertCustosEstoque(
  itens: CustoEstoqueDetalhado[],
  codEmpresa: number | null,
): Promise<{ total: number; duplicatasIgnoradas: number }> {
  if (itens.length === 0) return { total: 0, duplicatasIgnoradas: 0 };

  const porPlaca = new Map<string, CustoEstoqueDetalhado>();
  for (const c of itens) {
    if (!c.placa) continue;
    porPlaca.set(c.placa, c);
  }
  const unicos = [...porPlaca.values()];
  const duplicatasIgnoradas = itens.length - unicos.length;

  const sb = getSupabase();
  for (const lote of chunk(unicos.map((c) => toRow(c, codEmpresa)), 500)) {
    const { error } = await sb.from("custos_estoque_detalhado").upsert(lote, { onConflict: "placa" });
    if (error) throw new Error(`upsertCustosEstoque: ${error.message}`);
  }
  return { total: unicos.length, duplicatasIgnoradas };
}

export async function clearCustosEstoque(): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from("custos_estoque_detalhado").delete().neq("placa", "__never__");
  if (error) throw new Error(`clearCustosEstoque: ${error.message}`);
}

export async function contarCustosEstoque(): Promise<number> {
  const sb = getSupabase();
  const { count, error } = await sb.from("custos_estoque_detalhado").select("*", { count: "exact", head: true });
  if (error) throw new Error(`contarCustosEstoque: ${error.message}`);
  return count ?? 0;
}
