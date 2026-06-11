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
} from "@tanstack/react-table";
import { ArrowUpDown, ArrowUp, ArrowDown, AlertTriangle, X, ClipboardCheck, BarChart3, Repeat, ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";
import { classificarPatio } from "@/lib/inventory/status";
import { CLASSE_COR } from "@/lib/pricing/classificacao";
import { CAUTELAR_ICONE, CAUTELAR_LABEL } from "@/lib/inventory/cautelar";
import { cn, formatBRL, formatInt } from "@/lib/utils";
import { ResumoPorDimensao } from "./ResumoPorDimensao";
import { FipeBatchRunner } from "./FipeBatchRunner";
import { CautelarBatchActions } from "./CautelarBatchActions";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";
import { ExportDropdown } from "./ui/ExportDropdown";
import { useVeiculosTable, type FiltrosPrioridade } from "./veiculos/useVeiculosTable";
import { FiltrosVeiculos } from "./veiculos/FiltrosVeiculos";
import { VeiculoCardMobile } from "./veiculos/VeiculoCardMobile";
import { calcularDesvioFipe } from "@/lib/fipe/batch";
import { SubirRepasseModal } from "./repasses/SubirRepasseModal";
import { BulkSubirRepasseModal } from "./repasses/BulkSubirRepasseModal";
import { particionarParaBulkSubir } from "@/lib/repasses/bulk";
import { showInfoToast } from "./ui/Toast";

function ehPreparacao(v: VeiculoParsed): boolean {
  return classificarPatio(v.patio) === "preparacao";
}

export type { FiltrosPrioridade };

export type VeiculosTableProps = {
  filtrosPrioridade?: FiltrosPrioridade | null;
};

export function VeiculosTable({ filtrosPrioridade }: VeiculosTableProps = {}) {
  const router = useRouter();
  const vState = useVeiculosTable({ filtrosPrioridade });
  const [veiculoSubindo, setVeiculoSubindo] = useState<VeiculoParsed | null>(null);
  const [bulkVeiculos, setBulkVeiculos] = useState<VeiculoParsed[] | null>(null);

  const {
    isHydrated,
    veiculos,
    lojas,
    statusFiltro, setStatusFiltro,
    search, setSearch,
    filtroLoja, setFiltroLoja,
    filtroMarca, setFiltroMarca,
    filtroCor, setFiltroCor,
    filtroComb, setFiltroComb,
    filtroSituacao, setFiltroSituacao,
    filtroPatio, setFiltroPatio,
    filtroClasse, setFiltroClasse,
    filtroFipe, setFiltroFipe,
    filtroCautelar, setFiltroCautelar,
    avancadoOpen, setAvancadoOpen,
    anoMin, setAnoMin, anoMax, setAnoMax,
    kmMin, setKmMin, kmMax, setKmMax,
    precoMin, setPrecoMin, precoMax, setPrecoMax,
    diasMin, setDiasMin, diasMax, setDiasMax,
    sorting, setSorting,
    rowSelection, setRowSelection,
    lojasCods, marcas, cores, combs, patios, situacoes,
    classifMap,
    cautelares,
    flags,
    filtroFlag, setFiltroFlag,
    filtroRepasse, setFiltroRepasse,
    idadeMin, setIdadeMin, idadeMax, setIdadeMax,
    margemMin, setMargemMin, margemMax, setMargemMax,
    fipeBatch,
    chassisEmRepasse, marcarChassiEmRepasse,
    modoPrioridade, fecharModoPrioridade,
    filtered,
    kpis,
    limparFiltros,
    exportandoConf, exportandoGerencial, exportandoSelecao,
    handleExportarConferencia, handleExportarGerencial,
    exportarSelecionados, copiarPlacas,
    filtrosAvancadosAtivos, filtrosAtivos,
  } = vState;

  const columns = useMemo<ColumnDef<VeiculoParsed>[]>(() => [
    {
      id: "select",
      header: ({ table }) => (
        <input
          type="checkbox"
          checked={table.getIsAllPageRowsSelected()}
          ref={(el) => {
            if (el) el.indeterminate = table.getIsSomePageRowsSelected() && !table.getIsAllPageRowsSelected();
          }}
          onChange={table.getToggleAllPageRowsSelectedHandler()}
          onClick={(e) => e.stopPropagation()}
          aria-label="Selecionar todos da página"
          className="h-4 w-4 cursor-pointer rounded border-[var(--border-base)] accent-[var(--brand-700)]"
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          checked={row.getIsSelected()}
          onChange={row.getToggleSelectedHandler()}
          onClick={(e) => e.stopPropagation()}
          aria-label="Selecionar veículo"
          className="h-4 w-4 cursor-pointer rounded border-[var(--border-base)] accent-[var(--brand-700)]"
        />
      ),
      size: 32,
      enableSorting: false,
    },
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
        <span className="text-xs whitespace-nowrap">
          {nome ? <span title={`Cód: ${cod}`}>{nome}</span> : <span className="text-[var(--text-muted)] italic">Loja {cod}</span>}
        </span>
      );
    } },
    {
      accessorKey: "placa",
      header: "Placa",
      cell: ({ row }) => {
        const placa = row.original.placa;
        const emRepasse = chassisEmRepasse.has(row.original.chassi);
        return (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span className="font-mono text-xs">{placa}</span>
            {emRepasse && (
              <span
                className="inline-flex items-center gap-0.5 rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-blue-800 dark:bg-blue-950/40 dark:text-blue-300"
                title="Já existe um repasse ativo pra este carro"
              >
                <Repeat className="h-2.5 w-2.5" /> Em repasse
              </span>
            )}
          </span>
        );
      },
    },
    {
      id: "classe",
      header: "Classe",
      accessorFn: (v) => classifMap.get(v.chassi)?.classe ?? "?",
      cell: ({ row }) => {
        const c = classifMap.get(row.original.chassi);
        if (!c) return <span className="text-[var(--text-subtle)] text-xs">—</span>;
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
      cell: ({ row }) => {
        const cautelarVal = cautelares[row.original.chassi];
        if (!cautelarVal) return <span className="text-[var(--text-subtle)] opacity-60 text-xs">—</span>;
        return <span className="text-base" title={CAUTELAR_LABEL[cautelarVal]}>{CAUTELAR_ICONE[cautelarVal]}</span>;
      },
      size: 80,
    },
    { accessorKey: "marca", header: "Marca", cell: (info) => <span className="text-xs whitespace-nowrap">{info.getValue<string>()}</span> },
    {
      accessorKey: "modelo",
      header: "Modelo",
      cell: (info) => {
        const v = info.getValue<string>();
        return <span className="block max-w-[220px] truncate text-xs" title={v}>{v}</span>;
      },
      size: 220,
    },
    { accessorKey: "ano_modelo", header: "Ano", cell: (info) => <span className="tabular-nums text-xs">{info.getValue<number | null>() ?? "—"}</span>, size: 50 },
    { accessorKey: "km", header: "KM", cell: (info) => {
      const km = info.getValue<number | null>();
      if (km === null) return <span className="text-[var(--text-subtle)]">—</span>;
      const tone = km < 30000 ? "text-green-700 dark:text-green-400"
        : km < 80000 ? ""
        : km < 150000 ? "text-amber-700 dark:text-amber-400"
        : "text-red-700 dark:text-red-400";
      return <span className={cn("tabular-nums whitespace-nowrap text-xs", tone)}>{formatInt(km)}</span>;
    }, size: 70 },
    { accessorKey: "cor_externa", header: "Cor", cell: (info) => <span className="text-xs whitespace-nowrap">{info.getValue<string>()}</span> },
    { accessorKey: "combustivel", header: "Comb", cell: (info) => <span className="text-xs whitespace-nowrap">{info.getValue<string>()}</span> },
    { accessorKey: "patio", header: "Pátio", cell: (info) => <span className="text-xs whitespace-nowrap">{info.getValue<string>().trim()}</span> },
    { accessorKey: "preco_venda", header: "Preço", cell: (info) => <span className="tabular-nums whitespace-nowrap text-xs" title="Preço de venda">{formatBRL(info.getValue<number | null>())}</span> },
    {
      id: "fipe_pct",
      header: "vs FIPE",
      cell: ({ row }) => {
        const v = row.original;
        const item = fipeBatch?.items?.[v.chassi];
        if (!item) return <span className="text-xs text-[var(--text-subtle)] opacity-60">—</span>;
        const desv = calcularDesvioFipe(v.preco_venda, item.precoFipe);
        if (!desv) return <span className="text-xs text-[var(--text-subtle)] opacity-60">—</span>;
        const tone = desv.pct > 5 ? "text-red-700" : desv.pct > 0 ? "text-amber-700" : desv.pct > -5 ? "text-emerald-700" : "text-emerald-800 font-semibold";
        return (
          <span className={cn("tabular-nums text-xs", tone)} title={`FIPE: ${formatBRL(item.precoFipe)}`}>
            {desv.pct >= 0 ? "+" : ""}{desv.pct.toFixed(1)}%
          </span>
        );
      },
      size: 80,
    },
    { accessorKey: "valor_aquisicao", header: "Aquis.", cell: (info) => <span className="tabular-nums whitespace-nowrap text-xs text-[var(--text-body)]" title="Valor de aquisição">{formatBRL(info.getValue<number | null>())}</span> },
    {
      id: "gasto_pos_entrada",
      header: "Gasto pós",
      cell: ({ row }) => {
        const v = row.original;
        if (v.custo_total == null || v.valor_aquisicao == null) return <span className="tabular-nums text-[var(--text-subtle)] opacity-60">—</span>;
        const diff = v.custo_total - v.valor_aquisicao;
        if (diff === 0) return <span className="tabular-nums text-[var(--text-subtle)] opacity-60">—</span>;
        if (diff < 0) return <span className="tabular-nums whitespace-nowrap text-xs text-red-700 dark:text-red-400" title="atenção: custo inferior à aquisição (gasto pós-entrada negativo)">{formatBRL(diff)}</span>;
        return <span className="tabular-nums whitespace-nowrap text-xs text-[var(--text-body)]" title="Gasto pós-entrada">{formatBRL(diff)}</span>;
      },
    },
    { accessorKey: "custo_total", header: "Custo", cell: (info) => <span className="tabular-nums whitespace-nowrap text-xs text-[var(--text-body)]" title="Custo total">{formatBRL(info.getValue<number | null>())}</span> },
    {
      id: "margem_teorica_pct",
      header: "Margem",
      cell: ({ row }) => {
        const v = row.original;
        if (v.preco_venda == null || v.custo_total == null || v.preco_venda === 0) return <span className="tabular-nums text-xs text-[var(--text-subtle)] opacity-60">—</span>;
        const pct = ((v.preco_venda - v.custo_total) / v.preco_venda) * 100;
        if (!Number.isFinite(pct)) return <span className="tabular-nums text-xs text-[var(--text-subtle)] opacity-60">—</span>;
        const tone = pct >= 5 ? "text-emerald-700 dark:text-emerald-400" : pct >= 0 ? "text-amber-700 dark:text-amber-400" : "text-red-700 dark:text-red-400";
        const marker = pct >= 5 ? "✓" : pct >= 0 ? "⚠" : "✗";
        const titleText = pct >= 5 ? "margem saudável" : pct >= 0 ? "atenção" : "prejuízo";
        const formatted = pct.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: "exceptZero" });
        return <span className={cn("tabular-nums whitespace-nowrap text-xs font-medium", tone)} title={`Margem teórica · ${titleText}`}>{marker} {formatted}%</span>;
      },
      size: 80,
    },
    {
      id: "custo_por_dia",
      header: "$/dia",
      cell: ({ row }) => {
        const v = row.original;
        if (v.custo_total == null || v.valor_aquisicao == null || v.dias_patio == null) return <span className="tabular-nums text-[var(--text-subtle)] opacity-60">—</span>;
        const gasto = v.custo_total - v.valor_aquisicao;
        if (gasto <= 0 || v.dias_patio <= 0) return <span className="tabular-nums text-[var(--text-subtle)] opacity-60">—</span>;
        return <span className="tabular-nums whitespace-nowrap text-xs text-[var(--text-body)]" title="Custo médio por dia parado">{formatBRL(gasto / v.dias_patio)}</span>;
      },
      size: 70,
    },
    { accessorKey: "dias_patio", header: "Dias", cell: (info) => <span className="tabular-nums whitespace-nowrap text-xs">{info.getValue<number | null>() ?? "—"}</span>, size: 50 },
    {
      id: "acao_repasse",
      header: "Ação",
      cell: ({ row }) => {
        const v = row.original;
        const repasseId = chassisEmRepasse.get(v.chassi);
        if (repasseId != null) {
          return (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                router.push(`/repasses/${repasseId}`);
              }}
              className="inline-flex items-center justify-center rounded-md p-1 text-blue-700 hover:bg-blue-100 dark:text-blue-300 dark:hover:bg-blue-950/40"
              title="Ver repasse"
              aria-label="Ver repasse"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          );
        }
        return (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setVeiculoSubindo(v);
            }}
            className="inline-flex items-center justify-center rounded-md p-1 text-[var(--brand-700)] hover:bg-[var(--brand-50)] dark:text-[var(--brand-300)] dark:hover:bg-[var(--brand-900)]/40"
            title="Subir pra repasse"
            aria-label="Subir pra repasse"
          >
            <Repeat className="h-3.5 w-3.5" />
          </button>
        );
      },
      size: 50,
      enableSorting: false,
    },
  ], [lojas, classifMap, cautelares, fipeBatch, chassisEmRepasse, router]);

  // TanStack Table v8 retorna funções não-puras que o React Compiler não consegue memorizar.
  // Limitação conhecida — remover este disable quando migrarmos pra v9 (compatível).
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting, rowSelection },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    enableRowSelection: true,
    getRowId: (row) => row.chassi,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 25 } },
  });

  const selecionados = table.getSelectedRowModel().rows.map((r) => r.original);
  const previewBulk = useMemo(
    () => particionarParaBulkSubir(selecionados, chassisEmRepasse),
    [selecionados, chassisEmRepasse],
  );

  if (!isHydrated) return <p className="text-sm text-[var(--text-muted)]">Carregando…</p>;

  if (veiculos.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--border-base)] bg-[var(--bg-surface)] p-12 text-center">
        <p className="text-[var(--text-muted)]">Nenhum relatório carregado nessa sessão.</p>
        <a href="/upload" className="mt-3 inline-block rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">📤 Subir o XLSX do NBS</a>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <FipeBatchRunner />
      <CautelarBatchActions />

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] p-1">
          <SegBtn active={statusFiltro === "all"} onClick={() => setStatusFiltro("all")}>Tudo <span className="ml-1 text-xs opacity-70">({formatInt(kpis.totalQt)})</span></SegBtn>
          <SegBtn active={statusFiltro === "real"} onClick={() => setStatusFiltro("real")} accent="green">Só estoque real <span className="ml-1 text-xs opacity-70">({formatInt(kpis.realQt)})</span></SegBtn>
          <SegBtn active={statusFiltro === "prep"} onClick={() => setStatusFiltro("prep")} accent="amber">Só preparação <span className="ml-1 text-xs opacity-70">({formatInt(kpis.prepQt)})</span></SegBtn>
        </div>

        {modoPrioridade && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-red-300 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
            <AlertTriangle className="h-3 w-3" /> Prioridade Ford ativa
            <button onClick={fecharModoPrioridade} className="ml-0.5 rounded p-0.5 hover:bg-red-200/60 dark:hover:bg-red-900/40" aria-label="Remover filtro de prioridade Ford"><X className="h-3 w-3" /></button>
          </span>
        )}

        <div className="ml-auto flex items-center gap-3">
          {selecionados.length > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-[var(--border-base)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs">
              <span className="font-semibold text-[var(--text-strong)]">{selecionados.length} selecionados:</span>
              <button onClick={() => copiarPlacas(selecionados)} className="inline-flex items-center gap-1 hover:text-[var(--brand-600)]"><ClipboardCheck className="h-3 w-3" /> Placas</button>
              <button onClick={() => exportarSelecionados(selecionados)} className="inline-flex items-center gap-1 hover:text-[var(--brand-600)]" disabled={exportandoSelecao}>{exportandoSelecao ? "Exportando…" : "Gerencial (XLSX)"}</button>
              <div className="flex flex-col items-end gap-0.5">
                <button
                  type="button"
                  onClick={() => {
                    if (previewBulk.jaEmRepasse.length > 0) {
                      showInfoToast(
                        `${previewBulk.jaEmRepasse.length} carro${previewBulk.jaEmRepasse.length === 1 ? "" : "s"} já em repasse — ignorado${previewBulk.jaEmRepasse.length === 1 ? "" : "s"}`,
                      );
                    }
                    if (previewBulk.elegiveis.length === 0) return;
                    setBulkVeiculos(previewBulk.elegiveis);
                  }}
                  disabled={previewBulk.elegiveis.length === 0}
                  className="inline-flex items-center gap-1 rounded-md bg-[var(--brand-700)] px-2 py-0.5 text-white hover:bg-[var(--brand-800)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Repeat className="h-3 w-3" /> Subir {previewBulk.elegiveis.length} pra repasse
                </button>
                {previewBulk.jaEmRepasse.length > 0 && (
                  <span className="text-[10px] text-[var(--text-muted)]">
                    {previewBulk.jaEmRepasse.length} já em repasse — ignorado{previewBulk.jaEmRepasse.length === 1 ? "" : "s"}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setRowSelection({})}
                className="inline-flex items-center gap-1 text-[var(--text-muted)] hover:text-[var(--text-strong)]"
                title="Limpar seleção"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
          <ExportDropdown
            disabled={exportandoConf || filtered.length === 0}
            trigger={<><ClipboardCheck className="h-4 w-4" /> {exportandoConf ? "Gerando…" : "Imprimir conferência"}</>}
            items={[
              { label: "XLSX", description: "Planilha editável", onSelect: () => handleExportarConferencia("xlsx") },
              { label: "PDF", description: "Pronto para imprimir", onSelect: () => handleExportarConferencia("pdf") },
            ]}
          />
          <ExportDropdown
            disabled={exportandoGerencial || filtered.length === 0}
            trigger={<><BarChart3 className="h-4 w-4" /> {exportandoGerencial ? "Gerando…" : "Relatório gerencial"}</>}
            items={[
              { label: "XLSX", description: "Planilha com totalizadores", onSelect: () => handleExportarGerencial("xlsx") },
              { label: "PDF", description: "Versão com bloco resumo", onSelect: () => handleExportarGerencial("pdf") },
            ]}
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Kpi tone="green" title="Estoque REAL (custo)" value={formatBRL(kpis.realRs)} subtitle={`${formatInt(kpis.realQt)} carros`} active={statusFiltro === "real"} />
        <Kpi tone="amber" title="Em PREPARAÇÃO (custo)" value={formatBRL(kpis.prepRs)} subtitle={`${formatInt(kpis.prepQt)} fantasmas`} active={statusFiltro === "prep"} />
        <Kpi tone="zinc" title="TOTAL (custo de fábrica)" value={formatBRL(kpis.totalRs)} subtitle={`${formatInt(kpis.totalQt)} carros`} active={statusFiltro === "all"} />
      </div>

      <FiltrosVeiculos
        filtroLoja={filtroLoja} setFiltroLoja={setFiltroLoja} lojasCods={lojasCods} lojas={lojas}
        filtroMarca={filtroMarca} setFiltroMarca={setFiltroMarca} marcas={marcas}
        filtroSituacao={filtroSituacao} setFiltroSituacao={setFiltroSituacao} situacoes={situacoes}
        avancadoOpen={avancadoOpen} setAvancadoOpen={setAvancadoOpen} filtrosAvancadosAtivos={filtrosAvancadosAtivos}
        search={search} setSearch={setSearch}
        filtroCor={filtroCor} setFiltroCor={setFiltroCor} cores={cores}
        filtroComb={filtroComb} setFiltroComb={setFiltroComb} combs={combs}
        filtroPatio={filtroPatio} setFiltroPatio={setFiltroPatio} patios={patios}
        filtroClasse={filtroClasse} setFiltroClasse={setFiltroClasse}
        filtroFipe={filtroFipe} setFiltroFipe={setFiltroFipe}
        filtroCautelar={filtroCautelar} setFiltroCautelar={setFiltroCautelar}
        filtroFlag={filtroFlag} setFiltroFlag={setFiltroFlag}
        filtroRepasse={filtroRepasse} setFiltroRepasse={setFiltroRepasse}
        idadeMin={idadeMin} setIdadeMin={setIdadeMin} idadeMax={idadeMax} setIdadeMax={setIdadeMax}
        margemMin={margemMin} setMargemMin={setMargemMin} margemMax={margemMax} setMargemMax={setMargemMax}
        anoMin={anoMin} setAnoMin={setAnoMin} anoMax={anoMax} setAnoMax={setAnoMax}
        kmMin={kmMin} setKmMin={setKmMin} kmMax={kmMax} setKmMax={setKmMax}
        precoMin={precoMin} setPrecoMin={setPrecoMin} precoMax={precoMax} setPrecoMax={setPrecoMax}
        diasMin={diasMin} setDiasMin={setDiasMin} diasMax={diasMax} setDiasMax={setDiasMax}
      />

      <p className="text-sm text-[var(--text-body)]">
        {filtrosAtivos > 0 ? (
          filtered.length === 0 ? <>Sem resultados para estes filtros</> : <>Mostrando <strong>{formatInt(filtered.length)}</strong> de <strong>{formatInt(veiculos.length)}</strong> veículos</>
        ) : (
          <><strong>{formatInt(veiculos.length)}</strong> veículos no total</>
        )}
        {filtrosAtivos > 0 && <button onClick={limparFiltros} className="ml-2 text-blue-700 underline dark:text-blue-400">Limpar filtros</button>}
      </p>

      {/* Mobile: card view (md:hidden) */}
      <div className="space-y-2 md:hidden">
        {table.getRowModel().rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[var(--border-base)] bg-[var(--bg-surface)] p-6 text-center text-sm text-[var(--text-muted)]">
            Nenhum veículo nessa página.
          </p>
        ) : (
          table.getRowModel().rows.map((row) => {
            const emRepasse = chassisEmRepasse.has(row.original.chassi);
            return (
              <div key={row.id} className={cn(emRepasse && "opacity-60")}>
                <VeiculoCardMobile
                  veiculo={row.original}
                  loja={lojas[row.original.cod_empresa]}
                  classif={classifMap.get(row.original.chassi) ?? null}
                  cautelar={cautelares[row.original.chassi] ?? null}
                  flags={flags[row.original.chassi] ?? null}
                  fipeItem={fipeBatch?.items?.[row.original.chassi] ?? null}
                  selecionado={row.getIsSelected()}
                  onToggleSelect={() => row.toggleSelected()}
                />
              </div>
            );
          })
        )}
        {/* Paginação mobile */}
        <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] px-3 py-2 text-xs">
          <span>Página {table.getState().pagination.pageIndex + 1} de {table.getPageCount() || 1}</span>
          <div className="flex gap-1">
            <button onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} className="rounded border border-[var(--border-soft)] px-3 py-1.5 disabled:opacity-40">‹ Anterior</button>
            <button onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} className="rounded border border-[var(--border-soft)] px-3 py-1.5 disabled:opacity-40">Próxima ›</button>
          </div>
        </div>
      </div>

      {/* Desktop: tabela densa (oculta em mobile) */}
      <div className="hidden overflow-hidden rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="border-b border-[var(--border-soft)] bg-[var(--bg-muted)]">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => (
                    <th key={h.id} style={{ width: h.column.columnDef.size }} className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-[var(--text-body)] whitespace-nowrap">
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
              {table.getRowModel().rows.map((row) => {
                const emRepasse = chassisEmRepasse.has(row.original.chassi);
                return (
                  <tr
                    key={row.id}
                    onClick={() => router.push(`/veiculos/${row.original.chassi}`)}
                    className={cn(
                      "cursor-pointer border-b border-[var(--border-soft)] last:border-0 hover:bg-[var(--bg-muted)]",
                      emRepasse && "opacity-60",
                    )}
                    title={emRepasse ? "Carro em repasse ativo" : "Ver detalhe"}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-2 py-1.5 align-middle">{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                    ))}
                  </tr>
                );
              })}
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
      <ResumoPorDimensao veiculos={filtered} lojas={lojas} />

      {veiculoSubindo && (
        <SubirRepasseModal
          veiculo={veiculoSubindo}
          valorSubiuSugerido={veiculoSubindo.preco_venda}
          valorMinimoSugerido={veiculoSubindo.custo_total}
          open={true}
          onClose={() => setVeiculoSubindo(null)}
          onSuccess={(repasseId) => {
            const chassi = veiculoSubindo.chassi;
            marcarChassiEmRepasse(chassi, repasseId);
            setVeiculoSubindo(null);
            router.push(`/repasses/${repasseId}`);
          }}
        />
      )}

      {bulkVeiculos && (
        <BulkSubirRepasseModal
          veiculos={bulkVeiculos}
          open={true}
          onClose={(processados) => {
            setBulkVeiculos(null);
            // Limpa SÓ os processados (subidos + pulados). Quem sobrou
            // continua marcado pro próximo bulk.
            if (processados.length > 0) {
              setRowSelection((prev) => {
                const next = { ...prev };
                for (const chassi of processados) delete next[chassi];
                return next;
              });
            }
          }}
          onRepasseCriado={(chassi, repasseId) => {
            marcarChassiEmRepasse(chassi, repasseId);
          }}
        />
      )}
    </div>
  );
}

