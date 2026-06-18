"use client";

import { useMemo, useState } from "react";
import { useInventory } from "@/lib/store/inventory";
import { classificarPatio } from "@/lib/inventory/status";
import { classificarVeiculo, contarPorModelo, type Classe } from "@/lib/pricing/classificacao";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";
import { useFipeBatch } from "@/lib/fipe/useFipeBatch";
import { calcularDesvioFipe } from "@/lib/fipe/batch";
import { useCautelares, type StatusCautelar } from "@/lib/inventory/cautelar";
import { useFlagsTodas } from "@/lib/data/flags-veiculo";
import { ehPraRepasse } from "@/lib/analytics/carros-pra-repassar";
import { estaReservado } from "@/lib/inventory/reservado";
import { useChassisEmRepasse } from "@/lib/repasses/useChassisEmRepasse";
import { computarDiagnosticoLista, type DiagnosticoStatus } from "@/lib/pricing/diagnostico";
import { calcularMedianasKm } from "@/lib/pricing/medianas";
import { usePersistedState } from "@/lib/hooks/usePersistedState";
import { baixarConferenciaEstoque } from "@/lib/export/conferencia-estoque";
import { baixarConferenciaEstoquePdf } from "@/lib/export/conferencia-estoque-pdf";
import { baixarRelatorioGerencial } from "@/lib/export/relatorio-gerencial-estoque";
import { baixarRelatorioGerencialPdf } from "@/lib/export/relatorio-gerencial-estoque-pdf";
import { showSuccessToast, showErrorToast } from "../ui/Toast";
import type { SortingState, RowSelectionState } from "@tanstack/react-table";
import { aplicarLimparFiltros } from "./filtros-iniciais";

function todayISOLocal(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export type StatusFiltro = "all" | "real" | "prep";

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
  return classificarPatio(v.patio) === "preparacao";
}

export type UseVeiculosTableProps = {
  filtrosPrioridade?: FiltrosPrioridade | null;
};

