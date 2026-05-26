import Link from "next/link";
import { Upload, Car, Building2, Sparkles } from "lucide-react";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <header className="mb-10">
          <h1 className="text-3xl font-bold tracking-tight">🚗 Navesa Mesa</h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            Mesa de precificação de seminovos — substituindo o Excel.
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          <Card href="/upload" icon={<Upload className="h-6 w-6" />} title="Subir relatório NBS" desc="Faça upload do XLSX exportado do NBS." />
          <Card href="/veiculos" icon={<Car className="h-6 w-6" />} title="Estoque de veículos" desc="Listagem, filtros por loja e KPIs." />
          <Card href="/lojas" icon={<Building2 className="h-6 w-6" />} title="Cadastro de lojas" desc="Mapeie código → nome das filiais." />
        </section>

        <section className="mt-10 rounded-lg border border-dashed border-zinc-300 bg-white p-6 dark:border-zinc-700 dark:bg-zinc-900">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-1 h-5 w-5 text-amber-500" />
            <div>
              <h2 className="font-semibold">Status do MVP (Sprint 0 — scaffold)</h2>
              <ul className="mt-2 list-inside list-disc text-sm text-zinc-600 dark:text-zinc-400">
                <li>Estrutura Next 16 + Tailwind 4 ✅</li>
                <li>Parser NBS (xlsx) ✅ — rode <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">npm run parse-test</code></li>
                <li>Schema Supabase ✅ — <code>supabase/migrations/001_initial.sql</code></li>
                <li>Próximo: criar projeto Supabase + preencher <code>.env.local</code> (ver <code>docs/SETUP.md</code>)</li>
              </ul>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function Card({ href, icon, title, desc }: { href: string; icon: React.ReactNode; title: string; desc: string }) {
  return (
    <Link
      href={href}
      className="group rounded-lg border border-zinc-200 bg-white p-5 transition hover:border-zinc-400 hover:shadow dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
    >
      <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-md bg-zinc-100 text-zinc-700 group-hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300">
        {icon}
      </div>
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{desc}</p>
    </Link>
  );
}
