/**
 * BATCH FIPE MATCHER
 *
 * Resolve preço FIPE pra um array inteiro de veículos do estoque ou histórico de vendas.
 *
 * Estratégia:
 *   1. Agrupa veículos por (marca, modelo, ano, comb) — muitos carros iguais → 1 chamada FIPE.
 *   2. Pra cada grupo único: resolve marca → modelos → ano → valor (4 chamadas).
 *   3. Aplica o resultado em cada veículo do grupo, validando plausibilidade
 *      individualmente (`custo_total` é por veículo).
 *   4. Salva tudo no Supabase indexado por chassi.
 *
 * Cache: persiste o batch result no Supabase (tabela fipe_batch). Hook useFipeBatch
 * mantém uma cópia em memória pra leitura síncrona reativa.
 */

import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";
import type { FipeMatch } from "./types";
import { findMarca, findModelos, findAno } from "./matcher";
import { getMarcas, getModelos, getAnos, getValor, parseFipeValor, clearFipeLocalCache } from "./service";
import {
  loadBatchFromSupabase,
  saveBatchToSupabase,
  clearBatchSupabase,
} from "@/lib/data/fipe-batch";

const BATCH_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias (FIPE muda mensalmente, mas estoque diariamente)
const DELAY_BETWEEN_CALLS_MS = 100; // 10 req/s — confortável pra API gratuita
const EVT = "navesa-mesa:fipe-batch-updated";
/** B.2b-F12: dispara quando o set de chassis com FIPE local "dirty" muda. */
const EVT_DIRTY = "navesa-mesa:fipe-dirty-updated";

export type BatchFipeItem = {
  chassi: string;
  precoFipe: number;
  match: FipeMatch;
  /**
   * Score do match de modelo que originou esse preço (`findModelos`).
   *
   * `null` = procedência desconhecida (linha gravada antes da coluna `score` existir).
   * Tratamos `null` como NÃO confirmado — as linhas legadas são justamente as que
   * podem carregar o preço contaminado. Overrides manuais do `FipeReviewDrawer`
   * gravam `SCORE_MANUAL` (1) porque foram escolhidos por um humano.
   */
  score: number | null;
  /**
   * `true` só quando o guard `validarPlausibilidadeFipe` RODOU e aprovou.
   *
   * Score alto prova que o nome do modelo casou; não prova que o preço faz
   * sentido pro carro. Sem `custo_total` o guard não roda — e um item nunca
   * verificado precisa ser distinguível de um verificado e aprovado, inclusive
   * depois de um reload. Por isso o sinal é persistido, não só reportado.
   */
  plausibilidadeVerificada: boolean;
};

export type BatchFipeError = {
  chassi: string;
  modelo: string;
  motivo:
    | "marca-nao-encontrada"
    | "modelo-nao-encontrado"
    | "ano-nao-encontrado"
    | "erro-api"
    | "preco-implausivel"
    | "score-baixo"
    /** Match aceito, mas sem `custo_total` — o guard de plausibilidade não pôde rodar. */
    | "sem-custo-referencia";
  detalhe?: string;
};

// ───── Congelamento da FIPE: limiares de confiança ──────────────────────────

/** Score mínimo de `findModelos` pra exibir/usar o preço FIPE como referência. */
export const FIPE_SCORE_MIN = 0.6;

/** Score atribuído a um match escolhido manualmente por um humano. */
export const SCORE_MANUAL = 1;

/** Piso de plausibilidade: FIPE abaixo de 60% do custo total é match errado. */
export const FIPE_RATIO_MIN = 0.6;

/** Teto de plausibilidade: FIPE acima de 250% do custo total é match errado. */
export const FIPE_RATIO_MAX = 2.5;

export type PlausibilidadeFipe = {
  /** `false` só quando o guard rodou E reprovou. */
  ok: boolean;
  /** `false` quando não havia `custo_total` utilizável — nada foi validado. */
  aplicado: boolean;
  motivo?: "abaixo-do-piso" | "acima-do-teto";
  detalhe?: string;
};

/**
 * Guard de sanidade: um preço FIPE muito distante do custo total do veículo é,
 * na prática, um match de modelo/ano errado — não uma oportunidade de margem.
 *
 * Quando `custoTotal` é null/zero não há como validar; devolvemos `ok: true` com
 * `aplicado: false` pra que o caller registre que o veículo passou sem verificação.
 */
export function validarPlausibilidadeFipe(
  precoFipe: number,
  custoTotal: number | null | undefined,
): PlausibilidadeFipe {
  if (custoTotal == null || !Number.isFinite(custoTotal) || custoTotal <= 0) {
    return { ok: true, aplicado: false };
  }
  const piso = custoTotal * FIPE_RATIO_MIN;
  const teto = custoTotal * FIPE_RATIO_MAX;
  if (precoFipe < piso) {
    return {
      ok: false,
      aplicado: true,
      motivo: "abaixo-do-piso",
      detalhe: `FIPE ${precoFipe} < ${FIPE_RATIO_MIN * 100}% do custo total ${custoTotal}`,
    };
  }
  if (precoFipe > teto) {
    return {
      ok: false,
      aplicado: true,
      motivo: "acima-do-teto",
      detalhe: `FIPE ${precoFipe} > ${FIPE_RATIO_MAX * 100}% do custo total ${custoTotal}`,
    };
  }
  return { ok: true, aplicado: true };
}

