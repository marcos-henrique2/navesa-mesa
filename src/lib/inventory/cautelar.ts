"use client";

/**
 * STATUS CAUTELAR — laudo veicular preenchido manualmente pelo avaliador.
 *
 * Conforme política Auto Avaliar:
 *   - "reprovado"      → carro vai pra Classe E (sinistro/cautelar reprovado)
 *   - "com_restricao"  → desce 1 classe (recomendação pra repasse)
 *   - "aprovado"       → não afeta classificação automática (mantém o que a regra disse)
 *
 * Storage: Supabase (tabela cautelar, PK chassi). Cache em memória pra leituras
 * síncronas. Escritas são otimistas (cache + dispatch event) e persistem em background.
 */

import { useSyncExternalStore } from "react";
import {
  listCautelares,
  upsertCautelar,
  deleteCautelar,
  upsertCautelaresEmLote,
} from "@/lib/data/cautelar";

export type StatusCautelar = "aprovado" | "com_restricao" | "reprovado";

const EVT = "navesa-mesa:cautelar-updated";

// Cache em memória (single source of truth pro hook)
let cachedMap: Record<string, StatusCautelar> = {};
let cacheSnapshot: Record<string, StatusCautelar> = cachedMap;
let loadingPromise: Promise<void> | null = null;
let loaded = false;

function notify() {
  // Cria nova referência pra useSyncExternalStore detectar mudança
  cacheSnapshot = { ...cachedMap };
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVT));
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    try {
      cachedMap = await listCautelares();
      loaded = true;
      cacheSnapshot = { ...cachedMap };
      if (typeof window !== "undefined") window.dispatchEvent(new Event(EVT));
    } catch (err) {
      console.error("Falha ao carregar cautelares do Supabase:", err);
    } finally {
      loadingPromise = null;
    }
  })();
  return loadingPromise;
}

// ───── Leitura síncrona (do cache) ──────────────────────────────────────────

export function getCautelar(chassi: string): StatusCautelar | null {
  return cachedMap[chassi] ?? null;
}

/**
 * Retorna o mapa cautelar. Tipo `Readonly` previne mutação acidental do cache
 * por consumidores. Pra mutar use setCautelar/setMultipleCautelares/etc.
 */
export function getAllCautelares(): Readonly<Record<string, StatusCautelar>> {
  return cachedMap;
}

// ───── Escritas (otimistas + persistência em background com rollback) ──────
//
// Padrão: capturamos o estado anterior das chaves afetadas, aplicamos no cache,
// notificamos, e disparamos a persistência. Em caso de erro, restauramos o
// estado anterior + notify() — UI volta a refletir o Supabase.

export function setCautelar(chassi: string, status: StatusCautelar | null): void {
  const previo = cachedMap[chassi]; // undefined se não existia
  if (status === null) {
    delete cachedMap[chassi];
    notify();
    deleteCautelar(chassi).catch((e) => {
      console.error("Falha ao remover cautelar (rollback aplicado):", e);
      if (previo !== undefined) cachedMap[chassi] = previo;
      notify();
    });
  } else {
    cachedMap[chassi] = status;
    notify();
    upsertCautelar(chassi, status).catch((e) => {
      console.error("Falha ao salvar cautelar (rollback aplicado):", e);
      if (previo === undefined) delete cachedMap[chassi];
      else cachedMap[chassi] = previo;
      notify();
    });
  }
}

/**
 * Aplica vários cautelares de uma vez (import em massa).
 * Por padrão NÃO sobrescreve placas que já têm cautelar — comportamento "merge".
 * Passe { overwrite: true } pra forçar.
 * Retorna stats {aplicados, ignorados (já existiam)}.
 */
export function setMultipleCautelares(
  novas: Record<string, StatusCautelar>,
  opts: { overwrite?: boolean } = {},
): { aplicados: number; ignorados: number } {
  let aplicados = 0, ignorados = 0;
  const paraSalvar: Record<string, StatusCautelar> = {};
  const previos: Record<string, StatusCautelar | undefined> = {};
  for (const [chassi, status] of Object.entries(novas)) {
    if (!opts.overwrite && cachedMap[chassi]) {
      ignorados++;
      continue;
    }
    previos[chassi] = cachedMap[chassi];
    cachedMap[chassi] = status;
    paraSalvar[chassi] = status;
    aplicados++;
  }
  if (aplicados > 0) {
    notify();
    upsertCautelaresEmLote(paraSalvar).catch((e) => {
      console.error("Falha ao salvar cautelares em lote (rollback aplicado):", e);
      for (const [chassi, anterior] of Object.entries(previos)) {
        if (anterior === undefined) delete cachedMap[chassi];
        else cachedMap[chassi] = anterior;
      }
      notify();
    });
  }
  return { aplicados, ignorados };
}

/**
 * Marca todos os chassis fornecidos como "aprovado" — só se NÃO tiverem cautelar definido.
 * Útil pra default "aprovado em massa".
 */
export function aprovarTodosSemCautelar(chassis: string[]): { aprovados: number } {
  const paraSalvar: Record<string, StatusCautelar> = {};
  const aprovadosLista: string[] = [];
  let aprovados = 0;
  for (const ch of chassis) {
    if (!cachedMap[ch]) {
      cachedMap[ch] = "aprovado";
      paraSalvar[ch] = "aprovado";
      aprovadosLista.push(ch);
      aprovados++;
    }
  }
  if (aprovados > 0) {
    notify();
    upsertCautelaresEmLote(paraSalvar).catch((e) => {
      console.error("Falha ao aprovar em massa (rollback aplicado):", e);
      for (const ch of aprovadosLista) delete cachedMap[ch];
      notify();
    });
  }
  return { aprovados };
}

// ───── Hook React ───────────────────────────────────────────────────────────

const EMPTY: Record<string, StatusCautelar> = {};

function readSnapshot(): Record<string, StatusCautelar> {
  return cacheSnapshot;
}

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  // Dispara load na primeira subscrição
  ensureLoaded();
  const onLocal = () => callback();
  window.addEventListener(EVT, onLocal);
  return () => window.removeEventListener(EVT, onLocal);
}

function getServerSnapshot(): Record<string, StatusCautelar> {
  return EMPTY;
}

/** Hook que devolve o mapa cautelar reativo a updates. */
export function useCautelares(): Record<string, StatusCautelar> {
  return useSyncExternalStore(subscribe, readSnapshot, getServerSnapshot);
}

// ───── Labels e cores pra UI ────────────────────────────────────────────────

export const CAUTELAR_LABEL: Record<StatusCautelar, string> = {
  aprovado: "Aprovado",
  com_restricao: "Com restrição",
  reprovado: "Reprovado",
};

export const CAUTELAR_ICONE: Record<StatusCautelar, string> = {
  aprovado: "✅",
  com_restricao: "⚠️",
  reprovado: "🔴",
};

export const CAUTELAR_COR: Record<StatusCautelar, { bg: string; text: string; border: string }> = {
  aprovado: { bg: "bg-emerald-100", text: "text-emerald-800", border: "border-emerald-300" },
  com_restricao: { bg: "bg-amber-100", text: "text-amber-800", border: "border-amber-300" },
  reprovado: { bg: "bg-red-100", text: "text-red-800", border: "border-red-300" },
};
