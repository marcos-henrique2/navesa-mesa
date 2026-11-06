import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CEREBRO_TETO_TOTAL_MS,
  abrirStreamCerebro,
  chatHabilitado,
  criarParserSse,
  lerBackend,
  lerConfigCerebro,
  mensagemErroCerebro,
  montarCorpoCerebro,
  statusParaBrowser,
} from "@/lib/chat/cerebro-client";
import type { RequestBody } from "@/lib/chat/providers";

const CONFIG = { url: "http://cerebro.local", token: "t".repeat(40), timeoutMs: 110_000 };
const BODY: RequestBody = {
  messages: [{ role: "user", content: "quantos carros parados?" }],
  bundle: null,
  periodo: { inicio: "01/10/2026", fim: "31/10/2026" },
};

const sse = (...eventos: [string, unknown][]) => eventos.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("");

/** fetch falso: devolve o corpo em pedaços (testa o parser incremental) e grava a chamada. */
function fetchFalso(status: number, corpo: string, chamadas: { url: string; init: RequestInit }[] = [], pedaco = 7) {
  return (async (url: string, init: RequestInit) => {
    chamadas.push({ url, init });
    const enc = new TextEncoder().encode(corpo);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < enc.length; i += pedaco) c.enqueue(enc.slice(i, i + pedaco));
        c.close();
      },
    });
    return new Response(stream, { status, headers: { "content-type": status === 200 ? "text/event-stream" : "application/json" } });
  }) as unknown as typeof fetch;
}

async function lerTudo(s: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(s).text();
}

test("lerBackend: default providers; aceita cerebro/auto; valor estranho cai em providers", () => {
  assert.equal(lerBackend({}), "providers");
  assert.equal(lerBackend({ CHAT_BACKEND: "cerebro" }), "cerebro");
  assert.equal(lerBackend({ CHAT_BACKEND: " AUTO " }), "auto");
  assert.equal(lerBackend({ CHAT_BACKEND: "claude" }), "providers");
});

test("lerConfigCerebro: exige URL e token; orçamento 115s no cerebro e 85s (máx.) no auto; tira barra final", () => {
  assert.equal(lerConfigCerebro({ CEREBRO_URL: "http://x" }), null);
  const base = { CEREBRO_URL: "http://x:8787/", CEREBRO_TOKEN: "abc" };
  assert.deepEqual(lerConfigCerebro({ ...base, CHAT_BACKEND: "cerebro" }), { url: "http://x:8787", token: "abc", timeoutMs: 115_000 });
  assert.equal(lerConfigCerebro({ ...base, CHAT_BACKEND: "cerebro", CEREBRO_TIMEOUT_MS: "60000" })?.timeoutMs, 60_000);
  assert.equal(lerConfigCerebro({ ...base, CHAT_BACKEND: "cerebro", CEREBRO_TIMEOUT_MS: "300000" })?.timeoutMs, 115_000, "nunca passa do maxDuration");
  // auto: precisa sobrar tempo para o fallback dentro do maxDuration 120
  assert.equal(lerConfigCerebro({ ...base, CHAT_BACKEND: "auto" })?.timeoutMs, 85_000);
  assert.equal(lerConfigCerebro({ ...base, CHAT_BACKEND: "auto", CEREBRO_TIMEOUT_MS: "110000" })?.timeoutMs, 85_000);
  assert.equal(lerConfigCerebro({ ...base, CHAT_BACKEND: "auto", CEREBRO_TIMEOUT_MS: "40000" })?.timeoutMs, 40_000);
  assert.equal(CEREBRO_TETO_TOTAL_MS < 120_000, true);
});

test("chatHabilitado: aba/rota Chat IA só com cerebro ou auto (ausente = desligado, como em produção)", () => {
  assert.equal(chatHabilitado({}), false);
  assert.equal(chatHabilitado({ CHAT_BACKEND: "providers" }), false);
  assert.equal(chatHabilitado({ CHAT_BACKEND: "qualquer" }), false);
  assert.equal(chatHabilitado({ CHAT_BACKEND: "cerebro" }), true);
  assert.equal(chatHabilitado({ CHAT_BACKEND: "auto" }), true);
});

