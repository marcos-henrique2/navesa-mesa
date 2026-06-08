/**
 * Next.js instrumentation hook — registra Sentry no runtime correto.
 *
 * Next 16 detecta esse arquivo automaticamente e chama `register()` quando
 * o servidor inicializa. Cada runtime (Node.js / Edge) carrega seu config
 * específico via dynamic import — evita bundle bloat e mantém boundaries.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Captura erros em React Server Components e route handlers.
// Sem isso, erros server-side não chegam no painel do Sentry.
export { captureRequestError as onRequestError } from "@sentry/nextjs";
