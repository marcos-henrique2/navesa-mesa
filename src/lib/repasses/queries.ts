"use client";

/**
 * Queries Supabase do módulo de Repasses.
 *
 * Tudo client-side via o singleton getSupabase(). Erros são propagados como
 * Error — UI captura via try/catch e exibe toast.
 *
 * Schema: tabela `repasses` ainda tem colunas legacy (valor_subiu, valor_minimo,
 * valor_vendido, doc_status, gastos, etc.) — mantemos como zumbis. A UI nova
 * só usa snapshot do veículo + status + datas.
 *
 * Mapeamento legacy → novo:
 *   - `data_subiu` (legacy NOT NULL) → preenchido com hoje no INSERT, exposto
 *     como `data_marcado` no domínio
 *   - `data_subido` (nova coluna, migration 010) → null até "Já subi"
 */

import { getSupabase } from "@/lib/data/supabase";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";
import { buildChassisEmRepasseMap, type RepasseAtivoRow } from "./chassis-em-repasse";
import { criarErroRepasse } from "./erros";
import {
  isCautelarStatus,
  isDocStatus,
  isIpvaStatus,
  type CautelarStatus,
  type DocStatus,
  type IpvaStatus,
  type Repasse,
  type RepasseCanal,
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
  preco_atual: number | null;
  canal?: RepasseCanal;
};

/**
 * Row crua do banco antes do mapeamento pro domínio.
 * `data_subiu` é o campo legacy (NOT NULL com default `current_date`) —
 * reaproveitado como "data marcado pra subir" no novo fluxo.
 */
type RepasseRow = {
  id: number;
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
  data_subiu: string;
  data_subido: string | null;
  canal: RepasseCanal;
  status: string;
  ipva_status: string | null;
  documentacao_status: string | null;
  cautelar_status_manual: string | null;
  valor_subir: number | string | null;
  observacoes: string | null;
  criado_em: string;
  atualizado_em: string;
};

function rowToRepasse(row: RepasseRow): Repasse {
  // Status legacy ("vendido", "nao_vendido") aparecerão como "marcado" pra UI
  // nova — defensivo, não deve ocorrer na prática (UI nunca cria esses).
  const status =
    row.status === "marcado" || row.status === "subido" || row.status === "cancelado"
      ? row.status
      : "marcado";

  // Status manuais: type guards rejeitam valor inesperado (vira null).
  // Defesa em profundidade — banco já tem CHECK constraint.
  const ipva = isIpvaStatus(row.ipva_status) ? row.ipva_status : null;
  const doc = isDocStatus(row.documentacao_status) ? row.documentacao_status : null;
  const cautelar = isCautelarStatus(row.cautelar_status_manual)
    ? row.cautelar_status_manual
    : null;

  // Supabase pode retornar NUMERIC como string em alguns casos — normaliza.
  const valorSubir =
    row.valor_subir == null
      ? null
      : typeof row.valor_subir === "string"
        ? Number(row.valor_subir)
        : row.valor_subir;

  return {
    id: row.id,
    chassi: row.chassi,
    placa: row.placa,
    modelo: row.modelo,
    marca: row.marca,
    cor: row.cor,
    ano_modelo: row.ano_modelo,
    ano_fabricacao: row.ano_fabricacao,
    km: row.km,
    loja_origem: row.loja_origem,
    patio_origem: row.patio_origem,
    valor_aquisicao: row.valor_aquisicao,
    preco_atual: row.valor_subiu, // reusa coluna legacy como "preço atual do estoque no momento da marcação"
    data_marcado: row.data_subiu,
    data_subido: row.data_subido,
    canal: row.canal,
    status,
    ipva_status: ipva,
    documentacao_status: doc,
    cautelar_status_manual: cautelar,
    valor_subir: valorSubir != null && Number.isFinite(valorSubir) ? valorSubir : null,
    observacoes: row.observacoes,
    criado_em: row.criado_em,
    atualizado_em: row.atualizado_em,
  };
}

/** Lista todos os repasses, mais recentes primeiro. */
export async function listRepasses(): Promise<Repasse[]> {
  const sb = getSupabase();
  const { data, error } = await sb.from("repasses").select("*").order("id", { ascending: false });
  if (error) throw new Error(`Falha ao listar repasses: ${error.message}`);
  return ((data ?? []) as RepasseRow[]).map(rowToRepasse);
}

/**
 * Lista os chassis com repasse em andamento (status='marcado' OU 'subido').
 * Retorna Map<chassi, repasse_id> pra UI saber quais carros já estão em fluxo
 * de repasse e desabilitar o botão "Marcar pra subir" no estoque.
 */
export async function listChassisEmRepasse(): Promise<Map<string, number>> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("repasses")
    .select("id, chassi")
    .in("status", ["marcado", "subido"]);
  if (error) throw new Error(`Falha ao listar chassis em repasse: ${error.message}`);
  return buildChassisEmRepasseMap((data ?? []) as ReadonlyArray<RepasseAtivoRow>);
}

