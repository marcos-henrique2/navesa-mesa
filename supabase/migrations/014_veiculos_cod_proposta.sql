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
CREATE OR REPLACE VIEW veiculos_atual
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
