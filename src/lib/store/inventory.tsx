"use client";

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import type { ParseResult, VeiculoParsed, SnapshotMeta } from "@/lib/parsers/nbs-xlsx";

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
  setFromParse: (result: ParseResult) => void;
  updateLoja: (cod: number, patch: Partial<LojaInfo>) => void;
  removeLoja: (cod: number) => void;
  clear: () => void;
  isHydrated: boolean;
};

const INV_KEY = "navesa-mesa:inventory-v1";
const LOJAS_KEY = "navesa-mesa:lojas-v1";

const SEED_LOJAS: Record<number, LojaInfo> = {
  2: { cod_empresa: 2, nome: "NAVESA FORD AEROPORTO", cidade: "Goiânia" },
};

const Ctx = createContext<InventoryState | null>(null);

export function InventoryProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<SnapshotMeta | null>(null);
  const [veiculos, setVeiculos] = useState<VeiculoParsed[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [lojas, setLojas] = useState<Record<number, LojaInfo>>({});
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

  return (
    <Ctx.Provider value={{ meta, veiculos, warnings, lojas, setFromParse, updateLoja, removeLoja, clear, isHydrated }}>
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
