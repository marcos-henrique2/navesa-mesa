/**
 * Carros pra repassar — ranking baseado em critérios objetivos.
 *
 * Regras de qualificação (basta UM bater pra o carro entrar na lista):
 *   • Idade ≥ 10 anos (modelo ou fabricação)
 *   • KM ≥ 100.000
 *   • Dias de pátio ≥ 50
 *
 * Carros que batem MAIS critérios sobem no ranking — score baseado em
 * quantidade de critérios disparados (1 = 50, 2 = 75, 3 = 100).
 *
 * Custos de manutenção, pintura, recondicionamento ficam por conta da
 * análise no Auto Avaliar (fora deste sistema).
 */

import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";
import type { BatchResult } from "@/lib/fipe/batch";
import type { StatusCautelar } from "@/lib/inventory/cautelar";

const LIMITE_IDADE_ANOS = 10;
const LIMITE_KM = 100_000;
const LIMITE_DIAS_PATIO = 50;

/**
 * Função leve que diz se um veículo qualifica pra repasse — basta UM
 * critério bater. Usada em filtragens de listagem (sem precisar do score
 * completo).
 *
 * Mesma regra do `calcularCarrosPraRepassar` (sem o filtro de PREPARAÇÃO).
 */
export function ehPraRepasse(
  v: VeiculoParsed,
  anoReferencia: number = new Date().getFullYear(),
): boolean {
  const ano = v.ano_fabricacao ?? v.ano_modelo ?? null;
  if (ano != null && ano > 0 && anoReferencia - ano >= LIMITE_IDADE_ANOS) return true;
  if (v.km != null && v.km >= LIMITE_KM) return true;
  if ((v.dias_patio ?? 0) >= LIMITE_DIAS_PATIO) return true;
  return false;
}

export type MotivoRepasse =
  | { tipo: "idade"; anos: number }
  | { tipo: "km"; km: number }
  | { tipo: "parado"; dias: number };

export type CarroPraRepassar = {
  chassi: string;
  placa: string;
  modelo: string;
  marca: string | null;
  anoModelo: number | null;
  anoFabricacao: number | null;
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
  /** Score 0-100, maior = mais urgente pra repassar (combina nº critérios + intensidade) */
  score: number;
  /** Faixa de preço sugerida pra repasse: [piso, teto] */
  precoSugerido: { piso: number; teto: number } | null;
  motivos: MotivoRepasse[];
};

// ──────────────────────────────────────────────────────────────────────────────
// Cálculo de idade do veículo
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Calcula idade em anos usando o ano mais antigo entre fabricação e modelo.
 * Comparado com o ano atual.
 */
function calcularIdade(v: VeiculoParsed, anoReferencia: number): number | null {
  const ano = v.ano_fabricacao ?? v.ano_modelo ?? null;
  if (ano == null || ano <= 0) return null;
  return anoReferencia - ano;
}

// ──────────────────────────────────────────────────────────────────────────────
// Sugestão de preço pra repasse (baseado em FIPE)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Faixa sugerida pra repasse. Lógica:
 *   • Base = FIPE (se houver) ou preço atual ÷ 1.10
 *   • Aplica desconto crescente conforme número de critérios batidos
 *   • Aplica desconto extra por cautelar com restrição
 */
function calcularPrecoSugerido(
  precoVenda: number | null,
  precoFipe: number | null,
  qtCriteriosBatidos: number,
  cautelar: StatusCautelar | null,
): { piso: number; teto: number } | null {
  const base = precoFipe ?? (precoVenda != null && precoVenda > 0 ? precoVenda / 1.1 : null);
  if (base == null || base <= 0) return null;

  // Desconto base aumenta com nº de critérios batidos
  const descontoCriterios = qtCriteriosBatidos === 1 ? 0.05 : qtCriteriosBatidos === 2 ? 0.10 : 0.15;
  const descontoCautelar = cautelar === "com_restricao" ? 0.05 : 0;

  const teto = base * (1 - descontoCriterios);
  const piso = teto * (1 - 0.05 - descontoCautelar);

  return { piso: Math.round(piso), teto: Math.round(teto) };
}

// ──────────────────────────────────────────────────────────────────────────────
// Função principal
// ──────────────────────────────────────────────────────────────────────────────

export type OpcoesRepasse = {
  /** Ano de referência pra calcular idade (default: ano atual). */
  anoReferencia?: number;
  /** Não considera carros em PREPARAÇÃO (default true). */
  excluirPreparacao?: boolean;
};

