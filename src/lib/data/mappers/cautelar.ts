/**
 * Mapper PURO de `cautelar` → mapa chassi → status.
 * Sem "use client", sem Supabase: usado pelo client e pelo cérebro (Node).
 */
import type { StatusCautelar } from "@/lib/inventory/cautelar-tipos";

/**
 * Colunas de `cautelar` que a role `cerebro_leitor` pode ler — espelho da allowlist
 * de `supabase/migrations/051_cerebro_leitor.sql` (sem `observacao`, texto livre).
 * Use no `SELECT` do cérebro: `select *` falha, a role só tem GRANT por coluna.
 */
export const CAUTELAR_COLUNAS_CEREBRO = ["chassi", "status", "atualizado_em"] as const;

export type CautelarRow = {
  chassi: string;
  status: StatusCautelar;
  /** Ausente no SELECT do cérebro (coluna bloqueada na 051); o browser recebe via `select *`. */
  observacao?: string | null;
  atualizado_em: string;
};

export function montarCautelares(rows: CautelarRow[]): Record<string, StatusCautelar> {
  const map: Record<string, StatusCautelar> = {};
  for (const r of rows) map[r.chassi] = r.status;
  return map;
}
