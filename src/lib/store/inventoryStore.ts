"use client";

import { create } from "zustand";
import type { ParseResult, VeiculoParsed, SnapshotMeta } from "@/lib/parsers/nbs-xlsx";
import type { VendasParseResult, VendaParsed, VendasSnapshotMeta } from "@/lib/parsers/nbs-vendas-xlsx";
import type { CustosParseResult, CustoDetalhado, CustosMeta } from "@/lib/parsers/nbs-custos-xls";
import type { CustosEstoquePdfResult, CustoEstoqueDetalhado, CustosEstoquePdfMeta } from "@/lib/parsers/nbs-custos-estoque-pdf";
import { mergeVendas, mergeCustos, type MergeResultVendas, type MergeResultCustos } from "./merge";
import { listVendas, upsertVendas, clearVendas as sbClearVendas } from "@/lib/data/vendas";
import { listCustos, upsertCustos, clearCustos as sbClearCustos } from "@/lib/data/custos";
import {
  listCustosEstoque,
  upsertCustosEstoque,
  clearCustosEstoque as sbClearCustosEstoque,
} from "@/lib/data/custos-estoque";
import { listVeiculosAtual, getMetaAtual, inserirEstoqueSnapshot, clearEstoque } from "@/lib/data/veiculos";
import { getSupabase } from "@/lib/data/supabase";
import { LOJAS_IGNORADAS, isLojaIgnorada } from "@/lib/config/lojas-ignoradas";

export type LojaInfo = {
  cod_empresa: number;
  nome: string;
  cidade: string;
};

export type VendedorInfo = {
  codigo: string;
  nome: string;
  cpf?: string | null;
};

export type LoadingState = "loading" | "ready" | "error";

export type InventoryStoreState = {
  meta: SnapshotMeta | null;
  veiculos: VeiculoParsed[];
  warnings: string[];
  lojas: Record<number, LojaInfo>;
  vendedores: Record<string, VendedorInfo>;
  vendasMeta: VendasSnapshotMeta | null;
  vendas: VendaParsed[];
  vendasWarnings: string[];
  custosMeta: CustosMeta | null;
  custosPorPlaca: Record<string, CustoDetalhado>;
  custosWarnings: string[];
  custosEstoqueMeta: CustosEstoquePdfMeta | null;
  custosEstoquePorPlaca: Record<string, CustoEstoqueDetalhado>;
  custosEstoqueWarnings: string[];
  isHydrated: boolean;
  loadingState: LoadingState;
  loadError: string | null;

  // Actions
  load: () => Promise<void>;
  retry: () => void;
  setFromParse: (result: ParseResult) => Promise<void>;
  setVendasFromParse: (result: VendasParseResult) => Promise<MergeResultVendas["delta"]>; // Retorna o delta para fins de contabilidade
  setCustosFromParse: (result: CustosParseResult) => Promise<MergeResultCustos["delta"]>; // Retorna o delta
  setCustosEstoqueFromParse: (result: CustosEstoquePdfResult) => Promise<{ novos: number; substituidos: number; mantidos: number }>;
  updateLoja: (cod: number, patch: Partial<LojaInfo>) => void;
  removeLoja: (cod: number) => void;
  clear: () => Promise<void>;
  clearVendas: () => Promise<void>;
  clearCustos: () => Promise<void>;
  clearCustosEstoque: () => Promise<void>;
};

const LOJAS_KEY = "navesa-mesa:lojas-v1";
const SEED_LOJAS: Record<number, LojaInfo> = {
  2: { cod_empresa: 2, nome: "NAVESA FORD AEROPORTO", cidade: "Goiânia" },
};

/** Deriva mapa de vendedores a partir de uma lista de vendas (sem persistir). */
function derivarVendedores(vendas: VendaParsed[]): Record<string, VendedorInfo> {
  const out: Record<string, VendedorInfo> = {};
  for (const v of vendas) {
    if (v.vendedor_codigo && v.vendedor_nome) {
      out[v.vendedor_codigo] = {
        codigo: v.vendedor_codigo,
        nome: v.vendedor_nome,
        cpf: v.vendedor_cpf,
      };
    }
  }
  return out;
}

