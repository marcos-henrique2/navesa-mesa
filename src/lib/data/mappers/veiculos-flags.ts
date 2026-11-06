/**
 * Colunas PURAS de `veiculos_flags` (sem "use client", sem Supabase).
 * O CRUD/cache do browser segue em `@/lib/data/flags-veiculo`.
 */

/**
 * Colunas de `veiculos_flags` que a role `cerebro_leitor` pode ler — espelho da
 * allowlist de `supabase/migrations/051_cerebro_leitor.sql` (sem `observacao_brinde`,
 * texto livre). Use no `SELECT` do cérebro: `select *` falha, a role só tem GRANT por coluna.
 */
export const VEICULOS_FLAGS_COLUNAS_CEREBRO = ["chassi", "em_promocao", "brinde_acessorios", "atualizado_em"] as const;
