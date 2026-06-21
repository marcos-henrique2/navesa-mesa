"use client";

/**
 * Mini-CRM de Interessados (follow-up de repasse).
 *
 * Leads que VISUALIZARAM o anúncio no Auto Avaliar. Tudo client-side via o
 * singleton getSupabase(). Erros são propagados como Error — UI captura via
 * try/catch e exibe toast (mesmo padrão de queries.ts).
 *
 * Tipo de dado e mapeamento espelham a tabela `repasse_interessados` (migration
 * 016). NUMERIC/INTEGER do Supabase pode vir como string — normalizamos.
 */

import { getSupabase } from "@/lib/data/supabase";
import type { InteressadoParsed } from "./parse-interessados";

// ─── TIPOS ───────────────────────────────────────────────────────────────────

export type StatusFollowup =
  | "novo"
  | "contatado"
  | "respondeu"
  | "negociando"
  | "fechou"
  | "perdido";

export type RepasseInteressado = {
  id: number;
  repasse_id: number;
  nome: string;
  cidade_uf: string | null;
  telefone_whatsapp: string | null;
  telefones_raw: string | null;
  email: string | null;
  qtd_visualizacoes: number;
  data_acesso: string | null;
  status_followup: StatusFollowup;
  observacao: string | null;
  data_contato: string | null; // YYYY-MM-DD | null
  criado_em: string; // ISO
  atualizado_em: string; // ISO
};

/** Row crua do banco antes do mapeamento pro domínio. */
type RepasseInteressadoRow = {
  id: number;
  repasse_id: number;
  nome: string;
  cidade_uf: string | null;
  telefone_whatsapp: string | null;
  telefones_raw: string | null;
  email: string | null;
  qtd_visualizacoes: number | string | null;
  data_acesso: string | null;
  status_followup: string;
  observacao: string | null;
  data_contato: string | null;
  criado_em: string;
  atualizado_em: string;
};

// ─── Status: valores, labels pt-BR e ordem do funil ──────────────────────────

/** Ordem do funil — usada nos KPIs e no dropdown inline. */
export const STATUS_FOLLOWUP_VALUES: ReadonlyArray<StatusFollowup> = [
  "novo",
  "contatado",
  "respondeu",
  "negociando",
  "fechou",
  "perdido",
];

export const STATUS_FOLLOWUP_LABEL: Record<StatusFollowup, string> = {
  novo: "Novo",
  contatado: "Contatado",
  respondeu: "Respondeu",
  negociando: "Negociando",
  fechou: "Fechou",
  perdido: "Perdido",
};

export function isStatusFollowup(v: unknown): v is StatusFollowup {
  return typeof v === "string" && (STATUS_FOLLOWUP_VALUES as ReadonlyArray<string>).includes(v);
}

/** Normaliza INTEGER do Supabase (pode vir como string) pra number ≥ 1. */
function normalizarQtd(v: number | string | null): number {
  if (v == null) return 1;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : 1;
}

function rowToInteressado(row: RepasseInteressadoRow): RepasseInteressado {
  // CHECK constraint no banco garante o enum; fallback defensivo pra "novo".
  const status: StatusFollowup = isStatusFollowup(row.status_followup)
    ? row.status_followup
    : "novo";
  return {
    id: row.id,
    repasse_id: row.repasse_id,
    nome: row.nome,
    cidade_uf: row.cidade_uf,
    telefone_whatsapp: row.telefone_whatsapp,
    telefones_raw: row.telefones_raw,
    email: row.email,
    qtd_visualizacoes: normalizarQtd(row.qtd_visualizacoes),
    data_acesso: row.data_acesso,
    status_followup: status,
    observacao: row.observacao,
    data_contato: row.data_contato,
    criado_em: row.criado_em,
    atualizado_em: row.atualizado_em,
  };
}

// ─── QUERIES ─────────────────────────────────────────────────────────────────

/**
 * Conta interessados por status do funil. PURA — alimenta os KPIs da página
 * sem tocar no Supabase (testável). Sempre retorna todas as chaves (zerado).
 */
export function contarComStatus(
  lista: ReadonlyArray<RepasseInteressado>,
): Record<StatusFollowup, number> {
  const acc: Record<StatusFollowup, number> = {
    novo: 0,
    contatado: 0,
    respondeu: 0,
    negociando: 0,
    fechou: 0,
    perdido: 0,
  };
  for (const i of lista) acc[i.status_followup] += 1;
  return acc;
}

/** Lista os interessados de um repasse, mais visualizados primeiro. */
export async function listInteressados(repasseId: number): Promise<RepasseInteressado[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("repasse_interessados")
    .select("*")
    .eq("repasse_id", repasseId)
    .order("qtd_visualizacoes", { ascending: false })
    .order("id", { ascending: true });
  if (error) throw new Error(`Falha ao listar interessados: ${error.message}`);
  return ((data ?? []) as RepasseInteressadoRow[]).map(rowToInteressado);
}

