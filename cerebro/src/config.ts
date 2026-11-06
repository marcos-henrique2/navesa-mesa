/**
 * Configuração do cérebro lida do ambiente (cerebro/.env via env_file do compose).
 * Nenhum segredo tem default. Nada aqui é logado.
 */
import { z } from "zod";
import type { Perfil } from "@cerebro/perfis";

const PERFIS_VALIDOS = ["web", "whatsapp"] as const satisfies readonly Perfil[];

/** Tamanho mínimo de cada token do Bearer (evita token fraco por engano). */
export const TOKEN_MIN_CHARS = 32;

export type TokenPerfil = { perfil: Perfil; token: string };

/**
 * `CEREBRO_TOKENS` = lista `perfil:token` separada por vírgula.
 * Ex.: `web:<64 hex>,whatsapp:<64 hex>`. Perfil desconhecido, token curto ou
 * token repetido derrubam o boot (fail-closed).
 */
export function parseTokens(raw: string | undefined): TokenPerfil[] {
  if (!raw || !raw.trim()) throw new Error("CEREBRO_TOKENS vazio: defina ao menos web:<token>");
  const out: TokenPerfil[] = [];
  for (const parte of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    const i = parte.indexOf(":");
    if (i <= 0) throw new Error("CEREBRO_TOKENS: formato esperado perfil:token");
    const perfil = parte.slice(0, i).trim();
    const token = parte.slice(i + 1).trim();
    if (!(PERFIS_VALIDOS as readonly string[]).includes(perfil)) {
      throw new Error(`CEREBRO_TOKENS: perfil desconhecido "${perfil}"`);
    }
    if (token.length < TOKEN_MIN_CHARS) {
      throw new Error(`CEREBRO_TOKENS: token do perfil ${perfil} tem menos de ${TOKEN_MIN_CHARS} caracteres`);
    }
    if (out.some((t) => t.token === token)) throw new Error("CEREBRO_TOKENS: token repetido");
    out.push({ perfil: perfil as Perfil, token });
  }
  return out;
}

const inteiro = (def: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).default(def);

const EnvSchema = z.object({
  CEREBRO_PORT: inteiro(8787, 1, 65535),
  CEREBRO_HOST: z.string().default("0.0.0.0"),
  CEREBRO_MAX_CONC: inteiro(2, 1, 8),
  CEREBRO_FILA_MAX: inteiro(4, 0, 32),
  CEREBRO_FILA_ESPERA_MS: inteiro(15_000, 0, 120_000),
  CEREBRO_TIMEOUT_MS: inteiro(110_000, 5_000, 300_000),
  CEREBRO_CACHE_TTL_MS: inteiro(5 * 60_000, 0, 60 * 60_000),
  CEREBRO_MAX_TURNS: inteiro(12, 1, 50),
  CEREBRO_MODELO_RAPIDO: z.string().min(1).default("claude-haiku-5-5"),
  CEREBRO_MODELO_AVANCADO: z.string().min(1).default("claude-sonnet-5-5"),
  /** Diretório vazio usado como cwd do CLI (read-only na imagem). */
  CEREBRO_CWD: z.string().min(1).default("/srv/cerebro/empty"),
  SUPABASE_DB_URL: z.string().min(1).optional(),
  /** CA do pooler (PEM). Sem ela, TLS é exigido mas o certificado não é verificado. */
  SUPABASE_DB_CA_FILE: z.string().min(1).optional(),
});

export type Config = z.infer<typeof EnvSchema> & { tokens: TokenPerfil[] };

export function carregarConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const campos = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Configuração inválida: ${campos}`);
  }
  return { ...parsed.data, tokens: parseTokens(env.CEREBRO_TOKENS) };
}
