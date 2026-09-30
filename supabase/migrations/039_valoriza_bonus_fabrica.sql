-- Navesa Mesa — Migration 039: bônus/"Valoriza" da fábrica em veiculos e vendas
-- =====================================================================================
-- "Valoriza" (também chamado "Bonus" em relatórios do NBS) é o bônus que a
-- fábrica/montadora dá quando um carro usado entra no estoque (reduz o custo
-- de aquisição efetivo). Até aqui o relatório "Vendas Usados Matriz" usava uma
-- APROXIMAÇÃO ruim desse valor (campo "Ganhos Indiretos" do NBS — 27% de erro
-- validado pelo Marcos). O valor CERTO vem de
-- NBS.VEICULOS_CUSTOS_ESPECIFICOS (Oracle), somado por chassi+loja pros
-- CODIGO_CUSTO 620 ("Ford Valoriza") e 462 ("Bonus CVP") — ver
-- scripts/sync-nbs/valoriza.ts pro cálculo completo.
--
-- valoriza: NUMERIC, NOT NULL, DEFAULT 0.
--   Diferente de outros campos do sync (onde NULL = "não sabemos"), aqui
--   ausência de bônus é um FATO CONHECIDO: o veículo/venda não tem nenhum
--   custo lançado nos códigos 620/462, logo o bônus é zero — nunca NULL.
--   Só o sync Oracle calcula o valor real; uploads manuais de XLSX (que não
--   têm acesso a NBS.VEICULOS_CUSTOS_ESPECIFICOS) gravam 0.
--
-- Idempotente (ADD COLUMN IF NOT EXISTS). Rodar 2x sem erro.
-- =====================================================================================

ALTER TABLE public.veiculos ADD COLUMN IF NOT EXISTS valoriza NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE public.vendas ADD COLUMN IF NOT EXISTS valoriza NUMERIC NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.veiculos.valoriza IS
  'Bonus/"Valoriza" da fabrica (NBS.VEICULOS_CUSTOS_ESPECIFICOS, CODIGO_CUSTO 620 "Ford Valoriza" ou 462 "Bonus CVP", somado por chassi_resumido+loja atual). NUNCA null: ausencia de bonus = fato conhecido (zero). Substitui a aproximacao antiga via "Ganhos Indiretos" (27% de erro).';

COMMENT ON COLUMN public.vendas.valoriza IS
  'Bonus/"Valoriza" da fabrica (NBS.VEICULOS_CUSTOS_ESPECIFICOS, CODIGO_CUSTO 620 "Ford Valoriza" ou 462 "Bonus CVP", somado por chassi_resumido+loja atual). NUNCA null: ausencia de bonus = fato conhecido (zero). Substitui a aproximacao antiga via "Ganhos Indiretos" (27% de erro) usada no relatorio Vendas Usados Matriz.';

-- A view veiculos_atual lista colunas explicitamente (ver 014_veiculos_cod_proposta.sql)
-- — precisa incluir a nova coluna pra ela chegar ao app. Recria preservando
-- security_invoker=true, mesmo padrão DROP + CREATE (não CREATE OR REPLACE)
-- da 014, pelo mesmo motivo: CREATE OR REPLACE VIEW só permite adicionar
-- colunas ao fim, não reordenar/renomear as existentes.
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
  cod_proposta,
  valoriza
FROM veiculos v
WHERE snapshot_id = (SELECT max(estoque_snapshots.id) FROM estoque_snapshots);