/** Reconstrói vendasMeta a partir da lista de vendas carregadas. */
function derivarVendasMeta(vendas: VendaParsed[]): VendasSnapshotMeta | null {
  if (vendas.length === 0) return null;
  let ini: number | null = null, fim: number | null = null;
  const lojas = new Set<number>(), vendedores = new Set<string>();
  for (const v of vendas) {
    if (v.data_venda) {
      const t = new Date(v.data_venda).getTime();
      if (ini == null || t < ini) ini = t;
      if (fim == null || t > fim) fim = t;
    }
    lojas.add(v.cod_empresa);
    if (v.vendedor_codigo) vendedores.add(v.vendedor_codigo);
  }
  return {
    arquivo_nome: "supabase",
    data_geracao: null,
    total_vendas: vendas.length,
    total_lojas: lojas.size,
    total_vendedores: vendedores.size,
    periodo_inicio: ini ? new Date(ini) : null,
    periodo_fim: fim ? new Date(fim) : null,
  };
}

function derivarCustosMeta(qt: number): CustosMeta | null {
  if (qt === 0) return null;
  return {
    arquivo_nome: "supabase",
    periodo: null,
    data_geracao: null,
    total_vendas: qt,
    loja_principal: null,
  };
}

function derivarCustosEstoqueMeta(qt: number): CustosEstoquePdfMeta | null {
  if (qt === 0) return null;
  return {
    arquivo_nome: "supabase",
    empresa: "",
    filial: "",
    cod_empresa: 0,
    data_impressao: null,
    total_veiculos: qt,
  };
}

function getInitialLojas(): Record<number, LojaInfo> {
  if (typeof window === "undefined") return SEED_LOJAS;
  try {
    const raw = localStorage.getItem(LOJAS_KEY);
    const parsed: Record<number, LojaInfo> = raw ? JSON.parse(raw) : SEED_LOJAS;
    for (const cod of LOJAS_IGNORADAS) {
      delete parsed[cod];
    }
    return parsed;
  } catch {
    return SEED_LOJAS;
  }
}

