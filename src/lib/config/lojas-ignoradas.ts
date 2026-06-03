/**
 * Lojas que devem ser ignoradas em TODOS os relatórios, KPIs, rankings, exportações.
 * Aplicado na camada de carregamento (inventoryStore) — todos os componentes downstream
 * recebem dados já filtrados.
 *
 * Pra adicionar/remover loja: edite o array abaixo.
 */
export const LOJAS_IGNORADAS = new Set<number>([
  29, // NAVESA FORD CAMPO GRANDE — não usada
]);

export function isLojaIgnorada(codEmpresa: number | null | undefined): boolean {
  if (codEmpresa == null) return false;
  return LOJAS_IGNORADAS.has(codEmpresa);
}
