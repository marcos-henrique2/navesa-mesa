"use client";

import { create } from "zustand";

/**
 * Store leve do preço simulado por chassi.
 *
 * Compartilha o "preço hipotético" que o usuário está testando no Simulador
 * de Preço com outros componentes do detalhe do veículo (Demonstrativo de
 * Lucro principalmente). Sem isso, o Demonstrativo ficaria preso ao preço
 * de tabela original do NBS e não acompanharia simulações em tempo real.
 *
 * Por chassi: cada veículo aberto na sua aba tem seu próprio preço simulado.
 * Não persiste — é puramente in-memory pra sessão.
 */

type SimuladorState = {
  precoPorChassi: Record<string, number | null>;
  setPreco: (chassi: string, preco: number | null) => void;
};

export const useSimuladorPrecoStore = create<SimuladorState>((set) => ({
  precoPorChassi: {},
  setPreco: (chassi, preco) =>
    set((state) => ({
      precoPorChassi: { ...state.precoPorChassi, [chassi]: preco },
    })),
}));

/** Hook reativo pro preço simulado de um chassi específico. */
export function usePrecoSimulado(chassi: string): number | null {
  return useSimuladorPrecoStore((s) => s.precoPorChassi[chassi] ?? null);
}

/** Setter direto (não-reativo). */
export function setPrecoSimulado(chassi: string, preco: number | null): void {
  useSimuladorPrecoStore.getState().setPreco(chassi, preco);
}
