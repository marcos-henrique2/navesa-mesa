import { Suspense } from "react";
import { PageHeader } from "@/components/AppShell";
import { PrecificarAba } from "@/components/repasses/PrecificarAba";

/**
 * `/precificar` — sugestão de preço de repasse por placa (Story 3.1a).
 *
 * `PrecificarAba` lê `?placa=` com `useSearchParams`, que exige um limite de
 * Suspense — mesmo padrão do `/login`.
 */
export default function PrecificarPage() {
  return (
    <>
      <PageHeader
        title="Precificar"
        subtitle="Digite a placa e receba o Mínimo e o Compre por sugeridos sobre o custo real do carro"
      />
      <Suspense fallback={null}>
        <PrecificarAba />
      </Suspense>
    </>
  );
}
