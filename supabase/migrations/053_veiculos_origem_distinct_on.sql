-- Navesa Mesa — 053: veiculos_origem com DISTINCT ON (filtro por chassi empurrado pro índice)
--
-- Incidente (2026-11-11): "Vendas Usados Matriz" falha com
--   listLojaOrigemPorChassis: canceling statement due to statement timeout
-- O app consulta via PostgREST (role authenticated, statement_timeout=8s):
--   veiculos_origem?select=chassi,cod_empresa&chassi=in.(...)   -- lotes de 500
--
-- Causa: a forma LATERAL da 050
--   FROM (SELECT DISTINCT chassi FROM veiculos) c CROSS JOIN LATERAL (... LIMIT 1) v
-- NÃO empurra o `chassi = ANY(...)` pra dentro do DISTINCT: o planner lista TODOS os
-- chassis (Index Only Scan em idx_veiculos_chassi, 493 mil linhas, ~223 mil heap
-- fetches) e só filtra depois do LATERAL. Com a RLS de veiculos avaliada por linha
-- (auth.uid() IS NOT NULL) isso deu 9,2 s no remoto, como authenticated, para 500
-- chassis reais de vendas de 2026 → estoura os 8 s. A tabela cresce ~1.100 linhas/2h.
--
-- Correção: DISTINCT ON (chassi) ... ORDER BY chassi, snapshot_id. Como o filtro do
-- app é só na coluna do DISTINCT ON, o Postgres empurra o predicado pra dentro da
-- view (vira Index Cond em idx_veiculos_chassi_snapshot) e lê apenas as linhas dos
-- chassis pedidos. Medido no remoto (mesmos 500 chassis, authenticated + RLS):
--   050 (LATERAL)      : 9.188 ms, 237.914 buffers
--   053 (DISTINCT ON)  :   209 ms,  15.553 buffers   (como postgres, sem RLS: ~20 ms)
-- (A 038 já usava DISTINCT ON; a 050 trocou por LATERAL para acelerar a varredura
-- COMPLETA da view, mas o uso real do app é sempre filtrado por chassi.)
--
-- Semântica idêntica à 050: snapshot MAIS ANTIGO de cada chassi. Sem desempate extra:
-- veiculos tem UNIQUE (snapshot_id, chassi) e chassi é NOT NULL, então não há empate
-- nem chassi nulo (o LATERAL descartaria NULL; aqui não existe). Conferido no remoto:
-- view inteira 050 vs 053 → 3.526 linhas cada, EXCEPT nos dois sentidos (por id) = 0.
--
-- Mesmas 21 colunas, mesma ordem e tipos (exigência do CREATE OR REPLACE VIEW; preserva
-- grants, sem DROP, sem janela sem view). Nenhuma view/regra depende de veiculos_origem
-- (pg_depend no remoto). security_invoker = true mantido: RLS de veiculos continua
-- avaliada como quem consulta. Idempotente (rodar 2x não falha nem muda nada).
--
-- Rollback: reaplicar o CREATE OR REPLACE VIEW da 050.

-- Índice que sustenta o DISTINCT ON filtrado (existe no remoto desde a 038/050; garante).
create index if not exists idx_veiculos_chassi_snapshot on public.veiculos (chassi, snapshot_id);

create or replace view public.veiculos_origem
with (security_invoker = true) as
select distinct on (v.chassi)
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
from public.veiculos v
order by v.chassi, v.snapshot_id;

comment on view public.veiculos_origem is
  'Loja de origem de cada chassi = snapshot MAIS ANTIGO em que apareceu (DISTINCT ON (chassi) ORDER BY chassi, snapshot_id; ver 053). Filtro por chassi vira Index Cond em idx_veiculos_chassi_snapshot. Diferente de veiculos_atual (snapshot mais recente). Usado pra distinguir "estoque próprio" de "repasse de outra loja" no relatório VENDAS USADOS MATRIZ.';

-- Grants: CREATE OR REPLACE preserva os existentes; reaplica SELECT por garantia
-- (GRANT é idempotente). Não amplia privilégios além do que já há.
grant select on public.veiculos_origem to anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'cerebro_leitor') then
    grant select on public.veiculos_origem to cerebro_leitor;  -- ver 051
  end if;
end $$;

-- Verificação (manual, após aplicar):
-- select pg_get_viewdef('public.veiculos_origem'::regclass, true);
-- select reloptions from pg_class where oid = 'public.veiculos_origem'::regclass;  -- {security_invoker=true}
-- explain select chassi, cod_empresa from public.veiculos_origem
--  where chassi = any('{8AFAR23L0EJ208269,3FMCR9DA3SRE45809}'::text[]);
--   -- esperado: Unique -> Index Scan using idx_veiculos_chassi_snapshot, Index Cond: (chassi = ANY (...))
