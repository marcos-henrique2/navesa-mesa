"use client";

import { useMemo, useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowUpDown, ArrowUp, ArrowDown, AlertTriangle, Search } from "lucide-react";
import { useInventory, nomeOuCodigo } from "@/lib/store/inventory";
import { cn, formatBRL, formatInt } from "@/lib/utils";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";

function ehPreparacao(v: VeiculoParsed): boolean {
  return v.patio.trim().toUpperCase() === "PREPARAÇÃO";
}

export function VeiculosTable() {
  const { veiculos, meta, lojas, isHydrated } = useInventory();
  const [includePrep, setIncludePrep] = useState(true);
  const [search, setSearch] = useState("");
  const [filtroLoja, setFiltroLoja] = useState<string>("all");
  const [filtroMarca, setFiltroMarca] = useState<string>("all");
  const [filtroPatio, setFiltroPatio] = useState<string>("all");
  const [filtroSituacao, setFiltroSituacao] = useState<string>("all");
  const [sorting, setSorting] = useState<SortingState>([]);

  const lojasCods = useMemo(() => [...new Set(veiculos.map((v) => v.cod_empresa))].sort((a, b) => a - b), [veiculos]);
  const marcas = useMemo(() => [...new Set(veiculos.map((v) => v.marca).filter((m): m is string => !!m))].sort(), [veiculos]);
  const patios = useMemo(() => [...new Set(veiculos.map((v) => v.patio.trim()))].sort(), [veiculos]);
  const situacoes = useMemo(() => [...new Set(veiculos.map((v) => v.descricao_situacao).filter((s): s is string => !!s))].sort(), [veiculos]);

  const filtered = useMemo(() => {
    return veiculos.filter((v) => {
      if (!includePrep && ehPreparacao(v)) return false;
      if (filtroLoja !== "all" && String(v.cod_empresa) !== filtroLoja) return false;
      if (filtroMarca !== "all" && v.marca !== filtroMarca) return false;
      if (filtroPatio !== "all" && v.patio.trim() !== filtroPatio) return false;
      if (filtroSituacao !== "all" && v.descricao_situacao !== filtroSituacao) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = `${v.placa} ${v.chassi} ${v.modelo} ${v.marca ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [veiculos, includePrep, filtroLoja, filtroMarca, filtroPatio, filtroSituacao, search]);

  const kpis = useMemo(() => {
    let realQt = 0, prepQt = 0, realRs = 0, prepRs = 0;
    for (const v of veiculos) {
      const isPrep = ehPreparacao(v);
      const preco = v.preco_venda ?? 0;
      if (isPrep) {
        prepQt++;
        prepRs += preco;
      } else {
        realQt++;
        realRs += preco;
      }
    }
    return { realQt, prepQt, realRs, prepRs, totalQt: realQt + prepQt, totalRs: realRs + prepRs };
  }, [veiculos]);

  const columns = useMemo<ColumnDef<VeiculoParsed>[]>(() => [
    {
      header: "",
      id: "warn",
      cell: ({ row }) => ehPreparacao(row.original) ? <AlertTriangle className="h-4 w-4 text-amber-500" aria-label="Em PREPARAÇÃO" /> : null,
      size: 30,
      enableSorting: false,
    },
    { accessorKey: "cod_empresa", header: "Loja", cell: (info) => {
      const cod = info.getValue<number>();
      const nome = lojas[cod]?.nome?.trim();
      return (
        <span className="text-xs">
          {nome ? (
            <span title={`Cód: ${cod}`}>{nome}</span>
          ) : (
            <span className="text-zinc-500 italic">Loja {cod}</span>
          )}
        </span>
      );
    } },
    { accessorKey: "placa", header: "Placa", cell: (info) => <span className="font-mono text-xs">{info.getValue<string>()}</span> },
    { accessorKey: "marca", header: "Marca" },
    { accessorKey: "modelo", header: "Modelo", cell: (info) => <span className="text-xs">{info.getValue<string>()}</span> },
    { accessorKey: "ano_modelo", header: "Ano", cell: (info) => info.getValue<number | null>() ?? "—" },
    { accessorKey: "cor_externa", header: "Cor" },
    { accessorKey: "combustivel", header: "Comb" },
    { accessorKey: "patio", header: "Pátio", cell: (info) => <span className="text-xs">{info.getValue<string>().trim()}</span> },
    { accessorKey: "preco_venda", header: "Preço Venda", cell: (info) => <span className="tabular-nums">{formatBRL(info.getValue<number | null>())}</span> },
    { accessorKey: "valor_aquisicao", header: "Aquisição", cell: (info) => <span className="tabular-nums text-zinc-600">{formatBRL(info.getValue<number | null>())}</span> },
    { accessorKey: "custo_total", header: "Custo Total", cell: (info) => <span className="tabular-nums text-zinc-600">{formatBRL(info.getValue<number | null>())}</span> },
    { accessorKey: "dias_patio", header: "Dias", cell: (info) => <span className="tabular-nums">{info.getValue<number | null>() ?? "—"}</span> },
  ], []);

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 25 } },
  });

  if (!isHydrated) {
    return <p className="text-sm text-zinc-500">Carregando…</p>;
  }

  if (veiculos.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-12 text-center dark:border-zinc-700 dark:bg-zinc-900">
        <p className="text-zinc-500">Nenhum relatório carregado nessa sessão.</p>
        <a href="/upload" className="mt-3 inline-block rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">📤 Subir o XLSX do NBS</a>
      </div>
    );
  }

  const valorMostradoTotal = includePrep ? kpis.totalRs : kpis.realRs;
  const qtMostrada = includePrep ? kpis.totalQt : kpis.realQt;

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid gap-4 md:grid-cols-3">
        <KpiCard
          title="Estoque REAL"
          value={formatBRL(kpis.realRs)}
          subtitle={`${formatInt(kpis.realQt)} carros (excl. preparação)`}
          tone="green"
        />
        <KpiCard
          title="Em PREPARAÇÃO"
          value={formatBRL(kpis.prepRs)}
          subtitle={`${formatInt(kpis.prepQt)} carros fantasmas`}
          tone="amber"
        />
        <KpiCard
          title="TOTAL GERAL"
          value={formatBRL(kpis.totalRs)}
          subtitle={`${formatInt(kpis.totalQt)} carros em ${meta?.total_lojas ?? 0} lojas`}
          tone="zinc"
        />
      </div>

      {/* Toggle + Filtros */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={includePrep} onChange={(e) => setIncludePrep(e.target.checked)} className="h-4 w-4 rounded" />
          Incluir PREPARAÇÃO
        </label>

        <Select label="Loja" value={filtroLoja} onChange={setFiltroLoja} options={[["all", "Todas"], ...lojasCods.map((l) => [String(l), nomeOuCodigo(lojas, l)])]} />
        <Select label="Marca" value={filtroMarca} onChange={setFiltroMarca} options={[["all", "Todas"], ...marcas.map((m) => [m, m])]} />
        <Select label="Pátio" value={filtroPatio} onChange={setFiltroPatio} options={[["all", "Todos"], ...patios.map((p) => [p, p])]} />
        <Select label="Situação" value={filtroSituacao} onChange={setFiltroSituacao} options={[["all", "Todas"], ...situacoes.map((s) => [s, s])]} />

        <div className="relative ml-auto">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-zinc-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Placa, chassi, modelo…"
            className="w-64 rounded-md border border-zinc-300 bg-white pl-8 pr-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
      </div>

      {/* Resultado */}
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Mostrando <strong>{formatInt(filtered.length)}</strong> de {formatInt(qtMostrada)} carros (filtro ativo) · valor exibido total: <strong>{formatBRL(valorMostradoTotal)}</strong>
      </p>

      {/* Tabela */}
      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => (
                    <th
                      key={h.id}
                      className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-zinc-600 dark:text-zinc-400"
                      style={{ width: h.column.columnDef.size }}
                    >
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
                  className={cn(
                    "border-b border-zinc-100 last:border-0 dark:border-zinc-800",
                    ehPreparacao(row.original) && "bg-amber-50/40 dark:bg-amber-950/10",
                  )}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-3 py-2 align-middle">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
              {table.getRowModel().rows.length === 0 && (
                <tr><td colSpan={columns.length} className="py-12 text-center text-zinc-500">Nenhum veículo com esses filtros.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Paginação */}
        <div className="flex items-center justify-between gap-3 border-t border-zinc-200 bg-zinc-50 px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-950">
          <span>
            Página {table.getState().pagination.pageIndex + 1} de {table.getPageCount()}
          </span>
          <div className="flex gap-1">
            <button onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} className="rounded-md border border-zinc-300 px-2 py-1 disabled:opacity-40 dark:border-zinc-700">‹</button>
            <button onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} className="rounded-md border border-zinc-300 px-2 py-1 disabled:opacity-40 dark:border-zinc-700">›</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ title, value, subtitle, tone }: { title: string; value: string; subtitle: string; tone: "green" | "amber" | "zinc" }) {
  const toneClass = {
    green: "border-l-green-500",
    amber: "border-l-amber-500",
    zinc: "border-l-zinc-500",
  }[tone];
  return (
    <div className={cn("rounded-lg border border-zinc-200 border-l-4 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900", toneClass)}>
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{title}</p>
      <p className="mt-2 text-2xl font-bold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-zinc-500">{subtitle}</p>
    </div>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: (string[])[] }) {
  return (
    <label className="flex items-center gap-1.5 text-sm">
      <span className="text-zinc-500">{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      >
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}
