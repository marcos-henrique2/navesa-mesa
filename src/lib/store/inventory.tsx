"use client";
/* eslint-disable react-hooks/set-state-in-effect --
 * Hidratação assíncrona do Supabase: o store precisa fazer setState dentro de
 * useEffect pra sincronizar React com fonte externa (banco). É o padrão
 * idiomático pra esse caso (data fetching → React state) e a regra é
 * conservadora demais aqui.
 */

import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from "react";
import type { ParseResult, VeiculoParsed, SnapshotMeta } from "@/lib/parsers/nbs-xlsx";
import type { VendasParseResult, VendaParsed, VendasSnapshotMeta } from "@/lib/parsers/nbs-vendas-xlsx";
import type { CustosParseResult, CustoDetalhado, CustosMeta } from "@/lib/parsers/nbs-custos-xls";
import { mergeVendas, mergeCustos, type MergeResultVendas, type MergeResultCustos } from "./merge";
import { listVendas, upsertVendas, clearVendas as sbClearVendas } from "@/lib/data/vendas";
import { listCustos, upsertCustos, clearCustos as sbClearCustos } from "@/lib/data/custos";
import { listVeiculosAtual, getMetaAtual, inserirEstoqueSnapshot, clearEstoque } from "@/lib/data/veiculos";

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

type InventoryState = {
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
  setFromParse: (result: ParseResult) => Promise<void>;
  setVendasFromParse: (result: VendasParseResult) => Promise<MergeResultVendas["delta"]>;
  setCustosFromParse: (result: CustosParseResult) => Promise<MergeResultCustos["delta"]>;
  updateLoja: (cod: number, patch: Partial<LojaInfo>) => void;
  removeLoja: (cod: number) => void;
  clear: () => Promise<void>;
  clearVendas: () => Promise<void>;
  clearCustos: () => Promise<void>;
  isHydrated: boolean;
  loadingState: LoadingState;
  loadError: string | null;
  retry: () => void;
};

// ─── Lojas continuam em localStorage (edição manual + auto-descoberta) ───
const LOJAS_KEY = "navesa-mesa:lojas-v1";
const SEED_LOJAS: Record<number, LojaInfo> = {
  2: { cod_empresa: 2, nome: "NAVESA FORD AEROPORTO", cidade: "Goiânia" },
};

const Ctx = createContext<InventoryState | null>(null);

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

