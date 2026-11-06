"use client";

import type { VendaParsed } from "@/lib/parsers/nbs-vendas-xlsx";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase, chunk, selectAll } from "@/lib/data/supabase";
import { vendaToRow, vendaFromRow as fromRow, type VendaRow } from "@/lib/data/mappers/vendas";

/**
 * Mapper puro em `@/lib/data/mappers/vendas`. Re-exportado como `toRow` pra reuso em
 * `scripts/sync-nbs/gravar.ts` (client Node/service-role, sem sessão de browser).
 */
export { vendaToRow as toRow };

/** Lista TODAS as vendas (paginando). */
export async function listVendas(): Promise<VendaParsed[]> {
  const sb = getSupabase();
  const rows = await selectAll<VendaRow>(sb, "vendas", { orderBy: "data_venda" });
  return rows.map(fromRow);
}

/**
 * Lista vendas num intervalo [ini, fim] de data_venda.
 *
 * ⚠️ `fim` precisa ser o INSTANTE FINAL do dia, não a meia-noite dele. `data_venda` é
 * `timestamptz` e `toISOString()` de um `new Date("2026-08-06")` vira
 * `2026-08-06T00:00:00Z` — o `lte` corta tudo que foi vendido durante o dia 06, e ainda
 * desloca a fronteira em 3h por causa do fuso. Um `<input type="date">` entrega
 * exatamente esse Date. Hoje ninguém chama estas duas funções; quando alguém chamar,
 * passe `fim` no fim do dia local (ver `@/lib/utils/data-local`).
 */
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
  return upsertVendasCom(getSupabase(), vendas);
}

/**
 * Separa as linhas do upsert em dois grupos homogêneos: com `cliente_tipo`
 * e SEM a chave `cliente_tipo` (quando o tipo parseado é null).
 *
 * Por quê: o XLSX só sabe o tipo pelo tamanho do documento (detectTipoCliente
 * no parser) e devolve null pra CPF/CNPJ com zero à esquerda perdido. O sync
 * do Oracle tem o tipo explícito (NBS.CLIENTES.COD_CLASSE). Mandar null no
 * upsert apagaria esse PF/PJ correto. Omitir a coluna faz o PostgREST deixar
 * ela fora do INSERT/ON CONFLICT UPDATE — valor existente preservado, linha
 * nova fica com o default (NULL).
 *
 * Precisa ser em lotes separados: o supabase-js monta `?columns=` com a
 * UNIÃO das chaves do lote e (defaultToNull=true) preenche com null quem não
 * tem a chave — misturar as duas formas no mesmo lote voltaria a gravar null.
 */
export function separarLinhasPorTipoCliente(rows: Record<string, unknown>[]): {
  comTipo: Record<string, unknown>[];
  semTipo: Record<string, unknown>[];
} {
  const comTipo: Record<string, unknown>[] = [];
  const semTipo: Record<string, unknown>[] = [];
  for (const row of rows) {
    if (row.cliente_tipo === null || row.cliente_tipo === undefined) {
      const resto = { ...row };
      delete resto.cliente_tipo;
      semTipo.push(resto);
    } else {
      comTipo.push(row);
    }
  }
  return { comTipo, semTipo };
}

/** Núcleo de `upsertVendas` com client injetável (testável fora do browser). */
export async function upsertVendasCom(
  sb: SupabaseClient,
  vendas: VendaParsed[],
): Promise<{ total: number; duplicatasIgnoradas: number }> {
  if (vendas.length === 0) return { total: 0, duplicatasIgnoradas: 0 };

  // Dedup mantendo a última ocorrência por chassi
  const porChassi = new Map<string, VendaParsed>();
  for (const v of vendas) {
    if (!v.chassi) continue;
    porChassi.set(v.chassi, v);
  }
  const unicas = [...porChassi.values()];
  const duplicatasIgnoradas = vendas.length - unicas.length;

  const { comTipo, semTipo } = separarLinhasPorTipoCliente(unicas.map(vendaToRow));
  for (const grupo of [comTipo, semTipo]) {
    for (const lote of chunk(grupo, 500)) {
      const { error } = await sb.from("vendas").upsert(lote, { onConflict: "chassi" });
      if (error) throw new Error(`upsertVendas: ${error.message}`);
    }
  }
  return { total: unicas.length, duplicatasIgnoradas };
}

/**
 * Merge incremental por período:
 *   1. Apaga vendas existentes dentro de [ini, fim]
 *   2. Insere as novas
 * Replica o comportamento de lib/store/merge.ts no banco.
 *
 * ⚠️ MESMA ARMADILHA de `listVendasPorPeriodo`, e aqui ela DELETA: `data_venda` é
 * `timestamptz` e `fim.toISOString()` de uma data sem hora aponta pra meia-noite UTC.
 * O DELETE apagaria menos do que o período pedido e o upsert seguinte reinseriria só o
 * que veio no payload — sobra venda duplicada/órfã na borda. Passe `fim` no fim do dia
 * local antes de dar o primeiro chamador a esta função.
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
