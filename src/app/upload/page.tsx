import Link from "next/link";
import { UploadDropzone } from "@/components/UploadDropzone";

export default function UploadPage() {
  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">← voltar</Link>
        <h1 className="mt-4 text-2xl font-bold">📤 Upload do relatório NBS</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          O arquivo é processado no seu navegador (não sai da sua máquina). Os dados ficam disponíveis na sessão até você fazer um novo upload.
        </p>
        <div className="mt-8">
          <UploadDropzone />
        </div>
      </div>
    </main>
  );
}
