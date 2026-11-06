/**
 * Gravação "tudo ou nada" de um snapshot de estoque (`estoque_snapshots` + `veiculos`).
 * Sem "use client": usada pelo sync Node (`scripts/sync-nbs/gravar.ts`, service_role) e
 * pelo upload manual no browser (`inserirEstoqueSnapshot` em `@/lib/data/veiculos`).
 *
 * Por quê (incidente 06/11/2026): `veiculos_atual` publica o snapshot de MAIOR id
 * (`snapshot_id = (select max(id) from estoque_snapshots)`), então o snapshot passa a ser
 * "o estoque" no instante em que é criado — antes dos veículos. O sync criou o snapshot 394
 * (1108 veículos), o insert dos veículos estourou `statement timeout` e o snapshot ficou
 * mais recente com 0 veículos: tela Estoque vazia em produção até apagarem à mão.
 *
 * Garantias daqui:
 *  1. Lotes menores (`TAMANHO_LOTE_VEICULOS`) — cada INSERT dura menos que o timeout do papel.
 *  2. Retry com backoff exponencial SÓ em timeout/cancelamento (SQLSTATE 57014): o Postgres
 *     já desfez o statement cancelado, então repetir o mesmo lote não duplica nada.
 *  3. Conferência final: `count(*)` do snapshot no banco tem que ser igual ao que foi lido.
 *  4. Qualquer falha (lote esgotou tentativas, erro não-retentável, contagem divergente) →
 *     DELETE do snapshot recém-criado (o `on delete cascade` de `veiculos.snapshot_id`
 *     leva junto o que entrou), e o snapshot anterior volta a ser o `max(id)`.
 *
 * Limite conhecido: entre o INSERT do snapshot e o último lote (segundos), `veiculos_atual`
 * já aponta pro snapshot novo, ainda parcial. Fechar essa janela exige mudar a view
 * (coluna "publicado"); ver relatório do fix.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { VeiculoParsed, SnapshotMeta } from "@/lib/parsers/nbs-xlsx";
import { veiculoToRow } from "@/lib/data/mappers/veiculos";
import { chunk } from "@/lib/data/supabase";

/** 250 linhas largas (~30 colunas, 8 índices em `veiculos`) por INSERT. Antes eram 500. */
export const TAMANHO_LOTE_VEICULOS = 250;
/** Tentativas por lote (1 original + 2 retries). */
export const MAX_TENTATIVAS_LOTE = 3;
/** Espera antes do 1º retry; dobra a cada tentativa (1s, 2s, ...). */
export const BACKOFF_BASE_MS = 1000;

export type OpcoesGravacaoSnapshot = {
  tamanhoLote?: number;
  maxTentativas?: number;
  backoffBaseMs?: number;
  /** Injetável pra teste não dormir de verdade. */
  esperar?: (ms: number) => Promise<void>;
};

type ErroPostgrest = { message: string; code?: string | null };

/** SQLSTATE 57014 = query_canceled (statement_timeout ou cancelamento). */
export function ehErroDeTimeout(error: ErroPostgrest): boolean {
  return error.code === "57014" || /statement timeout|canceling statement/i.test(error.message);
}

const dormir = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function inserirLoteComRetry(
  sb: SupabaseClient,
  lote: Record<string, unknown>[],
  maxTentativas: number,
  backoffBaseMs: number,
  esperar: (ms: number) => Promise<void>,
): Promise<void> {
  for (let tentativa = 1; ; tentativa++) {
    const { error } = await sb.from("veiculos").insert(lote);
    if (!error) return;
    if (!ehErroDeTimeout(error) || tentativa >= maxTentativas) {
      throw new Error(`${error.message} (tentativa ${tentativa}/${maxTentativas})`);
    }
    await esperar(backoffBaseMs * 2 ** (tentativa - 1));
  }
}

async function contarVeiculosDoSnapshot(sb: SupabaseClient, snapshotId: number): Promise<number> {
  const { count, error } = await sb
    .from("veiculos")
    .select("id", { count: "exact", head: true })
    .eq("snapshot_id", snapshotId);
  if (error) throw new Error(`conferência de contagem: ${error.message}`);
  return count ?? 0;
}

/**
 * Cria o snapshot, insere os veículos e confere a contagem. Se qualquer passo depois do
 * INSERT do snapshot falhar, apaga o snapshot (rollback) e relança o erro.
 * `prefixoErro` identifica o chamador na mensagem (vai pro `sync_log.erro_mensagem`).
 */
export async function gravarSnapshotEstoque(
  sb: SupabaseClient,
  veiculos: VeiculoParsed[],
  meta: SnapshotMeta,
  prefixoErro: string,
  opcoes: OpcoesGravacaoSnapshot = {},
): Promise<{ snapshotId: number; inseridos: number }> {
  const tamanhoLote = opcoes.tamanhoLote ?? TAMANHO_LOTE_VEICULOS;
  const maxTentativas = opcoes.maxTentativas ?? MAX_TENTATIVAS_LOTE;
  const backoffBaseMs = opcoes.backoffBaseMs ?? BACKOFF_BASE_MS;
  const esperar = opcoes.esperar ?? dormir;

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
  if (snapErr || !snap) throw new Error(`${prefixoErro}: ${snapErr?.message ?? "sem id"}`);

  const snapshotId = snap.id as number;

  try {
    const lotes = chunk(
      veiculos.map((v) => veiculoToRow(v, snapshotId)),
      tamanhoLote,
    );
    for (const [i, lote] of lotes.entries()) {
      try {
        await inserirLoteComRetry(sb, lote, maxTentativas, backoffBaseMs, esperar);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`lote ${i + 1}/${lotes.length}: ${msg}`);
      }
    }

    const gravados = await contarVeiculosDoSnapshot(sb, snapshotId);
    if (gravados !== veiculos.length) {
      throw new Error(`contagem divergente: ${gravados} gravado(s) no banco vs ${veiculos.length} lido(s)`);
    }
  } catch (err) {
    const motivo = err instanceof Error ? err.message : String(err);
    const { error: delErr } = await sb.from("estoque_snapshots").delete().eq("id", snapshotId);
    if (delErr) {
      throw new Error(
        `${prefixoErro} (snapshot ${snapshotId}): ${motivo} — CRÍTICO: rollback falhou (${delErr.message}); ` +
          `snapshot incompleto continua publicado em veiculos_atual, apagar manualmente.`,
      );
    }
    throw new Error(`${prefixoErro} (snapshot ${snapshotId}): ${motivo} — snapshot removido (rollback), estoque anterior mantido.`);
  }

  return { snapshotId, inseridos: veiculos.length };
}
