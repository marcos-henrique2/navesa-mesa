"use client";

/**
 * STATUS CAUTELAR — laudo veicular preenchido manualmente pelo avaliador.
 *
 * Conforme política Auto Avaliar:
 *   - "reprovado"      → carro vai pra Classe E (sinistro/cautelar reprovado)
 *   - "com_restricao"  → desce 1 classe (recomendação pra repasse)
 *   - "aprovado"       → não afeta classificação automática (mantém o que a regra disse)
 *
 * Storage: localStorage indexado por chassi (não some entre uploads de estoque).
 */

import { useSyncExternalStore } from "react";

export type StatusCautelar = "aprovado" | "com_restricao" | "reprovado";

const KEY = "navesa-mesa:cautelar-v1";
const EVT = "navesa-mesa:cautelar-updated";

// ───── Persistência ─────────────────────────────────────────────────────────

function readAll(): Record<string, StatusCautelar> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, StatusCautelar>;
  } catch {
    return {};
  }
}

function writeAll(data: Record<string, StatusCautelar>): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    window.dispatchEvent(new Event(EVT));
  } catch (err) {
    console.warn("Falha ao salvar cautelar:", err);
  }
}

export function getCautelar(chassi: string): StatusCautelar | null {
  return readAll()[chassi] ?? null;
}

export function setCautelar(chassi: string, status: StatusCautelar | null): void {
  const data = readAll();
  if (status === null) delete data[chassi];
  else data[chassi] = status;
  writeAll(data);
}

export function getAllCautelares(): Record<string, StatusCautelar> {
  return readAll();
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
  const data = readAll();
  let aplicados = 0, ignorados = 0;
  for (const [chassi, status] of Object.entries(novas)) {
    if (!opts.overwrite && data[chassi]) {
      ignorados++;
      continue;
    }
    data[chassi] = status;
    aplicados++;
  }
  writeAll(data);
  return { aplicados, ignorados };
}

/**
 * Marca todos os chassis fornecidos como "aprovado" — só se NÃO tiverem cautelar definido.
 * Útil pra default "aprovado em massa".
 */
export function aprovarTodosSemCautelar(chassis: string[]): { aprovados: number } {
  const data = readAll();
  let aprovados = 0;
  for (const ch of chassis) {
    if (!data[ch]) {
      data[ch] = "aprovado";
      aprovados++;
    }
  }
  if (aprovados > 0) writeAll(data);
  return { aprovados };
}

// ───── Hook React (snapshot cacheado pra useSyncExternalStore) ──────────────

const EMPTY: Record<string, StatusCautelar> = {};
let cachedRaw: string | null | undefined = undefined;
let cachedMap: Record<string, StatusCautelar> = EMPTY;

function readSnapshot(): Record<string, StatusCautelar> {
  if (typeof window === "undefined") return EMPTY;
  const raw = localStorage.getItem(KEY);
  if (raw === cachedRaw) return cachedMap;
  cachedRaw = raw;
  try {
    cachedMap = raw ? (JSON.parse(raw) as Record<string, StatusCautelar>) : {};
  } catch {
    cachedMap = {};
  }
  return cachedMap;
}

function invalidate() {
  cachedRaw = undefined;
}

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      invalidate();
      callback();
    }
  };
  const onLocal = () => {
    invalidate();
    callback();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(EVT, onLocal);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(EVT, onLocal);
  };
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
