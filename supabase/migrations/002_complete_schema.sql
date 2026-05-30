-- Navesa Mesa — Schema completo (Sprint 1)
-- Cobre tudo que o sistema constrói hoje em localStorage.
-- Idempotente: pode rodar várias vezes sem quebrar.
-- Cole no SQL Editor do Supabase (substitui/extende a 001_initial.sql).

-- ─── EXTENSÕES ──────────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";

-- ═══════════════════════════════════════════════════════════════════════════
-- ESTOQUE
-- ═══════════════════════════════════════════════════════════════════════════

-- Renomeia a tabela "snapshots" antiga (de 001) pra ficar explícita,
-- e cria a nova com os campos completos.
do $$ begin
  if exists (select 1 from pg_class where relname='snapshots' and relkind='r')
     and not exists (select 1 from pg_class where relname='estoque_snapshots') then
    alter table snapshots rename to estoque_snapshots;
  end if;
end $$;

create table if not exists estoque_snapshots (
  id              bigserial primary key,
  arquivo_nome    text not null,
  data_geracao    timestamptz,
  data_upload     timestamptz default now(),
  total_veiculos  integer,
  total_lojas     integer
);

create table if not exists veiculos (
  id                     bigserial primary key,
  snapshot_id            bigint references estoque_snapshots(id) on delete cascade,
  cod_empresa            integer not null,
  chassi                 text not null,
  placa                  text not null,
  marca                  text,
  modelo                 text not null,
  ano_fabricacao         smallint,
  ano_modelo             smallint,
  cor_externa            text,
  combustivel            text,
  km                     integer,
  patio                  text,
  descricao_situacao     text,
  preco_venda            numeric(12,2),
  valor_aquisicao        numeric(12,2),   -- = Total Nota Fábrica (custo de fábrica)
  custo_total            numeric(12,2),
  dias_patio             integer,
  data_entrada           timestamptz,
  vendedor_recebeu       text,
  unique (snapshot_id, chassi)
);

-- Adiciona coluna km se não existir (caso 001 já tenha rodado sem ela)
alter table veiculos add column if not exists km integer;

create index if not exists idx_veiculos_loja      on veiculos(cod_empresa);
create index if not exists idx_veiculos_situacao  on veiculos(descricao_situacao);
create index if not exists idx_veiculos_chassi    on veiculos(chassi);
create index if not exists idx_veiculos_placa     on veiculos(placa);
create index if not exists idx_veiculos_snapshot  on veiculos(snapshot_id);

-- View: estoque atual = último snapshot
create or replace view veiculos_atual as
  select v.* from veiculos v
  where v.snapshot_id = (select max(id) from estoque_snapshots);

-- ═══════════════════════════════════════════════════════════════════════════
-- VENDAS (acumuladas, identificadas por chassi único)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists vendas (
  id                    bigserial primary key,
  chassi                text unique not null,
  placa                 text,
  modelo                text,
  marca                 text,
  ano_fabricacao        smallint,
  ano_modelo            smallint,
  cor_externa           text,
  renavam               text,
  km                    integer,
  cod_empresa           integer,
  empresa_nome          text,
  patio                 text,
  vendedor_codigo       text,
  vendedor_nome         text,
  vendedor_cpf          text,
  vendedor_recebeu      text,
  cliente_codigo        text,
  cliente_nome          text,
  cliente_tipo          text check (cliente_tipo in ('PF','PJ') or cliente_tipo is null),
  cliente_cidade        text,
  cliente_uf            text,
  data_venda            timestamptz,
  data_faturamento      timestamptz,
  data_entrada          timestamptz,
  valor_venda           numeric(12,2),
  preco_venda_tabela    numeric(12,2),
  total_nota_fabrica    numeric(12,2),
  custo_floor_plan      numeric(12,2),
  custo_total_final     numeric(12,2),
  despesas_gerais       numeric(12,2),
  margem_pct            numeric(6,3),
  comissao_vendedor     numeric(12,2),
  dias_estoque          integer,
  placa_troca           text,
  atualizado_em         timestamptz default now()
);

create index if not exists idx_vendas_data       on vendas(data_venda);
create index if not exists idx_vendas_loja       on vendas(cod_empresa);
create index if not exists idx_vendas_vendedor   on vendas(vendedor_codigo);
create index if not exists idx_vendas_marca      on vendas(marca);
create index if not exists idx_vendas_placa      on vendas(placa);

