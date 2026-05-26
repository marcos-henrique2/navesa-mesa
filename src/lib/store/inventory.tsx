"use client";

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import type { ParseResult, VeiculoParsed, SnapshotMeta } from "@/lib/parsers/nbs-xlsx";

type InventoryState = {
  meta: SnapshotMeta | null;
  veiculos: VeiculoParsed[];
  warnings: string[];
  setFromParse: (result: ParseResult) => void;
  clear: () => void;
  isHydrated: boolean;
};

const STORAGE_KEY = "navesa-mesa:inventory-v1";

const Ctx = createContext<InventoryState | null>(null);

export function InventoryProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<SnapshotMeta | null>(null);
  const [veiculos, setVeiculos] = useState<VeiculoParsed[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { meta: SnapshotMeta; veiculos: VeiculoParsed[]; warnings: string[] };
        if (parsed.meta?.data_geracao) {
          parsed.meta.data_geracao = new Date(parsed.meta.data_geracao) as unknown as Date;
        }
        for (const v of parsed.veiculos) {
          if (v.data_entrada) v.data_entrada = new Date(v.data_entrada) as unknown as Date;
        }
        setMeta(parsed.meta);
        setVeiculos(parsed.veiculos);
        setWarnings(parsed.warnings ?? []);
      }
    } catch (err) {
      console.warn("Falha ao restaurar inventário do localStorage:", err);
    } finally {
      setIsHydrated(true);
    }
  }, []);

  const setFromParse = useCallback((result: ParseResult) => {
    setMeta(result.meta);
    setVeiculos(result.veiculos);
    setWarnings(result.warnings);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(result));
    } catch (err) {
      console.warn("Falha ao persistir no localStorage (pode ser tamanho):", err);
    }
  }, []);

  const clear = useCallback(() => {
    setMeta(null);
    setVeiculos([]);
    setWarnings([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return (
    <Ctx.Provider value={{ meta, veiculos, warnings, setFromParse, clear, isHydrated }}>
      {children}
    </Ctx.Provider>
  );
}

export function useInventory() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useInventory precisa estar dentro de <InventoryProvider>");
  return ctx;
}
