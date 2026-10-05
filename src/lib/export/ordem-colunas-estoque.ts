/**
 * ORDEM DE EXPORTAÇÃO DO RELATÓRIO DE ESTOQUE (puro / testável)
 *
 * Lógica por trás da seção "Ordem de exportação" do modal de Relatório de
 * Estoque Customizado (`ConfigurarRelatorioEstoqueModal`): uma lista PLANA e
 * unificada de todos os itens selecionados (colunas de dado marcadas +
 * colunas em branco nomeadas), que o Marcos pode reordenar com os botões
 * subir/descer. Essa ordem é literalmente a ordem das colunas no XLSX gerado
 * (ver `resolverOrdemParaExportacao` + `construirDefEstoque` em
 * `relatorio/estoque.ts`).
 *
 * Cada item é identificado por um TOKEN estável:
 *  - "col:<columnKey>"  → coluna de catálogo (ver `colunas-estoque.ts`)
 *  - "branco:<id>"      → coluna em branco nomeada (id de `ColunaBranco`)
 *
 * A lista de tokens é persistida (`estoque:relatorioCustom:ordem`) e
 * reconciliada a cada render contra a seleção atual via
 * `reconciliarOrdemColunas` — no mesmo espírito de `migrarColunasBrancoLegado`
 * (colunas-branco.ts): remove tokens que não fazem mais parte da seleção e
 * anexa no FIM qualquer item selecionado ainda ausente da ordem.
 */

import { COLUNAS_ESTOQUE, GRUPO_LABEL, type ColunaKey } from "@/lib/export/colunas-estoque";
import type { ColunaBranco } from "@/lib/export/colunas-branco";

const PREFIXO_COLUNA = "col:";
const PREFIXO_BRANCO = "branco:";

/** Tag discreta de origem usada nas colunas em branco na seção de ordem. */
export const TAG_GRUPO_BRANCO = "Branco";

export function tokenColuna(key: ColunaKey): string {
  return `${PREFIXO_COLUNA}${key}`;
}

export function tokenBranco(id: string): string {
  return `${PREFIXO_BRANCO}${id}`;
}

export function ehTokenColuna(token: string): boolean {
  return token.startsWith(PREFIXO_COLUNA);
}

export function ehTokenBranco(token: string): boolean {
  return token.startsWith(PREFIXO_BRANCO);
}

/** Extrai a `ColunaKey` de um token "col:<key>" (chamar só depois de `ehTokenColuna`). */
export function colunaKeyDoToken(token: string): ColunaKey {
  return token.slice(PREFIXO_COLUNA.length) as ColunaKey;
}

/** Extrai o id de `ColunaBranco` de um token "branco:<id>" (chamar só depois de `ehTokenBranco`). */
export function idBrancoDoToken(token: string): string {
  return token.slice(PREFIXO_BRANCO.length);
}

const COLUNA_POR_KEY = new Map(COLUNAS_ESTOQUE.map((c) => [c.key, c]));

/**
 * Reconcilia a ordem persistida contra a seleção ATUAL de colunas/colunas em
 * branco:
 *  1. Mantém, NA MESMA POSIÇÃO RELATIVA, só os tokens cuja coluna/branco ainda
 *     está selecionado/nomeado.
 *  2. Anexa no FIM as colunas de dado selecionadas ainda ausentes da ordem,
 *     na ordem do CATÁLOGO (determinístico — com 1 item novo de cada vez,
 *     que é o caso comum, isso é exatamente "a nova entra no fim"; também
 *     reconstrói, de uma vez, a ordem de quem já tinha seleção salva ANTES
 *     desta feature, igual à ordem de export de sempre).
 *  3. Anexa no FIM as colunas em branco nomeadas ainda ausentes da ordem, na
 *     ordem em que aparecem em `colunasBranco` (ordem de criação).
 *
 * Pura — chamar a cada render (como `migrarColunasBrancoLegado`), nunca muta
 * os arrays recebidos.
 */
export function reconciliarOrdemColunas(
  ordemAtual: readonly string[],
  colunasSel: readonly ColunaKey[],
  colunasBranco: readonly ColunaBranco[],
): string[] {
  const selecionadas = new Set(colunasSel);
  const brancoNomeadoPorId = new Map(
    colunasBranco.filter((c) => c.nome.trim() !== "").map((c) => [c.id, c] as const),
  );

  const valido = (token: string): boolean => {
    if (ehTokenColuna(token)) return selecionadas.has(colunaKeyDoToken(token));
    if (ehTokenBranco(token)) return brancoNomeadoPorId.has(idBrancoDoToken(token));
    return false;
  };

  const mantidos = ordemAtual.filter(valido);
  const jaNaOrdem = new Set(mantidos);

  const novasColunas = COLUNAS_ESTOQUE.filter(
    (c) => selecionadas.has(c.key) && !jaNaOrdem.has(tokenColuna(c.key)),
  ).map((c) => tokenColuna(c.key));

  const novosBrancos = colunasBranco
    .filter((c) => c.nome.trim() !== "" && !jaNaOrdem.has(tokenBranco(c.id)))
    .map((c) => tokenBranco(c.id));

  return [...mantidos, ...novasColunas, ...novosBrancos];
}