-- ═══════════════════════════════════════════════════════════════════════════
-- CUSTOS DETALHADOS (acumulados, identificados por placa)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists custos_detalhados (
  id                       bigserial primary key,
  placa                    text unique not null,
  modelo                   text,
  data_fatura              timestamptz,
  data_venda               timestamptz,
  dias_patio               integer,
  nota_fabrica_taxa_icms   numeric(12,2),
  despesas_oficina         numeric(12,2),
  frete_icms_frete         numeric(12,2),
  forplan                  numeric(12,2),
  impostos                 numeric(12,2),
  comissoes                numeric(12,2),
  ganhos_indiretos         numeric(12,2),  -- bônus fábrica + valorização (REDUZ custo)
  adm                      numeric(12,2),
  despesas_gerais          numeric(12,2),
  custo_total              numeric(12,2),
  valor_vendido            numeric(12,2),
  margem_real              numeric(12,2),
  margem_pct               numeric(6,3),
  atualizado_em            timestamptz default now()
);

create index if not exists idx_custos_data on custos_detalhados(data_venda);

-- ═══════════════════════════════════════════════════════════════════════════
-- CAUTELAR (laudo manual por chassi)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists cautelar (
  chassi         text primary key,
  status         text not null check (status in ('aprovado','com_restricao','reprovado')),
  observacao     text,
  atualizado_em  timestamptz default now()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- FIPE
-- ═══════════════════════════════════════════════════════════════════════════

-- Cache geral (já existe de 001 — mantém)
create table if not exists fipe_cache (
  id              bigserial primary key,
  marca           text not null,
  modelo          text not null,
  ano_modelo      smallint not null,
  combustivel     text,
  valor_fipe      numeric(12,2) not null,
  mes_referencia  text,
  consultado_em   timestamptz default now(),
  unique (marca, modelo, ano_modelo, combustivel, mes_referencia)
);

-- Resultado do batch: preço FIPE atual por carro do estoque
create table if not exists fipe_batch (
  chassi             text primary key,
  preco_fipe         numeric(12,2) not null,
  fipe_marca_cod     text,
  fipe_marca_nome    text,
  fipe_modelo_cod    integer,
  fipe_modelo_nome   text,
  fipe_ano_cod       text,
  fipe_ano_nome      text,
  atualizado_em      timestamptz default now()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- SNAPSHOTS DE KPI (fotos da operação ao longo do tempo — página /historico)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists kpi_snapshots (
  id                            text primary key,        -- YYYY-MM-DD
  capturado_em                  timestamptz default now(),

  -- Vendas
  vendas_qt                     integer,
  vendas_faturamento            numeric(14,2),
  vendas_custo                  numeric(14,2),
  vendas_margem                 numeric(14,2),
  vendas_margem_pct             numeric(6,3),
  vendas_ganhos_indiretos       numeric(14,2),
  vendas_margem_sem_bonus       numeric(14,2),
  vendas_periodo_inicio         timestamptz,
  vendas_periodo_fim            timestamptz,

  -- Estoque (custo de fábrica = capital travado)
  estoque_total_carros          integer,
  estoque_custo_total           numeric(14,2),
  estoque_disponivel_qt         integer,
  estoque_disponivel_custo      numeric(14,2),
  estoque_preparacao_qt         integer,
  estoque_preparacao_custo      numeric(14,2),
  estoque_parados180_qt         integer,
  estoque_parados180_custo      numeric(14,2)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- CHAT IA (histórico de conversas)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists chat_messages (
  id           bigserial primary key,
  papel        text not null check (papel in ('user','assistant')),
  conteudo     text not null,
  criada_em    timestamptz default now()
);

create index if not exists idx_chat_data on chat_messages(criada_em);

-- ═══════════════════════════════════════════════════════════════════════════
-- CADASTROS AUXILIARES
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists lojas (
  cod_empresa  integer primary key,
  nome         text not null,
  cidade       text,
  ativo        boolean default true,
  criado_em    timestamptz default now()
);

create table if not exists vendedores (
  codigo  text primary key,
  nome    text,
  cpf     text
);

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS — Row Level Security
-- ═══════════════════════════════════════════════════════════════════════════
-- MVP single-user: permite leitura/escrita anônima.
-- Quando ativar login (Sprint 2), trocar policies pra exigir auth.uid().

do $$
declare t text;
begin
  for t in
    select unnest(array[
      'estoque_snapshots','veiculos','vendas','custos_detalhados',
      'cautelar','fipe_cache','fipe_batch','kpi_snapshots',
      'chat_messages','lojas','vendedores'
    ])
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "mvp_all_access" on %I', t);
    execute format(
      'create policy "mvp_all_access" on %I for all using (true) with check (true)',
      t
    );
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- FIM
-- ═══════════════════════════════════════════════════════════════════════════
-- Tabelas criadas:
--   estoque_snapshots, veiculos (+ view veiculos_atual)
--   vendas, custos_detalhados, cautelar
--   fipe_cache, fipe_batch, kpi_snapshots
--   chat_messages, lojas, vendedores
-- RLS: aberto pra anon (single-user MVP)
