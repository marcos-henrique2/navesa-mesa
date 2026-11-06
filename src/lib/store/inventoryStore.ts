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
import { normalizarPlaca } from "@/lib/utils/placa";
import {
  prepararDatasets,
  derivarVendedores,
  type LojaInfo,
  type VendedorInfo,
} from "@/lib/data/preparar-datasets";

export type { LojaInfo, VendedorInfo };

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

      // Filtragem + montagem: função pura compartilhada com o cérebro (src/lib/data/preparar-datasets.ts)
      const ds = prepararDatasets(
        {
          vendas: vendasDb,
          veiculos: veiculosDb,
          custos: custosDb,
          custosEstoque: custosEstoqueDb,
          meta: metaDb,
        },
        get().lojas,
      );
      try {
        localStorage.setItem(LOJAS_KEY, JSON.stringify(ds.lojas));
      } catch {}

      set({
        vendas: ds.vendas,
        vendasMeta: ds.vendasMeta,
        vendasWarnings: [],
        vendedores: ds.vendedores,
        custosPorPlaca: ds.custosPorPlaca,
        custosMeta: ds.custosMeta,
        custosWarnings: [],
        custosEstoquePorPlaca: ds.custosEstoquePorPlaca,
        custosEstoqueMeta: ds.custosEstoqueMeta,
        custosEstoqueWarnings: [],
        veiculos: ds.veiculos,
        meta: ds.meta,
        warnings: [],
        lojas: ds.lojas,
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
      const chave = normalizarPlaca(c.placa);
      if (merged[chave]) substituidos++;
      else novos++;
      merged[chave] = c;
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
