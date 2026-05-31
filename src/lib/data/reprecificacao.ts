"use client";

/**
 * CRUD da tabela reprecificacao_sugerida.
 *
 * Snapshot completo do contexto da sugestão (FIPE, classe, dias_patio, km,
 * cautelar, mediana_km, desvio) — auditável e versionado por versao_formula.
 *
 * Regra de unicidade (índice parcial uniq_reprec_pendente): no máximo 1 sugestão
 * em status 'pendente' ou 'em_revisao' por chassi. Aplicadas/descartadas viram
 * histórico e não bloqueiam novas sugestões.
 */

import type { DiagnosticoConfianca, DiagnosticoResult } from "@/lib/pricing/diagnostico";
import { getSupabase } from "./supabase";

export type ReprecificacaoStatus = "pendente" | "em_revisao" | "aplicado" | "descartado";

export type ReprecificacaoMotivo = {
  codigo: string;
  label: string;
  pct: number;
};

export type ReprecificacaoRow = {
  id: number;
  chassi: string;
  preco_sugerido: number;
  status: ReprecificacaoStatus;
  versao_formula: string;
  preco_atual_snapshot: number | null;
  fipe_snapshot: number | null;
  classe_snapshot: string | null;
  dias_patio_snapshot: number | null;
  km_snapshot: number | null;
  cautelar_snapshot: string | null;
  mediana_km_snapshot: number | null;
  desvio_pct_snapshot: number | null;
  /** FIX 4: soma dos ajustes APÓS cap (-0.10..+0.02). Permite reconstruir o cálculo. */
  ajuste_total_pct_snapshot: number | null;
  /** FIX 4: snapshot dos flags de confiança (semFipe, semCautelar, kmHeuristica, recemEntrado, semDiasPatio). */
  confianca_snapshot: DiagnosticoConfianca | null;
  motivo: ReprecificacaoMotivo[];
  observacao_usuario: string | null;
  preco_aplicado: number | null;
  aplicado_em: string | null;
  criado_em: string;
  atualizado_em: string;
};

type MarcarArgs = {
  chassi: string;
  diagnostico: DiagnosticoResult;
  veiculoSnapshot: { preco_venda: number | null; dias_patio: number | null; km: number | null };
  cautelarSnapshot: string | null;
  medianaKmSnapshot: number | null;
};

/**
 * Cria uma nova sugestão de reprecificação.
 * Falha se já existir uma pendente/em_revisao pro mesmo chassi (constraint do DB).
 */
export async function marcarParaReprecificar(args: MarcarArgs): Promise<ReprecificacaoRow> {
  const sb = getSupabase();
  const { diagnostico: d, veiculoSnapshot: vs } = args;

  const payload = {
    chassi: args.chassi,
    preco_sugerido: d.precoEsperado,
    status: "pendente" satisfies ReprecificacaoStatus,
    versao_formula: d.versao,
    preco_atual_snapshot: vs.preco_venda,
    fipe_snapshot: d.precoFipe,
    classe_snapshot: extrairClasseDoDiagnostico(d),
    dias_patio_snapshot: vs.dias_patio,
    km_snapshot: vs.km,
    cautelar_snapshot: args.cautelarSnapshot,
    mediana_km_snapshot: args.medianaKmSnapshot,
    desvio_pct_snapshot: d.desvioPct,
    // FIX 4: snapshot completo pra auditoria — sem isso a sugestão fica órfã do contexto
    // (não dá pra reconstruir POR QUE saiu aquele preço meses depois).
    ajuste_total_pct_snapshot: d.ajusteTotalPct,
    confianca_snapshot: d.confianca,
    motivo: d.ajustes.map((a) => ({ codigo: a.codigo, label: a.label, pct: a.pct })),
  };

  const { data, error } = await sb
    .from("reprecificacao_sugerida")
    .insert(payload)
    .select("*")
    .single();

  if (error) throw new Error(`marcarParaReprecificar: ${error.message}`);
  return data as ReprecificacaoRow;
}

/** Lista TODAS sugestões de um chassi (histórico completo, mais recentes primeiro). */
export async function listarSugestoesPorChassi(chassi: string): Promise<ReprecificacaoRow[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("reprecificacao_sugerida")
    .select("*")
    .eq("chassi", chassi)
    .order("criado_em", { ascending: false });
  if (error) throw new Error(`listarSugestoesPorChassi: ${error.message}`);
  return (data ?? []) as ReprecificacaoRow[];
}

/** Lista sugestões pendentes (queue de revisão). */
export async function listarSugestoesPendentes(): Promise<ReprecificacaoRow[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("reprecificacao_sugerida")
    .select("*")
    .in("status", ["pendente", "em_revisao"])
    .order("criado_em", { ascending: false });
  if (error) throw new Error(`listarSugestoesPendentes: ${error.message}`);
  return (data ?? []) as ReprecificacaoRow[];
}

export type AtualizarStatusOpts = {
  observacao?: string;
  preco_aplicado?: number;
};

/** Atualiza status de uma sugestão. Se 'aplicado', preenche aplicado_em + preco_aplicado. */
export async function atualizarStatus(
  id: number,
  status: Exclude<ReprecificacaoStatus, "pendente">,
  opts: AtualizarStatusOpts = {},
): Promise<void> {
  const sb = getSupabase();
  const patch: Record<string, unknown> = { status };
  if (opts.observacao !== undefined) patch.observacao_usuario = opts.observacao;
  if (status === "aplicado") {
    patch.aplicado_em = new Date().toISOString();
    if (opts.preco_aplicado !== undefined) patch.preco_aplicado = opts.preco_aplicado;
  }
  const { error } = await sb.from("reprecificacao_sugerida").update(patch).eq("id", id);
  if (error) throw new Error(`atualizarStatus: ${error.message}`);
}

/**
 * "Desmarca" reprecificação: descarta a última sugestão pendente/em_revisao do chassi.
 * Soft delete via status='descartado'. Não toca em sugestões aplicadas/descartadas anteriores.
 */
export async function desmarcarReprecificacao(chassi: string): Promise<void> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("reprecificacao_sugerida")
    .select("id")
    .eq("chassi", chassi)
    .in("status", ["pendente", "em_revisao"])
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`desmarcarReprecificacao (select): ${error.message}`);
  if (!data) return; // nada pendente, no-op
  const { error: updErr } = await sb
    .from("reprecificacao_sugerida")
    .update({ status: "descartado" })
    .eq("id", data.id);
  if (updErr) throw new Error(`desmarcarReprecificacao (update): ${updErr.message}`);
}

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Extrai a classe (A/B/C/D/E) a partir do baseClassePct usando a tabela de params.
 * Isso evita acoplar a assinatura de DiagnosticoResult ao tipo Classe sem precisar
 * passar classe como argumento extra do call site.
 */
function extrairClasseDoDiagnostico(d: DiagnosticoResult): string | null {
  // mapping inverso de DIAGNOSTICO_PARAMS_V1.baseClasse — match exato por pct
  const TABELA: Array<[number, string]> = [
    [0.02, "A"],
    [0, "B"],
    [-0.03, "C"],
    [-0.07, "D"],
    [-0.12, "E"],
  ];
  for (const [pct, classe] of TABELA) {
    if (Math.abs(d.baseClassePct - pct) < 1e-9) return classe;
  }
  return null;
}
