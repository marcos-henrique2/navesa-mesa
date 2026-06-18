import type { Repasse } from "./types";

/**
 * Bônus de fábrica embutido no custo.
 *
 * Bônus = Custo (nota fábrica = `valor_aquisicao`) − Valor pra subir (`valor_subir`).
 * Ex.: custo 155.000, valor pra subir 140.000 → bônus 15.000.
 *
 * Retorna `null` quando não dá pra calcular (algum dos dois ausente) ou quando
 * o resultado é ≤ 0 (carro sem bônus: valor pra subir = custo).
 */
export function calcularBonus(
  r: Pick<Repasse, "valor_aquisicao" | "valor_subir">,
): number | null {
  if (r.valor_aquisicao == null || r.valor_subir == null) return null;
  const b = r.valor_aquisicao - r.valor_subir;
  return b > 0 ? b : null;
}
