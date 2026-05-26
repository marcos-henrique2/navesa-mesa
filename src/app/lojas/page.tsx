import { LojasTable } from "@/components/LojasTable";
import { PageHeader } from "@/components/AppShell";

export default function LojasPage() {
  return (
    <>
      <PageHeader
        title="Cadastro de lojas"
        subtitle="Códigos do NBS mapeados para nomes legíveis — usados em todas as análises"
      />
      <div className="mx-auto max-w-5xl px-6 py-8">
        <LojasTable />
      </div>
    </>
  );
}
