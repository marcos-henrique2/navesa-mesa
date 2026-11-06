"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BatchResult } from "@/lib/fipe/batch-tipos";
import { chunk, getSupabase, selectAll } from "@/lib/data/supabase";
import { fipeBatchToRow, montarBatchFipe, type FipeBatchRow } from "@/lib/data/mappers/fipe-batch";

/**
 * Lê todo o batch do Supabase e monta o BatchResult (mapper puro em
 * `@/lib/data/mappers/fipe-batch`, que também reconstrói os erros de confiança).
 */
export async function loadBatchFromSupabase(): Promise<BatchResult | null> {
  const sb = getSupabase();
  const rows = await selectAll<FipeBatchRow>(sb, "fipe_batch", { orderBy: "chassi" });
  return montarBatchFipe(rows);
}

/**
 * Grava o batch no Supabase.
 *
 * `sb` é opcional e existe só pra permitir rodar isso fora do browser (script
 * Node do sync, sem sessão de usuário): quando fornecido, usa esse client em
 * vez de `getSupabase()` (que depende de sessão de browser). Mesmo padrão de
 * `gravarVendasNode`/`gravarVeiculosNode` em scripts/sync-nbs/gravar.ts —
 * aqui injetado em vez de duplicado, porque a lógica de matching em
 * `runFipeBatch` não pode ter duas cópias para manter sincronizadas.
 */
export async function saveBatchToSupabase(result: BatchResult, sb?: SupabaseClient): Promise<void> {
  const itens = Object.values(result.items);

  // Invariante de escrita: preço sem tabela de referência não entra no banco.
  //
  // `runFipeBatch` já aborta antes de buscar qualquer preço quando não consegue
  // resolver a referência, e o drawer sempre carimba a que usou — então chegar
  // aqui sem referência é bug de programação, não caso de borda operacional.
  // Falhar alto é o certo: gravar em silêncio recria exatamente a situação que
  // a migration 022 existe pra encerrar (preço não auditável, impossível de
  // conferir contra o Auto Avaliar).
  const semRef = itens.filter((it) => !it.fipeReferencia);
  if (semRef.length > 0) {
    throw new Error(
      `saveBatchToSupabase: ${semRef.length} item(ns) sem referência FIPE (ex.: chassi ${semRef[0].chassi}). ` +
        `Nada foi gravado — preço sem tabela de origem não é auditável.`,
    );
  }

  const rows = itens.map((it) => fipeBatchToRow(it, result.timestamp));
  if (rows.length === 0) return;

  // `getSupabase()` só depois da validação: valida a entrada antes de adquirir
  // o recurso. Também é o que torna a invariante testável sem credenciais.
  // Com `sb` injetado (caller já tem um client pronto, ex. service-role no
  // Node), não adquirimos o client de browser — comportamento padrão (sem
  // `sb`) permanece idêntico ao de antes.
  const client = sb ?? getSupabase();
  for (const grupo of chunk(rows)) {
    const { error } = await client.from("fipe_batch").upsert(grupo, { onConflict: "chassi" });
    if (error) throw new Error(`saveBatchToSupabase: ${error.message}`);
  }
}

export async function clearBatchSupabase(): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from("fipe_batch").delete().neq("chassi", "__never__");
  if (error) throw new Error(`clearBatchSupabase: ${error.message}`);
}

export async function batchIdadeHorasSupabase(): Promise<number | null> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("fipe_batch")
    .select("atualizado_em")
    .order("atualizado_em", { ascending: false })
    .limit(1);
  if (error) throw new Error(`batchIdadeHorasSupabase: ${error.message}`);
  if (!data || data.length === 0) return null;
  const ts = new Date(data[0].atualizado_em).getTime();
  return (Date.now() - ts) / (1000 * 60 * 60);
}

export async function contarBatchFipe(): Promise<number> {
  const sb = getSupabase();
  const { count, error } = await sb.from("fipe_batch").select("*", { count: "exact", head: true });
  if (error) throw new Error(`contarBatchFipe: ${error.message}`);
  return count ?? 0;
}
