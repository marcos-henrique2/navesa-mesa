"use client";

/**
 * Vínculo lead ↔ carro de interesse (tabela `lead_interesses`, migration 018).
 *
 * Cada linha liga um lead a UM carro — de repasse (repasse_id) OU de estoque
 * (chassi). A origem distingue se o lead VISUALIZOU o anúncio (importado do
 * Auto Avaliar) ou se o carro foi OFERTADO pelo Marcos.
 *
 * Tudo client-side via o singleton getSupabase(). Erros propagam como Error.
 *
 * Constraints do banco (migration 033 relaxou o ramo 'repasse'):
 *   - repasse → chassi NULL; repasse_id preenchido OU NULL (carro removido)
 *   - estoque → chassi preenchido + repasse_id NULL
 *   - dedup unique (lead_id, repasse_id) e (lead_id, chassi)
 *
 * INTERESSE ÓRFÃO: a FK `repasse_id -> repasses(id)` é ON DELETE SET NULL. Quando
 * o Marcos remove um repasse, os interesses daquele carro sobrevivem com
 * `tipo_carro='repasse'` e `repasse_id NULL` — o histórico de quem procurou o
 * carro é escasso demais pra ser apagado como efeito colateral. `modelo_snapshot`
 * é NOT NULL e continua dizendo QUAL carro era. Ver `referenciaCarro`.
 */

import { getSupabase } from "@/lib/data/supabase";
import { parseInteressados } from "@/lib/repasses/parse-interessados";
import {
  isStatusRelacionamento,
  type StatusRelacionamento,
} from "./leads";

// ─── TIPOS ───────────────────────────────────────────────────────────────────

/** Status do follow-up — mesmo enum do relacionamento do lead. */
export type StatusFollowup = StatusRelacionamento;

/** Como o carro entrou na lista de interesses do lead. */
export type Origem = "visualizou" | "oferta";

/** Fonte do carro: repasse ativo ou item do estoque. */
export type TipoCarro = "repasse" | "estoque";

export type LeadInteresse = {
  id: number;
  lead_id: number;
  repasse_id: number | null;
  chassi: string | null;
  modelo_snapshot: string;
  tipo_carro: TipoCarro;
  origem: Origem;
  qtd_visualizacoes: number;
  data_acesso: string | null;
  status_followup: StatusFollowup;
  data_contato: string | null; // YYYY-MM-DD | null
  observacao: string | null;
  criado_em: string; // ISO
  atualizado_em: string; // ISO
};

/** LeadInteresse + dados do lead (join) — pra página de interessados por carro. */
export type LeadInteresseComLead = LeadInteresse & {
  lead_nome: string;
  lead_cidade_uf: string | null;
  lead_telefone_whatsapp: string | null;
  lead_email: string | null;
};

/** Row crua do banco antes do mapeamento pro domínio. */
type LeadInteresseRow = {
  id: number;
  lead_id: number;
  repasse_id: number | string | null;
  chassi: string | null;
  modelo_snapshot: string;
  tipo_carro: string;
  origem: string;
  qtd_visualizacoes: number | string | null;
  data_acesso: string | null;
  status_followup: string;
  data_contato: string | null;
  observacao: string | null;
  criado_em: string;
  atualizado_em: string;
};

/** Row com o lead embutido (select com join no Supabase). */
type LeadInteresseComLeadRow = LeadInteresseRow & {
  leads: {
    nome: string;
    cidade_uf: string | null;
    telefone_whatsapp: string | null;
    email: string | null;
  } | null;
};

// ─── Labels pt-BR ────────────────────────────────────────────────────────────

export const ORIGEM_LABEL: Record<Origem, string> = {
  visualizou: "Visualizou",
  oferta: "Ofertado",
};

/** Emoji + label pra badge de origem (visual da F3). */
export const ORIGEM_BADGE: Record<Origem, string> = {
  visualizou: "👁 Visualizou",
  oferta: "📤 Ofertado",
};

