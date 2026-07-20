"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useInventory } from "@/lib/store/inventory";
import { usePersistedState } from "@/lib/hooks/usePersistedState";
import { indexarClientes, chaveCliente } from "@/lib/analytics/clientes";
import { agregarMargem, calcMargemVenda } from "@/lib/analytics/margem";
import { baixarAnaliseNavesa } from "@/lib/export/analise-navesa";
import { baixarAnaliseNavesaPdf } from "@/lib/export/analise-navesa-pdf";
import { showSuccessToast, showErrorToast } from "../ui/Toast";
import {
  runFipeBatch,
  isFipeConfirmado,
  contarFipeConfirmada,
  type BatchProgress,
} from "@/lib/fipe/batch";
import { useFipeBatch } from "@/lib/fipe/useFipeBatch";
import type { SortingState } from "@tanstack/react-table";
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

export function useVendasAnalise() {
  const { vendas, vendasMeta, custosPorPlaca, isHydrated } = useInventory();
  const fipeBatch = useFipeBatch();

  const [search, setSearch] = usePersistedState<string>("vendas:search", "");
  const [exportando, setExportando] = useState(false);
  const [rodandoFipe, setRodandoFipe] = useState(false);
  const [progressoFipe, setProgressoFipe] = useState<BatchProgress | null>(null);
  const [fipeMsg, setFipeMsg] = useState<string | null>(null);
  const fipeMsgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const clientesIndex = useMemo(() => indexarClientes(vendas), [vendas]);
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
      margemPct: agg.margemPct,
      cobertura: agg.cobertura,
      temCustosOficiais: agg.qtComCustoOficial > 0,
      comissao,
      ticketMedio: filtered.length > 0 ? agg.valor / filtered.length : 0,
      diasMedio: comDias > 0 ? dias / comDias : 0,
      pf, pj, troca,
    };
  }, [filtered, custosPorPlaca]);

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
      margemPct: agg.valor > 0 ? (agg.margem / agg.valor) * 100 : 0,
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
    const MIN_VENDAS = 10;
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
      .filter((m) => m.qt >= MIN_VENDAS)
      .sort((a, b) => a.diasMedio - b.diasMedio);
  }, [filtered]);

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

  const handleRunFipe = async () => {
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
        valor_aquisicao: v.total_nota_fabrica,
        // `custo_total` alimenta o guard de plausibilidade da FIPE. Passar null
        // aqui (como antes) desligava o guard em 100% das vendas e era a origem
        // das linhas de `fipe_batch` gravadas sem nenhuma verificação de valor.
        custo_total: v.custo_total_final,
        dias_patio: v.dias_estoque,
        data_entrada: null,
        vendedor_recebeu: v.vendedor_recebeu,
        cod_proposta: null,
      }));
      const r = await runFipeBatch(veiculos, (p) => setProgressoFipe(p));
      if (r.persistenciaErro) {
        setFipeMsg(`Erro ao salvar FIPE: ${r.persistenciaErro}`);
        return;
      }
      // Só match CONFIRMADO conta como cobertura — mesmo bug que o FipeBatchRunner tinha.
      const matches = contarFipeConfirmada(r);
      const naoConfirmados = Object.keys(r.items).length - matches;
      const semMatch = r.erros.filter((e) => !r.items[e.chassi]).length;
      setFipeMsg(
        `FIPE atualizado para ${matches} carro${matches === 1 ? "" : "s"}` +
          (naoConfirmados > 0 ? ` · ${naoConfirmados} não confirmada${naoConfirmados === 1 ? "" : "s"}` : "") +
          (semMatch > 0 ? ` · ${semMatch} sem match` : "") +
          ".",
      );
    } catch (err) {
      setFipeMsg(`Erro ao buscar FIPE: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRodandoFipe(false);
    }
  };

  const handleExportXlsx = async () => {
    if (exportando) return;
    setExportando(true);
    try {
      const mapaFipe = new Map<string, number>();
      if (fipeBatch?.items) {
        const itemsByChassi = fipeBatch.items;
        for (const v of filtered) {
          const item = itemsByChassi[v.chassi];
          if (isFipeConfirmado(item)) {
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
      showSuccessToast(`analise-navesa-${dataDe}-a-${dataAte}.xlsx baixada`);
    } catch {
      showErrorToast("Erro ao gerar análise Navesa (XLSX). Tente novamente.");
    } finally {
      setExportando(false);
    }
  };

  const handleExportPdf = async () => {
    if (exportando) return;
    setExportando(true);
    try {
      await baixarAnaliseNavesaPdf({
        vendas: filtered,
        todasVendas: vendas,
        custosPorPlaca,
        empresa: filtroLoja === "all" ? "TODAS" : filtroLoja,
        dataDe,
        dataAte,
      });
      showSuccessToast(`analise-navesa-${dataDe}-a-${dataAte}.pdf baixado`);
    } catch {
      showErrorToast("Erro ao gerar análise Navesa (PDF). Tente novamente.");
    } finally {
      setExportando(false);
    }
  };

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

  return {
    isHydrated,
    vendas,
    vendasMeta,
    custosPorPlaca,
    fipeBatch,
    search,
    setSearch,
    filtroLoja,
    setFiltroLoja,
    filtroVendedor,
    setFiltroVendedor,
    filtroMarca,
    setFiltroMarca,
    filtroUf,
    setFiltroUf,
    filtroTipoCli,
    setFiltroTipoCli,
    filtroRecorrencia,
    setFiltroRecorrencia,
    dataDe,
    setDataDe,
    dataAte,
    setDataAte,
    avancadoOpen,
    setAvancadoOpen,
    sorting,
    setSorting,
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
    filtrosEssenciaisAtivos,
    filtrosAvancadosAtivos,
    filtrosAtivos,
  };
}
