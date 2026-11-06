/**
 * FIPE — confiança do preço (módulo PURO: sem I/O, sem Supabase, sem browser).
 *
 * Extraído de `@/lib/fipe/batch` (que segue re-exportando tudo daqui) para que
 * `@/lib/analytics/insights` e o cérebro (Node, docs/arquitetura/cerebro-claude.md)
 * usem as MESMAS regras de confiança/desvio sem arrastar o client Supabase.
 */
import { isFipeConfirmado, type BatchFipeItem } from "@/lib/fipe/batch-tipos";

// ───── Congelamento da FIPE: limiares de confiança ──────────────────────────

/** Score atribuído a um match escolhido manualmente por um humano. */
export const SCORE_MANUAL = 1;

/**
 * Piso de plausibilidade: FIPE abaixo de 60% do custo total é match errado.
 *
 * Validado contra os 21 casos reais na faixa 0.50-0.60: todos erro genuíno
 * (Territory 2026→SEL 2021, S10 LTZ 2019→S10 Blazer 2002, uma CG 150 casada
 * com Honda Accord), zero falso positivo. Aqui a evidência é conclusiva:
 * ninguém paga R$ 300 mil num carro que a tabela diz valer R$ 75 mil.
 */
export const FIPE_RATIO_MIN = 0.6;

/**
 * Acima de 250% do custo o preço NÃO é rejeitado — é mandado pra revisão humana.
 *
 * Por que não rejeitar: do lado de cima a evidência é ambígua e nenhum sinal
 * disponível separa erro de bom negócio. Dois casos reais com ratio praticamente
 * igual provam isso:
 *
 *   KWID E-Tech 2026    → "Kangoo E-Tech Furgão" 2025  ratio 3.42  score 0.625
 *   Land Cruiser 2008   → "Land Cruiser Prado" 2008    ratio 3.38  score 0.571
 *
 * O primeiro é match errado, o segundo é correto (trade-in velho comprado
 * barato) — e o score os ordena ao CONTRÁRIO da verdade. Não existe limiar de
 * ratio nem de score que acerte os dois. Rejeitar puniria exatamente a compra
 * bem-feita, que é o bom negócio do usado; aceitar injetaria R$ 241 mil de FIPE
 * num Kwid de R$ 70 mil.
 *
 * Quando nenhum sinal automático decide, a resposta certa é não decidir sozinho.
 */
export const FIPE_RATIO_REVISAO = 2.5;

export type PlausibilidadeFipe = {
  /** `false` só quando o guard rodou E reprovou de forma conclusiva (piso). */
  ok: boolean;
  /** `false` quando não havia `custo_total` utilizável — nada foi validado. */
  aplicado: boolean;
  /**
   * `true` quando o preço passou do teto: o guard rodou mas NÃO consegue
   * atestar o valor. O item é gravado e fica visível, porém sem confirmação —
   * um humano decide no `FipeReviewDrawer`.
   */
  revisaoRecomendada: boolean;
  motivo?: "abaixo-do-piso" | "acima-do-teto";
  detalhe?: string;
};

/**
 * Guard de sanidade do preço FIPE contra o custo total do veículo.
 *
 * Os dois lados NÃO são espelhados, porque a evidência não é simétrica:
 *   - FIPE muito ABAIXO do custo é quase sempre erro de match → rejeita.
 *   - FIPE muito ACIMA do custo é frequentemente margem boa → manda revisar.
 *
 * Quando `custoTotal` é null/zero não há como validar; devolvemos `ok: true` com
 * `aplicado: false` pra que o caller registre que o veículo passou sem verificação.
 */
export function validarPlausibilidadeFipe(
  precoFipe: number,
  custoTotal: number | null | undefined,
): PlausibilidadeFipe {
  if (custoTotal == null || !Number.isFinite(custoTotal) || custoTotal <= 0) {
    return { ok: true, aplicado: false, revisaoRecomendada: false };
  }
  const piso = custoTotal * FIPE_RATIO_MIN;
  const teto = custoTotal * FIPE_RATIO_REVISAO;
  if (precoFipe < piso) {
    return {
      ok: false,
      aplicado: true,
      revisaoRecomendada: false,
      motivo: "abaixo-do-piso",
      detalhe: `FIPE ${precoFipe} < ${FIPE_RATIO_MIN * 100}% do custo total ${custoTotal}`,
    };
  }
  if (precoFipe > teto) {
    // Não reprova: grava e escala pra revisão humana.
    return {
      ok: true,
      aplicado: true,
      revisaoRecomendada: true,
      motivo: "acima-do-teto",
      detalhe: `FIPE ${precoFipe} > ${FIPE_RATIO_REVISAO * 100}% do custo total ${custoTotal} — confirme se é compra bem-feita ou match errado`,
    };
  }
  return { ok: true, aplicado: true, revisaoRecomendada: false };
}

/**
 * Item do batch utilizável como referência de precificação, ou `null`.
 *
 * Existe pra UI conseguir mostrar preço E tabela juntos — exibir o valor sem
 * dizer de que mês ele é foi o que deixou a defasagem invisível pro usuário.
 */
export function itemFipeConfiavel(
  batch: { items: Record<string, BatchFipeItem> } | null | undefined,
  chassi: string,
): BatchFipeItem | null {
  const item = batch?.items?.[chassi];
  if (!item || !isFipeConfirmado(item)) return null;
  return item;
}

/**
 * Preço FIPE utilizável como referência de precificação.
 *
 * Retorna `null` quando o match não é confirmado — consumidores devem tratar
 * exatamente como "sem FIPE" (cair no proxy de custo), nunca exibir o número.
 */
export function precoFipeConfiavel(
  batch: { items: Record<string, BatchFipeItem> } | null | undefined,
  chassi: string,
): number | null {
  return itemFipeConfiavel(batch, chassi)?.precoFipe ?? null;
}

/** Quantos chassis do batch têm FIPE efetivamente confirmada. */
export function contarFipeConfirmada(
  batch: { items: Record<string, BatchFipeItem> } | null | undefined,
): number {
  if (!batch) return 0;
  let n = 0;
  for (const item of Object.values(batch.items)) if (isFipeConfirmado(item)) n++;
  return n;
}

/**
 * Helper pra UI: calcula o desvio % do preço atual vs FIPE de um carro.
 * Positivo = pedindo MAIS que a FIPE (potencial de não vender).
 * Negativo = pedindo MENOS que a FIPE (deixando dinheiro na mesa).
 */
export function calcularDesvioFipe(
  precoVenda: number | null,
  precoFipe: number | null,
): { desvio: number; pct: number } | null {
  if (precoVenda == null || precoFipe == null || precoFipe <= 0) return null;
  const desvio = precoVenda - precoFipe;
  const pct = (desvio / precoFipe) * 100;
  return { desvio, pct };
}
