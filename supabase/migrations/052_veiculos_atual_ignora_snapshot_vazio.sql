-- Navesa Mesa — 052: veiculos_atual ignora snapshot de estoque VAZIO
--
-- Incidente (2026-11-06): o sync NBS criou a linha em estoque_snapshots e falhou
-- ao gravar os veículos. Como veiculos_atual filtrava por
--   snapshot_id = (select max(id) from estoque_snapshots)
-- o snapshot vazio virou o "atual" e a produção mostrou estoque zerado.
--
-- O PR #62 torna o snapshot atômico no script do sync, mas só vale quando a
-- máquina do sync for atualizada. Esta migration é a proteção imediata no banco:
-- o "atual" passa a ser o snapshot MAIS RECENTE QUE TENHA PELO MENOS 1 VEÍCULO.
--
-- LIMITE (não coberto aqui): snapshot PARCIAL (gravou parte dos veículos e caiu)
-- continua sendo publicado, porque tem veículos. Isso fica com o PR #62
-- (atomicidade no sync) e com uma futura coluna `estoque_snapshots.publicado`
-- (o sync marca true só ao final; a view filtra por ela).
--
-- Forma da subquery: `order by s.id desc limit 1` em vez de
-- `max(s.id) ... where exists (...)`. Com o EXISTS o Postgres não aplica a
-- otimização de min/max por índice e faz semi-join em TODOS os snapshots
-- (medido no remoto: ~177 ms, 391 probes no índice). Com ORDER BY DESC LIMIT 1 ele
-- desce o pkey de estoque_snapshots de trás pra frente e para no primeiro que tem
-- veículo (probe em idx_veiculos_snapshot): ~0,15 ms. Semântica idêntica: sem
-- nenhum snapshot com veículos, a subquery escalar dá NULL e a view fica vazia.
--
-- Idempotente: CREATE OR REPLACE VIEW com as MESMAS 30 colunas na MESMA ordem da
-- 040 (CREATE OR REPLACE não permite reordenar/renomear) — preserva grants e não
-- precisa de DROP (sem janela em que a view não existe). Nenhuma view/regra
-- depende de veiculos_atual (conferido em pg_depend no remoto).
-- security_invoker = true continua explícito (ver 012): RLS de veiculos e
-- estoque_snapshots é avaliada como o usuário que consulta, inclusive no EXISTS.

-- Índice que sustenta o EXISTS (já existe desde a 001; garante caso falte).
create index if not exists idx_veiculos_snapshot on public.veiculos (snapshot_id);

create or replace view public.veiculos_atual
with (security_invoker = true) as
select
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
  valoriza,
  custo_revisoes,
  custo_forplan,
  custo_holdback,
  custo_acessorios,
  custo_adm,
  custo_impostos,
  custo_comissoes,
  custo_despesas_gerais
from public.veiculos v
where v.snapshot_id = (
  select s.id
  from public.estoque_snapshots s
  where exists (select 1 from public.veiculos x where x.snapshot_id = s.id)
  order by s.id desc
  limit 1
);

comment on view public.veiculos_atual is
  'Estoque atual = veículos do snapshot MAIS RECENTE QUE TENHA VEÍCULOS (052). Snapshot vazio (sync que falhou após criar o snapshot) é ignorado. Snapshot parcial NÃO é detectado aqui (PR #62 + futura coluna estoque_snapshots.publicado).';

-- Grants: CREATE OR REPLACE já preserva os existentes; reaplica SELECT por
-- garantia (GRANT é idempotente). Não amplia privilégios além do que já há.
grant select on public.veiculos_atual to anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'cerebro_leitor') then
    grant select on public.veiculos_atual to cerebro_leitor;  -- ver 051
  end if;
end $$;

-- Verificação (manual, após aplicar):
-- select pg_get_viewdef('public.veiculos_atual'::regclass, true);
-- select reloptions from pg_class where oid = 'public.veiculos_atual'::regclass;  -- {security_invoker=true}
-- select grantee, privilege_type from information_schema.role_table_grants
--  where table_schema = 'public' and table_name = 'veiculos_atual' order by 1, 2;
-- select snapshot_id, count(*) from public.veiculos_atual group by 1;           -- 1 linha, > 0
