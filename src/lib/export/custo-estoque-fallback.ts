/**
 * FALLBACK MANUAL pras categorias de custo de estoque sem fonte automática
 * 100% confiável no Oracle (HoldBack, Acessórios, Comissões, Impostos,
 * Despesas Gerais, ADM — ver colunas-estoque.ts e migrations 046, 047 e
 * 048_despesas_gerais_automatico_tipo9).
 *
 * Prioridade INVERSA à do Vendas Matriz (`vendas-matriz/coletar-dados.ts`,
 * que prefere o upload manual por ser mais específico por venda): aqui o
 * AUTOMÁTICO (sync Oracle, atualizado a cada 2h) prevalece quando tem valor,
 * e o MANUAL (upload do PDF "Custos de Veículos em Estoque" em /upload,
 * feito sob demanda pelo Marcos — pode estar desatualizado) só entra quando
 * o automático vier "sem dado":
 *   - categorias sempre-número (HoldBack/Acessórios/Comissões/Impostos e,
 *     desde 07/10/2026, Despesas Gerais — migration 048): "sem dado" = zero
 *     (nunca null — fato conhecido ausente, ver VeiculoParsed).
 *   - categoria "não apurado" (ADM): "sem dado" = null (nenhum sync/parser
 *     escreve valor nela hoje).
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

/**
 * Variante de `resolverCustoComFallbackManual` com prioridade INVERTIDA —
 * usada SÓ pra Impostos (ver colunas-estoque.ts). O manual vence sempre que
 * existir (não-nulo), independente do automático. Motivo: o automático de
 * Impostos é uma métrica REAL mas DIFERENTE do valor do relatório nativo NBS
 * (`confianca: "diverge_relatorio"`, migration 046) — mesmo ≠0, pode divergir
 * do PDF real (confirmado em auditoria de 628 carros, 07/10/2026: 14 casos,
 * ex. placa RBV7G98, automático=R$1.600 vs PDF real=R$2.740,80). O manual
 * (upload do PDF) É o valor do relatório nativo, então deve prevalecer
 * sempre que presente — mesmo quando vier 0 (não cai pro automático nesse
 * caso: 0 é o valor real do relatório, não "sem dado").
 *
 * Impostos é categoria sempre-número (nunca null, mesmo padrão das outras
 * sempre-número): sem manual e sem automático, devolve 0.
 */
export function resolverCustoImpostosComPrioridadeManual(
  automatico: number | null | undefined,
  manual: number | null | undefined,
): number | null {
  if (manual != null) return manual;
  return automatico ?? 0;
}