export const TIPO_CARRO_LABEL: Record<TipoCarro, string> = {
  repasse: "Repasse",
  estoque: "Estoque",
};

// Reexporta o status do follow-up pra UI consumir de um lugar só.
export {
  isStatusRelacionamento as isStatusFollowup,
  STATUS_RELACIONAMENTO_LABEL as STATUS_FOLLOWUP_LABEL,
  STATUS_RELACIONAMENTO_VALUES as STATUS_FOLLOWUP_VALUES,
} from "./leads";

// ─── Type guards ─────────────────────────────────────────────────────────────

export function isOrigem(v: unknown): v is Origem {
  return v === "visualizou" || v === "oferta";
}

export function isTipoCarro(v: unknown): v is TipoCarro {
  return v === "repasse" || v === "estoque";
}

// ─── REFERÊNCIA DO CARRO (pura) ──────────────────────────────────────────────

/** Campos que identificam o carro de um interesse — o mínimo pros helpers puros. */
export type CarroDoInteresse = {
  tipo_carro: TipoCarro;
  repasse_id: number | null;
  chassi: string | null;
};

/**
 * Pra onde o interesse aponta. Discriminada e TOTAL: toda linha de
 * `lead_interesses` cai em exatamente um caso, então a UI não precisa adivinhar
 * o que fazer com um `repasse_id` nulo.
 *
 *   repasse    → o carro existe; dá pra abrir /repasses/{id}/interessados
 *   estoque    → carro do estoque, identificado pelo chassi
 *   removido   → ÓRFÃO: era repasse e o repasse foi deletado (migration 033).
 *                Só resta `modelo_snapshot` — a linha continua valendo como
 *                histórico ("fulano procurou esse carro"), mas nada que dependa
 *                do carro existir pode ser oferecido.
 *   indefinido → estoque sem chassi. O CHECK do banco proíbe; existe aqui só pra
 *                a união ser total e a UI degradar pra "—" em vez de quebrar.
 */
export type ReferenciaCarro =
  | { tipo: "repasse"; repasseId: number }
  | { tipo: "estoque"; chassi: string }
  | { tipo: "removido" }
  | { tipo: "indefinido" };

/** Classifica o carro do interesse. PURA — é o único lugar que lê `repasse_id` cru. */
export function referenciaCarro(i: CarroDoInteresse): ReferenciaCarro {
  if (i.tipo_carro === "repasse") {
    return i.repasse_id != null
      ? { tipo: "repasse", repasseId: i.repasse_id }
      : { tipo: "removido" };
  }
  return i.chassi != null ? { tipo: "estoque", chassi: i.chassi } : { tipo: "indefinido" };
}

/** Atalho: o carro deste interesse saiu do sistema? */
export function ehInteresseOrfao(i: CarroDoInteresse): boolean {
  return referenciaCarro(i).tipo === "removido";
}

/** Rótulo pt-BR do órfão — mesma frase nas duas telas. */
export const LABEL_CARRO_REMOVIDO = "Carro removido do sistema";

/**
 * Por que uma ação que depende do carro está desabilitada. `null` = está tudo
 * certo, pode habilitar. Vira o `title` do botão: desabilitar sem dizer o motivo
 * faz o Marcos achar que a tela bugou.
 */
export function motivoAcaoIndisponivel(i: CarroDoInteresse): string | null {
  return ehInteresseOrfao(i)
    ? "Esse carro foi removido do sistema — o interesse fica no histórico, mas não dá pra abrir o repasse."
    : null;
}

// ─── Normalização ────────────────────────────────────────────────────────────

/** Normaliza INTEGER do Supabase (pode vir como string) pra number ≥ 0. */
function normalizarQtd(v: number | string | null): number {
  if (v == null) return 0;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
}

/** Normaliza bigint do Supabase (pode vir como string) pra number | null. */
function normalizarBigint(v: number | string | null): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

