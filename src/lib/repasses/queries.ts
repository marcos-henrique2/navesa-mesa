"use client";

/**
 * Queries Supabase do módulo de Repasses.
 *
 * Tudo client-side via o singleton getSupabase(). Erros são propagados como
 * Error — UI captura via try/catch e exibe toast.
 */

import { getSupabase, selectAll } from "@/lib/data/supabase";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";
import { DOCUMENTOS_PADRAO } from "./types";
import type {
  Repasse,
  RepasseGasto,
  RepasseDocumento,
  RepasseStatus,
  DocStatus,
  RepasseCanal,
  GastoTipo,
  DocumentoTipo,
} from "./types";

// ─── REPASSES ────────────────────────────────────────────────────────────────

export type RepasseInput = {
  chassi: string;
  placa: string;
  modelo: string;
  marca: string | null;
  cor: string | null;
  ano_modelo: number | null;
  ano_fabricacao: number | null;
  km: number | null;
  loja_origem: number | null;
  patio_origem: string | null;
  valor_aquisicao: number | null;
  valor_subiu: number | null;
  valor_minimo: number | null;
  canal?: RepasseCanal;
};

/** Lista todos os repasses, mais recentes primeiro. */
export async function listRepasses(): Promise<Repasse[]> {
  const sb = getSupabase();
  return selectAll<Repasse>(sb, "repasses", { orderBy: "id" }).then((rows) =>
    [...rows].sort((a, b) => b.id - a.id),
  );
}

export async function getRepasse(id: number): Promise<Repasse | null> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("repasses")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Falha ao ler repasse: ${error.message}`);
  return (data as Repasse | null) ?? null;
}

/**
 * Cria um repasse a partir de um snapshot de veículo + valores iniciais.
 * Já cria os 5 documentos padrão como "pendente".
 */
export async function createRepasse(input: RepasseInput): Promise<Repasse> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("repasses")
    .insert({
      chassi: input.chassi,
      placa: input.placa,
      modelo: input.modelo,
      marca: input.marca,
      cor: input.cor,
      ano_modelo: input.ano_modelo,
      ano_fabricacao: input.ano_fabricacao,
      km: input.km,
      loja_origem: input.loja_origem,
      patio_origem: input.patio_origem,
      valor_aquisicao: input.valor_aquisicao,
      valor_subiu: input.valor_subiu,
      valor_minimo: input.valor_minimo,
      canal: input.canal ?? "auto_avaliar",
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`Falha ao criar repasse: ${error?.message ?? "sem dados"}`);

  const repasse = data as Repasse;

  // Cria checklist padrão (best-effort — se falhar, ainda assim retornamos o repasse criado)
  try {
    await sb.from("repasse_documentos").insert(
      DOCUMENTOS_PADRAO.map((tipo) => ({
        repasse_id: repasse.id,
        tipo,
        status: "pendente" as DocStatus,
      })),
    );
  } catch {
    // checklist falhou — usuário pode adicionar manualmente depois
  }

  return repasse;
}

export type RepassePatch = Partial<
  Pick<
    Repasse,
    | "valor_subiu"
    | "valor_minimo"
    | "valor_vendido"
    | "data_vendido"
    | "canal"
    | "status"
    | "documentacao_status"
    | "descricao"
    | "opcionais"
    | "comprador"
    | "observacoes"
  >
>;

export async function updateRepasse(id: number, patch: RepassePatch): Promise<Repasse> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("repasses")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) throw new Error(`Falha ao atualizar repasse: ${error?.message ?? "sem dados"}`);
  return data as Repasse;
}

export async function deleteRepasse(id: number): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from("repasses").delete().eq("id", id);
  if (error) throw new Error(`Falha ao excluir repasse: ${error.message}`);
}

/**
 * Marca como vendido (atualiza status + valor + data + comprador num único update).
 * `data_vendido` default = hoje.
 */
export async function marcarVendido(
  id: number,
  payload: { valor_vendido: number; data_vendido?: string; comprador?: string | null },
): Promise<Repasse> {
  return updateRepasse(id, {
    status: "vendido",
    valor_vendido: payload.valor_vendido,
    data_vendido: payload.data_vendido ?? new Date().toISOString().slice(0, 10),
    comprador: payload.comprador ?? null,
  });
}

export async function marcarNaoVendido(id: number, motivo: string): Promise<Repasse> {
  return updateRepasse(id, {
    status: "nao_vendido",
    observacoes: motivo,
  });
}

// ─── GASTOS ──────────────────────────────────────────────────────────────────

export async function listGastos(repasseId: number): Promise<RepasseGasto[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("repasse_gastos")
    .select("*")
    .eq("repasse_id", repasseId)
    .order("data", { ascending: true });
  if (error) throw new Error(`Falha ao ler gastos: ${error.message}`);
  return (data ?? []) as RepasseGasto[];
}

export type GastoInput = {
  tipo: GastoTipo;
  descricao: string;
  valor: number;
  data: string;
  observacao?: string | null;
};

export async function addGasto(repasseId: number, input: GastoInput): Promise<RepasseGasto> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("repasse_gastos")
    .insert({
      repasse_id: repasseId,
      tipo: input.tipo,
      descricao: input.descricao,
      valor: input.valor,
      data: input.data,
      observacao: input.observacao ?? null,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`Falha ao adicionar gasto: ${error?.message ?? "sem dados"}`);
  return data as RepasseGasto;
}

export async function removeGasto(gastoId: number): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from("repasse_gastos").delete().eq("id", gastoId);
  if (error) throw new Error(`Falha ao remover gasto: ${error.message}`);
}

// ─── DOCUMENTOS ──────────────────────────────────────────────────────────────

export async function listDocumentos(repasseId: number): Promise<RepasseDocumento[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("repasse_documentos")
    .select("*")
    .eq("repasse_id", repasseId);
  if (error) throw new Error(`Falha ao ler documentos: ${error.message}`);
  return (data ?? []) as RepasseDocumento[];
}

export async function upsertDocumento(
  repasseId: number,
  tipo: DocumentoTipo,
  patch: { status: DocStatus; observacao?: string | null; data_verificacao?: string | null },
): Promise<RepasseDocumento> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("repasse_documentos")
    .upsert(
      {
        repasse_id: repasseId,
        tipo,
        status: patch.status,
        observacao: patch.observacao ?? null,
        data_verificacao: patch.data_verificacao ?? null,
      },
      { onConflict: "repasse_id,tipo" },
    )
    .select("*")
    .single();
  if (error || !data) throw new Error(`Falha ao atualizar documento: ${error?.message ?? "sem dados"}`);
  return data as RepasseDocumento;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/**
 * Constrói um RepasseInput a partir de um VeiculoParsed do estoque.
 * Centraliza a cópia de campos pra evitar divergência entre callers.
 */
export function snapshotFromVeiculo(
  v: VeiculoParsed,
  valores: { valor_subiu: number | null; valor_minimo: number | null; canal?: RepasseCanal },
): RepasseInput {
  return {
    chassi: v.chassi,
    placa: v.placa,
    modelo: v.modelo,
    marca: v.marca,
    cor: v.cor_externa,
    ano_modelo: v.ano_modelo,
    ano_fabricacao: v.ano_fabricacao,
    km: v.km,
    loja_origem: v.cod_empresa,
    patio_origem: v.patio,
    valor_aquisicao: v.valor_aquisicao,
    valor_subiu: valores.valor_subiu,
    valor_minimo: valores.valor_minimo,
    canal: valores.canal,
  };
}

export type StatusFilter = "all" | RepasseStatus;
