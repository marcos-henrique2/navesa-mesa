/**
 * Mapeamento de erros do Supabase → mensagens amigáveis pt-BR.
 *
 * Função pura — recebe o `error` do PostgrestResponse e devolve string.
 * Mantida separada de `queries.ts` pra ficar testável sem mockar o client.
 */

/**
 * Traduz o erro de INSERT em `repasses` pra mensagem de UI.
 *
 * Código 23505 = unique_violation. Acontece quando a UI tenta criar 2
 * repasses ativos pro mesmo chassi (ex.: 2 abas, clique antes do map de
 * chassis carregar). Migration 009 garante a defesa no banco; aqui só
 * fazemos a tradução pro Marcos entender o que rolou.
 */
export function mapearErroCriarRepasse(error: unknown): string {
  if (error == null) return "Falha ao criar repasse: sem dados";
  const err = error as { code?: string; message?: string };
  if (err.code === "23505") {
    return "Este carro já tem um repasse ativo. Veja em /repasses.";
  }
  return `Falha ao criar repasse: ${err.message ?? "sem dados"}`;
}
