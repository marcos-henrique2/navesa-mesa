import { createClient } from "@/lib/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente Supabase compartilhado pro browser.
 * createBrowserClient já faz dedup internamente — chamadas múltiplas
 * retornam a mesma instância.
 */
export function getSupabase(): SupabaseClient {
  return createClient();
}

/**
 * Divide uma lista em chunks. Útil pra batch insert/upsert no Supabase
 * (limite default ~1000 por request).
 */
export function chunk<T>(arr: T[], size: number = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Busca TODAS as linhas de uma tabela paginando (Supabase limita ~1000/request).
 * Use pra carregar datasets que podem passar de 1000 linhas (vendas, veículos).
 */
export async function selectAll<T>(
  sb: SupabaseClient,
  tabela: string,
  opts: { orderBy?: string; pageSize?: number } = {},
): Promise<T[]> {
  const pageSize = opts.pageSize ?? 1000;
  const orderBy = opts.orderBy ?? "id";
  const all: T[] = [];
  let from = 0;
  while (true) {
    const q = sb.from(tabela).select("*").order(orderBy, { ascending: true }).range(from, from + pageSize - 1);
    const { data, error } = await q;
    if (error) throw new Error(`Falha ao ler ${tabela}: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

/** Re-export: implementação pura em `@/lib/data/mappers/datas` (reuso no cérebro). */
export { parseDate } from "@/lib/data/mappers/datas";
