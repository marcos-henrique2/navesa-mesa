-- ═══════════════════════════════════════════════════════════════════════════
-- 039 — tabela sync_log (observabilidade da importação NBS → Supabase)
-- ═══════════════════════════════════════════════════════════════════════════
-- Um script local (roda no PC do Marcos, FORA da Vercel, agendado de 2 em 2h)
-- importa dados do NBS (Oracle) pro Supabase usando SUPABASE_SERVICE_ROLE_KEY.
-- Essa tabela registra cada execução — início, fim, status, contagem de linhas,
-- erro, duração — pra dar visibilidade de "rodou? quando? deu erro?" sem
-- precisar abrir log de terminal no PC.
--
-- fonte: valores esperados 'veiculos' | 'vendas' | 'custos' (sem CHECK rígido
-- de propósito — o script evolui e pode ganhar novas fontes sem migration).
-- status: valores esperados 'em_andamento' | 'sucesso' | 'erro' (mesmo motivo).
--
-- RLS: o script grava com service_role, que bypassa RLS por natureza — não
-- precisa de policy de escrita aqui. Criamos só policy de LEITURA pra usuários
-- autenticados do app (mesmo princípio "auth.uid() is not null" da 005
-- authenticated_all_access, mas restrita a SELECT porque não há necessidade
-- de escrita client-side nessa tabela), caso a gente queira expor uma telinha
-- de status depois.
--
-- Índice (fonte, iniciado_em DESC): cobre a consulta "última execução de cada
-- fonte" (DISTINCT ON (fonte) ... ORDER BY fonte, iniciado_em DESC, ou
-- ORDER BY iniciado_em DESC LIMIT 1 WHERE fonte = ?) sem sort completo da
-- tabela.
--
-- Idempotente: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS +
-- DROP POLICY IF EXISTS. Roda 2x sem erro.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.sync_log (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fonte            TEXT NOT NULL,
  iniciado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finalizado_em    TIMESTAMPTZ NULL,
  status           TEXT NOT NULL DEFAULT 'em_andamento',
  linhas_lidas     INTEGER NULL,
  linhas_gravadas  INTEGER NULL,
  erro_mensagem    TEXT NULL,
  duracao_ms       INTEGER NULL
);

-- "última execução de cada fonte" sem sort completo
CREATE INDEX IF NOT EXISTS idx_sync_log_fonte_iniciado_em
  ON public.sync_log (fonte, iniciado_em DESC);

COMMENT ON TABLE public.sync_log IS
  'Log de observabilidade das execuções do script local de importação NBS → Supabase (roda fora da Vercel, agendado de 2h em 2h, grava via SUPABASE_SERVICE_ROLE_KEY).';
COMMENT ON COLUMN public.sync_log.fonte IS
  'Valores esperados: ''veiculos'' | ''vendas'' | ''custos''. Sem CHECK rígido de propósito (novas fontes não exigem migration).';
COMMENT ON COLUMN public.sync_log.status IS
  'Valores esperados: ''em_andamento'' (default, enquanto roda) | ''sucesso'' | ''erro''. Sem CHECK rígido de propósito.';
COMMENT ON COLUMN public.sync_log.finalizado_em IS
  'NULL enquanto a execução está em andamento.';

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — só LEITURA para usuários autenticados do app; escrita é do script
-- local via service_role (bypassa RLS por natureza, não precisa de policy)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.sync_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_read_sync_log" ON public.sync_log;
CREATE POLICY "authenticated_read_sync_log" ON public.sync_log
  FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO (rode manualmente após aplicar)
-- ═══════════════════════════════════════════════════════════════════════════
-- SELECT id, fonte, iniciado_em, finalizado_em, status, linhas_lidas,
--        linhas_gravadas, erro_mensagem, duracao_ms
-- FROM public.sync_log;
--
-- Esperado: 0 linhas (tabela recém-criada), sem erro de coluna/tipo.

-- ═══════════════════════════════════════════════════════════════════════════
-- FIM
-- ═══════════════════════════════════════════════════════════════════════════
