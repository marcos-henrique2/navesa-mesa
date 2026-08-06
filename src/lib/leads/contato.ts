"use client";

/**
 * Registro de contato com o lead — ponto ÚNICO chamado por todo botão que abre
 * `wa.me` no app (InteressadosCRM, LeadDetalhe, MensagemLeadModal).
 *
 * Por que existe:
 *   Antes, cada tela fazia um UPDATE direto em `lead_interesses` com a data em
 *   UTC, sem tocar em `leads.status_relacionamento` e sem atomicidade. Três
 *   telas, três cópias da mesma regra, e uma delas podia divergir a qualquer
 *   momento.
 *
 * Caminho principal (carro de repasse) → RPC `marcar_lead_contatado` (migration
 * 020, GRANT pra `authenticated` reafirmado na 026). A RPC é atômica e faz as
 * três coisas de uma vez:
 *   - data_contato = current_date + status_followup novo→contatado NO INTERESSE
 *     DAQUELE repasse (WHERE lead_id = X AND repasse_id = Y);
 *   - leads.status_relacionamento novo→contatado.
 * O escopo por `repasse_id` é o que garante o isolamento: contatar um lojista
 * sobre 1 carro não pode mexer nos outros 7 carros que ele também quer.
 *
 * Caminho secundário (carro de ESTOQUE, sem repasse_id): a RPC não consegue
 * isolar — sem `p_repasse_id` ela marca TODOS os interesses sem data_contato do
 * lead, exatamente o que não se quer. Então esse caso cai num UPDATE direto pelo
 * `id` do interesse, que é isolado por construção. Limitação assumida e
 * documentada: esse caminho NÃO promove `leads.status_relacionamento` (só a RPC
 * faz isso) e não é atômico.
 *
 * Desfazer: reverte as DUAS coisas que a RPC fez — o interesse (`data_contato` +
 * `status_followup`) e, quando ela informou `status_promovido`, o
 * `leads.status_relacionamento` de volta pra 'novo'. Reverter só o interesse
 * deixava o lead marcado como contatado sem contato registrado: ele sumia da fila
 * de disparo e da lista de "novos" sem nada na tela justificando.
 *
 * Autenticação: o app inteiro roda atrás do proxy de auth (src/proxy.ts) — toda
 * rota não-pública exige usuário logado. O `createBrowserClient` carrega a
 * sessão pelos cookies, então a RPC chega no Postgres com o papel
 * `authenticated`, que é quem tem EXECUTE desde a migration 026.
 */

import { getSupabase } from "@/lib/data/supabase";
import { hojeLocal } from "@/lib/utils/data-local";
import { updateInteresse, type StatusFollowup } from "./interesses";
import type { StatusRelacionamento } from "./leads";

// ─── TIPOS ───────────────────────────────────────────────────────────────────

/** Tipo de contato aceito pela RPC `marcar_lead_contatado`. */
export type TipoContato = "carro_visto" | "sondagem";

export type RegistrarContatoInput = {
  leadId: number;
  /** id da linha em `lead_interesses` — usado no caminho de estoque. */
  interesseId: number;
  /** Carro de repasse → RPC isolada. `null` (estoque) → UPDATE direto. */
  repasseId: number | null;
  /** Status atual do interesse (só o caminho de estoque precisa). */
  statusAtual: StatusFollowup;
};

export type RegistrarContatoResultado = {
  leadId: number;
  /** Quantos interesses a operação marcou. Esperado: 1. */
  interessesMarcados: number;
  /** true = `leads.status_relacionamento` subiu de 'novo' pra 'contatado'. */
  statusPromovido: boolean;
  /** Data gravada, YYYY-MM-DD. */
  dataContato: string;
};

/** Estado do interesse ANTES do contato — o que o "Desfazer" restaura. */
export type ContatoAnterior = {
  status_followup: StatusFollowup;
  data_contato: string | null;
};

/** Forma mínima de um interesse pros helpers de lista (puros). */
export type InteresseContatavel = {
  id: number;
  status_followup: StatusFollowup;
  data_contato: string | null;
};

/** Forma mínima de um lead pros helpers de promoção (puros). */
export type LeadPromovivel = {
  status_relacionamento: StatusRelacionamento;
};

/**
 * Tudo que o "Desfazer" precisa pra reverter o contato POR INTEIRO.
 *
 * Antes só existiam `interesseId` + `anterior`, e o desfazer parava no interesse:
 * `data_contato` voltava, mas `leads.status_relacionamento` ficava em 'contatado',
 * promovido pela RPC. O lead ficava marcado como contatado sem contato registrado —
 * some da fila de disparo e da lista de "novos", sem nada na tela explicando por quê.
 */
