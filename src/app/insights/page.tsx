import { InsightsDashboard } from "@/components/InsightsDashboard";
import { PageHeader } from "@/components/AppShell";

export default function InsightsPage() {
  return (
    <>
      <PageHeader
        title="Insights operacionais"
        subtitle="Lojas no vermelho, modelos tóxicos, giro × margem, riscos no estoque atual"
      />
      <div className="mx-auto max-w-7xl px-6 py-8">
        <InsightsDashboard />
      </div>
    </>
  );
}
