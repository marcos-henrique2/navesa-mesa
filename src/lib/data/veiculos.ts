"use client";

import type { VeiculoParsed, SnapshotMeta } from "@/lib/parsers/nbs-xlsx";
import { getSupabase, chunk, selectAll, parseDate } from "@/lib/data/supabase";
import {
  veiculoToRow,
  veiculoFromRow as fromRow,
  snapshotMetaFromRow,
  type VeiculoRow,
  type EstoqueSnapshotRow,
} from "@/lib/data/mappers/veiculos";
import { normalizarIdentificador } from "@/lib/utils/placa";

/**
 * Mapper puro em `@/lib/data/mappers/veiculos`. Re-exportado como `toRow` pra reuso em
 * `scripts/sync-nbs/gravar.ts` (client Node/service-role, sem sessão de browser).
 */
export { veiculoToRow as toRow };

/** Lista veículos do snapshot mais recente (via view veiculos_atual). */
export async function listVeiculosAtual(): Promise<VeiculoParsed[]> {
  const sb = getSupabase();
  const rows = await selectAll<VeiculoRow>(sb, "veiculos_atual", { orderBy: "id" });
  return rows.map(fromRow);
}

/** Snapshot mais recente: meta + qts. */
export async function getMetaAtual(): Promise<SnapshotMeta | null> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("estoque_snapshots")
    .select("*")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`getMetaAtual: ${error.message}`);
  if (!data) return null;
  return snapshotMetaFromRow(data as EstoqueSnapshotRow);
}

/**
 * Cria um NOVO snapshot e insere os veículos vinculados.
 * Cada upload de estoque gera um snapshot novo — histórico é preservado.
 */
export async function inserirEstoqueSnapshot(
  veiculos: VeiculoParsed[],
  meta: SnapshotMeta,
): Promise<{ snapshotId: number; inseridos: number }> {
  const sb = getSupabase();

  // 1) Cria snapshot
  const { data: snap, error: snapErr } = await sb
    .from("estoque_snapshots")
    .insert({
      arquivo_nome: meta.arquivo_nome,
      data_geracao: meta.data_geracao?.toISOString() ?? null,
      total_veiculos: meta.total_veiculos,
      total_lojas: meta.total_lojas,
    })
    .select("id")
    .single();
  if (snapErr || !snap) throw new Error(`inserirEstoqueSnapshot: ${snapErr?.message ?? "sem id"}`);

  const snapshotId = snap.id as number;

  // 2) Insere veículos em lote
  for (const lote of chunk(veiculos.map((v) => veiculoToRow(v, snapshotId)), 500)) {
    const { error } = await sb.from("veiculos").insert(lote);
    if (error) throw new Error(`inserir veículos (snapshot ${snapshotId}): ${error.message}`);
  }

  return { snapshotId, inseridos: veiculos.length };
}

/** Lista todos os snapshots de estoque (pra histórico). */
export async function listEstoqueSnapshots(): Promise<
  { id: number; arquivo_nome: string; data_geracao: Date | null; data_upload: Date | null; total_veiculos: number; total_lojas: number }[]
> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("estoque_snapshots")
    .select("*")
    .order("id", { ascending: false });
  if (error) throw new Error(`listEstoqueSnapshots: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id,
    arquivo_nome: r.arquivo_nome,
    data_geracao: parseDate(r.data_geracao),
    data_upload: parseDate(r.data_upload),
    total_veiculos: r.total_veiculos ?? 0,
    total_lojas: r.total_lojas ?? 0,
  }));
}

/** Apaga TODOS os snapshots de estoque (e os veículos por cascata). */
export async function clearEstoque(): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from("estoque_snapshots").delete().neq("id", -1);
  if (error) throw new Error(`clearEstoque: ${error.message}`);
}

export async function contarVeiculosAtual(): Promise<number> {
  const sb = getSupabase();
  const { count, error } = await sb.from("veiculos_atual").select("*", { count: "exact", head: true });
  if (error) throw new Error(`contarVeiculosAtual: ${error.message}`);
  return count ?? 0;
}

/**
 * Loja de ORIGEM de cada chassi (cod_empresa do snapshot mais antigo em que o veículo
 * apareceu — migration 038, view `veiculos_origem`). Diferente de "loja que vendeu":
 * um carro pode ter entrado no estoque de uma loja e sido repassado/vendido por outra.
 *
 * Chave do Map normalizada (`normalizarIdentificador` — alias de `normalizarPlaca` pra
 * uso com chassi: só maiúsculas + remove não-alfanumérico) pra tolerar variação de
 * formatação entre a fonte que gerou `vendas.chassi` e a que gerou `veiculos.chassi`.
 *
 * Chassis sem snapshot conhecido (nunca capturados num upload de estoque) simplesmente
 * não aparecem no Map — origem desconhecida, não "loja 0".
 */
export async function listLojaOrigemPorChassis(chassis: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const unicos = [...new Set(chassis.filter((c) => c.length > 0))];
  if (unicos.length === 0) return out;

  const sb = getSupabase();
  for (const lote of chunk(unicos, 500)) {
    const { data, error } = await sb.from("veiculos_origem").select("chassi, cod_empresa").in("chassi", lote);
    if (error) throw new Error(`listLojaOrigemPorChassis: ${error.message}`);
    for (const row of (data ?? []) as { chassi: string; cod_empresa: number }[]) {
      out.set(normalizarIdentificador(row.chassi), row.cod_empresa);
    }
  }
  return out;
}
