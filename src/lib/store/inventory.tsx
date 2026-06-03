"use client";

import { useEffect, type ReactNode } from "react";
import { useInventoryStore, type LojaInfo, type VendedorInfo, type LoadingState } from "./inventoryStore";

export type { LojaInfo, VendedorInfo, LoadingState };

export function InventoryProvider({ children }: { children: ReactNode }) {
  // Dispara a carga de dados na montagem
  useEffect(() => {
    useInventoryStore.getState().load();
  }, []);

  return <>{children}</>;
}

export function useInventory() {
  return useInventoryStore();
}

export function nomeVendedor(codigo: string | null | undefined, vendedores: Record<string, VendedorInfo>): string {
  if (!codigo) return "—";
  const v = vendedores[codigo];
  return v?.nome?.trim() || codigo;
}

export function nomeOuCodigo(lojas: Record<number, LojaInfo>, cod: number): string {
  const nome = lojas[cod]?.nome?.trim();
  return nome ? nome : `Loja ${cod}`;
}
export type InventoryState = ReturnType<typeof useInventory>;
