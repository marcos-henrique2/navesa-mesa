"use client";

/**
 * SNAPSHOTS HISTÓRICOS — fotos do estado do negócio ao longo do tempo.
 *
 * Cada snapshot guarda só os KPIs agregados (não os dados crus) — leve.
 * Permite ver evolução: margem subiu/caiu? estoque parado diminuiu?
 *
 * Dedup por dia: uma foto por data (a mais recente do dia sobrescreve).
 * Storage: Supabase (tabela kpi_snapshots). Cache em memória + evento pra UI reativa.
 */

import type { VendaParsed } from "@/lib/parsers/nbs-vendas-xlsx";
import type { CustoDetalhado } from "@/lib/parsers/nbs-custos-xls";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";
import { sumarioGlobal } from "@/lib/analytics/insights";
import { classificarPatio } from "@/lib/inventory/status";
import { hojeLocal } from "@/lib/utils/data-local";
import {
  listKpiSnapshots,
  upsertKpiSnapshot,
  deleteKpiSnapshot,
} from "@/lib/data/kpi-snapshots";

const EVT = "navesa-mesa:snapshots-updated";

export type Snapshot = {
  /** ID = data YYYY-MM-DD (dedup por dia). */
  id: string;
  capturadoEm: string; // ISO completo
  vendas: {
    qt: number;
    faturamento: number;
    custo: number;
    margem: number;
    margemPct: number;
    ganhosIndiretos: number;
    margemSemBonus: number;
    periodoInicio: string | null;
    periodoFim: string | null;
  } | null;
  estoque: {
    totalCarros: number;
    custoTotal: number;
    disponivelQt: number;
    disponivelCusto: number;
    preparacaoQt: number;
    preparacaoCusto: number;
    parados180Qt: number;
    parados180Custo: number;
  } | null;
};

// ───── Cache em memória ─────────────────────────────────────────────────────

let cached: Snapshot[] = [];
let cacheSnapshot: Snapshot[] = cached;
let loaded = false;
let loadingPromise: Promise<void> | null = null;

function notify() {
  cacheSnapshot = [...cached];
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVT));
}

export async function ensureSnapshotsLoaded(): Promise<void> {
  if (loaded) return;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    try {
      cached = await listKpiSnapshots();
      loaded = true;
      notify();
    } catch (err) {
      console.error("Falha ao carregar snapshots do Supabase:", err);
      loaded = true;
    } finally {
      loadingPromise = null;
    }
  })();
  return loadingPromise;
}

/**
 * Retorna a lista cacheada. Tipo `readonly` previne mutação acidental do cache
 * (.push, .sort in-place, etc.) — consumidores devem clonar antes de modificar.
 */
export function getCachedSnapshots(): readonly Snapshot[] {
  return cacheSnapshot;
}

/**
 * ID do snapshot no formato YYYY-MM-DD usando a data LOCAL do navegador.
 * Ver `hojeLocal` — toISOString().slice(0,10) é UTC e quebra o dedup-por-dia
 * pra fuso negativo (SP UTC−3 depois das 21h gera id do dia seguinte).
 */
const idDoDiaLocal = hojeLocal;

/** Monta um snapshot a partir do estado atual (não salva). */
export function capturarSnapshot(
  vendas: VendaParsed[],
  custosPorPlaca: Record<string, CustoDetalhado>,
  veiculos: VeiculoParsed[],
): Snapshot {
  const hoje = new Date();
  const id = idDoDiaLocal(hoje);

  let vendasSnap: Snapshot["vendas"] = null;
  if (vendas.length > 0) {
    const s = sumarioGlobal(vendas, custosPorPlaca);
    // período: min/max das datas de venda
    let ini: number | null = null, fim: number | null = null;
    for (const v of vendas) {
      if (!v.data_venda) continue;
      const t = new Date(v.data_venda).getTime();
      if (ini == null || t < ini) ini = t;
      if (fim == null || t > fim) fim = t;
    }
    vendasSnap = {
      qt: s.qt,
      faturamento: s.faturamento,
      custo: s.custo,
      margem: s.margem,
      margemPct: s.margemPct,
      ganhosIndiretos: s.ganhosIndiretos,
      margemSemBonus: s.margemSemBonus,
      periodoInicio: ini ? new Date(ini).toISOString() : null,
      periodoFim: fim ? new Date(fim).toISOString() : null,
    };
  }

  let estoqueSnap: Snapshot["estoque"] = null;
  if (veiculos.length > 0) {
    let custoTotal = 0;
    let dispQt = 0, dispCusto = 0;
    let prepQt = 0, prepCusto = 0;
    let p180Qt = 0, p180Custo = 0;
    for (const v of veiculos) {
      const custo = v.valor_aquisicao ?? 0;
      custoTotal += custo;
      const st = classificarPatio(v.patio);
      if (st === "disponivel") {
        dispQt++;
        dispCusto += custo;
      } else if (st === "preparacao") {
        prepQt++;
        prepCusto += custo;
      }
      if ((v.dias_patio ?? 0) > 180) {
        p180Qt++;
        p180Custo += custo;
      }
    }
    estoqueSnap = {
      totalCarros: veiculos.length,
      custoTotal,
      disponivelQt: dispQt,
      disponivelCusto: dispCusto,
      preparacaoQt: prepQt,
      preparacaoCusto: prepCusto,
      parados180Qt: p180Qt,
      parados180Custo: p180Custo,
    };
  }

  return { id, capturadoEm: hoje.toISOString(), vendas: vendasSnap, estoque: estoqueSnap };
}

export function listarSnapshots(): readonly Snapshot[] {
  return cacheSnapshot;
}

/**
 * Salva (ou sobrescreve a foto do mesmo dia) no Supabase + cache local.
 * Otimista: atualiza cache antes do upsert. Em caso de erro, faz ROLLBACK do
 * cache pra estado anterior antes de propagar o erro — UI volta a refletir o
 * que está no Supabase.
 */
export async function salvarSnapshot(snap: Snapshot): Promise<Snapshot[]> {
  const previo = cached;
  cached = [...previo.filter((s) => s.id !== snap.id), snap].sort((a, b) => a.id.localeCompare(b.id));
  notify();
  try {
    await upsertKpiSnapshot(snap);
  } catch (err) {
    cached = previo;
    notify();
    console.error("Falha ao salvar snapshot no Supabase (rollback aplicado):", err);
    throw err;
  }
  return cached;
}

export async function removerSnapshot(id: string): Promise<Snapshot[]> {
  const previo = cached;
  cached = previo.filter((s) => s.id !== id);
  notify();
  try {
    await deleteKpiSnapshot(id);
  } catch (err) {
    cached = previo;
    notify();
    console.error("Falha ao remover snapshot no Supabase (rollback aplicado):", err);
    throw err;
  }
  return cached;
}
