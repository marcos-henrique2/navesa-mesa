"use client";
/* eslint-disable react-hooks/set-state-in-effect --
 * Padrão idiomático pra fetch async no mount: useEffect dispara fetch que
 * eventualmente seta o estado. A regra é conservadora demais — mesmo
 * precedente do AppShell, PrecificacaoBlock e FlagsVeiculo.
 */

/**
 * Hook que carrega 1x o map de chassis com repasse ativo (status='subido').
 *
 * O map é pequeno (só carros em andamento), então carrega ao montar e mantém
 * em memória. Suporta refresh manual via `refresh()` — usado depois de criar
 * um repasse novo pra atualizar a UI sem reload.
 */

import { useCallback, useEffect, useState } from "react";
import { listChassisEmRepasse } from "./queries";

export type UseChassisEmRepasseResult = {
  /** Map<chassi, repasse_id>. Vazio enquanto carrega ou se errored. */
  chassisEmRepasse: ReadonlyMap<string, number>;
  /** true durante o fetch inicial — UI pode esconder indicadores até carregar. */
  carregando: boolean;
  /** Recarrega o map. Útil após criar repasse novo via UI. */
  refresh: () => Promise<void>;
  /** Adiciona um chassi localmente (otimista) sem hit no servidor. */
  marcarLocalmente: (chassi: string, repasseId: number) => void;
};

export function useChassisEmRepasse(): UseChassisEmRepasseResult {
  const [chassisEmRepasse, setChassisEmRepasse] = useState<ReadonlyMap<string, number>>(
    () => new Map(),
  );
  const [carregando, setCarregando] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const m = await listChassisEmRepasse();
      setChassisEmRepasse(m);
    } catch (err) {
      // Falha silenciosa — UI continua funcional, só sem indicador.
      console.error("Falha ao carregar chassis em repasse:", err);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const marcarLocalmente = useCallback((chassi: string, repasseId: number) => {
    setChassisEmRepasse((prev) => {
      const next = new Map(prev);
      next.set(chassi, repasseId);
      return next;
    });
  }, []);

  return { chassisEmRepasse, carregando, refresh, marcarLocalmente };
}
