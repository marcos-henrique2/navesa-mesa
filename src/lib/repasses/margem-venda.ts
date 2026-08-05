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
 * Semáforo da venda a partir dos VALORES crus — a exceção do prejuízo mora aqui,
 * numa função só, pra coluna "Resultado" e a prévia ao vivo do modal de venda
 * jamais divergirem no mesmo carro.
 *
 * O núcleo `classificarMargem` fica intocado: ele exige o trio (custo/mínimo/
 * compre-por) pra escolher entre verde/amarelo/laranja, e é isso que o badge, o
 * simulador e o relatório de anúncio esperam. Mas PREJUÍZO não depende de limiar
 * nenhum — basta custo_real e valor de venda. Um carro com custo de repasse mas
 * sem mínimo/compre-por vinha em cinza neutro mostrando −R$ 5.000,00, que lê como
 * "não sei" em vez de "perdeu dinheiro". Aqui o vermelho ganha do neutro; o
 * `completo: false` continua sinalizando que o semáforo é parcial.
 *
 * Margem zero NÃO é prejuízo — segue neutro sem os limiares.
 */
export function classificarMargemVendaValores(
  valorVenda: number | null | undefined,
  custoReal: number | null | undefined,
  minimo: number | null | undefined,
  comprePor: number | null | undefined,
): ClassificacaoMargem {
  const classificacao = classificarMargem(valorVenda, custoReal, minimo, comprePor);
  if (classificacao.cor !== "neutro") return classificacao;
  const margem = calcularMargemValor(valorVenda, custoReal);
  if (margem != null && margem < 0) return { cor: "vermelho", completo: false };
  return classificacao;
}

/**
 * Cor canônica do resultado da venda já registrada: o mesmo semáforo do resto do
 * módulo (vermelho abaixo do custo, verde no compre-por, amarelo acima do mínimo,
 * laranja no resto). Neutro quando não vendido ou com dados incompletos —
 * exceto no prejuízo, conforme `classificarMargemVendaValores`.
 */
export function classificarMargemVenda(
  r: RepasseVenda,
  gastos: GastosRepasse = [],
): ClassificacaoMargem {
  if (r.status !== "vendido") return { cor: "neutro", completo: false };
  return classificarMargemVendaValores(
    r.valor_vendido,
    calcularCustoRealRepasse(r, gastos),
    r.valor_minimo,
    r.valor_compre_por,
  );
}
