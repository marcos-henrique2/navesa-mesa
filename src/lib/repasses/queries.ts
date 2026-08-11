"use client";

/**
 * Queries Supabase do módulo de Repasses.
 *
 * Tudo client-side via o singleton getSupabase(). Erros são propagados como
 * Error — UI captura via try/catch e exibe toast.
 *
 * Schema: tabela `repasses` ainda tem colunas legacy (valor_subiu, doc_status,
 * gastos, etc.) — mantemos como zumbis. A UI usa snapshot do veículo + status +
 * datas + desfecho da venda (valor_vendido/data_vendido/comprador) + o trio da
 * margem de repasse (valor_compra_repasse/valor_minimo/valor_compre_por).
 * Todos os SELECT de row completa usam `*`, então o trio já vem do banco.
 *
 * Mapeamento legacy → novo:
 *   - `data_subiu` (legacy NOT NULL) → preenchido com hoje no INSERT, exposto
 *     como `data_marcado` no domínio
 *   - `data_subido` (nova coluna, migration 010) → null até "Já subi"
 */

import { getSupabase } from "@/lib/data/supabase";
import { hojeLocal } from "@/lib/utils/data-local";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";
import { buildChassisEmRepasseMap, type RepasseAtivoRow } from "./chassis-em-repasse";
import { criarErroRepasse } from "./erros";
import {
  isCautelarStatus,
  isDocStatus,
  isIpvaResponsavel,
  isIpvaStatus,
  type CautelarStatus,
  type DocStatus,
  type IpvaResponsavel,
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
export type RepasseRow = {
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
  valor_compra_repasse: number | string | null;
  valor_minimo: number | string | null;
  valor_compre_por: number | string | null;
  /** Colunas da migration 029 — podem vir ausentes se o banco estiver atrás. */
  valor_maior_oferta?: number | string | null;
  qtde_anuncios?: number | string | null;
  valor_subiu: number | null;
  data_subiu: string;
  data_subido: string | null;
  /** Coluna da migration 027 — pode vir ausente até a migration ser aplicada. */
  data_subido_aproximada?: boolean | null;
  canal: RepasseCanal;
  status: string;
  valor_vendido: number | string | null;
  data_vendido: string | null;
  comprador: string | null;
  ipva_status: string | null;
  ipva_responsavel: string | null;
  documentacao_status: string | null;
  cautelar_status_manual: string | null;
  valor_subir: number | string | null;
  observacoes: string | null;
  criado_em: string;
  atualizado_em: string;
};

/** Status válidos do domínio (espelha o CHECK constraint do banco). */
const STATUS_VALIDOS: ReadonlyArray<Repasse["status"]> = [
  "marcado",
  "subido",
  "vendido",
  "nao_vendido",
  "cancelado",
];

function isRepasseStatus(v: unknown): v is Repasse["status"] {
  return typeof v === "string" && (STATUS_VALIDOS as ReadonlyArray<string>).includes(v);
}

/** Normaliza NUMERIC do Supabase (pode vir como string) pra number finito | null. */
function normalizarNumeric(v: number | string | null): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

/** Contagem inteira do banco. Preserva o 0 (medição real) e recusa negativo. */
function normalizarInteiro(v: number | string | null): number | null {
  const n = normalizarNumeric(v);
  if (n == null || n < 0) return null;
  return Math.trunc(n);
}

export function rowToRepasse(row: RepasseRow): Repasse {
  // Os 5 status do ciclo são válidos. Fallback mínimo pra "marcado" só se vier
  // algo realmente inesperado (não deve ocorrer — banco tem CHECK constraint).
  const status: Repasse["status"] = isRepasseStatus(row.status) ? row.status : "marcado";

  // Status manuais: type guards rejeitam valor inesperado (vira null).
  // Defesa em profundidade — banco já tem CHECK constraint.
  const ipva = isIpvaStatus(row.ipva_status) ? row.ipva_status : null;
  const ipvaResponsavel = isIpvaResponsavel(row.ipva_responsavel) ? row.ipva_responsavel : null;
  const doc = isDocStatus(row.documentacao_status) ? row.documentacao_status : null;
  const cautelar = isCautelarStatus(row.cautelar_status_manual)
    ? row.cautelar_status_manual
    : null;

  // Supabase pode retornar NUMERIC como string em alguns casos — normaliza.
  const valorSubir = normalizarNumeric(row.valor_subir);

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
    // Trio da margem de repasse (regra de ouro em margem-repasse.ts): custo-base
    // B2B + piso + teto do anúncio. NUMERIC pode vir como string do Supabase.
    valor_compra_repasse: normalizarNumeric(row.valor_compra_repasse),
    valor_minimo: normalizarNumeric(row.valor_minimo),
    valor_compre_por: normalizarNumeric(row.valor_compre_por),
    // Sinais de MERCADO do arquivo do Auto Avaliar (029) — fora de qualquer
    // fórmula de custo. `qtde_anuncios` é contagem: 0 é medição real, não nulo.
    valor_maior_oferta: normalizarNumeric(row.valor_maior_oferta ?? null),
    qtde_anuncios: normalizarInteiro(row.qtde_anuncios ?? null),
    preco_atual: row.valor_subiu, // reusa coluna legacy como "preço atual do estoque no momento da marcação"
    data_marcado: row.data_subiu,
    data_subido: row.data_subido,
    // `=== true` porque a coluna só existe a partir da 027: antes disso vem
    // undefined, e undefined não pode virar "data aproximada".
    data_subido_aproximada: row.data_subido_aproximada === true,
    canal: row.canal,
    status,
    valor_vendido: normalizarNumeric(row.valor_vendido),
    data_vendido: row.data_vendido,
    comprador: row.comprador,
    ipva_status: ipva,
    ipva_responsavel: ipvaResponsavel,
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

/** Busca um repasse por id. Retorna null se não existir. */
export async function getRepasse(id: number): Promise<Repasse | null> {
  const sb = getSupabase();
  const { data, error } = await sb.from("repasses").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`Falha ao buscar repasse: ${error.message}`);
  return data ? rowToRepasse(data as RepasseRow) : null;
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
  // Data LOCAL: `data_subido` é um dia do calendário do Marcos, não um instante
  // UTC. Marcar às 22h de Brasília gravava amanhã com toISOString().
  const hoje = hojeLocal();
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
  const hoje = hojeLocal();
  const { data, error } = await sb
    .from("repasses")
    .update({ status: "subido", data_subido: hoje })
    .in("id", [...ids])
    .eq("status", "marcado")
    .select("id");
  if (error) throw new Error(`Falha ao marcar como subidos: ${error.message}`);
  return (data ?? []).length;
}

// ─── Gastos (base da margem de repasse) ──────────────────────────────────────

/**
 * Map repasse_id → lista de valores de `repasse_gastos`.
 *
 * Alimenta `calcularCustoReal(valor_compra_repasse, gastos)` — a REGRA DE OURO
 * de `margem-repasse.ts`. Ids sem gasto simplesmente não aparecem no Map (caller
 * usa `?? []`). Valores não-numéricos são ignorados.
 */
export async function listGastosPorRepasse(
  ids: ReadonlyArray<number>,
): Promise<Map<number, number[]>> {
  const m = new Map<number, number[]>();
  if (ids.length === 0) return m;
  const sb = getSupabase();
  const { data, error } = await sb
    .from("repasse_gastos")
    .select("repasse_id, valor")
    .in("repasse_id", [...ids]);
  if (error) throw new Error(`Falha ao carregar gastos de repasse: ${error.message}`);
  for (const row of (data ?? []) as Array<{ repasse_id: number; valor: number | string | null }>) {
    const v = normalizarNumeric(row.valor);
    if (v == null) continue;
    const arr = m.get(row.repasse_id) ?? [];
    arr.push(v);
    m.set(row.repasse_id, arr);
  }
  return m;
}

// ─── Desfecho da venda (vendido / não vendido) ───────────────────────────────

export type MarcarVendidoInput = {
  valor_vendido: number;
  data_vendido?: string;
  comprador?: string | null;
};

/**
 * Valida o valor de venda. Lança Error com mensagem clara se inválido.
 * Pura — testável sem tocar no Supabase.
 */
export function validarValorVendido(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
    throw new Error(`valor_vendido inválido: ${String(v)}`);
  }
  return v;
}

