/**
 * Servidor HTTP do cérebro (doc §3): node:http puro, sem framework.
 *
 *   GET  /health      liveness sem auth (Docker HEALTHCHECK): { ok: true }
 *   GET  /v1/health   com Bearer: { ok, claudeLogado, versaoCli, cache, fila }
 *   POST /v1/chat     com Bearer: SSE meta → tool/delta… → done | error
 *
 * Erros ANTES do primeiro byte do stream saem como JSON `{codigo, mensagem,
 * retryAfter?}` com o status da §3.3. Por isso os headers SSE só são enviados
 * quando o executor produz o primeiro evento: até lá, `claude_nao_logado`,
 * `limite_assinatura` e `timeout` ainda viram 503/504 e o `/api/chat` pode cair
 * no fallback. Depois disso, erro vira evento `error`.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { Autenticador } from "@cerebro/auth";
import type { Semaforo } from "@cerebro/semaforo";
import { ErroCerebro, comoErroCerebro } from "@cerebro/erros";
import { LIMITE_CORPO_BYTES, PedidoChatSchema, type EventoAgente, type ExecutorChat } from "@cerebro/contrato";
import { PERFIS } from "@cerebro/perfis";
import { resumoErro, type Log } from "@cerebro/log";

export type DepsServidor = {
  autenticar: Autenticador;
  semaforo: Semaforo;
  executor: ExecutorChat;
  timeoutMs: number;
  health: () => Promise<Record<string, unknown>>;
  log: Log;
};

const REQUEST_ID_OK = /^[A-Za-z0-9-]{8,64}$/;

function json(res: ServerResponse, status: number, corpo: unknown, headers: Record<string, string> = {}): void {
  if (res.headersSent) return;
  const s = JSON.stringify(corpo);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(s),
    "cache-control": "no-store",
    ...headers,
  });
  res.end(s);
}

function jsonErro(res: ServerResponse, e: ErroCerebro, requestId: string): void {
  const headers: Record<string, string> = { "x-request-id": requestId };
  if (e.retryAfter != null) headers["retry-after"] = String(e.retryAfter);
  json(res, e.status, e.corpo(), headers);
}

function lerCorpo(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const declarado = Number(req.headers["content-length"] ?? 0);
    if (declarado > LIMITE_CORPO_BYTES) {
      reject(new ErroCerebro("entrada_invalida", `Corpo maior que ${LIMITE_CORPO_BYTES} bytes.`));
      req.resume();
      return;
    }
    const partes: Buffer[] = [];
    let total = 0;
    let estourou = false;
    req.on("data", (c: Buffer) => {
      if (estourou) return;
      total += c.length;
      if (total > LIMITE_CORPO_BYTES) {
        estourou = true;
        reject(new ErroCerebro("entrada_invalida", `Corpo maior que ${LIMITE_CORPO_BYTES} bytes.`));
        return;
      }
      partes.push(c);
    });
    req.on("end", () => {
      if (!estourou) resolve(Buffer.concat(partes).toString("utf8"));
    });
    req.on("error", reject);
  });
}

function sse(res: ServerResponse, evento: string, data: unknown): void {
  res.write(`event: ${evento}\ndata: ${JSON.stringify(data)}\n\n`);
}

function payloadEvento(ev: EventoAgente): unknown {
  switch (ev.tipo) {
    case "tool":
      return ev.ms == null ? { nome: ev.nome, fase: ev.fase } : { nome: ev.nome, fase: ev.fase, ms: ev.ms };
    case "delta":
      return { texto: ev.texto };
    case "done":
      return { turns: ev.turns, duracaoMs: ev.duracaoMs, ...(ev.usage ? { usage: ev.usage } : {}) };
  }
}

/** Próximo item do iterador ou rejeição assim que `signal` abortar (não espera o executor). */
function proximo<T>(it: AsyncIterator<T>, signal: AbortSignal): Promise<IteratorResult<T>> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    it.next().then(
      (r) => { signal.removeEventListener("abort", onAbort); resolve(r); },
      (e) => { signal.removeEventListener("abort", onAbort); reject(e); },
    );
  });
}