export type CriarInteressadosResultado = {
  /** Quantos foram efetivamente inseridos (após ignorar duplicados). */
  inseridos: number;
  /** Quantos da lista enviada foram ignorados por já existirem (mesmo email). */
  ignorados: number;
  /** Rows criadas, prontas pra UI mesclar no estado. */
  criados: RepasseInteressado[];
};

/**
 * Cria interessados em lote a partir do parser.
 *
 * Usa upsert com `ignoreDuplicates: true` (ON CONFLICT DO NOTHING) no índice
 * único (repasse_id, email) — re-importar o mesmo lote não duplica leads.
 * Linhas sem email não colidem (índice é parcial: WHERE email IS NOT NULL),
 * então podem entrar mais de uma vez — é aceitável (o Marcos remove manual).
 *
 * Retorna contagem de inseridos x ignorados pra UI dar feedback.
 */
export async function criarInteressados(
  repasseId: number,
  lista: ReadonlyArray<InteressadoParsed>,
): Promise<CriarInteressadosResultado> {
  if (lista.length === 0) return { inseridos: 0, ignorados: 0, criados: [] };

  const sb = getSupabase();
  const payload = lista.map((i) => ({
    repasse_id: repasseId,
    nome: i.nome,
    cidade_uf: i.cidade_uf,
    telefone_whatsapp: i.telefone_whatsapp,
    telefones_raw: i.telefones_raw,
    email: i.email,
    qtd_visualizacoes: i.qtd_visualizacoes,
    data_acesso: i.data_acesso,
  }));

  const { data, error } = await sb
    .from("repasse_interessados")
    .upsert(payload, {
      onConflict: "repasse_id,email",
      ignoreDuplicates: true,
    })
    .select("*");
  if (error) throw new Error(`Falha ao importar interessados: ${error.message}`);

  const criados = ((data ?? []) as RepasseInteressadoRow[]).map(rowToInteressado);
  return {
    inseridos: criados.length,
    ignorados: lista.length - criados.length,
    criados,
  };
}

/** Patch parcial dos campos editáveis do interessado. */
export type InteressadoPatch = {
  status_followup?: StatusFollowup;
  observacao?: string | null;
  data_contato?: string | null;
};

/**
 * Atualiza campos do interessado (status / observação / data de contato).
 *
 * Defesa em profundidade: rejeita status fora do enum ANTES de mandar pro banco
 * (mesmo padrão de updateRepasseCampos). `observacao` vazia normaliza pra null.
 */
export async function updateInteressado(
  id: number,
  patch: InteressadoPatch,
): Promise<RepasseInteressado> {
  const update: Record<string, string | null> = {};

  if ("status_followup" in patch) {
    const v = patch.status_followup;
    if (!isStatusFollowup(v)) {
      throw new Error(`status_followup inválido: ${String(v)}`);
    }
    update.status_followup = v;
  }

  if ("observacao" in patch) {
    const v = patch.observacao;
    if (v !== null && typeof v !== "string") {
      throw new Error(`observacao inválido: ${typeof v}`);
    }
    update.observacao = v != null && v.trim() === "" ? null : v;
  }

  if ("data_contato" in patch) {
    const v = patch.data_contato;
    if (v !== null && typeof v !== "string") {
      throw new Error(`data_contato inválido: ${typeof v}`);
    }
    update.data_contato = v != null && v.trim() === "" ? null : v;
  }

  if (Object.keys(update).length === 0) {
    throw new Error("updateInteressado: patch vazio");
  }

  const sb = getSupabase();
  const { data, error } = await sb
    .from("repasse_interessados")
    .update(update)
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(`Falha ao atualizar interessado: ${error?.message ?? "sem dados"}`);
  }
  return rowToInteressado(data as RepasseInteressadoRow);
}

export async function deleteInteressado(id: number): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from("repasse_interessados").delete().eq("id", id);
  if (error) throw new Error(`Falha ao excluir interessado: ${error.message}`);
}

/**
 * Conta interessados por repasse → Map<repasse_id, count>. Alimenta o badge
 * "👥 Interessados (N)" no /repasses sem carregar todas as linhas.
 */
export async function contarInteressadosPorRepasse(): Promise<Map<number, number>> {
  const sb = getSupabase();
  const { data, error } = await sb.from("repasse_interessados").select("repasse_id");
  if (error) throw new Error(`Falha ao contar interessados: ${error.message}`);
  const m = new Map<number, number>();
  for (const row of (data ?? []) as Array<{ repasse_id: number }>) {
    m.set(row.repasse_id, (m.get(row.repasse_id) ?? 0) + 1);
  }
  return m;
}
