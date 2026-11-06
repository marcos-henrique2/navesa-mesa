/**
 * Pool Postgres da role `cerebro_leitor` (migration 051) pelo pooler Supavisor.
 *
 * Limites da role: connection limit 5, idle_session_timeout 10min,
 * statement_timeout 15s, default_transaction_read_only on. O pool fica abaixo
 * disso (max 3, ocioso fecha em 60s) para nunca ser derrubado pelo servidor.
 *
 * Conversão de tipos: o app lê as MESMAS tabelas pelo PostgREST (JSON). Para os
 * mappers puros receberem exatamente o mesmo formato, este pool devolve
 * numeric/bigint como `number` e datas como string (ver `parserEstiloPostgrest`).
 * Sem isso `pg` entregaria numeric como string ("123.45") e a soma viraria
 * concatenação: o tipo de bug centavo-perfect que não pode acontecer.
 */
import { readFileSync } from "node:fs";
import pg from "pg";

export type LinhaDb = Record<string, unknown>;

/** Interface mínima usada pelo loader (o Pool satisfaz; os testes injetam um fake). */
export type Consulta = (sql: string) => Promise<{ rows: LinhaDb[] }>;

const OID = {
  INT8: 20,
  NUMERIC: 1700,
  DATE: 1082,
  TIMESTAMP: 1114,
  TIMESTAMPTZ: 1184,
} as const;

/** Parser de texto do Postgres com o mesmo formato que o PostgREST entrega em JSON. */
export function parserEstiloPostgrest(oid: number): ((v: string) => unknown) | null {
  switch (oid) {
    case OID.INT8:
    case OID.NUMERIC:
      // PostgREST serializa numeric como número JSON; JSON.parse e Number() dão o
      // mesmo double para o mesmo texto decimal.
      return (v) => Number(v);
    case OID.DATE:
      return (v) => v; // "YYYY-MM-DD", igual ao PostgREST
    case OID.TIMESTAMP:
      return (v) => v.replace(" ", "T");
    case OID.TIMESTAMPTZ: {
      const padrao = pg.types.getTypeParser(OID.TIMESTAMPTZ, "text");
      return (v) => (padrao(v) as Date).toISOString();
    }
    default:
      return null;
  }
}

const tiposPostgrest = {
  getTypeParser(oid: number, format?: "text" | "binary") {
    const custom = format === "binary" ? null : parserEstiloPostgrest(oid);
    // `as never`: a sobrecarga de getTypeParser do @types/pg não aceita o union.
    return custom ?? pg.types.getTypeParser(oid, (format ?? "text") as never);
  },
} as pg.CustomTypesConfig;

/**
 * Remove parâmetros `ssl*` da URL: o TLS é configurado só pelo objeto `ssl`
 * (no pg 8 um `sslmode=require` na URL vira verify-full e ignora o objeto).
 */
export function urlSemSslParams(url: string): string {
  const u = new URL(url);
  for (const k of [...u.searchParams.keys()]) if (k.toLowerCase().startsWith("ssl")) u.searchParams.delete(k);
  return u.toString();
}

/**
 * TLS do banco, verificação LIGADA por padrão:
 *   - `caPem` (CA pública do Supabase, embutida na imagem em cerebro/certs/ e
 *     apontada por SUPABASE_DB_CA_FILE) → verifica cadeia E hostname;
 *   - sem `caPem` → verifica contra as CAs do sistema (para o Supabase isso FALHA
 *     com SELF_SIGNED_CERT_IN_CHAIN: fail-closed, nunca cai em "sem verificação");
 *   - `inseguro` (SUPABASE_DB_TLS_INSEGURO=1, flag explícita) → TLS sem verificar.
 *
 * Pooler (Supavisor, aws-N-<região>.pooler.supabase.com, portas 5432 e 6543)
 * apresenta a MESMA cadeia "Supabase Root 2021 CA" (testado em 06/11/2026). O SNI
 * e a checagem de hostname usam o host da URL: o `pg` já preenche `servername`
 * com o host quando não é IP, então não há servername manual a configurar. Se a
 * URL apontar para IP, a checagem de hostname falha (use o nome DNS do pooler).
 */
export function opcoesTls(opts: { caPem?: string; inseguro?: boolean }): NonNullable<pg.PoolConfig["ssl"]> {
  if (opts.inseguro) return { rejectUnauthorized: false };
  return opts.caPem ? { ca: opts.caPem, rejectUnauthorized: true } : { rejectUnauthorized: true };
}

export function criarPool(opts: {
  url: string;
  caFile?: string;
  tlsInseguro?: boolean;
  onErro: (err: Error) => void;
}): pg.Pool {
  const ssl = opcoesTls({
    caPem: opts.caFile && !opts.tlsInseguro ? readFileSync(opts.caFile, "utf8") : undefined,
    inseguro: opts.tlsInseguro,
  });
  const pool = new pg.Pool({
    connectionString: urlSemSslParams(opts.url),
    ssl,
    max: 3,
    idleTimeoutMillis: 60_000,
    connectionTimeoutMillis: 10_000,
    application_name: "navesa-cerebro",
    types: tiposPostgrest,
  });
  // Conexão ociosa derrubada pelo servidor/pooler emite 'error' no pool; sem
  // este handler o processo cai.
  pool.on("error", opts.onErro);
  return pool;
}

export function consultaDoPool(pool: pg.Pool): Consulta {
  return async (sql) => {
    const r = await pool.query(sql);
    return { rows: r.rows as LinhaDb[] };
  };
}
