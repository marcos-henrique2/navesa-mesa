"use client";

/**
 * Camada de I/O do sync por ARQUIVO do Auto Avaliar (Story 2.2 / Fatia 3a).
 *
 * Pipeline:
 *   parseAutoAvaliarOfertasXls (puro) → montarPayloadSyncArquivo (puro) →
 *   previewSyncArquivo (RPC STABLE, não grava) → TELA DE CONFERÊNCIA →
 *   aplicarSyncArquivo (RPC VOLATILE, 1 transação).
 *
 * ⚠️ Diferente das outras funções deste diretório, aqui NÃO há decisão de
 * negócio nenhuma no cliente: as duas RPCs recebem o MESMO payload bruto, e a de
 * aplicar recalcula o diff do zero chamando a de preview. O cliente não manda o
 * diff que o usuário viu — ele não consegue confirmar uma mudança que o banco
 * não derivaria sozinho.
 */

import { getSupabase } from "@/lib/data/supabase";
import type { PayloadSyncArquivo } from "@/lib/parsers/auto-avaliar-ofertas-xls";
import { lerRelatorioSync, type RelatorioSync } from "@/lib/repasses/sync-arquivo-auto-avaliar";

/** PostgREST pode embrulhar o retorno escalar num array de 1 elemento. */
function desembrulhar(data: unknown): unknown {
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

/**
 * Diff do arquivo contra o banco. READ-ONLY — a função é `STABLE`, a engine do
 * Postgres recusa qualquer escrita lá dentro. Nada é gravado por esta chamada.
 */
export async function previewSyncArquivo(payload: PayloadSyncArquivo): Promise<RelatorioSync> {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("sincronizar_repasse_arquivo_auto_avaliar_preview", {
    p_payload: payload,
  });
  if (error) throw new Error(`Falha ao conferir o arquivo contra o sistema: ${error.message}`);
  return lerRelatorioSync(desembrulhar(data));
}

/**
 * Aplica o sync. Uma transação, idempotente: rodar o mesmo arquivo duas vezes
 * não grava nada na segunda. Retorno no mesmo contrato do preview, com
 * `modo: "aplicado"` e `resumo.linhas_gravadas` real.
 */
export async function aplicarSyncArquivo(payload: PayloadSyncArquivo): Promise<RelatorioSync> {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("sincronizar_repasse_arquivo_auto_avaliar", {
    p_payload: payload,
  });
  if (error) throw new Error(`Falha ao sincronizar os valores do arquivo: ${error.message}`);
  return lerRelatorioSync(desembrulhar(data));
}
