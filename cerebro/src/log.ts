/**
 * Log estruturado (uma linha JSON por evento em stdout/stderr, lido por `docker logs`).
 * Nunca logar conteúdo de mensagem, token, URL do banco nem resultado de tool.
 */
export type Log = {
  info: (msg: string, campos?: Record<string, unknown>) => void;
  erro: (msg: string, campos?: Record<string, unknown>) => void;
};

function linha(nivel: string, msg: string, campos?: Record<string, unknown>): string {
  return JSON.stringify({ t: new Date().toISOString(), nivel, msg, ...campos }) + "\n";
}

export const logPadrao: Log = {
  info: (msg, campos) => void process.stdout.write(linha("info", msg, campos)),
  erro: (msg, campos) => void process.stderr.write(linha("erro", msg, campos)),
};

export const logMudo: Log = { info: () => {}, erro: () => {} };

/** Mensagem de erro sem stack e truncada (pg/SDK podem incluir host). */
export function resumoErro(err: unknown): string {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return msg.replace(/postgres(ql)?:\/\/[^\s]+/gi, "postgres://***").slice(0, 300);
}
