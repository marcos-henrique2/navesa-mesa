"use client";

/**
 * CRM de Leads — contato único (a pessoa, não o carro).
 *
 * Um lead pode ter N interesses (carros). Esta camada cuida do contato em si:
 * dados de contato, status do relacionamento e observação. Os carros de
 * interesse ficam em `lead_interesses` (ver interesses.ts).
 *
 * Tudo client-side via o singleton getSupabase(). Erros propagam como Error —
 * UI captura via try/catch e exibe toast (mesmo padrão de queries.ts).
 *
 * Tabela `leads` (migration 018). NUMERIC/INTEGER do Supabase pode vir como
 * string em alguns casos — normalizamos onde aplicável.
 */

import { getSupabase } from "@/lib/data/supabase";

// ─── TIPOS ───────────────────────────────────────────────────────────────────

/** Status do relacionamento com o lead (funil de vendas). */
export type StatusRelacionamento =
  | "novo"
  | "contatado"
  | "respondeu"
  | "negociando"
  | "fechou"
  | "perdido";

export type Lead = {
  id: number;
  nome: string;
  cidade_uf: string | null;
  telefone_whatsapp: string | null;
  telefones_raw: string | null;
  email: string | null;
  email_norm: string | null;
  status_relacionamento: StatusRelacionamento;
  observacao: string | null;
  legacy_interessado_id: number | null;
  criado_em: string; // ISO
  atualizado_em: string; // ISO
};

/** Lead + contagem de carros de interesse (pra lista central). */
export type LeadComInteresses = Lead & {
  qtd_interesses: number;
};

/** Row crua do banco antes do mapeamento pro domínio. */
type LeadRow = {
  id: number;
  nome: string;
  cidade_uf: string | null;
  telefone_whatsapp: string | null;
  telefones_raw: string | null;
  email: string | null;
  email_norm: string | null;
  status_relacionamento: string;
  observacao: string | null;
  legacy_interessado_id: number | string | null;
  criado_em: string;
  atualizado_em: string;
};

// ─── Status: valores, labels pt-BR e ordem do funil ──────────────────────────

/** Ordem do funil — usada nos KPIs e no dropdown inline. */
export const STATUS_RELACIONAMENTO_VALUES: ReadonlyArray<StatusRelacionamento> = [
  "novo",
  "contatado",
  "respondeu",
  "negociando",
  "fechou",
  "perdido",
];

export const STATUS_RELACIONAMENTO_LABEL: Record<StatusRelacionamento, string> = {
  novo: "Novo",
  contatado: "Contatado",
  respondeu: "Respondeu",
  negociando: "Negociando",
  fechou: "Fechou",
  perdido: "Perdido",
};

export function isStatusRelacionamento(v: unknown): v is StatusRelacionamento {
  return (
    typeof v === "string" &&
    (STATUS_RELACIONAMENTO_VALUES as ReadonlyArray<string>).includes(v)
  );
}

/** Normaliza bigint do Supabase (pode vir como string) pra number | null. */
function normalizarBigint(v: number | string | null): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

function rowToLead(row: LeadRow): Lead {
  // CHECK constraint no banco garante o enum; fallback defensivo pra "novo".
  const status: StatusRelacionamento = isStatusRelacionamento(row.status_relacionamento)
    ? row.status_relacionamento
    : "novo";
  return {
    id: row.id,
    nome: row.nome,
    cidade_uf: row.cidade_uf,
    telefone_whatsapp: row.telefone_whatsapp,
    telefones_raw: row.telefones_raw,
    email: row.email,
    email_norm: row.email_norm,
    status_relacionamento: status,
    observacao: row.observacao,
    legacy_interessado_id: normalizarBigint(row.legacy_interessado_id),
    criado_em: row.criado_em,
    atualizado_em: row.atualizado_em,
  };
}

// ─── KPIs (puro) ─────────────────────────────────────────────────────────────

/**
 * Conta leads por status do funil. PURA — alimenta os KPIs da página sem tocar
 * no Supabase (testável). Sempre retorna todas as chaves (zerado).
 */
