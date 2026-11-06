process.env.TZ = "America/Sao_Paulo";

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { VENDAS_COLUNAS_CEREBRO } from "@/lib/data/mappers/vendas";
import { SQL, SYNC_LOG_COLUNAS, carregarSnapshot } from "@cerebro/data/loader";
import { opcoesTls, parserEstiloPostgrest, urlSemSslParams } from "@cerebro/data/db";
import { carregarConfig } from "@cerebro/config";
import { X509Certificate } from "node:crypto";
import { CacheSnapshot } from "@cerebro/data/cache";
import type { Snapshot } from "@cerebro/data/loader";
import { AGORA, consultaFalsa, tabelasPadrao } from "./fixtures";

// ───── Loader ─────

test("loader: vendas/cautelar/sync_log com colunas explícitas; nenhuma coluna bloqueada pela 051", () => {
  for (const sql of [SQL.vendas, SQL.cautelar, SQL.syncLog, SQL.syncLogSucesso]) {
    assert.ok(!/select\s+\*/i.test(sql), sql);
  }
  for (const proibida of ["cliente_nome", "cliente_codigo", "vendedor_cpf", "renavam", "observacao", "erro_mensagem"]) {
    for (const sql of Object.values(SQL)) assert.ok(!sql.includes(`"${proibida}"`), `${proibida} em ${sql}`);
  }
  for (const c of VENDAS_COLUNAS_CEREBRO) assert.ok(SQL.vendas.includes(`"${c}"`));
  assert.deepEqual([...SYNC_LOG_COLUNAS], ["id", "fonte", "iniciado_em", "finalizado_em", "status", "linhas_lidas", "linhas_gravadas", "duracao_ms"]);
  // Nada de escrita nem de tabelas fora da allowlist
  const todas = Object.values(SQL).join("\n").toLowerCase();
  assert.ok(!/\b(insert|update|delete|truncate|alter|drop|grant)\b/.test(todas));
  for (const t of ["leads", "lead_interesses", "repasse_interessados", "chat_messages", "vendedores"]) {
    assert.ok(!new RegExp(`public\\.${t}\\b`).test(todas), t);
  }
});

test("loader: monta datasets pelo pipeline puro, filtra loja ignorada, lê sync e snapshot", async () => {
  const log: string[] = [];
  const s = await carregarSnapshot(consultaFalsa(tabelasPadrao(), log), () => AGORA);
  assert.equal(s.datasets.vendas.length, 9);
  assert.equal(s.datasets.veiculos.length, 10);
  assert.equal(s.datasets.custosPorPlaca.IGN9I99, undefined);
  assert.ok(s.datasets.custosEstoquePorPlaca.EST0001, "chave de custo de estoque normalizada");
  assert.ok(s.datasets.vendas.every((v) => v.cliente_pii_ausente === true && v.cliente_nome === "(sem nome)"));
  assert.equal(s.snapshotId, 77);
  assert.equal(s.assinatura, "a1");
  assert.equal(s.carregadoEm, AGORA.toISOString());
  assert.deepEqual(s.sync.map((f) => [f.fonte, f.status]), [["veiculos", "sucesso"], ["vendas", "sucesso"]]);
  assert.equal(log[0], SQL.frescor, "assinatura lida antes dos dados");
  assert.equal(new Set(log).size, log.length, "cada query uma vez");
});

// ───── Tipos pg → formato PostgREST ─────

test("db: numeric/bigint viram number; timestamptz vira ISO; date fica YYYY-MM-DD", () => {
  assert.equal(parserEstiloPostgrest(1700)!("150000.45"), 150000.45);
  assert.equal(parserEstiloPostgrest(1700)!("0.1") as number + (parserEstiloPostgrest(1700)!("0.2") as number), 0.1 + 0.2);
  assert.equal(parserEstiloPostgrest(20)!("3460"), 3460);
  assert.equal(parserEstiloPostgrest(1184)!("2026-10-01 03:10:00+00"), "2026-10-01T03:10:00.000Z");
  assert.equal(parserEstiloPostgrest(1082)!("2026-10-01"), "2026-10-01");
  assert.equal(parserEstiloPostgrest(1114)!("2026-10-01 12:00:00"), "2026-10-01T12:00:00");
  assert.equal(parserEstiloPostgrest(23), null, "int4 fica com o parser padrão");
});

test("db: parâmetros ssl* saem da URL (TLS só pelo objeto ssl)", () => {
  const u = urlSemSslParams("postgresql://cerebro_leitor.ref:senha@aws-0-sa-east-1.pooler.supabase.com:6543/postgres?sslmode=require&application_name=x");
  assert.ok(!u.includes("sslmode"));
  assert.ok(u.includes("application_name=x"));
});

test("db: TLS verifica por padrão; só a flag explícita desliga", () => {
  assert.deepEqual(opcoesTls({ caPem: "PEM" }), { ca: "PEM", rejectUnauthorized: true });
  assert.deepEqual(opcoesTls({}), { rejectUnauthorized: true }, "sem CA: CAs do sistema, nunca sem verificação");
  assert.deepEqual(opcoesTls({ caPem: "PEM", inseguro: true }), { rejectUnauthorized: false });

  const base = { CEREBRO_TOKENS: `web:${"a".repeat(40)}` };
  assert.equal(carregarConfig(base).SUPABASE_DB_TLS_INSEGURO, false);
  assert.equal(carregarConfig({ ...base, SUPABASE_DB_TLS_INSEGURO: "0" }).SUPABASE_DB_TLS_INSEGURO, false);
  assert.equal(carregarConfig({ ...base, SUPABASE_DB_TLS_INSEGURO: "sim" }).SUPABASE_DB_TLS_INSEGURO, false);
  assert.equal(carregarConfig({ ...base, SUPABASE_DB_TLS_INSEGURO: "1" }).SUPABASE_DB_TLS_INSEGURO, true);
  assert.equal(carregarConfig({ ...base, SUPABASE_DB_TLS_INSEGURO: "true" }).SUPABASE_DB_TLS_INSEGURO, true);
  // Fora do Docker o servidor escuta só no loopback
  assert.equal(carregarConfig(base).CEREBRO_HOST, "127.0.0.1");
});

