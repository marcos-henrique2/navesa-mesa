/**
 * Helpers PUROS de conversão de linha do banco (sem browser, sem Supabase).
 * Reutilizáveis pelo client e pelo serviço Node do cérebro.
 */

/** Converte ISO string (ou null) pra Date (ou null). Supabase devolve timestamptz como string. */
export function parseDate(v: unknown): Date | null {
  if (v == null || v === "") return null;
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d;
}
