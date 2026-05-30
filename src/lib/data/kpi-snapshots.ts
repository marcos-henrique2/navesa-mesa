"use client";

import type { Snapshot } from "@/lib/storage/snapshots";
import { getSupabase, selectAll } from "./supabase";

type SnapshotRow = {
  id: string;
  capturado_em: string;
  vendas_qt: number | null;
  vendas_faturamento: number | null;
  vendas_custo: number | null;
  vendas_margem: number | null;
  vendas_margem_pct: number | null;
  vendas_ganhos_indiretos: number | null;
  vendas_margem_sem_bonus: number | null;
  vendas_periodo_inicio: string | null;
  vendas_periodo_fim: string | null;
  estoque_total_carros: number | null;
  estoque_custo_total: number | null;
  estoque_disponivel_qt: number | null;
  estoque_disponivel_custo: number | null;
  estoque_preparacao_qt: number | null;
  estoque_preparacao_custo: number | null;
  estoque_parados180_qt: number | null;
  estoque_parados180_custo: number | null;
};

function fromRow(r: SnapshotRow): Snapshot {
  return {
    id: r.id,
    capturadoEm: r.capturado_em,
    vendas:
      r.vendas_qt == null
        ? null
        : {
            qt: r.vendas_qt,
            faturamento: Number(r.vendas_faturamento ?? 0),
            custo: Number(r.vendas_custo ?? 0),
            margem: Number(r.vendas_margem ?? 0),
            margemPct: Number(r.vendas_margem_pct ?? 0),
            ganhosIndiretos: Number(r.vendas_ganhos_indiretos ?? 0),
            margemSemBonus: Number(r.vendas_margem_sem_bonus ?? 0),
            periodoInicio: r.vendas_periodo_inicio,
            periodoFim: r.vendas_periodo_fim,
          },
    estoque:
      r.estoque_total_carros == null
        ? null
        : {
            totalCarros: r.estoque_total_carros,
            custoTotal: Number(r.estoque_custo_total ?? 0),
            disponivelQt: r.estoque_disponivel_qt ?? 0,
            disponivelCusto: Number(r.estoque_disponivel_custo ?? 0),
            preparacaoQt: r.estoque_preparacao_qt ?? 0,
            preparacaoCusto: Number(r.estoque_preparacao_custo ?? 0),
            parados180Qt: r.estoque_parados180_qt ?? 0,
            parados180Custo: Number(r.estoque_parados180_custo ?? 0),
          },
  };
}

function toRow(s: Snapshot): SnapshotRow {
  return {
    id: s.id,
    capturado_em: s.capturadoEm,
    vendas_qt: s.vendas?.qt ?? null,
    vendas_faturamento: s.vendas?.faturamento ?? null,
    vendas_custo: s.vendas?.custo ?? null,
    vendas_margem: s.vendas?.margem ?? null,
    vendas_margem_pct: s.vendas?.margemPct ?? null,
    vendas_ganhos_indiretos: s.vendas?.ganhosIndiretos ?? null,
    vendas_margem_sem_bonus: s.vendas?.margemSemBonus ?? null,
    vendas_periodo_inicio: s.vendas?.periodoInicio ?? null,
    vendas_periodo_fim: s.vendas?.periodoFim ?? null,
    estoque_total_carros: s.estoque?.totalCarros ?? null,
    estoque_custo_total: s.estoque?.custoTotal ?? null,
    estoque_disponivel_qt: s.estoque?.disponivelQt ?? null,
    estoque_disponivel_custo: s.estoque?.disponivelCusto ?? null,
    estoque_preparacao_qt: s.estoque?.preparacaoQt ?? null,
    estoque_preparacao_custo: s.estoque?.preparacaoCusto ?? null,
    estoque_parados180_qt: s.estoque?.parados180Qt ?? null,
    estoque_parados180_custo: s.estoque?.parados180Custo ?? null,
  };
}

export async function listKpiSnapshots(): Promise<Snapshot[]> {
  const sb = getSupabase();
  const rows = await selectAll<SnapshotRow>(sb, "kpi_snapshots", { orderBy: "id" });
  return rows.map(fromRow).sort((a, b) => a.id.localeCompare(b.id));
}

export async function upsertKpiSnapshot(snap: Snapshot): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from("kpi_snapshots").upsert(toRow(snap), { onConflict: "id" });
  if (error) throw new Error(`upsertKpiSnapshot: ${error.message}`);
}

export async function deleteKpiSnapshot(id: string): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from("kpi_snapshots").delete().eq("id", id);
  if (error) throw new Error(`deleteKpiSnapshot: ${error.message}`);
}

export async function contarKpiSnapshots(): Promise<number> {
  const sb = getSupabase();
  const { count, error } = await sb.from("kpi_snapshots").select("*", { count: "exact", head: true });
  if (error) throw new Error(`contarKpiSnapshots: ${error.message}`);
  return count ?? 0;
}
