"use client";

import { useMemo, useState } from "react";
import {
  useReactTable, getCoreRowModel, getFilteredRowModel, getSortedRowModel, getPaginationRowModel,
  flexRender, type ColumnDef, type SortingState,
} from "@tanstack/react-table";
import { ArrowUpDown, ArrowUp, ArrowDown, Search, Trophy, TrendingDown, TrendingUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useInventory } from "@/lib/store/inventory";
import { formatBRL, formatInt, cn } from "@/lib/utils";
import { ComposicaoCustos } from "./ComposicaoCustos";
import type { VendaParsed } from "@/lib/parsers/nbs-vendas-xlsx";

export function VendasAnalise() {
  const router = useRouter();
  const { vendas, vendasMeta, isHydrated } = useInventory();

  const [search, setSearch] = useState("");
  const [filtroLoja, setFiltroLoja] = useState("all");
  const [filtroVendedor, setFiltroVendedor] = useState("all");
  const [filtroMarca, setFiltroMarca] = useState("all");
  const [filtroUf, setFiltroUf] = useState("all");
  const [filtroTipoCli, setFiltroTipoCli] = useState<"all" | "PF" | "PJ" | "troca">("all");
  const [sorting, setSorting] = useState<SortingState>([]);

  const lojas = useMemo(() => [...new Set(vendas.map((v) => v.empresa_nome).filter((x): x is string => !!x))].sort(), [vendas]);
  const vendedores = useMemo(() => [...new Set(vendas.map((v) => v.vendedor_nome).filter((x): x is string => !!x))].sort(), [vendas]);
  const marcas = useMemo(() => [...new Set(vendas.map((v) => v.marca).filter((m): m is string => !!m))].sort(), [vendas]);
  const ufs = useMemo(() => [...new Set(vendas.map((v) => v.cliente_uf).filter((u): u is string => !!u))].sort(), [vendas]);

  const filtered = useMemo(() => {
    return vendas.filter((v) => {
      if (filtroLoja !== "all" && v.empresa_nome !== filtroLoja) return false;
      if (filtroVendedor !== "all" && v.vendedor_nome !== filtroVendedor) return false;
      if (filtroMarca !== "all" && v.marca !== filtroMarca) return false;
      if (filtroUf !== "all" && v.cliente_uf !== filtroUf) return false;
      if (filtroTipoCli === "PF" && v.cliente_tipo !== "PF") return false;
      if (filtroTipoCli === "PJ" && v.cliente_tipo !== "PJ") return false;
      if (filtroTipoCli === "troca" && !v.placa_troca) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = `${v.placa} ${v.chassi} ${v.modelo} ${v.cliente_nome} ${v.vendedor_nome ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [vendas, filtroLoja, filtroVendedor, filtroMarca, filtroUf, filtroTipoCli, search]);

  const kpis = useMemo(() => {
    let valor = 0, custo = 0, comissao = 0, dias = 0, comDias = 0;
    let pf = 0, pj = 0, troca = 0;
    for (const v of filtered) {
      valor += v.valor_venda ?? 0;
      custo += v.custo_total_final ?? 0;
      comissao += v.comissao_vendedor ?? 0;
      if (v.dias_estoque !== null) { dias += v.dias_estoque; comDias++; }
      if (v.cliente_tipo === "PF") pf++;
      else if (v.cliente_tipo === "PJ") pj++;
      if (v.placa_troca) troca++;
    }
    const margem = valor - custo;
    return {
      qt: filtered.length, valor, custo, margem, comissao,
      margemPct: custo > 0 ? (margem / custo) * 100 : 0,
      ticketMedio: filtered.length > 0 ? valor / filtered.length : 0,
      diasMedio: comDias > 0 ? dias / comDias : 0,
      pf, pj, troca,
    };
  }, [filtered]);

  // Rankings
  const rankingLojas = useMemo(() => {
    const map = new Map<string, { qt: number; valor: number; margem: number; dias: number; comDias: number }>();
    for (const v of filtered) {
      const k = v.empresa_nome || `Loja ${v.cod_empresa}`;
      const agg = map.get(k) ?? { qt: 0, valor: 0, margem: 0, dias: 0, comDias: 0 };
      agg.qt++;
      agg.valor += v.valor_venda ?? 0;
      agg.margem += (v.valor_venda ?? 0) - (v.custo_total_final ?? 0);
      if (v.dias_estoque !== null) { agg.dias += v.dias_estoque; agg.comDias++; }
      map.set(k, agg);
    }
    return [...map.entries()].map(([nome, agg]) => ({
      nome, ...agg, diasMedio: agg.comDias > 0 ? agg.dias / agg.comDias : 0, margemPct: agg.valor > 0 ? (agg.margem / (agg.valor - agg.margem)) * 100 : 0,
    })).sort((a, b) => b.valor - a.valor);
  }, [filtered]);

  const rankingVendedores = useMemo(() => {
    const map = new Map<string, { qt: number; valor: number; margem: number; comissao: number }>();
    for (const v of filtered) {
      const k = v.vendedor_nome || v.vendedor_codigo || "(sem vendedor)";
      const agg = map.get(k) ?? { qt: 0, valor: 0, margem: 0, comissao: 0 };
      agg.qt++;
      agg.valor += v.valor_venda ?? 0;
      agg.margem += (v.valor_venda ?? 0) - (v.custo_total_final ?? 0);
      agg.comissao += v.comissao_vendedor ?? 0;
      map.set(k, agg);
    }
    return [...map.entries()].map(([nome, agg]) => ({ nome, ...agg })).sort((a, b) => b.qt - a.qt);
  }, [filtered]);

  const rankingMarcas = useMemo(() => {
    const map = new Map<string, { qt: number; valor: number; dias: number; comDias: number }>();
    for (const v of filtered) {
      const k = v.marca ?? "(sem marca)";
      const agg = map.get(k) ?? { qt: 0, valor: 0, dias: 0, comDias: 0 };
      agg.qt++;
      agg.valor += v.valor_venda ?? 0;
      if (v.dias_estoque !== null) { agg.dias += v.dias_estoque; agg.comDias++; }
      map.set(k, agg);
    }
    return [...map.entries()].map(([nome, agg]) => ({
      nome, ...agg, diasMedio: agg.comDias > 0 ? agg.dias / agg.comDias : 0,
    })).sort((a, b) => a.diasMedio - b.diasMedio); // mais rápido primeiro
  }, [filtered]);

  const columns = useMemo<ColumnDef<VendaParsed>[]>(() => [
    { accessorKey: "data_venda", header: "Data", cell: (info) => {
      const d = info.getValue<Date | null>();
      return <span className="text-xs">{d ? new Date(d).toLocaleDateString("pt-BR") : "—"}</span>;
    } },
    { accessorKey: "empresa_nome", header: "Loja", cell: (info) => <span className="text-xs">{info.getValue<string | null>() ?? "—"}</span> },
    { accessorKey: "placa", header: "Placa", cell: (info) => <span className="font-mono text-xs">{info.getValue<string>()}</span> },
    { accessorKey: "marca", header: "Marca" },
    { accessorKey: "modelo", header: "Modelo", cell: (info) => <span className="text-xs">{info.getValue<string>()}</span> },
    { accessorKey: "vendedor_nome", header: "Vendedor", cell: (info) => <span className="text-xs">{info.getValue<string | null>() ?? "—"}</span> },
    { accessorKey: "cliente_nome", header: "Cliente", cell: (info) => {
      const row = info.row.original;
      return (
        <div className="text-xs">
          <p className="truncate" style={{ maxWidth: 200 }}>{info.getValue<string>()}</p>
          {row.cliente_tipo && <span className={cn("inline-block rounded px-1 text-[10px] font-medium", row.cliente_tipo === "PF" ? "bg-blue-100 text-blue-800" : "bg-purple-100 text-purple-800")}>{row.cliente_tipo}</span>}
          {row.cliente_uf && row.cliente_uf !== "GO" && <span className="ml-1 text-[10px] text-amber-600">↗ {row.cliente_uf}</span>}
        </div>
      );
    } },
    { accessorKey: "valor_venda", header: "Valor", cell: (info) => <span className="tabular-nums font-medium">{formatBRL(info.getValue<number | null>())}</span> },
    { id: "margem_real", header: "Margem R$", cell: ({ row }) => {
      const margem = (row.original.valor_venda ?? 0) - (row.original.custo_total_final ?? 0);
      const tone = margem > 5000 ? "text-green-700 dark:text-green-400" : margem > 0 ? "" : "text-red-700 dark:text-red-400";
      return <span className={cn("tabular-nums", tone)}>{formatBRL(margem)}</span>;
    } },
    { accessorKey: "dias_estoque", header: "Dias", cell: (info) => {
      const d = info.getValue<number | null>();
      if (d === null) return <span className="text-zinc-400">—</span>;
      const tone = d < 30 ? "text-green-700 dark:text-green-400" : d < 90 ? "" : d < 180 ? "text-amber-700 dark:text-amber-400" : "text-red-700 dark:text-red-400";
      return <span className={cn("tabular-nums", tone)}>{d}</span>;
    } },
    { accessorKey: "comissao_vendedor", header: "Comissão", cell: (info) => <span className="tabular-nums text-xs text-zinc-600">{formatBRL(info.getValue<number | null>())}</span> },
    { id: "troca", header: "Troca", cell: ({ row }) => row.original.placa_troca ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">{row.original.placa_troca}</span> : null },
  ], []);

  const table = useReactTable({
    data: filtered, columns, state: { sorting }, onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(), getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(), getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 25 } },
  });

  if (!isHydrated) return <p className="text-sm text-zinc-500">Carregando…</p>;

  if (vendas.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-12 text-center dark:border-zinc-700 dark:bg-zinc-900">
        <p className="text-zinc-500">Nenhum relatório de vendas carregado.</p>
        <a href="/upload" className="mt-3 inline-block rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700">📤 Subir relatório de vendas</a>
      </div>
    );
  }

  const periodo = vendasMeta?.periodo_inicio && vendasMeta?.periodo_fim
    ? `${new Date(vendasMeta.periodo_inicio).toLocaleDateString("pt-BR")} → ${new Date(vendasMeta.periodo_fim).toLocaleDateString("pt-BR")}`
    : null;

  return (
    <div className="space-y-6">
      {periodo && (
        <p className="text-xs text-zinc-500">Período: <strong>{periodo}</strong> · {formatInt(vendasMeta!.total_vendas)} vendas · {formatInt(vendasMeta!.total_lojas)} lojas · {formatInt(vendasMeta!.total_vendedores)} vendedores</p>
      )}

      {/* KPIs */}
      <div className="grid gap-3 md:grid-cols-5">
        <KpiCard title="Vendas" value={formatInt(kpis.qt)} subtitle={`${kpis.pf} PF · ${kpis.pj} PJ`} />
        <KpiCard title="Faturamento" value={formatBRL(kpis.valor)} subtitle={`Ticket ${formatBRL(kpis.ticketMedio)}`} />
        <KpiCard title="Margem" value={formatBRL(kpis.margem)} subtitle={`${kpis.margemPct.toFixed(1)}% sobre custo`} tone={kpis.margem > 0 ? "good" : "bad"} />
        <KpiCard title="Tempo médio" value={`${kpis.diasMedio.toFixed(0)} dias`} subtitle="da entrada à venda" />
        <KpiCard title="Trocas" value={formatInt(kpis.troca)} subtitle={`${((kpis.troca / Math.max(1, kpis.qt)) * 100).toFixed(0)}% das vendas`} />
      </div>

      {/* Composição de custos */}
      <ComposicaoCustos vendas={filtered} />

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <Select label="Loja" value={filtroLoja} onChange={setFiltroLoja} options={[["all", "Todas"], ...lojas.map((l) => [l, l] as [string, string])]} />
        <Select label="Vendedor" value={filtroVendedor} onChange={setFiltroVendedor} options={[["all", "Todos"], ...vendedores.map((v) => [v, v] as [string, string])]} />
        <Select label="Marca" value={filtroMarca} onChange={setFiltroMarca} options={[["all", "Todas"], ...marcas.map((m) => [m, m] as [string, string])]} />
        <Select label="UF" value={filtroUf} onChange={setFiltroUf} options={[["all", "Todos"], ...ufs.map((u) => [u, u] as [string, string])]} />
        <Select label="Tipo" value={filtroTipoCli} onChange={(v) => setFiltroTipoCli(v as typeof filtroTipoCli)} options={[["all", "Todos"], ["PF", "Só PF"], ["PJ", "Só PJ"], ["troca", "Com troca"]]} />

        <div className="relative ml-auto">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-zinc-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Placa, chassi, modelo, cliente…"
            className="w-64 rounded-md border border-zinc-300 bg-white pl-8 pr-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
      </div>

      {/* Rankings */}
      <div className="grid gap-4 lg:grid-cols-3">
        <RankCard title="Top Lojas (faturamento)" icon={<Trophy className="h-4 w-4" />} items={rankingLojas.slice(0, 6).map((l) => ({
          label: l.nome,
          primary: formatBRL(l.valor),
          secondary: `${l.qt} vendas · margem ${formatBRL(l.margem)}`,
          tone: l.margem < 0 ? "bad" : l.margem > 100000 ? "good" : undefined,
        }))} />

        <RankCard title="Top Vendedores (quantidade)" icon={<Trophy className="h-4 w-4" />} items={rankingVendedores.slice(0, 6).map((v) => ({
          label: v.nome,
          primary: `${v.qt} vendas`,
          secondary: `${formatBRL(v.valor)} · com. ${formatBRL(v.comissao)}`,
        }))} />

        <RankCard title="Marcas que mais giram" icon={<TrendingUp className="h-4 w-4" />} items={rankingMarcas.slice(0, 6).map((m) => ({
          label: m.nome,
          primary: `${m.diasMedio.toFixed(0)} dias`,
          secondary: `${m.qt} vendas · ${formatBRL(m.valor)}`,
          tone: m.diasMedio < 45 ? "good" : m.diasMedio > 90 ? "bad" : undefined,
        }))} />
      </div>

      {/* Marcas que travam */}
      {rankingMarcas.length > 6 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-900 dark:bg-amber-950/20">
          <h4 className="flex items-center gap-1.5 text-sm font-semibold text-amber-900 dark:text-amber-200">
            <TrendingDown className="h-3.5 w-3.5" /> Marcas com maior tempo de giro
          </h4>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {[...rankingMarcas].sort((a, b) => b.diasMedio - a.diasMedio).slice(0, 6).map((m) => (
              <div key={m.nome} className="flex items-center justify-between rounded-md bg-white px-3 py-1.5 text-xs dark:bg-zinc-900">
                <span>{m.nome}</span>
                <span className="tabular-nums font-semibold text-amber-700 dark:text-amber-400">{m.diasMedio.toFixed(0)} dias</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Resultado */}
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Mostrando <strong>{formatInt(filtered.length)}</strong> venda{filtered.length === 1 ? "" : "s"} · valor: <strong>{formatBRL(kpis.valor)}</strong> · margem: <strong className={kpis.margem < 0 ? "text-red-700" : "text-green-700"}>{formatBRL(kpis.margem)}</strong>
      </p>

      {/* Tabela */}
      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => (
                    <th key={h.id} className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
                      {h.column.getCanSort() ? (
                        <button onClick={h.column.getToggleSortingHandler()} className="inline-flex items-center gap-1 hover:text-zinc-900 dark:hover:text-zinc-100">
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {h.column.getIsSorted() === "asc" ? <ArrowUp className="h-3 w-3" /> : h.column.getIsSorted() === "desc" ? <ArrowDown className="h-3 w-3" /> : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                        </button>
                      ) : flexRender(h.column.columnDef.header, h.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => router.push(`/vendas/${row.original.chassi}`)}
                  className="cursor-pointer border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50"
                  title="Clique para ver detalhe"
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-3 py-2 align-middle">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
              {table.getRowModel().rows.length === 0 && (
                <tr><td colSpan={columns.length} className="py-12 text-center text-zinc-500">Nenhuma venda com esses filtros.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-zinc-200 bg-zinc-50 px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-950">
          <span>Página {table.getState().pagination.pageIndex + 1} de {table.getPageCount() || 1}</span>
          <div className="flex gap-1">
            <button onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} className="rounded-md border border-zinc-300 px-2 py-1 disabled:opacity-40 dark:border-zinc-700">‹</button>
            <button onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} className="rounded-md border border-zinc-300 px-2 py-1 disabled:opacity-40 dark:border-zinc-700">›</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ title, value, subtitle, tone }: { title: string; value: string; subtitle: string; tone?: "good" | "bad" }) {
  const tones = {
    good: { bg: "from-emerald-50 to-white", bar: "bg-emerald-500", label: "text-emerald-700" },
    bad: { bg: "from-red-50 to-white", bar: "bg-red-500", label: "text-red-700" },
    neutral: { bg: "from-[var(--brand-50)] to-white", bar: "bg-[var(--brand-600)]", label: "text-[var(--brand-700)]" },
  };
  const t = tones[tone ?? "neutral"];
  return (
    <div className={cn("relative overflow-hidden rounded-xl border border-[var(--border-soft)] bg-gradient-to-br p-4 shadow-[var(--shadow-sm)]", t.bg)}>
      <div className={cn("absolute left-0 top-0 h-full w-1", t.bar)} />
      <p className={cn("text-[10px] font-semibold uppercase tracking-wider", t.label)}>{title}</p>
      <p className="mt-1 text-xl font-bold tabular-nums tracking-tight text-slate-900">{value}</p>
      <p className="text-[11px] text-slate-500">{subtitle}</p>
    </div>
  );
}

function RankCard({ title, icon, items }: { title: string; icon: React.ReactNode; items: { label: string; primary: string; secondary: string; tone?: "good" | "bad" }[] }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <header className="flex items-center gap-2 border-b border-zinc-200 px-4 py-2 text-sm font-semibold dark:border-zinc-800">{icon} {title}</header>
      <ol className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {items.map((item, i) => (
          <li key={i} className="flex items-center justify-between px-4 py-2">
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="text-xs text-zinc-400 tabular-nums">{i + 1}.</span>
              <span className="truncate text-sm">{item.label}</span>
            </div>
            <div className="text-right">
              <p className={cn("text-sm font-semibold tabular-nums", item.tone === "good" && "text-green-700 dark:text-green-400", item.tone === "bad" && "text-red-700 dark:text-red-400")}>{item.primary}</p>
              <p className="text-[10px] text-zinc-500">{item.secondary}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="flex items-center gap-1.5 text-sm">
      <span className="text-zinc-500">{label}:</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="max-w-56 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}
