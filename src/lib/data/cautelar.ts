"use client";

import type { StatusCautelar } from "@/lib/inventory/cautelar-tipos";
import { chunk, getSupabase, selectAll } from "@/lib/data/supabase";
import { montarCautelares, type CautelarRow } from "@/lib/data/mappers/cautelar";

export async function listCautelares(): Promise<Record<string, StatusCautelar>> {
  const sb = getSupabase();
  const rows = await selectAll<CautelarRow>(sb, "cautelar", { orderBy: "chassi" });
  return montarCautelares(rows);
}

export async function upsertCautelar(chassi: string, status: StatusCautelar): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from("cautelar").upsert(
    { chassi, status, atualizado_em: new Date().toISOString() },
    { onConflict: "chassi" },
  );
  if (error) throw new Error(`upsertCautelar: ${error.message}`);
}

export async function deleteCautelar(chassi: string): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from("cautelar").delete().eq("chassi", chassi);
  if (error) throw new Error(`deleteCautelar: ${error.message}`);
}

export async function upsertCautelaresEmLote(
  novas: Record<string, StatusCautelar>,
): Promise<{ total: number }> {
  const sb = getSupabase();
  const rows = Object.entries(novas).map(([chassi, status]) => ({
    chassi,
    status,
    atualizado_em: new Date().toISOString(),
  }));
  for (const grupo of chunk(rows)) {
    const { error } = await sb.from("cautelar").upsert(grupo, { onConflict: "chassi" });
    if (error) throw new Error(`upsertCautelaresEmLote: ${error.message}`);
  }
  return { total: rows.length };
}

export async function contarCautelares(): Promise<number> {
  const sb = getSupabase();
  const { count, error } = await sb.from("cautelar").select("*", { count: "exact", head: true });
  if (error) throw new Error(`contarCautelares: ${error.message}`);
  return count ?? 0;
}
