-- Navesa Mesa — Migration 027: `data_subido` garantida + backfill dos legados
-- =====================================================================================
-- PROBLEMA (auditoria de 06/08/2026):
--   18 dos 64 repasses com status='subido' estão com `data_subido` NULL. Eles são
--   registros LEGADOS: entraram no fluxo antes da coluna existir (migration 010) ou
--   por caminhos que não a preenchiam. Resultado: 28% da carteira fica de fora de
--   qualquer métrica que dependa de "desde quando esse carro está no ar".
--
--   Os caminhos de escrita ATUAIS já preenchem o campo:
--     - marcarComoSubido / marcarVariosComoSubido (src/lib/repasses/queries.ts)
--     - INSERT da RPC importar_repasse_auto_avaliar (migration 025)
--   O buraco é só histórico.
--
-- SOLUÇÃO (3 partes):
--   1. Coluna `data_subido_aproximada` — marca que a data foi INFERIDA, não observada.
--      Dado estimado precisa se declarar estimado; a UI mostra "~34d" nessas linhas.
--   2. Backfill a partir de `data_subiu` (campo legado, NOT NULL, preenchido nos 18).
--      Conferência feita antes do backfill: dos 62 registros que têm as DUAS datas,
--      59 concordam e 3 divergem, com diferença máxima de 9 dias. Erro aceitável
--      para uma métrica de "dias parados" que se lê em dezenas de dias.
--   3. Trigger BEFORE INSERT OR UPDATE — fecha o buraco pra sempre, independente do
--      caminho de escrita (app, RPC, SQL manual, importador futuro).
--
-- Idempotente: ADD COLUMN IF NOT EXISTS / UPDATE com guarda `IS NULL` (2ª execução
-- afeta 0 linhas) / CREATE OR REPLACE FUNCTION / DROP TRIGGER IF EXISTS + CREATE.
-- =====================================================================================


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 1. COLUNA data_subido_aproximada
-- =====================================================================================
-- NOT NULL DEFAULT false: todo registro escrito pelos caminhos normais nasce com a
-- data OBSERVADA (false). Só o backfill abaixo marca true.
-- ─────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE repasses
  ADD COLUMN IF NOT EXISTS data_subido_aproximada boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN repasses.data_subido_aproximada IS
  'true = data_subido foi INFERIDA de data_subiu no backfill da migration 027 (registro '
  'legado), não observada no momento em que o carro subiu. Variação esperada de alguns '
  'dias. A UI marca essas linhas com "~" nos dias em repasse. false = data observada.';


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 2. BACKFILL dos legados
-- =====================================================================================
-- `least(data_subiu, current_date)` protege contra data futura: data_subiu tem default
-- current_date mas é editável, e uma data no futuro produziria "dias em repasse"
-- NEGATIVO (ou zerado pelo clamp da UI, escondendo o problema).
--
-- Guarda dupla no WHERE:
--   - status='subido'    → só quem está de fato no ar. 'marcado' NÃO tem data_subido
--                          por definição (ainda não subiu) e não pode ganhar uma.
--   - data_subido IS NULL→ nunca sobrescreve data observada. Torna o UPDATE idempotente.
-- ─────────────────────────────────────────────────────────────────────────────────────
UPDATE repasses
   SET data_subido            = least(data_subiu, current_date),
       data_subido_aproximada = true
 WHERE status = 'subido'
   AND data_subido IS NULL;


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 3. TRIGGER — data_subido nunca mais fica NULL num carro subido
-- =====================================================================================
-- BEFORE INSERT OR UPDATE, com a condição no WHEN do trigger (não só no corpo):
-- declarativa, verificável no catálogo (pg_trigger.tgqual) e o Postgres nem chama a
-- função quando não bate. Para status != 'subido' o trigger NÃO dispara — um carro
-- 'marcado'/'cancelado'/'vendido' sem data_subido continua sem data_subido.
--
-- NÃO marca data_subido_aproximada: o trigger observa a transição no momento em que
-- ela acontece, então current_date é a data REAL, não uma estimativa.
--
-- Interação com a RPC importar_repasse_auto_avaliar (025): o INSERT de lá já passa
-- data_subido = current_date, então o WHEN dá false e o trigger não interfere; o
-- UPDATE de lá não toca em data_subido nem na flag — reimportar NÃO zera a flag
-- dos registros backfillados (AC 4).
-- ─────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION repasses_preenche_data_subido()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- A condição vive no WHEN do trigger; aqui só a atribuição.
  NEW.data_subido := current_date;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION repasses_preenche_data_subido() IS
  'Trigger BEFORE INSERT OR UPDATE de repasses: preenche data_subido com current_date '
  'quando o registro entra/está em status=subido sem data. Migration 027.';

DROP TRIGGER IF EXISTS trg_repasses_preenche_data_subido ON repasses;
CREATE TRIGGER trg_repasses_preenche_data_subido
  BEFORE INSERT OR UPDATE ON repasses
  FOR EACH ROW
  WHEN (NEW.status = 'subido' AND NEW.data_subido IS NULL)
  EXECUTE FUNCTION repasses_preenche_data_subido();


-- =====================================================================================
-- VERIFICAÇÃO PÓS-MIGRATION (rodar manualmente depois de aplicar)
-- =====================================================================================
-- 1) Nenhum carro subido sem data — precisa dar 0:
--      SELECT count(*) FROM repasses WHERE status = 'subido' AND data_subido IS NULL;
--
-- 2) Quantos ficaram marcados como aproximados (esperado: 18):
--      SELECT count(*) FROM repasses WHERE data_subido_aproximada;
--
-- 3) Nenhuma data no futuro (o least deve ter protegido):
--      SELECT count(*) FROM repasses WHERE data_subido > current_date;
--
-- 4) O trigger existe e está com a condição certa:
--      SELECT tgname, pg_get_triggerdef(oid)
--        FROM pg_trigger WHERE tgname = 'trg_repasses_preenche_data_subido';
--
-- 5) Smoke do trigger (rodar numa transação e dar ROLLBACK):
--      BEGIN;
--        UPDATE repasses SET status = 'subido', data_subido = NULL
--         WHERE id = (SELECT id FROM repasses WHERE status = 'marcado' LIMIT 1);
--        SELECT id, status, data_subido, data_subido_aproximada
--          FROM repasses WHERE status = 'subido' AND data_subido IS NULL;  -- 0 linhas
--      ROLLBACK;
-- =====================================================================================
-- FIM da migration 027
-- =====================================================================================
