import { UploadDropzone } from "@/components/UploadDropzone";
import { PageHeader } from "@/components/AppShell";
import { BackupRestore } from "@/components/BackupRestore";

export default function UploadPage() {
  return (
    <>
      <PageHeader
        title="Upload de relatórios"
        subtitle="Exporte do NBS e arraste aqui — processamento 100% local no navegador"
      />
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="grid gap-6 lg:grid-cols-3">
          <UploadDropzone modo="estoque" />
          <UploadDropzone modo="vendas" />
          <UploadDropzone modo="custos" />
        </div>

        <div className="mt-8 rounded-xl border border-[var(--border-soft)] bg-white p-5 shadow-[var(--shadow-sm)]">
          <p className="text-sm font-semibold text-slate-900">📋 Qual é qual?</p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-slate-600">
            <li><strong className="text-blue-700">Estoque</strong> — &quot;Veículos em Estoque&quot;. Mostra o que está no pátio agora.</li>
            <li><strong className="text-purple-700">Vendas</strong> — &quot;Veículos Vendidos&quot;. Histórico de vendas com cliente, vendedor, dias de giro.</li>
            <li><strong className="text-emerald-700">Custos</strong> — &quot;Relatório de Custos&quot; (.xls). Tem a margem oficial NBS centavo-a-centavo: Nota Fábrica, Forplan, Impostos, Comissões, Ganhos Indiretos (bônus de fábrica). <strong>Sem ele, a margem usa estimativa.</strong></li>
          </ul>
        </div>

        <div className="mt-6">
          <BackupRestore />
        </div>
      </div>
    </>
  );
}
