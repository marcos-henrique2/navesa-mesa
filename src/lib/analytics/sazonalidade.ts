/**
 * Sazonalidade — padrão de vendas por mês do ano por modelo (e geral).
 *
 * Pra um dataset com N meses de histórico, calcula:
 *   - Quantas vendas TÍPICAS cada mês historicamente teve
 *   - Quais meses "puxam" e quais "drenam" pra cada modelo
 *   - Índice sazonal (1.0 = média, >1.0 = mês forte, <1.0 = mês fraco)
 *
 * Útil pra: "Junho historicamente é fraco pra Bronco, vou comprar menos"
 * ou pra ajustar forecast considerando o mês corrente.
 */

import type { VendaParsed } from "@/lib/parsers/nbs-vendas-xlsx";

export type SazonalidadeMes = {
  /** Número do mês (1-12). */
  mes: number;
  /** Label PT-BR ("jan", "fev"...). */
  rotulo: string;
  /** Total de vendas históricas nesse mês (somando anos). */
  totalVendas: number;
  /** Média de vendas por ano nesse mês. */
  mediaPorAno: number;
  /** Índice sazonal: media do mês ÷ media geral. 1.0 = típico, >1.2 = forte, <0.8 = fraco. */
  indice: number;
  /** Anos distintos com dado pra esse mês. */
  anosObservados: number;
};

export type SazonalidadeModelo = {
  modelo: string;
  totalVendasModelo: number;
  /** Média anual de vendas do modelo. */
  mediaAnualGeral: number;
  meses: SazonalidadeMes[];
  /** Mês mais forte e mais fraco (índice > 1.2 / < 0.8). */
  mesPico: SazonalidadeMes | null;
  mesVale: SazonalidadeMes | null;
};

const MESES_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function normalizarModelo(s: string): string {
  return s.trim().toUpperCase().replace(/\s+/g, " ");
}

/**
 * Calcula sazonalidade geral (todos os modelos juntos).
 * Útil pro overview do dashboard.
 */
export function calcularSazonalidadeGeral(vendas: VendaParsed[]): SazonalidadeModelo | null {
  if (vendas.length === 0) return null;

  // {mes: {totalVendas, anosVistos: Set}}
  const porMes = new Map<number, { total: number; anos: Set<number> }>();
  const todosAnos = new Set<number>();

  for (const v of vendas) {
    if (!v.data_venda) continue;
    const mes = v.data_venda.getMonth() + 1;
    const ano = v.data_venda.getFullYear();
    todosAnos.add(ano);
    if (!porMes.has(mes)) porMes.set(mes, { total: 0, anos: new Set() });
    const r = porMes.get(mes)!;
    r.total++;
    r.anos.add(ano);
  }

  const totalVendas = vendas.length;
  const totalAnos = todosAnos.size || 1;
  const mediaPorMesGeral = totalVendas / 12 / totalAnos;

  const meses: SazonalidadeMes[] = [];
  for (let m = 1; m <= 12; m++) {
    const r = porMes.get(m);
    if (!r) {
      meses.push({
        mes: m,
        rotulo: MESES_PT[m - 1],
        totalVendas: 0,
        mediaPorAno: 0,
        indice: 0,
        anosObservados: 0,
      });
      continue;
    }
    const anosObs = r.anos.size || 1;
    const media = r.total / anosObs;
    meses.push({
      mes: m,
      rotulo: MESES_PT[m - 1],
      totalVendas: r.total,
      mediaPorAno: media,
      indice: mediaPorMesGeral > 0 ? media / mediaPorMesGeral : 1,
      anosObservados: anosObs,
    });
  }

  const mesPico = meses.reduce<SazonalidadeMes | null>(
    (best, m) => (m.indice > 1.2 && (!best || m.indice > best.indice) ? m : best),
    null,
  );
  const mesVale = meses.reduce<SazonalidadeMes | null>(
    (worst, m) =>
      m.indice < 0.8 && m.indice > 0 && (!worst || m.indice < worst.indice) ? m : worst,
    null,
  );

  return {
    modelo: "TODOS",
    totalVendasModelo: totalVendas,
    mediaAnualGeral: totalVendas / totalAnos,
    meses,
    mesPico,
    mesVale,
  };
}

/**
 * Sazonalidade dos top-N modelos com mais histórico.
 * Modelos com menos de `minVendas` no histórico são ignorados (sazonalidade
 * é estatisticamente fraca).
 */
export function calcularSazonalidadeTopModelos(
  vendas: VendaParsed[],
  opts: { topN?: number; minVendas?: number } = {},
): SazonalidadeModelo[] {
  const topN = opts.topN ?? 10;
  const minVendas = opts.minVendas ?? 12;

  // Agrupa por modelo
  const porModelo = new Map<string, VendaParsed[]>();
  for (const v of vendas) {
    const m = normalizarModelo(v.modelo);
    if (!porModelo.has(m)) porModelo.set(m, []);
    porModelo.get(m)!.push(v);
  }

  // Filtra modelos com pelo menos minVendas
  const modelosElegiveis = [...porModelo.entries()]
    .filter(([, vds]) => vds.length >= minVendas)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, topN);

  return modelosElegiveis.map(([modelo, vds]) => {
    const r = calcularSazonalidadeGeral(vds);
    if (!r) {
      return {
        modelo,
        totalVendasModelo: 0,
        mediaAnualGeral: 0,
        meses: [],
        mesPico: null,
        mesVale: null,
      };
    }
    return { ...r, modelo };
  });
}
