-- ═══════════════════════════════════════════════════════════════════════════
-- 038 — view veiculos_origem (loja de ORIGEM de cada chassi)
-- ═══════════════════════════════════════════════════════════════════════════
-- Story "VENDAS USADOS MATRIZ" precisa saber em qual loja um carro vendido
-- ENTROU (cod_empresa do snapshot mais ANTIGO em que o chassi apareceu) — não
-- necessariamente a loja que vendeu. `veiculos_atual` dá o snapshot mais
-- RECENTE (pra estoque corrente); esta view dá o mais ANTIGO (pra origem
-- histórica), via DISTINCT ON (chassi) ... ORDER BY chassi, snapshot_id.
--
-- Só devolve cod_empresa (não nome de loja) — nome vem de
-- `SELECT DISTINCT cod_empresa, empresa_nome FROM vendas` no app (já é uma
-- relação estável, sem precisar hardcode nem tabela nova).
--
-- Índice: DISTINCT ON (chassi) ... ORDER BY chassi, snapshot_id faz sort por
-- (chassi, snapshot_id) pra cada grupo — sem índice composto nessa ordem, o
-- planner teria que ordenar a tabela `veiculos` inteira a cada consulta.
-- `idx_veiculos_chassi` (só chassi) já existe desde a 001; este é o primeiro
-- índice composto (chassi, snapshot_id) do projeto.
--
-- CREATE OR REPLACE VIEW + security_invoker=true (mesmo padrão de
-- veiculos_atual, migration 012 — sem isso a view roda como SECURITY DEFINER
-- e fura o RLS da tabela `veiculos`) + CREATE INDEX IF NOT EXISTS: idempotente,
-- roda em qualquer ambiente (CI Preview, banco novo, re-run) sem erro.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_veiculos_chassi_snapshot ON public.veiculos USING btree (chassi, snapshot_id);

CREATE OR REPLACE VIEW public.veiculos_origem
WITH (security_invoker = true) AS
SELECT DISTINCT ON (chassi)
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
FROM public.veiculos
ORDER BY chassi, snapshot_id;

COMMENT ON VIEW public.veiculos_origem IS
  'Loja de origem de cada chassi = snapshot MAIS ANTIGO em que apareceu (ORDER BY chassi, snapshot_id, pega o primeiro). Diferente de veiculos_atual (snapshot mais recente). Usado pra distinguir "estoque próprio" de "repasse de outra loja" no relatório VENDAS USADOS MATRIZ.';
