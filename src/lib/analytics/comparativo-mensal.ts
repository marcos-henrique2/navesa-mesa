/**
 * Comparativo mensal — análise automática do último mês vs penúltimo.
 *
 * Pega os 2 últimos meses com dados e:
 *   1. Calcula deltas (qt, faturamento, margem, margem%, ticket médio)
 *   2. Identifica drivers da mudança (quais modelos/lojas puxaram pra cima ou baixo)
 *   3. Gera narrativa em bullets explicando o "porquê" dos números mudarem
 *
 * Objetivo: o gerente abre a tela e em 10 segundos entende o que aconteceu
 * em junho vs maio — sem precisar fazer análise manual.
 */

import type { VendaParsed } from "@/lib/parsers/nbs-vendas-xlsx";
import type { CustoDetalhado } from "@/lib/parsers/nbs-custos-xls";
import { vendasPorMes } from "./insights";

type CustosMap = Record<string, CustoDetalhado>;

const MESES_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export type MesResumo = {
  ano: number;
  mes: number;
  rotulo: string;
  qt: number;
  faturamento: number;
  margem: number;
  margemPct: number;
  ticketMedio: number;
};

export type DriverItem = {
  chave: string; // modelo ou loja
  qtAnterior: number;
  qtAtual: number;
  deltaQt: number;
  margemAnterior: number;
  margemAtual: number;
  deltaMargem: number;
};

export type ComparativoMensal = {
  ultimoMes: MesResumo;
  penultimoMes: MesResumo;
  deltas: {
    qt: { abs: number; pct: number };
    faturamento: { abs: number; pct: number };
    margem: { abs: number; pct: number };
    margemPct: { pp: number }; // pontos percentuais
    ticketMedio: { abs: number; pct: number };
  };
  drivers: {
    modelosSubiram: DriverItem[];
    modelosCairam: DriverItem[];
    lojasSubiram: DriverItem[];
    lojasCairam: DriverItem[];
  };
  narrativa: string[];
};

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function pctVariacao(atual: number, anterior: number): number {
  if (anterior === 0) return atual > 0 ? 100 : 0;
  return ((atual - anterior) / Math.abs(anterior)) * 100;
}

function calcMargemVenda(v: VendaParsed, custosPorPlaca: CustosMap): { valor: number; margem: number } {
  const valor = v.valor_venda ?? 0;
  const custo = (v.placa ? custosPorPlaca[v.placa] : null)?.custo_total ?? v.custo_total_final ?? 0;
  return { valor, margem: valor - custo };
}

function ehDoMes(d: Date | null, ano: number, mes: number): boolean {
  if (!d) return false;
  return d.getFullYear() === ano && d.getMonth() + 1 === mes;
}

function agrupar(
  vendas: VendaParsed[],
  custosPorPlaca: CustosMap,
  chave: (v: VendaParsed) => string,
): Map<string, { qt: number; valor: number; margem: number }> {
  const map = new Map<string, { qt: number; valor: number; margem: number }>();
  for (const v of vendas) {
    const k = chave(v);
    if (!k) continue;
    if (!map.has(k)) map.set(k, { qt: 0, valor: 0, margem: 0 });
    const r = map.get(k)!;
    const m = calcMargemVenda(v, custosPorPlaca);
    r.qt++;
    r.valor += m.valor;
    r.margem += m.margem;
  }
  return map;
}

/**
 * Cruza 2 mapas agregados (anterior, atual) e devolve top drivers ordenados
 * por contribuição absoluta na variação de quantidade vendida.
 */
function calcularDrivers(
  anterior: Map<string, { qt: number; margem: number }>,
  atual: Map<string, { qt: number; margem: number }>,
  topN: number,
): { subiram: DriverItem[]; cairam: DriverItem[] } {
  const todasChaves = new Set([...anterior.keys(), ...atual.keys()]);
  const items: DriverItem[] = [];
  for (const k of todasChaves) {
    const a = anterior.get(k) ?? { qt: 0, margem: 0 };
    const at = atual.get(k) ?? { qt: 0, margem: 0 };
    items.push({
      chave: k,
      qtAnterior: a.qt,
      qtAtual: at.qt,
      deltaQt: at.qt - a.qt,
      margemAnterior: a.margem,
      margemAtual: at.margem,
      deltaMargem: at.margem - a.margem,
    });
  }
  const subiram = items
    .filter((i) => i.deltaQt > 0)
    .sort((a, b) => b.deltaQt - a.deltaQt)
    .slice(0, topN);
  const cairam = items
    .filter((i) => i.deltaQt < 0)
    .sort((a, b) => a.deltaQt - b.deltaQt)
    .slice(0, topN);
  return { subiram, cairam };
}

