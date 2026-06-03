"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  useReactTable, getCoreRowModel, getFilteredRowModel, getSortedRowModel, getPaginationRowModel,
  flexRender, type ColumnDef, type SortingState,
} from "@tanstack/react-table";
import { ArrowUpDown, ArrowUp, ArrowDown, Search, Trophy, TrendingDown, TrendingUp, AlertCircle, Download, RefreshCw, Loader2, SlidersHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useInventory } from "@/lib/store/inventory";
import { formatBRL, formatInt, cn } from "@/lib/utils";
import { usePersistedState } from "@/lib/hooks/usePersistedState";
import { ComposicaoCustos } from "./ComposicaoCustos";
import { indexarClientes, chaveCliente, tierRecorrencia } from "@/lib/analytics/clientes";
import { agregarMargem, calcMargemVenda } from "@/lib/analytics/margem";
import { baixarAnaliseNavesa } from "@/lib/export/analise-navesa";
import { runFipeBatch, type BatchProgress } from "@/lib/fipe/batch";
import { useFipeBatch } from "@/lib/fipe/useFipeBatch";
import type { VendaParsed } from "@/lib/parsers/nbs-vendas-xlsx";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";

function inferirCombustivel(modelo: string | null): string | null {
  if (!modelo) return null;
  const m = modelo.toUpperCase();
  if (/\bDIESEL\b/.test(m)) return "Diesel";
  if (/\bFLEX\b/.test(m)) return "Flex";
  if (/\bGASOLINA\b/.test(m)) return "Gasolina";
  if (/\b(HÍBRIDO|HIBRIDO|HYBRID)\b/.test(m)) return "Híbrido";
  if (/\b(EL[ÉE]TRICO|ELECTRIC|EV)\b/.test(m)) return "Elétrico";
  if (/\bETANOL\b/.test(m)) return "Álcool";
  return null;
}

