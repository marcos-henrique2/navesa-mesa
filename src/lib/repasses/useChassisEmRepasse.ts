"use client";

/**
 * Hook que carrega 1x o map de chassis com repasse ativo (status='marcado'
 * OU 'subido').
 *
 * Estado **module-level** (singleton em memória) + subscribers — qualquer
 * mudança via `marcarLocalmente` / `removerLocalmente` / `refresh()` propaga
 * pra todas as instâncias do hook (ex.: /repasses + /estoque na mesma sessão).
 *
 * Sem isso, remover um repasse em /repasses não atualizava o map em /estoque
 * — o carro continuava aparecendo opaco com chip "Em repasse".
 */

import { useCallback, useEffect, useState } from "react";
import { listChassisEmRepasse } from "./queries";

export type UseChassisEmRepasseResult = {
  /** Map<chassi, repasse_id>. Vazio enquanto carrega ou se errored. */
  chassisEmRepasse: ReadonlyMap<string, number>;
  /** true durante o fetch inicial — UI pode esconder indicadores até carregar. */
  carregando: boolean;
  /** Recarrega o map. Útil após criar repasse novo via UI. */
  refresh: () => Promise<void>;
  /** Adiciona um chassi localmente (otimista) sem hit no servidor. */
  marcarLocalmente: (chassi: string, repasseId: number) => void;
  /** Remove um chassi localmente (otimista) sem hit no servidor. */
  removerLocalmente: (chassi: string) => void;
};

// ─── Store module-level ──────────────────────────────────────────────────────

let storeMap: ReadonlyMap<string, number> = new Map();
let storeCarregando = true;
const subscribers = new Set<() => void>();

function notifySubscribers() {
  for (const cb of subscribers) cb();
}

function setStoreMap(next: ReadonlyMap<string, number>) {
  storeMap = next;
  notifySubscribers();
}

function setStoreCarregando(next: boolean) {
  storeCarregando = next;
  notifySubscribers();
}

async function refreshGlobal() {
  try {
    const m = await listChassisEmRepasse();
    setStoreMap(m);
  } catch (err) {
    // Falha silenciosa — UI continua funcional, só sem indicador.
    console.error("Falha ao carregar chassis em repasse:", err);
  } finally {
    setStoreCarregando(false);
  }
}

function marcarLocalmenteGlobal(chassi: string, repasseId: number) {
  const next = new Map(storeMap);
  next.set(chassi, repasseId);
  setStoreMap(next);
}

function removerLocalmenteGlobal(chassi: string) {
  if (!storeMap.has(chassi)) return;
  const next = new Map(storeMap);
  next.delete(chassi);
  setStoreMap(next);
}

let fetchedOnce = false;

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useChassisEmRepasse(): UseChassisEmRepasseResult {
  const [chassisEmRepasse, setChassisEmRepasse] = useState<ReadonlyMap<string, number>>(storeMap);
  const [carregando, setCarregando] = useState(storeCarregando);

  useEffect(() => {
    const sub = () => {
      setChassisEmRepasse(storeMap);
      setCarregando(storeCarregando);
    };
    subscribers.add(sub);
    if (!fetchedOnce) {
      fetchedOnce = true;
      void refreshGlobal();
    } else {
      // Já carregado por outra instância — sincroniza estado local com store.
      sub();
    }
    return () => {
      subscribers.delete(sub);
    };
  }, []);

  const refresh = useCallback(() => refreshGlobal(), []);
  const marcarLocalmente = useCallback(
    (chassi: string, repasseId: number) => marcarLocalmenteGlobal(chassi, repasseId),
    [],
  );
  const removerLocalmente = useCallback((chassi: string) => removerLocalmenteGlobal(chassi), []);

  return { chassisEmRepasse, carregando, refresh, marcarLocalmente, removerLocalmente };
}

// ─── Testes / utilitários ────────────────────────────────────────────────────

/** Reseta o store global. Uso interno em testes. */
export function __resetChassisEmRepasseStore() {
  storeMap = new Map();
  storeCarregando = true;
  fetchedOnce = false;
  subscribers.clear();
}
