"use client";

/**
 * Wrapper client da página /veiculos.
 *
 * Razão de existir: a page.tsx é RSC e o banner Ford + tabela precisam
 * compartilhar estado leve ("modo prioridade Ford ativo") sem URL params
 * (não persiste, é por sessão e dispensável).
 */

import { useCallback, useState } from "react";
import { PrioridadeFordBanner } from "./PrioridadeFordBanner";
import { VeiculosTable, type FiltrosPrioridade } from "./VeiculosTable";

export function VeiculosClient() {
  // Nonce muda a cada clique pra forçar re-aplicação mesmo se o user já estava lá
  const [filtrosPrioridade, setFiltrosPrioridade] = useState<FiltrosPrioridade | null>(null);

  const handleAtivarFiltro = useCallback((codsLoja: number[]) => {
    setFiltrosPrioridade({
      codsLoja,
      statusAtencao: true,
      nonce: Date.now(),
    });
  }, []);

  return (
    <div className="space-y-6">
      <PrioridadeFordBanner onAtivarFiltro={handleAtivarFiltro} />
      <VeiculosTable filtrosPrioridade={filtrosPrioridade} />
    </div>
  );
}
