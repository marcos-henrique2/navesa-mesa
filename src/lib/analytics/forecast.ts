/**
 * Forecast simples de vendas — projeção do total de vendas no mês corrente
 * combinando moving average dos últimos N meses + ajuste sazonal.
 *
 * Não é deep learning — é um método estatístico básico que funciona bem em
 * datasets pequenos. Pra concessionária ~150-300 vendas/mês, captura padrões
 * razoavelmente.
 *
 * Pra cada modelo:
 *   1. Pega média móvel dos últimos 3-6 meses (linha base)
 *   2. Aplica índice sazonal do mês corrente (se modelo tem suficiente histórico)
 *   3. Output: vendas esperadas + intervalo de confiança
 */

import type { VendaParsed } from "@/lib/parsers/nbs-vendas-xlsx";
import { calcularSazonalidadeGeral, calcularSazonalidadeTopModelos } from "./sazonalidade";

const MESES_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export type ForecastMes = {
  ano: number;
  mes: number;
  rotulo: string;
  /** Vendas realizadas no mês. Quando é mês corrente, parcial até a data mais recente. */
  realizadas: number;
  /** Projeção total esperada no mês (combinando histórico + sazonalidade). */
  projecaoTotal: number;
  /** Intervalo de confiança ±N (1 desvio padrão). */
  intervaloMin: number;
  intervaloMax: number;
  /** True se o mês ainda está em andamento (último mês do dataset). */
  corrente: boolean;
};

export type ForecastResultado = {
  /** Mês corrente sendo projetado. */
  mesCorrente: ForecastMes;
  /** Histórico dos últimos meses como contexto. */
  historico: ForecastMes[];
  /** Média móvel usada como base. */
  mediaMovel: number;
  /** Índice sazonal aplicado pro mês corrente. */
  indiceSazonal: number;
  /** Confiança da projeção: 'alta' (muitos meses) | 'media' | 'baixa'. */
  confianca: "alta" | "media" | "baixa";
};

function normalizarModelo(s: string): string {
  return s.trim().toUpperCase().replace(/\s+/g, " ");
}

/**
 * Agrega vendas por (ano, mês) e retorna array ordenado cronologicamente.
 */
function agregarPorMes(vendas: VendaParsed[]): {
  ano: number;
  mes: number;
  qt: number;
}[] {
  const map = new Map<string, { ano: number; mes: number; qt: number }>();
  for (const v of vendas) {
    if (!v.data_venda) continue;
    const ano = v.data_venda.getFullYear();
    const mes = v.data_venda.getMonth() + 1;
    const k = `${ano}-${mes}`;
    if (!map.has(k)) map.set(k, { ano, mes, qt: 0 });
    map.get(k)!.qt++;
  }
  return [...map.values()].sort((a, b) => (a.ano - b.ano) * 100 + (a.mes - b.mes));
}

/**
 * Calcula desvio padrão de um array de números.
 */
function desvioPadrao(valores: number[]): number {
  if (valores.length < 2) return 0;
  const media = valores.reduce((s, v) => s + v, 0) / valores.length;
  const varianza =
    valores.reduce((s, v) => s + (v - media) ** 2, 0) / (valores.length - 1);
  return Math.sqrt(varianza);
}

/**
 * Forecast geral de vendas (todos os modelos) pro mês corrente do dataset.
 * O "mês corrente" é o último mês com vendas no dataset.
 *
 * Pode opcionalmente filtrar por loja (cod_empresa) — útil pra projeções
 * localizadas ("Ford Aeroporto vai fechar com X vendas").
 */
export function calcularForecastGeral(
  vendas: VendaParsed[],
  opts: { lojaFiltro?: number | null } = {},
): ForecastResultado | null {
  const vendasFiltradas =
    opts.lojaFiltro != null
      ? vendas.filter((v) => v.cod_empresa === opts.lojaFiltro)
      : vendas;
  const porMes = agregarPorMes(vendasFiltradas);
  if (porMes.length < 2) return null;

  // Último mês do dataset = mês "corrente" sendo projetado
  const corrente = porMes[porMes.length - 1];
  // Histórico = todos os meses ANTERIORES (não inclui o corrente porque é parcial)
  const historico = porMes.slice(0, -1);
  if (historico.length === 0) return null;

  // Moving average dos últimos 3-6 meses (3 se tem pouco histórico, 6 se tem muito)
  const janela = Math.min(6, Math.max(3, historico.length));
  const ultimosNMeses = historico.slice(-janela);
  const mediaMovel =
    ultimosNMeses.reduce((s, m) => s + m.qt, 0) / ultimosNMeses.length;

  // Ajuste sazonal: pega índice sazonal do mês corrente
  const sazonalidade = calcularSazonalidadeGeral(vendasFiltradas);
  const idxSazonal = sazonalidade?.meses.find((m) => m.mes === corrente.mes);
  const indiceSazonal = idxSazonal && idxSazonal.indice > 0 ? idxSazonal.indice : 1;

  const projecaoTotal = Math.round(mediaMovel * indiceSazonal);

  // Confiança: baseada em quantos meses temos
  let confianca: "alta" | "media" | "baixa" = "baixa";
  if (historico.length >= 12) confianca = "alta";
  else if (historico.length >= 6) confianca = "media";

  // Intervalo de confiança: ±1 desvio padrão do histórico
  const dp = desvioPadrao(ultimosNMeses.map((m) => m.qt));

  const historicoForm: ForecastMes[] = historico.map((m) => ({
    ano: m.ano,
    mes: m.mes,
    rotulo: `${MESES_PT[m.mes - 1]}/${m.ano}`,
    realizadas: m.qt,
    projecaoTotal: m.qt,
    intervaloMin: m.qt,
    intervaloMax: m.qt,
    corrente: false,
  }));

  const mesCorrente: ForecastMes = {
    ano: corrente.ano,
    mes: corrente.mes,
    rotulo: `${MESES_PT[corrente.mes - 1]}/${corrente.ano}`,
    realizadas: corrente.qt,
    projecaoTotal,
    intervaloMin: Math.max(corrente.qt, Math.round(projecaoTotal - dp)),
    intervaloMax: Math.round(projecaoTotal + dp),
    corrente: true,
  };

  return {
    mesCorrente,
    historico: historicoForm,
    mediaMovel,
    indiceSazonal,
    confianca,
  };
}

