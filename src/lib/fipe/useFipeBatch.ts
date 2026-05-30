"use client";

import { useSyncExternalStore } from "react";
import type { BatchResult } from "./batch";
import { ensureBatchLoaded, loadCachedBatch } from "./batch";

const EVT = "navesa-mesa:fipe-batch-updated";

function readSnapshot(): BatchResult | null {
  return loadCachedBatch();
}

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  // Dispara load na primeira subscrição (no-op em chamadas subsequentes)
  ensureBatchLoaded();
  window.addEventListener(EVT, callback);
  return () => window.removeEventListener(EVT, callback);
}

function getServerSnapshot(): BatchResult | null {
  return null;
}

/**
 * Hook reativo ao batch FIPE no Supabase.
 * Primeira renderização dispara o load; updates posteriores via custom event.
 */
export function useFipeBatch(): BatchResult | null {
  return useSyncExternalStore(subscribe, readSnapshot, getServerSnapshot);
}
