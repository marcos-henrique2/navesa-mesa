import { RepasseDetalhe } from "@/components/repasses/RepasseDetalhe";
import { PageHeader } from "@/components/AppShell";

export default async function RepasseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const repasseId = Number(id);
  return (
    <>
      <PageHeader title="Detalhe do repasse" subtitle="Valores, gastos, documentação e exportação" />
      <div className="mx-auto max-w-5xl px-6 py-8">
        <RepasseDetalhe id={repasseId} />
      </div>
    </>
  );
}
