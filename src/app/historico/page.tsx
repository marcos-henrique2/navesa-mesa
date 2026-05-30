import { HistoricoSnapshots } from "@/components/HistoricoSnapshots";
import { PageHeader } from "@/components/AppShell";

export default function HistoricoPage() {
  return (
    <>
      <PageHeader
        title="Histórico"
        subtitle="Fotos da operação ao longo do tempo — veja a evolução de margem, faturamento e estoque"
      />
      <div className="mx-auto max-w-7xl px-6 py-8">
        <HistoricoSnapshots />
      </div>
    </>
  );
}
