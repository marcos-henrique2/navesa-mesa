"use client";

/**
 * Camada de I/O da importação de VENDAS do Auto Avaliar (migration 036).
 *
 * Pipeline:
 *   parseAutoAvaliarVendasXlsx (puro) → montarPayloadVendas (puro) →
 *   previewVendasConcluidas (RPC STABLE, não grava) → TELA DE CONFERÊNCIA →
 *   aplicarVendasConcluidas (RPC VOLATILE, 1 transação).
 *
 * ⚠️ Não há decisão de negócio nenhuma no cliente: as duas RPCs recebem o MESMO
 * payload bruto, e a de aplicar recalcula o diff do zero chamando a de preview.
 * O cliente não manda o diff que o usuário viu — ele não consegue confirmar uma
 * mudança que o banco não derivaria sozinho.
 */

import { getSupabase } from "@/lib/data/supabase";
import type { PayloadVendas } from "@/lib/parsers/auto-avaliar-vendas-xlsx";
import { lerRelatorioVendas, type RelatorioVendas } from "@/lib/repasses/vendas-concluidas";

/** PostgREST pode embrulhar o retorno escalar num array de 1 elemento. */
function desembrulhar(data: unknown): unknown {
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

/**
 * Diff do relatório contra o banco. READ-ONLY — a função é `STABLE`, a engine do
 * Postgres recusa qualquer escrita lá dentro. Nada é gravado por esta chamada.
 */
export async function previewVendasConcluidas(payload: PayloadVendas): Promise<RelatorioVendas> {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("importar_vendas_concluidas_auto_avaliar_preview", {
    p_payload: payload,
  });
  if (error) throw new Error(`Falha ao conferir as vendas contra o sistema: ${error.message}`);
  return lerRelatorioVendas(desembrulhar(data));
}

/**
 * Registra as vendas. Uma transação, idempotente: rodar o mesmo arquivo duas
 * vezes não grava nada na segunda. Retorno no mesmo contrato do preview, com
 * `modo: "aplicado"` e as contagens reais.
 */
export async function aplicarVendasConcluidas(payload: PayloadVendas): Promise<RelatorioVendas> {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("importar_vendas_concluidas_auto_avaliar", {
    p_payload: payload,
  });
  if (error) throw new Error(`Falha ao registrar as vendas: ${error.message}`);
  return lerRelatorioVendas(desembrulhar(data));
}
