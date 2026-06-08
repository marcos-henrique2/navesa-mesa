"use client";

/**
 * CRUD + cache reativo da tabela veiculos_flags — flags operacionais por veículo.
 *
 * Equivalente às checkboxes "Em Promoção" / "Brinde em Acessórios" do NBS
 * Markup de Venda. Não afeta preço/custo/classificação — é apenas sinalização
 * pra ajudar o comercial saber quais carros têm condição especial.
 *
 * Cache em memória (similar a cautelar/simulador-preco) com hook `useFlagsTodas()`.
 * Escritas otimistas: aplicam no cache + dispatch event, persistem em background.
 */

import { useSyncExternalStore } from "react";
import { getSupabase } from "./supabase";

export type FlagsVeiculo = {
  chassi: string;
  em_promocao: boolean;
  brinde_acessorios: boolean;
  observacao_brinde: string | null;
  atualizado_em: string;
};

export type SetFlagsArgs = {
  chassi: string;
  emPromocao: boolean;
  brindeAcessorios: boolean;
  observacaoBrinde: string | null;
};

// ──────────────────────────────────────────────────────────────────────────────
// Cache em memória
// ──────────────────────────────────────────────────────────────────────────────

const EVT = "navesa-mesa:flags-veiculo-updated";

let cachedMap: Record<string, FlagsVeiculo> = {};
let cacheSnapshot: Record<string, FlagsVeiculo> = cachedMap;
let loadingPromise: Promise<void> | null = null;
let loaded = false;

function notify() {
  cacheSnapshot = { ...cachedMap };
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVT));
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    try {
      const all = await listAllFlags();
      cachedMap = all;
      loaded = true;
      cacheSnapshot = { ...cachedMap };
      if (typeof window !== "undefined") window.dispatchEvent(new Event(EVT));
    } catch (err) {
      console.error("Falha ao carregar flags do Supabase:", err);
    } finally {
      loadingPromise = null;
    }
  })();
  return loadingPromise;
}

// ──────────────────────────────────────────────────────────────────────────────
// API de servidor (CRUD)
// ──────────────────────────────────────────────────────────────────────────────

export async function getFlagsVeiculo(chassi: string): Promise<FlagsVeiculo | null> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("veiculos_flags")
    .select("*")
    .eq("chassi", chassi)
    .maybeSingle();
  if (error) throw new Error(`flags-veiculo.get: ${error.message}`);
  return (data as FlagsVeiculo | null) ?? null;
}

export async function setFlagsVeiculo(args: SetFlagsArgs): Promise<FlagsVeiculo> {
  const sb = getSupabase();
  const payload = {
    chassi: args.chassi,
    em_promocao: args.emPromocao,
    brinde_acessorios: args.brindeAcessorios,
    observacao_brinde: args.observacaoBrinde,
    atualizado_em: new Date().toISOString(),
  };
  const { data, error } = await sb
    .from("veiculos_flags")
    .upsert(payload, { onConflict: "chassi" })
    .select("*")
    .single();
  if (error) throw new Error(`flags-veiculo.set: ${error.message}`);
  const row = data as FlagsVeiculo;

  // Atualiza cache reativo — se ambas as flags forem false, remove do cache
  // (porque listAllFlags só traz as ativas).
  if (row.em_promocao || row.brinde_acessorios) {
    cachedMap[row.chassi] = row;
  } else {
    delete cachedMap[row.chassi];
  }
  notify();

  return row;
}

/** Lista TODAS as flags ativas (em_promocao OU brinde_acessorios) pra alimentar badges no estoque. */
export async function listAllFlags(): Promise<Record<string, FlagsVeiculo>> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("veiculos_flags")
    .select("*")
    .or("em_promocao.eq.true,brinde_acessorios.eq.true");
  if (error) throw new Error(`flags-veiculo.listAll: ${error.message}`);
  const out: Record<string, FlagsVeiculo> = {};
  for (const r of (data ?? []) as FlagsVeiculo[]) out[r.chassi] = r;
  return out;
}

// ──────────────────────────────────────────────────────────────────────────────
// Hook React
// ──────────────────────────────────────────────────────────────────────────────

const EMPTY: Record<string, FlagsVeiculo> = {};

function readSnapshot(): Record<string, FlagsVeiculo> {
  return cacheSnapshot;
}

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  ensureLoaded();
  const onLocal = () => callback();
  window.addEventListener(EVT, onLocal);
  return () => window.removeEventListener(EVT, onLocal);
}

function getServerSnapshot(): Record<string, FlagsVeiculo> {
  return EMPTY;
}

/** Hook reativo: mapa de flags ativas por chassi. */
export function useFlagsTodas(): Record<string, FlagsVeiculo> {
  return useSyncExternalStore(subscribe, readSnapshot, getServerSnapshot);
}
