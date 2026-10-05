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
 *
 * ┌─ RECONCILIAÇÃO AUTOMÁTICA (migration 045) ─────────────────────────────────┐
 * │ `reconciliar_sumidos: true` e `placas_outras_lojas` vão SEMPRE nas duas     │
 * │ chamadas — é o handoff da Dara: "só ligar esta flag no cliente DEPOIS de    │
 * │ montar `placas_outras_lojas` a partir do MESMO parser que já alimenta       │
 * │ `placasVistasNoArquivo` hoje" (ver `placasDeOutrasLojas`, em                │
 * │ presenca-arquivo-auto-avaliar.ts). Payload sem essas chaves é o             │
 * │ comportamento antigo — não é esse o caminho que este módulo usa mais.       │
 * │                                                                              │
 * │ `confirmar_reconciliacao_arriscada` é o 2º passo da MESMA UX de confirmação │
 * │ do fluxo de texto (`ImportarPorTexto`): se `resumo.reconciliacao_           │
 * │ pendente_confirmacao` voltar `true`, a tela pede confirmação explícita e    │
 * │ chama `aplicarSyncArquivo` de novo com essa flag — os valores já gravados   │
 * │ na 1ª chamada não são regravados (idempotente); só a reconciliação passa a  │
 * │ escrever.                                                                   │
 * └──────────────────────────────────────────────────────────────────────────────┘
 */

import { getSupabase } from "@/lib/data/supabase";
import type { PayloadSyncArquivo } from "@/lib/parsers/auto-avaliar-ofertas-xls";
import { lerRelatorioSync, type RelatorioSync } from "@/lib/repasses/sync-arquivo-auto-avaliar";

/** PostgREST pode embrulhar o retorno escalar num array de 1 elemento. */
function desembrulhar(data: unknown): unknown {
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

export type OpcoesReconciliacaoArquivo = {
  /**
   * Placas normalizadas de QUALQUER OUTRA loja do mesmo arquivo (nunca as da
   * loja alvo, que já estão em `payload.linhas`). Vem de
   * `placasDeOutrasLojas(parse.outra_loja)`. Sem isso a RPC reconciliaria
   * contra um universo incompleto e acusaria de vendido/saiu um carro que só
   * foi transferido de loja.
   */
  placasOutrasLojas: ReadonlyArray<string>;
};

export type OpcoesAplicarReconciliacao = OpcoesReconciliacaoArquivo & {
  /** 2º passo da trava de risco — só true depois da confirmação explícita na tela. */
  confirmarReconciliacaoArriscada?: boolean;
};

/**
 * Payload bruto do arquivo + as chaves novas da migration 045. PURA — exportada
 * só pra ser testada sem precisar de um Supabase real (as duas funções de I/O
 * abaixo chamam `getSupabase()`, que exige browser).
 */
export function montarPPayloadComReconciliacao(
  payload: PayloadSyncArquivo,
  opts: OpcoesReconciliacaoArquivo,
): Record<string, unknown> {
  return {
    ...payload,
    reconciliar_sumidos: true,
    placas_outras_lojas: [...opts.placasOutrasLojas],
  };
}

/**
 * Diff do arquivo contra o banco. READ-ONLY — a função é `STABLE`, a engine do
 * Postgres recusa qualquer escrita lá dentro. Nada é gravado por esta chamada.
 *
 * Sempre pede a reconciliação (read-only aqui: só lista `a_reconciliar` e
 * calcula `risco_reconciliacao`) pra tela de conferência já nascer mostrando o
 * que vai mudar de status, antes de qualquer gravação.
 */
export async function previewSyncArquivo(
  payload: PayloadSyncArquivo,
  opts: OpcoesReconciliacaoArquivo,
): Promise<RelatorioSync> {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("sincronizar_repasse_arquivo_auto_avaliar_preview", {
    p_payload: montarPPayloadComReconciliacao(payload, opts),
  });
  if (error) throw new Error(`Falha ao conferir o arquivo contra o sistema: ${error.message}`);
  return lerRelatorioSync(desembrulhar(data));
}

/**
 * Aplica o sync. Uma transação, idempotente: rodar o mesmo arquivo duas vezes
 * não grava nada na segunda. Retorno no mesmo contrato do preview, com
 * `modo: "aplicado"` e `resumo.linhas_gravadas` real.
 *
 * Reconcilia status automaticamente (migration 045), SALVO quando o risco exige
 * confirmação e `opts.confirmarReconciliacaoArriscada` não vem `true` — nesse
 * caso os VALORES são gravados normalmente, mas `resumo.
 * reconciliacao_pendente_confirmacao` volta `true` e nenhum `status` muda até a
 * chamada seguinte com a confirmação.
 */
export async function aplicarSyncArquivo(
  payload: PayloadSyncArquivo,
  opts: OpcoesAplicarReconciliacao,
): Promise<RelatorioSync> {
  const sb = getSupabase();
  const p_payload = {
    ...montarPPayloadComReconciliacao(payload, opts),
    confirmar_reconciliacao_arriscada: opts.confirmarReconciliacaoArriscada === true,
  };
  const { data, error } = await sb.rpc("sincronizar_repasse_arquivo_auto_avaliar", { p_payload });
  if (error) throw new Error(`Falha ao sincronizar os valores do arquivo: ${error.message}`);
  return lerRelatorioSync(desembrulhar(data));
}
