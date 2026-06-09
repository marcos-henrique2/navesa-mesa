import { AnaliseDashboard } from "@/components/AnaliseDashboard";
import { PageHeader } from "@/components/AppShell";

export default function AnalisePage() {
  return (
    <>
      <PageHeader
        title="Análise"
        subtitle="Sazonalidade, forecast e detecção de anomalias — entenda o padrão antes de decidir"
      />
      <div className="mx-auto max-w-7xl px-6 py-8">
        <AnaliseDashboard />
      </div>
    </>
  );
}
