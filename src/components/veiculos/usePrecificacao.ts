"use client";

/**
 * Hook unificado de precificação pra um veículo.
 *
 * Sucessor do `useDiagnostico`: além do diagnóstico, agora também devolve a
 * sugestão de preço (3 bandas) — antes computada inline no `VeiculoDetalhe`.
 *
 * Vantagem: fonte FIPE única (via `useFipeBatch`) — o override manual do match
 * pelo `FipeReviewDrawer` propaga AUTOMATICAMENTE pro diagnóstico E pra sugestão,
 * sem `useState precoFipe` local pra sincronizar.
 *
 * Reativo a: estoque, vendas, batch FIPE, cautelares, classificação.
 */

import { useMemo } from "react";
import { useInventory } from "@/lib/store/inventory";
import { useFipeBatch } from "@/lib/fipe/useFipeBatch";
import { itemFipeConfiavel } from "@/lib/fipe/batch";
import { useCautelares } from "@/lib/inventory/cautelar";
import { classificarVeiculo, contarPorModelo } from "@/lib/pricing/classificacao";
import { calcularDiagnostico, type DiagnosticoResult } from "@/lib/pricing/diagnostico";
import { calcularMedianasKm, buscarMedianaKm } from "@/lib/pricing/medianas";
import { sugerirPreco, type PrecoSuggestion } from "@/lib/pricing/suggest";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";
import type { StatusCautelar } from "@/lib/inventory/cautelar";

export type UsePrecificacaoResult = {
  diagnostico: DiagnosticoResult | null;
  sugestao: PrecoSuggestion | null;
  /** Mediana de km usada (após fallback hierárquico). Útil pra UI explicar a base. */
  medianaKm: number | null;
  /** Cautelar atual do chassi (pra snapshot ao marcar reprecificação). */
  cautelar: StatusCautelar | null;
  /** Preço FIPE do batch (já reflete overrides manuais). */
  fipeBatchPreco: number | null;
  /**
   * Tabela FIPE de onde `fipeBatchPreco` veio (`"julho/2026"`), ou `null`.
   *
   * Anda colada ao preço porque um valor FIPE sem o mês não é conferível: meses
   * vizinhos diferem em milhares de reais no mesmo carro.
   */
  fipeReferencia: string | null;
};

export function usePrecificacao(veiculo: VeiculoParsed | null): UsePrecificacaoResult {
  const { veiculos, vendas, custosPorPlaca } = useInventory();
  const fipeBatch = useFipeBatch();
  const cautelares = useCautelares();

  const medianas = useMemo(
    () => calcularMedianasKm(veiculos, vendas),
    [veiculos, vendas],
  );

  return useMemo<UsePrecificacaoResult>(() => {
    if (!veiculo) {
      return {
        diagnostico: null,
        sugestao: null,
        medianaKm: null,
        cautelar: null,
        fipeBatchPreco: null,
        fipeReferencia: null,
      };
    }

    const contagem = contarPorModelo(veiculos);
    const cautelar = cautelares[veiculo.chassi] ?? null;
    const { classe } = classificarVeiculo(veiculo, {
      contagemPorModelo: contagem,
      cautelar,
    });
    const { mediana, heuristica } = buscarMedianaKm(medianas, veiculo);
    // Match não confirmado (score < 0.6, plausibilidade não verificada ou sem
    // referência FIPE) é tratado como ausência de FIPE: o diagnóstico cai no
    // proxy de custo em vez de precificar sobre um chute ou sobre um preço de
    // mês desconhecido.
    const fipeItem = itemFipeConfiavel(fipeBatch, veiculo.chassi);
    const precoFipe = fipeItem?.precoFipe ?? null;

    const diagnostico = calcularDiagnostico({
      veiculo,
      classe,
      precoFipe,
      cautelar,
      medianaKmModeloAno: mediana,
      medianaPorHeuristica: heuristica,
    });

    const sugestao = sugerirPreco(veiculo, vendas, custosPorPlaca, precoFipe);

    return {
      diagnostico,
      sugestao,
      medianaKm: mediana,
      cautelar,
      fipeBatchPreco: precoFipe,
      fipeReferencia: fipeItem?.fipeReferencia ?? null,
    };
  }, [veiculo, veiculos, vendas, custosPorPlaca, fipeBatch, cautelares, medianas]);
}
