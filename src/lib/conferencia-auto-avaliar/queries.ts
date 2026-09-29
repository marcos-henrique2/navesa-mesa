"use client";

/**
 * Camada de I/O da Conferência Auto Avaliar.
 *
 * Match/reconciliação por placa_norm = normalizarPlaca (mesma expressão do
 * SQL: regexp_replace(upper(placa),'[^A-Z0-9]','','g')). Re-normalizamos no
 * client o que volta do banco — o `.in(placa, variantes)` é só um pré-filtro
 * barato (usa o índice de placa); a correção vem da normalização, não do
 * formato salvo. Mesmo padrão de `import-auto-avaliar-queries.ts`.
 *
 * 100% leitura: nenhuma das duas queries grava nada.
 */

import { getSupabase, chunk } from "@/lib/data/supabase";
import { normalizarPlaca } from "@/lib/utils/placa";
import {
  classificarConferencia,
  type EntradaConferencia,
  type ResultadoConferencia,
  type VendaRefConferencia,
} from "@/lib/conferencia-auto-avaliar/classificar";

type VendaRow = {
  placa: string | null;
  data_venda: string | null;
  valor_venda: number | string | null;
  cliente_nome: string | null;
  vendedor_nome: string | null;
};

type VeiculoAtualRow = { placa: string | null };

/** NUMERIC do Supabase (pode vir string) → number finito | null. */
function num(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

/** timestamptz/ISO → data pura YYYY-MM-DD. */
function isoData(v: string | null | undefined): string | null {
  if (!v) return null;
  return v.slice(0, 10);
}

/**
 * Variantes de placa pro pré-filtro `.in`: a própria normalizada e a forma
 * antiga com hífen (LLL-NNNN), cobrindo os dois formatos de gravação.
 */
function variantesPlaca(norm: string): string[] {
  const v = new Set<string>([norm]);
  if (norm.length === 7) v.add(`${norm.slice(0, 3)}-${norm.slice(3)}`);
  return [...v];
}

function todasVariantes(placas: ReadonlyArray<string>): string[] {
  const set = new Set<string>();
  for (const p of placas) for (const v of variantesPlaca(p)) set.add(v);
  return [...set];
}

/** placa_norm → venda (data/valor/cliente/vendedor), re-normalizando o que volta do banco. */
async function carregarVendaPorPlaca(
  placasNorm: ReadonlyArray<string>,
): Promise<Map<string, VendaRefConferencia>> {
  const map = new Map<string, VendaRefConferencia>();
  if (placasNorm.length === 0) return map;
  const sb = getSupabase();
  for (const lote of chunk(todasVariantes(placasNorm))) {
    const { data, error } = await sb
      .from("vendas")
      .select("placa, data_venda, valor_venda, cliente_nome, vendedor_nome")
      .in("placa", lote);
    if (error) throw new Error(`Falha ao cruzar vendas por placa: ${error.message}`);
    for (const v of (data ?? []) as VendaRow[]) {
      const norm = normalizarPlaca(v.placa);
      if (norm && !map.has(norm)) {
        map.set(norm, {
          valor_venda: num(v.valor_venda),
          data_venda: isoData(v.data_venda),
          cliente_nome: v.cliente_nome,
          vendedor_nome: v.vendedor_nome,
        });
      }
    }
  }
  return map;
}

/** Placas presentes em `veiculos_atual` (estoque ativo), normalizadas. */
async function carregarPlacasEmEstoque(placasNorm: ReadonlyArray<string>): Promise<Set<string>> {
  const set = new Set<string>();
  if (placasNorm.length === 0) return set;
  const sb = getSupabase();
  for (const lote of chunk(todasVariantes(placasNorm))) {
    const { data, error } = await sb.from("veiculos_atual").select("placa").in("placa", lote);
    if (error) throw new Error(`Falha ao cruzar estoque por placa: ${error.message}`);
    for (const v of (data ?? []) as VeiculoAtualRow[]) {
      const norm = normalizarPlaca(v.placa);
      if (norm) set.add(norm);
    }
  }
  return set;
}

/**
 * Confere as entradas do arquivo contra `vendas` e `veiculos_atual` e devolve
 * o resultado já classificado. Único ponto de entrada da tela — resolve os
 * dados e delega a decisão ao núcleo puro `classificarConferencia`.
 */
export async function conferirContraOSistema(
  entradas: ReadonlyArray<EntradaConferencia>,
): Promise<ResultadoConferencia> {
  const placasNorm = [...new Set(entradas.map((e) => e.placa_norm).filter((p) => p.length > 0))];
  const [vendaPorPlaca, placasEmEstoque] = await Promise.all([
    carregarVendaPorPlaca(placasNorm),
    carregarPlacasEmEstoque(placasNorm),
  ]);
  return classificarConferencia(entradas, vendaPorPlaca, placasEmEstoque);
}
