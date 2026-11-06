import { randomUUID } from "node:crypto";
import { getRateLimiter } from "@/lib/ratelimit";
import { createClient } from "@/lib/supabase/server";
import { responderComProviders, type RequestBody } from "@/lib/chat/providers";
import {
  abrirStreamCerebro,
  lerBackend,
  lerConfigCerebro,
  mensagemErroCerebro,
  statusParaBrowser,
  type ChatBackend,
} from "@/lib/chat/cerebro-client";

/**
 * Chat IA. Ordem: auth Supabase → rate limit → backend (docs/arquitetura/cerebro-claude.md §3.4).
 *
 * Backend por env (só servidor):
 *   CHAT_BACKEND=providers (default) — DeepSeek/Groq/Gemini/Anthropic, comportamento histórico.
 *   CHAT_BACKEND=cerebro             — só o cérebro (Claude no Docker); erro vira resposta de erro.
 *   CHAT_BACKEND=auto                — cérebro; se falhar ANTES do primeiro texto, cai nos providers.
 *   CEREBRO_URL, CEREBRO_TOKEN, CEREBRO_TIMEOUT_MS (110000).
 *
 * Rate limit:
 *   10 req/min por user (sliding window via Upstash Redis).
 *   Se UPSTASH_REDIS_REST_URL/TOKEN não setados, rate limit fica DESABILITADO
 *   (log warning, sistema continua funcionando). Configure em https://console.upstash.com
 *   → create Redis database → copiar REST URL + TOKEN pro .env.local e Vercel.
 */
export const runtime = "nodejs";
// 120s: o cérebro corta em 110s (CEREBRO_TIMEOUT_MS) e o cliente espera +5s pelo evento de erro.
export const maxDuration = 120;

const json = (status: number, corpo: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json", ...headers } });

async function autenticar() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/**
 * Backend ativo, para o Chat.tsx decidir se precisa montar/enviar o bundle
 * (no modo `cerebro` o browser não manda bundle). Não expõe URL nem token.
 */
export async function GET() {
  const user = await autenticar();
  if (!user) return json(401, { error: "Não autenticado" });
  return json(200, { backend: lerBackend() satisfies ChatBackend });
}

export async function POST(req: Request) {
  try {
    // 1) Autenticação — precisa do user.id pra chavear o rate limit.
    //    Sem user, devolve 401 antes de gastar qualquer recurso.
    const user = await autenticar();
    if (!user) return json(401, { error: "Não autenticado" });

    // 2) Rate limit por user (se Upstash configurado — senão pula gracefully).
    //    Bloqueia antes do parse do body e antes de instanciar providers.
    const limiter = getRateLimiter();
    if (limiter) {
      try {
        const { success, limit, remaining, reset } = await limiter.limit(user.id);
        if (!success) {
          const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
          return json(
            429,
            { error: `Limite de ${limit} mensagens por minuto atingido. Aguarde ${retryAfter}s.`, retryAfter },
            {
              "x-ratelimit-limit": String(limit),
              "x-ratelimit-remaining": String(remaining),
              "x-ratelimit-reset": String(reset),
              "retry-after": String(retryAfter),
            },
          );
        }
      } catch (err) {
        // Upstash indisponível (rede, 5xx, timeout) — fail-open libera o request
        // pra não derrubar chat inteiro. Graceful degradation > rigor do rate limit.
        console.error("[ratelimit] Erro consultando Upstash, request liberado:", err);
      }
    }

    const body = (await req.json()) as RequestBody;
    const backend = lerBackend();
    if (backend === "providers") return responderComProviders(body);

    // 3) Cérebro
    const config = lerConfigCerebro();
    if (!config) {
      if (backend === "auto") return responderComProviders(body);
      return json(500, { error: "CHAT_BACKEND=cerebro, mas CEREBRO_URL/CEREBRO_TOKEN não estão configurados no servidor." });
    }

    const requestId = randomUUID();
    const r = await abrirStreamCerebro({ config, body, requestId, userId: user.id, signal: req.signal });
    if (r.ok) {
      return new Response(r.stream, {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "x-provider-usado": "cerebro",
          "x-request-id": requestId,
        },
      });
    }

    const log = r.erro.codigo === "token_invalido" || r.erro.codigo === "claude_nao_logado" ? console.error : console.warn;
    log(`[chat] cérebro falhou (${requestId}): ${r.erro.status} ${r.erro.codigo}`);
    if (backend === "auto") return responderComProviders(body);

    return json(
      statusParaBrowser(r.erro),
      { error: mensagemErroCerebro(r.erro), codigo: r.erro.codigo, retryAfter: r.erro.retryAfter ?? null },
      {
        "x-provider-usado": "cerebro",
        "x-request-id": requestId,
        ...(r.erro.retryAfter ? { "retry-after": String(r.erro.retryAfter) } : {}),
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json(500, { error: msg });
  }
}
