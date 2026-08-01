/**
 * Fila de prioridade dos interessados (lead quente) — melhoria da tela de
 * interessados por carro.
 *
 * Camada PURA (sem Supabase, sem "use client") — 100% testável. Opera sobre os
 * dados que já existem em `lead_interesses` (qtd_visualizacoes, status_followup).
 *
 * Regras:
 *   - "alta intenção" = qtd_visualizacoes >= LIMIAR_ALTA_INTENCAO.
 *   - fila padrão: primeiro os "novo" (não contatados) COM alta intenção; depois
 *     os demais. Desempate sempre por qtd_visualizacoes desc.
 *   - filtros rápidos (chips): alta intenção e/ou sem contato (status "novo").
 */

/** A partir de quantas visualizações o lead é considerado "alta intenção". */
export const LIMIAR_ALTA_INTENCAO = 3;

/** Shape mínimo que a fila precisa — qualquer interesse com esses campos serve. */
export type ItemFila = {
  status_followup: string;
  qtd_visualizacoes: number;
};

/** true quando o lead visualizou o anúncio LIMIAR_ALTA_INTENCAO+ vezes. */
export function ehAltaIntencao(qtdVisualizacoes: number): boolean {
  return Number.isFinite(qtdVisualizacoes) && qtdVisualizacoes >= LIMIAR_ALTA_INTENCAO;
}

/** true quando ainda não houve contato (status "novo"). */
export function semContato(item: ItemFila): boolean {
  return item.status_followup === "novo";
}

/**
 * Prioridade da fila (menor = topo):
 *   0 → "novo" (não contatado) E alta intenção (o lead mais quente pra ligar já)
 *   1 → todos os demais
 * Dentro do mesmo tier, desempata por qtd_visualizacoes desc.
 */
function tier(item: ItemFila): number {
  return semContato(item) && ehAltaIntencao(item.qtd_visualizacoes) ? 0 : 1;
}

/**
 * Ordena a fila (não muta a entrada). Estável por construção do comparador:
 * tier asc, depois qtd_visualizacoes desc.
 */
export function ordenarFilaInteressados<T extends ItemFila>(lista: ReadonlyArray<T>): T[] {
  return [...lista].sort((a, b) => {
    const dt = tier(a) - tier(b);
    if (dt !== 0) return dt;
    return b.qtd_visualizacoes - a.qtd_visualizacoes;
  });
}

export type FiltroFila = {
  altaIntencao?: boolean;
  semContato?: boolean;
};

/** Aplica os chips de filtro rápido (reduz a lista). Não ordena. */
export function filtrarFilaInteressados<T extends ItemFila>(
  lista: ReadonlyArray<T>,
  filtro: FiltroFila,
): T[] {
  return lista.filter((i) => {
    if (filtro.altaIntencao && !ehAltaIntencao(i.qtd_visualizacoes)) return false;
    if (filtro.semContato && !semContato(i)) return false;
    return true;
  });
}
