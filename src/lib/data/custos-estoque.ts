"use client";

import type { CustoEstoqueDetalhado } from "@/lib/parsers/nbs-custos-estoque-pdf";
import { getSupabase, chunk, selectAll } from "./supabase";

type CustoEstoqueRow = CustoEstoqueDetalhado & {
  cod_empresa: number | null;
};

function toRow(c: CustoEstoqueDetalhado, codEmpresa: number): Record<string, unknown> {
  return {
    placa: c.placa,
    cod_empresa: codEmpresa,
    modelo: c.modelo,
    dias_patio: c.dias_patio,
    nota_fabrica: c.nota_fabrica,
    revisoes: c.revisoes,
    forplan: c.forplan,
    holdback: c.holdback,
    acessorios: c.acessorios,
    adm: c.adm,
    impostos: c.impostos,
    comissoes: c.comissoes,
    desp_gerais: c.desp_gerais,
    custo_total: c.custo_total,
    tabela: c.tabela,
    lucro_bruto: c.lucro_bruto,
    bonus: c.bonus,
    ganhos_indiretos: c.ganhos_indiretos,
  };
}

function fromRow(r: CustoEstoqueRow): CustoEstoqueDetalhado {
  return {
    placa: r.placa,
    modelo: r.modelo,
    dias_patio: r.dias_patio,
    nota_fabrica: r.nota_fabrica,
    revisoes: r.revisoes,
    forplan: r.forplan,
    holdback: r.holdback,
    acessorios: r.acessorios,
    adm: r.adm,
    impostos: r.impostos,
    comissoes: r.comissoes,
    desp_gerais: r.desp_gerais,
    custo_total: r.custo_total,
    tabela: r.tabela,
    lucro_bruto: r.lucro_bruto,
    bonus: r.bonus,
    ganhos_indiretos: r.ganhos_indiretos,
  };
}

/** Lista TODOS os custos de estoque (paginando). */
export async function listCustosEstoque(): Promise<{ itens: CustoEstoqueDetalhado[]; codEmpresaPorPlaca: Record<string, number> }> {
  const sb = getSupabase();
  const rows = await selectAll<CustoEstoqueRow>(sb, "custos_estoque_detalhado", { orderBy: "placa" });
  const codEmpresaPorPlaca: Record<string, number> = {};
  const itens = rows.map((r) => {
    if (r.cod_empresa != null) codEmpresaPorPlaca[r.placa] = r.cod_empresa;
    return fromRow(r);
  });
  return { itens, codEmpresaPorPlaca };
}

/**
 * Upsert em lote por placa. Custos antigos com a mesma placa são sobrescritos;
 * placas não presentes no novo lote são mantidas (igual a outros datasets).
 *
 * codEmpresa é gravado em todas as linhas (vem da meta do PDF — cada PDF cobre 1 loja).
 */
export async function upsertCustosEstoque(
  itens: CustoEstoqueDetalhado[],
  codEmpresa: number,
): Promise<{ total: number; duplicatasIgnoradas: number }> {
  if (itens.length === 0) return { total: 0, duplicatasIgnoradas: 0 };

  const porPlaca = new Map<string, CustoEstoqueDetalhado>();
  for (const c of itens) {
    if (!c.placa) continue;
    porPlaca.set(c.placa, c);
  }
  const unicos = [...porPlaca.values()];
  const duplicatasIgnoradas = itens.length - unicos.length;

  const sb = getSupabase();
  for (const lote of chunk(unicos.map((c) => toRow(c, codEmpresa)), 500)) {
    const { error } = await sb.from("custos_estoque_detalhado").upsert(lote, { onConflict: "placa" });
    if (error) throw new Error(`upsertCustosEstoque: ${error.message}`);
  }
  return { total: unicos.length, duplicatasIgnoradas };
}

export async function clearCustosEstoque(): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from("custos_estoque_detalhado").delete().neq("placa", "__never__");
  if (error) throw new Error(`clearCustosEstoque: ${error.message}`);
}

export async function contarCustosEstoque(): Promise<number> {
  const sb = getSupabase();
  const { count, error } = await sb.from("custos_estoque_detalhado").select("*", { count: "exact", head: true });
  if (error) throw new Error(`contarCustosEstoque: ${error.message}`);
  return count ?? 0;
}
