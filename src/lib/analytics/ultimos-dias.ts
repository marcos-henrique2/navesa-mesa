/**
 * Resumo dos últimos N dias do dataset de vendas.
 *
 * Usa como "hoje" a data da venda MAIS RECENTE no dataset — não a data real
 * do navegador. Isso evita métrica enganosa quando o usuário importa vendas
 * antigas (ex: dataset histórico de 2025 e abre o painel em 2026).
 */

import type { VendaParsed } from "@/lib/parsers/nbs-vendas-xlsx";
import type { CustoDetalhado } from "@/lib/parsers/nbs-custos-xls";

type CustosMap = Record<string, CustoDetalhado>;

export type ResumoUltimosDias = {
  /** Janela coberta. `fim` = venda mais recente do dataset. */
  inicio: Date;
  fim: Date;
  dias: number;
  qt: number;
  faturamento: number;
  margem: number;
  margemPct: number;
  ticketMedio: number;
  /** Compara com janela imediatamente anterior do mesmo tamanho. */
  vsAnterior: {
    qt: { abs: number; pct: number };
    faturamento: { abs: number; pct: number };
    margem: { abs: number; pct: number };
  } | null;
};

function calcMargem(v: VendaParsed, custosPorPlaca: CustosMap): { valor: number; margem: number } {
  const valor = v.valor_venda ?? 0;
  const custo = (v.placa ? custosPorPlaca[v.placa] : null)?.custo_total ?? v.custo_total_final ?? 0;
  return { valor, margem: valor - custo };
}

function pctVariacao(atual: number, anterior: number): number {
  if (anterior === 0) return atual > 0 ? 100 : 0;
  return ((atual - anterior) / Math.abs(anterior)) * 100;
}

function agregarJanela(
  vendas: VendaParsed[],
  custosPorPlaca: CustosMap,
  inicio: Date,
  fim: Date,
): { qt: number; faturamento: number; margem: number } {
  let qt = 0;
  let faturamento = 0;
  let margem = 0;
  for (const v of vendas) {
    if (!v.data_venda) continue;
    const t = v.data_venda.getTime();
    if (t < inicio.getTime() || t > fim.getTime()) continue;
    const m = calcMargem(v, custosPorPlaca);
    qt++;
    faturamento += m.valor;
    margem += m.margem;
  }
  return { qt, faturamento, margem };
}

/**
 * Gera resumo dos últimos N dias do dataset. Retorna null se não tem vendas.
 */
export function resumoUltimosDias(
  vendas: VendaParsed[],
  custosPorPlaca: CustosMap,
  dias: number = 7,
): ResumoUltimosDias | null {
  // Acha a venda mais recente como "hoje"
  let dataMaisRecente: Date | null = null;
  for (const v of vendas) {
    if (v.data_venda && (!dataMaisRecente || v.data_venda > dataMaisRecente)) {
      dataMaisRecente = v.data_venda;
    }
  }
  if (!dataMaisRecente) return null;

  // Janela atual: últimos `dias` dias, terminando na venda mais recente
  const MS_DIA = 24 * 60 * 60 * 1000;
  const fim = new Date(dataMaisRecente.getFullYear(), dataMaisRecente.getMonth(), dataMaisRecente.getDate(), 23, 59, 59);
  const inicio = new Date(fim.getTime() - (dias - 1) * MS_DIA);
  inicio.setHours(0, 0, 0, 0);

  const atual = agregarJanela(vendas, custosPorPlaca, inicio, fim);

  // Janela anterior: `dias` dias imediatamente antes
  const fimAnt = new Date(inicio.getTime() - MS_DIA);
  const inicioAnt = new Date(fimAnt.getTime() - (dias - 1) * MS_DIA);
  inicioAnt.setHours(0, 0, 0, 0);
  fimAnt.setHours(23, 59, 59, 999);
  const anterior = agregarJanela(vendas, custosPorPlaca, inicioAnt, fimAnt);

  const vsAnterior = anterior.qt > 0 || anterior.faturamento > 0
    ? {
      qt: { abs: atual.qt - anterior.qt, pct: pctVariacao(atual.qt, anterior.qt) },
      faturamento: { abs: atual.faturamento - anterior.faturamento, pct: pctVariacao(atual.faturamento, anterior.faturamento) },
      margem: { abs: atual.margem - anterior.margem, pct: pctVariacao(atual.margem, anterior.margem) },
    }
    : null;

  return {
    inicio,
    fim,
    dias,
    qt: atual.qt,
    faturamento: atual.faturamento,
    margem: atual.margem,
    margemPct: atual.faturamento > 0 ? (atual.margem / atual.faturamento) * 100 : 0,
    ticketMedio: atual.qt > 0 ? atual.faturamento / atual.qt : 0,
    vsAnterior,
  };
}
