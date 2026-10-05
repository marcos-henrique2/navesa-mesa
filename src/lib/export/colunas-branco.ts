/**
 * COLUNAS EM BRANCO PERSONALIZADAS (puro / testável)
 *
 * Lógica por trás do bloco "Colunas em branco personalizadas" do modal de
 * Relatório de Estoque Customizado (`ConfigurarRelatorioEstoqueModal`):
 * adicionar/inserir/remover/renomear linhas, validar nome vazio/duplicado,
 * migrar a preferência antiga (2 checkboxes fixos "Observações"/"Anotações")
 * e extrair a lista final pra exportação.
 *
 * O modal só chama essas funções — não duplica a lógica (geração de id e
 * foco ficam no componente, que é efeito de DOM, não lógica de negócio).
 */

export type ColunaBranco = { id: string; nome: string };

/** Teto de colunas em branco por export — mesmo limite imposto pelo modal. */
export const LIMITE_COLUNAS_BRANCO = 15;

export function podeAdicionarColunaBranco(lista: readonly ColunaBranco[]): boolean {
  return lista.length < LIMITE_COLUNAS_BRANCO;
}

/** Acrescenta uma linha vazia no FIM da lista. No-op (devolve cópia) se já no limite. */
export function adicionarColunaBranco(lista: readonly ColunaBranco[], novoId: string): ColunaBranco[] {
  if (!podeAdicionarColunaBranco(lista)) return [...lista];
  return [...lista, { id: novoId, nome: "" }];
}

/** Insere uma linha vazia IMEDIATAMENTE DEPOIS de `idAtual` (atalho de Enter). */
export function inserirColunaBrancoApos(
  lista: readonly ColunaBranco[],
  idAtual: string,
  novoId: string,
): ColunaBranco[] {
  if (!podeAdicionarColunaBranco(lista)) return [...lista];
  const idx = lista.findIndex((c) => c.id === idAtual);
  if (idx === -1) return adicionarColunaBranco(lista, novoId);
  const next = [...lista];
  next.splice(idx + 1, 0, { id: novoId, nome: "" });
  return next;
}

export function removerColunaBranco(lista: readonly ColunaBranco[], id: string): ColunaBranco[] {
  return lista.filter((c) => c.id !== id);
}

export function renomearColunaBranco(
  lista: readonly ColunaBranco[],
  id: string,
  nome: string,
): ColunaBranco[] {
  return lista.map((c) => (c.id === id ? { ...c, nome } : c));
}

/**
 * Pra onde o foco deve ir depois de remover a linha `id`: o id da linha
 * ANTERIOR, ou `null` quando era a 1ª/única (nesse caso o foco volta pro
 * botão "+ Adicionar coluna em branco" — decisão de quem chama, não deste
 * módulo puro).
 */
export function focoAposRemover(lista: readonly ColunaBranco[], id: string): string | null {
  const idx = lista.findIndex((c) => c.id === id);
  if (idx <= 0) return null;
  return lista[idx - 1].id;
}

export function nomeVazio(coluna: ColunaBranco): boolean {
  return coluna.nome.trim() === "";
}

/** true quando `coluna` é a 2ª+ ocorrência de um nome (trim + case-insensitive) na lista. */
export function nomeDuplicado(lista: readonly ColunaBranco[], coluna: ColunaBranco): boolean {
  const nomeNorm = coluna.nome.trim().toLowerCase();
  if (nomeNorm === "") return false;
  const primeiraOcorrencia = lista.findIndex((c) => c.nome.trim().toLowerCase() === nomeNorm);
  const indiceAtual = lista.findIndex((c) => c.id === coluna.id);
  return primeiraOcorrencia !== -1 && primeiraOcorrencia < indiceAtual;
}

/**
 * Texto auxiliar (amber) abaixo do input, ou `null` quando não há aviso.
 * Nome vazio tem prioridade sobre duplicado (uma linha vazia nunca é "duplicada").
 */
export function textoAuxiliarColunaBranco(
  lista: readonly ColunaBranco[],
  coluna: ColunaBranco,
): string | null {
  if (nomeVazio(coluna)) return "Sem nome — essa coluna não será exportada.";
  if (nomeDuplicado(lista, coluna)) return "Já existe uma coluna com esse nome.";
  return null;
}

/**
 * Nomes (trim, não-vazios) na ORDEM em que foram adicionados — essa é a lista
 * que vai pro export (`construirDefEstoque({ colunasBranco: ... })`), sempre
 * depois das colunas de dado.
 */
export function colunasBrancoParaExportar(lista: readonly ColunaBranco[]): string[] {
  return lista.map((c) => c.nome.trim()).filter((nome) => nome !== "");
}

/** true quando NENHUMA coluna em branco tem nome não-vazio (entra na regra de "nenhuma coluna selecionada"). */
export function nenhumaColunaBrancoComNome(lista: readonly ColunaBranco[]): boolean {
  return colunasBrancoParaExportar(lista).length === 0;
}

export function mensagemColunaBrancoAdicionada(novoTotal: number): string {
  return `Coluna em branco adicionada (${novoTotal} de ${LIMITE_COLUNAS_BRANCO}).`;
}

export function mensagemColunaBrancoRemovida(novoTotal: number): string {
  return `Coluna em branco removida (${novoTotal} de ${LIMITE_COLUNAS_BRANCO}).`;
}

/**
 * Migra as preferências antigas (`estoque:relatorioCustom:observacoes` /
 * `:anotacoes`, 2 checkboxes fixos) pra uma lista de colunas em branco
 * nomeadas — só deve ser usada como DEFAULT da nova chave persistida
 * (`estoque:relatorioCustom:colunasBranco`), nunca chamada de novo depois que
 * ela já existir. Preserva o hábito do usuário sem fricção: quem tinha os
 * dois marcados ganha as 2 linhas "Observações"/"Anotações" já preenchidas,
 * na mesma ordem de antes.
 */
export function migrarColunasBrancoLegado(
  incluirObservacoesLegado: boolean,
  incluirAnotacoesLegado: boolean,
  gerarId: () => string,
): ColunaBranco[] {
  const migradas: ColunaBranco[] = [];
  if (incluirObservacoesLegado) migradas.push({ id: gerarId(), nome: "Observações" });
  if (incluirAnotacoesLegado) migradas.push({ id: gerarId(), nome: "Anotações" });
  return migradas;
}