test("db: CA do Supabase embutida é X.509 válido, CA raiz, dentro da validade", () => {
  const cert = new X509Certificate(readFileSync(new URL("../certs/supabase-prod-ca-2021.crt", import.meta.url)));
  assert.ok(cert.ca);
  assert.match(cert.subject, /CN=Supabase Root 2021 CA/);
  assert.ok(new Date(cert.validTo).getTime() > Date.now());
  assert.equal(cert.fingerprint256, "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA");
});

// ───── Cache ─────

function fakeSnap(assinatura: string, n: number): Snapshot {
  return { assinatura, carregadoEm: String(n) } as unknown as Snapshot;
}

function montarCache(opts: { ttlMs?: number; idadeMaxMs?: number } = {}) {
  let t = 0;
  let assinatura = "a";
  let cargas = 0, checagens = 0;
  let falhar = false;
  const cache = new CacheSnapshot(
    {
      carregar: async () => {
        if (falhar) throw new Error("banco fora");
        cargas++;
        return fakeSnap(assinatura, cargas);
      },
      assinatura: async () => {
        if (falhar) throw new Error("banco fora");
        checagens++;
        return assinatura;
      },
    },
    { ttlMs: opts.ttlMs ?? 1000, idadeMaxMs: opts.idadeMaxMs ?? 10_000, agora: () => t },
  );
  return {
    cache,
    avancar: (ms: number) => { t += ms; },
    mudar: (a: string) => { assinatura = a; },
    falhar: (f: boolean) => { falhar = f; },
    contagem: () => ({ cargas, checagens }),
  };
}

test("cache: dentro do TTL não toca no banco; depois checa assinatura e só recarrega se mudou", async () => {
  const c = montarCache();
  await c.cache.obter();
  await c.cache.obter();
  assert.deepEqual(c.contagem(), { cargas: 1, checagens: 0 });
  c.avancar(1500);
  await c.cache.obter();
  assert.deepEqual(c.contagem(), { cargas: 1, checagens: 1 });
  c.avancar(1500);
  c.mudar("b");
  const e = await c.cache.obter();
  assert.deepEqual(c.contagem(), { cargas: 2, checagens: 2 });
  assert.equal(e.snapshot.assinatura, "b");
});

test("cache: idade máxima força recarga mesmo com assinatura igual", async () => {
  const c = montarCache({ ttlMs: 1000, idadeMaxMs: 3000 });
  await c.cache.obter();
  c.avancar(3500);
  await c.cache.obter();
  assert.equal(c.contagem().cargas, 2);
});

test("cache: single-flight e falha com cache antigo serve o antigo marcado desatualizado", async () => {
  const c = montarCache();
  await Promise.all([c.cache.obter(), c.cache.obter(), c.cache.obter()]);
  assert.equal(c.contagem().cargas, 1);
  c.avancar(2000);
  c.falhar(true);
  const e = await c.cache.obter();
  assert.equal(e.desatualizado, true);
  assert.equal(e.snapshot.carregadoEm, "1");
  const vazio = montarCache();
  vazio.falhar(true);
  await assert.rejects(vazio.cache.obter(), /banco fora/);
});

// ───── Bundle: módulos de ../src usados pelo cérebro não importam pacote npm ─────

const RAIZ = resolve(process.cwd(), "..", "src");
const CEREBRO_SRC = resolve(process.cwd(), "src");

function importsDeValor(src: string): string[] {
  const out: string[] = [];
  const re = /^\s*(import|export)\s+(type\s+)?(?:[^"';]*?\s+from\s+)?["']([^"']+)["']/gm;
  for (const m of src.matchAll(re)) if (!m[2]) out.push(m[3]);
  return out;
}

function resolverArq(base: string): string {
  for (const c of [`${base}.ts`, join(base, "index.ts")]) if (existsSync(c)) return c;
  throw new Error(`não resolvido: ${base}`);
}

test("bundle: o grafo de imports de valor do cérebro em ../src só tem módulos puros, sem npm", () => {
  const fila = readdirSync(CEREBRO_SRC, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts"))
    .map((f) => join(CEREBRO_SRC, f));
  const visitados = new Set<string>();
  const npmEmSrc: string[] = [];
  while (fila.length) {
    const f = fila.pop() as string;
    if (visitados.has(f)) continue;
    visitados.add(f);
    const doApp = f.startsWith(RAIZ);
    for (const spec of importsDeValor(readFileSync(f, "utf8"))) {
      if (spec.startsWith("@/")) fila.push(resolverArq(join(RAIZ, spec.slice(2))));
      else if (spec.startsWith("@cerebro/")) fila.push(resolverArq(join(CEREBRO_SRC, spec.slice(9))));
      else if (spec.startsWith(".")) fila.push(resolverArq(resolve(dirname(f), spec)));
      else if (doApp) npmEmSrc.push(`${spec} <- ${f.slice(RAIZ.length)}`);
    }
  }
  assert.deepEqual(npmEmSrc, []);
  const doApp = [...visitados].filter((f) => f.startsWith(RAIZ));
  assert.ok(doApp.some((f) => f.endsWith(join("analytics", "insights.ts"))));
  for (const f of doApp) assert.ok(!/^\s*["']use client["']/m.test(readFileSync(f, "utf8")), `${f} é "use client"`);
});