export function contarComStatusRelacionamento(
  lista: ReadonlyArray<Pick<Lead, "status_relacionamento">>,
): Record<StatusRelacionamento, number> {
  const acc: Record<StatusRelacionamento, number> = {
    novo: 0,
    contatado: 0,
    respondeu: 0,
    negociando: 0,
    fechou: 0,
    perdido: 0,
  };
  for (const l of lista) acc[l.status_relacionamento] += 1;
  return acc;
}

// ─── QUERIES ─────────────────────────────────────────────────────────────────

/**
 * Lista todos os leads com a contagem de carros de interesse.
 *
 * Faz 2 queries (leads + agregação de lead_interesses) e cruza em memória —
 * o Supabase JS não expõe COUNT agrupado de forma simples sem RPC, e a base de
 * leads é pequena (centenas). Ordena por mais recente primeiro; a UI re-ordena.
 */
export async function listLeads(): Promise<LeadComInteresses[]> {
  const sb = getSupabase();

  const [leadsRes, interessesRes] = await Promise.all([
    sb.from("leads").select("*").order("criado_em", { ascending: false }),
    sb.from("lead_interesses").select("lead_id"),
  ]);

  if (leadsRes.error) throw new Error(`Falha ao listar leads: ${leadsRes.error.message}`);
  if (interessesRes.error) {
    throw new Error(`Falha ao contar interesses: ${interessesRes.error.message}`);
  }

  const contagem = new Map<number, number>();
  for (const row of (interessesRes.data ?? []) as Array<{ lead_id: number }>) {
    contagem.set(row.lead_id, (contagem.get(row.lead_id) ?? 0) + 1);
  }

  return ((leadsRes.data ?? []) as LeadRow[]).map((row) => ({
    ...rowToLead(row),
    qtd_interesses: contagem.get(row.id) ?? 0,
  }));
}

/** Busca um lead por id. Retorna null se não existir. */
export async function getLead(id: number): Promise<Lead | null> {
  const sb = getSupabase();
  const { data, error } = await sb.from("leads").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`Falha ao buscar lead: ${error.message}`);
  return data ? rowToLead(data as LeadRow) : null;
}

/** Patch parcial dos campos editáveis do lead. */
export type LeadPatch = {
  status_relacionamento?: StatusRelacionamento;
  observacao?: string | null;
};

/**
 * Atualiza campos do lead (status do relacionamento / observação).
 *
 * Defesa em profundidade: rejeita status fora do enum ANTES de mandar pro banco
 * (mesmo padrão de updateRepasseCampos). `observacao` vazia normaliza pra null.
 */
export async function updateLead(id: number, patch: LeadPatch): Promise<Lead> {
  const update: Record<string, string | null> = {};

  if ("status_relacionamento" in patch) {
    const v = patch.status_relacionamento;
    if (!isStatusRelacionamento(v)) {
      throw new Error(`status_relacionamento inválido: ${String(v)}`);
    }
    update.status_relacionamento = v;
  }

  if ("observacao" in patch) {
    const v = patch.observacao;
    if (v !== null && typeof v !== "string") {
      throw new Error(`observacao inválido: ${typeof v}`);
    }
    update.observacao = v != null && v.trim() === "" ? null : v;
  }

  if (Object.keys(update).length === 0) {
    throw new Error("updateLead: patch vazio");
  }

  const sb = getSupabase();
  const { data, error } = await sb
    .from("leads")
    .update(update)
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(`Falha ao atualizar lead: ${error?.message ?? "sem dados"}`);
  }
  return rowToLead(data as LeadRow);
}

/**
 * Conta leads por status do relacionamento → KPIs da aba Leads.
 *
 * Lê só a coluna `status_relacionamento` (leve) e agrega com a função pura.
 */
export async function contarLeadsPorStatus(): Promise<Record<StatusRelacionamento, number>> {
  const sb = getSupabase();
  const { data, error } = await sb.from("leads").select("status_relacionamento");
  if (error) throw new Error(`Falha ao contar leads: ${error.message}`);
  const lista = ((data ?? []) as Array<{ status_relacionamento: string }>).map((row) => ({
    status_relacionamento: isStatusRelacionamento(row.status_relacionamento)
      ? row.status_relacionamento
      : ("novo" as StatusRelacionamento),
  }));
  return contarComStatusRelacionamento(lista);
}
