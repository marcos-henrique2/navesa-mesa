-- Navesa Mesa — Migration 049: tabela de debug do piloto de markup oficial NBS
-- =====================================================================================
-- Contexto completo: docs/sync-custos-markup-acesso.md. Resumo: a conta COMISSAO
-- acabou de ganhar EXECUTE em NBS.PKG_MARKUP_VEIC e SELECT em
-- NBS.VEICULOS_MARKUP_TMP. scripts/sync-nbs/calcular-markup-estoque.ts chama a
-- procedure real (NBS.PKG_MARKUP_VEIC.CALCULAR_MARKUP_ESTOQUE) pra um número muito
-- pequeno de veículos por rodada (LIMITE_CARROS_PILOTO, hoje 1) e grava o resultado
-- BRUTO aqui, sem nenhum mapeamento pras 8 categorias do relatório — ainda não temos
-- dado real suficiente pra saber esse mapeamento.
--
-- Essa tabela é só pra inspeção manual durante a fase de validação. Não substitui
-- nem altera `veiculos.custo_*` (custos-estoque-detalhado.ts continua rodando igual,
-- em paralelo).
--
-- resultado_bruto: jsonb com o array de linhas devolvidas por
-- `SELECT * FROM NBS.VEICULOS_MARKUP_TMP ORDER BY ORDEM` pra aquele veículo —
-- estrutura ainda desconhecida (1 linha escalar por veículo ou várias linhas por
-- ORDEM/COD_CUSTO), por isso jsonb solto em vez de colunas tipadas.
--
-- Idempotente (CREATE TABLE/INDEX IF NOT EXISTS). Rodar 2x sem erro.
-- =====================================================================================

CREATE TABLE IF NOT EXISTS public.markup_piloto_debug (
  id               BIGSERIAL PRIMARY KEY,
  chassi           TEXT NOT NULL,
  cod_empresa      INTEGER NOT NULL,
  cod_produto      INTEGER NOT NULL,
  cod_modelo       INTEGER NOT NULL,
  resultado_bruto  JSONB NOT NULL,
  capturado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_markup_piloto_debug_chassi_capturado_em
  ON public.markup_piloto_debug (chassi, capturado_em DESC);

COMMENT ON TABLE public.markup_piloto_debug IS
  'Debug do piloto de chamada real a NBS.PKG_MARKUP_VEIC.CALCULAR_MARKUP_ESTOQUE (ver docs/sync-custos-markup-acesso.md e scripts/sync-nbs/calcular-markup-estoque.ts). Só inspeção manual — nenhum mapeamento pras categorias do relatório ainda.';
COMMENT ON COLUMN public.markup_piloto_debug.resultado_bruto IS
  'Array bruto de NBS.VEICULOS_MARKUP_TMP (SELECT * ORDER BY ORDEM) pra este veículo, sem mapeamento. Estrutura (escalar vs. multi-linha) ainda não validada com dado real.';

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — só leitura para usuários autenticados; escrita é do script local via
-- service_role (bypassa RLS por natureza, mesmo padrão de sync_log, migration 041)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.markup_piloto_debug ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_read_markup_piloto_debug" ON public.markup_piloto_debug;
CREATE POLICY "authenticated_read_markup_piloto_debug" ON public.markup_piloto_debug
  FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO (rode manualmente após aplicar)
-- ═══════════════════════════════════════════════════════════════════════════
-- SELECT id, chassi, cod_empresa, cod_produto, cod_modelo, resultado_bruto, capturado_em
-- FROM public.markup_piloto_debug
-- ORDER BY capturado_em DESC;
--
-- Esperado: 0 linhas (tabela recém-criada), sem erro de coluna/tipo.

-- ═══════════════════════════════════════════════════════════════════════════
-- FIM
-- ═══════════════════════════════════════════════════════════════════════════
