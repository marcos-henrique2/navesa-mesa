-- Navesa Mesa — Congelamento da FIPE
-- Persiste a PROCEDÊNCIA de cada preço FIPE: o score do match de modelo e se o
-- guard de plausibilidade chegou a rodar.
-- Idempotente: pode rodar várias vezes sem quebrar.
--
-- Contexto: `findModelos` já devolvia um score ponderado, mas `runFipeBatch`
-- pegava `modeloMatches[0]` e descartava o score. Um match de 0,16 e um de 0,98
-- eram persistidos como igualmente verdadeiros — foi assim que uma Ranger
-- Limited+ 2024 acabou com FIPE de R$ 75.042. Sem o score gravado não há como
-- a UI distinguir um preço confiável de um chute.
--
-- ATENÇÃO — acoplamento com o código: o limiar 0.6 abaixo espelha
-- `FIPE_SCORE_MIN` em src/lib/fipe/batch.ts. Ele aparece aqui só na cláusula
-- WHERE de um índice de auditoria (não em constraint), então divergir não
-- corrompe dado — só torna o índice menos seletivo. Mudou lá, mude aqui.

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

-- ═══════════════════════════════════════════════════════════════════════════
-- COLUNA: fipe_batch.plausibilidade_verificada
-- ═══════════════════════════════════════════════════════════════════════════
-- Um score alto prova que o NOME do modelo casou bem; não prova que o PREÇO faz
-- sentido pro carro. Quem provava isso era o guard de plausibilidade
-- (preco_fipe vs custo_total), mas ele só roda quando há custo_total — e o
-- resultado vivia num array em memória que morria no reload. Depois de um F5,
-- uma linha jamais verificada era indistinguível de uma verificada e aprovada.
--
-- DEFAULT false é deliberado: toda linha pré-existente (inclusive as ~1.579
-- gravadas pelo caminho de vendas, que passava custo_total null hardcoded)
-- assume "não verificada" até que uma nova rodada do batch prove o contrário.

alter table fipe_batch
  add column if not exists plausibilidade_verificada boolean not null default false;

comment on column fipe_batch.plausibilidade_verificada is
  'true = o guard preco_fipe vs custo_total rodou E aprovou. false = nunca rodou (sem custo_total, ou linha anterior a esta migration). A aplicação exige true para tratar a FIPE como confirmada.';

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
-- Índice PARCIAL e não único: o predicado precisa casar com o da query pro
-- planner usá-lo. Ver nota de acoplamento do 0.6 no topo do arquivo.

create index if not exists idx_fipe_batch_nao_confirmada
  on fipe_batch (chassi)
  where score is null or score < 0.6 or plausibilidade_verificada = false;

-- ═══════════════════════════════════════════════════════════════════════════
-- FIM
-- ═══════════════════════════════════════════════════════════════════════════
