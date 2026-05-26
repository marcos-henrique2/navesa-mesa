-- Navesa Mesa — schema inicial (Sprint 0)
-- Cole isso no SQL Editor do Supabase após criar o projeto.

create table if not exists lojas (
  cod_empresa  integer primary key,
  nome         text not null,
  cidade       text,
  ativo        boolean default true,
  criado_em    timestamptz default now()
);

create table if not exists snapshots (
  id              bigserial primary key,
  arquivo_nome    text not null,
  data_geracao    timestamptz,
  data_upload     timestamptz default now(),
  total_veiculos  integer,
  total_lojas     integer
);

create table if not exists veiculos (
  id                     bigserial primary key,
  snapshot_id            bigint references snapshots(id) on delete cascade,
  cod_empresa            integer not null,
  chassi                 text not null,
  placa                  text not null,
  marca                  text,
  modelo                 text not null,
  ano_fabricacao         smallint,
  ano_modelo             smallint,
  cor_externa            text,
  combustivel            text,
  patio                  text,
  patio_eh_preparacao    boolean generated always as (upper(trim(patio)) = 'PREPARAÇÃO') stored,
  descricao_situacao     text,
  preco_venda            numeric(12,2),
  valor_aquisicao        numeric(12,2),
  custo_total            numeric(12,2),
  dias_patio             integer,
  data_entrada           timestamptz,
  vendedor_recebeu       text,
  constraint veiculo_chassi_snapshot unique (snapshot_id, chassi)
);

create index if not exists idx_veiculos_loja           on veiculos(cod_empresa);
create index if not exists idx_veiculos_patio_prep     on veiculos(patio_eh_preparacao);
create index if not exists idx_veiculos_situacao       on veiculos(descricao_situacao);
create index if not exists idx_veiculos_chassi         on veiculos(chassi);
create index if not exists idx_veiculos_snapshot       on veiculos(snapshot_id);

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

create table if not exists sugestoes_preco (
  id                bigserial primary key,
  veiculo_id        bigint references veiculos(id) on delete cascade,
  preco_atual       numeric(12,2),
  preco_fipe        numeric(12,2),
  preco_sugerido    numeric(12,2),
  margem_pct        numeric(5,2),
  justificativa     text,
  gerado_em         timestamptz default now()
);

-- View: último snapshot (a tela do dashboard sempre lê daqui)
create or replace view veiculos_atual as
  select v.*
  from veiculos v
  where v.snapshot_id = (select max(id) from snapshots);

-- RLS: por enquanto MVP single-user, deixar policy ampla mas com auth obrigatório.
alter table lojas enable row level security;
alter table snapshots enable row level security;
alter table veiculos enable row level security;
alter table fipe_cache enable row level security;
alter table sugestoes_preco enable row level security;

-- Usuário autenticado vê tudo (MVP). Permissão por loja vem no Épico 4.
create policy "auth_read_lojas"      on lojas      for select to authenticated using (true);
create policy "auth_write_lojas"     on lojas      for all    to authenticated using (true) with check (true);
create policy "auth_read_snapshots"  on snapshots  for select to authenticated using (true);
create policy "auth_write_snapshots" on snapshots  for all    to authenticated using (true) with check (true);
create policy "auth_read_veiculos"   on veiculos   for select to authenticated using (true);
create policy "auth_write_veiculos"  on veiculos   for all    to authenticated using (true) with check (true);
create policy "auth_read_fipe"       on fipe_cache for select to authenticated using (true);
create policy "auth_write_fipe"      on fipe_cache for all    to authenticated using (true) with check (true);
create policy "auth_read_sugestoes"  on sugestoes_preco for select to authenticated using (true);
create policy "auth_write_sugestoes" on sugestoes_preco for all    to authenticated using (true) with check (true);
