-- Navesa Mesa — Fase B.2b: Preço-alvo interno
-- Tabela que registra a decisão de preço-alvo do operador (rastreabilidade)
-- quando ele clica em "Definir preço-alvo R$ X" no PrecificacaoBlock.
-- Idempotente: pode rodar várias vezes sem quebrar.

-- ═══════════════════════════════════════════════════════════════════════════
-- TABELA: preco_alvo
-- ═══════════════════════════════════════════════════════════════════════════
-- Cada linha = uma decisão de preço-alvo pra um chassi específico.
-- Permite:
--   - rastreabilidade: ver se o carro foi vendido no preço-alvo ou desviou
--   - histórico: medir aderência da operação às sugestões da mesa
--   - revogação: operador pode trocar o alvo (status 'revogado' + criar novo 'definido')
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists preco_alvo (
  id                     bigserial primary key,
  chassi                 text not null,
  preco_alvo             numeric(12,2) not null,
  estrategia             text not null check (estrategia in ('target', 'giro', 'minimo')),
  preco_atual_snapshot   numeric(12,2),
  margem_pct_snapshot    numeric(6,3),
  fonte                  text,                    -- historico / fipe / custo (do sugerirPreco)
  status                 text not null default 'definido' check (status in ('definido','aplicado','revogado')),
  observacao             text,
  versao_formula         text not null default 'diagnostico_v2',
  criado_em              timestamptz not null default now(),
  atualizado_em          timestamptz not null default now()
);

-- ─── ÍNDICES ────────────────────────────────────────────────────────────────

create index if not exists idx_preco_alvo_chassi_recente
  on preco_alvo(chassi, criado_em desc);

-- Único parcial: no máximo 1 preço-alvo ativo por chassi.
-- Trocar o alvo = revogar o ativo + inserir um novo 'definido'.
create unique index if not exists uniq_preco_alvo_ativo
  on preco_alvo(chassi)
  where status = 'definido';

-- ─── RLS ────────────────────────────────────────────────────────────────────
-- MVP single-user: mesma policy do resto (mvp_all_access).

alter table preco_alvo enable row level security;
drop policy if exists "mvp_all_access" on preco_alvo;
create policy "mvp_all_access" on preco_alvo
  for all using (true) with check (true);

-- ─── TRIGGER: atualizado_em ─────────────────────────────────────────────────

create or replace function update_preco_alvo_atualizado_em()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

drop trigger if exists trg_preco_alvo_atualizado_em on preco_alvo;
create trigger trg_preco_alvo_atualizado_em
  before update on preco_alvo
  for each row execute function update_preco_alvo_atualizado_em();

-- ═══════════════════════════════════════════════════════════════════════════
-- FIM
-- ═══════════════════════════════════════════════════════════════════════════
