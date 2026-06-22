import { LeadsLista } from "@/components/leads/LeadsLista";
import { PageHeader } from "@/components/AppShell";

export default function LeadsPage() {
  return (
    <>
      <PageHeader
        title="Leads"
        subtitle="CRM central — contatos únicos e os carros de interesse de cada um"
      />
      <div className="px-6 py-8">
        <LeadsLista />
      </div>
    </>
  );
}
