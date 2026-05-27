/**
 * SUGESTÃO DE PREÇO INTELIGENTE
 *
 * Combina 3 fontes:
 *   1. Histórico de vendas do mesmo modelo (preço mediano, margem média)
 *   2. FIPE (preço de referência de mercado)
 *   3. Custo total do carro (piso pra não dar prejuízo)
 *
 * Aplica ajustes por KM e dias de pátio, e devolve 3 bandas:
 *   - target: preço sugerido (equilíbrio margem × giro)
 *   - giroRapido: desconto pra vender em até 30 dias
 *   - minimo: piso sem prejuízo (custo + margem mínima)
 */

import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";
import type { VendaParsed } from "@/lib/parsers/nbs-vendas-xlsx";
import type { CustoDetalhado } from "@/lib/parsers/nbs-custos-xls";
import { calcMargemVenda } from "@/lib/analytics/margem";

// ─── PARÂMETROS DA REGRA ────────────────────────────────────────────────────
const MARGEM_MIN_PCT = 0.03;         // 3% sobre custo é o piso
const MARGEM_PREMIUM_FIPE = 0.02;    // 2% acima da FIPE quando ela é a base
const KM_DESVIO_REFERENCIA = 10000;  // a cada 10k km de desvio, ajusta 1%
const KM_AJUSTE_MAX = 0.10;          // ±10% no máximo por KM
const GIRO_RAPIDO_DESCONTO = 0.05;   // -5% padrão
const GIRO_URGENTE_DESCONTO = 0.08;  // -8% se > 90 dias
const GIRO_CRITICO_DESCONTO = 0.12;  // -12% se > 180 dias
const MIN_COMPARAVEIS = 3;

// ─── TYPES ──────────────────────────────────────────────────────────────────

export type Banda = {
  /** R$ sugerido nessa banda. */
  preco: number;
  /** Margem % esperada sobre o custo. */
  margemSobreCusto: number;
  /** Margem % esperada sobre o preço (formato NBS). */
  margemSobreFaturamento: number;
};

export type Comparavel = {
  placa: string;
  modelo: string;
  precoVenda: number;
  km: number | null;
  dataVenda: Date | null;
  diasAteVenda: number | null;
  margemReal: number;
};

export type FonteBase = "historico" | "fipe" | "custo";

export type PrecoSuggestion = {
  /** Banda alvo — equilibra margem com giro razoável. */
  target: Banda;
  /** Banda pra acelerar venda (≤30 dias). */
  giroRapido: Banda;
  /** Piso sem prejuízo (custo + margem mínima). */
  minimo: Banda;
  /** Qual a base principal usada pra calcular. */
  baseUsada: FonteBase;
  /** Preço FIPE informado (quando houver). */
  precoFipe: number | null;
  /** Custo total do carro em análise. */
  custoTotal: number;
  /** Vendas anteriores usadas como referência. */
  comparaveis: Comparavel[];
  /** Mediana do preço de venda nos comparáveis. */
  medianaHistorica: number | null;
  /** KM mediano nos comparáveis. */
  kmMediano: number | null;
  /** Margem real média % nos comparáveis (sobre faturamento). */
  margemHistoricaMediaPct: number | null;
  /** Explicação curta da lógica aplicada (mostrar pro usuário). */
  justificativa: string;
  /** Alertas operacionais (giro lento, prejuízo, etc.). */
  alertas: string[];
};

// ─── ALGORITMO ──────────────────────────────────────────────────────────────

