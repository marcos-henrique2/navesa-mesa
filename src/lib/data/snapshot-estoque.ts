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
 *     leva junto o que entrou), com o mesmo retry em timeout e confirmação via RETURNING;
 *     o snapshot anterior volta a ser o `max(id)`.
 *  5. Lista vazia é recusada antes de criar o snapshot (publicaria estoque vazio).
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

type ConfigRetry = { maxTentativas: number; backoffBaseMs: number; esperar: (ms: number) => Promise<void> };

/**
 * Repete `executar` enquanto o erro for timeout (57014), com backoff exponencial.
 * Retorna `null` no sucesso ou a mensagem do último erro (com a tentativa).
 */
async function comRetryEmTimeout(
  executar: () => PromiseLike<{ error: ErroPostgrest | null }>,
  { maxTentativas, backoffBaseMs, esperar }: ConfigRetry,
): Promise<string | null> {
  for (let tentativa = 1; ; tentativa++) {
    const { error } = await executar();
    if (!error) return null;
    if (!ehErroDeTimeout(error) || tentativa >= maxTentativas) {
      return `${error.message} (tentativa ${tentativa}/${maxTentativas})`;
    }
    await esperar(backoffBaseMs * 2 ** (tentativa - 1));
  }
}

/**
 * Rollback: apaga o snapshot (cascade leva os veículos). Mesmo retry em timeout dos
 * inserts — o DELETE roda sob a mesma carga que derrubou o insert. `.select("id")`
 * confirma que a linha saiu de fato. Retorna `null` se removeu, ou o motivo da falha.
 */
async function removerSnapshot(sb: SupabaseClient, snapshotId: number, retry: ConfigRetry): Promise<string | null> {
  let removidas = 0;
  const falha = await comRetryEmTimeout(async () => {
    const { data, error } = await sb.from("estoque_snapshots").delete().eq("id", snapshotId).select("id");
    removidas = data?.length ?? 0;
    return { error };
  }, retry);
  if (falha) return falha;
  return removidas > 0 ? null : "DELETE não removeu nenhuma linha";
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
  if (veiculos.length === 0) {
    throw new Error(`${prefixoErro}: lista de veículos vazia — snapshot não criado (publicaria estoque vazio).`);
  }
  const tamanhoLote = opcoes.tamanhoLote ?? TAMANHO_LOTE_VEICULOS;
  const retry: ConfigRetry = {
    maxTentativas: opcoes.maxTentativas ?? MAX_TENTATIVAS_LOTE,
    backoffBaseMs: opcoes.backoffBaseMs ?? BACKOFF_BASE_MS,
    esperar: opcoes.esperar ?? dormir,
  };

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
      const falha = await comRetryEmTimeout(() => sb.from("veiculos").insert(lote), retry);
      if (falha) throw new Error(`lote ${i + 1}/${lotes.length}: ${falha}`);
    }

    const gravados = await contarVeiculosDoSnapshot(sb, snapshotId);
    if (gravados !== veiculos.length) {
      throw new Error(`contagem divergente: ${gravados} gravado(s) no banco vs ${veiculos.length} lido(s)`);
    }
  } catch (err) {
    const motivo = err instanceof Error ? err.message : String(err);
    const falhaRollback = await removerSnapshot(sb, snapshotId, retry);
    if (falhaRollback) {
      throw new Error(
        `${prefixoErro} (snapshot ${snapshotId}): ${motivo} — CRÍTICO: rollback falhou (${falhaRollback}); ` +
          `snapshot incompleto continua publicado em veiculos_atual, apagar manualmente.`,
      );
    }
    throw new Error(`${prefixoErro} (snapshot ${snapshotId}): ${motivo} — snapshot removido (rollback), estoque anterior mantido.`);
  }

  return { snapshotId, inseridos: veiculos.length };
}
