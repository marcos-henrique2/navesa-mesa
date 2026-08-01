import Link from "next/link";
import { Upload } from "lucide-react";
import { RepassesLista } from "@/components/repasses/RepassesLista";
import { PageHeader } from "@/components/AppShell";

export default function RepassesPage() {
  return (
    <>
      <PageHeader
        title="Repasses"
        subtitle="Carros marcados pra subir pra Auto Avaliar — exportar XLSX, marcar como subidos"
        action={
          <Link
            href="/repasses/importar"
            className="inline-flex items-center gap-2 rounded-md bg-[var(--brand-700)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-800)]"
          >
            <Upload className="h-4 w-4" /> Importar do Auto Avaliar
          </Link>
        }
      />
      <div className="px-6 py-8">
        <RepassesLista />
      </div>
    </>
  );
}