export function InventoryProvider({ children }: { children: ReactNode }) {
  // Estoque
  const [meta, setMeta] = useState<SnapshotMeta | null>(null);
  const [veiculos, setVeiculos] = useState<VeiculoParsed[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  // Vendas
  const [vendasMeta, setVendasMeta] = useState<VendasSnapshotMeta | null>(null);
  const [vendas, setVendas] = useState<VendaParsed[]>([]);
  const [vendasWarnings, setVendasWarnings] = useState<string[]>([]);
  // Custos
  const [custosMeta, setCustosMeta] = useState<CustosMeta | null>(null);
  const [custosPorPlaca, setCustosPorPlaca] = useState<Record<string, CustoDetalhado>>({});
  const [custosWarnings, setCustosWarnings] = useState<string[]>([]);
  // Auxiliares
  const [lojas, setLojas] = useState<Record<number, LojaInfo>>({});
  const [vendedores, setVendedores] = useState<Record<string, VendedorInfo>>({});
  // Estado de carregamento
  const [loadingState, setLoadingState] = useState<LoadingState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Refs pra leitura síncrona durante merge incremental (state pode estar stale dentro de useCallback)
  const vendasRef = useRef<VendaParsed[]>([]);
  const vendasMetaRef = useRef<VendasSnapshotMeta | null>(null);
  const custosRef = useRef<Record<string, CustoDetalhado>>({});
  const custosMetaRef = useRef<CustosMeta | null>(null);

  // Lojas (localStorage)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LOJAS_KEY);
      if (raw) setLojas(JSON.parse(raw));
      else setLojas(SEED_LOJAS);
    } catch {
      setLojas(SEED_LOJAS);
    }
  }, []);

  // Carrega dados do Supabase
  useEffect(() => {
    let cancelado = false;
    setLoadingState("loading");
    setLoadError(null);

    (async () => {
      try {
        const [vendasDb, custosDb, veiculosDb, metaDb] = await Promise.all([
          listVendas(),
          listCustos(),
          listVeiculosAtual(),
          getMetaAtual(),
        ]);
        if (cancelado) return;

        // Vendas
        setVendas(vendasDb);
        vendasRef.current = vendasDb;
        const vMeta = derivarVendasMeta(vendasDb);
        setVendasMeta(vMeta);
        vendasMetaRef.current = vMeta;
        setVendasWarnings([]);
        setVendedores(derivarVendedores(vendasDb));

        // Custos
        const cMap: Record<string, CustoDetalhado> = {};
        for (const c of custosDb) if (c.placa) cMap[c.placa] = c;
        setCustosPorPlaca(cMap);
        custosRef.current = cMap;
        setCustosMeta(derivarCustosMeta(custosDb.length));
        custosMetaRef.current = derivarCustosMeta(custosDb.length);
        setCustosWarnings([]);

        // Estoque
        setVeiculos(veiculosDb);
        setMeta(metaDb);
        setWarnings([]);

        // Lojas: auto-descoberta a partir de vendas/veículos
        setLojas((current) => {
          const next = { ...current };
          for (const v of vendasDb) {
            if (v.empresa_nome && !next[v.cod_empresa]?.nome) {
              next[v.cod_empresa] = {
                cod_empresa: v.cod_empresa,
                nome: v.empresa_nome,
                cidade: next[v.cod_empresa]?.cidade ?? "",
              };
            } else if (!next[v.cod_empresa]) {
              next[v.cod_empresa] = { cod_empresa: v.cod_empresa, nome: "", cidade: "" };
            }
          }
          for (const v of veiculosDb) {
            if (!next[v.cod_empresa]) {
              next[v.cod_empresa] = { cod_empresa: v.cod_empresa, nome: "", cidade: "" };
            }
          }
          try { localStorage.setItem(LOJAS_KEY, JSON.stringify(next)); } catch {}
          return next;
        });

        setLoadingState("ready");
      } catch (err) {
        if (cancelado) return;
        const msg = err instanceof Error ? err.message : String(err);
        setLoadError(msg);
        setLoadingState("error");
      }
    })();

    return () => { cancelado = true; };
  }, [reloadKey]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  const persistLojas = useCallback((next: Record<number, LojaInfo>) => {
    setLojas(next);
    try { localStorage.setItem(LOJAS_KEY, JSON.stringify(next)); } catch {}
  }, []);

  // ─── Setters (agora assíncronos, escrevem no Supabase) ──────────────────
  const setFromParse = useCallback(async (result: ParseResult) => {
    // Cria novo snapshot no Supabase
    await inserirEstoqueSnapshot(result.veiculos, result.meta);

    // Atualiza estado local
    setMeta(result.meta);
    setVeiculos(result.veiculos);
    setWarnings(result.warnings);

    // Auto-descoberta de lojas
    setLojas((current) => {
      const merged = { ...current };
      for (const l of result.lojas) {
        const existing = merged[l.cod_empresa];
        merged[l.cod_empresa] = {
          cod_empresa: l.cod_empresa,
          nome: l.nome || existing?.nome || "",
          cidade: existing?.cidade ?? "",
        };
      }
      for (const v of result.veiculos) {
        if (!merged[v.cod_empresa]) {
          merged[v.cod_empresa] = { cod_empresa: v.cod_empresa, nome: "", cidade: "" };
        }
      }
      try { localStorage.setItem(LOJAS_KEY, JSON.stringify(merged)); } catch {}
      return merged;
    });
  }, []);

  const setVendasFromParse = useCallback(async (result: VendasParseResult) => {
    // Merge incremental em memória (mesmo algoritmo do localStorage)
    const merged = mergeVendas(vendasRef.current, vendasMetaRef.current, result);

    // Sobe o lote MERGE no Supabase (upsert por chassi)
    await upsertVendas(merged.vendas);

    // Atualiza estado
    setVendasMeta(merged.meta);
    vendasMetaRef.current = merged.meta;
    setVendas(merged.vendas);
    vendasRef.current = merged.vendas;
    setVendasWarnings(merged.warnings);
    setVendedores(derivarVendedores(merged.vendas));

    // Auto-descoberta de lojas
    setLojas((current) => {
      const updated = { ...current };
      for (const v of result.vendas) {
        if (v.empresa_nome && !updated[v.cod_empresa]?.nome) {
          updated[v.cod_empresa] = { cod_empresa: v.cod_empresa, nome: v.empresa_nome, cidade: updated[v.cod_empresa]?.cidade ?? "" };
        } else if (!updated[v.cod_empresa]) {
          updated[v.cod_empresa] = { cod_empresa: v.cod_empresa, nome: v.empresa_nome ?? "", cidade: "" };
        }
      }
      try { localStorage.setItem(LOJAS_KEY, JSON.stringify(updated)); } catch {}
      return updated;
    });

    return merged.delta;
  }, []);

  const setCustosFromParse = useCallback(async (result: CustosParseResult) => {
    const merged = mergeCustos(custosRef.current, custosMetaRef.current, result);

    // Sobe TODOS os custos (upsert por placa) — vai sobrescrever os que existirem
    await upsertCustos(Object.values(merged.custosPorPlaca));

    setCustosMeta(merged.meta);
    custosMetaRef.current = merged.meta;
    setCustosPorPlaca(merged.custosPorPlaca);
    custosRef.current = merged.custosPorPlaca;
    setCustosWarnings(merged.warnings);

    return merged.delta;
  }, []);

  const clear = useCallback(async () => {
    await clearEstoque();
    setMeta(null);
    setVeiculos([]);
    setWarnings([]);
  }, []);

  const clearVendas = useCallback(async () => {
    await sbClearVendas();
    setVendasMeta(null);
    vendasMetaRef.current = null;
    setVendas([]);
    vendasRef.current = [];
    setVendasWarnings([]);
    setVendedores({});
  }, []);

  const clearCustos = useCallback(async () => {
    await sbClearCustos();
    setCustosMeta(null);
    custosMetaRef.current = null;
    setCustosPorPlaca({});
    custosRef.current = {};
    setCustosWarnings([]);
  }, []);

  const updateLoja = useCallback((cod: number, patch: Partial<LojaInfo>) => {
    persistLojas({
      ...lojas,
      [cod]: { ...(lojas[cod] ?? { cod_empresa: cod, nome: "", cidade: "" }), ...patch, cod_empresa: cod },
    });
  }, [lojas, persistLojas]);

  const removeLoja = useCallback((cod: number) => {
    const next = { ...lojas };
    delete next[cod];
    persistLojas(next);
  }, [lojas, persistLojas]);

  return (
    <Ctx.Provider value={{
      meta, veiculos, warnings, lojas, vendedores,
      vendasMeta, vendas, vendasWarnings,
      custosMeta, custosPorPlaca, custosWarnings,
      setFromParse, setVendasFromParse, setCustosFromParse,
      updateLoja, removeLoja,
      clear, clearVendas, clearCustos,
      isHydrated: loadingState === "ready",
      loadingState, loadError, retry,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function nomeVendedor(codigo: string | null | undefined, vendedores: Record<string, VendedorInfo>): string {
  if (!codigo) return "—";
  const v = vendedores[codigo];
  return v?.nome?.trim() || codigo;
}

export function useInventory() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useInventory precisa estar dentro de <InventoryProvider>");
  return ctx;
}

export function nomeOuCodigo(lojas: Record<number, LojaInfo>, cod: number): string {
  const nome = lojas[cod]?.nome?.trim();
  return nome ? nome : `Loja ${cod}`;
}
