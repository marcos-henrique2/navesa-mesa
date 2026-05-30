"use client";

import { useSyncExternalStore } from "react";
import type { BatchResult } from "./batch";

const BATCH_KEY = "navesa-mesa:fipe-batch-v1";
const BATCH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const BATCH_UPDATED_EVENT = "navesa-mesa:fipe-batch-updated";

// Cache de snapshot pra useSyncExternalStore não disparar loop infinito:
// só retorna nova referência quando a string crua do localStorage muda.
let cachedRaw: string | null | undefined = undefined; // undefined = "nunca lido"
let cachedSnapshot: BatchResult | null = null;

function readSnapshot(): BatchResult | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(BATCH_KEY);
  if (raw === cachedRaw) return cachedSnapshot;
  cachedRaw = raw;
  if (!raw) {
    cachedSnapshot = null;
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as BatchResult;
    if (Date.now() - parsed.timestamp > BATCH_TTL_MS) {
      cachedSnapshot = null;
      return null;
    }
    cachedSnapshot = parsed;
    return parsed;
  } catch {
    cachedSnapshot = null;
    return null;
  }
}

function invalidate() {
  cachedRaw = undefined; // força re-leitura no próximo getSnapshot
}

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === BATCH_KEY) {
      invalidate();
      callback();
    }
  };
  const onLocalUpdate = () => {
    invalidate();
    callback();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(BATCH_UPDATED_EVENT, onLocalUpdate);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(BATCH_UPDATED_EVENT, onLocalUpdate);
  };
}

function getServerSnapshot(): BatchResult | null {
  return null;
}

/**
 * Subscreve ao batch FIPE no localStorage com snapshot cacheado por referência
 * (necessário pra evitar loop infinito do useSyncExternalStore).
 */
export function useFipeBatch(): BatchResult | null {
  return useSyncExternalStore(subscribe, readSnapshot, getServerSnapshot);
}
