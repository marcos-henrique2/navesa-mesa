-- Navesa Mesa — Sprint Caminho B: campos manuais inline no /repasses
--
-- Marcos preenche os 5 campos manuais DIRETO na tela /repasses (não mais
-- só no Excel). XLSX exportado vem PRÉ-PREENCHIDO. Dados vivem no sistema,
-- não se perdem entre exportações.
--
-- Mudanças:
--   1. ADD ipva_status            (pago | em_aberto | nao_verificado | NULL)
--   2. ADD cautelar_status_manual (limpa | com_restricao | nao_verificada | NULL)
--   3. ADD valor_subir NUMERIC(12,2)
--   4. REUSE documentacao_status legacy: relaxa CHECK pra aceitar NULL +
--      novo valor 'nao_verificado' (antes era NOT NULL default 'pendente').
--   5. REUSE observacoes legacy (TEXT NULL já existente — sem ALTER).
--
-- 100% idempotente (IF EXISTS / IF NOT EXISTS / DROP CONSTRAINT IF EXISTS) —
-- pode rodar várias vezes sem efeito colateral.

ALTER TABLE repasses ADD COLUMN IF NOT EXISTS ipva_status TEXT;
ALTER TABLE repasses ADD COLUMN IF NOT EXISTS cautelar_status_manual TEXT;
ALTER TABLE repasses ADD COLUMN IF NOT EXISTS valor_subir NUMERIC(12, 2);

-- documentacao_status legacy: relaxar pra permitir NULL e novo valor 'nao_verificado'.
ALTER TABLE repasses DROP CONSTRAINT IF EXISTS repasses_documentacao_status_check;
ALTER TABLE repasses ALTER COLUMN documentacao_status DROP NOT NULL;
ALTER TABLE repasses ALTER COLUMN documentacao_status DROP DEFAULT;
ALTER TABLE repasses ADD CONSTRAINT repasses_documentacao_status_check
  CHECK (documentacao_status IS NULL OR documentacao_status IN ('ok','pendente','irregular','nao_verificado'));

-- IPVA: pago | em_aberto | nao_verificado
ALTER TABLE repasses DROP CONSTRAINT IF EXISTS repasses_ipva_status_check;
ALTER TABLE repasses ADD CONSTRAINT repasses_ipva_status_check
  CHECK (ipva_status IS NULL OR ipva_status IN ('pago','em_aberto','nao_verificado'));

-- Cautelar manual (separada da cautelar do Detran que fica em outra fonte).
ALTER TABLE repasses DROP CONSTRAINT IF EXISTS repasses_cautelar_status_manual_check;
ALTER TABLE repasses ADD CONSTRAINT repasses_cautelar_status_manual_check
  CHECK (cautelar_status_manual IS NULL OR cautelar_status_manual IN ('limpa','com_restricao','nao_verificada'));

COMMENT ON COLUMN repasses.ipva_status IS 'pago | em_aberto | nao_verificado (null = nao preenchido)';
COMMENT ON COLUMN repasses.cautelar_status_manual IS 'limpa | com_restricao | nao_verificada (manual; cautelar do Detran fica em outra fonte)';
COMMENT ON COLUMN repasses.valor_subir IS 'Valor R$ que Marcos vai subir no Auto Avaliar (decisao manual, nao calculo)';
COMMENT ON COLUMN repasses.documentacao_status IS 'ok | pendente | irregular | nao_verificado (null = nao preenchido)';
