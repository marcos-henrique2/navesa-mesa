/**
 * SNAPSHOTS HISTÓRICOS — fotos do estado do negócio ao longo do tempo.
 *
 * Cada snapshot guarda só os KPIs agregados (não os dados crus) — leve, cabe muitos
 * no localStorage. Permite ver evolução: margem subiu/caiu? estoque parado diminuiu?
 *
 * Dedup por dia: uma foto por data (a mais recente do dia sobrescreve).
 */

import type { VendaParsed } from "@/lib/parsers/nbs-vendas-xlsx";
import type { CustoDetalhado } from "@/lib/parsers/nbs-custos-xls";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";
import { sumarioGlobal } from "@/lib/analytics/insights";
import { classificarPatio } from "@/lib/inventory/status";

const KEY = "navesa-mesa:snapshots-v1";

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

/** Monta um snapshot a partir do estado atual (não salva). */
export function capturarSnapshot(
  vendas: VendaParsed[],
  custosPorPlaca: Record<string, CustoDetalhado>,
  veiculos: VeiculoParsed[],
): Snapshot {
  const hoje = new Date();
  const id = hoje.toISOString().slice(0, 10);

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

export function listarSnapshots(): Snapshot[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as Snapshot[];
    return Array.isArray(arr) ? arr.sort((a, b) => a.id.localeCompare(b.id)) : [];
  } catch {
    return [];
  }
}

/** Salva (ou sobrescreve a foto do mesmo dia). Retorna a lista atualizada. */
export function salvarSnapshot(snap: Snapshot): Snapshot[] {
  const atual = listarSnapshots().filter((s) => s.id !== snap.id);
  const nova = [...atual, snap].sort((a, b) => a.id.localeCompare(b.id));
  try {
    localStorage.setItem(KEY, JSON.stringify(nova));
    window.dispatchEvent(new Event("navesa-mesa:snapshots-updated"));
  } catch (err) {
    console.warn("Falha ao salvar snapshot:", err);
  }
  return nova;
}

export function removerSnapshot(id: string): Snapshot[] {
  const nova = listarSnapshots().filter((s) => s.id !== id);
  try {
    localStorage.setItem(KEY, JSON.stringify(nova));
    window.dispatchEvent(new Event("navesa-mesa:snapshots-updated"));
  } catch {}
  return nova;
}
