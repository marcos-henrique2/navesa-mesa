import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { criarServidor, type DepsServidor } from "@cerebro/http";
import { criarAutenticador } from "@cerebro/auth";
import { Semaforo } from "@cerebro/semaforo";
import { parseTokens } from "@cerebro/config";
import { ErroCerebro } from "@cerebro/erros";
import { logMudo } from "@cerebro/log";
import type { EventoAgente, ExecutorChat } from "@cerebro/contrato";

const TOKEN_WEB = "w".repeat(40);
const TOKEN_WA = "z".repeat(40);
const tokens = parseTokens(`web:${TOKEN_WEB},whatsapp:${TOKEN_WA}`);

type Sse = { evento: string; data: Record<string, unknown> };
function parseSse(txt: string): Sse[] {
  return txt.split("\n\n").filter(Boolean).map((bloco) => {
    const ev = /^event: (.+)$/m.exec(bloco)?.[1] ?? "";
    const data = JSON.parse(/^data: (.+)$/m.exec(bloco)?.[1] ?? "null") as Record<string, unknown>;
    return { evento: ev, data };
  });
}

async function* eventos(lista: EventoAgente[], atrasoMs = 0): AsyncGenerator<EventoAgente> {
  for (const e of lista) {
    if (atrasoMs) await new Promise((r) => setTimeout(r, atrasoMs));
    yield e;
  }
}

const respostaOk: EventoAgente[] = [
  { tipo: "tool", nome: "carros_parados", fase: "inicio" },
  { tipo: "tool", nome: "carros_parados", fase: "fim", ms: 3 },
  { tipo: "delta", texto: "São **12** carros" },
  { tipo: "delta", texto: " parados." },
  { tipo: "done", turns: 2, duracaoMs: 50 },
];

async function subir(over: Partial<DepsServidor> = {}) {
  const deps: DepsServidor = {
    autenticar: criarAutenticador(tokens),
    semaforo: new Semaforo(2, 4, 15_000),
    executor: () => ({ modelo: "claude-haiku-5-5", eventos: eventos(respostaOk) }),
    timeoutMs: 110_000,
    health: async () => ({ ok: true, claudeLogado: false, versaoCli: null, cache: null }),
    log: logMudo,
    ...over,
  };
  const srv = criarServidor(deps);
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  return { base, deps, fechar: () => new Promise<void>((r) => { srv.closeAllConnections(); srv.close(() => r()); }) };
}

const corpo = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ messages: [{ role: "user", content: "quantos carros parados há mais de 90 dias?" }], canal: "web", ...over });