async function tratarChat(req: IncomingMessage, res: ServerResponse, deps: DepsServidor, requestId: string, perfil: NonNullable<ReturnType<Autenticador>>) {
  const inicio = Date.now();
  if (!PERFIS[perfil].chatHabilitado) {
    throw new ErroCerebro("perfil_sem_chat", "Este token não tem acesso ao chat nesta versão.");
  }
  const bruto = await lerCorpo(req);
  let corpo: unknown;
  try {
    corpo = JSON.parse(bruto);
  } catch {
    throw new ErroCerebro("entrada_invalida", "Corpo não é JSON válido.");
  }
  const parsed = PedidoChatSchema.safeParse(corpo);
  if (!parsed.success) {
    const campos = parsed.error.issues.map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`).slice(0, 5).join("; ");
    throw new ErroCerebro("entrada_invalida", `Entrada inválida: ${campos}`);
  }

  const ac = new AbortController();
  const onClose = () => {
    if (!res.writableFinished) ac.abort(new ErroCerebro("timeout", "Cliente desconectou."));
  };
  res.on("close", onClose);

  let liberar: () => void;
  try {
    liberar = await deps.semaforo.adquirir(ac.signal);
  } catch (err) {
    res.off("close", onClose);
    throw err;
  }
  const timer = setTimeout(
    () => ac.abort(new ErroCerebro("timeout", `Sem resposta completa em ${Math.round(deps.timeoutMs / 1000)}s.`)),
    deps.timeoutMs,
  );
  let iniciado = false;
  let it: AsyncIterator<EventoAgente> | null = null;
  try {
    const { modelo, eventos } = deps.executor({ pedido: parsed.data, perfil, requestId, signal: ac.signal });
    const iniciar = () => {
      if (iniciado) return;
      iniciado = true;
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
        "x-request-id": requestId,
      });
      sse(res, "meta", { requestId, modelo });
    };
    it = eventos[Symbol.asyncIterator]();
    while (true) {
      const r = await proximo(it, ac.signal);
      if (r.done) break;
      iniciar();
      sse(res, r.value.tipo, payloadEvento(r.value));
    }
    iniciar();
    deps.log.info("chat ok", { requestId, perfil, modelo, ms: Date.now() - inicio });
  } catch (err) {
    const e = err instanceof ErroCerebro ? err : comoErroCerebro(ac.signal.aborted ? ac.signal.reason : err);
    deps.log.erro("chat falhou", { requestId, perfil, codigo: e.codigo, iniciado, ms: Date.now() - inicio, erro: resumoErro(err) });
    if (!iniciado) jsonErro(res, e, requestId);
    else if (!res.writableEnded) sse(res, "error", { codigo: e.codigo, mensagem: e.message, retryable: e.retryable });
  } finally {
    clearTimeout(timer);
    if (!ac.signal.aborted) ac.abort(new ErroCerebro("timeout", "Requisição encerrada."));
    void it?.return?.().catch(() => {});
    liberar();
    res.off("close", onClose);
    if (iniciado && !res.writableEnded) res.end();
  }
}

export function criarServidor(deps: DepsServidor): Server {
  return createServer((req, res) => {
    const recebido = req.headers["x-request-id"];
    const requestId = typeof recebido === "string" && REQUEST_ID_OK.test(recebido) ? recebido : randomUUID();
    const url = new URL(req.url ?? "/", "http://cerebro");

    void (async () => {
      try {
        if (req.method === "GET" && url.pathname === "/health") {
          json(res, 200, { ok: true });
          return;
        }
        const rotaChat = url.pathname === "/v1/chat";
        const rotaHealth = url.pathname === "/v1/health";
        if (!(rotaChat && req.method === "POST") && !(rotaHealth && req.method === "GET")) {
          throw new ErroCerebro("nao_encontrado", "Rota não encontrada.");
        }
        const perfil = deps.autenticar(req.headers.authorization);
        if (!perfil) {
          deps.log.erro("token inválido", { requestId, rota: url.pathname });
          throw new ErroCerebro("token_invalido", "Token ausente ou inválido.");
        }
        if (rotaHealth) {
          json(res, 200, { ...(await deps.health()), fila: deps.semaforo.estado() }, { "x-request-id": requestId });
          return;
        }
        await tratarChat(req, res, deps, requestId, perfil);
      } catch (err) {
        const e = comoErroCerebro(err);
        if (e.codigo === "erro_interno") deps.log.erro("erro interno", { requestId, erro: resumoErro(err) });
        jsonErro(res, e, requestId);
      }
    })();
  });
}
