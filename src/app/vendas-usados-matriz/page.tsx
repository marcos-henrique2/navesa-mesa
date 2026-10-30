import { Suspense } from "react";
import { PainelVendasMatriz } from "@/components/vendas-matriz/PainelVendasMatriz";

/**
 * `/vendas-usados-matriz` — painel executivo (Fase 1 + Fase 2). O estado (mês, aba e filtros
 * da aba Vendas) mora na URL via `useSearchParams`, que exige um limite de Suspense —
 * mesmo padrão de `/precificar` e `/login`.
 */
export default function VendasUsadosMatrizPage() {
  return (
    <Suspense fallback={null}>
      <PainelVendasMatriz />
    </Suspense>
  );
}
