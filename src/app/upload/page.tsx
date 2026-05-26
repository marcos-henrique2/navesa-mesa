import { UploadDropzone } from "@/components/UploadDropzone";
import { PageHeader } from "@/components/AppShell";

export default function UploadPage() {
  return (
    <>
      <PageHeader
        title="Upload de relatórios"
        subtitle="Exporte do NBS e arraste aqui — processamento 100% local no navegador"
      />
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="grid gap-6 md:grid-cols-2">
          <UploadDropzone modo="estoque" />
          <UploadDropzone modo="vendas" />
        </div>

        <div className="mt-8 rounded-xl border border-[var(--border-soft)] bg-white p-5 shadow-[var(--shadow-sm)]">
          <p className="text-sm font-semibold text-slate-900">📋 Qual é qual?</p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-slate-600">
            <li><strong>Estoque</strong> — relatório &quot;Veículos em Estoque&quot; (~556 colunas). Mostra o que está no pátio agora.</li>
            <li><strong>Vendas</strong> — relatório &quot;Veículos Vendidos&quot; (~344 colunas). Mostra o histórico com cliente, vendedor, margem e dias de giro.</li>
          </ul>
        </div>
      </div>
    </>
  );
}
