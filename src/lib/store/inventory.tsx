"use client";

import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from "react";
import type { ParseResult, VeiculoParsed, SnapshotMeta } from "@/lib/parsers/nbs-xlsx";
import type { VendasParseResult, VendaParsed, VendasSnapshotMeta } from "@/lib/parsers/nbs-vendas-xlsx";
import type { CustosParseResult, CustoDetalhado, CustosMeta } from "@/lib/parsers/nbs-custos-xls";
import { mergeVendas, mergeCustos, type MergeResultVendas, type MergeResultCustos } from "./merge";

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
  /** Custos detalhados indexados por placa. Subiu o relatório de custos? Está aqui. */
  custosPorPlaca: Record<string, CustoDetalhado>;
  custosWarnings: string[];
  setFromParse: (result: ParseResult) => void;
  /** Merge incremental: substitui vendas dentro do período do novo arquivo, mantém o resto. */
  setVendasFromParse: (result: VendasParseResult) => MergeResultVendas["delta"];
  /** Merge incremental: substitui custos por placa, mantém placas não presentes no novo arquivo. */
  setCustosFromParse: (result: CustosParseResult) => MergeResultCustos["delta"];
  updateLoja: (cod: number, patch: Partial<LojaInfo>) => void;
  removeLoja: (cod: number) => void;
  clear: () => void;
  clearVendas: () => void;
  clearCustos: () => void;
  isHydrated: boolean;
};

const INV_KEY = "navesa-mesa:inventory-v1";
const LOJAS_KEY = "navesa-mesa:lojas-v1";
const VENDAS_KEY = "navesa-mesa:vendas-v1";
const VENDEDORES_KEY = "navesa-mesa:vendedores-v1";
const CUSTOS_KEY = "navesa-mesa:custos-v1";

const SEED_LOJAS: Record<number, LojaInfo> = {
  2: { cod_empresa: 2, nome: "NAVESA FORD AEROPORTO", cidade: "Goiânia" },
};

const Ctx = createContext<InventoryState | null>(null);