export function useVeiculosTable({ filtrosPrioridade }: UseVeiculosTableProps = {}) {
  const { veiculos, vendas, lojas, isHydrated } = useInventory();

  const [statusFiltro, setStatusFiltro] = usePersistedState<StatusFiltro>("veiculos:statusFiltro", "all");
  const [search, setSearch] = usePersistedState<string>("veiculos:search", "");
  const [filtroLoja, setFiltroLoja] = usePersistedState<string>("veiculos:filtroLoja", "all");
  const [filtroMarca, setFiltroMarca] = usePersistedState<string>("veiculos:filtroMarca", "all");
  const [filtroCor, setFiltroCor] = usePersistedState<string>("veiculos:filtroCor", "all");
  const [filtroComb, setFiltroComb] = usePersistedState<string>("veiculos:filtroComb", "all");
  const [filtroSituacao, setFiltroSituacao] = usePersistedState<string>("veiculos:filtroSituacao", "all");
  const [filtroPatio, setFiltroPatio] = usePersistedState<string>("veiculos:filtroPatio", "all");
  const [filtroClasse, setFiltroClasse] = usePersistedState<"all" | Classe | "showroom" | "repasse">("veiculos:filtroClasse", "all");
  const [filtroFipe, setFiltroFipe] = usePersistedState<"all" | "acima" | "abaixo" | "sem">("veiculos:filtroFipe", "all");
  const [filtroCautelar, setFiltroCautelar] = usePersistedState<"all" | StatusCautelar | "sem">("veiculos:filtroCautelar", "all");
  const [filtroFlag, setFiltroFlag] = usePersistedState<"all" | "promocao" | "brinde" | "qualquer">("veiculos:filtroFlag", "all");
  const [filtroRepasse, setFiltroRepasse] = usePersistedState<"all" | "sim" | "nao">("veiculos:filtroRepasse", "all");
  const [filtroReservado, setFiltroReservado] = usePersistedState<"all" | "sim" | "nao">("veiculos:filtroReservado", "all");
  const [idadeMin, setIdadeMin] = usePersistedState<string>("veiculos:idadeMin", "");
  const [idadeMax, setIdadeMax] = usePersistedState<string>("veiculos:idadeMax", "");
  const [margemMin, setMargemMin] = usePersistedState<string>("veiculos:margemMin", "");
  const [margemMax, setMargemMax] = usePersistedState<string>("veiculos:margemMax", "");

  // Nonce do último filtrosPrioridade que o usuário "fechou" manualmente (via Limpar filtros)
  // Deriva modoPrioridade do prop, exceto se já foi fechado pra esse nonce.
  const [nonceFechado, setNonceFechado] = useState<number | null>(null);
  const modoPrioridade = useMemo<{ codsLoja: number[] } | null>(() => {
    if (!filtrosPrioridade) return null;
    if (filtrosPrioridade.nonce === nonceFechado) return null;
    return { codsLoja: filtrosPrioridade.codsLoja };
  }, [filtrosPrioridade, nonceFechado]);
  const fecharModoPrioridade = () => {
    if (filtrosPrioridade) setNonceFechado(filtrosPrioridade.nonce);
  };

  const fipeBatch = useFipeBatch();
  const cautelares = useCautelares();
  const flags = useFlagsTodas();
  const { chassisEmRepasse, marcarLocalmente: marcarChassiEmRepasse, refresh: refreshChassisEmRepasse } = useChassisEmRepasse();
  const [avancadoOpen, setAvancadoOpen] = useState(false);
  const [anoMin, setAnoMin] = usePersistedState<string>("veiculos:anoMin", "");
  const [anoMax, setAnoMax] = usePersistedState<string>("veiculos:anoMax", "");
  const [kmMin, setKmMin] = usePersistedState<string>("veiculos:kmMin", "");
  const [kmMax, setKmMax] = usePersistedState<string>("veiculos:kmMax", "");
  const [precoMin, setPrecoMin] = usePersistedState<string>("veiculos:precoMin", "");
  const [precoMax, setPrecoMax] = usePersistedState<string>("veiculos:precoMax", "");
  const [diasMin, setDiasMin] = usePersistedState<string>("veiculos:diasMin", "");
  const [diasMax, setDiasMax] = usePersistedState<string>("veiculos:diasMax", "");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

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

  const filteredExceptStatus = useMemo(() => {
    const aMin = num(anoMin), aMax = num(anoMax);
    const kMin = num(kmMin), kMax = num(kmMax);
    const pMin = num(precoMin), pMax = num(precoMax);
    const dMin = num(diasMin), dMax = num(diasMax);
    const idMin = num(idadeMin), idMax = num(idadeMax);
    const mgMin = num(margemMin), mgMax = num(margemMax);
    const anoRef = new Date().getFullYear();

    return veiculos.filter((v) => {
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
      if (filtroFlag !== "all") {
        const f = flags[v.chassi];
        if (filtroFlag === "promocao" && !f?.em_promocao) return false;
        if (filtroFlag === "brinde" && !f?.brinde_acessorios) return false;
        if (filtroFlag === "qualquer" && !(f?.em_promocao || f?.brinde_acessorios)) return false;
      }
      if (filtroFipe !== "all") {
        const item = fipeBatch?.items[v.chassi];
        const desv = item ? calcularDesvioFipe(v.preco_venda, item.precoFipe) : null;
        if (filtroFipe === "sem") {
          if (item) return false;
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
      if (filtroRepasse !== "all") {
        const ehRepasse = ehPraRepasse(v);
        if (filtroRepasse === "sim" && !ehRepasse) return false;
        if (filtroRepasse === "nao" && ehRepasse) return false;
      }
      if (filtroReservado !== "all") {
        const reservado = estaReservado(v);
        if (filtroReservado === "sim" && !reservado) return false;
        if (filtroReservado === "nao" && reservado) return false;
      }
      if (idMin !== null || idMax !== null) {
        const anoVeic = v.ano_fabricacao ?? v.ano_modelo;
        if (anoVeic == null || anoVeic <= 0) {
          // Sem ano → exclui se há qualquer filtro de idade
          return false;
        }
        const idade = anoRef - anoVeic;
        if (idMin !== null && idade < idMin) return false;
        if (idMax !== null && idade > idMax) return false;
      }
      if (mgMin !== null || mgMax !== null) {
        if (v.preco_venda == null || v.custo_total == null || v.preco_venda <= 0) {
          // Sem dados pra calcular margem → exclui se há filtro
          return false;
        }
        const margemPct = ((v.preco_venda - v.custo_total) / v.preco_venda) * 100;
        if (mgMin !== null && margemPct < mgMin) return false;
        if (mgMax !== null && margemPct > mgMax) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        const hay = `${v.placa} ${v.chassi} ${v.modelo} ${v.marca ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [veiculos, filtroLoja, filtroMarca, filtroCor, filtroComb, filtroSituacao, filtroPatio, filtroClasse, filtroFipe, filtroCautelar, filtroFlag, filtroRepasse, filtroReservado, classifMap, fipeBatch, cautelares, flags, anoMin, anoMax, kmMin, kmMax, precoMin, precoMax, diasMin, diasMax, idadeMin, idadeMax, margemMin, margemMax, search, modoPrioridade, diagnosticosPrioridade]);

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
      const custo = v.valor_aquisicao ?? 0;
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

  const limparFiltros = () => {
    aplicarLimparFiltros({
      setStatusFiltro,
      setSearch,
      setFiltroLoja,
      setFiltroMarca,
      setFiltroCor,
      setFiltroComb,
      setFiltroSituacao,
      setFiltroPatio,
      setFiltroClasse,
      setFiltroFipe,
      setFiltroCautelar,
      setFiltroFlag,
      setFiltroRepasse,
      setFiltroReservado,
      setAnoMin,
      setAnoMax,
      setKmMin,
      setKmMax,
      setPrecoMin,
      setPrecoMax,
      setDiasMin,
      setDiasMax,
      setIdadeMin,
      setIdadeMax,
      setMargemMin,
      setMargemMax,
      fecharModoPrioridade,
    });
  };

  const [exportandoSelecao, setExportandoSelecao] = useState(false);
  const [exportandoConf, setExportandoConf] = useState(false);
  const [exportandoGerencial, setExportandoGerencial] = useState(false);

  const handleExportarConferencia = async (formato: "xlsx" | "pdf") => {
    if (exportandoConf || filtered.length === 0) return;
    setExportandoConf(true);
    try {
      const filtroLojaNome =
        filtroLoja === "all"
          ? "TODAS"
          : lojas[Number(filtroLoja)]?.nome?.trim() || `Loja ${filtroLoja}`;
      const veiculosComLoja = filtered.map((v) => ({
        ...v,
        empresa_nome: lojas[v.cod_empresa]?.nome?.trim() ?? "—",
      }));
      if (formato === "xlsx") {
        await baixarConferenciaEstoque({
          veiculos: veiculosComLoja,
          filtroLoja: filtroLojaNome,
        });
        showSuccessToast(`conferencia-estoque-${todayISOLocal()}.xlsx baixada`);
      } else {
        await baixarConferenciaEstoquePdf({
          veiculos: veiculosComLoja,
          filtroLoja: filtroLojaNome,
        });
        showSuccessToast(`conferencia-estoque-${todayISOLocal()}.pdf baixado`);
      }
    } catch (err) {
      console.error("Falha ao gerar planilha de conferência:", err);
      showErrorToast(`Erro ao gerar conferência (${formato.toUpperCase()}). Tente novamente.`);
    } finally {
      setExportandoConf(false);
    }
  };

  const handleExportarGerencial = async (formato: "xlsx" | "pdf") => {
    if (exportandoGerencial || filtered.length === 0) return;
    setExportandoGerencial(true);
    try {
      const filtroLojaNome =
        filtroLoja === "all"
          ? "TODAS"
          : lojas[Number(filtroLoja)]?.nome?.trim() || `Loja ${filtroLoja}`;
      const veiculosComLoja = filtered.map((v) => ({
        ...v,
        empresa_nome: lojas[v.cod_empresa]?.nome?.trim() ?? null,
      }));
      if (formato === "xlsx") {
        await baixarRelatorioGerencial({
          veiculos: veiculosComLoja,
          filtroLoja: filtroLojaNome,
        });
        showSuccessToast(`relatorio-gerencial-estoque-${todayISOLocal()}.xlsx baixado`);
      } else {
        await baixarRelatorioGerencialPdf({
          veiculos: veiculosComLoja,
          filtroLoja: filtroLojaNome,
        });
        showSuccessToast(`relatorio-gerencial-estoque-${todayISOLocal()}.pdf baixado`);
      }
    } catch (err) {
      console.error("Falha ao gerar relatório gerencial:", err);
      showErrorToast(`Erro ao gerar relatório gerencial (${formato.toUpperCase()}). Tente novamente.`);
    } finally {
      setExportandoGerencial(false);
    }
  };

  const exportarSelecionados = async (selecionados: VeiculoParsed[]) => {
    if (exportandoSelecao || selecionados.length === 0) return;
    setExportandoSelecao(true);
    try {
      const enriched = selecionados.map((v) => ({
        ...v,
        empresa_nome: lojas[v.cod_empresa]?.nome?.trim() ?? null,
      }));
      await baixarRelatorioGerencial({ veiculos: enriched, filtroLoja: "selecionados" });
      showSuccessToast(`✓ ${selecionados.length} carro${selecionados.length === 1 ? "" : ""} exportado${selecionados.length === 1 ? "" : ""}`);
    } catch (err) {
      console.error("Falha ao exportar selecionados:", err);
      showErrorToast("Erro ao gerar relatório dos selecionados. Tente novamente.");
    } finally {
      setExportandoSelecao(false);
    }
  };

  const copiarPlacas = async (selecionados: VeiculoParsed[]) => {
    const placas = selecionados.map((v) => v.placa).filter((p): p is string => !!p);
    if (placas.length === 0) {
      showErrorToast("Nenhuma placa válida nos selecionados");
      return;
    }
    try {
      await navigator.clipboard.writeText(placas.join("\n"));
      showSuccessToast(`✓ ${placas.length} placa${placas.length === 1 ? "" : "s"} copiada${placas.length === 1 ? "" : "s"}`);
    } catch {
      showErrorToast("Falha ao copiar — permissão de clipboard negada");
    }
  };

  const filtrosEssenciaisAtivos = [
    statusFiltro !== "all",
    !!search,
    filtroLoja !== "all",
    filtroMarca !== "all",
    filtroSituacao !== "all",
    modoPrioridade !== null,
  ].filter(Boolean).length;

  const filtrosAvancadosAtivos = [
    filtroCor !== "all",
    filtroComb !== "all",
    filtroPatio !== "all",
    filtroClasse !== "all",
    filtroFipe !== "all",
    filtroCautelar !== "all",
    filtroFlag !== "all",
    filtroRepasse !== "all",
    filtroReservado !== "all",
    !!anoMin, !!anoMax, !!kmMin, !!kmMax, !!precoMin, !!precoMax, !!diasMin, !!diasMax,
    !!idadeMin, !!idadeMax, !!margemMin, !!margemMax,
  ].filter(Boolean).length;

  const filtrosAtivos = filtrosEssenciaisAtivos + filtrosAvancadosAtivos;

  return {
    isHydrated,
    veiculos,
    vendas,
    lojas,
    statusFiltro,
    setStatusFiltro,
    search,
    setSearch,
    filtroLoja,
    setFiltroLoja,
    filtroMarca,
    setFiltroMarca,
    filtroCor,
    setFiltroCor,
    filtroComb,
    setFiltroComb,
    filtroSituacao,
    setFiltroSituacao,
    filtroPatio,
    setFiltroPatio,
    filtroClasse,
    setFiltroClasse,
    filtroFipe,
    setFiltroFipe,
    filtroCautelar,
    setFiltroCautelar,
    filtroFlag,
    setFiltroFlag,
    filtroRepasse,
    setFiltroRepasse,
    filtroReservado,
    setFiltroReservado,
    idadeMin,
    setIdadeMin,
    idadeMax,
    setIdadeMax,
    margemMin,
    setMargemMin,
    margemMax,
    setMargemMax,
    avancadoOpen,
    setAvancadoOpen,
    anoMin,
    setAnoMin,
    anoMax,
    setAnoMax,
    kmMin,
    setKmMin,
    kmMax,
    setKmMax,
    precoMin,
    setPrecoMin,
    precoMax,
    setPrecoMax,
    diasMin,
    setDiasMin,
    diasMax,
    setDiasMax,
    sorting,
    setSorting,
    rowSelection,
    setRowSelection,
    lojasCods,
    marcas,
    cores,
    combs,
    patios,
    situacoes,
    classifMap,
    cautelares,
    flags,
    fipeBatch,
    chassisEmRepasse,
    marcarChassiEmRepasse,
    refreshChassisEmRepasse,
    modoPrioridade,
    fecharModoPrioridade,
    diagnosticosPrioridade,
    filtered,
    kpis,
    limparFiltros,
    exportandoConf,
    exportandoGerencial,
    exportandoSelecao,
    handleExportarConferencia,
    handleExportarGerencial,
    exportarSelecionados,
    copiarPlacas,
    filtrosEssenciaisAtivos,
    filtrosAvancadosAtivos,
    filtrosAtivos,
  };
}
