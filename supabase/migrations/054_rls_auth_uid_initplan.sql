-- Navesa Mesa — 054: RLS com (select auth.uid()) — InitPlan avaliado 1x por consulta
--
-- Advisor de performance do Supabase (lint 0003 auth_rls_initplan) aponta 25 policies
-- em public no formato `auth.uid() IS NOT NULL` (criadas a partir da 005). Dentro de RLS
-- o predicado vira `Filter:` POR LINHA (COALESCE(current_setting(...))::jsonb ->> 'sub')::uuid.
-- Com `(select auth.uid())` o planner gera um InitPlan avaliado uma única vez e a checagem
-- vira One-Time Filter / comparação com constante.
--
-- Semântica IDÊNTICA: mesmo nome, comando, roles e PERMISSIVE (ALTER POLICY só troca
-- USING/WITH CHECK). `(select auth.uid()) is not null` ≡ `auth.uid() is not null`
-- (função STABLE, sem argumentos, valor constante dentro da consulta).
-- Não toca: cerebro_leitor_select (using true), convite_insert_publico (with check true).
-- storage: nenhuma policy do app. sugestoes_preco (legado da 001) entra na lista só para
-- replays limpos; no remoto a tabela não existe e o bloco apenas emite NOTICE.
--
-- Ganho medido no remoto (19.207 linhas de veiculos, 2026-11-11): avaliar o predicado por
-- linha custa ~1,7 µs/linha (~30 ms em 19 mil linhas). É ganho real, mas PEQUENO — a
-- variação de 0,04 s a 5 s observada vem de outra causa (CPU da instância; ver relatório).
--
-- Idempotente: só altera se a policy existir; rodar 2x produz o mesmo estado.
-- Rollback: mesmo bloco trocando `(select auth.uid())` por `auth.uid()`.

do $$
declare
  r record;
  alvo constant text[][] := array[
    ['cautelar',                      'authenticated_all_access'],
    ['chat_messages',                 'authenticated_all_access'],
    ['custos_detalhados',             'authenticated_all_access'],
    ['custos_estoque_detalhado',      'authenticated_all_access'],
    ['estoque_snapshots',             'authenticated_all_access'],
    ['fipe_batch',                    'authenticated_all_access'],
    ['fipe_cache',                    'authenticated_all_access'],
    ['kpi_snapshots',                 'authenticated_all_access'],
    ['lead_interesses',               'authenticated_all_access'],
    ['leads',                         'authenticated_all_access'],
    ['lojas',                         'authenticated_all_access'],
    ['preco_alvo',                    'authenticated_all_access'],
    ['repasse_documentos',            'authenticated_all_access'],
    ['repasse_fotos',                 'authenticated_all_access'],
    ['repasse_gastos',                'authenticated_all_access'],
    ['repasse_interessados',          'authenticated_all_access'],
    ['repasse_precificacao_sugerida', 'authenticated_all_access'],
    ['repasses',                      'authenticated_all_access'],
    ['reprecificacao_sugerida',       'authenticated_all_access'],
    ['veiculos',                      'authenticated_all_access'],
    ['veiculos_flags',                'authenticated_all_access'],
    ['vendas',                        'authenticated_all_access'],
    ['vendedores',                    'authenticated_all_access'],
    ['markup_piloto_debug',           'authenticated_read_markup_piloto_debug'],
    ['sync_log',                      'authenticated_read_sync_log'],
    -- legado da 001 (não existe no remoto; existe num replay limpo 001→053)
    ['sugestoes_preco',               'authenticated_all_access']
  ];
  i int;
begin
  for i in 1 .. array_length(alvo, 1) loop
    select p.cmd, p.with_check into r
      from pg_policies p
     where p.schemaname = 'public'
       and p.tablename  = alvo[i][1]
       and p.policyname = alvo[i][2];

    if not found then
      raise notice '054: policy %.% não existe — ignorada', alvo[i][1], alvo[i][2];
      continue;
    end if;

    if r.cmd in ('SELECT', 'DELETE') then
      -- comando sem WITH CHECK
      execute format('alter policy %I on public.%I using ((select auth.uid()) is not null)',
                     alvo[i][2], alvo[i][1]);
    elsif r.cmd = 'INSERT' then
      execute format('alter policy %I on public.%I with check ((select auth.uid()) is not null)',
                     alvo[i][2], alvo[i][1]);
    elsif r.with_check is null then
      -- ALL/UPDATE sem WITH CHECK explícito: mantém assim (USING vale para os dois)
      execute format('alter policy %I on public.%I using ((select auth.uid()) is not null)',
                     alvo[i][2], alvo[i][1]);
    else
      execute format('alter policy %I on public.%I using ((select auth.uid()) is not null) '
                     'with check ((select auth.uid()) is not null)',
                     alvo[i][2], alvo[i][1]);
    end if;
  end loop;
end
$$;
