"use client";

/**
 * Hook reativo ao set de chassis com FIPE local "dirty" (override em memória
 * que ainda não foi persistido no Supabase).
 *
 * Usado pelo PrecificacaoBlock pra mostrar badge "⚠ FIPE local não sincronizado"
 * no header — alerta o operador que decisão de precificação está sobre dado
 * fantasma e some no próximo reload.
 */

import { useSyncExternalStore } from "react";
import { FIPE_DIRTY_EVENT, isFipeDirty } from "./batch";

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(FIPE_DIRTY_EVENT, callback);
  return () => window.removeEventListener(FIPE_DIRTY_EVENT, callback);
}

function getServerSnapshot(): boolean {
  return false;
}

/** `true` se o chassi tem override FIPE pendente de persistir no Supabase. */
export function useFipeDirty(chassi: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => isFipeDirty(chassi),
    getServerSnapshot,
  );
}
