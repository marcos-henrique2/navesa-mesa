/**
 * Sentry — config do navegador (cliente).
 *
 * Captura erros JS que acontecem na UI: bugs em componentes, falhas de fetch,
 * erros não tratados em event handlers, etc.
 *
 * Graceful degradation: se SENTRY_DSN não estiver setado, Sentry vira no-op.
 * Útil em dev local — Marcos só precisa configurar DSN em produção.
 */

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    // Ambiente — Sentry agrupa erros por env (dev/prod/preview)
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development",

    // Amostragem de transações (performance tracing).
    // 10% em prod pra economizar quota — pode aumentar se quiser mais detalhe.
    tracesSampleRate: 0.1,

    // Replays — gravação do que o usuário fez antes do erro.
    // Só replay quando dá erro (replaysOnErrorSampleRate=1.0).
    // Sessões normais sem erro: 0% (economia de quota).
    replaysSessionSampleRate: 0.0,
    replaysOnErrorSampleRate: 1.0,

    // Filtra erros benignos (não são bugs nossos)
    ignoreErrors: [
      // Network errors do navegador do usuário (sem internet, CORS de extensão, etc.)
      "NetworkError",
      "Failed to fetch",
      "Load failed",
      // ResizeObserver loop — bug benigno do Chromium, não afeta usuário
      "ResizeObserver loop limit exceeded",
      "ResizeObserver loop completed with undelivered notifications",
      // Erros de extensões do navegador
      /extension\//i,
      /chrome-extension:\/\//i,
      /^chrome:\/\//i,
    ],

    // Não enviar dados sensíveis: cookies, headers de auth, etc.
    sendDefaultPii: false,

    integrations: [
      Sentry.replayIntegration({
        // Mascara conteúdo de texto/imagens nos replays — privacidade
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
  });
}
