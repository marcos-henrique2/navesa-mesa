"use client";

import { useEffect, useMemo, useState } from "react";
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
import { classificarPatio } from "@/lib/inventory/status";
import { classificarVeiculo, contarPorModelo, CLASSE_COR, type Classe } from "@/lib/pricing/classificacao";
import { useFipeBatch } from "@/lib/fipe/useFipeBatch";
import { calcularDesvioFipe } from "@/lib/fipe/batch";
import { useCautelares, CAUTELAR_ICONE, CAUTELAR_LABEL, type StatusCautelar } from "@/lib/inventory/cautelar";
import { computarDiagnosticoLista, type DiagnosticoStatus } from "@/lib/pricing/diagnostico";
import { calcularMedianasKm } from "@/lib/pricing/medianas";
import { cn, formatBRL, formatInt } from "@/lib/utils";
import { ResumoPorDimensao } from "./ResumoPorDimensao";
import { FipeBatchRunner } from "./FipeBatchRunner";
import { CautelarBatchActions } from "./CautelarBatchActions";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";

type StatusFiltro = "all" | "real" | "prep";

/**
 * Filtro vindo do banner de prioridade (Fase C).
 * Quando setado, restringe a tabela aos veículos das lojas indicadas
 * com status de diagnóstico que precisa de atenção. O `nonce` força
 * re-aplicação mesmo se o user já tinha desligado o filtro.
 */
export type FiltrosPrioridade = {
  codsLoja: number[];
  statusAtencao: true;
  nonce: number;
};

const STATUS_ATENCAO_DIAG: ReadonlySet<DiagnosticoStatus> = new Set([
  "subprecificado",
  "subprecificado_grave",
  "negativo",
]);

function ehPreparacao(v: VeiculoParsed): boolean {
  // Alinhado com NBS: PREPARAÇÃO + BLOQUEADO = "em preparação"
  return classificarPatio(v.patio) === "preparacao";
}

export type VeiculosTableProps = {
  /** Filtro injetado pelo banner de prioridade Ford (Fase C). */
  filtrosPrioridade?: FiltrosPrioridade | null;
};

