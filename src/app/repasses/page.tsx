import { RepassesLista } from "@/components/repasses/RepassesLista";
import { PageHeader } from "@/components/AppShell";

export default function RepassesPage() {
  return (
    <>
      <PageHeader
        title="Repasses"
        subtitle="Gestão dos carros subidos pra Auto Avaliar — valores, gastos, documentação e planilha"
      />
      <div className="mx-auto max-w-7xl px-6 py-8">
        <RepassesLista />
      </div>
    </>
  );
}
