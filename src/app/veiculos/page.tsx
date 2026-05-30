import Link from "next/link";
import { Upload } from "lucide-react";
import { VeiculosTable } from "@/components/VeiculosTable";
import { PageHeader } from "@/components/AppShell";

export default function VeiculosPage() {
  return (
    <>
      <PageHeader
        title="Estoque de veículos"
        subtitle="KPIs, filtros e tabela completa do estoque atual"
        action={
          <Link href="/upload" className="inline-flex items-center gap-2 rounded-lg bg-[var(--brand-700)] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-[var(--brand-800)]">
            <Upload className="h-4 w-4" /> Novo upload
          </Link>
        }
      />
      <div className="w-full px-4 py-6">
        <VeiculosTable />
      </div>
    </>
  );
}
