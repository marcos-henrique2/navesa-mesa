/**
 * Sentry — config do servidor (Node.js runtime).
 *
 * Captura erros em rotas API, server actions, middlewares e
 * server components. Sem isso, qualquer falha no backend é silenciosa.
 */

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development",
    tracesSampleRate: 0.1,
    sendDefaultPii: false,

    // Ignora erros operacionais conhecidos no servidor.
    ignoreErrors: [
      // Aborto de request (usuário fechou aba/cancelou) — não é bug
      "AbortError",
      "Request aborted",
      // Timeouts esperados em integrações externas
      /ECONNREFUSED/,
      /ETIMEDOUT/,
      /ENOTFOUND/,
    ],

    // Hook pra filtrar/enriquecer eventos antes de mandar pro Sentry.
    beforeSend(event) {
      // Não mandar erros que vêm de healthcheck/uptime monitors
      if (event.request?.url?.includes("/api/health")) return null;
      return event;
    },
  });
}
