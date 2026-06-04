import type { NextConfig } from "next";

/**
 * Hosts externos que o app conecta legitimamente (CSP connect-src).
 * Adicionar aqui sempre que integrar com novo serviço externo.
 */
const CONNECT_HOSTS = [
  "'self'",
  // Supabase (REST + Auth + Realtime)
  "https://*.supabase.co",
  "wss://*.supabase.co",
  // AI providers do chat
  "https://api.deepseek.com",
  "https://api.groq.com",
  "https://generativelanguage.googleapis.com",
  "https://api.anthropic.com",
  // FIPE
  "https://parallelum.com.br",
  // Upstash (rate limit — quando ativado)
  "https://*.upstash.io",
];

/**
 * Content-Security-Policy. Endurece progressivamente conforme o app cresce.
 *
 * - `unsafe-inline` em script-src/style-src: Next.js precisa pra hidratação
 *   e Tailwind 4 pra estilos inline. Migrar pra nonce-based no futuro.
 * - `unsafe-eval` em script-src: algumas libs (pdfjs-dist worker) usam.
 * - `blob:` em worker-src: pdfjs-dist precisa pra rodar worker.
 * - `frame-ancestors 'none'`: previne clickjacking via iframe.
 * - `base-uri 'self'`: previne <base> tag injection.
 */
const CSP = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline' 'unsafe-eval'`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: blob:`,
  `font-src 'self' data:`,
  `connect-src ${CONNECT_HOSTS.join(" ")}`,
  `worker-src 'self' blob:`,
  `frame-ancestors 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
