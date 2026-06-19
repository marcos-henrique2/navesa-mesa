import type { Repasse } from "./types";

/** Margem real do repasse = valor vendido − custo (valor_aquisicao). null se não vendido ou sem dados. */
export function calcularMargemReal(
  r: Pick<Repasse, "status" | "valor_vendido" | "valor_aquisicao">,
): number | null {
  if (r.status !== "vendido" || r.valor_vendido == null || r.valor_aquisicao == null) return null;
  return r.valor_vendido - r.valor_aquisicao;
}