export type ItemOrdemExportacao = {
  /** Token estável — usar como `key` do React e identificador do item. */
  token: string;
  label: string;
  /** Tag discreta de origem: nome do grupo de catálogo, ou "Branco". */
  tagGrupo: string;
};

/**
 * Resolve os tokens de `ordem` pros itens exibíveis na seção "Ordem de
 * exportação" (label + tag de origem), na mesma sequência. Token que não
 * resolve mais (coluna removida do catálogo, branco sem nome/removido) é
 * simplesmente omitido — a UI nunca deveria ter esse caso depois de
 * `reconciliarOrdemColunas`, mas a função fica defensiva mesmo assim.
 */
export function itensOrdemExportacao(
  ordem: readonly string[],
  colunasBranco: readonly ColunaBranco[],
): ItemOrdemExportacao[] {
  const brancoPorId = new Map(colunasBranco.map((c) => [c.id, c]));
  const itens: ItemOrdemExportacao[] = [];
  for (const token of ordem) {
    if (ehTokenColuna(token)) {
      const col = COLUNA_POR_KEY.get(colunaKeyDoToken(token));
      if (col) itens.push({ token, label: col.label, tagGrupo: GRUPO_LABEL[col.grupo] });
    } else if (ehTokenBranco(token)) {
      const branco = brancoPorId.get(idBrancoDoToken(token));
      const nome = branco?.nome.trim();
      if (nome) itens.push({ token, label: nome, tagGrupo: TAG_GRUPO_BRANCO });
    }
  }
  return itens;
}

/**
 * Move o item no índice `indice` uma posição pra cima/baixo. SEM
 * wrap-around: mover o 1º item pra cima (ou o último pra baixo) é no-op
 * (devolve cópia). Índice fora da faixa também é no-op.
 */
export function moverItemOrdem(
  ordem: readonly string[],
  indice: number,
  direcao: "cima" | "baixo",
): string[] {
  if (indice < 0 || indice >= ordem.length) return [...ordem];
  const alvo = direcao === "cima" ? indice - 1 : indice + 1;
  if (alvo < 0 || alvo >= ordem.length) return [...ordem];
  const next = [...ordem];
  const tmp = next[indice]!;
  next[indice] = next[alvo]!;
  next[alvo] = tmp;
  return next;
}

/** `aria-label` do botão subir/descer, posição 1-based. */
export function ariaLabelMoverItem(
  label: string,
  posicao: number,
  total: number,
  direcao: "cima" | "baixo",
): string {
  return `Mover ${label} para ${direcao} (posição ${posicao} de ${total})`;
}

/** Mensagem do `aria-live` anunciada depois de mover um item, posição 1-based. */
export function mensagemItemMovido(label: string, posicao: number, total: number): string {
  return `${label} movida para a posição ${posicao} de ${total}.`;
}

/**
 * Traduz a ordem (tokens "col:<key>" / "branco:<id>") pro formato que
 * `construirDefEstoque` entende: "col:<key>" passa direto; "branco:<id>" vira
 * "branco:<índice>", onde índice é a posição (0-based) do branco dentro de
 * `colunasBranco` DEPOIS de filtrar só os nomeados — a MESMA lista/ordem que
 * `colunasBrancoParaExportar` produz, que é o array passado como
 * `colunasBranco` pra `construirDefEstoque`. Token de branco cujo id não
 * resolve (removido/sem nome) é omitido.
 */
export function resolverOrdemParaExportacao(
  ordem: readonly string[],
  colunasBranco: readonly ColunaBranco[],
): string[] {
  const nomeados = colunasBranco.filter((c) => c.nome.trim() !== "");
  const indicePorId = new Map(nomeados.map((c, i) => [c.id, i] as const));

  const resultado: string[] = [];
  for (const token of ordem) {
    if (ehTokenColuna(token)) {
      resultado.push(token);
    } else if (ehTokenBranco(token)) {
      const idx = indicePorId.get(idBrancoDoToken(token));
      if (idx != null) resultado.push(`${PREFIXO_BRANCO}${idx}`);
    }
  }
  return resultado;
}
