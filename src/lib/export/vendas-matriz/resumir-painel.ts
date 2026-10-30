/**
 * VENDAS USADOS MATRIZ — números do painel executivo (/vendas-usados-matriz).
 *
 * Função PURA sobre as MESMAS linhas que alimentam o Excel (`montarLinhasMes` em
 * coletar-dados.ts) e com os MESMOS filtros de gerar-workbook.ts / aba-resumo.ts:
 * - Origem: própria = `lojaOrigemCodEmpresa === codEmpresa`; outras = conhecida e
 *   diferente; não identificada = `null`.
 * - Consignado: entra em toda CONTAGEM, sai de toda MARGEM/receita/ticket (ressalva
 *   @aria-architect 02/10/2026, ver tipos.ts).
 * - Margem = soma de `calcularDerivadosLinha().margemLiquida` via `somaCampo` — a mesma
 *   conta (mesma ordem de soma) do cache do bloco "VENDIDO TOTAL" da aba MARGENS, então
 *   bate centavo a centavo.
 *
 * Compradores (decisão do Marcos): PF × PJ por `clienteTipo` (vendas.cliente_tipo), NÃO
 * pela regra `lojista`. Auto Avaliar é categoria própria e sai de PF/PJ (contagem e
 * margem). `clienteTipo = null` (fora Auto Avaliar) → "Não informado". Assim
 * total = PF + PJ + Auto Avaliar + Não informado, sempre.
 */

import {
  ORDEM_ORIGEM,
  calcularDerivadosLinha,
  classificarOrigem,
  isAutoAvaliar,
  type LinhaVendaMatriz,
  type OrigemChave,
} from "./tipos";
import { somaCampo } from "./aba-margens";
import { hojeLocal } from "@/lib/utils/data-local";

// ═══════════════════════════════════════════════════════════════════════════
// Calendário
// ═══════════════════════════════════════════════════════════════════════════

export function mesAnterior(mes: number, ano: number): { mes: number; ano: number } {
  return mes === 1 ? { mes: 12, ano: ano - 1 } : { mes: mes - 1, ano };
}