/**
 * Calcula o ranking de "carros pra repassar".
 *
 * Critérios de qualificação (basta 1 bater):
 *   • Idade >= 10 anos
 *   • KM >= 100.000
 *   • Dias de pátio >= 50
 *
 * Ordenado pelos mais urgentes primeiro (score desc).
 */
export function calcularCarrosPraRepassar(
  veiculos: VeiculoParsed[],
  fipeBatch: BatchResult | null,
  cautelares: Record<string, StatusCautelar>,
  opts: OpcoesRepasse = {},
): CarroPraRepassar[] {
  // Ano de referência: padrão é o ano atual. Permitir override pra testes.
  const anoReferencia = opts.anoReferencia ?? new Date().getFullYear();
  const excluirPrep = opts.excluirPreparacao ?? true;

  const out: CarroPraRepassar[] = [];

  for (const v of veiculos) {
    // Pula preparação se solicitado
    if (excluirPrep && v.patio?.toUpperCase().includes("PREPARA")) continue;

    const motivos: MotivoRepasse[] = [];

    // Critério 1: idade
    const idade = calcularIdade(v, anoReferencia);
    if (idade != null && idade >= LIMITE_IDADE_ANOS) {
      motivos.push({ tipo: "idade", anos: idade });
    }

    // Critério 2: KM
    if (v.km != null && v.km >= LIMITE_KM) {
      motivos.push({ tipo: "km", km: v.km });
    }

    // Critério 3: dias parado
    const dias = v.dias_patio ?? 0;
    if (dias >= LIMITE_DIAS_PATIO) {
      motivos.push({ tipo: "parado", dias });
    }

    // Se não bateu nenhum critério, pula
    if (motivos.length === 0) continue;

    // Score: 1 critério = 50, 2 = 75, 3 = 100
    // Bonus pequeno por intensidade (cada critério acima do limite soma até +10)
    const scoreBase = motivos.length === 1 ? 50 : motivos.length === 2 ? 75 : 100;

    // Intensidade extra: quanto mais acima do limite, mais urgente
    let bonusIntensidade = 0;
    if (idade != null && idade >= LIMITE_IDADE_ANOS) {
      bonusIntensidade += Math.min(5, (idade - LIMITE_IDADE_ANOS) * 0.5);
    }
    if (v.km != null && v.km >= LIMITE_KM) {
      bonusIntensidade += Math.min(5, ((v.km - LIMITE_KM) / 50_000) * 5);
    }
    if (dias >= LIMITE_DIAS_PATIO) {
      bonusIntensidade += Math.min(5, ((dias - LIMITE_DIAS_PATIO) / 100) * 5);
    }
    const score = Math.min(100, Math.round(scoreBase + bonusIntensidade));

    // Dados auxiliares (FIPE, cautelar, margem) — só pra contexto, não pra qualificação
    const precoFipe = fipeBatch?.items?.[v.chassi]?.precoFipe ?? null;
    const desvioFipePct =
      precoFipe != null && precoFipe > 0 && v.preco_venda != null
        ? ((v.preco_venda - precoFipe) / precoFipe) * 100
        : null;
    const cautelar = cautelares[v.chassi] ?? null;
    const margemPct =
      v.preco_venda != null && v.custo_total != null && v.preco_venda > 0
        ? ((v.preco_venda - v.custo_total) / v.preco_venda) * 100
        : null;

    const precoSugerido = calcularPrecoSugerido(v.preco_venda, precoFipe, motivos.length, cautelar);

    out.push({
      chassi: v.chassi,
      placa: v.placa,
      modelo: v.modelo,
      marca: v.marca,
      anoModelo: v.ano_modelo,
      anoFabricacao: v.ano_fabricacao,
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
  /** Carros que batem TODOS os 3 critérios (urgência máxima) */
  criticos: number;
  topN: CarroPraRepassar[];
};

export function resumirRepasse(carros: CarroPraRepassar[], topN: number = 5): ResumoRepasse {
  return {
    total: carros.length,
    capitalTotal: carros.reduce((s, c) => s + c.capitalTravado, 0),
    // Crítico = bate os 3 critérios simultaneamente (score 100)
    criticos: carros.filter((c) => c.motivos.length === 3).length,
    topN: carros.slice(0, topN),
  };
}
