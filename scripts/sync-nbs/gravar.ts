import type { SupabaseClient } from "@supabase/supabase-js";
import type { VendaParsed } from "../../src/lib/parsers/nbs-vendas-xlsx";
import type { VeiculoParsed, SnapshotMeta } from "../../src/lib/parsers/nbs-xlsx";
import { toRow as vendaToRow } from "../../src/lib/data/vendas";
import { toRow as veiculoToRow } from "../../src/lib/data/veiculos";
import { chunk } from "../../src/lib/data/supabase";

/**
 * Gravação real (Node, client de service-role) das vendas sincronizadas do
 * Oracle. Reaproveita a MESMA lógica de mapeamento de colunas
 * (`toRow` de src/lib/data/vendas.ts) e o mesmo padrão de upsert por chassi
 * (idempotente — seguro rodar repetido). Não reusa `upsertVendas` direto
 * porque esse tem "use client" e depende de `getSupabase()` (sessão de
 * browser) — aqui o client já vem pronto de fora (SUPABASE_SERVICE_ROLE_KEY,
 * mesmo padrão de `gravarSyncLog` em index.ts).
 *
 * Dedup interno idêntico ao de `upsertVendas`: mantém a ÚLTIMA ocorrência
 * por chassi (Postgres não aceita duplicata no mesmo batch de upsert).
 */
export async function gravarVendasNode(
  sb: SupabaseClient,
  vendas: VendaParsed[],
): Promise<{ total: number; duplicatasIgnoradas: number }> {
  if (vendas.length === 0) return { total: 0, duplicatasIgnoradas: 0 };

  const porChassi = new Map<string, VendaParsed>();
  for (const v of vendas) {
    if (!v.chassi) continue;
    porChassi.set(v.chassi, v);
  }
  const unicas = [...porChassi.values()];
  const duplicatasIgnoradas = vendas.length - unicas.length;

  for (const lote of chunk(unicas.map(vendaToRow), 500)) {
    const { error } = await sb.from("vendas").upsert(lote, { onConflict: "chassi" });
    if (error) throw new Error(`gravarVendasNode: ${error.message}`);
  }
  return { total: unicas.length, duplicatasIgnoradas };
}

/**
 * Gravação real (Node, client de service-role) do snapshot de estoque
 * sincronizado do Oracle. Reaproveita a MESMA lógica de
 * `src/lib/data/veiculos.ts` (`toRow`, modelo "cada rodada = snapshot
 * completo novo" de `inserirEstoqueSnapshot`) — só troca o client pelo
 * mesmo motivo de `gravarVendasNode` acima.
 */
export async function gravarVeiculosNode(
  sb: SupabaseClient,
  veiculos: VeiculoParsed[],
  meta: SnapshotMeta,
): Promise<{ snapshotId: number; inseridos: number }> {
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
  if (snapErr || !snap) throw new Error(`gravarVeiculosNode: ${snapErr?.message ?? "sem id"}`);

  const snapshotId = snap.id as number;

  for (const lote of chunk(veiculos.map((v) => veiculoToRow(v, snapshotId)), 500)) {
    const { error } = await sb.from("veiculos").insert(lote);
    if (error) throw new Error(`gravarVeiculosNode (snapshot ${snapshotId}): ${error.message}`);
  }

  return { snapshotId, inseridos: veiculos.length };
}
