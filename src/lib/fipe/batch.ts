/**
 * BATCH FIPE MATCHER
 *
 * Resolve preço FIPE pra um array inteiro de veículos do estoque ou histórico de vendas.
 *
 * Estratégia:
 *   1. Agrupa veículos por (marca, modelo, ano, comb) — muitos carros iguais → 1 chamada FIPE.
 *   2. Pra cada grupo único: resolve marca → modelos → ano → valor (4 chamadas).
 *   3. Aplica o resultado em todos os veículos do grupo.
 *   4. Salva tudo no Supabase indexado por chassi.
 *
 * Cache: persiste o batch result no Supabase (tabela fipe_batch). Hook useFipeBatch
 * mantém uma cópia em memória pra leitura síncrona reativa.
 */

import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";
import type { FipeMatch } from "./types";
import { findMarca, findModelos, findAno } from "./matcher";
import { getMarcas, getModelos, getAnos, getValor, parseFipeValor } from "./service";
import {
  loadBatchFromSupabase,
  saveBatchToSupabase,
  clearBatchSupabase,
} from "@/lib/data/fipe-batch";

const BATCH_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias (FIPE muda mensalmente, mas estoque diariamente)
const DELAY_BETWEEN_CALLS_MS = 100; // 10 req/s — confortável pra API gratuita
const EVT = "navesa-mesa:fipe-batch-updated";

export type BatchFipeItem = {
  chassi: string;
  precoFipe: number;
  match: FipeMatch;
};

export type BatchFipeError = {
  chassi: string;
  modelo: string;
  motivo: "marca-nao-encontrada" | "modelo-nao-encontrado" | "ano-nao-encontrado" | "erro-api";
  detalhe?: string;
};

export type BatchResult = {
  timestamp: number;
  items: Record<string, BatchFipeItem>; // chassi → resultado
  erros: BatchFipeError[];
  totalGrupos: number;
  totalVeiculos: number;
};

export type BatchProgress = {
  fase: "agrupando" | "marcas" | "resolvendo" | "concluido" | "erro";
  atual: number;
  total: number;
  mensagem: string;
  matchesAteAgora: number;
  errosAteAgora: number;
};

// ───── Cache em memória ─────────────────────────────────────────────────────

let cached: BatchResult | null = null;
let loaded = false;
let loadingPromise: Promise<BatchResult | null> | null = null;

function notify() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVT));
}

/**
 * Carrega o batch do Supabase pro cache. Usado pelo hook na primeira renderização.
 * Idempotente — chamadas concorrentes reusam a mesma Promise.
 */
export async function ensureBatchLoaded(): Promise<BatchResult | null> {
  if (loaded) return cached;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    try {
      const r = await loadBatchFromSupabase();
      if (r && Date.now() - r.timestamp <= BATCH_TTL_MS) cached = r;
      else cached = null;
      loaded = true;
      notify();
      return cached;
    } catch (err) {
      console.error("Falha ao carregar batch FIPE do Supabase:", err);
      loaded = true;
      return null;
    } finally {
      loadingPromise = null;
    }
  })();
  return loadingPromise;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Chave de agrupamento (carros iguais geram 1 só lookup FIPE). */
function groupKey(v: VeiculoParsed): string {
  const m = (v.marca ?? "").trim().toUpperCase();
  const md = (v.modelo ?? "").trim().toUpperCase();
  const a = v.ano_modelo ?? 0;
  const c = (v.combustivel ?? "").trim().toUpperCase();
  return `${m}|${md}|${a}|${c}`;
}

/**
 * Executa o batch matching. Chama onProgress periodicamente pra UI poder mostrar barra.
 */
