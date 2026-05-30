"use client";

import type { VeiculoParsed, SnapshotMeta } from "@/lib/parsers/nbs-xlsx";
import { getSupabase, chunk, selectAll, parseDate } from "./supabase";

type VeiculoRow = Omit<VeiculoParsed, "data_entrada"> & {
  snapshot_id: number;
  data_entrada: string | null;
};

function toRow(v: VeiculoParsed, snapshotId: number): Record<string, unknown> {
  return {
    snapshot_id: snapshotId,
    cod_empresa: v.cod_empresa,
    chassi: v.chassi,
    placa: v.placa,
    marca: v.marca,
    modelo: v.modelo,
    ano_fabricacao: v.ano_fabricacao,
    ano_modelo: v.ano_modelo,
    cor_externa: v.cor_externa,
    combustivel: v.combustivel,
    km: v.km,
    patio: v.patio,
    descricao_situacao: v.descricao_situacao,
    preco_venda: v.preco_venda,
    valor_aquisicao: v.valor_aquisicao,
    custo_total: v.custo_total,
    dias_patio: v.dias_patio,
    data_entrada: v.data_entrada?.toISOString() ?? null,
    vendedor_recebeu: v.vendedor_recebeu,
  };
}

function fromRow(r: VeiculoRow): VeiculoParsed {
  return {
    cod_empresa: r.cod_empresa,
    chassi: r.chassi,
    placa: r.placa,
    marca: r.marca,
    modelo: r.modelo,
    ano_fabricacao: r.ano_fabricacao,
    ano_modelo: r.ano_modelo,
    cor_externa: r.cor_externa,
    combustivel: r.combustivel,
    km: r.km,
    patio: r.patio,
    descricao_situacao: r.descricao_situacao,
    preco_venda: r.preco_venda,
    valor_aquisicao: r.valor_aquisicao,
    custo_total: r.custo_total,
    dias_patio: r.dias_patio,
    data_entrada: parseDate(r.data_entrada),
    vendedor_recebeu: r.vendedor_recebeu,
  };
}

/** Lista veículos do snapshot mais recente (via view veiculos_atual). */
export async function listVeiculosAtual(): Promise<VeiculoParsed[]> {
  const sb = getSupabase();
  const rows = await selectAll<VeiculoRow>(sb, "veiculos_atual", { orderBy: "id" });
  return rows.map(fromRow);
}

/** Snapshot mais recente: meta + qts. */
export async function getMetaAtual(): Promise<SnapshotMeta | null> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("estoque_snapshots")
    .select("*")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`getMetaAtual: ${error.message}`);
  if (!data) return null;
  return {
    arquivo_nome: data.arquivo_nome,
    data_geracao: parseDate(data.data_geracao),
    total_veiculos: data.total_veiculos ?? 0,
    total_lojas: data.total_lojas ?? 0,
  };
}

/**
 * Cria um NOVO snapshot e insere os veículos vinculados.
 * Cada upload de estoque gera um snapshot novo — histórico é preservado.
 */
export async function inserirEstoqueSnapshot(
  veiculos: VeiculoParsed[],
  meta: SnapshotMeta,
): Promise<{ snapshotId: number; inseridos: number }> {
  const sb = getSupabase();

  // 1) Cria snapshot
  const { data: snap, error: snapErr } = await sb
    .from("estoque_snapshots")
    .insert({
      arquivo_nome: meta.arquivo_nome,
      data_geracao: meta.data_geracao?.toISOString() ?? null,
      total_veiculos: meta.total_veiculos,
      total_lojas: meta.total_lojas,
    })
    .select("id")
    .single();
  if (snapErr || !snap) throw new Error(`inserirEstoqueSnapshot: ${snapErr?.message ?? "sem id"}`);

  const snapshotId = snap.id as number;

  // 2) Insere veículos em lote
  for (const lote of chunk(veiculos.map((v) => toRow(v, snapshotId)), 500)) {
    const { error } = await sb.from("veiculos").insert(lote);
    if (error) throw new Error(`inserir veículos (snapshot ${snapshotId}): ${error.message}`);
  }

  return { snapshotId, inseridos: veiculos.length };
}

/** Lista todos os snapshots de estoque (pra histórico). */
export async function listEstoqueSnapshots(): Promise<
  { id: number; arquivo_nome: string; data_geracao: Date | null; data_upload: Date | null; total_veiculos: number; total_lojas: number }[]
> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("estoque_snapshots")
    .select("*")
    .order("id", { ascending: false });
  if (error) throw new Error(`listEstoqueSnapshots: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id,
    arquivo_nome: r.arquivo_nome,
    data_geracao: parseDate(r.data_geracao),
    data_upload: parseDate(r.data_upload),
    total_veiculos: r.total_veiculos ?? 0,
    total_lojas: r.total_lojas ?? 0,
  }));
}

/** Apaga TODOS os snapshots de estoque (e os veículos por cascata). */
export async function clearEstoque(): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from("estoque_snapshots").delete().neq("id", -1);
  if (error) throw new Error(`clearEstoque: ${error.message}`);
}

export async function contarVeiculosAtual(): Promise<number> {
  const sb = getSupabase();
  const { count, error } = await sb.from("veiculos_atual").select("*", { count: "exact", head: true });
  if (error) throw new Error(`contarVeiculosAtual: ${error.message}`);
  return count ?? 0;
}
