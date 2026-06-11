import { RepassesLista } from "@/components/repasses/RepassesLista";
import { PageHeader } from "@/components/AppShell";

export default function RepassesPage() {
  return (
    <>
      <PageHeader
        title="Repasses"
        subtitle="Carros marcados pra subir pra Auto Avaliar — exportar XLSX, marcar como subidos"
      />
      <div className="px-6 py-8">
        <RepassesLista />
      </div>
    </>
  );
}
