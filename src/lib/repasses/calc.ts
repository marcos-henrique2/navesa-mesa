/**
 * Cálculos financeiros do repasse — funções puras, testáveis.
 *
 * Convenção: trabalhamos em reais (number). Os valores vêm de NUMERIC(12,2)
 * do Postgres, então não há float instável no banco. Aqui no JS é melhor
 * arredondar resultados intermediários pra evitar erros tipo 0.1+0.2.
 */

import type { Repasse, RepasseGasto } from "./types";

/** Arredonda pra centavo (2 casas). Não rola comparação ===, mas paga UI/relatório. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Soma de todos os gastos. Retorna 0 se a lista estiver vazia. */
export function calcularTotalGastos(gastos: ReadonlyArray<RepasseGasto>): number {
  let total = 0;
  for (const g of gastos) total += g.valor;
  return round2(total);
}

/**
 * Custo total = valor de aquisição + soma dos gastos.
 * Retorna `null` se não houver valor_aquisicao (não dá pra calcular sem ele).
 */
export function calcularCustoTotal(
  repasse: Pick<Repasse, "valor_aquisicao">,
  gastos: ReadonlyArray<RepasseGasto>,
): number | null {
  if (repasse.valor_aquisicao == null) return null;
  return round2(repasse.valor_aquisicao + calcularTotalGastos(gastos));
}

/**
 * Margem real (R$) = valor_vendido - custo_total.
 * Retorna `null` se faltar valor_vendido OU não houver custo_total computável.
 * Pode ser negativa (prejuízo).
 */
export function calcularMargemReal(
  repasse: Pick<Repasse, "valor_aquisicao" | "valor_vendido">,
  gastos: ReadonlyArray<RepasseGasto>,
): number | null {
  if (repasse.valor_vendido == null) return null;
  const custo = calcularCustoTotal(repasse, gastos);
  if (custo == null) return null;
  return round2(repasse.valor_vendido - custo);
}

/**
 * Margem real (%) sobre o valor vendido.
 * `(valor_vendido - custo_total) / valor_vendido * 100`.
 * Retorna `null` se faltar dado ou valor_vendido = 0 (divisão por zero).
 */
export function calcularMargemPct(
  repasse: Pick<Repasse, "valor_aquisicao" | "valor_vendido">,
  gastos: ReadonlyArray<RepasseGasto>,
): number | null {
  if (repasse.valor_vendido == null || repasse.valor_vendido === 0) return null;
  const margem = calcularMargemReal(repasse, gastos);
  if (margem == null) return null;
  return round2((margem / repasse.valor_vendido) * 100);
}