export function InventoryProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<SnapshotMeta | null>(null);
  const [veiculos, setVeiculos] = useState<VeiculoParsed[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [lojas, setLojas] = useState<Record<number, LojaInfo>>({});
  const [vendasMeta, setVendasMeta] = useState<VendasSnapshotMeta | null>(null);
  const [vendas, setVendas] = useState<VendaParsed[]>([]);
  const [vendasWarnings, setVendasWarnings] = useState<string[]>([]);
  const [vendedores, setVendedores] = useState<Record<string, VendedorInfo>>({});
  const [custosMeta, setCustosMeta] = useState<CustosMeta | null>(null);
  const [custosPorPlaca, setCustosPorPlaca] = useState<Record<string, CustoDetalhado>>({});
  const [custosWarnings, setCustosWarnings] = useState<string[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);

  // Refs pra leitura síncrona durante merge incremental (state pode estar stale dentro de useCallback)
  const vendasRef = useRef<VendaParsed[]>([]);
  const vendasMetaRef = useRef<VendasSnapshotMeta | null>(null);
  const custosRef = useRef<Record<string, CustoDetalhado>>({});
  const custosMetaRef = useRef<CustosMeta | null>(null);

  useEffect(() => {
    try {
      const rawInv = localStorage.getItem(INV_KEY);
      if (rawInv) {
        const parsed = JSON.parse(rawInv) as { meta: SnapshotMeta; veiculos: VeiculoParsed[]; warnings: string[] };
        if (parsed.meta?.data_geracao) parsed.meta.data_geracao = new Date(parsed.meta.data_geracao) as unknown as Date;
        for (const v of parsed.veiculos) {
          if (v.data_entrada) v.data_entrada = new Date(v.data_entrada) as unknown as Date;
        }
        setMeta(parsed.meta);
        setVeiculos(parsed.veiculos);
        setWarnings(parsed.warnings ?? []);
      }
    } catch (err) {
      console.warn("Falha ao restaurar inventário:", err);
    }

    try {
      const rawLojas = localStorage.getItem(LOJAS_KEY);
      if (rawLojas) {
        setLojas(JSON.parse(rawLojas));
      } else {
        setLojas(SEED_LOJAS);
      }
    } catch (err) {
      console.warn("Falha ao restaurar lojas:", err);
      setLojas(SEED_LOJAS);
    }

    try {
      const rawVendedores = localStorage.getItem(VENDEDORES_KEY);
      if (rawVendedores) setVendedores(JSON.parse(rawVendedores));
    } catch (err) {
      console.warn("Falha ao restaurar vendedores:", err);
    }

    try {
      const rawCustos = localStorage.getItem(CUSTOS_KEY);
      if (rawCustos) {
        const parsed = JSON.parse(rawCustos) as { meta: CustosMeta; custosPorPlaca: Record<string, CustoDetalhado>; warnings: string[] };
        if (parsed.meta?.data_geracao) parsed.meta.data_geracao = new Date(parsed.meta.data_geracao) as unknown as Date;
        for (const k of Object.keys(parsed.custosPorPlaca ?? {})) {
          const c = parsed.custosPorPlaca[k];
          if (c.data_fatura) c.data_fatura = new Date(c.data_fatura) as unknown as Date;
          if (c.data_venda) c.data_venda = new Date(c.data_venda) as unknown as Date;
        }
        setCustosMeta(parsed.meta);
        custosMetaRef.current = parsed.meta;
        setCustosPorPlaca(parsed.custosPorPlaca ?? {});
        custosRef.current = parsed.custosPorPlaca ?? {};
        setCustosWarnings(parsed.warnings ?? []);
      }
    } catch (err) {
      console.warn("Falha ao restaurar custos:", err);
    }

    try {
      const rawVendas = localStorage.getItem(VENDAS_KEY);
      if (rawVendas) {
        const parsed = JSON.parse(rawVendas) as { meta: VendasSnapshotMeta; vendas: VendaParsed[]; warnings: string[] };
        if (parsed.meta) {
          if (parsed.meta.data_geracao) parsed.meta.data_geracao = new Date(parsed.meta.data_geracao) as unknown as Date;
          if (parsed.meta.periodo_inicio) parsed.meta.periodo_inicio = new Date(parsed.meta.periodo_inicio) as unknown as Date;
          if (parsed.meta.periodo_fim) parsed.meta.periodo_fim = new Date(parsed.meta.periodo_fim) as unknown as Date;
        }
        for (const v of parsed.vendas) {
          if (v.data_venda) v.data_venda = new Date(v.data_venda) as unknown as Date;
          if (v.data_faturamento) v.data_faturamento = new Date(v.data_faturamento) as unknown as Date;
          if (v.data_entrada) v.data_entrada = new Date(v.data_entrada) as unknown as Date;
        }
        setVendasMeta(parsed.meta);
        vendasMetaRef.current = parsed.meta;
        setVendas(parsed.vendas);
        vendasRef.current = parsed.vendas;
        setVendasWarnings(parsed.warnings ?? []);
      }
    } catch (err) {
      console.warn("Falha ao restaurar vendas:", err);
    }

    setIsHydrated(true);
  }, []);

  const persistLojas = useCallback((next: Record<number, LojaInfo>) => {
    setLojas(next);
    try {
      localStorage.setItem(LOJAS_KEY, JSON.stringify(next));
    } catch (err) {
      console.warn("Falha ao persistir lojas:", err);
    }
  }, []);

  const setFromParse = useCallback(
    (result: ParseResult) => {
      setMeta(result.meta);
      setVeiculos(result.veiculos);
      setWarnings(result.warnings);
      try {
        localStorage.setItem(INV_KEY, JSON.stringify(result));
      } catch (err) {
        console.warn("Falha ao persistir inventário:", err);
      }

      setLojas((current) => {
        const merged = { ...current };
        // 1) Lojas com nome vindo do XLSX (col Empresa 401) — fonte da verdade do NBS
        for (const l of result.lojas) {
          const existing = merged[l.cod_empresa];
          merged[l.cod_empresa] = {
            cod_empresa: l.cod_empresa,
            nome: l.nome || existing?.nome || "",
            cidade: existing?.cidade ?? "",
          };
        }
        // 2) Garantia: qualquer cód em veículos sem entrada em lojas
        for (const v of result.veiculos) {
          if (!merged[v.cod_empresa]) {
            merged[v.cod_empresa] = { cod_empresa: v.cod_empresa, nome: "", cidade: "" };
          }
        }
        try {
          localStorage.setItem(LOJAS_KEY, JSON.stringify(merged));
        } catch (err) {
          console.warn("Falha ao persistir lojas (merge):", err);
        }
        return merged;
      });
    },
    [],
  );

  const updateLoja = useCallback(
    (cod: number, patch: Partial<LojaInfo>) => {
      persistLojas({
        ...lojas,
        [cod]: { ...(lojas[cod] ?? { cod_empresa: cod, nome: "", cidade: "" }), ...patch, cod_empresa: cod },
      });
    },
    [lojas, persistLojas],
  );

  const removeLoja = useCallback(
    (cod: number) => {
      const next = { ...lojas };
      delete next[cod];
      persistLojas(next);
    },
    [lojas, persistLojas],
  );

  const clear = useCallback(() => {
    setMeta(null);
    setVeiculos([]);
    setWarnings([]);
    localStorage.removeItem(INV_KEY);
  }, []);

  const setVendasFromParse = useCallback((result: VendasParseResult) => {
    // Merge incremental: substitui vendas dentro do período do novo arquivo, mantém o resto
    const merged = mergeVendas(vendasRef.current, vendasMetaRef.current, result);

    setVendasMeta(merged.meta);
    vendasMetaRef.current = merged.meta;
    setVendas(merged.vendas);
    vendasRef.current = merged.vendas;
    setVendasWarnings(merged.warnings);
    try {
      localStorage.setItem(VENDAS_KEY, JSON.stringify({
        meta: merged.meta,
        vendas: merged.vendas,
        warnings: merged.warnings,
      }));
    } catch (err) {
      console.warn("Falha ao persistir vendas:", err);
    }

    // Popular mapping de vendedores apenas com as vendas do upload novo
    setVendedores((current) => {
      const updated = { ...current };
      for (const v of result.vendas) {
        if (v.vendedor_codigo && v.vendedor_nome) {
          updated[v.vendedor_codigo] = {
            codigo: v.vendedor_codigo,
            nome: v.vendedor_nome,
            cpf: v.vendedor_cpf,
          };
        }
      }
      try {
        localStorage.setItem(VENDEDORES_KEY, JSON.stringify(updated));
      } catch {}
      return updated;
    });

    // Merge lojas se vierem novas nas vendas
    setLojas((current) => {
      const updated = { ...current };
      for (const v of result.vendas) {
        if (v.empresa_nome && !updated[v.cod_empresa]?.nome) {
          updated[v.cod_empresa] = { cod_empresa: v.cod_empresa, nome: v.empresa_nome, cidade: updated[v.cod_empresa]?.cidade ?? "" };
        } else if (!updated[v.cod_empresa]) {
          updated[v.cod_empresa] = { cod_empresa: v.cod_empresa, nome: v.empresa_nome ?? "", cidade: "" };
        }
      }
      try {
        localStorage.setItem(LOJAS_KEY, JSON.stringify(updated));
      } catch {}
      return updated;
    });

    return merged.delta;
  }, []);

  const clearVendas = useCallback(() => {
    setVendasMeta(null);
    vendasMetaRef.current = null;
    setVendas([]);
    vendasRef.current = [];
    setVendasWarnings([]);
    localStorage.removeItem(VENDAS_KEY);
  }, []);

  const setCustosFromParse = useCallback((result: CustosParseResult) => {
    // Merge incremental: substitui custos por placa, mantém placas não presentes no novo arquivo
    const merged = mergeCustos(custosRef.current, custosMetaRef.current, result);

    setCustosMeta(merged.meta);
    custosMetaRef.current = merged.meta;
    setCustosPorPlaca(merged.custosPorPlaca);
    custosRef.current = merged.custosPorPlaca;
    setCustosWarnings(merged.warnings);
    try {
      localStorage.setItem(CUSTOS_KEY, JSON.stringify({
        meta: merged.meta,
        custosPorPlaca: merged.custosPorPlaca,
        warnings: merged.warnings,
      }));
    } catch (err) {
      console.warn("Falha ao persistir custos:", err);
    }
    return merged.delta;
  }, []);

  const clearCustos = useCallback(() => {
    setCustosMeta(null);
    custosMetaRef.current = null;
    setCustosPorPlaca({});
    custosRef.current = {};
    setCustosWarnings([]);
    localStorage.removeItem(CUSTOS_KEY);
  }, []);

  return (
    <Ctx.Provider value={{
      meta, veiculos, warnings, lojas, vendedores,
      vendasMeta, vendas, vendasWarnings,
      custosMeta, custosPorPlaca, custosWarnings,
      setFromParse, setVendasFromParse, setCustosFromParse,
      updateLoja, removeLoja,
      clear, clearVendas, clearCustos,
      isHydrated,
    }}>
      {children}
    </Ctx.Provider>
  );
}

/** Resolve um código de vendedor (ex: "MPRUDENTE") para o nome completo, se conhecido. */
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
