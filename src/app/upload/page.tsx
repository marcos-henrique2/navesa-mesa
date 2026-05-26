import Link from "next/link";
import { UploadDropzone } from "@/components/UploadDropzone";

export default function UploadPage() {
  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="mx-auto max-w-5xl px-6 py-12">
        <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">← voltar</Link>
        <h1 className="mt-4 text-2xl font-bold">📤 Upload de relatórios NBS</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Os arquivos são processados no seu navegador (não saem da sua máquina). Os dados ficam salvos entre sessões.
        </p>

        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <UploadDropzone modo="estoque" />
          <UploadDropzone modo="vendas" />
        </div>

        <div className="mt-8 rounded-lg border border-zinc-200 bg-white p-4 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          <p><strong>Qual é qual?</strong></p>
          <ul className="mt-1 list-inside list-disc space-y-1">
            <li><strong>Estoque</strong> — relatório &quot;Veículos em Estoque&quot; (~556 cols). Mostra o que está no pátio agora.</li>
            <li><strong>Vendas</strong> — relatório &quot;Veículos Vendidos&quot; (~344 cols). Mostra o histórico de vendas com cliente, vendedor, margem, dias até venda.</li>
          </ul>
        </div>
      </div>
    </main>
  );
}