/** fetch que só responde quando o signal aborta (simula cérebro preso na fila / no CLI). */
const fetchPreso = (async (_url: string, init: RequestInit) =>
  new Promise<Response>((_res, rej) => init.signal?.addEventListener("abort", () => rej(init.signal?.reason)))) as unknown as typeof fetch;

test("orçamento conta da chegada do request: tempo já gasto antes do fetch sai do prazo", async () => {
  const t0 = Date.now();
  const r = await abrirStreamCerebro({
    config: { ...CONFIG, timeoutMs: 85_000 }, body: BODY, requestId: "r", userId: "u",
    inicioMs: Date.now() - 84_900, // auth + rate limit "gastaram" 84,9 s
    fetchImpl: fetchPreso,
  });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.erro.codigo, "indisponivel", "sem texto a tempo → auto cai no fallback");
  assert.ok(Date.now() - t0 < 2_000, "desistiu pelo orçamento restante, não pelo cheio");
});

test("depois do primeiro texto, o stream vai até o teto total (não corta no orçamento do auto)", async () => {
  // Orçamento do 1º texto já estourado se fosse contado de novo; teto total ainda tem ~150 ms.
  const inicioMs = Date.now() - (CEREBRO_TETO_TOTAL_MS - 150);
  const fetchUmTexto = (async (_url: string, init: RequestInit) => {
    const enc = new TextEncoder().encode(sse(["meta", { modelo: "m" }], ["delta", { texto: "Começo" }]));
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc);
        init.signal?.addEventListener("abort", () => c.error(new Error("abortado")));
      },
    });
    return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as unknown as typeof fetch;
  const r = await abrirStreamCerebro({
    config: { ...CONFIG, timeoutMs: CEREBRO_TETO_TOTAL_MS }, body: BODY, requestId: "r", userId: "u", inicioMs, fetchImpl: fetchUmTexto,
  });
  assert.equal(r.ok, true);
  const t0 = Date.now();
  if (r.ok) await assert.rejects(lerTudo(r.stream), "teto total corta o stream preso");
  assert.ok(Date.now() - t0 < 2_000);
});

