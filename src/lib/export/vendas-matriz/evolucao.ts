/**
 * VENDAS USADOS MATRIZ — aba "Evolução" do painel (séries puras, sem Recharts).
 *
 * - `serieDiaria`: dia a dia do mês selecionado × mês anterior, acumulado. Usa o MESMO
 *   corte do KPI da Fase 1 (`definirCorte`): no mês parcial, o mês selecionado vai até hoje
 *   e o anterior é dividido em "até o corte" / "depois do corte". O acumulado no dia de
 *   corte = número do KPI.
 * - `serieMensal`: jan até o mês selecionado, a partir das linhas do ano
 *   (`montarLinhasAno`), com quebra por origem e por comprador.
 *
 * Consignado conta em Vendas e sai de Margem R$ / Margem % (regra da Fase 1).
 */

import { somaCampo } from "./aba-margens";
import {
  classificarComprador,
  diaBrasilia,
  diasNoMes,
  mesBrasilia,
  metricasDe,
  type CompradorChave,
  type CorteComparacao,
  type MetricasRecorte,
} from "./resumir-painel";
import { ORDEM_ORIGEM, calcularDerivadosLinha, classificarOrigem, type LinhaVendaMatriz, type OrigemChave } from "./tipos";

// ═══════════════════════════════════════════════════════════════════════════
// Dia a dia
// ═══════════════════════════════════════════════════════════════════════════

export type PontoDiario = {
  dia: number;
  /** Vendas no dia (consignado incluso). `null` depois de hoje no mês parcial. */
  noDiaQtd: number | null;
  /** Margem do dia (sem consignado). */
  noDiaMargem: number | null;
  acumQtd: number | null;
  acumMargem: number | null;
  /** Mês anterior, acumulado até este dia (`null` se o mês anterior não tem este dia). */
  antQtd: number | null;
  antMargem: number | null;
  /** Mesmo valor de `ant*`, separado em 2 trechos pelo dia de corte (o trecho "depois" fica apagado no gráfico). */
  antAteCorteQtd: number | null;
  antDepoisQtd: number | null;
  antAteCorteMargem: number | null;
  antDepoisMargem: number | null;
};

export type SerieDiaria = {
  pontos: PontoDiario[];
  /** Último dia com dado do mês selecionado (hoje no parcial; último dia no fechado). */
  diaCorte: number;
  /** Último dia do mês anterior que entra na comparação. */
  diaCorteAnterior: number;
  parcial: boolean;
  /** Totais no corte — iguais aos KPIs do Resumo. */
  qtdAtual: number;
  qtdAnterior: number;
  margemAtual: number;
  margemAnterior: number;
};

const margemSemConsig = (l: LinhaVendaMatriz): number | null => (l.consignado ? null : calcularDerivadosLinha(l).margemLiquida);

function porDia(linhas: LinhaVendaMatriz[], nDias: number): { qtd: number[]; margem: number[] } {
  const grupos: LinhaVendaMatriz[][] = Array.from({ length: nDias }, () => []);
  for (const l of linhas) {
    if (l.dataVenda == null) continue;
    const d = diaBrasilia(l.dataVenda);
    if (d >= 1 && d <= nDias) grupos[d - 1].push(l);
  }
  return { qtd: grupos.map((g) => g.length), margem: grupos.map((g) => somaCampo(g, margemSemConsig)) };
}

function acumular(v: number[]): number[] {
  let s = 0;
  return v.map((x) => (s += x));
}

