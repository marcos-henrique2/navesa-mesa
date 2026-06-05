"use client";

/**
 * Configuração das estimativas de custos pós-venda do veículo.
 *
 * Esses percentuais são usados pelo Simulador de Preço pra calcular o
 * "Lucro Líquido Estimado" — o quanto sobra de verdade depois que o
 * carro vender e o NBS computar:
 *   • Impostos sobre venda (PIS/COFINS + ICMS-ST)
 *   • Comissão do vendedor
 *   • Comissão do gerente
 *   • Despesas gerais alocadas
 *
 * Persiste no localStorage do navegador — fica por usuário/máquina.
 * Defaults baseados em prática comum de concessionária seminovos.
 */

const STORAGE_KEY = "navesa-mesa:estimativas-custos-v1";
const EVT_UPDATED = "navesa-mesa:estimativas-custos-updated";

export type EstimativasCustos = {
  /** Percentual de impostos sobre o preço de venda (PIS/COFINS + ICMS-ST). */
  impostosPct: number;
  /**
   * Comissões totais (vendedor + gerente) sobre preço de venda.
   * NBS lança `comissoes` como agregado, não dá pra separar — então
   * usamos uma única taxa.
   */
  comissoesPct: number;
  /** Despesas gerais alocadas (% sobre preço de venda). */
  despesasGeraisPct: number;
};

export const DEFAULTS: EstimativasCustos = {
  impostosPct: 4.0,
  comissoesPct: 1.0, // 0,5% vendedor + 0,5% gerente
  despesasGeraisPct: 0.5,
};

function ehNumero(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function getEstimativas(): EstimativasCustos {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<EstimativasCustos>;
    // Migração leve de chave antiga (vendedor + gerente separados) → comissoesPct.
    const parsedLegacy = parsed as Partial<EstimativasCustos> & {
      comissaoVendedorPct?: number;
      comissaoGerentePct?: number;
    };
    const comissoesPct = ehNumero(parsedLegacy.comissoesPct)
      ? parsedLegacy.comissoesPct
      : (ehNumero(parsedLegacy.comissaoVendedorPct) ? parsedLegacy.comissaoVendedorPct : 0)
        + (ehNumero(parsedLegacy.comissaoGerentePct) ? parsedLegacy.comissaoGerentePct : 0)
        || DEFAULTS.comissoesPct;
    return {
      impostosPct: ehNumero(parsed.impostosPct) ? parsed.impostosPct : DEFAULTS.impostosPct,
      comissoesPct,
      despesasGeraisPct: ehNumero(parsed.despesasGeraisPct) ? parsed.despesasGeraisPct : DEFAULTS.despesasGeraisPct,
    };
  } catch {
    return DEFAULTS;
  }
}

export function setEstimativas(config: EstimativasCustos): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    window.dispatchEvent(new Event(EVT_UPDATED));
  } catch {
    // Falha de storage (quota, modo privado): ignora — defaults seguirão valendo.
  }
}

/** Subscribe pra mudanças (usado em useSyncExternalStore). */
export function subscribeEstimativas(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVT_UPDATED, cb);
  // Sincroniza também entre abas via storage event.
  function onStorage(e: StorageEvent) {
    if (e.key === STORAGE_KEY) cb();
  }
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVT_UPDATED, cb);
    window.removeEventListener("storage", onStorage);
  };
}
