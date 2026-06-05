/**
 * Estatísticas históricas de vendas do mesmo modelo de um veículo.
 *
 * Usa as vendas já importadas do NBS pra dar benchmarking ao gerente:
 *   - "esse Bronco que estou precificando está acima ou abaixo da margem média
 *     dos Broncos que já vendi?"
 *   - "esse modelo costuma ficar 30 dias no pátio ou 60?"
 *   - "vendi 3 desse modelo no mês — gira bem ou parou?"
 *
 * Match por nome de modelo normalizado (uppercase + trim). Modelos como
 * "BRONCO SPORT 2.0 ECOBOOST GASOLINA WILDTRAK 4X4 SE" são strings inteiras
 * — modelos diferentes (Wildtrak vs Big Bend) não se misturam.
 */

import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";
import type { VendaParsed } from "@/lib/parsers/nbs-vendas-xlsx";
import type { CustoDetalhado } from "@/lib/parsers/nbs-custos-xls";
import { normalizarPlaca } from "@/lib/utils/placa";

export type EstatisticasModelo = {
  /** Total de vendas históricas do mesmo modelo. */
  qtVendidasTotal: number;
  /** Vendas do "mês de referência" (do mesmo modelo). Ver `mesReferenciaLabel`. */
  qtVendidasMesAtual: number;
  /** Label legível do mês de referência. ex: "jun/2026" ou "mês atual" se não há dataset. */
  mesReferenciaLabel: string;
  /** Preço médio de venda (preço fechado, não tabela). */
  precoMedioVenda: number | null;
  /** Margem média de venda, calculada por venda: (preço − custo) ÷ preço. */
  margemMediaPct: number | null;
  /** Dias médios em estoque até a venda. */
  diasEstoqueMedio: number | null;
  /** Floor plan médio pago por unidade vendida (da tabela custos_detalhados). */
  floorPlanMedio: number | null;
  /** Nome do modelo usado como referência. */
  modeloReferencia: string;
};

/**
 * Normaliza nome de modelo pra matching robusto: uppercase, trim, e colapsa
 * múltiplos espaços internos em um único. Cobre variações de digitação no NBS
 * (ex: "BRONCO  SPORT" com 2 espaços vs "BRONCO SPORT").
 */
function normalizar(s: string): string {
  return s.trim().toUpperCase().replace(/\s+/g, " ");
}

const MESES_PT_BR = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function rotuloMes(d: Date): string {
  return `${MESES_PT_BR[d.getMonth()]}/${d.getFullYear()}`;
}

export function calcularEstatisticasModelo(
  veiculo: VeiculoParsed,
  vendas: VendaParsed[],
  custosPorPlaca: Record<string, CustoDetalhado>,
): EstatisticasModelo {
  const modeloNorm = normalizar(veiculo.modelo);
  const candidatas = vendas.filter((v) => normalizar(v.modelo) === modeloNorm);

  // "Mês de referência": último mês com vendas (de QUALQUER modelo) no dataset.
  // Evita métrica enganosa quando o usuário importa só vendas antigas — em
  // dataset histórico, "vendas no mês atual" sempre seria 0.
  let dataMaisRecente: Date | null = null;
  for (const v of vendas) {
    if (v.data_venda && (!dataMaisRecente || v.data_venda > dataMaisRecente)) {
      dataMaisRecente = v.data_venda;
    }
  }
  const referencia = dataMaisRecente ?? new Date();
  const inicioMes = new Date(referencia.getFullYear(), referencia.getMonth(), 1);
  const fimMes = new Date(referencia.getFullYear(), referencia.getMonth() + 1, 0, 23, 59, 59);
  const candidatasMes = candidatas.filter(
    (v) => v.data_venda && v.data_venda >= inicioMes && v.data_venda <= fimMes,
  );

  let precoSum = 0, precoCount = 0;
  let margemSum = 0, margemCount = 0;
  let diasSum = 0, diasCount = 0;
  let forplanSum = 0, forplanCount = 0;

  for (const v of candidatas) {
    if (v.valor_venda != null && v.valor_venda > 0) {
      precoSum += v.valor_venda;
      precoCount++;
    }
    if (
      v.valor_venda != null &&
      v.valor_venda > 0 &&
      v.custo_total_final != null
    ) {
      margemSum += ((v.valor_venda - v.custo_total_final) / v.valor_venda) * 100;
      margemCount++;
    }
    if (v.dias_estoque != null && v.dias_estoque >= 0) {
      diasSum += v.dias_estoque;
      diasCount++;
    }
    // Normaliza placa em ambos os lados pra evitar mismatch (XLS vendas vs XLS custos).
    const placaKey = v.placa ? normalizarPlaca(v.placa) : "";
    const c = placaKey ? custosPorPlaca[placaKey] ?? custosPorPlaca[v.placa ?? ""] : null;
    if (c?.forplan != null && c.forplan > 0) {
      forplanSum += c.forplan;
      forplanCount++;
    }
  }

  return {
    qtVendidasTotal: candidatas.length,
    qtVendidasMesAtual: candidatasMes.length,
    mesReferenciaLabel: rotuloMes(referencia),
    precoMedioVenda: precoCount > 0 ? precoSum / precoCount : null,
    margemMediaPct: margemCount > 0 ? margemSum / margemCount : null,
    diasEstoqueMedio: diasCount > 0 ? Math.round(diasSum / diasCount) : null,
    floorPlanMedio: forplanCount > 0 ? forplanSum / forplanCount : null,
    modeloReferencia: veiculo.modelo,
  };
}
