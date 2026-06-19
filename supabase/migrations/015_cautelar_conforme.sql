-- Navesa Mesa — Cautelar: troca terminologia pro laudo cautelar.
--
-- Antes: limpa | com_restricao | nao_verificada
-- Agora: conforme | nao_conforme | nao_verificado
--
-- Mapeamento dos dados existentes:
--   limpa          -> conforme
--   com_restricao  -> nao_conforme
--   nao_verificada -> nao_verificado
--
-- IMPORTANTE (ordem): o CHECK antigo bloqueia os valores novos e o CHECK novo
-- rejeitaria os valores antigos. Por isso DROP do CHECK -> UPDATE -> ADD do CHECK
-- novo, tudo numa transação. Sem constraint no meio, nada bloqueia a migração.
--
-- Idempotente: DROP CONSTRAINT IF EXISTS + UPDATE filtrado nos valores antigos
-- (no-op se já migrado) + ADD do CHECK. Rodar de novo não tem efeito colateral.

BEGIN;

-- Remove o CHECK atual pra liberar a gravação dos valores novos.
ALTER TABLE repasses DROP CONSTRAINT IF EXISTS repasses_cautelar_status_manual_check;

-- Migra os dados existentes pros novos valores.
UPDATE repasses SET cautelar_status_manual = CASE cautelar_status_manual
  WHEN 'limpa' THEN 'conforme'
  WHEN 'com_restricao' THEN 'nao_conforme'
  WHEN 'nao_verificada' THEN 'nao_verificado'
  ELSE cautelar_status_manual
END
WHERE cautelar_status_manual IN ('limpa','com_restricao','nao_verificada');

-- Recria o CHECK com os valores novos.
ALTER TABLE repasses ADD CONSTRAINT repasses_cautelar_status_manual_check
  CHECK (cautelar_status_manual IS NULL OR cautelar_status_manual IN ('conforme','nao_conforme','nao_verificado'));

COMMENT ON COLUMN repasses.cautelar_status_manual IS 'Laudo cautelar: conforme | nao_conforme | nao_verificado';

COMMIT;
