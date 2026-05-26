import { VendaDetalhe } from "@/components/VendaDetalhe";
import { PageHeader } from "@/components/AppShell";

export default async function VendaDetailPage({ params }: { params: Promise<{ chassi: string }> }) {
  const { chassi } = await params;
  return (
    <>
      <PageHeader title="Detalhe da venda" subtitle="Composição financeira completa, cliente, vendedor e indicadores" />
      <div className="mx-auto max-w-5xl px-6 py-8">
        <VendaDetalhe chassi={chassi} />
      </div>
    </>
  );
}
