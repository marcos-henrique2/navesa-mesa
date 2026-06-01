"use client";

import { useMemo, useState } from "react";
import {
  useReactTable, getCoreRowModel, getFilteredRowModel, getSortedRowModel, getPaginationRowModel,
  flexRender, type ColumnDef, type SortingState,
} from "@tanstack/react-table";
import { ArrowUpDown, ArrowUp, ArrowDown, Search, Trophy, TrendingDown, TrendingUp, AlertCircle, Download } from "lucide-react";
import { useRouter } from "next/navigation";
import { useInventory } from "@/lib/store/inventory";
import { formatBRL, formatInt, cn } from "@/lib/utils";
import { ComposicaoCustos } from "./ComposicaoCustos";
import { indexarClientes, chaveCliente, tierRecorrencia } from "@/lib/analytics/clientes";
import { agregarMargem, calcMargemVenda } from "@/lib/analytics/margem";
import { baixarAnaliseNavesa } from "@/lib/export/analise-navesa";
import type { VendaParsed } from "@/lib/parsers/nbs-vendas-xlsx";

export function VendasAnalise() {
  const router = useRouter();
  const { vendas, vendasMeta, custosPorPlaca, isHydrated } = useInventory();

  const [search, setSearch] = useState("");
  const [filtroLoja, setFiltroLoja] = useState("all");
  const [filtroVendedor, setFiltroVendedor] = useState("all");
  const [filtroMarca, setFiltroMarca] = useState("all");
  const [filtroUf, setFiltroUf] = useState("all");
  const [filtroTipoCli, setFiltroTipoCli] = useState<"all" | "PF" | "PJ" | "troca">("all");
  const [filtroRecorrencia, setFiltroRecorrencia] = useState<"all" | "unica" | "2-3" | "4mais">("all");
  const [dataDe, setDataDe] = useState("");
  const [dataAte, setDataAte] = useState("");
  const [sorting, setSorting] = useState<SortingState>([{ id: "data_venda", desc: true }]);

  const hojeISO = useMemo(() => {
    const h = new Date();
    return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}-${String(h.getDate()).padStart(2, "0")}`;
  }, []);

  // Index de clientes sobre TODAS as vendas (independente do filtro), para detectar recorrência total
  const clientesIndex = useMemo(() => indexarClientes(vendas), [vendas]);
  // Flag global: existe alguma troca no dataset? Se não, escondemos UI de trocas.
  const hasAnyTroca = useMemo(() => vendas.some(v => !!v.placa_troca), [vendas]);

  const lojas = useMemo(() => [...new Set(vendas.map((v) => v.empresa_nome).filter((x): x is string => !!x))].sort(), [vendas]);
  const vendedores = useMemo(() => [...new Set(vendas.map((v) => v.vendedor_nome).filter((x): x is string => !!x))].sort(), [vendas]);
  const marcas = useMemo(() => [...new Set(vendas.map((v) => v.marca).filter((m): m is string => !!m))].sort(), [vendas]);
  const ufs = useMemo(() => [...new Set(vendas.map((v) => v.cliente_uf).filter((u): u is string => !!u))].sort(), [vendas]);

  const dataDeMs = useMemo(() => {
    if (!dataDe) return null;
    const [y, m, d] = dataDe.split("-").map(Number);
    return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
  }, [dataDe]);

  const dataAteMs = useMemo(() => {
    if (!dataAte) return new Date().setHours(23, 59, 59, 999);
    const [y, m, d] = dataAte.split("-").map(Number);
    return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
  }, [dataAte]);

  const filtered = useMemo(() => {
    return vendas.filter((v) => {
      if (filtroLoja !== "all" && v.empresa_nome !== filtroLoja) return false;
      if (filtroVendedor !== "all" && v.vendedor_nome !== filtroVendedor) return false;
      if (filtroMarca !== "all" && v.marca !== filtroMarca) return false;
      if (filtroUf !== "all" && v.cliente_uf !== filtroUf) return false;
      if (filtroTipoCli === "PF" && v.cliente_tipo !== "PF") return false;
      if (filtroTipoCli === "PJ" && v.cliente_tipo !== "PJ") return false;
      if (filtroTipoCli === "troca" && !v.placa_troca) return false;
      if (filtroRecorrencia !== "all") {
        const cli = clientesIndex.get(chaveCliente(v));
        const n = cli?.totalCompras ?? 1;
        if (filtroRecorrencia === "unica" && n !== 1) return false;
        if (filtroRecorrencia === "2-3" && (n < 2 || n > 3)) return false;
        if (filtroRecorrencia === "4mais" && n < 4) return false;
      }
      if (dataDeMs !== null || dataAte) {
        if (!v.data_venda) return false;
        const ts = v.data_venda.getTime();
        if (dataDeMs !== null && ts < dataDeMs) return false;
        if (ts > dataAteMs) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        const hay = `${v.placa} ${v.chassi} ${v.modelo} ${v.cliente_nome} ${v.vendedor_nome ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [vendas, filtroLoja, filtroVendedor, filtroMarca, filtroUf, filtroTipoCli, filtroRecorrencia, clientesIndex, search, dataDeMs, dataAteMs, dataAte]);

  const kpis = useMemo(() => {
    // Usa fórmula oficial NBS (lib/analytics/margem.ts)
    const agg = agregarMargem(filtered, custosPorPlaca);

    let comissao = 0, dias = 0, comDias = 0;
    let pf = 0, pj = 0, troca = 0;
    for (const v of filtered) {
      comissao += v.comissao_vendedor ?? 0;
      if (v.dias_estoque !== null) { dias += v.dias_estoque; comDias++; }
      if (v.cliente_tipo === "PF") pf++;
      else if (v.cliente_tipo === "PJ") pj++;
      if (v.placa_troca) troca++;
    }

    return {
      qt: filtered.length,
      valor: agg.valor,
      custo: agg.custo,
      margem: agg.margem,
      margemPct: agg.margemPct,           // sobre faturamento (oficial NBS)
      cobertura: agg.cobertura,            // % de vendas com custos oficiais
      temCustosOficiais: agg.qtComCustoOficial > 0,
      comissao,
      ticketMedio: filtered.length > 0 ? agg.valor / filtered.length : 0,
      diasMedio: comDias > 0 ? dias / comDias : 0,
      pf, pj, troca,
    };
  }, [filtered, custosPorPlaca]);

  // Rankings — todos usam a margem oficial via calcMargemVenda
  const rankingLojas = useMemo(() => {
    const map = new Map<string, { qt: number; valor: number; margem: number; dias: number; comDias: number }>();
    for (const v of filtered) {
      const m = calcMargemVenda(v, custosPorPlaca);
      const k = v.empresa_nome || `Loja ${v.cod_empresa}`;
      const agg = map.get(k) ?? { qt: 0, valor: 0, margem: 0, dias: 0, comDias: 0 };
      agg.qt++;
      agg.valor += m.valor;
      agg.margem += m.margem;
      if (v.dias_estoque !== null) { agg.dias += v.dias_estoque; agg.comDias++; }
      map.set(k, agg);
    }
    return [...map.entries()].map(([nome, agg]) => ({
      nome, ...agg,
      diasMedio: agg.comDias > 0 ? agg.dias / agg.comDias : 0,
      margemPct: agg.valor > 0 ? (agg.margem / agg.valor) * 100 : 0,   // % sobre faturamento
    })).sort((a, b) => b.valor - a.valor);
  }, [filtered, custosPorPlaca]);

  const rankingVendedores = useMemo(() => {
    const map = new Map<string, { qt: number; valor: number; margem: number; comissao: number }>();
    for (const v of filtered) {
      const m = calcMargemVenda(v, custosPorPlaca);
      const k = v.vendedor_nome || v.vendedor_codigo || "(sem vendedor)";
      const agg = map.get(k) ?? { qt: 0, valor: 0, margem: 0, comissao: 0 };
      agg.qt++;
      agg.valor += m.valor;
      agg.margem += m.margem;
      agg.comissao += v.comissao_vendedor ?? 0;
      map.set(k, agg);
    }
    return [...map.entries()].map(([nome, agg]) => ({ nome, ...agg })).sort((a, b) => b.qt - a.qt);
  }, [filtered, custosPorPlaca]);

  const rankingMarcas = useMemo(() => {
    const MIN_VENDAS = 10; // amostra mínima pra ter relevância estatística
    const map = new Map<string, { qt: number; valor: number; dias: number; comDias: number }>();
    for (const v of filtered) {
      const k = v.marca ?? "(sem marca)";
      const agg = map.get(k) ?? { qt: 0, valor: 0, dias: 0, comDias: 0 };
      agg.qt++;
      agg.valor += v.valor_venda ?? 0;
      if (v.dias_estoque !== null) { agg.dias += v.dias_estoque; agg.comDias++; }
      map.set(k, agg);
    }
    return [...map.entries()]
      .map(([nome, agg]) => ({
        nome, ...agg, diasMedio: agg.comDias > 0 ? agg.dias / agg.comDias : 0,
      }))
      .filter((m) => m.qt >= MIN_VENDAS) // descarta marcas com 1-9 vendas (estatística irrelevante)
      .sort((a, b) => a.diasMedio - b.diasMedio); // mais rápido primeiro
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
    { accessorKey: "km", header: "KM", cell: (info) => {
      const v = info.getValue<number | null>();
      return <span className="tabular-nums text-xs text-zinc-600">{v != null ? formatInt(v) : "—"}</span>;
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
      if (d === null) return <span className="text-zinc-400">—</span>;
      const tone = d < 30 ? "text-green-700 dark:text-green-400" : d < 90 ? "" : d < 180 ? "text-amber-700 dark:text-amber-400" : "text-red-700 dark:text-red-400";
      return <span className={cn("tabular-nums", tone)}>{d}</span>;
    } },
    { accessorKey: "comissao_vendedor", header: "Comissão", cell: (info) => <span className="tabular-nums text-xs text-zinc-600">{formatBRL(info.getValue<number | null>())}</span> },
    // Coluna Troca só aparece se o dataset tem trocas
    ...(hasAnyTroca ? [{ id: "troca", header: "Troca", cell: ({ row }: { row: { original: VendaParsed } }) => row.original.placa_troca ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">{row.original.placa_troca}</span> : null } as ColumnDef<VendaParsed>] : []),
  ], [clientesIndex, custosPorPlaca, hasAnyTroca]);

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

      {/* KPIs — esconde 'Trocas' quando o relatório não trouxe essa info no dataset */}
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

      {/* Composição de custos */}
      <ComposicaoCustos vendas={filtered} />

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <Select label="Loja" value={filtroLoja} onChange={setFiltroLoja} options={[["all", "Todas"], ...lojas.map((l) => [l, l] as [string, string])]} />
        <Select label="Vendedor" value={filtroVendedor} onChange={setFiltroVendedor} options={[["all", "Todos"], ...vendedores.map((v) => [v, v] as [string, string])]} />
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

        <label className="flex items-center gap-1.5 text-sm">
          <span className="text-zinc-500">De:</span>
          <input
            type="date"
            value={dataDe}
            max={dataAte || hojeISO}
            onChange={(e) => setDataDe(e.target.value)}
            aria-label="Data inicial"
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <span className="text-zinc-500">Até:</span>
          <input
            type="date"
            value={dataAte}
            min={dataDe || undefined}
            max={hojeISO}
            onChange={(e) => setDataAte(e.target.value)}
            aria-label="Data final"
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        {(dataDe || dataAte) && (
          <button
            type="button"
            onClick={() => { setDataDe(""); setDataAte(""); }}
            className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            × limpar
          </button>
        )}

        <div className="relative ml-auto">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-zinc-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Placa, chassi, modelo, cliente…"
            className="w-64 rounded-md border border-zinc-300 bg-white pl-8 pr-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>

        <button
          type="button"
          onClick={async () => {
            await baixarAnaliseNavesa({
              vendas: filtered,
              todasVendas: vendas,
              custosPorPlaca,
              empresa: filtroLoja === "all" ? "TODAS" : filtroLoja,
              dataDe,
              dataAte,
            });
          }}
          disabled={filtered.length === 0}
          title="Gera planilha no formato USADOS ANALISE NAVESA respeitando os filtros aplicados"
          className="inline-flex items-center gap-1.5 rounded-md border border-purple-600 bg-purple-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-700 disabled:cursor-not-allowed disabled:border-zinc-300 disabled:bg-zinc-300 disabled:text-zinc-500 dark:disabled:border-zinc-700 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-500"
        >
          <Download className="h-4 w-4" />
          Exportar análise Navesa
        </button>
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

        <RankCard title="Marcas que mais giram (≥10 vendas)" icon={<TrendingUp className="h-4 w-4" />} items={rankingMarcas.slice(0, 6).map((m) => ({
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
