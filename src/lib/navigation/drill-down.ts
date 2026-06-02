/**
 * Drill-down de alertas: aplica filtros no sessionStorage (mesmo formato do
 * `usePersistedState`) ANTES de navegar pra rota destino. O componente destino
 * (VeiculosTable / VendasAnalise) lê do storage no mount via useSyncExternalStore
 * e renderiza já filtrado.
 *
 * Por que sessionStorage e não query string? O app usa `usePersistedState` como
 * fonte da verdade dos filtros — esse hook lê de sessionStorage no mount. Setar
 * lá direto evita ter que duplicar a lógica de hidratação por query string.
 */

const PREFIX = "navesa-mesa:filtros:";

const PREFIX_POR_ROTA: Record<"/veiculos" | "/vendas", string> = {
  "/veiculos": "veiculos:",
  "/vendas": "vendas:",
};

export type RotaDrillDown = "/veiculos" | "/vendas";

/**
 * Aplica `filtros` no sessionStorage com o prefixo da rota e retorna a rota
 * destino. O caller é responsável por chamar `router.push(rota)` em seguida.
 *
 * Tolerante a sessionStorage indisponível (Safari private mode, quota cheia) —
 * nesse caso a navegação acontece sem filtros aplicados.
 *
 * Não limpa filtros antigos da rota — só sobrepõe os mencionados. Filtros
 * pré-existentes que não estão em `filtros` ficam como estavam.
 */
export function aplicarFiltrosDrillDown(
  rota: RotaDrillDown,
  filtros: Record<string, string>,
): RotaDrillDown {
  if (typeof window === "undefined") return rota;
  const subPrefix = PREFIX_POR_ROTA[rota];
  try {
    for (const [key, value] of Object.entries(filtros)) {
      const fullKey = PREFIX + subPrefix + key;
      const raw = JSON.stringify(value);
      window.sessionStorage.setItem(fullKey, raw);
      // usePersistedState escuta StorageEvent pra sincronizar entre componentes.
      // Disparamos manualmente porque o storage event nativo não dispara na
      // própria aba que escreveu.
      window.dispatchEvent(new StorageEvent("storage", { key: fullKey, newValue: raw }));
    }
  } catch {
    // sessionStorage indisponível — segue navegação sem filtros
  }
  return rota;
}
