"use client";

import Link from "next/link";
import { Upload, Car, Building2, Sparkles, FileSpreadsheet, TrendingUp } from "lucide-react";
import { useInventory } from "@/lib/store/inventory";
import { formatBRL, formatInt, cn } from "@/lib/utils";

export function DashboardHome() {
  const { meta, veiculos, vendasMeta, vendas, isHydrated } = useInventory();

  let realQt = 0, prepQt = 0, realRs = 0, prepRs = 0;
  for (const v of veiculos) {
    const isPrep = v.patio.trim().toUpperCase() === "PREPARAÇÃO";
    const preco = v.preco_venda ?? 0;
    if (isPrep) { prepQt++; prepRs += preco; } else { realQt++; realRs += preco; }
  }

  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <header className="mb-10">
          <h1 className="text-3xl font-bold tracking-tight">🚗 Navesa Mesa</h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">Mesa de precificação de seminovos — substituindo o Excel.</p>
        </header>

        {isHydrated && veiculos.length > 0 && (
          <section className="mb-8 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="h-5 w-5 text-zinc-500" />
              <div className="flex-1">
                <p className="font-medium">{meta?.arquivo_nome ?? "Relatório carregado"}</p>
                <p className="text-xs text-zinc-500">
                  {formatInt(meta?.total_veiculos ?? veiculos.length)} veículos · {formatInt(meta?.total_lojas ?? 0)} lojas
                  {meta?.data_geracao ? ` · gerado em ${new Date(meta.data_geracao).toLocaleString("pt-BR")}` : ""}
                </p>
              </div>
              <Link href="/veiculos" className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900">Ver estoque →</Link>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <Kpi tone="green" title="Estoque REAL" value={formatBRL(realRs)} subtitle={`${formatInt(realQt)} carros`} />
              <Kpi tone="amber" title="Em PREPARAÇÃO" value={formatBRL(prepRs)} subtitle={`${formatInt(prepQt)} fantasmas`} />
              <Kpi tone="zinc" title="TOTAL" value={formatBRL(realRs + prepRs)} subtitle={`${formatInt(realQt + prepQt)} carros`} />
            </div>
          </section>
        )}

        <section className="grid gap-4 md:grid-cols-4">
          <Card href="/upload" icon={<Upload className="h-6 w-6" />} title={veiculos.length > 0 ? "Novo upload" : "Subir relatórios"} desc="XLSX de estoque ou vendas do NBS." />
          <Card href="/veiculos" icon={<Car className="h-6 w-6" />} title="Estoque" desc={veiculos.length > 0 ? `${formatInt(veiculos.length)} veículos` : "Listagem, filtros e KPIs."} />
          <Card href="/vendas" icon={<TrendingUp className="h-6 w-6" />} title="Análise de vendas" desc={vendas.length > 0 ? `${formatInt(vendas.length)} vendas` : "Ranking de vendedores, giro por marca, margem por loja."} />
          <Card href="/lojas" icon={<Building2 className="h-6 w-6" />} title="Lojas" desc="Código → nome das filiais." />
        </section>

        {isHydrated && vendas.length > 0 && vendasMeta && (
          <section className="mt-6 rounded-lg border border-purple-200 bg-purple-50/40 p-5 dark:border-purple-900 dark:bg-purple-950/20">
            <div className="flex items-center gap-3">
              <TrendingUp className="h-5 w-5 text-purple-600" />
              <div className="flex-1">
                <p className="font-medium">{formatInt(vendasMeta.total_vendas)} vendas registradas · {formatInt(vendasMeta.total_vendedores)} vendedores</p>
                <p className="text-xs text-zinc-500">
                  Período {vendasMeta.periodo_inicio ? new Date(vendasMeta.periodo_inicio).toLocaleDateString("pt-BR") : "?"} → {vendasMeta.periodo_fim ? new Date(vendasMeta.periodo_fim).toLocaleDateString("pt-BR") : "?"}
                </p>
              </div>
              <Link href="/vendas" className="rounded-md bg-purple-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-700">Ver análise →</Link>
            </div>
          </section>
        )}

        {isHydrated && veiculos.length === 0 && (
          <section className="mt-10 rounded-lg border border-dashed border-zinc-300 bg-white p-6 dark:border-zinc-700 dark:bg-zinc-900">
            <div className="flex items-start gap-3">
              <Sparkles className="mt-1 h-5 w-5 text-amber-500" />
              <div>
                <h2 className="font-semibold">Comece subindo o relatório do NBS</h2>
                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                  Por enquanto o sistema roda <strong>localmente no seu navegador</strong> — nada vai pra cloud. Quando configurarmos Supabase, os dados passam a persistir entre sessões e entre dispositivos.
                </p>
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function Card({ href, icon, title, desc }: { href: string; icon: React.ReactNode; title: string; desc: string }) {
  return (
    <Link href={href} className="group rounded-lg border border-zinc-200 bg-white p-5 transition hover:border-zinc-400 hover:shadow dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600">
      <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-md bg-zinc-100 text-zinc-700 group-hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300">{icon}</div>
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{desc}</p>
    </Link>
  );
}

function Kpi({ title, value, subtitle, tone }: { title: string; value: string; subtitle: string; tone: "green" | "amber" | "zinc" }) {
  const toneClass = { green: "border-l-green-500", amber: "border-l-amber-500", zinc: "border-l-zinc-500" }[tone];
  return (
    <div className={cn("rounded-md border border-zinc-200 border-l-4 bg-zinc-50/50 p-3 dark:border-zinc-800 dark:bg-zinc-950/30", toneClass)}>
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{title}</p>
      <p className="mt-1 text-xl font-bold tabular-nums">{value}</p>
      <p className="text-xs text-zinc-500">{subtitle}</p>
    </div>
  );
}