export function diasNoMes(mes: number, ano: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

export type CorteComparacao = {
  /** Mês selecionado é o mês corrente (dados até hoje). */
  parcial: boolean;
  /** Dia de hoje quando `parcial`; `null` em mês fechado. */
  diaHoje: number | null;
  mesAnterior: { mes: number; ano: number };
  /** Último dia (inclusive) do mês anterior que entra na comparação. */
  diaFimAnterior: number;
  /** `true` quando a comparação usa o mês anterior inteiro. */
  mesAnteriorInteiro: boolean;
};

/**
 * Mês corrente: compara com o mês anterior de 1 até o mesmo dia (se o mês anterior for
 * mais curto que o dia de hoje, usa ele inteiro). Mês fechado: mês inteiro × mês inteiro.
 * `hojeISO` = YYYY-MM-DD em Brasília (`hojeLocal()`).
 */
export function definirCorte(mes: number, ano: number, hojeISO: string): CorteComparacao {
  const anterior = mesAnterior(mes, ano);
  const diasAnterior = diasNoMes(anterior.mes, anterior.ano);
  const parcial = hojeISO.slice(0, 7) === `${ano}-${String(mes).padStart(2, "0")}`;
  const diaHoje = parcial ? Number(hojeISO.slice(8, 10)) : null;
  const diaFimAnterior = diaHoje != null ? Math.min(diaHoje, diasAnterior) : diasAnterior;
  return { parcial, diaHoje, mesAnterior: anterior, diaFimAnterior, mesAnteriorInteiro: diaFimAnterior === diasAnterior };
}

/** Dia do mês (1-31) da venda no calendário de Brasília. */
export function diaBrasilia(d: Date): number {
  return Number(hojeLocal(d).slice(8, 10));
}

/** Mês (1-12) da venda no calendário de Brasília. */
export function mesBrasilia(d: Date): number {
  return Number(hojeLocal(d).slice(5, 7));
}

// ═══════════════════════════════════════════════════════════════════════════
// Recortes
// ═══════════════════════════════════════════════════════════════════════════

// Regra de origem mora em tipos.ts (compartilhada com o Excel); reexportada aqui por compatibilidade.
export { ORDEM_ORIGEM, classificarOrigem, type OrigemChave };

export type CompradorChave = "pf" | "pj" | "autoAvaliar" | "naoInformado";

/** Auto Avaliar tem precedência sobre `clienteTipo` — conta só como Auto Avaliar. */
export function classificarComprador(l: LinhaVendaMatriz): CompradorChave {
  if (isAutoAvaliar(l)) return "autoAvaliar";
  if (l.clienteTipo === "PF") return "pf";
  if (l.clienteTipo === "PJ") return "pj";
  return "naoInformado";
}

export type MetricasRecorte = {
  /** Todas as vendas do recorte, consignado incluso. */
  qtd: number;
  qtdConsignadas: number;
  /** Vendas que entram na margem (sem consignado). */
  qtdComMargem: number;
  /** Soma do valor de venda sem consignado (= "Valor da Venda" da aba MARGENS). */
  receita: number;
  /** Margem líquida sem consignado; `null` quando não há venda que entre na margem. */
  margem: number | null;
  /** Fração (0,052 = 5,2%) — margem ÷ receita; `null` sem margem ou receita ≤ 0. */
  margemPct: number | null;
  /** receita ÷ qtdComMargem (mesma conta do "Ticket Médio" da aba MARGENS). */
  ticket: number | null;
};

export function metricasDe(linhas: LinhaVendaMatriz[]): MetricasRecorte {
  const comMargem = linhas.filter((l) => l.consignado === false);
  const receita = somaCampo(comMargem, (l) => l.valorVenda);
  const margem = comMargem.length > 0 ? somaCampo(comMargem, (l) => calcularDerivadosLinha(l).margemLiquida) : null;
  return {
    qtd: linhas.length,
    qtdConsignadas: linhas.length - comMargem.length,
    qtdComMargem: comMargem.length,
    receita,
    margem,
    margemPct: margem != null && receita > 0 ? margem / receita : null,
    ticket: comMargem.length > 0 ? receita / comMargem.length : null,
  };
}

function porOrigem(linhas: LinhaVendaMatriz[], codEmpresa: number): Record<OrigemChave, MetricasRecorte> {
  const grupos: Record<OrigemChave, LinhaVendaMatriz[]> = { proprio: [], outras: [], naoIdentificada: [] };
  for (const l of linhas) grupos[classificarOrigem(l, codEmpresa)].push(l);
  return {
    proprio: metricasDe(grupos.proprio),
    outras: metricasDe(grupos.outras),
    naoIdentificada: metricasDe(grupos.naoIdentificada),
  };
}

export type RecorteComprador = {
  metricas: MetricasRecorte;
  origem: Record<OrigemChave, MetricasRecorte>;
};

export type ResumoPeriodo = {
  total: MetricasRecorte;
  origem: Record<OrigemChave, MetricasRecorte>;
  pf: RecorteComprador;
  pj: RecorteComprador;
  /** Auto Avaliar e Não informado também têm margem (sem consignado) — pra a margem total fechar. */
  autoAvaliar: MetricasRecorte;
  naoInformado: MetricasRecorte;
};

export function resumirPeriodo(linhas: LinhaVendaMatriz[], codEmpresa: number): ResumoPeriodo {
  const pf = linhas.filter((l) => classificarComprador(l) === "pf");
  const pj = linhas.filter((l) => classificarComprador(l) === "pj");
  return {
    total: metricasDe(linhas),
    origem: porOrigem(linhas, codEmpresa),
    pf: { metricas: metricasDe(pf), origem: porOrigem(pf, codEmpresa) },
    pj: { metricas: metricasDe(pj), origem: porOrigem(pj, codEmpresa) },
    autoAvaliar: metricasDe(linhas.filter((l) => classificarComprador(l) === "autoAvaliar")),
    naoInformado: metricasDe(linhas.filter((l) => classificarComprador(l) === "naoInformado")),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Painel
// ═══════════════════════════════════════════════════════════════════════════

export type PainelMatriz = {
  mes: number;
  ano: number;
  corte: CorteComparacao;
  atual: ResumoPeriodo;
  /** Mês anterior já cortado conforme `corte`. */
  anterior: ResumoPeriodo;
};

export type ResumirPainelMatrizInput = {
  /** Linhas do mês selecionado (`montarLinhasMes`). */
  linhasMes: LinhaVendaMatriz[];
  /** Linhas do mês anterior INTEIRO (`montarLinhasMes`) — o corte é aplicado aqui. */
  linhasMesAnterior: LinhaVendaMatriz[];
  codEmpresa: number;
  mes: number;
  ano: number;
  /** YYYY-MM-DD em Brasília (`hojeLocal()`). */
  hoje: string;
};

export function resumirPainelMatriz(input: ResumirPainelMatrizInput): PainelMatriz {
  const { linhasMes, linhasMesAnterior, codEmpresa, mes, ano, hoje } = input;
  const corte = definirCorte(mes, ano, hoje);
  const anteriorCortado = corte.mesAnteriorInteiro
    ? linhasMesAnterior
    : linhasMesAnterior.filter((l) => l.dataVenda != null && diaBrasilia(l.dataVenda) <= corte.diaFimAnterior);
  return {
    mes,
    ano,
    corte,
    atual: resumirPeriodo(linhasMes, codEmpresa),
    anterior: resumirPeriodo(anteriorCortado, codEmpresa),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Delta MoM
// ═══════════════════════════════════════════════════════════════════════════

export type Delta =
  /** Base ausente (mês anterior sem venda / métrica sem valor no mês anterior). */
  | { tipo: "semBase" }
  /** Base = 0: só o absoluto (nunca "+∞%"). */
  | { tipo: "absoluto"; abs: number }
  /** `pct` em pontos de % (12,5 = +12,5%). */
  | { tipo: "percentual"; abs: number; pct: number }
  /** Margem %: diferença em pontos percentuais (1,2 = +1,2 p.p.), nunca % de %. */
  | { tipo: "pontos"; pp: number };

/**
 * `modo = "pontos"` pra métricas que já são fração (margem %): delta em p.p.
 * `atual = null` → `null` (não há o que comparar; a UI mostra "—").
 */
export function calcularDelta(atual: number | null, anterior: number | null, modo: "valor" | "pontos"): Delta | null {
  if (atual == null) return null;
  if (anterior == null) return { tipo: "semBase" };
  if (modo === "pontos") return { tipo: "pontos", pp: (atual - anterior) * 100 };
  const abs = atual - anterior;
  if (anterior === 0) return { tipo: "absoluto", abs };
  return { tipo: "percentual", abs, pct: (abs / Math.abs(anterior)) * 100 };
}

// ═══════════════════════════════════════════════════════════════════════════
// Participação na margem (modo "Margem R$" do bloco de origem)
// ═══════════════════════════════════════════════════════════════════════════

export type ParticipacaoMargem = {
  /**
   * "positivo"/"negativo" = todas as margens conhecidas têm o mesmo sinal → participação
   * = parte ÷ total (soma 100%). "misto" = sinais diferentes → participação não tem
   * leitura honesta, não exibir. "vazio" = nenhuma margem conhecida.
   */
  sinal: "positivo" | "negativo" | "misto" | "vazio";
  /** Em pontos de % (53,1 = 53,1%); `null` quando não exibir. */
  participacoes: (number | null)[];
  /** 0–100, proporcional a |margem| ÷ max|margem|. */
  larguras: number[];
};

export function participacaoMargem(margens: (number | null)[]): ParticipacaoMargem {
  const conhecidas = margens.filter((m): m is number => m != null);
  const maxAbs = conhecidas.reduce((s, m) => Math.max(s, Math.abs(m)), 0);
  const larguras = margens.map((m) => (m != null && maxAbs > 0 ? (Math.abs(m) / maxAbs) * 100 : 0));
  const temPos = conhecidas.some((m) => m > 0);
  const temNeg = conhecidas.some((m) => m < 0);
  const sinal = temPos && temNeg ? "misto" : temNeg ? "negativo" : temPos ? "positivo" : "vazio";
  const total = conhecidas.reduce((s, m) => s + m, 0);
  const participacoes =
    sinal === "positivo" || sinal === "negativo" ? margens.map((m) => (m != null ? (m / total) * 100 : null)) : margens.map(() => null);
  return { sinal, participacoes, larguras };
}
