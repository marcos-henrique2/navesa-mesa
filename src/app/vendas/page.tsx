import Link from "next/link";
import { Upload } from "lucide-react";
import { VendasAnalise } from "@/components/VendasAnalise";
import { PageHeader } from "@/components/AppShell";

export default function VendasPage() {
  return (
    <>
      <PageHeader
        title="Análise de vendas"
        subtitle="Composição de custos, ranking de vendedores, lojas e giro por marca"
        action={
          <Link href="/upload" className="inline-flex items-center gap-2 rounded-lg bg-[var(--brand-700)] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-[var(--brand-800)]">
            <Upload className="h-4 w-4" /> Novo upload
          </Link>
        }
      />
      <div className="mx-auto max-w-7xl px-6 py-8">
        <VendasAnalise />
      </div>
    </>
  );
}