export function sugerirPreco(
  veiculo: VeiculoParsed,
  vendas: VendaParsed[],
  custosPorPlaca: Record<string, CustoDetalhado>,
  precoFipe: number | null,
): PrecoSuggestion {
  const custo = custoEstimado(veiculo);
  const precoMinimo = Math.round(custo * (1 + MARGEM_MIN_PCT));

  // 1) Encontra vendas comparáveis do mesmo modelo
  const comparaveis = encontrarComparaveis(veiculo, vendas, custosPorPlaca);
  const medianaHistorica = comparaveis.length >= MIN_COMPARAVEIS
    ? mediana(comparaveis.map((c) => c.precoVenda))
    : null;
  const kmMediano = comparaveis.length >= MIN_COMPARAVEIS
    ? mediana(comparaveis.map((c) => c.km).filter((k): k is number => k != null))
    : null;
  const margemHistoricaMediaPct = comparaveis.length >= MIN_COMPARAVEIS
    ? media(comparaveis.map((c) => (c.precoVenda > 0 ? (c.margemReal / c.precoVenda) * 100 : 0)))
    : null;

  // 2) Define base e preço de referência
  let referencia = 0;
  let baseUsada: FonteBase;
  let justificativa: string;

  if (medianaHistorica && comparaveis.length >= MIN_COMPARAVEIS) {
    referencia = medianaHistorica;
    baseUsada = "historico";
    justificativa = `Mediana de ${comparaveis.length} vendas recentes do mesmo modelo: ${formatBR(medianaHistorica)}.`;
  } else if (precoFipe && precoFipe > 0) {
    referencia = precoFipe * (1 + MARGEM_PREMIUM_FIPE);
    baseUsada = "fipe";
    justificativa = `Sem histórico suficiente (apenas ${comparaveis.length} venda${comparaveis.length === 1 ? "" : "s"}). Usando FIPE ${formatBR(precoFipe)} +${(MARGEM_PREMIUM_FIPE * 100).toFixed(0)}%.`;
  } else {
    referencia = precoMinimo;
    baseUsada = "custo";
    justificativa = `Sem histórico nem FIPE — usando custo ${formatBR(custo)} + ${(MARGEM_MIN_PCT * 100).toFixed(0)}% de margem mínima.`;
  }

  // 3) Ajuste por KM (quando temos referência de mediana)
  const veicKm = veiculo.km ?? null;
  const ajusteKmPct = ajusteKm(veicKm, kmMediano);
  let target = referencia * (1 + ajusteKmPct);

  // 4) Piso: sugerido não pode ficar abaixo do mínimo
  if (target < precoMinimo) {
    target = precoMinimo;
    justificativa += ` ⚠️ Bate no piso de custo +${(MARGEM_MIN_PCT * 100).toFixed(0)}%.`;
  }

  // 5) Banda de giro rápido — desconto cresce com dias parado
  const diasPatio = veiculo.dias_patio ?? 0;
  let descontoGiro = GIRO_RAPIDO_DESCONTO;
  if (diasPatio > 180) descontoGiro = GIRO_CRITICO_DESCONTO;
  else if (diasPatio > 90) descontoGiro = GIRO_URGENTE_DESCONTO;
  let giroRapido = target * (1 - descontoGiro);
  if (giroRapido < precoMinimo) giroRapido = precoMinimo;

  // 6) Alertas operacionais
  const alertas: string[] = [];
  if (custo > 0 && target / custo - 1 < MARGEM_MIN_PCT * 1.5) {
    alertas.push("Margem-alvo apertada — pouco espaço pra desconto.");
  }
  if (diasPatio > 90) {
    alertas.push(`Parado há ${diasPatio} dias — considere usar a banda de giro rápido.`);
  }
  if (margemHistoricaMediaPct != null && margemHistoricaMediaPct < 0) {
    alertas.push(`Histórico desse modelo tem margem média ${margemHistoricaMediaPct.toFixed(1)}% — modelo de risco.`);
  }
  if (Math.abs(ajusteKmPct) > 0.03 && veicKm != null && kmMediano != null) {
    const direcao = ajusteKmPct > 0 ? "abaixo" : "acima";
    alertas.push(`KM ${formatInt(veicKm)} está ${direcao} da mediana ${formatInt(kmMediano)} — ajuste ${(ajusteKmPct * 100).toFixed(1)}%.`);
  }

  return {
    target: bandaCompleta(Math.round(target), custo),
    giroRapido: bandaCompleta(Math.round(giroRapido), custo),
    minimo: bandaCompleta(precoMinimo, custo),
    baseUsada,
    precoFipe,
    custoTotal: custo,
    comparaveis,
    medianaHistorica,
    kmMediano,
    margemHistoricaMediaPct,
    justificativa,
    alertas,
  };
}