export async function runFipeBatch(
  veiculos: VeiculoParsed[],
  onProgress?: (p: BatchProgress) => void,
): Promise<BatchResult> {
  const report = (p: BatchProgress) => onProgress?.(p);

  if (veiculos.length === 0) {
    return { timestamp: Date.now(), items: {}, erros: [], totalGrupos: 0, totalVeiculos: 0 };
  }

  // 1) Agrupa por chave
  report({ fase: "agrupando", atual: 0, total: veiculos.length, mensagem: "Agrupando carros similares...", matchesAteAgora: 0, errosAteAgora: 0 });
  const grupos = new Map<string, VeiculoParsed[]>();
  for (const v of veiculos) {
    const k = groupKey(v);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k)!.push(v);
  }

  // 2) Baixa marcas FIPE uma vez (cacheado)
  report({ fase: "marcas", atual: 0, total: grupos.size, mensagem: "Carregando marcas FIPE...", matchesAteAgora: 0, errosAteAgora: 0 });
  const fipeMarcas = await getMarcas();

  // 3) Resolve cada grupo
  const items: Record<string, BatchFipeItem> = {};
  const erros: BatchFipeError[] = [];
  let matches = 0;
  let idx = 0;

  for (const [, veiculosGrupo] of grupos) {
    idx++;
    const sample = veiculosGrupo[0];
    report({
      fase: "resolvendo",
      atual: idx,
      total: grupos.size,
      mensagem: `Resolvendo ${sample.marca ?? "?"} ${sample.modelo ?? "?"} (${veiculosGrupo.length} carro${veiculosGrupo.length === 1 ? "" : "s"})`,
      matchesAteAgora: matches,
      errosAteAgora: erros.length,
    });

    try {
      // Marca
      const fipeMarca = findMarca(sample.marca ?? "", fipeMarcas);
      if (!fipeMarca) {
        for (const v of veiculosGrupo) erros.push({ chassi: v.chassi, modelo: v.modelo, motivo: "marca-nao-encontrada" });
        continue;
      }

      // Modelos (cacheado pela primeira marca)
      const fipeModelos = await getModelos(fipeMarca.codigo);
      const modeloMatches = findModelos(sample.modelo, fipeModelos, 1, sample.combustivel ?? null);
      if (modeloMatches.length === 0) {
        for (const v of veiculosGrupo) erros.push({ chassi: v.chassi, modelo: v.modelo, motivo: "modelo-nao-encontrado" });
        continue;
      }
      const fipeModelo = modeloMatches[0].modelo;

      // Anos
      const fipeAnos = await getAnos(fipeMarca.codigo, fipeModelo.codigo);
      const fipeAno = findAno(sample.ano_modelo, sample.combustivel, fipeAnos);
      if (!fipeAno) {
        for (const v of veiculosGrupo) erros.push({ chassi: v.chassi, modelo: v.modelo, motivo: "ano-nao-encontrado" });
        continue;
      }

      // Valor
      const fipeValor = await getValor(fipeMarca.codigo, fipeModelo.codigo, fipeAno.codigo);
      const precoFipe = parseFipeValor(fipeValor.Valor);
      if (!Number.isFinite(precoFipe) || precoFipe <= 0) {
        for (const v of veiculosGrupo) erros.push({ chassi: v.chassi, modelo: v.modelo, motivo: "erro-api", detalhe: `Valor inválido: ${fipeValor.Valor}` });
        continue;
      }

      const match: FipeMatch = {
        marcaCod: fipeMarca.codigo,
        marcaNome: fipeMarca.nome,
        modeloCod: fipeModelo.codigo,
        modeloNome: fipeModelo.nome,
        anoCod: fipeAno.codigo,
        anoNome: fipeAno.nome,
      };

      for (const v of veiculosGrupo) {
        items[v.chassi] = { chassi: v.chassi, precoFipe, match };
        matches++;
      }

      // Delay leve só após chamadas reais (cache hits são instantâneos)
      await sleep(DELAY_BETWEEN_CALLS_MS);
    } catch (err) {
      const detalhe = err instanceof Error ? err.message : String(err);
      for (const v of veiculosGrupo) erros.push({ chassi: v.chassi, modelo: v.modelo, motivo: "erro-api", detalhe });
    }
  }

  const result: BatchResult = {
    timestamp: Date.now(),
    items,
    erros,
    totalGrupos: grupos.size,
    totalVeiculos: veiculos.length,
  };

  report({
    fase: "concluido",
    atual: grupos.size,
    total: grupos.size,
    mensagem: `Pronto: ${matches} carros com FIPE · ${erros.length} sem match`,
    matchesAteAgora: matches,
    errosAteAgora: erros.length,
  });

  // Persiste no Supabase + atualiza cache
  try {
    await saveBatchToSupabase(result);
    cached = result;
    loaded = true;
    notify();
  } catch (err) {
    console.warn("Falha ao salvar batch FIPE no Supabase:", err);
  }

  return result;
}

/**
 * Lê o batch result do cache em memória (já carregado pelo hook).
 * Retorna null se ainda não carregado ou batch expirado (>7 dias).
 */
export function loadCachedBatch(): BatchResult | null {
  if (!cached) return null;
  if (Date.now() - cached.timestamp > BATCH_TTL_MS) return null;
  return cached;
}

/** Idade do batch em horas (ou null se não houver). */
export function batchIdadeHoras(): number | null {
  const c = loadCachedBatch();
  if (!c) return null;
  return (Date.now() - c.timestamp) / (1000 * 60 * 60);
}

/** Limpa o batch (Supabase + cache + dispara evento). Fire-and-forget. */
export function clearBatch(): void {
  cached = null;
  loaded = true;
  notify();
  clearBatchSupabase().catch((err) => console.warn("Falha ao limpar batch FIPE no Supabase:", err));
}

/**
 * Helper pra UI: calcula o desvio % do preço atual vs FIPE de um carro.
 * Positivo = pedindo MAIS que a FIPE (potencial de não vender).
 * Negativo = pedindo MENOS que a FIPE (deixando dinheiro na mesa).
 */
export function calcularDesvioFipe(
  precoVenda: number | null,
  precoFipe: number | null,
): { desvio: number; pct: number } | null {
  if (precoVenda == null || precoFipe == null || precoFipe <= 0) return null;
  const desvio = precoVenda - precoFipe;
  const pct = (desvio / precoFipe) * 100;
  return { desvio, pct };
}
