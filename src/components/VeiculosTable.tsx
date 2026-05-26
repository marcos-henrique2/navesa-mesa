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
import { ArrowUpDown, ArrowUp, ArrowDown, AlertTriangle, Search, SlidersHorizontal, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useInventory } from "@/lib/store/inventory";
import { cn, formatBRL, formatInt } from "@/lib/utils";
import { ResumoPorDimensao } from "./ResumoPorDimensao";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";

type StatusFiltro = "all" | "real" | "prep";

function ehPreparacao(v: VeiculoParsed): boolean {
  return v.patio.trim().toUpperCase() === "PREPARAÇÃO";
}

export function VeiculosTable() {
  const router = useRouter();
  const { veiculos, lojas, isHydrated } = useInventory();

  const [statusFiltro, setStatusFiltro] = useState<StatusFiltro>("all");
  const [search, setSearch] = useState("");
  const [filtroLoja, setFiltroLoja] = useState<string>("all");
  const [filtroMarca, setFiltroMarca] = useState<string>("all");
  const [filtroCor, setFiltroCor] = useState<string>("all");
  const [filtroComb, setFiltroComb] = useState<string>("all");
  const [filtroSituacao, setFiltroSituacao] = useState<string>("all");
  const [filtroPatio, setFiltroPatio] = useState<string>("all");
  const [avancadoOpen, setAvancadoOpen] = useState(false);
  const [anoMin, setAnoMin] = useState<string>("");
  const [anoMax, setAnoMax] = useState<string>("");
  const [kmMin, setKmMin] = useState<string>("");
  const [kmMax, setKmMax] = useState<string>("");
  const [precoMin, setPrecoMin] = useState<string>("");
  const [precoMax, setPrecoMax] = useState<string>("");
  const [diasMin, setDiasMin] = useState<string>("");
  const [diasMax, setDiasMax] = useState<string>("");
  const [sorting, setSorting] = useState<SortingState>([]);

  const lojasCods = useMemo(() => [...new Set(veiculos.map((v) => v.cod_empresa))].sort((a, b) => a - b), [veiculos]);
  const marcas = useMemo(() => [...new Set(veiculos.map((v) => v.marca).filter((m): m is string => !!m))].sort(), [veiculos]);
  const cores = useMemo(() => [...new Set(veiculos.map((v) => v.cor_externa).filter((c): c is string => !!c))].sort(), [veiculos]);
  const combs = useMemo(() => [...new Set(veiculos.map((v) => v.combustivel).filter((c): c is string => !!c))].sort(), [veiculos]);
  const patios = useMemo(() => [...new Set(veiculos.map((v) => v.patio.trim()))].sort(), [veiculos]);
  const situacoes = useMemo(() => [...new Set(veiculos.map((v) => v.descricao_situacao).filter((s): s is string => !!s))].sort(), [veiculos]);

  const num = (s: string): number | null => {
    const n = Number(s);
    return s.trim() === "" || !Number.isFinite(n) ? null : n;
  };

  // Filtros aplicados EXCETO status. Usado para KPIs e resumo agregado por status.
  const filteredExceptStatus = useMemo(() => {
    const aMin = num(anoMin), aMax = num(anoMax);
    const kMin = num(kmMin), kMax = num(kmMax);
    const pMin = num(precoMin), pMax = num(precoMax);
    const dMin = num(diasMin), dMax = num(diasMax);

    return veiculos.filter((v) => {
      if (filtroLoja !== "all" && String(v.cod_empresa) !== filtroLoja) return false;
      if (filtroMarca !== "all" && v.marca !== filtroMarca) return false;
      if (filtroCor !== "all" && v.cor_externa !== filtroCor) return false;
      if (filtroComb !== "all" && v.combustivel !== filtroComb) return false;
      if (filtroSituacao !== "all" && v.descricao_situacao !== filtroSituacao) return false;
      if (filtroPatio !== "all" && v.patio.trim() !== filtroPatio) return false;
      if (aMin !== null && (v.ano_modelo ?? -Infinity) < aMin) return false;
      if (aMax !== null && (v.ano_modelo ?? Infinity) > aMax) return false;
      if (kMin !== null && (v.km ?? -Infinity) < kMin) return false;
      if (kMax !== null && (v.km ?? Infinity) > kMax) return false;
      if (pMin !== null && (v.preco_venda ?? -Infinity) < pMin) return false;
      if (pMax !== null && (v.preco_venda ?? Infinity) > pMax) return false;
      if (dMin !== null && (v.dias_patio ?? -Infinity) < dMin) return false;
      if (dMax !== null && (v.dias_patio ?? Infinity) > dMax) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = `${v.placa} ${v.chassi} ${v.modelo} ${v.marca ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [veiculos, filtroLoja, filtroMarca, filtroCor, filtroComb, filtroSituacao, filtroPatio, anoMin, anoMax, kmMin, kmMax, precoMin, precoMax, diasMin, diasMax, search]);

  // Filtros + status final (a tabela exibe esses)
  const filtered = useMemo(() => {
    return filteredExceptStatus.filter((v) => {
      if (statusFiltro === "real" && ehPreparacao(v)) return false;
      if (statusFiltro === "prep" && !ehPreparacao(v)) return false;
      return true;
    });
  }, [filteredExceptStatus, statusFiltro]);

  const kpis = useMemo(() => {
    let realQt = 0, prepQt = 0, realRs = 0, prepRs = 0;
    for (const v of filteredExceptStatus) {
      const preco = v.preco_venda ?? 0;
      if (ehPreparacao(v)) {
        prepQt++;
        prepRs += preco;
      } else {
        realQt++;
        realRs += preco;
      }
    }
    return { realQt, prepQt, realRs, prepRs, totalQt: realQt + prepQt, totalRs: realRs + prepRs };
  }, [filteredExceptStatus]);

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
          {nome ? <span title={`Cód: ${cod}`}>{nome}</span> : <span className="text-zinc-500 italic">Loja {cod}</span>}
        </span>
      );
    } },
    { accessorKey: "placa", header: "Placa", cell: (info) => <span className="font-mono text-xs">{info.getValue<string>()}</span> },
    { accessorKey: "marca", header: "Marca" },
    { accessorKey: "modelo", header: "Modelo", cell: (info) => <span className="text-xs">{info.getValue<string>()}</span> },
    { accessorKey: "ano_modelo", header: "Ano", cell: (info) => info.getValue<number | null>() ?? "—" },
    { accessorKey: "km", header: "KM", cell: (info) => {
      const km = info.getValue<number | null>();
      if (km === null) return <span className="text-zinc-400">—</span>;
      const tone = km < 30000 ? "text-green-700 dark:text-green-400"
        : km < 80000 ? ""
        : km < 150000 ? "text-amber-700 dark:text-amber-400"
        : "text-red-700 dark:text-red-400";
      return <span className={cn("tabular-nums", tone)}>{formatInt(km)}</span>;
    } },
    { accessorKey: "cor_externa", header: "Cor" },
    { accessorKey: "combustivel", header: "Comb" },
    { accessorKey: "patio", header: "Pátio", cell: (info) => <span className="text-xs">{info.getValue<string>().trim()}</span> },
    { accessorKey: "preco_venda", header: "Preço Venda", cell: (info) => <span className="tabular-nums">{formatBRL(info.getValue<number | null>())}</span> },
    { accessorKey: "valor_aquisicao", header: "Aquisição", cell: (info) => <span className="tabular-nums text-zinc-600">{formatBRL(info.getValue<number | null>())}</span> },
    { accessorKey: "custo_total", header: "Custo Total", cell: (info) => <span className="tabular-nums text-zinc-600">{formatBRL(info.getValue<number | null>())}</span> },
    { accessorKey: "dias_patio", header: "Dias", cell: (info) => <span className="tabular-nums">{info.getValue<number | null>() ?? "—"}</span> },
  ], [lojas]);

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

  const limparFiltros = () => {
    setStatusFiltro("all"); setSearch(""); setFiltroLoja("all"); setFiltroMarca("all");
    setFiltroCor("all"); setFiltroComb("all"); setFiltroSituacao("all"); setFiltroPatio("all");
    setAnoMin(""); setAnoMax(""); setKmMin(""); setKmMax("");
    setPrecoMin(""); setPrecoMax(""); setDiasMin(""); setDiasMax("");
  };

  const filtrosAtivos = [
    statusFiltro !== "all",
    !!search,
    filtroLoja !== "all", filtroMarca !== "all", filtroCor !== "all",
    filtroComb !== "all", filtroSituacao !== "all", filtroPatio !== "all",
    !!anoMin, !!anoMax, !!kmMin, !!kmMax, !!precoMin, !!precoMax, !!diasMin, !!diasMax,
  ].filter(Boolean).length;

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

  return (
    <div className="space-y-6">
      {/* Status segmented control */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-zinc-200 bg-white p-1 dark:border-zinc-800 dark:bg-zinc-900">
          <SegBtn active={statusFiltro === "all"} onClick={() => setStatusFiltro("all")}>
            Tudo <span className="ml-1 text-xs opacity-70">({formatInt(kpis.totalQt)})</span>
          </SegBtn>
          <SegBtn active={statusFiltro === "real"} onClick={() => setStatusFiltro("real")} accent="green">
            Só estoque real <span className="ml-1 text-xs opacity-70">({formatInt(kpis.realQt)})</span>
          </SegBtn>
          <SegBtn active={statusFiltro === "prep"} onClick={() => setStatusFiltro("prep")} accent="amber">
            Só preparação <span className="ml-1 text-xs opacity-70">({formatInt(kpis.prepQt)})</span>
          </SegBtn>
        </div>
        {filtrosAtivos > 0 && (
          <button
            onClick={limparFiltros}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
          >
            <X className="h-3 w-3" /> Limpar {filtrosAtivos} filtro{filtrosAtivos > 1 ? "s" : ""}
          </button>
        )}
      </div>

      {/* KPIs reativos */}
      <div className="grid gap-4 md:grid-cols-3">
        <Kpi
          tone="green"
          title="Estoque REAL"
          value={formatBRL(kpis.realRs)}
          subtitle={`${formatInt(kpis.realQt)} carros (exc. preparação)`}
          active={statusFiltro === "real"}
        />
        <Kpi
          tone="amber"
          title="Em PREPARAÇÃO"
          value={formatBRL(kpis.prepRs)}
          subtitle={`${formatInt(kpis.prepQt)} fantasmas`}
          active={statusFiltro === "prep"}
        />
        <Kpi
          tone="zinc"
          title="TOTAL"
          value={formatBRL(kpis.totalRs)}
          subtitle={`${formatInt(kpis.totalQt)} carros`}
          active={statusFiltro === "all"}
        />
      </div>

      {/* Filtros base */}
      <div className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center gap-3">
          <Select label="Loja" value={filtroLoja} onChange={setFiltroLoja} options={[["all", "Todas"], ...lojasCods.map((l) => [String(l), lojas[l]?.nome?.trim() || `Loja ${l}`] as [string, string])]} />
          <Select label="Marca" value={filtroMarca} onChange={setFiltroMarca} options={[["all", "Todas"], ...marcas.map((m) => [m, m] as [string, string])]} />
          <Select label="Cor" value={filtroCor} onChange={setFiltroCor} options={[["all", "Todas"], ...cores.map((c) => [c, c] as [string, string])]} />
          <Select label="Comb" value={filtroComb} onChange={setFiltroComb} options={[["all", "Todos"], ...combs.map((c) => [c, c] as [string, string])]} />
          <Select label="Pátio" value={filtroPatio} onChange={setFiltroPatio} options={[["all", "Todos"], ...patios.map((p) => [p, p] as [string, string])]} />
          <Select label="Situação" value={filtroSituacao} onChange={setFiltroSituacao} options={[["all", "Todas"], ...situacoes.map((s) => [s, s] as [string, string])]} />

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

        <button
          onClick={() => setAvancadoOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          <SlidersHorizontal className="h-3 w-3" />
          {avancadoOpen ? "Ocultar" : "Mostrar"} filtros avançados (ano, km, preço, dias)
        </button>

        {avancadoOpen && (
          <div className="grid gap-3 border-t border-zinc-200 pt-3 dark:border-zinc-800 md:grid-cols-4">
            <Range label="Ano modelo" minVal={anoMin} maxVal={anoMax} onMin={setAnoMin} onMax={setAnoMax} placeholderMin="ex: 2018" placeholderMax="2026" />
            <Range label="Quilometragem" minVal={kmMin} maxVal={kmMax} onMin={setKmMin} onMax={setKmMax} placeholderMin="0" placeholderMax="200000" />
            <Range label="Preço de venda (R$)" minVal={precoMin} maxVal={precoMax} onMin={setPrecoMin} onMax={setPrecoMax} placeholderMin="50000" placeholderMax="500000" />
            <Range label="Dias no pátio" minVal={diasMin} maxVal={diasMax} onMin={setDiasMin} onMax={setDiasMax} placeholderMin="0" placeholderMax="60" />
          </div>
        )}
      </div>

      {/* Resumo agregado */}
      <ResumoPorDimensao veiculos={filtered} lojas={lojas} />

      {/* Resultado da tabela */}
      <div className="flex items-baseline justify-between">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Mostrando <strong>{formatInt(filtered.length)}</strong> carro{filtered.length === 1 ? "" : "s"} ·
          valor exibido: <strong>{formatBRL(filtered.reduce((s, v) => s + (v.preco_venda ?? 0), 0))}</strong>
        </p>
      </div>

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
                  onClick={() => router.push(`/veiculos/${row.original.chassi}`)}
                  className={cn(
                    "cursor-pointer border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50",
                    ehPreparacao(row.original) && "bg-amber-50/40 hover:bg-amber-100/60 dark:bg-amber-950/10 dark:hover:bg-amber-950/20",
                  )}
                  title="Clique para precificar"
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

function SegBtn({ active, onClick, children, accent }: { active: boolean; onClick: () => void; children: React.ReactNode; accent?: "green" | "amber" }) {
  const activeClass = active
    ? accent === "green"
      ? "bg-green-600 text-white"
      : accent === "amber"
        ? "bg-amber-600 text-white"
        : "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
    : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800";
  return (
    <button onClick={onClick} className={cn("rounded-md px-3 py-1.5 text-sm font-medium transition", activeClass)}>
      {children}
    </button>
  );
}

function Kpi({ title, value, subtitle, tone, active }: { title: string; value: string; subtitle: string; tone: "green" | "amber" | "zinc"; active: boolean }) {
  const toneClass = {
    green: { bg: "from-emerald-50 to-white", bar: "bg-emerald-500", label: "text-emerald-700" },
    amber: { bg: "from-amber-50 to-white", bar: "bg-amber-500", label: "text-amber-700" },
    zinc: { bg: "from-[var(--brand-50)] to-white", bar: "bg-[var(--brand-600)]", label: "text-[var(--brand-700)]" },
  }[tone];
  return (
    <div className={cn(
      "relative overflow-hidden rounded-xl border border-[var(--border-soft)] bg-gradient-to-br p-5 shadow-[var(--shadow-sm)] transition",
      toneClass.bg,
      active && "ring-2 ring-[var(--brand-400)]",
    )}>
      <div className={cn("absolute left-0 top-0 h-full w-1", toneClass.bar)} />
      <p className={cn("text-[10px] font-semibold uppercase tracking-wider", toneClass.label)}>{title}</p>
      <p className="mt-2 text-3xl font-bold tabular-nums tracking-tight text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
    </div>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="flex items-center gap-1.5 text-sm">
      <span className="text-zinc-500">{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-48 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      >
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

function Range({ label, minVal, maxVal, onMin, onMax, placeholderMin, placeholderMax }: {
  label: string; minVal: string; maxVal: string; onMin: (v: string) => void; onMax: (v: string) => void; placeholderMin?: string; placeholderMax?: string;
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">{label}</p>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          inputMode="numeric"
          value={minVal}
          onChange={(e) => onMin(e.target.value)}
          placeholder={placeholderMin}
          className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm tabular-nums dark:border-zinc-700 dark:bg-zinc-900"
        />
        <span className="text-xs text-zinc-400">a</span>
        <input
          type="number"
          inputMode="numeric"
          value={maxVal}
          onChange={(e) => onMax(e.target.value)}
          placeholder={placeholderMax}
          className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm tabular-nums dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>
    </div>
  );
}