function rowToInteresse(row: LeadInteresseRow): LeadInteresse {
  const status: StatusFollowup = isStatusRelacionamento(row.status_followup)
    ? row.status_followup
    : "novo";
  const origem: Origem = isOrigem(row.origem) ? row.origem : "visualizou";
  const tipo: TipoCarro = isTipoCarro(row.tipo_carro) ? row.tipo_carro : "repasse";
  return {
    id: row.id,
    lead_id: row.lead_id,
    repasse_id: normalizarBigint(row.repasse_id),
    chassi: row.chassi,
    modelo_snapshot: row.modelo_snapshot,
    tipo_carro: tipo,
    origem,
    qtd_visualizacoes: normalizarQtd(row.qtd_visualizacoes),
    data_acesso: row.data_acesso,
    status_followup: status,
    data_contato: row.data_contato,
    observacao: row.observacao,
    criado_em: row.criado_em,
    atualizado_em: row.atualizado_em,
  };
}

// ─── QUERIES ─────────────────────────────────────────────────────────────────

/** Lista os carros de interesse de um lead, mais recentes primeiro. */
export async function listInteressesPorLead(leadId: number): Promise<LeadInteresse[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("lead_interesses")
    .select("*")
    .eq("lead_id", leadId)
    .order("criado_em", { ascending: false })
    .order("id", { ascending: true });
  if (error) throw new Error(`Falha ao listar interesses do lead: ${error.message}`);
  return ((data ?? []) as LeadInteresseRow[]).map(rowToInteresse);
}

/**
 * Lista os interesses de um repasse com os dados do lead embutidos (join).
 *
 * Alimenta a página "Interessados" por carro. Ordena por mais visualizados
 * primeiro (mantém o comportamento da tela antiga).
 */
export async function listInteressesPorRepasse(
  repasseId: number,
): Promise<LeadInteresseComLead[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("lead_interesses")
    .select("*, leads ( nome, cidade_uf, telefone_whatsapp, email )")
    .eq("repasse_id", repasseId)
    .order("qtd_visualizacoes", { ascending: false })
    .order("id", { ascending: true });
  if (error) throw new Error(`Falha ao listar interessados: ${error.message}`);

  return ((data ?? []) as LeadInteresseComLeadRow[]).map((row) => {
    const base = rowToInteresse(row);
    return {
      ...base,
      lead_nome: row.leads?.nome ?? "—",
      lead_cidade_uf: row.leads?.cidade_uf ?? null,
      lead_telefone_whatsapp: row.leads?.telefone_whatsapp ?? null,
      lead_email: row.leads?.email ?? null,
    };
  });
}

// ─── CROSS-SELL (outros carros de repasse que o lead também quer) ────────────

/** Um outro carro de repasse que o lead demonstrou interesse. */
export type OutroInteresseRepasse = {
  repasse_id: number;
  modelo: string;
};

/**
 * Pra um conjunto de leads, lista os OUTROS carros de repasse que cada um também
 * tem interesse — exceto o repasse atual. Alimenta o badge de cross-sell na tela
 * de interessados ("também quer +N carros").
 *
 * Só interesses de repasse (repasse_id não-nulo); estoque não entra. Retorna
 * Map<lead_id, OutroInteresseRepasse[]>. Leads sem outros interesses não aparecem.
 *
 * ÓRFÃOS FICAM DE FORA de propósito: o badge é uma alavanca de venda ("esse
 * lojista também quer estes carros — ofereça"). Carro que não existe mais não é
 * oferta possível; listá-lo só inflaria o número. O histórico do órfão continua
 * inteiro em /leads/[id], que é onde ele serve pra alguma coisa.
 */