// ──────────────────────────────────────────────────────────────────────────────
// Geração de narrativa
// ──────────────────────────────────────────────────────────────────────────────

function fmtPctSigned(pct: number): string {
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function fmtMoneyShort(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `R$ ${(v / 1_000).toFixed(0)}K`;
  return `R$ ${v.toFixed(0)}`;
}

function gerarNarrativa(
  atual: MesResumo,
  anterior: MesResumo,
  drivers: ComparativoMensal["drivers"],
): string[] {
  const out: string[] = [];

  // 1. Headline: o que mudou principal
  const deltaQt = atual.qt - anterior.qt;
  const deltaQtPct = pctVariacao(atual.qt, anterior.qt);
  const deltaMargemPp = atual.margemPct - anterior.margemPct;
  const deltaFatPct = pctVariacao(atual.faturamento, anterior.faturamento);

  if (deltaQt > 0 && deltaMargemPp > 0) {
    out.push(`📈 **Mês saudável**: vendeu ${deltaQt} carros a mais (${fmtPctSigned(deltaQtPct)}) e margem subiu ${deltaMargemPp.toFixed(2)}pp.`);
  } else if (deltaQt > 0 && deltaMargemPp < 0) {
    out.push(`⚠️ **Volume subiu, margem caiu**: +${deltaQt} carros (${fmtPctSigned(deltaQtPct)}) mas margem caiu ${Math.abs(deltaMargemPp).toFixed(2)}pp — vendeu mais barato.`);
  } else if (deltaQt < 0 && deltaMargemPp > 0) {
    out.push(`💼 **Vendeu menos, mas com mais margem**: ${deltaQt} carros (${fmtPctSigned(deltaQtPct)}) e margem subiu ${deltaMargemPp.toFixed(2)}pp.`);
  } else if (deltaQt < 0 && deltaMargemPp < 0) {
    out.push(`🚨 **Mês difícil**: ${deltaQt} carros (${fmtPctSigned(deltaQtPct)}) e margem caiu ${Math.abs(deltaMargemPp).toFixed(2)}pp.`);
  } else {
    out.push(`➡️ Mês estável vs ${anterior.rotulo}: ${deltaQt >= 0 ? "+" : ""}${deltaQt} carros, margem ${deltaMargemPp >= 0 ? "+" : ""}${deltaMargemPp.toFixed(2)}pp.`);
  }

  // 2. Faturamento
  if (Math.abs(deltaFatPct) >= 3) {
    const delta = atual.faturamento - anterior.faturamento;
    out.push(
      `Faturamento ${deltaFatPct >= 0 ? "subiu" : "caiu"} ${fmtPctSigned(Math.abs(deltaFatPct))} (${fmtMoneyShort(Math.abs(delta))}): ${fmtMoneyShort(atual.faturamento)} contra ${fmtMoneyShort(anterior.faturamento)} de ${anterior.rotulo}.`,
    );
  }

  // 3. Drivers positivos (modelos)
  if (drivers.modelosSubiram.length > 0) {
    const top3 = drivers.modelosSubiram.slice(0, 3);
    const lista = top3.map((m) => `**${m.chave}** (+${m.deltaQt})`).join(", ");
    out.push(`🟢 Modelos que mais cresceram: ${lista}.`);
  }

  // 4. Drivers negativos (modelos)
  if (drivers.modelosCairam.length > 0) {
    const top3 = drivers.modelosCairam.slice(0, 3);
    const lista = top3.map((m) => `**${m.chave}** (${m.deltaQt})`).join(", ");
    out.push(`🔴 Modelos que mais caíram: ${lista}.`);
  }

  // 5. Drivers lojas (só se tem variação relevante)
  const lojaTopUp = drivers.lojasSubiram[0];
  const lojaTopDown = drivers.lojasCairam[0];
  if (lojaTopUp && lojaTopUp.deltaQt >= 5) {
    out.push(`🏪 **${lojaTopUp.chave}** puxou pra cima: +${lojaTopUp.deltaQt} vendas vs ${anterior.rotulo}.`);
  }
  if (lojaTopDown && lojaTopDown.deltaQt <= -5) {
    out.push(`🏪 **${lojaTopDown.chave}** puxou pra baixo: ${lojaTopDown.deltaQt} vendas vs ${anterior.rotulo}.`);
  }

  // 6. Ticket médio (só se variar bastante)
  const deltaTicket = pctVariacao(atual.ticketMedio, anterior.ticketMedio);
  if (Math.abs(deltaTicket) >= 5) {
    out.push(
      `💰 Ticket médio ${deltaTicket >= 0 ? "subiu" : "caiu"} ${fmtPctSigned(Math.abs(deltaTicket))}: ${fmtMoneyShort(atual.ticketMedio)} ${deltaTicket >= 0 ? "contra" : "vs"} ${fmtMoneyShort(anterior.ticketMedio)} — ${deltaTicket >= 0 ? "vendeu carros mais caros em média" : "mix de venda mais barato"}.`,
    );
  }

  return out;
}

// ──────────────────────────────────────────────────────────────────────────────
// API pública
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Gera o comparativo mensal. Retorna null se não tem pelo menos 2 meses
 * com vendas no dataset (sem o que comparar).
 */
export function calcularComparativoMensal(
  vendas: VendaParsed[],
  custosPorPlaca: CustosMap,
): ComparativoMensal | null {
  const meses = vendasPorMes(vendas, custosPorPlaca);
  if (meses.length < 2) return null;

  const atual = meses[meses.length - 1];
  const anterior = meses[meses.length - 2];

  // Filtra vendas de cada mês
  const vendasAtual = vendas.filter((v) => ehDoMes(v.data_venda, atual.ano, atual.mes));
  const vendasAnterior = vendas.filter((v) => ehDoMes(v.data_venda, anterior.ano, anterior.mes));

  // Agrupa por modelo
  const modelosAnterior = agrupar(vendasAnterior, custosPorPlaca, (v) => v.modelo?.trim() ?? "");
  const modelosAtual = agrupar(vendasAtual, custosPorPlaca, (v) => v.modelo?.trim() ?? "");
  const driversModelos = calcularDrivers(modelosAnterior, modelosAtual, 5);

  // Agrupa por loja
  const lojasAnterior = agrupar(vendasAnterior, custosPorPlaca, (v) =>
    v.empresa_nome?.trim() ?? `Loja ${v.cod_empresa ?? "?"}`,
  );
  const lojasAtual = agrupar(vendasAtual, custosPorPlaca, (v) =>
    v.empresa_nome?.trim() ?? `Loja ${v.cod_empresa ?? "?"}`,
  );
  const driversLojas = calcularDrivers(lojasAnterior, lojasAtual, 3);

  const ultimoMes: MesResumo = {
    ano: atual.ano,
    mes: atual.mes,
    rotulo: atual.rotulo,
    qt: atual.qt,
    faturamento: atual.faturamento,
    margem: atual.margem,
    margemPct: atual.margemPct,
    ticketMedio: atual.ticketMedio,
  };
  const penultimoMes: MesResumo = {
    ano: anterior.ano,
    mes: anterior.mes,
    rotulo: anterior.rotulo,
    qt: anterior.qt,
    faturamento: anterior.faturamento,
    margem: anterior.margem,
    margemPct: anterior.margemPct,
    ticketMedio: anterior.ticketMedio,
  };

  const drivers = {
    modelosSubiram: driversModelos.subiram,
    modelosCairam: driversModelos.cairam,
    lojasSubiram: driversLojas.subiram,
    lojasCairam: driversLojas.cairam,
  };

  const narrativa = gerarNarrativa(ultimoMes, penultimoMes, drivers);

  return {
    ultimoMes,
    penultimoMes,
    deltas: {
      qt: { abs: ultimoMes.qt - penultimoMes.qt, pct: pctVariacao(ultimoMes.qt, penultimoMes.qt) },
      faturamento: { abs: ultimoMes.faturamento - penultimoMes.faturamento, pct: pctVariacao(ultimoMes.faturamento, penultimoMes.faturamento) },
      margem: { abs: ultimoMes.margem - penultimoMes.margem, pct: pctVariacao(ultimoMes.margem, penultimoMes.margem) },
      margemPct: { pp: ultimoMes.margemPct - penultimoMes.margemPct },
      ticketMedio: { abs: ultimoMes.ticketMedio - penultimoMes.ticketMedio, pct: pctVariacao(ultimoMes.ticketMedio, penultimoMes.ticketMedio) },
    },
    drivers,
    narrativa,
  };
}

export { MESES_PT };
