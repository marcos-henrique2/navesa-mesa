/**
 * Cálculos puros de KPIs do /repasses (testáveis sem React).
 */

import { somarCentavos } from "@/lib/repasses/margem-repasse";
import type { Repasse } from "@/lib/repasses/types";

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

/**
 * Estado do KPI "Margem real". A UI mapeia isto pra valor + tom + hint; aqui não
 * há React nem formatação de moeda, só a decisão de o número ser confiável.
 */
export type EstadoMargemReal =
  | "gastos_indisponiveis"
  | "sem_vendas"
  | "sem_custo"
  | "parcial"
  | "completo";

export type ResumoMargemReal = {
  estado: EstadoMargemReal;
  /** Soma centavo-perfect das margens computáveis. null = não há número honesto. */
  total: number | null;
  /** Vendidos que entraram na soma (têm `valor_compra_repasse`). */
  comCusto: number;
  /** Vendidos no recorte. */
  vendidos: number;
  /** Frase pt-BR completa pro hint do KPI — nunca uma contagem solta. */
  hint: string;
};

function plural(n: number, singular: string, plural_: string): string {
  return n === 1 ? singular : plural_;
}

/**
 * Resume o KPI "Margem real" a partir das margens já calculadas — uma entrada
 * por vendido, `null` onde falta `valor_compra_repasse`.
 *
 * Dois estados NÃO produzem número (total = null), e é isso que separa "sem
 * dado" de "não deu lucro":
 *
 *   - `gastos_indisponiveis`: a query de `repasse_gastos` falhou. Sem o Σ gastos
 *     o custo_real fica INCOMPLETO e a margem sairia SUPERESTIMADA — mostrar o
 *     número seria mentir a favor (viola centavo-perfect). Vale mesmo que TODOS
 *     os vendidos tenham `valor_compra_repasse`.
 *   - `sem_custo`: nenhum vendido tem `valor_compra_repasse`. R$ 0,00 aqui não é
 *     margem zero, é ausência de dado.
 */
export function resumirMargemReal(
  margens: ReadonlyArray<number | null>,
  gastosCarregados: boolean,
): ResumoMargemReal {
  const vendidos = margens.length;
  const computaveis = margens.filter((m): m is number => m != null);
  const comCusto = computaveis.length;

  if (!gastosCarregados) {
    return {
      estado: "gastos_indisponiveis",
      total: null,
      comCusto,
      vendidos,
      hint: "falha ao carregar os gastos — margem indisponível",
    };
  }
  if (vendidos === 0) {
    return {
      estado: "sem_vendas",
      total: null,
      comCusto: 0,
      vendidos: 0,
      hint: "nenhuma venda no recorte",
    };
  }
  if (comCusto === 0) {
    return {
      estado: "sem_custo",
      total: null,
      comCusto: 0,
      vendidos,
      hint: `sem custo de repasse em ${vendidos} ${plural(vendidos, "vendido", "vendidos")}`,
    };
  }

  const total = somarCentavos(computaveis);
  if (comCusto < vendidos) {
    return {
      estado: "parcial",
      total,
      comCusto,
      vendidos,
      hint: `parcial — só ${comCusto} de ${vendidos} vendidos têm custo de repasse`,
    };
  }
  return {
    estado: "completo",
    total,
    comCusto,
    vendidos,
    hint: `${vendidos} ${plural(vendidos, "vendido", "vendidos")} com custo de repasse`,
  };
}
