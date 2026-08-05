/**
 * Margem REAL do repasse já vendido (status='vendido') — KPI "Margem real" e
 * coluna "Resultado" da tela /repasses, mais a prévia ao vivo do modal de venda.
 *
 * Camada fina e PURA: delega 100% ao núcleo canônico `margem-repasse.ts`. A
 * REGRA DE OURO vale aqui igual ao relatório de anúncio:
 *
 *     custo_real = valor_compra_repasse + Σ repasse_gastos
 *
 * `valor_aquisicao` é custo de VAREJO (NBS) e NUNCA entra — usá-lo subestima a
 * margem e pinta de vermelho carro que deu lucro. Sem `valor_compra_repasse` o
 * carro é "dados incompletos": margem null e cor neutra, nunca fallback.
 */

import {
  calcularCustoReal,
  calcularMargemValor,
  classificarMargem,
  type ClassificacaoMargem,
} from "@/lib/repasses/margem-repasse";
import type { Repasse } from "@/lib/repasses/types";

/** Campos do repasse que a margem de venda consome. */
export type RepasseVenda = Pick<
  Repasse,
  "status" | "valor_vendido" | "valor_compra_repasse" | "valor_minimo" | "valor_compre_por"
>;

/** Valores de `repasse_gastos` do carro (nulos são ignorados pelo núcleo). */
export type GastosRepasse = ReadonlyArray<number | null | undefined>;

/** custo_real do repasse. null quando falta `valor_compra_repasse`. */
export function calcularCustoRealRepasse(
  r: Pick<Repasse, "valor_compra_repasse">,
  gastos: GastosRepasse = [],
): number | null {
  return calcularCustoReal(r.valor_compra_repasse, gastos);
}

/**
 * Margem realizada em R$ = valor_vendido − custo_real. Centavo-perfect.
 * null se o repasse não está vendido, se falta `valor_vendido` ou se falta
 * `valor_compra_repasse` (dados incompletos).
 */
export function calcularMargemVenda(r: RepasseVenda, gastos: GastosRepasse = []): number | null {
  if (r.status !== "vendido" || r.valor_vendido == null) return null;
  const custoReal = calcularCustoRealRepasse(r, gastos);
  return calcularMargemValor(r.valor_vendido, custoReal);
}

/**
 * Cor canônica do resultado da venda: o mesmo semáforo do resto do módulo
 * (vermelho abaixo do custo, verde no compre-por, amarelo acima do mínimo,
 * laranja no resto). Neutro quando não vendido ou com dados incompletos.
 */
export function classificarMargemVenda(
  r: RepasseVenda,
  gastos: GastosRepasse = [],
): ClassificacaoMargem {
  if (r.status !== "vendido") return { cor: "neutro", completo: false };
  return classificarMargem(
    r.valor_vendido,
    calcularCustoRealRepasse(r, gastos),
    r.valor_minimo,
    r.valor_compre_por,
  );
}
