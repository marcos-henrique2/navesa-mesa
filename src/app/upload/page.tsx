import { UploadDropzone } from "@/components/UploadDropzone";
import { PageHeader } from "@/components/AppShell";
import { BackupRestore } from "@/components/BackupRestore";
import { MigrarParaSupabase } from "@/components/MigrarParaSupabase";
import { ExportExcelButton } from "@/components/ExportExcelButton";

export default function UploadPage() {
  return (
    <>
      <PageHeader
        title="Upload de relatórios"
        subtitle="Exporte do NBS e arraste aqui — processamento 100% local no navegador"
      />
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6">
          <ExportExcelButton />
        </div>
        <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-4">
          <UploadDropzone modo="estoque" />
          <UploadDropzone modo="vendas" />
          <UploadDropzone modo="custos" />
          <UploadDropzone modo="custos-estoque" />
        </div>

        <div className="mt-8 rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-5 shadow-[var(--shadow-sm)]">
          <p className="text-sm font-semibold text-[var(--text-strong)]">📋 Qual é qual?</p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-[var(--text-body)]">
            <li><strong className="text-blue-700 dark:text-blue-400">Estoque</strong> — &quot;Veículos em Estoque&quot;. Mostra o que está no pátio agora.</li>
            <li><strong className="text-purple-700 dark:text-purple-400">Vendas</strong> — &quot;Veículos Vendidos&quot;. Histórico de vendas com cliente, vendedor, dias de giro.</li>
            <li><strong className="text-emerald-700 dark:text-emerald-400">Custos</strong> — &quot;Relatório de Custos&quot; (.xls). Tem a margem oficial NBS centavo-a-centavo de carros VENDIDOS: Nota Fábrica, Forplan, Impostos, Comissões, Ganhos Indiretos (bônus de fábrica).</li>
            <li><strong className="text-amber-700 dark:text-amber-400">Custos de Estoque</strong> — &quot;Custos de Veículos em Estoque&quot; (.pdf). Markup detalhado de carros AINDA NO PÁTIO: Nota Fábrica, Revisões, Forplan, ADM, Impostos, Bônus, Ganhos Indiretos, Lucro Bruto projetado. Aparece no detalhe do veículo.</li>
          </ul>
        </div>

        <div className="mt-6 space-y-4">
          <MigrarParaSupabase />
          <BackupRestore />
        </div>
      </div>
    </>
  );
}