/**
 * `true` só quando as DUAS provas existem: o nome do modelo casou bem (score) e
 * o preço foi confrontado com o custo do carro (plausibilidade verificada).
 *
 * Exigir as duas é o que impede o caminho de vendas — que rodava sem
 * `custo_total` — de produzir linhas que parecem confirmadas mas nunca passaram
 * por nenhuma checagem de valor.
 */
export function isFipeConfirmado(item: BatchFipeItem | null | undefined): boolean {
  if (!item) return false;
  if (item.score == null) return false;
  if (!item.plausibilidadeVerificada) return false;
  return item.score >= FIPE_SCORE_MIN && item.precoFipe > 0;
}

/**
 * Preço FIPE utilizável como referência de precificação.
 *
 * Retorna `null` quando o match não é confirmado — consumidores devem tratar
 * exatamente como "sem FIPE" (cair no proxy de custo), nunca exibir o número.
 */
export function precoFipeConfiavel(
  batch: { items: Record<string, BatchFipeItem> } | null | undefined,
  chassi: string,
): number | null {
  const item = batch?.items?.[chassi];
  if (!item || !isFipeConfirmado(item)) return null;
  return item.precoFipe;
}

/** Quantos chassis do batch têm FIPE efetivamente confirmada. */
export function contarFipeConfirmada(
  batch: { items: Record<string, BatchFipeItem> } | null | undefined,
): number {
  if (!batch) return 0;
  let n = 0;
  for (const item of Object.values(batch.items)) if (isFipeConfirmado(item)) n++;
  return n;
}

export type BatchResult = {
  timestamp: number;
  items: Record<string, BatchFipeItem>; // chassi → resultado
  erros: BatchFipeError[];
  totalGrupos: number;
  totalVeiculos: number;
  /**
   * Mensagem de falha ao gravar o batch no Supabase, ou `null` se persistiu.
   *
   * Antes essa falha era engolida por um `console.warn` e a UI seguia exibindo
   * "Pronto: N carros com FIPE" com ZERO linha gravada. Dado financeiro não
   * pode falhar em silêncio — o caller é obrigado a olhar esse campo.
   */
  persistenciaErro: string | null;
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

/**
 * B.2b-F12: set de chassis cujo cache em memória DIVERGE do Supabase
 * (`upsertBatchItem` atualizou o cache mas a persistência falhou). UI usa
 * `isFipeDirty(chassi)` pra mostrar badge "FIPE local não sincronizado" e
 * alertar que decisão de precificação está sobre dado fantasma.
 */
const chassisDirty = new Set<string>();

function notify() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVT));
}

function notifyDirty() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVT_DIRTY));
}

/** Retorna `true` se o chassi tem override FIPE em memória que ainda não foi persistido. */
export function isFipeDirty(chassi: string): boolean {
  return chassisDirty.has(chassi);
}

/** Snapshot do set de chassis dirty (cópia — não muta o set interno). */
export function getFipeDirtyChassis(): string[] {
  return Array.from(chassisDirty);
}

