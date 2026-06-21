import { InteressadosCRM } from "@/components/repasses/InteressadosCRM";
import { PageHeader } from "@/components/AppShell";

export default async function InteressadosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const repasseId = Number.parseInt(id, 10);
  return (
    <>
      <PageHeader
        title="Interessados"
        subtitle="Quem visualizou o anúncio no Auto Avaliar — follow-up de leads"
      />
      <div className="px-6 py-8">
        <InteressadosCRM repasseId={repasseId} />
      </div>
    </>
  );
}