export async function listOutrosInteressesDeLeads(
  leadIds: ReadonlyArray<number>,
  repasseIdExcluir: number,
): Promise<Map<number, OutroInteresseRepasse[]>> {
  const m = new Map<number, OutroInteresseRepasse[]>();
  if (leadIds.length === 0) return m;

  const sb = getSupabase();
  const { data, error } = await sb
    .from("lead_interesses")
    .select("lead_id, repasse_id, modelo_snapshot")
    .in("lead_id", [...leadIds])
    .not("repasse_id", "is", null)
    .neq("repasse_id", repasseIdExcluir);
  if (error) throw new Error(`Falha ao carregar cross-sell: ${error.message}`);

  for (const row of (data ?? []) as Array<{
    lead_id: number;
    repasse_id: number | string | null;
    modelo_snapshot: string;
  }>) {
    const repasseId = normalizarBigint(row.repasse_id);
    if (repasseId == null) continue;
    const arr = m.get(row.lead_id) ?? [];
    arr.push({ repasse_id: repasseId, modelo: row.modelo_snapshot });
    m.set(row.lead_id, arr);
  }
  return m;
}

/** Dados pra criar um interesse a partir de uma oferta (Marcos oferece um carro). */
export type CriarInteresseOfertaInput = {
  leadId: number;
  tipo_carro: TipoCarro;
  repasse_id?: number | null;
  chassi?: string | null;
  modelo_snapshot: string;
};

/**
 * Cria um interesse com origem='oferta' (o Marcos ofertou o carro pro lead).
 *
 * Valida a constraint do banco no cliente (defesa em profundidade): repasse →
 * repasse_id + chassi null; estoque → chassi + repasse_id null. O dedup unique
 * do banco impede oferta duplicada do mesmo carro pro mesmo lead.
 *
 * Exigir `repasse_id` aqui é MAIS estrito que o CHECK depois da 033, e é
 * intencional: órfão é resultado de deletar um repasse, nunca algo que se cria.
 * Ofertar um carro que não existe não é caso de uso.
 */
export async function criarInteresseOferta(
  input: CriarInteresseOfertaInput,
): Promise<LeadInteresse> {
  const modelo = input.modelo_snapshot.trim();
  if (!modelo) throw new Error("modelo_snapshot é obrigatório");

  let repasse_id: number | null = null;
  let chassi: string | null = null;

  if (input.tipo_carro === "repasse") {
    repasse_id = input.repasse_id ?? null;
    if (repasse_id == null) {
      throw new Error("repasse_id é obrigatório quando tipo_carro='repasse'");
    }
  } else {
    chassi = input.chassi?.trim() || null;
    if (chassi == null) {
      throw new Error("chassi é obrigatório quando tipo_carro='estoque'");
    }
  }

  const sb = getSupabase();
  const { data, error } = await sb
    .from("lead_interesses")
    .insert({
      lead_id: input.leadId,
      tipo_carro: input.tipo_carro,
      repasse_id,
      chassi,
      modelo_snapshot: modelo,
      origem: "oferta",
      qtd_visualizacoes: 0,
    })
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(`Falha ao registrar oferta: ${error?.message ?? "sem dados"}`);
  }
  return rowToInteresse(data as LeadInteresseRow);
}

/** Patch parcial dos campos editáveis do interesse. */
export type LeadInteressePatch = {
  status_followup?: StatusFollowup;
  observacao?: string | null;
  data_contato?: string | null;
};

/**
 * Atualiza campos do interesse (status do follow-up / observação / data contato).
 *
 * Defesa em profundidade: rejeita status fora do enum ANTES de mandar pro banco.
 * `observacao` / `data_contato` vazios normalizam pra null.
 */
export async function updateInteresse(
  id: number,
  patch: LeadInteressePatch,
): Promise<LeadInteresse> {
  const update: Record<string, string | null> = {};

  if ("status_followup" in patch) {
    const v = patch.status_followup;
    if (!isStatusRelacionamento(v)) {
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
    throw new Error("updateInteresse: patch vazio");
  }

  const sb = getSupabase();
  const { data, error } = await sb
    .from("lead_interesses")
    .update(update)
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(`Falha ao atualizar interesse: ${error?.message ?? "sem dados"}`);
  }
  return rowToInteresse(data as LeadInteresseRow);
}

