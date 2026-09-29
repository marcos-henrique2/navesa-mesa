import oracledb from "oracledb";
import { resolve } from "node:path";

// node-oracledb v6+ conecta em Thin mode por padrão (sem precisar de
// Oracle Client instalado nem de oracledb.initOracleClient()). Só cai pra
// Thick mode se initOracleClient() for chamado explicitamente — não fazemos
// isso aqui. `oracledb.thin === true` confirma que está em Thin mode.
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.fetchAsString = [oracledb.CLOB];

let envCarregado = false;

/** Carrega .env.nbs-sync.local (raiz do projeto) pro process.env, uma única vez. */
function carregarEnv(): void {
  if (envCarregado) return;
  const caminho = resolve(process.cwd(), ".env.nbs-sync.local");
  try {
    process.loadEnvFile(caminho);
  } catch (err) {
    throw new Error(
      `Não consegui carregar ${caminho}. Crie o arquivo com ORACLE_NBS_HOST, ORACLE_NBS_PORT, ` +
        `ORACLE_NBS_SERVICE, ORACLE_NBS_USER, ORACLE_NBS_PASSWORD (e opcionalmente SUPABASE_URL, ` +
        `SUPABASE_SERVICE_ROLE_KEY). Erro original: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  envCarregado = true;
}

export type ConfigOracle = {
  host: string;
  port: number;
  service: string;
  user: string;
  password: string;
};

function lerConfigOracle(): ConfigOracle {
  carregarEnv();

  const host = process.env.ORACLE_NBS_HOST;
  const portStr = process.env.ORACLE_NBS_PORT;
  const service = process.env.ORACLE_NBS_SERVICE;
  const user = process.env.ORACLE_NBS_USER;
  const password = process.env.ORACLE_NBS_PASSWORD;

  const faltando = [
    !host && "ORACLE_NBS_HOST",
    !portStr && "ORACLE_NBS_PORT",
    !service && "ORACLE_NBS_SERVICE",
    !user && "ORACLE_NBS_USER",
    !password && "ORACLE_NBS_PASSWORD",
  ].filter((v): v is string => Boolean(v));

  if (faltando.length > 0) {
    throw new Error(
      `Variáveis faltando em .env.nbs-sync.local: ${faltando.join(", ")}. ` +
        `Peça a senha atual pro Marcos — não adivinhe nem reaproveite senha antiga sem confirmar.`,
    );
  }

  const port = Number(portStr);
  if (!Number.isFinite(port)) {
    throw new Error(`ORACLE_NBS_PORT inválido: "${portStr}"`);
  }

  return { host: host!, port, service: service!, user: user!, password: password! };
}

/** Abre uma conexão Oracle (Thin mode). Chamador é responsável por fechar (`conn.close()`). */
export async function abrirConexaoOracle(): Promise<oracledb.Connection> {
  const cfg = lerConfigOracle();
  const connectString = `${cfg.host}:${cfg.port}/${cfg.service}`;
  return oracledb.getConnection({
    user: cfg.user,
    password: cfg.password,
    connectString,
  });
}

/** true = Thin mode (padrão, sem client instalado). false = Thick mode (initOracleClient foi chamado). */
export function modoThinAtivo(): boolean {
  return oracledb.thin;
}
