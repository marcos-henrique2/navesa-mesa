"use client";

/**
 * Queries do relatório "Carros em anúncio" (status='subido') — Story 1.2/1.3.
 *
 * Carrega os carros subidos + os gastos (repasse_gastos) + a contagem de
 * interessados (repasse_interessados) e delega a montagem pro builder PURO
 * `relatorio-anuncio.ts`. Mesmo padrão client-side de `queries.ts`.
 *
 * custo_real = valor_compra_repasse + Σ gastos (regra de ouro — NUNCA valor_aquisicao).
 */

import { getSupabase } from "@/lib/data/supabase";
import { calcularCustoReal } from "./margem-repasse";
import { listGastosPorRepasse } from "./queries";
import {
  montarRelatorioAnuncio,
  type CarroAnuncioInput,
  type CarroAnuncioItem,
} from "./relatorio-anuncio";

/** Row cru dos campos que o relatório precisa. NUMERIC pode vir como string. */
type AnuncioRow = {
  id: number;
  placa: string;
  modelo: string;
  marca: string | null;
  ano_fabricacao: number | null;
  ano_modelo: number | null;
  km: number | null;
  status: string;
  data_subiu: string | null;
  data_vendido: string | null;
  valor_minimo: number | string | null;
  valor_compre_por: number | string | null;
  valor_compra_repasse: number | string | null;
  valor_fipe: number | string | null;
};

/** NUMERIC do Supabase (pode vir string) → number finito | null. */
function num(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

/** Data em YYYY-MM-DD no fuso local (pra `hoje` do cálculo de dias). */
function hojeISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/**
 * Carrega e monta o relatório dos carros em anúncio (status='subido').
 * Gastos e interessados vêm em queries paralelas e são agrupados por repasse_id.
 */
export async function listCarrosEmAnuncio(): Promise<CarroAnuncioItem[]> {
  const sb = getSupabase();

  const { data: rows, error } = await sb
    .from("repasses")
    .select(
      "id, placa, modelo, marca, ano_fabricacao, ano_modelo, km, status, data_subiu, data_vendido, valor_minimo, valor_compre_por, valor_compra_repasse, valor_fipe",
    )
    .eq("status", "subido")
    .order("id", { ascending: false });
  if (error) throw new Error(`Falha ao carregar carros em anúncio: ${error.message}`);

  const anuncios = (rows ?? []) as AnuncioRow[];
  const ids = anuncios.map((r) => r.id);

  const [gastosPorId, interessadosPorId] = await Promise.all([
    listGastosPorRepasse(ids),
    carregarInteressadosPorRepasse(ids),
  ]);

  const inputs: CarroAnuncioInput[] = anuncios.map((r) => ({
    id: r.id,
    placa: r.placa,
    modelo: r.modelo,
    marca: r.marca,
    ano_fabricacao: r.ano_fabricacao,
    ano_modelo: r.ano_modelo,
    km: r.km,
    status: r.status,
    data_subiu: r.data_subiu,
    data_vendido: r.data_vendido,
    valor_minimo: num(r.valor_minimo),
    valor_compre_por: num(r.valor_compre_por),
    valor_compra_repasse: num(r.valor_compra_repasse),
    // FIPE real gravada pelo importador Auto Avaliar (Fatia 2 / Story 2.4).
    fipe: num(r.valor_fipe),
    gastos: gastosPorId.get(r.id) ?? [],
    interessados: interessadosPorId.get(r.id) ?? 0,
  }));

  return montarRelatorioAnuncio(inputs, hojeISO());
}

// ─── Dados de margem de UM repasse (painel de negociação) ────────────────────

/**
 * custo/mínimo/compre-por/FIPE de um único repasse — alimenta o painel de
 * negociação na tela de interessados. Mesma regra de ouro do relatório:
 * custo_real = valor_compra_repasse + Σ gastos (NUNCA valor_aquisicao).
 *
 * Todos os campos podem ser null (carro "incompleto") — a UI mostra estado
 * neutro "sem dados de margem", nunca erro.
 */
export type DadosMargemRepasse = {
  custoReal: number | null;
  minimo: number | null;
  comprePor: number | null;
  fipe: number | null;
};

export async function getDadosMargemRepasse(repasseId: number): Promise<DadosMargemRepasse> {
  const sb = getSupabase();
  // Repasse e gastos são independentes → dispara em paralelo (2 round-trips → 1 rtt).
  const [{ data, error }, gastos] = await Promise.all([
    sb
      .from("repasses")
      .select("valor_minimo, valor_compre_por, valor_compra_repasse, valor_fipe")
      .eq("id", repasseId)
      .maybeSingle(),
    listGastosPorRepasse([repasseId]).then((m) => m.get(repasseId) ?? []),
  ]);
  if (error) throw new Error(`Falha ao carregar dados de margem: ${error.message}`);
  if (!data) return { custoReal: null, minimo: null, comprePor: null, fipe: null };

  const r = data as {
    valor_minimo: number | string | null;
    valor_compre_por: number | string | null;
    valor_compra_repasse: number | string | null;
    valor_fipe: number | string | null;
  };

  return {
    custoReal: calcularCustoReal(num(r.valor_compra_repasse), gastos),
    minimo: num(r.valor_minimo),
    comprePor: num(r.valor_compre_por),
    fipe: num(r.valor_fipe),
  };
}

/** Map repasse_id → COUNT de interessados. */
async function carregarInteressadosPorRepasse(
  ids: ReadonlyArray<number>,
): Promise<Map<number, number>> {
  const m = new Map<number, number>();
  if (ids.length === 0) return m;
  const sb = getSupabase();
  const { data, error } = await sb
    .from("repasse_interessados")
    .select("repasse_id")
    .in("repasse_id", [...ids]);
  if (error) throw new Error(`Falha ao contar interessados: ${error.message}`);
  for (const row of (data ?? []) as Array<{ repasse_id: number }>) {
    m.set(row.repasse_id, (m.get(row.repasse_id) ?? 0) + 1);
  }
  return m;
}
