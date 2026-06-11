-- Navesa Mesa — Sprint 1 Repasses: refatoração pra lista + XLSX
--
-- Mudanças:
--   1. Adiciona coluna `data_subido` (transição "Já subi" no /repasses).
--      A coluna legacy `data_subiu` vira "data marcado pra subir" no domínio
--      novo (mantida NOT NULL com default current_date — não vale a pena
--      renomear porque há rows antigos).
--   2. Atualiza CHECK do status pra aceitar 'marcado' (novo) preservando
--      'vendido' e 'nao_vendido' (rows legacy do schema original).
--   3. Troca o índice único parcial: antes cobria só `status='subido'`,
--      agora cobre `status IN ('marcado','subido')` — defesa contra
--      duplicata em ambos os estados ativos do fluxo.
--
-- 100% idempotente (IF EXISTS / IF NOT EXISTS) — pode rodar várias vezes
-- sem efeito colateral. A migration já está aplicada no remoto (versão
-- 20260611141119), esse arquivo serve pra histórico/staging/CI/dev novos.

ALTER TABLE repasses ADD COLUMN IF NOT EXISTS data_subido DATE;

-- CHECK constraint do status: precisa aceitar 'marcado' (novo) e manter os
-- legacy ('vendido', 'nao_vendido') pra não quebrar rows antigos.
ALTER TABLE repasses DROP CONSTRAINT IF EXISTS repasses_status_check;
ALTER TABLE repasses ADD CONSTRAINT repasses_status_check
  CHECK (status IN ('marcado', 'subido', 'vendido', 'nao_vendido', 'cancelado'));

-- Índice único: antes só 'subido'; agora cobre 'marcado' OR 'subido'
-- (carro ativo no fluxo de repasse).
DROP INDEX IF EXISTS repasses_chassi_subido_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS repasses_chassi_ativo_uniq
  ON repasses(chassi) WHERE status IN ('marcado', 'subido');

COMMENT ON COLUMN repasses.status IS 'marcado | subido | cancelado (legacy: vendido, nao_vendido)';
COMMENT ON COLUMN repasses.data_subido IS 'Data em que foi efetivamente subido pro Auto Avaliar';
