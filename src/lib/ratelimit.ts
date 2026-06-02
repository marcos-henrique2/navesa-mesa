/**
 * Rate limit do /api/chat usando Upstash Redis (sliding window).
 *
 * Por quê:
 *   O handler tenta 4 providers de IA em sequência → 1 request × 4 providers
 *   = 4× consumo de quota. Sem rate limit, qualquer user (ou conta comprometida)
 *   pode queimar todas as quotas gratuitas em minutos.
 *
 * Limite:
 *   10 requests/minuto por user (sliding window). Generoso pra uso humano
 *   normal, mas previne abuso/script.
 *
 * Graceful degradation:
 *   Se UPSTASH_REDIS_REST_URL/TOKEN não setados, retorna null e o sistema
 *   continua funcionando (com warning no log). Marcos vai configurar Upstash
 *   na Vercel depois — até lá, dev local funciona sem rate limit.
 *
 * Como configurar:
 *   1. Criar conta grátis em https://console.upstash.com
 *   2. Create Database → Redis (qualquer região perto, free tier dá 10k req/dia)
 *   3. Copiar REST URL e REST TOKEN da aba "REST API"
 *   4. Adicionar UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN no .env.local
 *      (e no Vercel Project Settings → Environment Variables)
 */
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

function criarRateLimit(): Ratelimit | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    console.warn(
      "[ratelimit] UPSTASH_REDIS_REST_URL/TOKEN não configurados — rate limit DESABILITADO. " +
        "Configure em https://console.upstash.com pra ativar.",
    );
    return null;
  }
  const redis = new Redis({ url, token });
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, "1 m"),
    analytics: true,
    prefix: "navesa-mesa:chat",
  });
}

// Singleton — uma instância por processo, não recria a cada request.
// `undefined` = ainda não inicializado, `null` = inicializado mas sem env vars.
let _limiter: Ratelimit | null | undefined;

export function getRateLimiter(): Ratelimit | null {
  if (_limiter === undefined) _limiter = criarRateLimit();
  return _limiter;
}
