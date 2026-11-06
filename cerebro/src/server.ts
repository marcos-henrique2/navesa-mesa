/**
 * Entrada do cérebro: lê a config, monta pool → loader → cache, o executor do
 * agente e sobe o HTTP em CEREBRO_HOST:CEREBRO_PORT.
 */
// O negócio é em Goiânia: datas/meses das tools no mesmo calendário do browser
// do Marcos (as telas agrupam em hora local). O Dockerfile já define TZ.
process.env.TZ ||= "America/Sao_Paulo";

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { carregarConfig } from "@cerebro/config";
import { criarAutenticador } from "@cerebro/auth";
import { Semaforo } from "@cerebro/semaforo";
import { criarServidor } from "@cerebro/http";
import { criarExecutorAgente } from "@cerebro/agente";
import { CacheSnapshot } from "@cerebro/data/cache";
import { carregarSnapshot, lerAssinatura } from "@cerebro/data/loader";
import { consultaDoPool, criarPool } from "@cerebro/data/db";
import { logPadrao as log, resumoErro } from "@cerebro/log";

function versaoSdk(): string | null {
  try {
    const req = createRequire(import.meta.url);
    const pkg = join(dirname(req.resolve("@anthropic-ai/claude-agent-sdk")), "package.json");
    return (JSON.parse(readFileSync(pkg, "utf8")) as { version?: string }).version ?? null;
  } catch {
    return null;
  }
}

function versaoCli(bin: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(bin, ["--version"], { timeout: 15_000, env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" } },
      (err, stdout) => resolve(err ? null : stdout.trim().split("\n")[0] || null));
  });
}

/** Heurística sem gastar cota: arquivo de credencial OAuth no volume (ou token de env, plano B). */
function claudeLogado(): boolean {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return true;
  const dir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  return existsSync(join(dir, ".credentials.json"));
}

async function main() {
  const config = carregarConfig();
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) {
    // Decisão do Marcos: só o login da assinatura. A env nem é repassada ao CLI (envDoCli).
    log.erro("ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN definida no ambiente: ignorada, o cérebro usa só o login da assinatura");
  }

  const pool = config.SUPABASE_DB_URL
    ? criarPool({
        url: config.SUPABASE_DB_URL,
        caFile: config.SUPABASE_DB_CA_FILE,
        tlsInseguro: config.SUPABASE_DB_TLS_INSEGURO,
        onErro: (e) => log.erro("pool pg: conexão ociosa caiu", { erro: resumoErro(e) }),
      })
    : null;
  if (!pool) log.erro("SUPABASE_DB_URL ausente: /v1/chat vai responder 503 dados_indisponiveis");
  if (config.SUPABASE_DB_TLS_INSEGURO) log.erro("SUPABASE_DB_TLS_INSEGURO ligado: TLS do banco SEM verificação de certificado");
  else if (!config.SUPABASE_DB_CA_FILE) log.erro("SUPABASE_DB_CA_FILE ausente: TLS do banco verifica só contra as CAs do sistema (Supabase vai falhar)");

  const consulta = pool ? consultaDoPool(pool) : null;
  const cache = new CacheSnapshot(
    {
      carregar: () => {
        if (!consulta) throw new Error("banco não configurado");
        return carregarSnapshot(consulta);
      },
      assinatura: () => {
        if (!consulta) throw new Error("banco não configurado");
        return lerAssinatura(consulta);
      },
    },
    {
      ttlMs: config.CEREBRO_CACHE_TTL_MS,
      idadeMaxMs: 30 * 60_000,
      onErro: (e) => log.erro("cache: checagem falhou, servindo snapshot antigo", { erro: resumoErro(e) }),
    },
  );

  const sdk = versaoSdk();
  let cli: string | null = null;
  void versaoCli(process.env.CEREBRO_CLAUDE_BIN || "claude").then((v) => { cli = v; });

  const servidor = criarServidor({
    autenticar: criarAutenticador(config.tokens),
    semaforo: new Semaforo(config.CEREBRO_MAX_CONC, config.CEREBRO_FILA_MAX, config.CEREBRO_FILA_ESPERA_MS),
    executor: criarExecutorAgente({ query, obterCache: () => cache.obter(), config, log }),
    timeoutMs: config.CEREBRO_TIMEOUT_MS,
    log,
    health: async () => {
      const snap = cache.espiar();
      return {
        ok: true,
        claudeLogado: claudeLogado(),
        versaoCli: cli,
        versaoSdk: sdk,
        banco: { configurado: pool != null },
        cache: snap
          ? { snapshotId: snap.snapshotId, carregadoEm: snap.carregadoEm, estoqueGeradoEm: snap.estoqueGeradoEm }
          : null,
      };
    },
  });

  servidor.listen(config.CEREBRO_PORT, config.CEREBRO_HOST, () => {
    log.info("cérebro no ar", { host: config.CEREBRO_HOST, porta: config.CEREBRO_PORT, sdk });
  });

  const encerrar = (sinal: string) => {
    log.info("encerrando", { sinal });
    servidor.close();
    void pool?.end();
    setTimeout(() => process.exit(0), 5_000).unref();
  };
  process.on("SIGTERM", () => encerrar("SIGTERM"));
  process.on("SIGINT", () => encerrar("SIGINT"));
}

main().catch((err) => {
  log.erro("falha ao iniciar", { erro: resumoErro(err) });
  process.exit(1);
});
