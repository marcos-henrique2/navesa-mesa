/**
 * Carros pra repassar — ranking automatizado dos veículos que mais merecem
 * atenção pra repasse/leilão essa semana.
 *
 * Combina 4 sinais de risco em um score 0-100 e gera motivos legíveis:
 *   • Dias parado (peso 40) — Floor plan consumindo margem
 *   • Margem teórica (peso 30) — quanto pior, mais urgente
 *   • Desvio FIPE (peso 20) — caro = vai demorar mais
 *   • Cautelar (peso 10) — com restrição reduz mercado
 *
 * Output: lista ranqueada com top N carros prioritários + motivos explicados
 * em chips. Pra cada carro também devolve faixa de preço sugerida pra repasse.
 */

import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";
import type { BatchResult } from "@/lib/fipe/batch";
import type { StatusCautelar } from "@/lib/inventory/cautelar";

export type MotivoRepasse =
  | { tipo: "parado"; dias: number; severidade: "atencao" | "critico" }
  | { tipo: "margem-fraca"; pct: number; severidade: "atencao" | "critico" }
  | { tipo: "acima-fipe"; pct: number; severidade: "atencao" | "critico" }
  | { tipo: "cautelar-restricao" }
  | { tipo: "preco-acima-mercado"; precoSugerido: number };

export type CarroPraRepassar = {
  chassi: string;
  placa: string;
  modelo: string;
  marca: string | null;
  anoModelo: number | null;
  km: number | null;
  cor: string | null;
  loja: number;
  diasPatio: number;
  precoVenda: number | null;
  custoTotal: number | null;
  margemTeoricaPct: number | null;
  precoFipe: number | null;
  desvioFipePct: number | null;
  cautelar: StatusCautelar | null;
  /** Capital travado (custo de fábrica) */
  capitalTravado: number;
  /** Score 0-100, maior = mais urgente pra repassar */
  score: number;
  /** Faixa de preço sugerida pra repasse: [piso, teto] */
  precoSugerido: { piso: number; teto: number } | null;
  motivos: MotivoRepasse[];
};

// ──────────────────────────────────────────────────────────────────────────────
// Pontuação por dimensão (cada uma retorna 0-100)
// ──────────────────────────────────────────────────────────────────────────────

/** Mapeia dias de pátio em score 0-100. */
function scoreDias(dias: number): number {
  if (dias <= 30) return 0;
  if (dias <= 60) return 20;
  if (dias <= 90) return 40;
  if (dias <= 120) return 60;
  if (dias <= 180) return 75;
  if (dias <= 270) return 88;
  if (dias <= 365) return 95;
  return 100;
}

/** Mapeia margem teórica em score 0-100 (menor margem = score maior). */
function scoreMargem(margemPct: number | null): number {
  if (margemPct == null) return 50; // ausência de dado: neutro
  if (margemPct < -10) return 100;
  if (margemPct < -5) return 90;
  if (margemPct < 0) return 80;
  if (margemPct < 3) return 60;
  if (margemPct < 5) return 40;
  if (margemPct < 10) return 20;
  return 0;
}

/** Mapeia desvio FIPE em score 0-100. Só penaliza preço ACIMA da FIPE. */
function scoreFipe(desvioPct: number | null): number {
  if (desvioPct == null) return 30; // sem FIPE = penalidade leve (incerteza)
  if (desvioPct <= 0) return 0; // abaixo da FIPE = ok
  if (desvioPct <= 3) return 10;
  if (desvioPct <= 5) return 30;
  if (desvioPct <= 10) return 60;
  if (desvioPct <= 15) return 80;
  return 100;
}

/** Cautelar com restrição/reprovação aumenta urgência de repasse. */
function scoreCautelar(c: StatusCautelar | null): number {
  if (c === "reprovado") return 100;
  if (c === "com_restricao") return 60;
  return 0;
}

// ──────────────────────────────────────────────────────────────────────────────
// Sugestão de preço pra repasse (baseado em FIPE)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Calcula faixa sugerida pra repasse. Lógica:
 *   • Base = FIPE (se houver) ou preço atual ÷ 1.10
 *   • Aplica desconto por dias parado (até -10%)
 *   • Aplica desconto adicional por cautelar com restrição (-5%)
 *   • Retorna piso (mínimo aceitável) e teto (alvo)
 */
function calcularPrecoSugerido(
  precoVenda: number | null,
  precoFipe: number | null,
  diasPatio: number,
  cautelar: StatusCautelar | null,
): { piso: number; teto: number } | null {
  const base = precoFipe ?? (precoVenda != null && precoVenda > 0 ? precoVenda / 1.1 : null);
  if (base == null || base <= 0) return null;

  // Desconto por tempo parado
  let descontoTempo = 0;
  if (diasPatio > 365) descontoTempo = 0.15;
  else if (diasPatio > 270) descontoTempo = 0.12;
  else if (diasPatio > 180) descontoTempo = 0.08;
  else if (diasPatio > 120) descontoTempo = 0.05;
  else if (diasPatio > 90) descontoTempo = 0.03;

  // Desconto extra por cautelar com restrição
  const descontoCautelar = cautelar === "com_restricao" ? 0.05 : 0;

  const teto = base * (1 - descontoTempo);
  const piso = teto * (1 - 0.05 - descontoCautelar); // 5% abaixo do teto + cautelar

  return { piso: Math.round(piso), teto: Math.round(teto) };
}