/**
 * Monta a observação final ao marcar como não vendido.
 * Pura — anexa o motivo (trimado) à observação atual (se houver), preservando-a.
 * Retorna `undefined` quando não há motivo → caller não toca em observacoes.
 */
export function montarObservacaoNaoVendido(
  obsAtual: string | null | undefined,
  motivo: string | null | undefined,
): string | undefined {
  const m = motivo?.trim();
  if (!m) return undefined;
  const atual = obsAtual?.trim();
  return atual ? `${atual} | ${m}` : m;
}

/** Payload de UPDATE pra reverter um repasse pra "subido" (zera campos de venda). */
export const PAYLOAD_REVERTER_SUBIDO = {
  status: "subido",
  valor_vendido: null,
  data_vendido: null,
  comprador: null,
} as const;

/**
 * Marca como "vendido" registrando valor, data e comprador.
 *
 * `valor_vendido` precisa ser number finito ≥ 0. `data_vendido` default = hoje.
 * `comprador` é trimado; vazio vira null.
 */
export async function marcarComoVendido(
  id: number,
  input: MarcarVendidoInput,
): Promise<Repasse> {
  const valor = validarValorVendido(input.valor_vendido);
  const data = input.data_vendido ?? hojeLocal();
  const compradorTrim = input.comprador?.trim();
  const comprador = compradorTrim ? compradorTrim : null;

  const sb = getSupabase();
  const { data: row, error } = await sb
    .from("repasses")
    .update({
      status: "vendido",
      valor_vendido: valor,
      data_vendido: data,
      comprador,
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error || !row) {
    throw new Error(`Falha ao marcar como vendido: ${error?.message ?? "sem dados"}`);
  }
  return rowToRepasse(row as RepasseRow);
}

/**
 * Marca como "nao_vendido". Se `motivo` não vazio, anexa às observações
 * existentes (preserva o que já estava lá). Se vazio/ausente, não toca observacoes.
 */
export async function marcarComoNaoVendido(
  id: number,
  input?: { motivo?: string | null },
): Promise<Repasse> {
  const sb = getSupabase();
  const motivo = input?.motivo?.trim();

  const update: Record<string, string | null> = { status: "nao_vendido" };

  if (motivo) {
    // Busca observação atual pra concatenar sem perder o que já existe.
    const { data: atual, error: errSel } = await sb
      .from("repasses")
      .select("observacoes")
      .eq("id", id)
      .single();
    if (errSel) {
      throw new Error(`Falha ao ler observações: ${errSel.message}`);
    }
    const obsAtual = (atual as { observacoes: string | null } | null)?.observacoes;
    const obsFinal = montarObservacaoNaoVendido(obsAtual, motivo);
    if (obsFinal !== undefined) update.observacoes = obsFinal;
  }

  const { data: row, error } = await sb
    .from("repasses")
    .update(update)
    .eq("id", id)
    .select("*")
    .single();
  if (error || !row) {
    throw new Error(`Falha ao marcar como não vendido: ${error?.message ?? "sem dados"}`);
  }
  return rowToRepasse(row as RepasseRow);
}

/**
 * Reabre um repasse com desfecho de volta pra "subido", zerando os campos de
 * venda. Não mexe em observacoes (histórico preservado).
 */
export async function reverterParaSubido(id: number): Promise<Repasse> {
  const sb = getSupabase();
  const { data: row, error } = await sb
    .from("repasses")
    .update(PAYLOAD_REVERTER_SUBIDO)
    .eq("id", id)
    .select("*")
    .single();
  if (error || !row) {
    throw new Error(`Falha ao reabrir repasse: ${error?.message ?? "sem dados"}`);
  }
  return rowToRepasse(row as RepasseRow);
}

// ─── Inline edit dos campos manuais (Caminho B) ──────────────────────────────

/** Patch parcial pros campos manuais. Campos omitidos não são tocados. */
export type RepasseCamposManuaisPatch = {
  ipva_status?: IpvaStatus | null;
  ipva_responsavel?: IpvaResponsavel | null;
  documentacao_status?: DocStatus | null;
  cautelar_status_manual?: CautelarStatus | null;
  valor_subir?: number | null;
  observacoes?: string | null;
};

/**
 * Atualiza um ou mais dos campos manuais inline.
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
  const update: Record<
    string,
    IpvaStatus | IpvaResponsavel | DocStatus | CautelarStatus | number | string | null
  > = {};

  if ("ipva_status" in patch) {
    const v = patch.ipva_status;
    if (v !== null && !isIpvaStatus(v)) {
      throw new Error(`ipva_status inválido: ${String(v)}`);
    }
    update.ipva_status = v;
  }

  if ("ipva_responsavel" in patch) {
    const v = patch.ipva_responsavel;
    if (v !== null && !isIpvaResponsavel(v)) {
      throw new Error(`ipva_responsavel inválido: ${String(v)}`);
    }
    update.ipva_responsavel = v;
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