function SegBtn({ active, onClick, children, accent }: { active: boolean; onClick: () => void; children: React.ReactNode; accent?: "green" | "amber" }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-md px-3 py-1 text-xs font-medium transition",
        active
          ? accent === "green"
            ? "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300"
            : accent === "amber"
              ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
              : "bg-[var(--bg-muted)] text-[var(--text-strong)]"
          : "text-[var(--text-subtle)] hover:text-[var(--text-body)]",
      )}
    >
      {children}
    </button>
  );
}

function Kpi({ tone, title, value, subtitle, active }: { tone: "green" | "amber" | "zinc"; title: string; value: string; subtitle: string; active?: boolean }) {
  const tones = {
    green: { bg: "from-green-50 to-[var(--bg-surface)] dark:from-green-950/20", bar: "bg-green-500", text: "text-green-700 dark:text-green-400" },
    amber: { bg: "from-amber-50 to-[var(--bg-surface)] dark:from-amber-950/20", bar: "bg-amber-500", text: "text-amber-700 dark:text-amber-400" },
    zinc: { bg: "from-[var(--brand-50)] to-[var(--bg-surface)] dark:from-[var(--brand-950)]/20", bar: "bg-[var(--brand-600)]", text: "text-[var(--brand-700)] dark:text-[var(--brand-400)]" },
  };
  const t = tones[tone];
  return (
    <div className={cn("relative overflow-hidden rounded-xl border border-[var(--border-soft)] bg-gradient-to-br p-4 shadow-[var(--shadow-sm)] transition", t.bg, active && "ring-1 ring-[var(--brand-500)] shadow-md")}>
      <div className={cn("absolute left-0 top-0 h-full w-1", t.bar)} />
      <p className={cn("text-[10px] font-semibold uppercase tracking-wider", t.text)}>{title}</p>
      <p className="mt-1 text-xl font-bold tabular-nums tracking-tight text-[var(--text-strong)]">{value}</p>
      <p className="text-[11px] text-[var(--text-muted)]">{subtitle}</p>
    </div>
  );
}
