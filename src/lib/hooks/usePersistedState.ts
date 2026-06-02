"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";

/**
 * Prefixo único pros filtros ficarem agrupados no sessionStorage e não colidirem
 * com outras chaves do app. SessionStorage = limpa ao fechar a aba (não polui
 * o navegador), mas mantém ao navegar entre páginas dentro da mesma sessão.
 */
const PREFIX = "navesa-mesa:filtros:";

/**
 * useState com persistência em sessionStorage.
 *
 * Implementação via `useSyncExternalStore` pra evitar:
 *  - SSR mismatch: server snapshot retorna defaultValue, client snapshot lê
 *    do sessionStorage no primeiro render do cliente.
 *  - Cascading re-render do padrão `useEffect + setState`.
 *
 * Tolerante a sessionStorage indisponível (Safari private mode, quota cheia)
 * e a JSON corrompido (fallback silencioso pro defaultValue).
 */
export function usePersistedState<T>(
  key: string,
  defaultValue: T,
): [T, (value: T | ((prev: T) => T)) => void] {
  const fullKey = PREFIX + key;

  // Cache do snapshot — useSyncExternalStore exige que getSnapshot retorne a
  // mesma referência se nada mudou (senão entra em loop infinito).
  // Inicializado no primeiro render via useRef com defaultValue.
  const cacheRef = useRef<{ raw: string | null; value: T }>({
    raw: null,
    value: defaultValue,
  });

  const subscribe = useCallback((onChange: () => void) => {
    if (typeof window === "undefined") return () => {};
    // Storage event só dispara em outras abas — mas servimos como fallback.
    // Updates da própria aba são notificados via setValue → cacheRef + forceUpdate
    // implícito (useSyncExternalStore detecta mudança de snapshot).
    const handler = (e: StorageEvent) => {
      if (e.key === fullKey || e.key === null) onChange();
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [fullKey]);

  const getSnapshot = useCallback((): T => {
    if (typeof window === "undefined") return defaultValue;
    let raw: string | null = null;
    try {
      raw = window.sessionStorage.getItem(fullKey);
    } catch {
      return cacheRef.current.value;
    }
    if (raw === cacheRef.current.raw) {
      return cacheRef.current.value;
    }
    if (raw === null) {
      cacheRef.current = { raw: null, value: defaultValue };
      return defaultValue;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      cacheRef.current = { raw, value: parsed as T };
      return parsed as T;
    } catch {
      // JSON corrompido — usa default e mantém o raw em cache pra não reparse
      cacheRef.current = { raw, value: defaultValue };
      return defaultValue;
    }
  }, [fullKey, defaultValue]);

  const getServerSnapshot = useCallback((): T => defaultValue, [defaultValue]);

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      const resolved =
        typeof next === "function" ? (next as (p: T) => T)(value) : next;
      try {
        if (typeof window !== "undefined") {
          const raw = JSON.stringify(resolved);
          window.sessionStorage.setItem(fullKey, raw);
          // Notifica subscribers da mesma aba (storage event nativo não dispara
          // pra origem). Usamos um evento custom no window.
          cacheRef.current = { raw, value: resolved };
          window.dispatchEvent(new StorageEvent("storage", { key: fullKey, newValue: raw }));
        }
      } catch {
        // quota / disabled — atualiza cache em memória mesmo assim pra UI responder
        cacheRef.current = { raw: cacheRef.current.raw, value: resolved };
        if (typeof window !== "undefined") {
          window.dispatchEvent(new StorageEvent("storage", { key: fullKey }));
        }
      }
    },
    [fullKey, value],
  );

  return [value, setValue];
}
