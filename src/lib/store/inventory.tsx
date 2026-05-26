"use client";

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import type { ParseResult, VeiculoParsed, SnapshotMeta } from "@/lib/parsers/nbs-xlsx";
import type { VendasParseResult, VendaParsed, VendasSnapshotMeta } from "@/lib/parsers/nbs-vendas-xlsx";

export type LojaInfo = {
  cod_empresa: number;
  nome: string;
  cidade: string;
};

type InventoryState = {
  meta: SnapshotMeta | null;
  veiculos: VeiculoParsed[];
  warnings: string[];
  lojas: Record<number, LojaInfo>;
  vendasMeta: VendasSnapshotMeta | null;
  vendas: VendaParsed[];
  vendasWarnings: string[];
  setFromParse: (result: ParseResult) => void;
  setVendasFromParse: (result: VendasParseResult) => void;
  updateLoja: (cod: number, patch: Partial<LojaInfo>) => void;
  removeLoja: (cod: number) => void;
  clear: () => void;
  clearVendas: () => void;
  isHydrated: boolean;
};

const INV_KEY = "navesa-mesa:inventory-v1";
const LOJAS_KEY = "navesa-mesa:lojas-v1";
const VENDAS_KEY = "navesa-mesa:vendas-v1";

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
  const [isHydrated, setIsHydrated] = useState(false);

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
        setVendas(parsed.vendas);
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
    setVendasMeta(result.meta);
    setVendas(result.vendas);
    setVendasWarnings(result.warnings);
    try {
      localStorage.setItem(VENDAS_KEY, JSON.stringify(result));
    } catch (err) {
      console.warn("Falha ao persistir vendas:", err);
    }
    // Merge lojas se vierem novas nas vendas
    setLojas((current) => {
      const merged = { ...current };
      for (const v of result.vendas) {
        if (v.empresa_nome && !merged[v.cod_empresa]?.nome) {
          merged[v.cod_empresa] = { cod_empresa: v.cod_empresa, nome: v.empresa_nome, cidade: merged[v.cod_empresa]?.cidade ?? "" };
        } else if (!merged[v.cod_empresa]) {
          merged[v.cod_empresa] = { cod_empresa: v.cod_empresa, nome: v.empresa_nome ?? "", cidade: "" };
        }
      }
      try {
        localStorage.setItem(LOJAS_KEY, JSON.stringify(merged));
      } catch {}
      return merged;
    });
  }, []);

  const clearVendas = useCallback(() => {
    setVendasMeta(null);
    setVendas([]);
    setVendasWarnings([]);
    localStorage.removeItem(VENDAS_KEY);
  }, []);

  return (
    <Ctx.Provider value={{
      meta, veiculos, warnings, lojas,
      vendasMeta, vendas, vendasWarnings,
      setFromParse, setVendasFromParse,
      updateLoja, removeLoja,
      clear, clearVendas,
      isHydrated,
    }}>
      {children}
    </Ctx.Provider>
  );
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
