-- 014_veiculos_cod_proposta.sql
-- Captura o "Cód. Proposta Internet" do NBS (col 310 do XLSX de estoque).
-- Preenchido = carro tem proposta/reserva ativa. O NBS NÃO muda a
-- "Descrição Situação" (continua DISPONIVEL), então essa coluna é o único
-- sinal de reserva. Derivamos "Reservado" na UI por cod_proposta IS NOT NULL.
-- Idempotente.

ALTER TABLE veiculos ADD COLUMN IF NOT EXISTS cod_proposta TEXT;
COMMENT ON COLUMN veiculos.cod_proposta IS 'Cod. Proposta Internet do NBS (col 310). Preenchido = carro tem proposta/reserva ativa.';

-- A view veiculos_atual lista colunas explicitamente — precisa incluir a nova
-- coluna pra ela chegar ao app. Recria preservando security_invoker=true.
--
-- IMPORTANTE — por que DROP + CREATE (e não CREATE OR REPLACE):
-- Num banco novo (CI Preview aplica tudo do zero), a tabela `veiculos` é criada
-- pela 001 com `patio` na posição 12 e SEM `km`; a 002 adiciona `km` no fim via
-- ALTER ADD COLUMN. As views das 001/002 usam `select v.*`, então herdam essa
-- ordem física: `patio` na coluna 12, `km` por último. Esta migration lista as
-- colunas com `km` ANTES de `patio` (coluna 12 = km). CREATE OR REPLACE VIEW só
-- permite ADICIONAR colunas ao fim — não renomear/reordenar as existentes — logo
-- tentava renomear a coluna 12 de "patio" para "km" e quebrava com
-- `cannot change name of view column "patio" to "km"` (SQLSTATE 42P16).
-- DROP + CREATE recria do zero com a ordem correta. Idempotente (IF EXISTS) e
-- seguro pra produção (nenhum objeto depende desta view; recriação é instantânea
-- e o contrato de colunas permanece idêntico ao que a produção já usa).
DROP VIEW IF EXISTS veiculos_atual;
CREATE VIEW veiculos_atual
WITH (security_invoker = true) AS
SELECT
  id,
  snapshot_id,
  cod_empresa,
  chassi,
  placa,
  marca,
  modelo,
  ano_fabricacao,
  ano_modelo,
  cor_externa,
  combustivel,
  km,
  patio,
  descricao_situacao,
  preco_venda,
  valor_aquisicao,
  custo_total,
  dias_patio,
  data_entrada,
  vendedor_recebeu,
  cod_proposta
FROM veiculos v
WHERE snapshot_id = (SELECT max(estoque_snapshots.id) FROM estoque_snapshots);
