import Link from "next/link";
import { LojasTable } from "@/components/LojasTable";

export default function LojasPage() {
  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">← voltar</Link>
        <h1 className="mt-4 text-2xl font-bold">🏢 Cadastro de lojas</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Mapeie cada código de empresa do NBS para um nome legível. Esses nomes aparecem na listagem de veículos e nos filtros.
        </p>
        <div className="mt-8">
          <LojasTable />
        </div>
      </div>
    </main>
  );
}
