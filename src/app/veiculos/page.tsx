import Link from "next/link";
import { VeiculosTable } from "@/components/VeiculosTable";

export default function VeiculosPage() {
  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="mx-auto max-w-7xl px-6 py-10">
        <div className="flex items-center justify-between">
          <div>
            <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">← voltar</Link>
            <h1 className="mt-4 text-2xl font-bold">🚗 Estoque de veículos</h1>
          </div>
          <Link href="/upload" className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900">📤 Novo upload</Link>
        </div>
        <div className="mt-8">
          <VeiculosTable />
        </div>
      </div>
    </main>
  );
}