export async function deleteInteresse(id: number): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from("lead_interesses").delete().eq("id", id);
  if (error) throw new Error(`Falha ao excluir interesse: ${error.message}`);
}

/**
 * Conta interesses por repasse → Map<repasse_id, count>. Alimenta o badge
 * "👥 Interessados (N)" no /repasses sem carregar todas as linhas.
 *
 * Filtra por repasse_id não-nulo (interesses de estoque não têm repasse_id).
 */
export async function contarInteressesPorRepasse(): Promise<Map<number, number>> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("lead_interesses")
    .select("repasse_id")
    .not("repasse_id", "is", null);
  if (error) throw new Error(`Falha ao contar interessados: ${error.message}`);
  const m = new Map<number, number>();
  for (const row of (data ?? []) as Array<{ repasse_id: number | string | null }>) {
    const id = normalizarBigint(row.repasse_id);
    if (id != null) m.set(id, (m.get(id) ?? 0) + 1);
  }
  return m;
}

// ─── IMPORTAÇÃO (RPC dedup server-side) ──────────────────────────────────────

/** Item do payload do RPC `importar_interesses_repasse`. */
export type ItemImportacaoRpc = {
  nome: string;
  cidade_uf: string | null;
  telefone_whatsapp: string | null;
  telefones_raw: string | null;
  email: string | null;
  qtd_visualizacoes: number;
  data_acesso: string | null;
};

/** Contagens retornadas pelo RPC (feedback de importação). */
export type ImportacaoResultado = {
  leads_novos: number;
  leads_existentes: number;
  interesses_novos: number;
  interesses_ignorados: number;
};

/** Normaliza um número possivelmente string vindo do RPC. */
function rpcNum(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * Mapeia a saída do parser pro formato de itens do RPC. PURA — testável sem
 * tocar no Supabase. É a fronteira parser → RPC.
 */
export function parsedParaItensRpc(
  parsed: ReadonlyArray<ItemImportacaoRpc>,
): ItemImportacaoRpc[] {
  return parsed.map((i) => ({
    nome: i.nome,
    cidade_uf: i.cidade_uf,
    telefone_whatsapp: i.telefone_whatsapp,
    telefones_raw: i.telefones_raw,
    email: i.email,
    qtd_visualizacoes: i.qtd_visualizacoes,
    data_acesso: i.data_acesso,
  }));
}

/**
 * Importa interessados de um repasse a partir do texto colado do Auto Avaliar.
 *
 * Parseia → mapeia pro formato do RPC → chama `importar_interesses_repasse`
 * (dedup server-side, atômico). Substitui o `criarInteressados` antigo (que
 * escrevia em `repasse_interessados`).
 *
 * Retorna as contagens pra UI dar feedback (X novos leads, Y já existiam,
 * Z interesses novos, W ignorados).
 */
export async function importarInteressesDeRepasse(
  repasseId: number,
  textoColado: string,
): Promise<ImportacaoResultado> {
  const parsed = parseInteressados(textoColado);
  const itens = parsedParaItensRpc(parsed);

  if (itens.length === 0) {
    return {
      leads_novos: 0,
      leads_existentes: 0,
      interesses_novos: 0,
      interesses_ignorados: 0,
    };
  }

  const sb = getSupabase();
  const { data, error } = await sb.rpc("importar_interesses_repasse", {
    p_repasse_id: repasseId,
    p_itens: itens,
  });
  if (error) throw new Error(`Falha ao importar interesses: ${error.message}`);

  // O RPC retorna uma row (objeto) ou um array com uma row, conforme a definição.
  const raw = Array.isArray(data) ? data[0] : data;
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    leads_novos: rpcNum(r.leads_novos),
    leads_existentes: rpcNum(r.leads_existentes),
    interesses_novos: rpcNum(r.interesses_novos),
    interesses_ignorados: rpcNum(r.interesses_ignorados),
  };
}