export type ContatoDesfazivel = {
  leadId: number;
  interesseId: number;
  anterior: ContatoAnterior;
  /**
   * `status_promovido` da RPC: true = ELA promoveu o lead de 'novo' pra 'contatado'
   * nesta operação. É a única condição em que o desfazer pode rebaixar — se o lead
   * já era 'contatado' (ou além) antes, a promoção não é nossa pra desfazer.
   */
  statusPromovido: boolean;
};

// ─── RETRY ───────────────────────────────────────────────────────────────────

/**
 * Executa `fn`; se falhar, tenta mais UMA vez. Persistindo, propaga o erro da
 * segunda tentativa.
 *
 * Uma retentativa só: o contato via WhatsApp já foi feito (a aba abriu), então
 * insistir demais só atrasa o feedback de erro. É seguro repetir porque a RPC é
 * idempotente — remarcar o mesmo interesse no mesmo dia dá o mesmo estado final.
 */
export async function comRetryUnico<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    return await fn();
  }
}

// ─── LEITURA DO RETORNO DA RPC (pura) ────────────────────────────────────────

function comoNumero(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * Normaliza o JSONB devolvido por `marcar_lead_contatado`. PURA — testável sem
 * Supabase. Campo ausente/malformado degrada pra valor neutro; a data cai pra
 * `fallbackData` (a data local que a UI já mostrou otimisticamente).
 */
export function interpretarRetornoContato(
  raw: unknown,
  leadId: number,
  fallbackData: string,
): RegistrarContatoResultado {
  const obj = Array.isArray(raw) ? raw[0] : raw;
  const r = (obj ?? {}) as Record<string, unknown>;
  const data = typeof r.data_contato === "string" ? r.data_contato.slice(0, 10) : fallbackData;
  return {
    leadId,
    interessesMarcados: comoNumero(r.interesses_marcados),
    statusPromovido: r.status_promovido === true,
    dataContato: data,
  };
}

// ─── ESCRITA ─────────────────────────────────────────────────────────────────

/**
 * Registra o contato do lead sobre UM carro específico.
 *
 * Não abre o WhatsApp e não mexe em UI — quem chama já abriu a aba (síncrono,
 * antes de qualquer await, senão o navegador bloqueia o popup) e cuida do
 * otimismo/rollback.
 */
export async function registrarContatoLead(
  input: RegistrarContatoInput,
): Promise<RegistrarContatoResultado> {
  const { leadId, interesseId, repasseId, statusAtual } = input;
  if (!Number.isFinite(leadId)) throw new Error(`leadId inválido: ${String(leadId)}`);
  if (!Number.isFinite(interesseId)) {
    throw new Error(`interesseId inválido: ${String(interesseId)}`);
  }

  const hoje = hojeLocal();

  // ── Estoque (sem repasse_id): UPDATE direto, isolado pelo id do interesse ──
  if (repasseId == null) {
    return comRetryUnico(async () => {
      const atualizado = await updateInteresse(interesseId, {
        data_contato: hoje,
        // Não rebaixa quem já avançou no funil — mesma regra da RPC.
        ...(statusAtual === "novo" ? { status_followup: "contatado" as const } : {}),
      });
      return {
        leadId,
        interessesMarcados: 1,
        // Só a RPC promove o lead; esse caminho não tem como fazê-lo atomicamente.
        statusPromovido: false,
        dataContato: atualizado.data_contato ?? hoje,
      };
    });
  }

  // ── Repasse: RPC atômica, escopada em (lead_id, repasse_id) ───────────────
  const sb = getSupabase();
  const raw = await comRetryUnico(async () => {
    const { data, error } = await sb.rpc("marcar_lead_contatado", {
      p_lead_id: leadId,
      p_tipo: "carro_visto" satisfies TipoContato,
      p_repasse_id: repasseId,
    });
    if (error) throw new Error(`Falha ao registrar contato: ${error.message}`);
    return data as unknown;
  });

  return interpretarRetornoContato(raw, leadId, hoje);
}

/**
 * Rebaixa `leads.status_relacionamento` de 'contatado' de volta pra 'novo'.
 *
 * A guarda `.eq("status_relacionamento", "contatado")` é o espelho exato da guarda
 * da RPC (`WHERE status_relacionamento = 'novo'` na promoção) e resolve a corrida da
 * janela de 8s do "Desfazer": se nesse meio-tempo o lead avançou pra 'respondeu' ou
 * 'negociando', o UPDATE casa 0 linhas e o progresso do funil não é destruído.
 *
 * Um roundtrip só — o filtro vai no WHERE, sem ler-antes-de-escrever.
 */
async function rebaixarLeadParaNovo(leadId: number): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb
    .from("leads")
    .update({ status_relacionamento: "novo" satisfies StatusRelacionamento })
    .eq("id", leadId)
    .eq("status_relacionamento", "contatado");
  if (error) throw new Error(`Falha ao reverter o status do lead: ${error.message}`);
}