export function serieDiaria(input: {
  linhasMes: LinhaVendaMatriz[];
  linhasMesAnterior: LinhaVendaMatriz[];
  mes: number;
  ano: number;
  corte: CorteComparacao;
}): SerieDiaria {
  const { linhasMes, linhasMesAnterior, mes, ano, corte } = input;
  const nDias = diasNoMes(mes, ano);
  const nDiasAnt = diasNoMes(corte.mesAnterior.mes, corte.mesAnterior.ano);
  const diaCorte = corte.diaHoje ?? nDias;
  const diaCorteAnterior = corte.diaFimAnterior;

  const atual = porDia(linhasMes, nDias);
  const ant = porDia(linhasMesAnterior, nDiasAnt);
  const acQ = acumular(atual.qtd);
  const acM = acumular(atual.margem);
  const antQ = acumular(ant.qtd);
  const antM = acumular(ant.margem);

  const pontos: PontoDiario[] = Array.from({ length: nDias }, (_, i) => {
    const dia = i + 1;
    const temAtual = dia <= diaCorte;
    const temAnt = dia <= nDiasAnt;
    const aQ = temAnt ? antQ[i] : null;
    const aM = temAnt ? antM[i] : null;
    // Sem corte (mês fechado ou anterior inteiro): tudo no trecho "até o corte".
    const ateCorte = !corte.parcial || dia <= diaCorteAnterior;
    const depois = corte.parcial && dia >= diaCorteAnterior;
    return {
      dia,
      noDiaQtd: temAtual ? atual.qtd[i] : null,
      noDiaMargem: temAtual ? atual.margem[i] : null,
      acumQtd: temAtual ? acQ[i] : null,
      acumMargem: temAtual ? acM[i] : null,
      antQtd: aQ,
      antMargem: aM,
      antAteCorteQtd: ateCorte ? aQ : null,
      antDepoisQtd: depois ? aQ : null,
      antAteCorteMargem: ateCorte ? aM : null,
      antDepoisMargem: depois ? aM : null,
    };
  });

  return {
    pontos,
    diaCorte,
    diaCorteAnterior,
    parcial: corte.parcial,
    qtdAtual: acQ[Math.min(diaCorte, nDias) - 1] ?? 0,
    qtdAnterior: antQ[Math.min(diaCorteAnterior, nDiasAnt) - 1] ?? 0,
    margemAtual: acM[Math.min(diaCorte, nDias) - 1] ?? 0,
    margemAnterior: antM[Math.min(diaCorteAnterior, nDiasAnt) - 1] ?? 0,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Mês a mês no ano
// ═══════════════════════════════════════════════════════════════════════════

export type PontoMensal = {
  mes: number;
  parcial: boolean;
  /** `true` = mês selecionado. */
  selecionado: boolean;
  total: MetricasRecorte;
  origem: Record<OrigemChave, MetricasRecorte>;
  comprador: Record<CompradorChave, MetricasRecorte>;
};

export type SerieMensal = {
  ano: number;
  meses: PontoMensal[];
  /** Média dos meses FECHADOS anteriores ao selecionado; `null` se não houver nenhum. */
  media: { qtd: number; margem: number; meses: number[] } | null;
};

const COMPRADORES: readonly CompradorChave[] = ["pf", "pj", "autoAvaliar", "naoInformado"];

export function serieMensal(input: {
  linhasAno: LinhaVendaMatriz[];
  codEmpresa: number;
  ano: number;
  /** Mês selecionado (1-12): a série vai de janeiro até ele. */
  ateMes: number;
  /** YYYY-MM-DD em Brasília. */
  hoje: string;
}): SerieMensal {
  const { linhasAno, codEmpresa, ano, ateMes, hoje } = input;
  const grupos: LinhaVendaMatriz[][] = Array.from({ length: ateMes }, () => []);
  for (const l of linhasAno) {
    if (l.dataVenda == null) continue;
    const m = mesBrasilia(l.dataVenda);
    if (m >= 1 && m <= ateMes) grupos[m - 1].push(l);
  }
  const mesHoje = hoje.slice(0, 7);
  const meses: PontoMensal[] = grupos.map((linhas, i) => {
    const mes = i + 1;
    const origem = Object.fromEntries(
      ORDEM_ORIGEM.map((o) => [o, metricasDe(linhas.filter((l) => classificarOrigem(l, codEmpresa) === o))]),
    ) as Record<OrigemChave, MetricasRecorte>;
    const comprador = Object.fromEntries(
      COMPRADORES.map((c) => [c, metricasDe(linhas.filter((l) => classificarComprador(l) === c))]),
    ) as Record<CompradorChave, MetricasRecorte>;
    return {
      mes,
      parcial: `${ano}-${String(mes).padStart(2, "0")}` === mesHoje,
      selecionado: mes === ateMes,
      total: metricasDe(linhas),
      origem,
      comprador,
    };
  });
  const fechados = meses.filter((m) => m.mes < ateMes && !m.parcial);
  const media =
    fechados.length > 0
      ? {
          qtd: fechados.reduce((s, m) => s + m.total.qtd, 0) / fechados.length,
          margem: fechados.reduce((s, m) => s + (m.total.margem ?? 0), 0) / fechados.length,
          meses: fechados.map((m) => m.mes),
        }
      : null;
  return { ano, meses, media };
}
