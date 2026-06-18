/**
 * Cálculos puros de KPIs do /repasses (testáveis sem React).
 */

import type { Repasse } from "./types";

export type ValorPraSubirKpi = {
  /** Soma de valor_subir dos repasses com status "subido". */
  total: number;
  /** Quantos repasses "subido" têm valor_subir preenchido. */
  comValor: number;
  /** Total de repasses com status "subido". */
  totalSubidos: number;
};

/**
 * Soma o `valor_subir` dos repasses com status "subido" e conta quantos têm o
 * valor preenchido. O contador deixa claro quanto falta preencher pra bater com
 * o total do Auto Avaliar (hoje `valor_subir` é majoritariamente null).
 */
export function calcularValorPraSubir(repasses: ReadonlyArray<Repasse>): ValorPraSubirKpi {
  let total = 0;
  let comValor = 0;
  let totalSubidos = 0;
  for (const r of repasses) {
    if (r.status !== "subido") continue;
    totalSubidos += 1;
    if (r.valor_subir != null) {
      total += r.valor_subir;
      comValor += 1;
    }
  }
  return { total, comValor, totalSubidos };
}
