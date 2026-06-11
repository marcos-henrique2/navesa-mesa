/**
 * Funções puras pra construir o Map<chassi, repasse_id> usado na UI.
 *
 * Arquivo separado de queries.ts pra ficar testável no Node sem arrastar
 * o cliente Supabase (que é "use client" e tenta resolver vars de ambiente).
 */

export type RepasseAtivoRow = {
  id: number;
  chassi: string;
};

/**
 * Constrói o Map<chassi, repasse_id> a partir das rows do Supabase.
 * Em caso de chassi duplicado (não deveria acontecer com status='subido'),
 * o último vence — defensivo, sem throw.
 */
export function buildChassisEmRepasseMap(
  rows: ReadonlyArray<RepasseAtivoRow>,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.chassi, r.id);
  return map;
}
