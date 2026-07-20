"use client";

import type { BatchFipeError, BatchFipeItem, BatchResult } from "@/lib/fipe/batch";
import { isFipeConfirmado, FIPE_SCORE_MIN } from "@/lib/fipe/batch";
import { chunk, getSupabase, selectAll } from "./supabase";

type FipeBatchRow = {
  chassi: string;
  preco_fipe: number;
  fipe_marca_cod: string | null;
  fipe_marca_nome: string | null;
  fipe_modelo_cod: number | null;
  fipe_modelo_nome: string | null;
  fipe_ano_cod: string | null;
  fipe_ano_nome: string | null;
  /** Score do match (migration 021). `null` em linhas gravadas antes dela. */
  score: number | null;
  /** Guard de plausibilidade rodou e aprovou (migration 021). `false` no legado. */
  plausibilidade_verificada: boolean | null;
  atualizado_em: string;
};

function fromRow(r: FipeBatchRow): BatchFipeItem {
  return {
    chassi: r.chassi,
    precoFipe: Number(r.preco_fipe),
    match: {
      marcaCod: r.fipe_marca_cod ?? "",
      marcaNome: r.fipe_marca_nome ?? "",
      modeloCod: r.fipe_modelo_cod ?? 0,
      modeloNome: r.fipe_modelo_nome ?? "",
      anoCod: r.fipe_ano_cod ?? "",
      anoNome: r.fipe_ano_nome ?? "",
    },
    score: r.score == null ? null : Number(r.score),
    // `null` (coluna ausente / linha legada) é lido como NÃO verificado.
    plausibilidadeVerificada: r.plausibilidade_verificada === true,
  };
}

function toRow(item: BatchFipeItem, timestamp: number): Omit<FipeBatchRow, "atualizado_em"> & { atualizado_em: string } {
  return {
    chassi: item.chassi,
    preco_fipe: item.precoFipe,
    fipe_marca_cod: item.match.marcaCod,
    fipe_marca_nome: item.match.marcaNome,
    fipe_modelo_cod: item.match.modeloCod,
    fipe_modelo_nome: item.match.modeloNome,
    fipe_ano_cod: item.match.anoCod,
    fipe_ano_nome: item.match.anoNome,
    score: item.score,
    plausibilidade_verificada: item.plausibilidadeVerificada,
    atualizado_em: new Date(timestamp).toISOString(),
  };
}

/**
 * Lê todo o batch do Supabase e monta o BatchResult.
 *
 * Os erros da EXECUÇÃO não persistem, mas os erros de CONFIANÇA são recalculáveis
 * a partir das linhas — e precisam ser, senão o painel mente. Antes essa função
 * devolvia `erros: []` e `totalVeiculos: rows.length`, o que fazia a cobertura
 * dar 100% mesmo com metade das linhas sendo match não confirmado.
 */
export async function loadBatchFromSupabase(): Promise<BatchResult | null> {
  const sb = getSupabase();
  const rows = await selectAll<FipeBatchRow>(sb, "fipe_batch", { orderBy: "chassi" });
  if (rows.length === 0) return null;

  const items: Record<string, BatchFipeItem> = {};
  const erros: BatchFipeError[] = [];
  let maxTs = 0;
  for (const r of rows) {
    const item = fromRow(r);
    items[r.chassi] = item;
    if (!isFipeConfirmado(item)) {
      // Os dois motivos são reconstruídos: antes só `score-baixo` voltava, então
      // uma linha com score alto que NUNCA passou pelo guard de plausibilidade
      // reaparecia como totalmente confirmada depois de um F5.
      const semScore = item.score == null || item.score < FIPE_SCORE_MIN;
      erros.push({
        chassi: r.chassi,
        modelo: r.fipe_modelo_nome ?? "—",
        motivo: semScore ? "score-baixo" : "sem-custo-referencia",
        detalhe: semScore
          ? item.score == null
            ? "match sem score registrado (anterior à migration 021) — reveja ou rode o batch de novo"
            : `score ${item.score.toFixed(2)} abaixo do mínimo de confiança`
          : "preço nunca confrontado com o custo do veículo (importado sem custo_total)",
      });
    }
    const t = new Date(r.atualizado_em).getTime();
    if (t > maxTs) maxTs = t;
  }
  return {
    timestamp: maxTs,
    items,
    erros,
    totalGrupos: 0,
    totalVeiculos: rows.length,
    // Veio do banco: por definição está persistido.
    persistenciaErro: null,
  };
}

export async function saveBatchToSupabase(result: BatchResult): Promise<void> {
  const sb = getSupabase();
  const rows = Object.values(result.items).map((it) => toRow(it, result.timestamp));
  if (rows.length === 0) return;
  for (const grupo of chunk(rows)) {
    const { error } = await sb.from("fipe_batch").upsert(grupo, { onConflict: "chassi" });
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
