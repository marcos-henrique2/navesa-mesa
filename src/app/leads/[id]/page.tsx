import { LeadDetalhe } from "@/components/leads/LeadDetalhe";
import { PageHeader } from "@/components/AppShell";

export default async function LeadDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const leadId = Number.parseInt(id, 10);
  return (
    <>
      <PageHeader title="Lead" subtitle="Contato e carros de interesse" />
      <div className="px-6 py-8">
        <LeadDetalhe leadId={leadId} />
      </div>
    </>
  );
}