export function VeiculosTable({ filtrosPrioridade }: VeiculosTableProps = {}) {
  const router = useRouter();
  const { veiculos, vendas, lojas, isHydrated } = useInventory();

  const [statusFiltro, setStatusFiltro] = useState<StatusFiltro>("all");
  const [search, setSearch] = useState("");
  const [filtroLoja, setFiltroLoja] = useState<string>("all");
  const [filtroMarca, setFiltroMarca] = useState<string>("all");
  const [filtroCor, setFiltroCor] = useState<string>("all");
  const [filtroComb, setFiltroComb] = useState<string>("all");
  const [filtroSituacao, setFiltroSituacao] = useState<string>("all");
  const [filtroPatio, setFiltroPatio] = useState<string>("all");
  const [filtroClasse, setFiltroClasse] = useState<"all" | Classe | "showroom" | "repasse">("all");
  const [filtroFipe, setFiltroFipe] = useState<"all" | "acima" | "abaixo" | "sem">("all");
  const [filtroCautelar, setFiltroCautelar] = useState<"all" | StatusCautelar | "sem">("all");

  // Filtro vindo do banner de prioridade Ford (Fase C). Mantemos como state
  // local pra permitir o user limpá-lo sem depender da prop.
  const [modoPrioridade, setModoPrioridade] = useState<{ codsLoja: number[] } | null>(null);

  const fipeBatch = useFipeBatch();
  const cautelares = useCautelares();
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

  // Cache de classificação por chassi (recalcula quando cautelares mudam também)
  const classifMap = useMemo(() => {
    const contagem = contarPorModelo(veiculos);
    const m = new Map<string, ReturnType<typeof classificarVeiculo>>();
    for (const v of veiculos) {
      m.set(v.chassi, classificarVeiculo(v, {
        contagemPorModelo: contagem,
        cautelar: cautelares[v.chassi] ?? null,
      }));
    }
    return m;
  }, [veiculos, cautelares]);

  // Sincroniza prop filtrosPrioridade → state interno (nonce força reaplicar
  // mesmo se o user já tinha desligado o filtro e clicou de novo no banner).
  // Reset implícito quando a prop volta a null.
  useEffect(() => {
    if (filtrosPrioridade) {
      setModoPrioridade({ codsLoja: filtrosPrioridade.codsLoja });
    } else {
      setModoPrioridade(null);
    }
    // Só dispara quando o nonce muda (ignora identidade do objeto sem mudança real)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtrosPrioridade?.nonce, filtrosPrioridade === null]);

  // Diagnóstico em lote SÓ quando modo prioridade ativo — evita recompute pesado
  // no caminho normal da tabela. Restringe aos veículos das lojas-alvo.
  const diagnosticosPrioridade = useMemo(() => {
    if (!modoPrioridade) return null;
    const cods = new Set(modoPrioridade.codsLoja);
    const subset = veiculos.filter((v) => cods.has(v.cod_empresa));
    if (subset.length === 0) return new Map<string, DiagnosticoStatus>();

    const classesPorChassi = new Map<string, Classe>();
    for (const v of subset) {
      const c = classifMap.get(v.chassi)?.classe;
      if (c) classesPorChassi.set(v.chassi, c);
    }

    const fipeMap: Record<string, number> = {};
    if (fipeBatch?.items) {
      for (const [chassi, item] of Object.entries(fipeBatch.items)) {
        if (item.precoFipe != null) fipeMap[chassi] = item.precoFipe;
      }
    }

    const medianas = calcularMedianasKm(veiculos, vendas);
    const result = computarDiagnosticoLista({
      veiculos: subset,
      classesPorChassi,
      fipeBatch: fipeMap,
      cautelaresPorChassi: cautelares,
      medianasKmPorChave: medianas,
    });

    const statusMap = new Map<string, DiagnosticoStatus>();
    for (const [chassi, r] of result) statusMap.set(chassi, r.status);
    return statusMap;
  }, [modoPrioridade, veiculos, vendas, classifMap, fipeBatch, cautelares]);

  // Filtros aplicados EXCETO status. Usado para KPIs e resumo agregado por status.
  const filteredExceptStatus = useMemo(() => {
    const aMin = num(anoMin), aMax = num(anoMax);
    const kMin = num(kmMin), kMax = num(kmMax);
    const pMin = num(precoMin), pMax = num(precoMax);
    const dMin = num(diasMin), dMax = num(diasMax);

    return veiculos.filter((v) => {
      // Modo prioridade Ford: filtra lojas-alvo + status diagnóstico em atenção.
      // Aplicado antes de qualquer outro filtro pra short-circuit rápido.
      if (modoPrioridade) {
        if (!modoPrioridade.codsLoja.includes(v.cod_empresa)) return false;
        const st = diagnosticosPrioridade?.get(v.chassi);
        if (!st || !STATUS_ATENCAO_DIAG.has(st)) return false;
      }
      if (filtroLoja !== "all" && String(v.cod_empresa) !== filtroLoja) return false;
      if (filtroMarca !== "all" && v.marca !== filtroMarca) return false;
      if (filtroCor !== "all" && v.cor_externa !== filtroCor) return false;
      if (filtroComb !== "all" && v.combustivel !== filtroComb) return false;
      if (filtroSituacao !== "all" && v.descricao_situacao !== filtroSituacao) return false;
      if (filtroPatio !== "all" && v.patio.trim() !== filtroPatio) return false;
      if (filtroClasse !== "all") {
        const c = classifMap.get(v.chassi);
        if (!c) return false;
        if (filtroClasse === "showroom" || filtroClasse === "repasse") {
          if (c.canal !== filtroClasse) return false;
        } else {
          if (c.classe !== filtroClasse) return false;
        }
      }
      if (filtroCautelar !== "all") {
        const c = cautelares[v.chassi] ?? null;
        if (filtroCautelar === "sem") {
          if (c !== null) return false;
        } else if (c !== filtroCautelar) {
          return false;
        }
      }
      if (filtroFipe !== "all") {
        const item = fipeBatch?.items[v.chassi];
        const desv = item ? calcularDesvioFipe(v.preco_venda, item.precoFipe) : null;
        if (filtroFipe === "sem") {
          if (item) return false; // só mostra os SEM match
        } else if (!desv) {
          return false;
        } else if (filtroFipe === "acima" && desv.pct <= 0) {
          return false;
        } else if (filtroFipe === "abaixo" && desv.pct >= 0) {
          return false;
        }
      }
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
  }, [veiculos, filtroLoja, filtroMarca, filtroCor, filtroComb, filtroSituacao, filtroPatio, filtroClasse, filtroFipe, filtroCautelar, classifMap, fipeBatch, cautelares, anoMin, anoMax, kmMin, kmMax, precoMin, precoMax, diasMin, diasMax, search, modoPrioridade, diagnosticosPrioridade]);

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
      const custo = v.valor_aquisicao ?? 0; // custo de fábrica (capital travado)
      if (ehPreparacao(v)) {
        prepQt++;
        prepRs += custo;
      } else {
        realQt++;
        realRs += custo;
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
    {
      id: "classe",
      header: "Classe",
      accessorFn: (v) => classifMap.get(v.chassi)?.classe ?? "?",
      cell: ({ row }) => {
        const c = classifMap.get(row.original.chassi);
        if (!c) return <span className="text-zinc-400 text-xs">—</span>;
        const cor = CLASSE_COR[c.classe];
        return (
          <span
            className={cn("inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold", cor.bg, cor.text)}
            title={`${c.classe} · ${c.canal === "showroom" ? "Show Room" : "Repasse"}${c.rebaixadoPorEstoque ? " (rebaixado)" : ""}`}
          >
            {c.classe}
          </span>
        );
      },
      size: 60,
    },
    {
      id: "cautelar",
      header: "Cautelar",
      accessorFn: (v) => cautelares[v.chassi] ?? "",
      cell: ({ row }) => {
        const c = cautelares[row.original.chassi];
        if (!c) return <span className="text-zinc-300 text-xs">—</span>;
        return <span className="text-base" title={CAUTELAR_LABEL[c]}>{CAUTELAR_ICONE[c]}</span>;
      },
      size: 80,
    },
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
    {
      id: "fipe_pct",
      header: "vs FIPE",
      accessorFn: (v) => {
        const item = fipeBatch?.items[v.chassi];
        const desv = item ? calcularDesvioFipe(v.preco_venda, item.precoFipe) : null;
        return desv?.pct ?? null;
      },
      cell: ({ row }) => {
        const v = row.original;
        const item = fipeBatch?.items[v.chassi];
        if (!item) {
          return <span className="text-xs text-zinc-300">—</span>;
        }
        const desv = calcularDesvioFipe(v.preco_venda, item.precoFipe);
        if (!desv) return <span className="text-xs text-zinc-300">—</span>;
        const tone = desv.pct > 5
          ? "text-red-700"
          : desv.pct > 0
            ? "text-amber-700"
            : desv.pct > -5
              ? "text-emerald-700"
              : "text-emerald-800 font-semibold";
        return (
          <span className={cn("tabular-nums text-xs", tone)} title={`FIPE: ${formatBRL(item.precoFipe)}`}>
            {desv.pct >= 0 ? "+" : ""}{desv.pct.toFixed(1)}%
          </span>
        );
      },
      size: 80,
      sortUndefined: "last",
    },
    { accessorKey: "valor_aquisicao", header: "Aquisição", cell: (info) => <span className="tabular-nums text-zinc-600">{formatBRL(info.getValue<number | null>())}</span> },
    { accessorKey: "custo_total", header: "Custo Total", cell: (info) => <span className="tabular-nums text-zinc-600">{formatBRL(info.getValue<number | null>())}</span> },
    { accessorKey: "dias_patio", header: "Dias", cell: (info) => <span className="tabular-nums">{info.getValue<number | null>() ?? "—"}</span> },
  ], [lojas, classifMap, fipeBatch, cautelares]);

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
    setModoPrioridade(null);
  };

  const filtrosAtivos = [
    statusFiltro !== "all",
    !!search,
    filtroLoja !== "all", filtroMarca !== "all", filtroCor !== "all",
    filtroComb !== "all", filtroSituacao !== "all", filtroPatio !== "all",
    !!anoMin, !!anoMax, !!kmMin, !!kmMax, !!precoMin, !!precoMax, !!diasMin, !!diasMax,
    modoPrioridade !== null,
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
      {/* Banner FIPE batch */}
      <FipeBatchRunner />

      {/* Ações em massa de cautelar */}
      <CautelarBatchActions />

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
        {modoPrioridade && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-red-300 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
            <AlertTriangle className="h-3 w-3" />
            Prioridade Ford ativa
            <button
              onClick={() => setModoPrioridade(null)}
              className="ml-0.5 rounded p-0.5 hover:bg-red-200/60 dark:hover:bg-red-900/40"
              aria-label="Remover filtro de prioridade Ford"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        )}
        {filtrosAtivos > 0 && (
          <button
            onClick={limparFiltros}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
          >
            <X className="h-3 w-3" /> Limpar {filtrosAtivos} filtro{filtrosAtivos > 1 ? "s" : ""}
          </button>
        )}
      </div>

      {/* KPIs reativos — valores em CUSTO DE FÁBRICA (capital travado) */}
      <div className="grid gap-4 md:grid-cols-3">
        <Kpi
          tone="green"
          title="Estoque REAL (custo)"
          value={formatBRL(kpis.realRs)}
          subtitle={`${formatInt(kpis.realQt)} carros (exc. preparação)`}
          active={statusFiltro === "real"}
        />
        <Kpi
          tone="amber"
          title="Em PREPARAÇÃO (custo)"
          value={formatBRL(kpis.prepRs)}
          subtitle={`${formatInt(kpis.prepQt)} fantasmas`}
          active={statusFiltro === "prep"}
        />
        <Kpi
          tone="zinc"
          title="TOTAL (custo de fábrica)"
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
          <Select label="Classe" value={filtroClasse} onChange={(v) => setFiltroClasse(v as "all" | Classe | "showroom" | "repasse")} options={[
            ["all", "Todas"],
            ["showroom", "▸ Show Room"],
            ["repasse", "▸ Repasse"],
            ["A", "A"],
            ["B", "B"],
            ["C", "C"],
            ["D", "D"],
            ["E", "E"],
          ]} />
          <Select label="vs FIPE" value={filtroFipe} onChange={(v) => setFiltroFipe(v as "all" | "acima" | "abaixo" | "sem")} options={[
            ["all", "Todos"],
            ["acima", "🔴 Acima da FIPE"],
            ["abaixo", "🟢 Abaixo da FIPE"],
            ["sem", "❓ Sem match FIPE"],
          ]} />
          <Select label="Cautelar" value={filtroCautelar} onChange={(v) => setFiltroCautelar(v as "all" | StatusCautelar | "sem")} options={[
            ["all", "Todas"],
            ["aprovado", "✅ Aprovado"],
            ["com_restricao", "⚠️ Com restrição"],
            ["reprovado", "🔴 Reprovado"],
            ["sem", "❔ Sem cautelar"],
          ]} />

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
          custo de fábrica: <strong>{formatBRL(filtered.reduce((s, v) => s + (v.valor_aquisicao ?? 0), 0))}</strong> ·
          venda: <strong>{formatBRL(filtered.reduce((s, v) => s + (v.preco_venda ?? 0), 0))}</strong>
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