/**
 * Cria um repasse a partir de um snapshot de veículo.
 *
 * Status inicial = "marcado". `data_subido` fica null até o usuário clicar
 * em "Já subi" no /repasses.
 *
 * O snapshot grava o preço de venda atual do estoque (`preco_atual`) na coluna
 * legacy `valor_subiu` — é só registro histórico, não tem cálculo em cima.
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
      valor_subiu: input.preco_atual,
      canal: input.canal ?? "auto_avaliar",
      status: "marcado",
    })
    .select("*")
    .single();
  if (error || !data) throw criarErroRepasse(error);
  return rowToRepasse(data as RepasseRow);
}

/** Marca como "subido" (já foi enviado pro Auto Avaliar). */
export async function marcarComoSubido(id: number): Promise<Repasse> {
  const sb = getSupabase();
  const hoje = new Date().toISOString().slice(0, 10);
  const { data, error } = await sb
    .from("repasses")
    .update({ status: "subido", data_subido: hoje })
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) throw new Error(`Falha ao marcar como subido: ${error?.message ?? "sem dados"}`);
  return rowToRepasse(data as RepasseRow);
}

/**
 * Marca em lote como "subido". Retorna número de atualizados.
 *
 * Filtra por `status='marcado'` (defesa em profundidade) pra não sobrescrever
 * `data_subido` de rows que já estão "subido" — caso a UI passe ids fora do
 * filtro por algum bug.
 */
export async function marcarVariosComoSubido(ids: ReadonlyArray<number>): Promise<number> {
  if (ids.length === 0) return 0;
  const sb = getSupabase();
  const hoje = new Date().toISOString().slice(0, 10);
  const { data, error } = await sb
    .from("repasses")
    .update({ status: "subido", data_subido: hoje })
    .in("id", [...ids])
    .eq("status", "marcado")
    .select("id");
  if (error) throw new Error(`Falha ao marcar como subidos: ${error.message}`);
  return (data ?? []).length;
}

// ─── Inline edit dos campos manuais (Caminho B) ──────────────────────────────

/** Patch parcial pros 5 campos manuais. Campos omitidos não são tocados. */
export type RepasseCamposManuaisPatch = {
  ipva_status?: IpvaStatus | null;
  documentacao_status?: DocStatus | null;
  cautelar_status_manual?: CautelarStatus | null;
  valor_subir?: number | null;
  observacoes?: string | null;
};

/**
 * Atualiza um ou mais dos 5 campos manuais inline.
 *
 * Defesa em profundidade: rejeita valores fora do enum ANTES de mandar pro
 * banco. O CHECK constraint já bloqueia, mas validar aqui dá erro mais claro
 * pra UI (não chega no Supabase).
 *
 * `valor_subir` aceita number finito ou null. Negativo é rejeitado (não faz
 * sentido pra preço).
 *
 * `observacoes` aceita qualquer string (incluindo vazia, que normaliza pra null).
 */
export async function updateRepasseCampos(
  id: number,
  patch: RepasseCamposManuaisPatch,
): Promise<Repasse> {
  // Monta o update só com os campos presentes no patch.
  const update: Record<string, IpvaStatus | DocStatus | CautelarStatus | number | string | null> = {};

  if ("ipva_status" in patch) {
    const v = patch.ipva_status;
    if (v !== null && !isIpvaStatus(v)) {
      throw new Error(`ipva_status inválido: ${String(v)}`);
    }
    update.ipva_status = v;
  }

  if ("documentacao_status" in patch) {
    const v = patch.documentacao_status;
    if (v !== null && !isDocStatus(v)) {
      throw new Error(`documentacao_status inválido: ${String(v)}`);
    }
    update.documentacao_status = v;
  }

  if ("cautelar_status_manual" in patch) {
    const v = patch.cautelar_status_manual;
    if (v !== null && !isCautelarStatus(v)) {
      throw new Error(`cautelar_status_manual inválido: ${String(v)}`);
    }
    update.cautelar_status_manual = v;
  }

  if ("valor_subir" in patch) {
    const v = patch.valor_subir;
    if (v !== null) {
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
        throw new Error(`valor_subir inválido: ${String(v)}`);
      }
    }
    update.valor_subir = v;
  }

  if ("observacoes" in patch) {
    const v = patch.observacoes;
    if (v !== null && typeof v !== "string") {
      throw new Error(`observacoes inválido: ${typeof v}`);
    }
    // String vazia vira null pra consistência.
    update.observacoes = v != null && v.trim() === "" ? null : v;
  }

  if (Object.keys(update).length === 0) {
    throw new Error("updateRepasseCampos: patch vazio");
  }

  const sb = getSupabase();
  const { data, error } = await sb
    .from("repasses")
    .update(update)
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(`Falha ao atualizar campos: ${error?.message ?? "sem dados"}`);
  }
  return rowToRepasse(data as RepasseRow);
}

export async function deleteRepasse(id: number): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from("repasses").delete().eq("id", id);
  if (error) throw new Error(`Falha ao excluir repasse: ${error.message}`);
}

export async function deleteRepasses(ids: ReadonlyArray<number>): Promise<number> {
  if (ids.length === 0) return 0;
  const sb = getSupabase();
  const { data, error } = await sb
    .from("repasses")
    .delete()
    .in("id", [...ids])
    .select("id");
  if (error) throw new Error(`Falha ao excluir repasses: ${error.message}`);
  return (data ?? []).length;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/**
 * Constrói um RepasseInput a partir de um VeiculoParsed do estoque.
 * Centraliza a cópia de campos pra evitar divergência entre callers.
 *
 * `preco_atual` = preco_venda do estoque no momento da marcação (snapshot).
 */
export function snapshotFromVeiculo(
  v: VeiculoParsed,
  opts?: { canal?: RepasseCanal },
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
    preco_atual: v.preco_venda,
    canal: opts?.canal,
  };
}