test("montarCorpoCerebro: sem bundle, canal web, últimas 30 mensagens, corta antigas acima de 30 KB", () => {
  const c = montarCorpoCerebro({ ...BODY, bundle: { enorme: true } as never, modelo: "avancado" });
  assert.deepEqual(Object.keys(c).sort(), ["canal", "messages", "modelo", "periodo"]);
  assert.equal(c.canal, "web");
  const muitas = Array.from({ length: 40 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", content: `m${i}` }));
  assert.equal(montarCorpoCerebro({ ...BODY, messages: muitas }).messages.length, 30);
  const grandes = Array.from({ length: 10 }, (_, i) => ({ role: "user" as const, content: `${i}`.padEnd(5000, "x") }));
  const corpo = montarCorpoCerebro({ ...BODY, messages: grandes });
  assert.ok(new TextEncoder().encode(JSON.stringify(corpo)).length <= 30 * 1024);
  assert.equal(corpo.messages.at(-1)?.content, grandes.at(-1)?.content, "a pergunta atual nunca é cortada");
  assert.equal(montarCorpoCerebro({ ...BODY, periodo: { inicio: "2026-10-01", fim: null } }).periodo?.inicio, null);
});

test("parser SSE: junta pedaços quebrados no meio da linha e ignora comentários", () => {
  const p = criarParserSse();
  const txt = ": ping\n\n" + sse(["meta", { modelo: "m" }], ["delta", { texto: "olá" }]);
  const out = [...p(txt.slice(0, 10)), ...p(txt.slice(10, 31)), ...p(txt.slice(31))];
  assert.deepEqual(out.map((e) => e.evento), ["meta", "delta"]);
});

test("abrirStreamCerebro: traduz SSE → texto puro; tool/meta/done somem; manda Bearer e ids", async () => {
  const chamadas: { url: string; init: RequestInit }[] = [];
  const corpo = sse(
    ["meta", { requestId: "r1", modelo: "claude-haiku-5-5" }],
    ["tool", { nome: "carros_parados", fase: "inicio" }],
    ["tool", { nome: "carros_parados", fase: "fim", ms: 4 }],
    ["delta", { texto: "São **12** " }],
    ["delta", { texto: "carros." }],
    ["done", { turns: 2, duracaoMs: 900 }],
  );
  const r = await abrirStreamCerebro({ config: CONFIG, body: BODY, requestId: "r1", userId: "u1", fetchImpl: fetchFalso(200, corpo, chamadas) });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(await lerTudo(r.stream), "São **12** carros.");
  assert.equal(chamadas[0].url, "http://cerebro.local/v1/chat");
  const h = chamadas[0].init.headers as Record<string, string>;
  assert.equal(h.authorization, `Bearer ${CONFIG.token}`);
  assert.equal(h["x-request-id"], "r1");
  assert.equal(h["x-navesa-user"], "u1");
  assert.equal(JSON.parse(String(chamadas[0].init.body)).bundle, undefined);
});

test("abrirStreamCerebro: erro HTTP antes do stream vira ok:false com codigo/retryAfter (permite fallback)", async () => {
  const r = await abrirStreamCerebro({
    config: CONFIG, body: BODY, requestId: "r", userId: "u",
    fetchImpl: fetchFalso(503, JSON.stringify({ codigo: "claude_nao_logado", mensagem: "sem login" })),
  });
  assert.deepEqual(r, { ok: false, erro: { status: 503, codigo: "claude_nao_logado", mensagem: "sem login" } });
  const ocupado = await abrirStreamCerebro({
    config: CONFIG, body: BODY, requestId: "r", userId: "u",
    fetchImpl: fetchFalso(429, JSON.stringify({ codigo: "ocupado", mensagem: "x", retryAfter: 15 })),
  });
  assert.equal(!ocupado.ok && ocupado.erro.retryAfter, 15);
});

test("abrirStreamCerebro: evento error antes do primeiro delta também é ok:false", async () => {
  const corpo = sse(["meta", { modelo: "m" }], ["tool", { nome: "x", fase: "inicio" }], ["error", { codigo: "limite_assinatura", mensagem: "Cota até 18:00", retryable: true }]);
  const r = await abrirStreamCerebro({ config: CONFIG, body: BODY, requestId: "r", userId: "u", fetchImpl: fetchFalso(200, corpo) });
  assert.deepEqual(r, { ok: false, erro: { status: 200, codigo: "limite_assinatura", mensagem: "Cota até 18:00" } });
});

test("abrirStreamCerebro: erro DEPOIS do texto aborta o stream (Chat.tsx marca 'interrompida')", async () => {
  const corpo = sse(["meta", { modelo: "m" }], ["delta", { texto: "Começo " }], ["error", { codigo: "timeout", mensagem: "110s", retryable: true }]);
  const r = await abrirStreamCerebro({ config: CONFIG, body: BODY, requestId: "r", userId: "u", fetchImpl: fetchFalso(200, corpo) });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const leitor = r.stream.getReader();
  const dec = new TextDecoder();
  assert.equal(dec.decode((await leitor.read()).value), "Começo ");
  await assert.rejects(leitor.read());
});

test("abrirStreamCerebro: stream cortado sem done também aborta; sem conexão vira indisponivel", async () => {
  const cortado = await abrirStreamCerebro({
    config: CONFIG, body: BODY, requestId: "r", userId: "u",
    fetchImpl: fetchFalso(200, sse(["delta", { texto: "meia" }])),
  });
  assert.equal(cortado.ok, true);
  if (cortado.ok) await assert.rejects(lerTudo(cortado.stream));
  const fora = await abrirStreamCerebro({
    config: CONFIG, body: BODY, requestId: "r", userId: "u",
    fetchImpl: (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch,
  });
  assert.equal(!fora.ok && fora.erro.codigo, "indisponivel");
});

test("mensagens/status para o browser no modo cerebro", () => {
  assert.equal(statusParaBrowser({ status: 429, codigo: "ocupado", mensagem: "" }), 429);
  assert.equal(statusParaBrowser({ status: 504, codigo: "timeout", mensagem: "" }), 504);
  assert.equal(statusParaBrowser({ status: 0, codigo: "indisponivel", mensagem: "" }), 503);
  assert.match(mensagemErroCerebro({ status: 503, codigo: "claude_nao_logado", mensagem: "" }), /\/login/);
  assert.equal(mensagemErroCerebro({ status: 503, codigo: "limite_assinatura", mensagem: "Cota do Claude esgotada até 18:00." }), "Cota do Claude esgotada até 18:00.");
});
