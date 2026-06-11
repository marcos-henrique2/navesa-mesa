-- Navesa Mesa — Sprint Repasses (gestão Auto Avaliar)
-- Tabelas pra gerenciar carros subidos pra repasse: snapshot do veículo,
-- valores, gastos itemizados, checklist de documentação, fotos (Sprint 3).
--
-- Snapshot do veículo NÃO usa FK pra `veiculos` porque um carro pode sair do
-- estoque (vendido) e voltar (devolvido) — o repasse precisa de identidade própria.
--
-- RLS segue o padrão do projeto: 1 policy "authenticated_all_access" por tabela
-- (`auth.uid() is not null`). Single user no MVP — sem segregação.

create table if not exists repasses (
  id bigint generated always as identity primary key,

  -- Veículo (snapshot — chassi+placa imutáveis após subir)
  chassi text not null,
  placa text not null,
  modelo text not null,
  marca text,
  cor text,
  ano_modelo integer,
  ano_fabricacao integer,
  km integer,
  loja_origem integer,
  patio_origem text,

  -- Valores (numeric centavo-perfect, conforme convenção do projeto)
  valor_aquisicao numeric(12, 2),
  valor_subiu numeric(12, 2),
  valor_minimo numeric(12, 2),
  valor_vendido numeric(12, 2),

  -- Repasse
  data_subiu date not null default current_date,
  data_vendido date,
  canal text not null default 'auto_avaliar',

  -- Status
  status text not null default 'subido'
    check (status in ('subido', 'vendido', 'nao_vendido', 'cancelado')),
  documentacao_status text not null default 'pendente'
    check (documentacao_status in ('ok', 'pendente', 'irregular')),

  -- Marketing / anúncio (Sprint 3)
  descricao text,
  opcionais text,
  comprador text,
  observacoes text,

  -- Metadados
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists idx_repasses_chassi on repasses(chassi);
create index if not exists idx_repasses_status on repasses(status);
create index if not exists idx_repasses_data_subiu on repasses(data_subiu desc);

-- Gastos (lista editável, soma alimenta breakeven)
create table if not exists repasse_gastos (
  id bigint generated always as identity primary key,
  repasse_id bigint not null references repasses(id) on delete cascade,
  tipo text not null
    check (tipo in ('documentacao', 'vistoria', 'pintura', 'mecanica', 'multas', 'outro')),
  descricao text not null,
  valor numeric(12, 2) not null check (valor >= 0),
  data date not null default current_date,
  observacao text,
  criado_em timestamptz not null default now()
);
create index if not exists idx_repasse_gastos_repasse_id on repasse_gastos(repasse_id);

-- Documentação (checklist de itens fixos com status)
create table if not exists repasse_documentos (
  id bigint generated always as identity primary key,
  repasse_id bigint not null references repasses(id) on delete cascade,
  tipo text not null
    check (tipo in ('crv', 'ipva', 'licenciamento', 'multas', 'transferencia', 'outro')),
  status text not null default 'pendente'
    check (status in ('ok', 'pendente', 'irregular')),
  observacao text,
  data_verificacao date,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (repasse_id, tipo)
);
create index if not exists idx_repasse_documentos_repasse_id on repasse_documentos(repasse_id);

-- Fotos (URLs — Sprint 3)
create table if not exists repasse_fotos (
  id bigint generated always as identity primary key,
  repasse_id bigint not null references repasses(id) on delete cascade,
  url text not null,
  ordem integer not null default 0,
  legenda text,
  criado_em timestamptz not null default now()
);
create index if not exists idx_repasse_fotos_repasse_id on repasse_fotos(repasse_id);

-- ─── Triggers updated_at ────────────────────────────────────────────────────
create or replace function repasses_set_atualizado_em()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

drop trigger if exists trg_repasses_atualizado_em on repasses;
create trigger trg_repasses_atualizado_em
  before update on repasses
  for each row execute function repasses_set_atualizado_em();

drop trigger if exists trg_repasse_documentos_atualizado_em on repasse_documentos;
create trigger trg_repasse_documentos_atualizado_em
  before update on repasse_documentos
  for each row execute function repasses_set_atualizado_em();

-- ─── RLS ────────────────────────────────────────────────────────────────────
alter table repasses enable row level security;
alter table repasse_gastos enable row level security;
alter table repasse_documentos enable row level security;
alter table repasse_fotos enable row level security;

drop policy if exists "authenticated_all_access" on repasses;
create policy "authenticated_all_access" on repasses
  for all to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

drop policy if exists "authenticated_all_access" on repasse_gastos;
create policy "authenticated_all_access" on repasse_gastos
  for all to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

drop policy if exists "authenticated_all_access" on repasse_documentos;
create policy "authenticated_all_access" on repasse_documentos
  for all to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

drop policy if exists "authenticated_all_access" on repasse_fotos;
create policy "authenticated_all_access" on repasse_fotos
  for all to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);