export function VendasAnalise() {
  const router = useRouter();
  const { vendas, vendasMeta, custosPorPlaca, isHydrated } = useInventory();
  const fipeBatch = useFipeBatch();

  const [search, setSearch] = usePersistedState<string>("vendas:search", "");
  const [exportando, setExportando] = useState(false);
  const [rodandoFipe, setRodandoFipe] = useState(false);
  const [progressoFipe, setProgressoFipe] = useState<BatchProgress | null>(null);
  const [fipeMsg, setFipeMsg] = useState<string | null>(null);
  const fipeMsgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-dismiss do toast FIPE após 8s; reseta o timer se a msg mudar
  useEffect(() => {
    if (fipeMsgTimerRef.current) {
      clearTimeout(fipeMsgTimerRef.current);
      fipeMsgTimerRef.current = null;
    }
    if (fipeMsg) {
      fipeMsgTimerRef.current = setTimeout(() => setFipeMsg(null), 8000);
    }
    return () => {
      if (fipeMsgTimerRef.current) {
        clearTimeout(fipeMsgTimerRef.current);
        fipeMsgTimerRef.current = null;
      }
    };
  }, [fipeMsg]);
  const [filtroLoja, setFiltroLoja] = usePersistedState<string>("vendas:filtroLoja", "all");
  const [filtroVendedor, setFiltroVendedor] = usePersistedState<string>("vendas:filtroVendedor", "all");
  const [filtroMarca, setFiltroMarca] = usePersistedState<string>("vendas:filtroMarca", "all");
  const [filtroUf, setFiltroUf] = usePersistedState<string>("vendas:filtroUf", "all");
  const [filtroTipoCli, setFiltroTipoCli] = usePersistedState<"all" | "PF" | "PJ" | "troca">("vendas:filtroTipoCli", "all");
  const [filtroRecorrencia, setFiltroRecorrencia] = usePersistedState<"all" | "unica" | "2-3" | "4mais">("vendas:filtroRecorrencia", "all");
  const [dataDe, setDataDe] = usePersistedState<string>("vendas:dataDe", "");
  const [dataAte, setDataAte] = usePersistedState<string>("vendas:dataAte", "");
  const [avancadoOpen, setAvancadoOpen] = useState(false);
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
    // Coluna Troca só aparece se o dataset tem trocas
    ...(hasAnyTroca ? [{ id: "troca", header: "Troca", cell: ({ row }: { row: { original: VendaParsed } }) => row.original.placa_troca ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">{row.original.placa_troca}</span> : null } as ColumnDef<VendaParsed>] : []),
  ], [clientesIndex, custosPorPlaca, hasAnyTroca]);

  const table = useReactTable({
    data: filtered, columns, state: { sorting }, onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(), getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(), getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 25 } },
  });

  // Contagem de filtros ativos: essenciais (sempre visíveis) vs avançados (colapsáveis)
  const filtrosEssenciaisAtivos = [
    !!search,
    filtroLoja !== "all",
    filtroVendedor !== "all",
    !!dataDe,
    !!dataAte,
  ].filter(Boolean).length;

  const filtrosAvancadosAtivos = [
    filtroMarca !== "all",
    filtroUf !== "all",
    filtroTipoCli !== "all",
    filtroRecorrencia !== "all",
  ].filter(Boolean).length;

  const filtrosAtivos = filtrosEssenciaisAtivos + filtrosAvancadosAtivos;

  // Auto-abre o painel "Mais filtros" no mount inicial se há avançados ativos (sessionStorage).
  // Sem isso, usuário vê badge "+N" mas precisa clicar pra ver quais filtros estão ativos.
  useEffect(() => {
    if (filtrosAvancadosAtivos > 0) setAvancadoOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const limparFiltros = () => {
    setSearch("");
    setFiltroLoja("all");
    setFiltroVendedor("all");
    setFiltroMarca("all");
    setFiltroUf("all");
    setFiltroTipoCli("all");
    setFiltroRecorrencia("all");
    setDataDe("");
    setDataAte("");
  };

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
      <div className="space-y-3 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] p-4">
        {/* Essenciais: sempre visíveis */}
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
              className="rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-2 py-1 text-sm"
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
              className="rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-2 py-1 text-sm"
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
              className="w-64 rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] pl-8 pr-3 py-1.5 text-sm"
            />
          </div>
        </div>

        {/* Avançados: colapsáveis */}
        <div
          id="filtros-avancados-vendas"
          inert={!avancadoOpen}
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

        {/* Ações de exportação */}
        <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border-soft)] pt-3">
          <button
            type="button"
            onClick={async () => {
              if (rodandoFipe) return;
              setRodandoFipe(true);
              setFipeMsg(null);
              setProgressoFipe(null);
              try {
                const veiculos: VeiculoParsed[] = filtered.map((v) => ({
                  cod_empresa: v.cod_empresa,
                  chassi: v.chassi,
                  placa: v.placa,
                  marca: v.marca,
                  modelo: v.modelo,
                  ano_fabricacao: v.ano_fabricacao,
                  ano_modelo: v.ano_modelo,
                  cor_externa: v.cor_externa,
                  combustivel: inferirCombustivel(v.modelo),
                  km: v.km,
                  patio: v.patio ?? "",
                  descricao_situacao: null,
                  preco_venda: v.valor_venda,
                  valor_aquisicao: null,
                  custo_total: null,
                  dias_patio: v.dias_estoque,
                  data_entrada: null,
                  vendedor_recebeu: v.vendedor_recebeu,
                }));
                const r = await runFipeBatch(veiculos, (p) => setProgressoFipe(p));
                const matches = Object.keys(r.items).length;
                setFipeMsg(`FIPE atualizado para ${matches} carro${matches === 1 ? "" : "s"}${r.erros.length > 0 ? ` · ${r.erros.length} sem match` : ""}.`);
              } catch (err) {
                setFipeMsg(`Erro ao buscar FIPE: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setRodandoFipe(false);
              }
            }}
            disabled={filtered.length === 0 || rodandoFipe || exportando}
            title="Busca preço FIPE pros carros filtrados que ainda não estão no cache"
            className="inline-flex items-center gap-1.5 rounded-md border border-amber-500 bg-amber-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:border-[var(--border-base)] disabled:bg-[var(--bg-muted)] disabled:text-[var(--text-subtle)]"
          >
            {rodandoFipe ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {rodandoFipe ? "Buscando FIPE…" : "Buscar FIPE agora"}
          </button>

          <button
            type="button"
            onClick={async () => {
              if (exportando) return;
              setExportando(true);
              try {
                const mapaFipe = new Map<string, number>();
                if (fipeBatch?.items) {
                  const itemsByChassi = fipeBatch.items;
                  for (const v of filtered) {
                    const item = itemsByChassi[v.chassi];
                    if (item && item.precoFipe > 0) {
                      mapaFipe.set(v.chassi, item.precoFipe);
                    }
                  }
                }
                await baixarAnaliseNavesa({
                  vendas: filtered,
                  todasVendas: vendas,
                  custosPorPlaca,
                  fipePorChassi: mapaFipe,
                  empresa: filtroLoja === "all" ? "TODAS" : filtroLoja,
                  dataDe,
                  dataAte,
                });
              } finally {
                setExportando(false);
              }
            }}
            disabled={filtered.length === 0 || exportando || rodandoFipe}
            title="Gera planilha no formato USADOS ANALISE NAVESA respeitando os filtros aplicados (FIPE preenchida automaticamente onde houver cache)"
            className="inline-flex items-center gap-1.5 rounded-md border border-purple-600 bg-purple-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-700 disabled:cursor-not-allowed disabled:border-[var(--border-base)] disabled:bg-[var(--bg-muted)] disabled:text-[var(--text-subtle)]"
          >
            {exportando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {exportando ? "Exportando…" : "Exportar análise Navesa"}
          </button>
        </div>
      </div>

      {/* Progresso/feedback do batch FIPE */}
      {rodandoFipe && progressoFipe && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
          <div className="flex items-center gap-2 text-xs font-medium text-amber-900 dark:text-amber-200">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {progressoFipe.mensagem}
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-amber-200 dark:bg-amber-900">
            <div
              className="h-full bg-amber-500 transition-all"
              style={{ width: `${progressoFipe.total > 0 ? (progressoFipe.atual / progressoFipe.total) * 100 : 0}%` }}
            />
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
              <div key={m.nome} className="flex items-center justify-between rounded-md bg-[var(--bg-surface)] px-3 py-1.5 text-xs">
                <span>{m.nome}</span>
                <span className="tabular-nums font-semibold text-amber-700 dark:text-amber-400">{m.diasMedio.toFixed(0)} dias</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Indicador X de Y · Limpar filtros */}
      <p className="text-sm text-[var(--text-body)]">
        {filtrosAtivos > 0
          ? filtered.length === 0
            ? <>Sem resultados pra esses filtros</>
            : <>Mostrando <strong>{formatInt(filtered.length)}</strong> de <strong>{formatInt(vendas.length)}</strong> venda{vendas.length === 1 ? "" : "s"}</>
          : <><strong>{formatInt(vendas.length)}</strong> venda{vendas.length === 1 ? "" : "s"}</>}
        {filtered.length > 0 && (
          <>
            {" · "}valor: <strong>{formatBRL(kpis.valor)}</strong>
            {" · "}margem: <strong className={kpis.margem < 0 ? "text-red-700" : "text-green-700"}>{formatBRL(kpis.margem)}</strong>
          </>
        )}
        {filtrosAtivos > 0 && (
          <>
            {" · "}
            <button
              type="button"
              onClick={limparFiltros}
              className="text-blue-700 underline-offset-2 hover:underline dark:text-blue-400"
            >
              Limpar filtros
            </button>
          </>
        )}
      </p>

      {/* Tabela */}
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
                <tr
                  key={row.id}
                  onClick={() => router.push(`/vendas/${row.original.chassi}`)}
                  className="cursor-pointer border-b border-[var(--border-soft)] last:border-0 hover:bg-[var(--bg-muted)]"
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
                <tr><td colSpan={columns.length} className="py-12 text-center text-[var(--text-muted)]">Nenhuma venda com esses filtros.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[var(--border-soft)] bg-[var(--bg-muted)] px-3 py-2 text-xs">
          <span>Página {table.getState().pagination.pageIndex + 1} de {table.getPageCount() || 1}</span>
          <div className="flex gap-1">
            <button onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} className="rounded-md border border-[var(--border-base)] px-2 py-1 disabled:opacity-40">‹</button>
            <button onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} className="rounded-md border border-[var(--border-base)] px-2 py-1 disabled:opacity-40">›</button>
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
      <select value={value} onChange={(e) => onChange(e.target.value)} className="max-w-56 rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-2 py-1 text-sm">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}
