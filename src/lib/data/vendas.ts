"use client";

import type { VendaParsed } from "@/lib/parsers/nbs-vendas-xlsx";
import { getSupabase, chunk, selectAll, parseDate } from "./supabase";

type VendaRow = Omit<VendaParsed, "data_venda" | "data_faturamento" | "data_entrada"> & {
  data_venda: string | null;
  data_faturamento: string | null;
  data_entrada: string | null;
  atualizado_em?: string;
};

function toRow(v: VendaParsed): Record<string, unknown> {
  return {
    chassi: v.chassi,
    placa: v.placa,
    modelo: v.modelo,
    marca: v.marca,
    ano_fabricacao: v.ano_fabricacao,
    ano_modelo: v.ano_modelo,
    cor_externa: v.cor_externa,
    renavam: v.renavam,
    km: v.km,
    cod_empresa: v.cod_empresa,
    empresa_nome: v.empresa_nome,
    patio: v.patio,
    vendedor_codigo: v.vendedor_codigo,
    vendedor_nome: v.vendedor_nome,
    vendedor_cpf: v.vendedor_cpf,
    vendedor_recebeu: v.vendedor_recebeu,
    cliente_codigo: v.cliente_codigo,
    cliente_nome: v.cliente_nome,
    cliente_tipo: v.cliente_tipo,
    cliente_cidade: v.cliente_cidade,
    cliente_uf: v.cliente_uf,
    data_venda: v.data_venda?.toISOString() ?? null,
    data_faturamento: v.data_faturamento?.toISOString() ?? null,
    data_entrada: v.data_entrada?.toISOString() ?? null,
    valor_venda: v.valor_venda,
    preco_venda_tabela: v.preco_venda_tabela,
    total_nota_fabrica: v.total_nota_fabrica,
    custo_floor_plan: v.custo_floor_plan,
    custo_total_final: v.custo_total_final,
    despesas_gerais: v.despesas_gerais,
    margem_pct: v.margem_pct,
    comissao_vendedor: v.comissao_vendedor,
    dias_estoque: v.dias_estoque,
    placa_troca: v.placa_troca,
  };
}

function fromRow(r: VendaRow): VendaParsed {
  return {
    chassi: r.chassi,
    placa: r.placa,
    modelo: r.modelo,
    marca: r.marca,
    ano_fabricacao: r.ano_fabricacao,
    ano_modelo: r.ano_modelo,
    cor_externa: r.cor_externa,
    renavam: r.renavam,
    km: r.km,
    cod_empresa: r.cod_empresa,
    empresa_nome: r.empresa_nome,
    patio: r.patio,
    vendedor_codigo: r.vendedor_codigo,
    vendedor_nome: r.vendedor_nome,
    vendedor_cpf: r.vendedor_cpf,
    vendedor_recebeu: r.vendedor_recebeu,
    cliente_codigo: r.cliente_codigo,
    cliente_nome: r.cliente_nome,
    cliente_tipo: r.cliente_tipo,
    cliente_cidade: r.cliente_cidade,
    cliente_uf: r.cliente_uf,
    data_venda: parseDate(r.data_venda),
    data_faturamento: parseDate(r.data_faturamento),
    data_entrada: parseDate(r.data_entrada),
    valor_venda: r.valor_venda,
    preco_venda_tabela: r.preco_venda_tabela,
    total_nota_fabrica: r.total_nota_fabrica,
    custo_floor_plan: r.custo_floor_plan,
    custo_total_final: r.custo_total_final,
    despesas_gerais: r.despesas_gerais,
    margem_pct: r.margem_pct,
    comissao_vendedor: r.comissao_vendedor,
    dias_estoque: r.dias_estoque,
    placa_troca: r.placa_troca,
  };
}

/** Lista TODAS as vendas (paginando). */
export async function listVendas(): Promise<VendaParsed[]> {
  const sb = getSupabase();
  const rows = await selectAll<VendaRow>(sb, "vendas", { orderBy: "data_venda" });
  return rows.map(fromRow);
}

/** Lista vendas num intervalo [ini, fim] de data_venda. */
export async function listVendasPorPeriodo(ini: Date, fim: Date): Promise<VendaParsed[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("vendas")
    .select("*")
    .gte("data_venda", ini.toISOString())
    .lte("data_venda", fim.toISOString())
    .order("data_venda");
  if (error) throw new Error(`listVendasPorPeriodo: ${error.message}`);
  return (data as VendaRow[]).map(fromRow);
}

/**
 * Upsert em lote (por chassi). Substitui se já existir, insere se for novo.
 *
 * Dedup interno: se houver chassis repetidos no array (acontece quando o
 * localStorage acumulou versões), mantém a ÚLTIMA ocorrência. Postgres exige
 * que não haja duplicatas no mesmo batch.
 *
 * @returns { total, duplicatasIgnoradas }
 */
export async function upsertVendas(vendas: VendaParsed[]): Promise<{ total: number; duplicatasIgnoradas: number }> {
  if (vendas.length === 0) return { total: 0, duplicatasIgnoradas: 0 };

  // Dedup mantendo a última ocorrência por chassi
  const porChassi = new Map<string, VendaParsed>();
  for (const v of vendas) {
    if (!v.chassi) continue;
    porChassi.set(v.chassi, v);
  }
  const unicas = [...porChassi.values()];
  const duplicatasIgnoradas = vendas.length - unicas.length;

  const sb = getSupabase();
  for (const lote of chunk(unicas.map(toRow), 500)) {
    const { error } = await sb.from("vendas").upsert(lote, { onConflict: "chassi" });
    if (error) throw new Error(`upsertVendas: ${error.message}`);
  }
  return { total: unicas.length, duplicatasIgnoradas };
}

/**
 * Merge incremental por período:
 *   1. Apaga vendas existentes dentro de [ini, fim]
 *   2. Insere as novas
 * Replica o comportamento de lib/store/merge.ts no banco.
 */
export async function replaceVendasNoPeriodo(
  vendasNovas: VendaParsed[],
  ini: Date,
  fim: Date,
): Promise<{ removidas: number; inseridas: number }> {
  const sb = getSupabase();

  // 1) conta + deleta o que está no período
  const { count: removidas, error: delErr } = await sb
    .from("vendas")
    .delete({ count: "exact" })
    .gte("data_venda", ini.toISOString())
    .lte("data_venda", fim.toISOString());
  if (delErr) throw new Error(`replaceVendasNoPeriodo (delete): ${delErr.message}`);

  // 2) insere as novas em lote
  await upsertVendas(vendasNovas);

  return { removidas: removidas ?? 0, inseridas: vendasNovas.length };
}

export async function clearVendas(): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from("vendas").delete().neq("chassi", "__never__");
  if (error) throw new Error(`clearVendas: ${error.message}`);
}

export async function contarVendas(): Promise<number> {
  const sb = getSupabase();
  const { count, error } = await sb.from("vendas").select("*", { count: "exact", head: true });
  if (error) throw new Error(`contarVendas: ${error.message}`);
  return count ?? 0;
}
