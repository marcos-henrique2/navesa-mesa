/**
 * CUSTO REAL = Entrada (NF) − Valoriza (bônus fábrica).
 *
 * Fórmula compartilhada entre o Relatório de Estoque Customizado
 * (`colunas-estoque.ts`, coluna `custo_real`) e o Vendas Usados Matriz
 * (`vendas-matriz/tipos.ts`, campo `custoReal` de `calcularDerivadosLinha`) —
 * extraída pra UM lugar só pra garantir que os dois relatórios NUNCA divirjam.
 *
 * `null` quando não há NF de entrada: sem base de entrada, "custo real" seria
 * só `-valoriza`, o que exibiria custo negativo sem sentido (mesma guarda já
 * usada em analise-navesa.ts e no cálculo original de `calcularDerivadosLinha`).
 */
export function calcularCustoReal(nfEntrada: number | null, valoriza: number | null): number | null {
  return nfEntrada != null ? nfEntrada - (valoriza ?? 0) : null;
}
