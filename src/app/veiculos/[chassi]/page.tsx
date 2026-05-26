import { VeiculoDetalhe } from "@/components/VeiculoDetalhe";
import { PageHeader } from "@/components/AppShell";

export default async function VeiculoDetailPage({ params }: { params: Promise<{ chassi: string }> }) {
  const { chassi } = await params;
  return (
    <>
      <PageHeader title="Detalhe do veículo" subtitle="Identidade, financeiro, FIPE em tempo real e sugestão de preço" />
      <div className="mx-auto max-w-5xl px-6 py-8">
        <VeiculoDetalhe chassi={chassi} />
      </div>
    </>
  );
}
