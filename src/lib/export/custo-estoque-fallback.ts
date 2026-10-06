/**
 * FALLBACK MANUAL pras 5 categorias de custo de estoque sem fonte automática
 * confiável no Oracle (HoldBack, Acessórios, Comissões, ADM, Despesas
 * Gerais — ver colunas-estoque.ts e migration 047_investigacao_*).
 *
 * Prioridade INVERSA à do Vendas Matriz (`vendas-matriz/coletar-dados.ts`,
 * que prefere o upload manual por ser mais específico por venda): aqui o
 * AUTOMÁTICO (sync Oracle, atualizado a cada 2h) prevalece quando tem valor,
 * e o MANUAL (upload do PDF "Custos de Veículos em Estoque" em /upload,
 * feito sob demanda pelo Marcos — pode estar desatualizado) só entra quando
 * o automático vier "sem dado":
 *   - categorias sempre-número (HoldBack/Acessórios/Comissões): "sem dado" =
 *     zero (nunca null — fato conhecido ausente, ver VeiculoParsed).
 *   - categorias "não apurado" (ADM/Despesas Gerais): "sem dado" = null
 *     (nenhum sync/parser escreve valor nelas hoje).
 *
 * Quando NEM automático nem manual têm valor, devolve o próprio automático
 * (já carrega o sentinela certo pra cada categoria: 0 ou null) — não inventa
 * um terceiro valor.
 */
export function resolverCustoComFallbackManual(
  automatico: number | null | undefined,
  manual: number | null | undefined,
): number | null {
  if (automatico != null && automatico !== 0) return automatico;
  if (manual != null) return manual;
  return automatico ?? null;
}