/** Nome do evento DOM disparado quando o set dirty muda. UI escuta via `useEffect`. */
export const FIPE_DIRTY_EVENT = EVT_DIRTY;

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
    return {
      timestamp: Date.now(),
      items: {},
      erros: [],
      totalGrupos: 0,
      totalVeiculos: 0,
      persistenciaErro: null,
    };
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
      const score = modeloMatches[0].score;

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

      // O lookup é por grupo, mas a validação é POR VEÍCULO: `custo_total` é
      // individual, então um match ruim não contamina o grupo inteiro em bloco.
      for (const v of veiculosGrupo) {
        const plausivel = validarPlausibilidadeFipe(precoFipe, v.custo_total);
        if (!plausivel.ok) {
          erros.push({
            chassi: v.chassi,
            modelo: v.modelo,
            motivo: "preco-implausivel",
            detalhe: `${fipeModelo.nome} ${fipeAno.nome}: ${plausivel.detalhe}`,
          });
          continue;
        }

        // O sinal de "guard rodou" vai DENTRO do item, não só no array de erros:
        // o array morre no reload, o item é persistido.
        items[v.chassi] = {
          chassi: v.chassi,
          precoFipe,
          match,
          score,
          plausibilidadeVerificada: plausivel.aplicado,
        };

        if (score < FIPE_SCORE_MIN) {
          // Persistimos pra que o usuário possa revisar/corrigir no drawer, mas
          // registramos como não coberto — a UI vai exibir "FIPE não confirmada".
          erros.push({
            chassi: v.chassi,
            modelo: v.modelo,
            motivo: "score-baixo",
            detalhe: `score ${score.toFixed(2)} < ${FIPE_SCORE_MIN} em "${fipeModelo.nome}"`,
          });
          continue;
        }

        if (!plausivel.aplicado) {
          // Sem custo_total não dá pra validar. Não bloqueia, mas fica no relatório.
          erros.push({
            chassi: v.chassi,
            modelo: v.modelo,
            motivo: "sem-custo-referencia",
            detalhe: "custo_total ausente — plausibilidade não verificada",
          });
        }

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
    persistenciaErro: null,
  };

  report({
    fase: "concluido",
    atual: grupos.size,
    total: grupos.size,
    mensagem: `Pronto: ${matches} carros com FIPE · ${erros.length} sem match`,
    matchesAteAgora: matches,
    errosAteAgora: erros.length,
  });

  // Persiste no Supabase + atualiza cache.
  //
  // Falha aqui NÃO pode ser silenciosa: o caso concreto é a coluna `score` não
  // existir ainda (migration 021 não aplicada) — o PostgREST devolve PGRST204,
  // nada é gravado, e sem esse sinal a UI anunciava "Pronto: N carros com FIPE".
  try {
    await saveBatchToSupabase(result);
    cached = result;
    loaded = true;
    notify();
  } catch (err) {
    const detalhe = err instanceof Error ? err.message : String(err);
    console.error("Falha ao salvar batch FIPE no Supabase:", err);
    const comErro: BatchResult = {
      ...result,
      persistenciaErro:
        `Os preços NÃO foram salvos no banco — eles valem só nesta aba e se perdem ao recarregar. Detalhe: ${detalhe}`,
    };
    // Cache em memória segue populado (a UI atual continua utilizável), mas o
    // caller é obrigado a exibir `persistenciaErro`.
    cached = comErro;
    loaded = true;
    notify();
    return comErro;
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

/**
 * Limpa o batch: cache em memória + localStorage FIPE + tabela `fipe_batch`.
 *
 * O `clearFipeLocalCache()` é obrigatório aqui — limpar só a tabela deixava o
 * cache de 30 dias do localStorage reproduzir os mesmos matches errados na
 * próxima execução.
 */
export function clearBatch(): void {
  cached = null;
  loaded = true;
  clearFipeLocalCache();
  notify();
  clearBatchSupabase().catch((err) => console.warn("Falha ao limpar batch FIPE no Supabase:", err));
}

/**
 * Atualiza/insere um item no batch FIPE em memória + Supabase + dispara evento.
 *
 * Usado quando o usuário corrige manualmente o match FIPE de um carro pelo
 * `FipeReviewDrawer` — precisa propagar pro `useFipeBatch` em tempo real
 * pra que `usePrecificacao` recalcule o diagnóstico com o novo preço.
 *
 * Retorna `true` se a persistência no Supabase teve sucesso, `false` caso contrário.
 * O cache em memória é sempre atualizado (UI reage instantaneamente), mas o caller
 * deve checar o retorno pra alertar o usuário se o Supabase falhou — senão o override
 * existe só na aba atual e se perde no próximo reload.
 */
export async function upsertBatchItem(item: BatchFipeItem): Promise<boolean> {
  const now = Date.now();
  if (cached) {
    // NÃO mexe em `cached.timestamp`: rejuvenescer o batch inteiro a cada override
    // manual fazia o TTL de 7 dias nunca vencer, então um match errado nunca expirava.
    // A frescura de cada linha vive no `atualizado_em` dela no Supabase.
    cached = {
      ...cached,
      items: { ...cached.items, [item.chassi]: item },
      totalVeiculos: Object.keys(cached.items).includes(item.chassi)
        ? cached.totalVeiculos
        : cached.totalVeiculos + 1,
    };
  } else {
    cached = {
      timestamp: now,
      items: { [item.chassi]: item },
      erros: [],
      totalGrupos: 0,
      totalVeiculos: 1,
      persistenciaErro: null,
    };
  }
  loaded = true;
  notify();

  // B.2b-F12: marca como dirty ANTES do await — cobre o caso do await rejeitar.
  // Só remove quando o Supabase confirmar persistência.
  chassisDirty.add(item.chassi);
  notifyDirty();

  try {
    await saveBatchToSupabase({
      timestamp: now,
      items: { [item.chassi]: item },
      erros: [],
      totalGrupos: 0,
      totalVeiculos: 1,
      persistenciaErro: null,
    });
    chassisDirty.delete(item.chassi);
    notifyDirty();
    return true;
  } catch (err) {
    console.error("Falha ao persistir match FIPE manual no Supabase:", err);
    // Mantém dirty — UI vai mostrar badge persistente até o usuário recarregar.
    return false;
  }
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
