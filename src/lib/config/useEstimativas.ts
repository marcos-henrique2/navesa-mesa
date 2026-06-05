"use client";

import { useSyncExternalStore } from "react";
import {
  DEFAULTS,
  getEstimativas,
  subscribeEstimativas,
  type EstimativasCustos,
} from "./estimativas-custos";

function getServer(): EstimativasCustos {
  // SSR fallback: defaults vindos da fonte única. Hidratação corrige.
  return DEFAULTS;
}

/**
 * Hook reativo às mudanças das estimativas de custos no localStorage.
 * Re-renderiza automaticamente quando alguém edita as estimativas em
 * qualquer aba aberta.
 */
export function useEstimativas(): EstimativasCustos {
  return useSyncExternalStore(subscribeEstimativas, getEstimativas, getServer);
}
