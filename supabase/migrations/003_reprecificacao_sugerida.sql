-- Navesa Mesa — Fase A: Diagnóstico de Coerência
-- Tabela de sugestões de reprecificação (snapshots auditáveis).
-- Idempotente: pode rodar várias vezes sem quebrar.
--
-- Observação (decisão arquitetural): NÃO criamos matview de mediana.
-- A mediana de km/modelo/ano é calculada client-side em src/lib/pricing/medianas.ts
-- a partir de estoque atual + vendas dos últimos 24 meses (já estão em memória).

-- ═══════════════════════════════════════════════════════════════════════════
-- TABELA: reprecificacao_sugerida
-- ═══════════════════════════════════════════════════════════════════════════
-- Cada linha = uma sugestão de novo preço para um chassi específico, com
-- snapshot completo do contexto (FIPE, classe, dias_patio, km, cautelar, etc.)
-- no momento em que a sugestão foi gerada. Isso permite:
--   - auditoria: explicar pro avaliador por que sugerimos R$ X
--   - histórico: ver se sugestões viraram ajustes reais
--   - versionamento de fórmula: trocar params sem perder análises antigas
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists reprecificacao_sugerida (
  id                          bigserial primary key,
  chassi                      text not null,
  criado_em                   timestamptz not null default now(),
  atualizado_em               timestamptz not null default now(),
  versao_formula              text not null default 'diagnostico_v1',
  status                      text not null default 'pendente',
  preco_sugerido              numeric(12,2) not null,
  -- snapshots auditáveis (capturados no momento da sugestão)
  preco_atual_snapshot        numeric(12,2),
  fipe_snapshot               numeric(12,2),
  classe_snapshot             text,
  dias_patio_snapshot         integer,
  km_snapshot                 integer,
  cautelar_snapshot           text,
  mediana_km_snapshot         integer,
  desvio_pct_snapshot         numeric(6,3),
  -- FIX 4 (auditoria completa): snapshot do soma-de-ajustes (após cap) e dos flags de confiança.
  -- Sem isso, não dá pra explicar pro avaliador 6 meses depois POR QUE a sugestão saiu daquele jeito.
  ajuste_total_pct_snapshot   numeric(6,4),
  confianca_snapshot          jsonb,
  motivo                      jsonb not null default '[]'::jsonb,
  observacao_usuario          text,
  preco_aplicado              numeric(12,2),
  aplicado_em                 timestamptz
);

-- Idempotência: se a tabela já existe (rodada anterior), garante as colunas novas.
alter table reprecificacao_sugerida
  add column if not exists ajuste_total_pct_snapshot numeric(6,4);
alter table reprecificacao_sugerida
  add column if not exists confianca_snapshot jsonb;

-- ─── CONSTRAINTS ────────────────────────────────────────────────────────────
-- Adicionadas via DO block pra serem idempotentes (CHECK constraints não têm IF NOT EXISTS antes do PG 17).

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'reprec_chassi_len_chk' and conrelid = 'reprecificacao_sugerida'::regclass
  ) then
    alter table reprecificacao_sugerida
      add constraint reprec_chassi_len_chk check (length(chassi) >= 10);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'reprec_versao_formato_chk' and conrelid = 'reprecificacao_sugerida'::regclass
  ) then
    alter table reprecificacao_sugerida
      add constraint reprec_versao_formato_chk check (versao_formula ~ '^diagnostico_v[0-9]+$');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'reprec_status_chk' and conrelid = 'reprecificacao_sugerida'::regclass
  ) then
    alter table reprecificacao_sugerida
      add constraint reprec_status_chk
      check (status in ('pendente','em_revisao','aplicado','descartado'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'reprec_classe_chk' and conrelid = 'reprecificacao_sugerida'::regclass
  ) then
    alter table reprecificacao_sugerida
      add constraint reprec_classe_chk
      check (classe_snapshot is null or classe_snapshot in ('A','B','C','D','E'));
  end if;
end $$;

-- ─── ÍNDICES ────────────────────────────────────────────────────────────────

create index if not exists idx_reprec_chassi_recente
  on reprecificacao_sugerida (chassi, criado_em desc);

create index if not exists idx_reprec_status_recente
  on reprecificacao_sugerida (status, criado_em desc);

-- Único parcial: impede 2 sugestões abertas pro mesmo chassi simultaneamente.
-- Cobertura: status pendente OU em_revisao. Aplicadas/descartadas viram histórico.
create unique index if not exists uniq_reprec_pendente
  on reprecificacao_sugerida (chassi)
  where status in ('pendente','em_revisao');

-- ─── TRIGGER: atualizado_em ─────────────────────────────────────────────────

create or replace function reprec_set_atualizado_em()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

drop trigger if exists trg_reprec_atualizado_em on reprecificacao_sugerida;
create trigger trg_reprec_atualizado_em
  before update on reprecificacao_sugerida
  for each row
  execute function reprec_set_atualizado_em();

-- ─── RLS ────────────────────────────────────────────────────────────────────
-- MVP single-user: mesma policy do resto (mvp_all_access).

alter table reprecificacao_sugerida enable row level security;
drop policy if exists "mvp_all_access" on reprecificacao_sugerida;
create policy "mvp_all_access" on reprecificacao_sugerida
  for all using (true) with check (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- FIM
-- ═══════════════════════════════════════════════════════════════════════════
