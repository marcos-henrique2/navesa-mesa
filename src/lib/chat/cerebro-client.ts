/**
 * Cliente do cérebro (Claude Agent SDK no Docker) para o /api/chat.
 * Contrato: docs/arquitetura/cerebro-claude.md §3.
 *
 * Fala SSE com o cérebro e devolve `text/plain` (o formato que o Chat.tsx já lê):
 *   - `delta`  → texto;
 *   - `tool`, `meta`, `done` → descartados (indicador de tool é a fatia 1e);
 *   - `error` depois do primeiro texto → o stream é ABORTADO, e o Chat.tsx marca
 *     a resposta como "interrompida" (comportamento que ele já tem).
 *
 * `abrirStreamCerebro` só resolve depois do PRIMEIRO `delta` (ou de um erro/fim
 * antes dele). Assim o modo `auto` ainda pode cair nos providers sem que o
 * usuário tenha visto meia resposta.
 *
 * Só servidor: lê CEREBRO_URL/CEREBRO_TOKEN (nunca NEXT_PUBLIC_).
 */
import type { RequestBody } from "@/lib/chat/providers";

export type ChatBackend = "providers" | "cerebro" | "auto";

export type ConfigCerebro = { url: string; token: string; timeoutMs: number };

export const CEREBRO_TIMEOUT_PADRAO_MS = 110_000;
/** Mesmo teto do cérebro (32 KB); fica uma folga para os headers do JSON. */
const LIMITE_CORPO_BYTES = 30 * 1024;
const MAX_MENSAGENS = 30;

export function lerBackend(env: Record<string, string | undefined> = process.env): ChatBackend {
  const v = (env.CHAT_BACKEND ?? "").trim().toLowerCase();
  return v === "cerebro" || v === "auto" ? v : "providers";
}

export function lerConfigCerebro(env: Record<string, string | undefined> = process.env): ConfigCerebro | null {
  const url = env.CEREBRO_URL?.trim();
  const token = env.CEREBRO_TOKEN?.trim();
  if (!url || !token) return null;
  const t = Number(env.CEREBRO_TIMEOUT_MS);
  return {
    url: url.replace(/\/+$/, ""),
    token,
    timeoutMs: Number.isFinite(t) && t >= 5_000 ? t : CEREBRO_TIMEOUT_PADRAO_MS,
  };
}

type CorpoCerebro = {
  messages: RequestBody["messages"];
  periodo: { inicio: string | null; fim: string | null } | null;
  canal: "web";
  modelo?: "rapido" | "avancado";
};

/**
 * Corpo do contrato §3.1: SEM bundle (o cérebro lê do banco), últimas 30
 * mensagens e, se ainda passar de ~30 KB, corta as mais antigas.
 */
export function montarCorpoCerebro(body: RequestBody): CorpoCerebro {
  const datas = /^\d{2}\/\d{2}\/\d{4}$/;
  const periodo = body.periodo
    ? {
        inicio: body.periodo.inicio && datas.test(body.periodo.inicio) ? body.periodo.inicio : null,
        fim: body.periodo.fim && datas.test(body.periodo.fim) ? body.periodo.fim : null,
      }
    : null;
  let messages = (body.messages ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content }))
    .slice(-MAX_MENSAGENS);
  const montar = (): CorpoCerebro => ({
    messages,
    periodo,
    canal: "web",
    ...(body.modelo === "rapido" || body.modelo === "avancado" ? { modelo: body.modelo } : {}),
  });
  while (messages.length > 1 && new TextEncoder().encode(JSON.stringify(montar())).length > LIMITE_CORPO_BYTES) {
    messages = messages.slice(1);
  }
  return montar();
}

export type ErroCerebroCliente = {
  /** Status HTTP do cérebro (0 = não conectou / timeout local). */
  status: number;
  codigo: string;
  mensagem: string;
  retryAfter?: number;
};

export type ResultadoCerebro =
  | { ok: true; stream: ReadableStream<Uint8Array> }
  | { ok: false; erro: ErroCerebroCliente };

type EventoSse = { evento: string; data: string };

/** Parser SSE incremental (linhas `event:`/`data:`, bloco termina em linha vazia). */
export function criarParserSse(): (pedaco: string) => EventoSse[] {
  let buf = "";
  return (pedaco) => {
    buf += pedaco.replace(/\r\n/g, "\n");
    const out: EventoSse[] = [];
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const bloco = buf.slice(0, i);
      buf = buf.slice(i + 2);
      let evento = "message";
      const dados: string[] = [];
      for (const linha of bloco.split("\n")) {
        if (linha.startsWith("event:")) evento = linha.slice(6).trim();
        else if (linha.startsWith("data:")) dados.push(linha.slice(5).replace(/^ /, ""));
      }
      if (dados.length > 0) out.push({ evento, data: dados.join("\n") });
    }
    return out;
  };
}

