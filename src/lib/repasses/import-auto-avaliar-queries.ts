"use client";

/**
 * Camada de I/O do importador Auto Avaliar (Story 2.2 / Fatia 2).
 *
 * Pipeline:
 *   parseAutoAvaliar (puro) → montarPreviewImport (I/O) → TELA PREVIEW →
 *   confirmarImport (1 RPC atômica).
 *
 * Toda a REGRA de decisão do preview mora no núcleo puro `import-auto-avaliar.ts`;
 * aqui só resolvemos os dados do Supabase e delegamos. A gravação é uma única
 * chamada à RPC `importar_repasse_auto_avaliar` (snapshot já decidido).
 *
 * Match/reconciliação por placa_norm = normalizarPlaca (mesma expressão do SQL:
 * regexp_replace(upper(placa),'[^A-Z0-9]','','g')). Re-normalizamos no client o
 * que volta do banco, então o `.in(placa, variantes)` é só um pré-filtro barato
 * (usa o btree de placa) — a correção vem da normalização, não do formato salvo.
 */

import { getSupabase, chunk } from "@/lib/data/supabase";
import { normalizarPlaca } from "@/lib/utils/placa";
import type { ParseResultAA } from "@/lib/repasses/parse-auto-avaliar";
import {
  montarPreviewPuro,
  montarPayloadImport,
  type ImportPreview,
  type ImportResultado,
  type PayloadImport,
  type RepasseAtivoRef,
  type SubidoRef,
  type VendaRef,
} from "@/lib/repasses/import-auto-avaliar";

/** NUMERIC do Supabase (pode vir string) → number finito | null. */
function num(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

/** timestamptz/ISO → data pura YYYY-MM-DD (o data_vendido::date da RPC). */
function isoData(v: string | null | undefined): string | null {
  if (!v) return null;
  return v.slice(0, 10);
}

/**
 * Variantes de placa pro pré-filtro `.in`: a própria normalizada e a forma
 * antiga com hífen (LLL-NNNN), cobrindo os dois formatos de gravação do estoque.
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

type RepasseRow = {
  id: number;
  placa: string | null;
  chassi: string | null;
  modelo: string | null;
  status: string | null;
  canal: string | null;
};

type VeiculoRow = { chassi: string | null; placa: string | null };
type VendaRow = { placa: string | null; data_venda: string | null; valor_venda: number | string | null };

/**
 * Monta o preview a partir do resultado do parser: resolve chassi por placa,
 * casa repasses ativos e monta a reconciliação do universo subido.
 */
export async function montarPreviewImport(parse: ParseResultAA): Promise<ImportPreview> {
  const sb = getSupabase();

  const placasLista = [...new Set(parse.registros.map((r) => r.placa_norm))];

  // 1. Repasses ativos (marcado|subido) — tabela pequena, carrega todos os ativos.
  const { data: repRows, error: repErr } = await sb
    .from("repasses")
    .select("id, placa, chassi, modelo, status, canal")
    .in("status", ["marcado", "subido"]);
  if (repErr) throw new Error(`Falha ao carregar repasses ativos: ${repErr.message}`);

  const repasseAtivoPorPlaca = new Map<string, RepasseAtivoRef>();
  const subidoUniverso: SubidoRef[] = [];
  for (const r of (repRows ?? []) as RepasseRow[]) {
    const placa_norm = normalizarPlaca(r.placa);
    if (placa_norm && r.chassi && !repasseAtivoPorPlaca.has(placa_norm)) {
      repasseAtivoPorPlaca.set(placa_norm, { id: r.id, chassi: r.chassi });
    }
    if (r.canal === "auto_avaliar" && r.status === "subido" && placa_norm) {
      subidoUniverso.push({ id: r.id, placa_norm, modelo: r.modelo ?? "" });
    }
  }

  // 2. Resolve chassi por placa (só pra placas que NÃO têm repasse ativo → candidatas a criar).
  const placasCriar = placasLista.filter((p) => !repasseAtivoPorPlaca.has(p));
  const chassiPorPlaca = await carregarChassiPorPlaca(placasCriar);

  // 3. Vendas pra reconciliar: só placas do universo subido que sumiram da lista.
  const importadas = new Set(placasLista);
  const placasRecon = subidoUniverso.map((s) => s.placa_norm).filter((p) => !importadas.has(p));
  const vendaPorPlaca = await carregarVendaPorPlaca(placasRecon);

  return montarPreviewPuro({
    registros: parse.registros,
    avisos: parse.avisos,
    chassiPorPlaca,
    repasseAtivoPorPlaca,
    subidoUniverso,
    vendaPorPlaca,
  });
}

/** placa_norm → chassi (veiculos_atual), re-normalizando o que volta do banco. */
async function carregarChassiPorPlaca(placas: ReadonlyArray<string>): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (placas.length === 0) return map;
  const sb = getSupabase();
  for (const lote of chunk(todasVariantes(placas))) {
    const { data, error } = await sb.from("veiculos_atual").select("chassi, placa").in("placa", lote);
    if (error) throw new Error(`Falha ao resolver chassi por placa: ${error.message}`);
    for (const v of (data ?? []) as VeiculoRow[]) {
      const norm = normalizarPlaca(v.placa);
      if (norm && v.chassi && !map.has(norm)) map.set(norm, v.chassi);
    }
  }
  return map;
}

/** placa_norm → venda (data/valor), re-normalizando o que volta do banco. */
async function carregarVendaPorPlaca(placas: ReadonlyArray<string>): Promise<Map<string, VendaRef>> {
  const map = new Map<string, VendaRef>();
  if (placas.length === 0) return map;
  const sb = getSupabase();
  for (const lote of chunk(todasVariantes(placas))) {
    const { data, error } = await sb
      .from("vendas")
      .select("placa, data_venda, valor_venda")
      .in("placa", lote);
    if (error) throw new Error(`Falha ao cruzar vendas por placa: ${error.message}`);
    for (const v of (data ?? []) as VendaRow[]) {
      const norm = normalizarPlaca(v.placa);
      if (norm && !map.has(norm)) {
        map.set(norm, { data_vendido: isoData(v.data_venda), valor_vendido: num(v.valor_venda) });
      }
    }
  }
  return map;
}

/**
 * Grava o import: 1 RPC atômica/idempotente com o snapshot do preview.
 * NÃO recalcula regra no client — a RPC aplica e devolve as contagens.
 */
export async function confirmarImport(preview: ImportPreview): Promise<ImportResultado> {
  const payload: PayloadImport = montarPayloadImport(preview);
  const sb = getSupabase();
  const { data, error } = await sb.rpc("importar_repasse_auto_avaliar", { p_payload: payload });
  if (error) throw new Error(`Falha ao importar do Auto Avaliar: ${error.message}`);

  const raw = (Array.isArray(data) ? data[0] : data) ?? {};
  const r = raw as Record<string, unknown>;
  return {
    criados: rpcNum(r.criados),
    atualizados: rpcNum(r.atualizados),
    reconciliados_vendidos: rpcNum(r.reconciliados_vendidos),
    reconciliados_marcados: rpcNum(r.reconciliados_marcados),
    conflitos: rpcNum(r.conflitos),
  };
}

function rpcNum(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : 0;
  return Number.isFinite(n) ? n : 0;
}