// ─── HELPERS ────────────────────────────────────────────────────────────────

function custoEstimado(v: VeiculoParsed): number {
  return v.custo_total ?? v.valor_aquisicao ?? 0;
}

function bandaCompleta(preco: number, custo: number): Banda {
  const margemReais = preco - custo;
  return {
    preco,
    margemSobreCusto: custo > 0 ? (margemReais / custo) * 100 : 0,
    margemSobreFaturamento: preco > 0 ? (margemReais / preco) * 100 : 0,
  };
}

/**
 * Encontra vendas recentes do mesmo modelo. Estratégia em camadas:
 *   1. Match exato (modelo normalizado)  +  últimos 90 dias
 *   2. Match exato + últimos 180 dias
 *   3. Match exato + todo o período
 *
 * Limita a 20 comparáveis (mais recentes), retorna ordenados por data desc.
 */
function encontrarComparaveis(
  veiculo: VeiculoParsed,
  vendas: VendaParsed[],
  custosPorPlaca: Record<string, CustoDetalhado>,
): Comparavel[] {
  const alvo = normalizar(veiculo.modelo);
  if (!alvo) return [];

  const candidatos = vendas
    .filter((v) => normalizar(v.modelo) === alvo)
    .filter((v) => v.valor_venda != null && v.valor_venda > 0);

  // Tenta janelas decrescentes
  const hoje = new Date();
  const JANELAS_DIAS = [90, 180, 365, Infinity];

  for (const dias of JANELAS_DIAS) {
    const filtrados = candidatos.filter((v) => {
      if (dias === Infinity) return true;
      if (!v.data_venda) return false;
      const diff = (hoje.getTime() - new Date(v.data_venda).getTime()) / (1000 * 60 * 60 * 24);
      return diff <= dias;
    });
    if (filtrados.length >= MIN_COMPARAVEIS) {
      return mapearComparaveis(filtrados.slice(0, 20), custosPorPlaca);
    }
  }

  // Não atingiu o mínimo — devolve o que tem (pode ser pequeno)
  return mapearComparaveis(candidatos.slice(0, 20), custosPorPlaca);
}

function mapearComparaveis(vendas: VendaParsed[], custosPorPlaca: Record<string, CustoDetalhado>): Comparavel[] {
  return vendas
    .map((v) => {
      const m = calcMargemVenda(v, custosPorPlaca);
      return {
        placa: v.placa,
        modelo: v.modelo,
        precoVenda: m.valor,
        km: v.km,
        dataVenda: v.data_venda,
        diasAteVenda: v.dias_estoque,
        margemReal: m.margem,
      };
    })
    .sort((a, b) => {
      const ta = a.dataVenda ? new Date(a.dataVenda).getTime() : 0;
      const tb = b.dataVenda ? new Date(b.dataVenda).getTime() : 0;
      return tb - ta;
    });
}

function normalizar(s: string | null | undefined): string {
  return (s ?? "").trim().toUpperCase().replace(/\s+/g, " ");
}

function mediana(xs: number[]): number | null {
  const arr = [...xs].filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (arr.length === 0) return null;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 === 0 ? (arr[mid - 1] + arr[mid]) / 2 : arr[mid];
}

function media(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Ajuste percentual baseado no desvio de KM do veículo em relação à mediana histórica.
 * Carro com menos KM que a mediana → premium positivo. Mais KM → desconto.
 */
function ajusteKm(veicKm: number | null, kmMediano: number | null): number {
  if (veicKm == null || kmMediano == null || kmMediano === 0) return 0;
  const desvio = veicKm - kmMediano; // positivo se carro tem MAIS km que a mediana
  const ajuste = -(desvio / KM_DESVIO_REFERENCIA) * 0.01;
  return Math.max(-KM_AJUSTE_MAX, Math.min(KM_AJUSTE_MAX, ajuste));
}

function formatBR(n: number): string {
  return "R$ " + n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

function formatInt(n: number): string {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}
