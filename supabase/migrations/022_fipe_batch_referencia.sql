-- Navesa Mesa — Referência da tabela FIPE
-- Persiste DE QUAL TABELA MENSAL cada preço FIPE veio.
-- Idempotente: pode rodar várias vezes sem quebrar.
--
-- Contexto — o bug medido na API em 20/07/2026, mesmo carro, mesmo código FIPE
-- (Ranger Limited+ 3.0 V6 2024, 003498-3):
--
--   julho/2026 (ref 335) -> R$ 275.379,00
--   junho/2026 (ref 334) -> R$ 281.220,00   <- R$ 5.841 de diferença
--   maio/2026  (ref 333) -> R$ 281.756,00
--
-- O cache do cliente tinha TTL de 30 dias aplicado sobre o VALOR e chave SEM a
-- referência. Como a FIPE publica mensalmente, preços de tabelas diferentes
-- passaram a conviver no mesmo estoque — confirmado nesta tabela, com linhas de
-- 2026-07-02 e 2026-07-15 lado a lado.
--
-- Sem a referência gravada o preço é NÃO AUDITÁVEL: não dá pra reproduzir a
-- consulta na API nem conferir contra o Auto Avaliar. Num projeto onde
-- divergência de R$ 0,01 vs NBS é bug crítico, isso é inaceitável.
--
-- Conceito por trás do fix: valor FIPE de uma referência passada é IMUTÁVEL.
-- Junho/2026 vale R$ 281.220 pra sempre. Então TTL-por-tempo é o conceito
-- errado — a chave de cache passou a conter a referência e o valor não expira.
-- Quando a FIPE publica o mês novo, as chaves novas dão miss e recalculam.

-- ═══════════════════════════════════════════════════════════════════════════
-- COLUNA: fipe_batch.fipe_referencia
-- ═══════════════════════════════════════════════════════════════════════════
-- Rótulo humano da tabela, exatamente como a API o devolve: 'julho/2026'.
-- É o que a UI exibe ("FIPE jul/2026") e o que um humano confere contra o
-- Auto Avaliar.
--
-- NULL = linha gravada antes desta migration, quando a referência não era
-- registrada. NÃO há backfill com a referência corrente: essas linhas são
-- justamente as suspeitas de defasagem, e carimbá-las com 'julho/2026'
-- transformaria a suspeita em mentira documentada. A aplicação trata NULL como
-- não confirmado (`isFipeConfirmado`), então esses carros caem no proxy de
-- custo até o batch rodar de novo — que é o comportamento correto pra um preço
-- que pode ser de qualquer mês.

alter table fipe_batch
  add column if not exists fipe_referencia text;

comment on column fipe_batch.fipe_referencia is
  'Tabela FIPE mensal de origem do preço, no formato da API: ''julho/2026''. NULL = linha anterior à migration 022, de mês desconhecido; a aplicação a trata como não confirmada. Sem esta coluna o preço não é auditável nem reproduzível.';

-- ═══════════════════════════════════════════════════════════════════════════
-- COLUNA: fipe_batch.fipe_referencia_cod
-- ═══════════════════════════════════════════════════════════════════════════
-- O identificador numérico (335 = julho/2026) é o que REPRODUZ a consulta:
-- é o valor aceito em `?referencia=` na API. O rótulo textual é pra humano; o
-- código é pra máquina. Guardar os dois é o que fecha a auditoria ponta a ponta.
--
-- Sem constraint de faixa: a numeração da FIPE é sequencial e cresce
-- indefinidamente (335 em julho/2026), então qualquer teto viraria dívida.
-- O piso é garantido pelo CHECK abaixo.

alter table fipe_batch
  add column if not exists fipe_referencia_cod integer;

comment on column fipe_batch.fipe_referencia_cod is
  'Código numérico da referência FIPE (ex.: 335 = julho/2026). É o valor aceito em ?referencia= na API parallelum — reproduz a consulta exata que gerou o preço. NULL = linha anterior à migration 022.';

-- ─── CONSTRAINTS ────────────────────────────────────────────────────────────
-- CHECK sem IF NOT EXISTS antes do PG 17 → DO block pra idempotência.

-- 1) Código de referência precisa ser positivo quando presente.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'fipe_batch_referencia_cod_chk' and conrelid = 'fipe_batch'::regclass
  ) then
    alter table fipe_batch
      add constraint fipe_batch_referencia_cod_chk
      check (fipe_referencia_cod is null or fipe_referencia_cod > 0);
  end if;
end $$;

-- 2) As duas colunas andam juntas ou nenhuma vem.
--
-- Ter só uma delas seria uma auditoria pela metade: rótulo sem código não
-- reproduz a consulta, código sem rótulo não é conferível por um humano. O
-- estado legado (ambas NULL) continua permitido — é o que as linhas antigas são.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'fipe_batch_referencia_par_chk' and conrelid = 'fipe_batch'::regclass
  ) then
    alter table fipe_batch
      add constraint fipe_batch_referencia_par_chk
      check (
        (fipe_referencia is null and fipe_referencia_cod is null)
        or (fipe_referencia is not null and fipe_referencia_cod is not null)
      );
  end if;
end $$;

-- ─── ÍNDICE ─────────────────────────────────────────────────────────────────
-- Suporta a pergunta operacional que motivou tudo isso: "o estoque está todo
-- na mesma tabela FIPE, ou tem mês misturado?"
--
--   select fipe_referencia, count(*) from fipe_batch group by 1 order by 1;
--
-- Índice comum (não parcial): a varredura é por agrupamento de TODAS as linhas,
-- não por um subconjunto — diferente do índice parcial da 021, que serve à
-- varredura de "não confirmadas".

create index if not exists idx_fipe_batch_referencia
  on fipe_batch (fipe_referencia_cod);

-- ═══════════════════════════════════════════════════════════════════════════
-- FIM
-- ═══════════════════════════════════════════════════════════════════════════