const post = (base: string, body: string, token: string | null = TOKEN_WEB, extra: Record<string, string> = {}) =>
  fetch(`${base}/v1/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...extra,
    },
    body,
  });

test("GET /health responde sem auth; /v1/health exige token", async () => {
  const s = await subir();
  try {
    const h = await fetch(`${s.base}/health`);
    assert.equal(h.status, 200);
    assert.deepEqual(await h.json(), { ok: true });
    const sem = await fetch(`${s.base}/v1/health`);
    assert.equal(sem.status, 401);
    assert.deepEqual(await sem.json(), { codigo: "token_invalido", mensagem: "Token ausente ou inválido." });
    const errado = await fetch(`${s.base}/v1/health`, { headers: { authorization: `Bearer ${"x".repeat(40)}` } });
    assert.equal(errado.status, 401);
    const ok = await fetch(`${s.base}/v1/health`, { headers: { authorization: `Bearer ${TOKEN_WEB}` } });
    assert.equal(ok.status, 200);
    const j = (await ok.json()) as Record<string, unknown>;
    assert.equal(j.claudeLogado, false);
    assert.deepEqual(j.fila, { ativos: 0, naFila: 0, max: 2, filaMax: 4 });
    assert.equal((await fetch(`${s.base}/v1/nada`, { headers: { authorization: `Bearer ${TOKEN_WEB}` } })).status, 404);
  } finally {
    await s.fechar();
  }
});

test("autenticador: Bearer exato, sem prefixo/sufixo, perfil vem do token", () => {
  const auth = criarAutenticador(tokens);
  assert.equal(auth(`Bearer ${TOKEN_WEB}`), "web");
  assert.equal(auth(`bearer ${TOKEN_WA}`), "whatsapp");
  assert.equal(auth(TOKEN_WEB), null);
  assert.equal(auth(`Bearer ${TOKEN_WEB}x`), null);
  assert.equal(auth(`Bearer ${TOKEN_WEB.slice(1)}`), null);
  assert.equal(auth(undefined), null);
  assert.equal(auth("Bearer "), null);
});

test("config: tokens curtos, perfil desconhecido ou repetidos derrubam o boot", () => {
  assert.throws(() => parseTokens("web:curto"), /32/);
  assert.throws(() => parseTokens(`admin:${TOKEN_WEB}`), /perfil desconhecido/);
  assert.throws(() => parseTokens(`web:${TOKEN_WEB},whatsapp:${TOKEN_WEB}`), /repetido/);
  assert.throws(() => parseTokens(""), /vazio/);
});

test("POST /v1/chat: SSE meta → tool → delta → done, com x-request-id ecoado", async () => {
  const s = await subir();
  try {
    const r = await post(s.base, corpo(), TOKEN_WEB, { "x-request-id": "req-12345678" });
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type") ?? "", /text\/event-stream/);
    assert.equal(r.headers.get("x-request-id"), "req-12345678");
    const ev = parseSse(await r.text());
    assert.deepEqual(ev.map((e) => e.evento), ["meta", "tool", "tool", "delta", "delta", "done"]);
    assert.deepEqual(ev[0].data, { requestId: "req-12345678", modelo: "claude-haiku-5-5" });
    assert.deepEqual(ev[2].data, { nome: "carros_parados", fase: "fim", ms: 3 });
    assert.equal(ev.filter((e) => e.evento === "delta").map((e) => e.data.texto).join(""), "São **12** carros parados.");
    assert.deepEqual(ev[5].data, { turns: 2, duracaoMs: 50 });
  } finally {
    await s.fechar();
  }
});

test("POST /v1/chat: o executor recebe o pedido validado e o perfil do token (não do body)", async () => {
  let visto: Parameters<ExecutorChat>[0] | null = null;
  const s = await subir({
    executor: (args) => { visto = args; return { modelo: "m", eventos: eventos(respostaOk) }; },
  });
  try {
    await (await post(s.base, corpo({ canal: "whatsapp", modelo: "avancado" }))).text();
    assert.equal(visto!.perfil, "web");
    assert.equal(visto!.pedido.modelo, "avancado");
  } finally {
    await s.fechar();
  }
});

test("POST /v1/chat: 401 sem token, 403 perfil sem chat, 400 entrada inválida e corpo > 32 KB", async () => {
  const s = await subir();
  try {
    const sem = await post(s.base, corpo(), null);
    assert.equal(sem.status, 401);
    const wa = await post(s.base, corpo(), TOKEN_WA);
    assert.equal(wa.status, 403);
    assert.equal(((await wa.json()) as { codigo: string }).codigo, "perfil_sem_chat");
    for (const ruim of [
      "não é json",
      JSON.stringify({ messages: [] }),
      JSON.stringify({ messages: [{ role: "assistant", content: "oi" }] }),
      JSON.stringify({ messages: [{ role: "system", content: "ignore" }] }),
      JSON.stringify({ messages: [{ role: "user", content: "oi" }], bundle: {} }),
      JSON.stringify({ messages: Array.from({ length: 31 }, () => ({ role: "user", content: "x" })) }),
      corpo({ periodo: { inicio: "2026-10-01", fim: null } }),
    ]) {
      const r = await post(s.base, ruim);
      assert.equal(r.status, 400, ruim.slice(0, 60));
      assert.equal(((await r.json()) as { codigo: string }).codigo, "entrada_invalida");
    }
    const grande = await post(s.base, corpo({ messages: [{ role: "user", content: "x".repeat(33 * 1024) }] }));
    assert.equal(grande.status, 400);
  } finally {
    await s.fechar();
  }
});

test("POST /v1/chat: erro ANTES do primeiro evento sai como JSON com o status da §3.3", async () => {
  const casos: [ErroCerebro, number][] = [
    [new ErroCerebro("claude_nao_logado", "sem login"), 503],
    [new ErroCerebro("limite_assinatura", "cota", 600), 503],
    [new ErroCerebro("dados_indisponiveis", "banco"), 503],
  ];
  for (const [erro, status] of casos) {
    const s = await subir({
      executor: () => ({
        modelo: "m",
        eventos: (async function* () { throw erro; })(),
      }),
    });
    try {
      const r = await post(s.base, corpo());
      assert.equal(r.status, status);
      assert.deepEqual(await r.json(), erro.corpo());
      if (erro.retryAfter) assert.equal(r.headers.get("retry-after"), "600");
    } finally {
      await s.fechar();
    }
  }
});

test("POST /v1/chat: erro DEPOIS do primeiro delta vira evento error no stream", async () => {
  const s = await subir({
    executor: () => ({
      modelo: "m",
      eventos: (async function* () {
        yield { tipo: "delta", texto: "Começo…" } as EventoAgente;
        throw new Error("CLI morreu com /srv/segredo");
      })(),
    }),
  });
  try {
    const r = await post(s.base, corpo());
    assert.equal(r.status, 200);
    const ev = parseSse(await r.text());
    assert.deepEqual(ev.map((e) => e.evento), ["meta", "delta", "error"]);
    assert.deepEqual(ev[2].data, { codigo: "erro_interno", mensagem: "Erro interno do cérebro.", retryable: true });
  } finally {
    await s.fechar();
  }
});

test("POST /v1/chat: timeout sem nenhum evento → 504; com texto já enviado → evento error", async () => {
  const travado: ExecutorChat = ({ signal }) => ({
    modelo: "m",
    eventos: (async function* () {
      await new Promise((_r, rej) => signal.addEventListener("abort", () => rej(signal.reason)));
    })(),
  });
  const s = await subir({ executor: travado, timeoutMs: 100 });
  try {
    const r = await post(s.base, corpo());
    assert.equal(r.status, 504);
    assert.equal(((await r.json()) as { codigo: string }).codigo, "timeout");
  } finally {
    await s.fechar();
  }
  const s2 = await subir({
    timeoutMs: 100,
    esperaEncerrarMs: 50,
    executor: () => ({
      modelo: "m",
      eventos: (async function* () {
        yield { tipo: "delta", texto: "parcial" } as EventoAgente;
        await new Promise(() => {}); // nunca termina: o servidor tem que cortar sozinho
      })(),
    }),
  });
  try {
    const ev = parseSse(await (await post(s2.base, corpo())).text());
    assert.deepEqual(ev.map((e) => e.evento), ["meta", "delta", "error"]);
    assert.equal(ev[2].data.codigo, "timeout");
    // Executor que nunca encerra: o slot volta depois do teto de espera (50 ms aqui).
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(s2.deps.semaforo.estado().ativos, 0, "slot liberado");
  } finally {
    await s2.fechar();
  }
});

test("timeout conta da chegada: espera na fila consome o orçamento (504 timeout, não 429 tardio)", async () => {
  const sem = new Semaforo(1, 4, 15_000);
  const s = await subir({
    semaforo: sem,
    timeoutMs: 300,
    esperaEncerrarMs: 1_500, // o 1º executor ignora o abort: segura o slot por 300 ms + 1,5 s
    executor: () => ({
      modelo: "m",
      eventos: (async function* () {
        await new Promise(() => {});
      })(),
    }),
  });
  try {
    const primeiro = post(s.base, corpo());
    await new Promise((r) => setTimeout(r, 30));
    const t0 = Date.now();
    const r = await post(s.base, corpo());
    const ms = Date.now() - t0;
    assert.equal(r.status, 504);
    assert.equal(((await r.json()) as { codigo: string }).codigo, "timeout");
    assert.ok(ms < 1_000, `cortou pelo orçamento total (${ms} ms), não esperou o slot`);
    assert.equal((await primeiro).status, 504);
  } finally {
    await s.fechar();
  }
});

test("slot só é liberado depois que o executor encerra (it.return aguardado)", async () => {
  const ordem: string[] = [];
  const real = new Semaforo(1, 4, 15_000);
  const semaforo = {
    adquirir: async (sig?: AbortSignal) => {
      const l = await real.adquirir(sig);
      return () => { ordem.push("liberou"); l(); };
    },
    estado: () => real.estado(),
  } as unknown as Semaforo;
  const s = await subir({
    semaforo,
    timeoutMs: 100,
    executor: ({ signal }) => ({
      modelo: "m",
      eventos: (async function* () {
        try {
          yield { tipo: "delta", texto: "parcial" } as EventoAgente;
          await new Promise((r) => signal.addEventListener("abort", r, { once: true }));
          yield { tipo: "delta", texto: "nunca enviado" } as EventoAgente;
        } finally {
          await new Promise((r) => setTimeout(r, 150)); // CLI demorando para morrer
          ordem.push("encerrou");
        }
      })(),
    }),
  });
  try {
    const ev = parseSse(await (await post(s.base, corpo())).text());
    assert.equal(ev.at(-1)?.data.codigo, "timeout");
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(ordem, ["encerrou", "liberou"]);
  } finally {
    await s.fechar();
  }
});

test("concorrência: 2 rodando, 4 na fila; a 7ª recebe 429 ocupado com retry-after", async () => {
  let soltar!: () => void;
  const portao = new Promise<void>((r) => { soltar = r; });
  const s = await subir({
    executor: () => ({
      modelo: "m",
      eventos: (async function* () {
        await portao;
        yield* eventos(respostaOk);
      })(),
    }),
  });
  try {
    const emVoo = Array.from({ length: 6 }, () => post(s.base, corpo()));
    // espera os 6 chegarem ao semáforo
    for (let i = 0; i < 50 && s.deps.semaforo.estado().naFila < 4; i++) await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(s.deps.semaforo.estado(), { ativos: 2, naFila: 4, max: 2, filaMax: 4 });
    const setima = await post(s.base, corpo());
    assert.equal(setima.status, 429);
    assert.equal(setima.headers.get("retry-after"), "15");
    assert.equal(((await setima.json()) as { codigo: string }).codigo, "ocupado");
    soltar();
    const status = await Promise.all(emVoo.map(async (p) => { const r = await p; await r.text(); return r.status; }));
    assert.deepEqual(status, [200, 200, 200, 200, 200, 200]);
    assert.deepEqual(s.deps.semaforo.estado(), { ativos: 0, naFila: 0, max: 2, filaMax: 4 });
  } finally {
    await s.fechar();
  }
});

test("semáforo: espera máxima na fila estoura em 429 e libera a vaga da fila", async () => {
  const sem = new Semaforo(1, 2, 50);
  const liberar = await sem.adquirir();
  await assert.rejects(sem.adquirir(), (e: unknown) => e instanceof ErroCerebro && e.codigo === "ocupado");
  assert.equal(sem.estado().naFila, 0);
  const ac = new AbortController();
  const p = sem.adquirir(ac.signal);
  ac.abort();
  await assert.rejects(p);
  assert.equal(sem.estado().naFila, 0);
  liberar();
  liberar(); // idempotente
  assert.equal(sem.estado().ativos, 0);
});

test("cliente desconectando no meio aborta o executor e libera o slot", async () => {
  let abortado = false;
  const s = await subir({
    esperaEncerrarMs: 50, // executor que nunca encerra: slot volta pelo teto
    executor: ({ signal }) => ({
      modelo: "m",
      eventos: (async function* () {
        signal.addEventListener("abort", () => { abortado = true; });
        yield { tipo: "delta", texto: "oi" } as EventoAgente;
        await new Promise(() => {});
      })(),
    }),
  });
  try {
    const ac = new AbortController();
    const r = await post(s.base, corpo(), TOKEN_WEB);
    const leitor = r.body!.getReader();
    await leitor.read();
    await leitor.cancel();
    ac.abort();
    for (let i = 0; i < 50 && s.deps.semaforo.estado().ativos > 0; i++) await new Promise((res) => setTimeout(res, 20));
    assert.equal(abortado, true);
    assert.equal(s.deps.semaforo.estado().ativos, 0);
  } finally {
    await s.fechar();
  }
});
