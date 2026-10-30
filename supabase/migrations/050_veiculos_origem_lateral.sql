-- ═══════════════════════════════════════════════════════════════════════════
-- 050 — veiculos_origem sem varrer todos os snapshots
-- ═══════════════════════════════════════════════════════════════════════════
-- A 038 usava DISTINCT ON (chassi) ... ORDER BY chassi, snapshot_id, que lê
-- TODAS as linhas de `veiculos` de cada chassi (um snapshot a cada 2h). Com
-- ~340 mil linhas (30/10/2026), o `.in("chassi", lote de 500)` do painel Vendas
-- Usados Matriz fazia o planner varrer a tabela inteira (~11 s) e estourar o
-- statement_timeout do papel authenticated → HTTP 500 "Não consegui carregar
-- as vendas".
--
-- Mesma semântica (snapshot MAIS ANTIGO de cada chassi; (snapshot_id, chassi)
-- é único, então não há empate), mas via LATERAL ... LIMIT 1: lista os chassis
-- distintos pelo idx_veiculos_chassi e busca só a primeira linha de cada um pelo
-- idx_veiculos_chassi_snapshot. Filtro por chassi é empurrado pra dentro do
-- DISTINCT. Varredura completa: 11 s → 0,8 s.
--
-- Mesmas colunas, na mesma ordem (exigência do CREATE OR REPLACE VIEW).
-- security_invoker=true mantido (respeita o RLS de `veiculos`). Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.veiculos_origem
WITH (security_invoker = true) AS
SELECT
  v.id,
  v.snapshot_id,
  v.cod_empresa,
  v.chassi,
  v.placa,
  v.marca,
  v.modelo,
  v.ano_fabricacao,
  v.ano_modelo,
  v.cor_externa,
  v.combustivel,
  v.km,
  v.patio,
  v.descricao_situacao,
  v.preco_venda,
  v.valor_aquisicao,
  v.custo_total,
  v.dias_patio,
  v.data_entrada,
  v.vendedor_recebeu,
  v.cod_proposta
FROM (SELECT DISTINCT chassi FROM public.veiculos) c
CROSS JOIN LATERAL (
  SELECT *
  FROM public.veiculos x
  WHERE x.chassi = c.chassi
  ORDER BY x.snapshot_id
  LIMIT 1
) v;

COMMENT ON VIEW public.veiculos_origem IS
  'Loja de origem de cada chassi = snapshot MAIS ANTIGO em que apareceu (LATERAL ... ORDER BY snapshot_id LIMIT 1; ver 050). Diferente de veiculos_atual (snapshot mais recente). Usado pra distinguir "estoque próprio" de "repasse de outra loja" no relatório VENDAS USADOS MATRIZ.';
