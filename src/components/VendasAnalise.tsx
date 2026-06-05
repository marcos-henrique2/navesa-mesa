"use client";

import { useMemo } from "react";
import {
  useReactTable, getCoreRowModel, getFilteredRowModel, getSortedRowModel, getPaginationRowModel,
  flexRender, type ColumnDef,
} from "@tanstack/react-table";
import { ArrowUpDown, ArrowUp, ArrowDown, Search, Trophy, TrendingDown, TrendingUp, AlertCircle, Download, RefreshCw, Loader2, SlidersHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { formatBRL, formatInt, cn } from "@/lib/utils";
import { ComposicaoCustos } from "./ComposicaoCustos";
import { chaveCliente, tierRecorrencia } from "@/lib/analytics/clientes";
import { calcMargemVenda } from "@/lib/analytics/margem";
import { ExportDropdown } from "./ui/ExportDropdown";
import type { VendaParsed } from "@/lib/parsers/nbs-vendas-xlsx";
import { useVendasAnalise } from "./vendas/useVendasAnalise";

export function VendasAnalise() {
  const router = useRouter();
  const vState = useVendasAnalise();

  const {
    isHydrated,
    vendas,
    vendasMeta,
    custosPorPlaca,
    search, setSearch,
    filtroLoja, setFiltroLoja,
    filtroVendedor, setFiltroVendedor,
    filtroMarca, setFiltroMarca,
    filtroUf, setFiltroUf,
    filtroTipoCli, setFiltroTipoCli,
    filtroRecorrencia, setFiltroRecorrencia,
    dataDe, setDataDe,
    dataAte, setDataAte,
    avancadoOpen, setAvancadoOpen,
    sorting, setSorting,
    hojeISO,
    clientesIndex,
    hasAnyTroca,
    lojas,
    vendedores,
    marcas,
    ufs,
    filtered,
    kpis,
    rankingLojas,
    rankingVendedores,
    rankingMarcas,
    limparFiltros,
    rodandoFipe,
    progressoFipe,
    fipeMsg,
    handleRunFipe,
    exportando,
    handleExportXlsx,
    handleExportPdf,
    filtrosAvancadosAtivos,
    filtrosAtivos,
  } = vState;

  const columns = useMemo<ColumnDef<VendaParsed>[]>(() => [
    { accessorKey: "data_venda", header: "Data", cell: (info) => {
      const d = info.getValue<Date | null>();
      return <span className="text-xs">{d ? new Date(d).toLocaleDateString("pt-BR") : "—"}</span>;
    } },
    { accessorKey: "empresa_nome", header: "Loja", cell: (info) => <span className="text-xs">{info.getValue<string | null>() ?? "—"}</span> },
    { accessorKey: "placa", header: "Placa", cell: (info) => <span className="font-mono text-xs">{info.getValue<string>()}</span> },
    { accessorKey: "marca", header: "Marca" },
    { accessorKey: "modelo", header: "Modelo", cell: (info) => <span className="text-xs">{info.getValue<string>()}</span> },
    { accessorKey: "km", header: "KM", cell: (info) => {
      const v = info.getValue<number | null>();
      return <span className="tabular-nums text-xs text-[var(--text-body)]">{v != null ? formatInt(v) : "—"}</span>;
    } },
    { accessorKey: "vendedor_nome", header: "Vendedor", cell: (info) => <span className="text-xs">{info.getValue<string | null>() ?? "—"}</span> },
    { accessorKey: "cliente_nome", header: "Cliente", cell: (info) => {
      const row = info.row.original;
      const cli = clientesIndex.get(chaveCliente(row));
      const n = cli?.totalCompras ?? 1;
      const tier = tierRecorrencia(n);
      return (
        <div className="text-xs">
          <p className="truncate" style={{ maxWidth: 200 }}>{info.getValue<string>()}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            {row.cliente_tipo && <span className={cn("inline-block rounded px-1 text-[10px] font-medium", row.cliente_tipo === "PF" ? "bg-blue-100 text-blue-800" : "bg-purple-100 text-purple-800")}>{row.cliente_tipo}</span>}
            {row.cliente_uf && row.cliente_uf !== "GO" && <span className="text-[10px] text-amber-600">↗ {row.cliente_uf}</span>}
            {n > 1 && (
              <span className={cn(
                "inline-flex items-center gap-0.5 rounded px-1 text-[10px] font-bold",
                tier === "lojista-suspeito" ? "bg-red-600 text-white" :
                tier === "recorrente" ? "bg-amber-200 text-amber-900" :
                "bg-blue-100 text-blue-800",
              )} title={`Este cliente fez ${n} compras no total`}>
                {tier !== "ocasional" && <AlertCircle className="h-2.5 w-2.5" />}
                {n}×
              </span>
            )}
          </div>
        </div>
      );
    } },
    { accessorKey: "valor_venda", header: "Valor", cell: (info) => <span className="tabular-nums font-medium">{formatBRL(info.getValue<number | null>())}</span> },
    { id: "margem_real", header: "Margem R$", cell: ({ row }) => {
      const m = calcMargemVenda(row.original, custosPorPlaca);
      const tone = m.margem > 5000 ? "text-emerald-700" : m.margem > 0 ? "" : "text-red-700";
      return (
        <span className={cn("tabular-nums", tone)} title={m.fonte === "oficial" ? "Margem oficial NBS" : "Estimativa (sem relatório de custos)"}>
          {formatBRL(m.margem)}
          {m.fonte === "fallback" && <span className="ml-0.5 text-[10px] text-amber-600">~</span>}
        </span>
      );
    } },
    { accessorKey: "dias_estoque", header: "Dias", cell: (info) => {
      const d = info.getValue<number | null>();
      if (d === null) return <span className="text-[var(--text-subtle)]">—</span>;
      const tone = d < 30 ? "text-green-700 dark:text-green-400" : d < 90 ? "" : d < 180 ? "text-amber-700 dark:text-amber-400" : "text-red-700 dark:text-red-400";
      return <span className={cn("tabular-nums", tone)}>{d}</span>;
    } },
    { accessorKey: "comissao_vendedor", header: "Comissão", cell: (info) => <span className="tabular-nums text-xs text-[var(--text-body)]">{formatBRL(info.getValue<number | null>())}</span> },
    ...(hasAnyTroca ? [{ id: "troca", header: "Troca", cell: ({ row }: { row: { original: VendaParsed } }) => row.original.placa_troca ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">{row.original.placa_troca}</span> : null } as ColumnDef<VendaParsed>] : []),
  ], [clientesIndex, custosPorPlaca, hasAnyTroca]);

  // TanStack Table v8 retorna funções não-puras que o React Compiler não consegue memorizar.
  // Limitação conhecida da lib — remover este disable quando migrarmos pra v9 (compatível).
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: filtered, columns, state: { sorting }, onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(), getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(), getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 25 } },
  });

  if (!isHydrated) return <p className="text-sm text-[var(--text-muted)]">Carregando…</p>;

  if (vendas.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--border-base)] bg-[var(--bg-surface)] p-12 text-center">
        <p className="text-[var(--text-muted)]">Nenhum relatório de vendas carregado.</p>
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
        <p className="text-xs text-[var(--text-muted)]">Período: <strong>{periodo}</strong> · {formatInt(vendasMeta!.total_vendas)} vendas · {formatInt(vendasMeta!.total_lojas)} lojas · {formatInt(vendasMeta!.total_vendedores)} vendedores</p>
      )}

      <div className={cn("grid gap-3", hasAnyTroca ? "md:grid-cols-5" : "md:grid-cols-4")}>
        <KpiCard title="Vendas" value={formatInt(kpis.qt)} subtitle={`${kpis.pf} PF · ${kpis.pj} PJ`} />
        <KpiCard title="Faturamento" value={formatBRL(kpis.valor)} subtitle={`Ticket ${formatBRL(kpis.ticketMedio)}`} />
        <KpiCard
          title={kpis.temCustosOficiais ? "Margem (oficial NBS)" : "Margem (estimada)"}
          value={formatBRL(kpis.margem)}
          subtitle={`${kpis.margemPct.toFixed(2)}% s/ faturamento${kpis.temCustosOficiais && kpis.cobertura < 1 ? ` · cobertura ${(kpis.cobertura * 100).toFixed(0)}%` : ""}`}
          tone={kpis.margem > 0 ? "good" : "bad"}
        />
        <KpiCard title="Tempo médio" value={`${kpis.diasMedio.toFixed(0)} dias`} subtitle="da entrada à venda" />
        {hasAnyTroca && (
          <KpiCard title="Trocas" value={formatInt(kpis.troca)} subtitle={`${((kpis.troca / Math.max(1, kpis.qt)) * 100).toFixed(0)}% das vendas`} />
        )}
      </div>

      <ComposicaoCustos vendas={filtered} />

      <div className="space-y-3 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Select label="Loja" value={filtroLoja} onChange={setFiltroLoja} options={[["all", "Todas"], ...lojas.map((l) => [l, l] as [string, string])]} />
          <Select label="Vendedor" value={filtroVendedor} onChange={setFiltroVendedor} options={[["all", "Todos"], ...vendedores.map((v) => [v, v] as [string, string])]} />

          <label className="flex items-center gap-1.5 text-sm">
            <span className="text-[var(--text-muted)]">De:</span>
            <input
              type="date"
              value={dataDe}
              max={dataAte || hojeISO}
              onChange={(e) => setDataDe(e.target.value)}
              aria-label="Data inicial"
              className="rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--brand-600)]"
            />
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <span className="text-[var(--text-muted)]">Até:</span>
            <input
              type="date"
              value={dataAte}
              min={dataDe || undefined}
              max={hojeISO}
              onChange={(e) => setDataAte(e.target.value)}
              aria-label="Data final"
              className="rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--brand-600)]"
            />
          </label>

          <button
            type="button"
            onClick={() => setAvancadoOpen((v) => !v)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition",
              filtrosAvancadosAtivos > 0
                ? "border-blue-300 bg-blue-50 text-blue-800 hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200"
                : "border-[var(--border-base)] bg-[var(--bg-surface)] text-[var(--text-body)] hover:bg-[var(--bg-muted)]",
            )}
            aria-expanded={avancadoOpen}
            aria-controls="filtros-avancados-vendas"
          >
            <SlidersHorizontal className="h-3 w-3" />
            {avancadoOpen ? "▴ Ocultar" : "▾ Mais"} filtros
            {filtrosAvancadosAtivos > 0 && (
              <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                +{filtrosAvancadosAtivos}
              </span>
            )}
          </button>

          <div className="relative ml-auto">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-[var(--text-subtle)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Placa, chassi, modelo, cliente…"
              className="w-64 rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--brand-600)]"
            />
          </div>
        </div>

        <div
          id="filtros-avancados-vendas"
          inert={!avancadoOpen ? true : undefined}
          aria-hidden={!avancadoOpen}
          className={cn(
            "grid overflow-hidden transition-all duration-200 ease-out",
            avancadoOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
          )}
        >
          <div className="min-h-0">
            <div className="flex flex-wrap items-center gap-3 rounded-md bg-[var(--bg-muted)] p-3">
              <Select label="Marca" value={filtroMarca} onChange={setFiltroMarca} options={[["all", "Todas"], ...marcas.map((m) => [m, m] as [string, string])]} />
              <Select label="UF" value={filtroUf} onChange={setFiltroUf} options={[["all", "Todos"], ...ufs.map((u) => [u, u] as [string, string])]} />
              <Select
                label="Tipo"
                value={filtroTipoCli}
                onChange={(v) => setFiltroTipoCli(v as typeof filtroTipoCli)}
                options={hasAnyTroca
                  ? [["all", "Todos"], ["PF", "Só PF"], ["PJ", "Só PJ"], ["troca", "Com troca"]]
                  : [["all", "Todos"], ["PF", "Só PF"], ["PJ", "Só PJ"]]}
              />
              <Select label="Recorrência" value={filtroRecorrencia} onChange={(v) => setFiltroRecorrencia(v as typeof filtroRecorrencia)} options={[["all", "Todas"], ["unica", "1 compra"], ["2-3", "2 a 3"], ["4mais", "4+ (suspeito)"]]} />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border-soft)] pt-3">
          <button
            type="button"
            onClick={handleRunFipe}
            disabled={filtered.length === 0 || rodandoFipe || exportando}
            title="Busca preço FIPE pros carros filtrados que ainda não estão no cache"
            className="inline-flex items-center gap-1.5 rounded-md border border-amber-500 bg-amber-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:border-[var(--border-base)] disabled:bg-[var(--bg-muted)] disabled:text-[var(--text-subtle)]"
          >
            {rodandoFipe ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {rodandoFipe ? "Buscando FIPE…" : "Buscar FIPE agora"}
          </button>

          <ExportDropdown
            disabled={filtered.length === 0 || exportando || rodandoFipe}
            trigger={
              <>
                {exportando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {exportando ? "Exportando…" : "Exportar análise Navesa"}
              </>
            }
            items={[
              { label: "XLSX (completo, 38 colunas)", description: "Planilha com fórmulas, KPIs e FIPE", onSelect: handleExportXlsx },
              { label: "PDF (resumido)", description: "Capa e KPIs (paisagem A4)", onSelect: handleExportPdf },
            ]}
          />
        </div>
      </div>

      {rodandoFipe && progressoFipe && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
          <div className="flex items-center gap-2 text-xs font-medium text-amber-900 dark:text-amber-200">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {progressoFipe.mensagem}
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-amber-200 dark:bg-amber-900">
            <div className="h-full bg-amber-500 transition-all" style={{ width: `${progressoFipe.total > 0 ? (progressoFipe.atual / progressoFipe.total) * 100 : 0}%` }} />
          </div>
          <p className="mt-1 text-[11px] tabular-nums text-amber-700 dark:text-amber-300">
            {progressoFipe.atual}/{progressoFipe.total} · {progressoFipe.matchesAteAgora} matches
            {progressoFipe.errosAteAgora > 0 && ` · ${progressoFipe.errosAteAgora} sem match`}
          </p>
        </div>
      )}
      {!rodandoFipe && fipeMsg && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
          {fipeMsg}
        </div>
      )}

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

        <RankCard title="Marcas que mais giram (≥10 vendas)" icon={<TrendingUp className="h-4 w-4" />} items={rankingMarcas.slice(0, 6).map((m) => ({
          label: m.nome,
          primary: `${m.diasMedio.toFixed(0)} dias`,
          secondary: `${m.qt} vendas · ${formatBRL(m.valor)}`,
          tone: m.diasMedio < 45 ? "good" : m.diasMedio > 90 ? "bad" : undefined,
        }))} />
      </div>

      {rankingMarcas.length > 6 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-900 dark:bg-amber-950/20">
          <h4 className="flex items-center gap-1.5 text-sm font-semibold text-amber-900 dark:text-amber-200">
            <TrendingDown className="h-3.5 w-3.5" /> Marcas com maior tempo de giro
          </h4>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {[...rankingMarcas].sort((a, b) => b.diasMedio - a.diasMedio).slice(0, 6).map((m) => (
              <div key={m.nome} className="flex items-center justify-between rounded-md bg-[var(--bg-surface)] px-3 py-1.5 text-xs">
                <span>{m.nome}</span>
                <span className="tabular-nums font-semibold text-amber-700 dark:text-amber-400">{m.diasMedio.toFixed(0)} dias</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-sm text-[var(--text-body)]">
        {filtrosAtivos > 0
          ? filtered.length === 0
            ? <>Sem resultados para estes filtros</>
            : <>Mostrando <strong>{formatInt(filtered.length)}</strong> de <strong>{formatInt(vendas.length)}</strong> vendas</>
          : <><strong>{formatInt(vendas.length)}</strong> vendas no total</>}
        {filtered.length > 0 && (
          <>
            {" · "}valor: <strong>{formatBRL(kpis.valor)}</strong>
            {" · "}margem: <strong className={kpis.margem < 0 ? "text-red-700" : "text-green-700"}>{formatBRL(kpis.margem)}</strong>
          </>
        )}
        {filtrosAtivos > 0 && (
          <button type="button" onClick={limparFiltros} className="ml-2 text-blue-700 underline dark:text-blue-400">Limpar filtros</button>
        )}
      </p>

      <div className="overflow-hidden rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)]">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--border-soft)] bg-[var(--bg-muted)]">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => (
                    <th key={h.id} className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-[var(--text-body)]">
                      {h.column.getCanSort() ? (
                        <button onClick={h.column.getToggleSortingHandler()} className="inline-flex items-center gap-1 hover:text-[var(--text-strong)]">
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
                <tr key={row.id} onClick={() => router.push(`/vendas/${row.original.chassi}`)} className="cursor-pointer border-b border-[var(--border-soft)] last:border-0 hover:bg-[var(--bg-muted)]" title="Ver detalhe">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-3 py-2 align-middle">{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                  ))}
                </tr>
              ))}
              {table.getRowModel().rows.length === 0 && (
                <tr><td colSpan={columns.length} className="py-12 text-center text-[var(--text-muted)]">Nenhuma venda com estes filtros.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[var(--border-soft)] bg-[var(--bg-muted)] px-3 py-2 text-xs">
          <span>Página {table.getState().pagination.pageIndex + 1} de {table.getPageCount() || 1}</span>
          <div className="flex gap-1">
            <button onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} className="rounded border px-2 py-1 disabled:opacity-40">‹</button>
            <button onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} className="rounded border px-2 py-1 disabled:opacity-40">›</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ title, value, subtitle, tone }: { title: string; value: string; subtitle: string; tone?: "good" | "bad" }) {
  const tones = {
    good:    { bg: "from-emerald-50 to-[var(--bg-surface)] dark:from-emerald-950/40", bar: "bg-emerald-500", label: "text-emerald-700 dark:text-emerald-400" },
    bad:     { bg: "from-red-50 to-[var(--bg-surface)] dark:from-red-950/40",         bar: "bg-red-500",     label: "text-red-700 dark:text-red-400" },
    neutral: { bg: "from-[var(--brand-50)] to-[var(--bg-surface)] dark:from-[var(--brand-900)]/40", bar: "bg-[var(--brand-600)]", label: "text-[var(--brand-700)] dark:text-[var(--brand-300)]" },
  };
  const t = tones[tone ?? "neutral"];
  return (
    <div className={cn("relative overflow-hidden rounded-xl border border-[var(--border-soft)] bg-gradient-to-br p-4 shadow-[var(--shadow-sm)]", t.bg)}>
      <div className={cn("absolute left-0 top-0 h-full w-1", t.bar)} />
      <p className={cn("text-[10px] font-semibold uppercase tracking-wider", t.label)}>{title}</p>
      <p className="mt-1 text-xl font-bold tabular-nums tracking-tight text-[var(--text-strong)]">{value}</p>
      <p className="text-[11px] text-[var(--text-muted)]">{subtitle}</p>
    </div>
  );
}

function RankCard({ title, icon, items }: { title: string; icon: React.ReactNode; items: { label: string; primary: string; secondary: string; tone?: "good" | "bad" }[] }) {
  return (
    <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)]">
      <header className="flex items-center gap-2 border-b border-[var(--border-soft)] px-4 py-2 text-sm font-semibold">{icon} {title}</header>
      <ol className="divide-y divide-[var(--border-soft)]">
        {items.map((item, i) => (
          <li key={i} className="flex items-center justify-between px-4 py-2">
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="text-xs text-[var(--text-subtle)] tabular-nums">{i + 1}.</span>
              <span className="truncate text-sm">{item.label}</span>
            </div>
            <div className="text-right">
              <p className={cn("text-sm font-semibold tabular-nums", item.tone === "good" && "text-green-700 dark:text-green-400", item.tone === "bad" && "text-red-700 dark:text-red-400")}>{item.primary}</p>
              <p className="text-[10px] text-[var(--text-muted)]">{item.secondary}</p>
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
      <span className="text-[var(--text-muted)]">{label}:</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="max-w-56 rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--brand-600)]">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}