export type ForecastPorModelo = {
  modelo: string;
  historicoUltimoMes: number;
  projecaoEsteMes: number;
  variacao: number;
};

export type ForecastPorLoja = {
  loja: number;
  realizadasEsteMes: number;
  projecaoTotal: number;
  variacao: number;
};

/**
 * Forecast por loja: pra cada loja com >=2 meses de histórico, calcula
 * a projeção do mês corrente. Útil pra ver onde está abaixo/acima do esperado.
 */
export function calcularForecastPorLoja(vendas: VendaParsed[]): ForecastPorLoja[] {
  const lojas = [...new Set(vendas.map((v) => v.cod_empresa).filter((c): c is number => c != null))];
  const out: ForecastPorLoja[] = [];
  for (const loja of lojas) {
    const r = calcularForecastGeral(vendas, { lojaFiltro: loja });
    if (!r) continue;
    out.push({
      loja,
      realizadasEsteMes: r.mesCorrente.realizadas,
      projecaoTotal: r.mesCorrente.projecaoTotal,
      variacao: r.mesCorrente.realizadas - r.mesCorrente.projecaoTotal,
    });
  }
  return out.sort((a, b) => b.projecaoTotal - a.projecaoTotal);
}

/**
 * Forecast por modelo: compara realizado do mês anterior vs projeção do corrente.
 * Útil pra ver onde tá "abaixo do esperado".
 *
 * Aceita `lojaFiltro` opcional pra projetar só os modelos vendidos por uma loja
 * específica — mantém consistência com `calcularForecastGeral`.
 */
export function calcularForecastPorModelo(
  vendas: VendaParsed[],
  opts: { topN?: number; lojaFiltro?: number | null } = {},
): ForecastPorModelo[] {
  const topN = opts.topN ?? 10;
  vendas =
    opts.lojaFiltro != null
      ? vendas.filter((v) => v.cod_empresa === opts.lojaFiltro)
      : vendas;

  // Top modelos com mais vendas históricas
  const sazonalidades = calcularSazonalidadeTopModelos(vendas, {}, { topN, minVendas: 6 });

  const out: ForecastPorModelo[] = [];

  // Mês corrente do dataset
  const porMesGeral = agregarPorMes(vendas);
  if (porMesGeral.length < 2) return out;
  const mesCorrente = porMesGeral[porMesGeral.length - 1];

  for (const saz of sazonalidades) {
    // Vendas do modelo nesse modelo
    const vendasModelo = vendas.filter(
      (v) => normalizarModelo(v.modelo) === saz.modelo,
    );
    const porMesModelo = agregarPorMes(vendasModelo);
    if (porMesModelo.length < 2) continue;

    // Realizado mês anterior do modelo
    const mesAnterior = porMesModelo[porMesModelo.length - 2];
    const mesCorrenteModelo = porMesModelo[porMesModelo.length - 1];

    // Média móvel últimos 3 meses do modelo
    const ultimosN = porMesModelo.slice(-Math.min(3, porMesModelo.length - 1), -1);
    const media =
      ultimosN.length > 0
        ? ultimosN.reduce((s, m) => s + m.qt, 0) / ultimosN.length
        : mesAnterior.qt;

    // Ajuste sazonal
    const idxSazonal = saz.meses.find((m) => m.mes === mesCorrente.mes);
    const indice = idxSazonal && idxSazonal.indice > 0 ? idxSazonal.indice : 1;
    const projecao = Math.round(media * indice);

    out.push({
      modelo: saz.modelo,
      historicoUltimoMes: mesAnterior.qt,
      projecaoEsteMes: projecao,
      variacao: projecao - mesCorrenteModelo.qt,
    });
  }

  return out.sort((a, b) => b.projecaoEsteMes - a.projecaoEsteMes);
}