function lerJson(s: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(s);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const textoOu = (v: unknown, padrao: string) => (typeof v === "string" && v ? v : padrao);

export class ErroStreamCerebro extends Error {
  constructor(readonly codigo: string, mensagem: string) {
    super(mensagem);
    this.name = "ErroStreamCerebro";
  }
}

export async function abrirStreamCerebro(args: {
  config: ConfigCerebro;
  body: RequestBody;
  requestId: string;
  userId: string;
  /** Abort do request do browser (aba fechada). */
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<ResultadoCerebro> {
  const { config } = args;
  const fetchImpl = args.fetchImpl ?? fetch;
  const ac = new AbortController();
  // +5s: o cérebro corta em CEREBRO_TIMEOUT_MS e manda o evento `error`; damos tempo de ele chegar.
  const timer = setTimeout(() => ac.abort(new Error("timeout")), config.timeoutMs + 5_000);
  const repassarAbort = () => ac.abort(new Error("cliente desconectou"));
  args.signal?.addEventListener("abort", repassarAbort, { once: true });
  const limpar = () => {
    clearTimeout(timer);
    args.signal?.removeEventListener("abort", repassarAbort);
  };

  let resp: Response;
  try {
    resp = await fetchImpl(`${config.url}/v1/chat`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
        accept: "text/event-stream",
        "x-request-id": args.requestId,
        "x-navesa-user": args.userId,
      },
      body: JSON.stringify(montarCorpoCerebro(args.body)),
      signal: ac.signal,
      cache: "no-store",
    });
  } catch {
    limpar();
    return { ok: false, erro: { status: 0, codigo: "indisponivel", mensagem: "Cérebro indisponível (sem conexão ou sem resposta a tempo)." } };
  }

  if (!resp.ok || !resp.body) {
    limpar();
    const j = lerJson(await resp.text().catch(() => "")) ?? {};
    const retry = Number(j.retryAfter ?? resp.headers.get("retry-after"));
    return {
      ok: false,
      erro: {
        status: resp.status,
        codigo: textoOu(j.codigo, "erro_http"),
        mensagem: textoOu(j.mensagem, `Cérebro respondeu HTTP ${resp.status}.`),
        ...(Number.isFinite(retry) && retry > 0 ? { retryAfter: retry } : {}),
      },
    };
  }

  const leitor = resp.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const parse = criarParserSse();
  const pendentes: string[] = [];
  let fimRecebido = false;

  /** Lê até ter texto para entregar. Lança ErroStreamCerebro em `error`. `null` = acabou. */
  async function proximoTexto(): Promise<string | null> {
    while (pendentes.length === 0) {
      if (fimRecebido) return null;
      const { value, done } = await leitor.read();
      if (done) {
        if (!fimRecebido) throw new ErroStreamCerebro("stream_cortado", "O cérebro encerrou o stream sem concluir.");
        return null;
      }
      for (const ev of parse(decoder.decode(value, { stream: true }))) {
        const d = lerJson(ev.data) ?? {};
        if (ev.evento === "delta" && typeof d.texto === "string" && d.texto) pendentes.push(d.texto);
        else if (ev.evento === "done") fimRecebido = true;
        else if (ev.evento === "error") {
          throw new ErroStreamCerebro(textoOu(d.codigo, "erro_interno"), textoOu(d.mensagem, "Erro no cérebro."));
        }
      }
    }
    return pendentes.shift() as string;
  }

  let primeiro: string | null;
  try {
    primeiro = await proximoTexto();
  } catch (err) {
    limpar();
    void leitor.cancel().catch(() => {});
    const e = err instanceof ErroStreamCerebro
      ? err
      : new ErroStreamCerebro(ac.signal.aborted ? "timeout" : "stream_cortado", "Cérebro não respondeu a tempo.");
    return { ok: false, erro: { status: 200, codigo: e.codigo, mensagem: e.message } };
  }
  if (primeiro === null) {
    limpar();
    return { ok: false, erro: { status: 200, codigo: "resposta_vazia", mensagem: "O cérebro terminou sem resposta." } };
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(primeiro as string));
    },
    async pull(controller) {
      try {
        const t = await proximoTexto();
        if (t === null) {
          limpar();
          controller.close();
        } else controller.enqueue(encoder.encode(t));
      } catch (err) {
        limpar();
        void leitor.cancel().catch(() => {});
        // Erro no meio: aborta o stream; o Chat.tsx marca "Resposta interrompida".
        controller.error(err instanceof Error ? err : new Error("stream do cérebro interrompido"));
      }
    },
    cancel() {
      limpar();
      ac.abort(new Error("cliente cancelou"));
      void leitor.cancel().catch(() => {});
    },
  });
  return { ok: true, stream };
}

/** Mensagem pt-BR para o usuário quando o modo é `cerebro` (sem fallback). */
export function mensagemErroCerebro(e: ErroCerebroCliente): string {
  switch (e.codigo) {
    case "claude_nao_logado":
      return "O Claude do cérebro está sem login. Refaça o /login no container (ver cerebro/README.md).";
    case "limite_assinatura":
      return e.mensagem || "A cota do Claude esgotou por enquanto.";
    case "ocupado":
      return "O assistente está ocupado com outras perguntas. Tente de novo em alguns segundos.";
    case "dados_indisponiveis":
      return "O assistente não conseguiu ler os dados da Navesa agora. Tente de novo em instantes.";
    case "token_invalido":
      return "Configuração do assistente inválida (token do cérebro). Avise o administrador.";
    case "timeout":
      return "O assistente demorou demais para responder. Tente uma pergunta mais específica.";
    case "indisponivel":
      return "O assistente (cérebro) está fora do ar. Verifique se o container está rodando.";
    default:
      return "O assistente teve um erro ao responder. Tente de novo.";
  }
}

/** Status HTTP que o /api/chat devolve ao browser no modo `cerebro`. */
export function statusParaBrowser(e: ErroCerebroCliente): number {
  if (e.codigo === "ocupado") return 429;
  if (e.codigo === "entrada_invalida") return 400;
  if (e.codigo === "timeout") return 504;
  return 503;
}
