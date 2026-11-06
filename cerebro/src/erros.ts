/** Códigos de erro do contrato (doc §3.3). */
export type CodigoErro =
  | "entrada_invalida"
  | "token_invalido"
  | "perfil_sem_chat"
  | "nao_encontrado"
  | "ocupado"
  | "claude_nao_logado"
  | "limite_assinatura"
  | "timeout"
  | "dados_indisponiveis"
  | "erro_interno";

const STATUS: Record<CodigoErro, number> = {
  entrada_invalida: 400,
  token_invalido: 401,
  perfil_sem_chat: 403,
  nao_encontrado: 404,
  ocupado: 429,
  claude_nao_logado: 503,
  limite_assinatura: 503,
  dados_indisponiveis: 503,
  timeout: 504,
  erro_interno: 500,
};

const RETRYABLE: ReadonlySet<CodigoErro> = new Set(["ocupado", "limite_assinatura", "timeout", "dados_indisponiveis", "erro_interno"]);

export class ErroCerebro extends Error {
  readonly status: number;
  readonly retryable: boolean;
  constructor(
    readonly codigo: CodigoErro,
    mensagem: string,
    readonly retryAfter?: number,
  ) {
    super(mensagem);
    this.name = "ErroCerebro";
    this.status = STATUS[codigo];
    this.retryable = RETRYABLE.has(codigo);
  }

  /** Corpo JSON antes do stream: `{ codigo, mensagem, retryAfter? }`. */
  corpo(): { codigo: CodigoErro; mensagem: string; retryAfter?: number } {
    return this.retryAfter == null
      ? { codigo: this.codigo, mensagem: this.message }
      : { codigo: this.codigo, mensagem: this.message, retryAfter: this.retryAfter };
  }
}

export function comoErroCerebro(err: unknown): ErroCerebro {
  if (err instanceof ErroCerebro) return err;
  return new ErroCerebro("erro_interno", "Erro interno do cérebro.");
}
