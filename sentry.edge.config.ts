/**
 * Sentry — config do edge runtime.
 *
 * Edge runtime é mais restrito que Node (sem fs, sem alguns globals).
 * Esse projeto não usa middleware nem rotas edge atualmente, mas a config
 * fica pronta caso a gente adicione no futuro.
 */

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development",
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
  });
}
