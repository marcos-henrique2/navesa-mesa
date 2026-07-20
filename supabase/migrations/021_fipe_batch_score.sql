-- Navesa Mesa — Congelamento da FIPE
-- Persiste o score do match de modelo que originou cada preço FIPE.
-- Idempotente: pode rodar várias vezes sem quebrar.
--
-- Contexto: `findModelos` já devolvia um score ponderado, mas `runFipeBatch`
-- pegava `modeloMatches[0]` e descartava o score. Um match de 0,16 e um de 0,98
-- eram persistidos como igualmente verdadeiros — foi assim que uma Ranger
-- Limited+ 2024 acabou com FIPE de R$ 75.042. Sem o score gravado não há como
-- a UI distinguir um preço confiável de um chute.

-- ═══════════════════════════════════════════════════════════════════════════
-- COLUNA: fipe_batch.score
-- ═══════════════════════════════════════════════════════════════════════════
-- NULL = procedência desconhecida (linha anterior a esta migration).
-- A aplicação trata NULL como NÃO confirmado — não faz backfill com valor
-- otimista, porque as linhas legadas são justamente as suspeitas.

alter table fipe_batch
  add column if not exists score numeric(4,3);

comment on column fipe_batch.score is
  'Score do match de modelo (findModelos), 0..~1.1. NULL = match legado sem procedência; a aplicação o trata como não confirmado. Overrides manuais gravam 1.';

-- ─── CONSTRAINT ─────────────────────────────────────────────────────────────
-- CHECK sem IF NOT EXISTS antes do PG 17 → DO block pra idempotência.
-- Teto em 2 (e não 1) porque o scoring soma um bônus de 0,1 acima do máximo teórico.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'fipe_batch_score_chk' and conrelid = 'fipe_batch'::regclass
  ) then
    alter table fipe_batch
      add constraint fipe_batch_score_chk
      check (score is null or (score >= 0 and score <= 2));
  end if;
end $$;

-- ─── ÍNDICE ─────────────────────────────────────────────────────────────────
-- Suporta a varredura de auditoria "quais chassis estão com FIPE não confirmada".

create index if not exists idx_fipe_batch_score_baixo
  on fipe_batch (chassi)
  where score is null or score < 0.6;

-- ═══════════════════════════════════════════════════════════════════════════
-- FIM
-- ═══════════════════════════════════════════════════════════════════════════