/**
 * Desfaz o registro POR INTEIRO: o interesse (limpa `data_contato`, devolve o
 * `status_followup` anterior) e, quando a RPC promoveu, o
 * `leads.status_relacionamento` de volta pra 'novo'.
 *
 * Escopado no id do interesse — não toca nos outros carros do mesmo lojista.
 *
 * ORDEM: lead ANTES do interesse, de propósito. São dois writes sem transação, então
 * o que importa é qual estado parcial dói menos se o segundo falhar:
 *   - lead 1º: se o interesse falhar, sobra lead='novo' com data_contato preenchida.
 *     A UI já reexibe "contatado" na linha (que é o que o banco tem) e o toast avisa.
 *   - interesse 1º: se o lead falhar, sobra exatamente o bug que este código existe
 *     pra corrigir — contatado sem contato — e de forma silenciosa.
 */
export async function desfazerContatoLead(alvo: ContatoDesfazivel): Promise<void> {
  const { leadId, interesseId, anterior, statusPromovido } = alvo;

  if (statusPromovido) {
    await rebaixarLeadParaNovo(leadId);
  }

  await updateInteresse(interesseId, {
    data_contato: anterior.data_contato,
    status_followup: anterior.status_followup,
  });
}

// ─── HELPERS DE LISTA (puros — patch otimista e rollback) ────────────────────

/**
 * Aplica o efeito do contato na lista em memória, espelhando o que a RPC faz no
 * banco: só a linha `interesseId` muda, e `status_followup` só avança quando
 * ainda era 'novo'.
 *
 * As demais linhas voltam por REFERÊNCIA (mesmo objeto) — é o que prova, no
 * teste, que contatar sobre 1 carro não mexe nos outros 7 do mesmo lojista.
 */
export function aplicarContatoOtimista<T extends InteresseContatavel>(
  lista: ReadonlyArray<T>,
  interesseId: number,
  hoje: string,
): T[] {
  return lista.map((i) =>
    i.id === interesseId
      ? {
          ...i,
          data_contato: hoje,
          status_followup: i.status_followup === "novo" ? "contatado" : i.status_followup,
        }
      : i,
  );
}

/** Inverso do `aplicarContatoOtimista` — usado no rollback e no "Desfazer". */
export function reverterContatoOtimista<T extends InteresseContatavel>(
  lista: ReadonlyArray<T>,
  interesseId: number,
  anterior: ContatoAnterior,
): T[] {
  return lista.map((i) =>
    i.id === interesseId
      ? { ...i, data_contato: anterior.data_contato, status_followup: anterior.status_followup }
      : i,
  );
}

// ─── HELPERS DE PROMOÇÃO DO LEAD (puros) ─────────────────────────────────────
// Diferente do patch do interesse, a promoção do lead NÃO é otimista: só se sabe se
// ela aconteceu depois que a RPC responde `status_promovido`. Estes helpers refletem
// o que o banco JÁ fez, e o desfazer reverte na mesma régua.

/**
 * Aplica no lead em memória a promoção que a RPC informou ter feito
 * ('novo' → 'contatado'). `statusPromovido: false` devolve o MESMO objeto — o
 * banco não mexeu, a tela também não mexe.
 */
export function aplicarPromocaoLead<T extends LeadPromovivel>(
  lead: T | null,
  statusPromovido: boolean,
): T | null {
  if (lead == null || !statusPromovido) return lead;
  return { ...lead, status_relacionamento: "contatado" };
}

/**
 * Inverso — o "Desfazer". Rebaixa pra 'novo' apenas se a promoção foi nossa
 * (`statusPromovido`) E o lead ainda está exatamente em 'contatado'.
 *
 * A segunda condição é a mesma guarda do UPDATE no banco: nos 8s do toast o usuário
 * pode ter movido o lead pra 'respondeu'/'negociando'. Desfazer o contato não pode
 * apagar esse avanço do funil.
 */
export function reverterPromocaoLead<T extends LeadPromovivel>(
  lead: T | null,
  statusPromovido: boolean,
): T | null {
  if (lead == null || !statusPromovido) return lead;
  if (lead.status_relacionamento !== "contatado") return lead;
  return { ...lead, status_relacionamento: "novo" };
}
