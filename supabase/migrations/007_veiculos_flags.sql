-- Navesa Mesa — Sprint Mobile + Markup Avançado
-- Flags operacionais por veículo: marcações leves que o gerente faz pra
-- sinalizar condições especiais de venda — sem afetar preço, custo nem
-- classificação. Equivalentes às checkboxes "Em Promoção" / "Brinde em
-- Acessórios" da tela Markup de Venda do NBS.
--
-- Por chassi (PK), idempotente — atualizações via upsert.

create table if not exists veiculos_flags (
  chassi             text primary key,
  em_promocao        boolean not null default false,
  brinde_acessorios  boolean not null default false,
  observacao_brinde  text,
  atualizado_em      timestamptz not null default now()
);

create index if not exists idx_veiculos_flags_em_promocao
  on veiculos_flags (em_promocao) where em_promocao = true;
create index if not exists idx_veiculos_flags_brinde
  on veiculos_flags (brinde_acessorios) where brinde_acessorios = true;

alter table veiculos_flags enable row level security;

drop policy if exists "authenticated_all_access" on veiculos_flags;
create policy "authenticated_all_access" on veiculos_flags
  for all to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- Trigger pra garantir atualizado_em fiel à hora do banco mesmo se cliente esquecer.
create or replace function veiculos_flags_set_atualizado_em()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

drop trigger if exists trg_veiculos_flags_atualizado_em on veiculos_flags;
create trigger trg_veiculos_flags_atualizado_em
  before update on veiculos_flags
  for each row execute function veiculos_flags_set_atualizado_em();
