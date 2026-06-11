/**
 * Erros tipados + mapeamento Supabase → mensagens amigáveis pt-BR do módulo
 * de Repasses.
 *
 * Função pura — recebe o `error` do PostgrestResponse e devolve string ou
 * lança erro tipado quando o caller precisa discriminar (ex.: bulk modal
 * trata duplicata como "pulado" em vez de "falha").
 */

/**
 * Erro tipado pra duplicata de repasse ativo (chassi já está com
 * status='marcado' OU 'subido').
 *
 * Disparado quando o INSERT em `repasses` viola o índice parcial único
 * `repasses_chassi_ativo_uniq` (migration 010) — código 23505 do Postgres.
 *
 * Callers devem usar `err instanceof RepasseDuplicadoError` (NÃO substring
 * matching) pra discriminar duplicata de outras falhas.
 */
export class RepasseDuplicadoError extends Error {
  constructor(message?: string) {
    super(
      message ??
        "Esse carro já está marcado pra subir ou já subiu. Veja em /repasses.",
    );
    this.name = "RepasseDuplicadoError";
  }
}

/**
 * Traduz o erro de INSERT em `repasses` pra mensagem de UI.
 *
 * Código 23505 = unique_violation. Acontece quando a UI tenta criar 2
 * repasses ativos (status='marcado' OU 'subido') pro mesmo chassi.
 * Migration 010 garante a defesa no banco (índice parcial único);
 * aqui só fazemos a tradução pro Marcos entender o que rolou.
 */
export function mapearErroCriarRepasse(error: unknown): string {
  if (error == null) return "Falha ao criar repasse: sem dados";
  const err = error as { code?: string; message?: string };
  if (err.code === "23505") {
    return "Esse carro já está marcado pra subir ou já subiu. Veja em /repasses.";
  }
  return `Falha ao criar repasse: ${err.message ?? "sem dados"}`;
}

/**
 * Constrói o erro tipado/cru pra propagar pro caller.
 *
 * - 23505 → `RepasseDuplicadoError` (callers podem tratar via instanceof)
 * - Outros → `Error` cru com mensagem amigável de `mapearErroCriarRepasse`
 */
export function criarErroRepasse(error: unknown): Error {
  if (error != null) {
    const err = error as { code?: string };
    if (err.code === "23505") {
      return new RepasseDuplicadoError();
    }
  }
  return new Error(mapearErroCriarRepasse(error));
}
