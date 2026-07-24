/**
 * REGISTRY DE FONTES DO GERADOR DE RELATÓRIOS
 *
 * Nesta fatia (A) só a fonte "estoque" tem catálogo implementado. As demais
 * ("vendas", "custos", "patio") são rejeitadas com erro CLARO — a UI nunca
 * deveria oferecê-las ainda, mas o guard protege contra defs carregados de
 * modelos salvos numa versão futura (fatia B/C).
 */

import type { FonteRelatorio } from "@/lib/export/relatorio/tipos";

const FONTES_IMPLEMENTADAS: readonly FonteRelatorio[] = ["estoque"];

export function fonteImplementada(fonte: FonteRelatorio): boolean {
  return FONTES_IMPLEMENTADAS.includes(fonte);
}

/** Lança erro claro se a fonte ainda não tem catálogo nesta versão do gerador. */
export function validarFonteImplementada(fonte: FonteRelatorio): void {
  if (!fonteImplementada(fonte)) {
    throw new Error(
      `Fonte "${fonte}" ainda não implementada nesta versão do gerador ` +
        `(disponível: ${FONTES_IMPLEMENTADAS.join(", ")}).`,
    );
  }
}