export const useInventoryStore = create<InventoryStoreState>((set, get) => ({
  meta: null,
  veiculos: [],
  warnings: [],
  lojas: getInitialLojas(),
  vendedores: {},
  vendasMeta: null,
  vendas: [],
  vendasWarnings: [],
  custosMeta: null,
  custosPorPlaca: {},
  custosWarnings: [],
  custosEstoqueMeta: null,
  custosEstoquePorPlaca: {},
  custosEstoqueWarnings: [],
  isHydrated: false,
  loadingState: "loading",
  loadError: null,

  retry: () => {
    get().load();
  },

  load: async () => {
    set({ loadingState: "loading", loadError: null });
    try {
      // 1. Aguarda sessão Supabase estabelecida
      const sb = getSupabase();
      const { data: { user }, error: authErr } = await sb.auth.getUser();
      if (authErr || !user) {
        set({
          loadError: authErr?.message ?? "Sessão não estabelecida. Recarregue a página.",
          loadingState: "error",
        });
        return;
      }

      // 2. Carga inicial
      const [vendasInicial, custosInicial, custosEstoqueInicial, veiculosDb, metaDb] = await Promise.all([
        listVendas(),
        listCustos(),
        listCustosEstoque(),
        listVeiculosAtual(),
        getMetaAtual(),
      ]);

      let vendasDb = vendasInicial;
      let custosDb = custosInicial;
      let custosEstoqueDb = custosEstoqueInicial;

      // 3. Detecta "carga falsa" (RLS race condition) e faz retry único após 1s
      const isSuspiciousResult =
        vendasDb.length === 0 && custosDb.length === 0 && veiculosDb.length > 0;
      if (isSuspiciousResult) {
        await new Promise<void>((resolve) => setTimeout(resolve, 1000));
        const [vendasRetry, custosRetry, custosEstoqueRetry] = await Promise.all([
          listVendas(),
          listCustos(),
          listCustosEstoque(),
        ]);
        if (vendasRetry.length > 0 || custosRetry.length > 0 || custosEstoqueRetry.itens.length > 0) {
          console.warn(
            "[inventoryStore] Sessão race detectado — retry recuperou dados de vendas/custos",
          );
          vendasDb = vendasRetry;
          custosDb = custosRetry;
          custosEstoqueDb = custosEstoqueRetry;
        }
      }

      // Filtra lojas ignoradas (config central — ver src/lib/config/lojas-ignoradas.ts)
      const vendasFiltradas = vendasDb.filter((v) => !isLojaIgnorada(v.cod_empresa));
      const veiculosFiltrados = veiculosDb.filter((v) => !isLojaIgnorada(v.cod_empresa));
      // Custos: remove placas que pertencem só a lojas ignoradas (mapeadas via vendasDb original)
      const placasIgnoradas = new Set<string>();
      for (const v of vendasDb) {
        if (isLojaIgnorada(v.cod_empresa) && v.placa) placasIgnoradas.add(v.placa);
      }
      const custosFiltrados = custosDb.filter((c) => !placasIgnoradas.has(c.placa));

      // Custos de estoque: filtra por cod_empresa (vem direto na linha)
      const custosEstoqueFiltrados = custosEstoqueDb.itens.filter((c) => {
        const cod = custosEstoqueDb.codEmpresaPorPlaca[c.placa];
        return !isLojaIgnorada(cod);
      });

      // Processa custos
      const cMap: Record<string, CustoDetalhado> = {};
      for (const c of custosFiltrados) if (c.placa) cMap[c.placa] = c;

      // Processa custos de estoque
      const ceMap: Record<string, CustoEstoqueDetalhado> = {};
      for (const c of custosEstoqueFiltrados) if (c.placa) ceMap[c.placa] = c;

      // Deriva lojas
      const currentLojas = get().lojas;
      const nextLojas = { ...currentLojas };
      for (const v of vendasFiltradas) {
        if (v.empresa_nome && !nextLojas[v.cod_empresa]?.nome) {
          nextLojas[v.cod_empresa] = {
            cod_empresa: v.cod_empresa,
            nome: v.empresa_nome,
            cidade: nextLojas[v.cod_empresa]?.cidade ?? "",
          };
        } else if (!nextLojas[v.cod_empresa]) {
          nextLojas[v.cod_empresa] = { cod_empresa: v.cod_empresa, nome: "", cidade: "" };
        }
      }
      for (const v of veiculosFiltrados) {
        if (!nextLojas[v.cod_empresa]) {
          nextLojas[v.cod_empresa] = { cod_empresa: v.cod_empresa, nome: "", cidade: "" };
        }
      }
      // Garante que lojas ignoradas não fiquem persistidas (mesmo se vieram do localStorage)
      for (const cod of LOJAS_IGNORADAS) {
        delete nextLojas[cod];
      }
      try {
        localStorage.setItem(LOJAS_KEY, JSON.stringify(nextLojas));
      } catch {}

      set({
        vendas: vendasFiltradas,
        vendasMeta: derivarVendasMeta(vendasFiltradas),
        vendasWarnings: [],
        vendedores: derivarVendedores(vendasFiltradas),
        custosPorPlaca: cMap,
        custosMeta: derivarCustosMeta(custosFiltrados.length),
        custosWarnings: [],
        custosEstoquePorPlaca: ceMap,
        custosEstoqueMeta: derivarCustosEstoqueMeta(custosEstoqueFiltrados.length),
        custosEstoqueWarnings: [],
        veiculos: veiculosFiltrados,
        meta: metaDb,
        warnings: [],
        lojas: nextLojas,
        isHydrated: true,
        loadingState: "ready",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ loadError: msg, loadingState: "error" });
    }
  },

  setFromParse: async (result: ParseResult) => {
    // Persistimos o snapshot completo no Supabase (preserva histórico);
    // a filtragem é aplicada apenas em memória/UI.
    await inserirEstoqueSnapshot(result.veiculos, result.meta);

    const veiculosFiltrados = result.veiculos.filter((v) => !isLojaIgnorada(v.cod_empresa));
    const lojasFiltradas = result.lojas.filter((l) => !isLojaIgnorada(l.cod_empresa));

    // Auto-descoberta de lojas
    const currentLojas = get().lojas;
    const merged = { ...currentLojas };
    for (const l of lojasFiltradas) {
      const existing = merged[l.cod_empresa];
      merged[l.cod_empresa] = {
        cod_empresa: l.cod_empresa,
        nome: l.nome || existing?.nome || "",
        cidade: existing?.cidade ?? "",
      };
    }
    for (const v of veiculosFiltrados) {
      if (!merged[v.cod_empresa]) {
        merged[v.cod_empresa] = { cod_empresa: v.cod_empresa, nome: "", cidade: "" };
      }
    }
    for (const cod of LOJAS_IGNORADAS) {
      delete merged[cod];
    }
    try {
      localStorage.setItem(LOJAS_KEY, JSON.stringify(merged));
    } catch {}

    set({
      meta: result.meta,
      veiculos: veiculosFiltrados,
      warnings: result.warnings,
      lojas: merged,
    });
  },

  setVendasFromParse: async (result: VendasParseResult) => {
    const currentVendas = get().vendas;
    const currentVendasMeta = get().vendasMeta;

    // Filtra ANTES do merge — assim store nunca enxerga venda de loja ignorada
    const resultFiltrado: VendasParseResult = {
      ...result,
      vendas: result.vendas.filter((v) => !isLojaIgnorada(v.cod_empresa)),
    };

    // Merge incremental em memória
    const merged = mergeVendas(currentVendas, currentVendasMeta, resultFiltrado);

    // Sobe o lote MERGE no Supabase
    await upsertVendas(merged.vendas);

    // Auto-descoberta de lojas
    const currentLojas = get().lojas;
    const updated = { ...currentLojas };
    for (const v of resultFiltrado.vendas) {
      if (v.empresa_nome && !updated[v.cod_empresa]?.nome) {
        updated[v.cod_empresa] = { cod_empresa: v.cod_empresa, nome: v.empresa_nome, cidade: updated[v.cod_empresa]?.cidade ?? "" };
      } else if (!updated[v.cod_empresa]) {
        updated[v.cod_empresa] = { cod_empresa: v.cod_empresa, nome: v.empresa_nome ?? "", cidade: "" };
      }
    }
    for (const cod of LOJAS_IGNORADAS) {
      delete updated[cod];
    }
    try {
      localStorage.setItem(LOJAS_KEY, JSON.stringify(updated));
    } catch {}

    set({
      vendasMeta: merged.meta,
      vendas: merged.vendas,
      vendasWarnings: merged.warnings,
      vendedores: derivarVendedores(merged.vendas),
      lojas: updated,
    });

    return merged.delta;
  },

  setCustosEstoqueFromParse: async (result: CustosEstoquePdfResult) => {
    // Se a loja do PDF é ignorada, descarta tudo silenciosamente.
    if (isLojaIgnorada(result.meta.cod_empresa)) {
      return { novos: 0, substituidos: 0, mantidos: Object.keys(get().custosEstoquePorPlaca).length };
    }

    const itensFiltrados = result.itens; // PDF cobre 1 loja só — sem necessidade de filtrar por placa
    const existentes = get().custosEstoquePorPlaca;
    const merged: Record<string, CustoEstoqueDetalhado> = { ...existentes };
    let novos = 0;
    let substituidos = 0;
    for (const c of itensFiltrados) {
      if (!c.placa) continue;
      if (merged[c.placa]) substituidos++;
      else novos++;
      merged[c.placa] = c;
    }
    const mantidos = Math.max(0, Object.keys(existentes).length - substituidos);

    // Persiste no Supabase (upsert por placa) — só do lote novo
    await upsertCustosEstoque(itensFiltrados, result.meta.cod_empresa);

    set({
      custosEstoquePorPlaca: merged,
      custosEstoqueMeta: result.meta,
      custosEstoqueWarnings: result.warnings,
    });

    return { novos, substituidos, mantidos };
  },

  setCustosFromParse: async (result: CustosParseResult) => {
    const currentCustos = get().custosPorPlaca;
    const currentCustosMeta = get().custosMeta;

    const merged = mergeCustos(currentCustos, currentCustosMeta, result);

    // Sobe todos os custos no Supabase
    await upsertCustos(Object.values(merged.custosPorPlaca));

    set({
      custosMeta: merged.meta,
      custosPorPlaca: merged.custosPorPlaca,
      custosWarnings: merged.warnings,
    });

    return merged.delta;
  },

  updateLoja: (cod: number, patch: Partial<LojaInfo>) => {
    if (isLojaIgnorada(cod)) return; // loja ignorada — não persiste
    const currentLojas = get().lojas;
    const next = {
      ...currentLojas,
      [cod]: { ...(currentLojas[cod] ?? { cod_empresa: cod, nome: "", cidade: "" }), ...patch, cod_empresa: cod },
    };
    try {
      localStorage.setItem(LOJAS_KEY, JSON.stringify(next));
    } catch {}
    set({ lojas: next });
  },

  removeLoja: (cod: number) => {
    const currentLojas = get().lojas;
    const next = { ...currentLojas };
    delete next[cod];
    try {
      localStorage.setItem(LOJAS_KEY, JSON.stringify(next));
    } catch {}
    set({ lojas: next });
  },

  clear: async () => {
    await clearEstoque();
    set({ meta: null, veiculos: [], warnings: [] });
  },

  clearVendas: async () => {
    await sbClearVendas();
    set({ vendasMeta: null, vendas: [], vendasWarnings: [], vendedores: {} });
  },

  clearCustos: async () => {
    await sbClearCustos();
    set({ custosMeta: null, custosPorPlaca: {}, custosWarnings: [] });
  },

  clearCustosEstoque: async () => {
    await sbClearCustosEstoque();
    set({ custosEstoqueMeta: null, custosEstoquePorPlaca: {}, custosEstoqueWarnings: [] });
  },
}));