// ──────────────────────────────────────────────────────────────────────────────
// Função principal
// ──────────────────────────────────────────────────────────────────────────────

const PESOS = {
  dias: 0.4,
  margem: 0.3,
  fipe: 0.2,
  cautelar: 0.1,
} as const;

export type OpcoesRepasse = {
  /** Não considera carros parados há menos disso (default 60d) */
  diasMinimo?: number;
  /** Não considera carros em PREPARAÇÃO (default true) */
  excluirPreparacao?: boolean;
};

/**
 * Calcula o ranking completo de "carros pra repassar".
 * Já vem ordenado pelos mais urgentes (score desc).
 */
export function calcularCarrosPraRepassar(
  veiculos: VeiculoParsed[],
  fipeBatch: BatchResult | null,
  cautelares: Record<string, StatusCautelar>,
  opts: OpcoesRepasse = {},
): CarroPraRepassar[] {
  const diasMinimo = opts.diasMinimo ?? 60;
  const excluirPrep = opts.excluirPreparacao ?? true;

  const out: CarroPraRepassar[] = [];

  for (const v of veiculos) {
    const dias = v.dias_patio ?? 0;
    if (dias < diasMinimo) continue;

    // Pula preparação se solicitado (carro nem é "vendável" ainda)
    if (excluirPrep && v.patio?.toUpperCase().includes("PREPARA")) continue;

    const margemPct =
      v.preco_venda != null && v.custo_total != null && v.preco_venda > 0
        ? ((v.preco_venda - v.custo_total) / v.preco_venda) * 100
        : null;

    const precoFipe = fipeBatch?.items?.[v.chassi]?.precoFipe ?? null;
    const desvioFipePct =
      precoFipe != null && precoFipe > 0 && v.preco_venda != null
        ? ((v.preco_venda - precoFipe) / precoFipe) * 100
        : null;

    const cautelar = cautelares[v.chassi] ?? null;

    // Score combinado
    const sDias = scoreDias(dias);
    const sMargem = scoreMargem(margemPct);
    const sFipe = scoreFipe(desvioFipePct);
    const sCautelar = scoreCautelar(cautelar);
    const score = Math.round(
      sDias * PESOS.dias + sMargem * PESOS.margem + sFipe * PESOS.fipe + sCautelar * PESOS.cautelar,
    );

    // Só inclui carros com score relevante (>= 40)
    if (score < 40) continue;

    // Motivos legíveis pra mostrar na UI
    const motivos: MotivoRepasse[] = [];
    if (dias > 180) motivos.push({ tipo: "parado", dias, severidade: "critico" });
    else if (dias > 90) motivos.push({ tipo: "parado", dias, severidade: "atencao" });
    if (margemPct != null) {
      if (margemPct < 0) motivos.push({ tipo: "margem-fraca", pct: margemPct, severidade: "critico" });
      else if (margemPct < 5) motivos.push({ tipo: "margem-fraca", pct: margemPct, severidade: "atencao" });
    }
    if (desvioFipePct != null && desvioFipePct > 5) {
      motivos.push({
        tipo: "acima-fipe",
        pct: desvioFipePct,
        severidade: desvioFipePct > 10 ? "critico" : "atencao",
      });
    }
    if (cautelar === "com_restricao") motivos.push({ tipo: "cautelar-restricao" });

    const precoSugerido = calcularPrecoSugerido(v.preco_venda, precoFipe, dias, cautelar);

    out.push({
      chassi: v.chassi,
      placa: v.placa,
      modelo: v.modelo,
      marca: v.marca,
      anoModelo: v.ano_modelo,
      km: v.km,
      cor: v.cor_externa,
      loja: v.cod_empresa,
      diasPatio: dias,
      precoVenda: v.preco_venda,
      custoTotal: v.custo_total,
      margemTeoricaPct: margemPct,
      precoFipe,
      desvioFipePct,
      cautelar,
      capitalTravado: v.valor_aquisicao ?? 0,
      score,
      precoSugerido,
      motivos,
    });
  }

  return out.sort((a, b) => b.score - a.score);
}

/**
 * Resumo agregado pra mostrar no card do dashboard.
 */
export type ResumoRepasse = {
  total: number;
  capitalTotal: number;
  criticos: number;
  topN: CarroPraRepassar[];
};

export function resumirRepasse(carros: CarroPraRepassar[], topN: number = 5): ResumoRepasse {
  return {
    total: carros.length,
    capitalTotal: carros.reduce((s, c) => s + c.capitalTravado, 0),
    criticos: carros.filter((c) => c.score >= 75).length,
    topN: carros.slice(0, topN),
  };
}
