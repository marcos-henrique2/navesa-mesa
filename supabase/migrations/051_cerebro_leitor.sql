-- Navesa Mesa — 051: role Postgres somente leitura `cerebro_leitor` (fatia 1a do cérebro)
--
-- Contexto: docs/arquitetura/cerebro-claude.md, seção 1.3 (opção D).
-- O serviço "cérebro" (Claude no Docker) conecta direto no Postgres pelo pooler
-- (Supavisor) com `pg`, usando esta role. Nunca usa service_role.
--
-- Histórico: nasceu como `026_cerebro_leitor.sql` na branch feat/cerebro-1a (criada
-- sobre um main antigo). O número 026 já pertence a `026_revoke_anon_rpc_leads.sql`
-- e 050 a `050_veiculos_origem_lateral.sql`; por isso virou 051. Revisada contra o
-- schema 026–050 do main (vendas 037/039/042, veiculos 039/040, veiculos_origem
-- 038/050, sync_log 041, markup_piloto_debug 049, RPCs 020/028/029/034/036/045).
-- Se a versão 026 antiga tiver sido aplicada manualmente em algum ambiente, esta
-- 051 roda por cima sem erro (idempotente) e reconcilia os privilégios.
--
-- Garantias desta migration:
--   1. Role criada sem SUPERUSER/BYPASSRLS/CREATEROLE/CREATEDB/REPLICATION, NOINHERIT.
--      No Supabase o `postgres` NÃO é superuser (PG16+): ele não pode escrever
--      NOSUPERUSER num ALTER ROLE, então esse atributo só aparece no CREATE ROLE
--      (o default de CREATE ROLE já é NOSUPERUSER) e é conferido por um guard
--      que aborta a migration se rolsuper ou rolbypassrls estiverem true.
--   2. SELECT de tabela inteira só em tabelas sem PII nem texto livre (seção 3).
--   3. GRANT POR COLUNA (allowlist, fail-closed) em (seção 4):
--        vendas         — sem cliente_nome, cliente_codigo (CPF/CNPJ), vendedor_cpf, renavam.
--        cautelar       — sem observacao (texto livre do laudo).
--        veiculos_flags — sem observacao_brinde (texto livre).
--        sync_log       — sem erro_mensagem (stack/erro do Oracle pode ter host/usuário).
--      Coluna nova nessas tabelas NÃO fica visível sem nova migration.
--   4. Nenhum acesso a leads, lead_interesses, repasse_interessados, chat_messages,
--      vendedores (tem cpf), repasses*, kpi_snapshots, preco_alvo, reprecificacao_sugerida,
--      markup_piloto_debug (debug JSONB bruto), auth.*, storage.*.
--   5. Sem EXECUTE em NENHUMA função SECURITY DEFINER de public (seção 2b): as RPCs
--      da 020 e todas as que gravam (import/sync de repasse, marcar_lead_contatado...).
--      Funções recebem EXECUTE via PUBLIC por padrão e cerebro_leitor é membro
--      implícito de PUBLIC (NOINHERIT não muda isso), então a revogação é feita em
--      PUBLIC, preservando com GRANT explícito quem já executava (anon/authenticated/
--      service_role) — comportamento do app inalterado.
--   6. Policies RLS `FOR SELECT TO cerebro_leitor USING (true)` só nas tabelas concedidas.
--      As policies da 005/041/049 são `TO authenticated` e NÃO cobrem esta role.
--   7. Defesa extra: default_transaction_read_only, statement/lock/idle timeouts, connection limit.
--      Atenção: default_transaction_read_only é só um default (a sessão poderia mudar).
--      Quem garante "não escreve" são os privilégios (só SELECT). Os dois juntos = defesa em profundidade.
--
-- Idempotente: roda 2x sem erro. Não mexe em LOGIN/senha se a role já existe.
-- NUNCA colocar senha neste arquivo.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- PASSO MANUAL (Marcos, SQL Editor do Supabase, DEPOIS de aplicar esta migration):
--
--   ALTER ROLE cerebro_leitor WITH LOGIN PASSWORD '<senha forte, 32+ chars, gerada>';
--
-- Gerar a senha fora do chat (ex.: `openssl rand -base64 33`), guardar só em
-- cerebro/.env (SUPABASE_DB_URL, fora do git). Não colar a senha em issue/PR/chat.
-- Conexão pelo pooler: usuário `cerebro_leitor.gjyzcyamwdldnriqydua`,
-- host do Supavisor do projeto (Dashboard > Connect), sslmode=require.
-- Rotação: repetir o ALTER ROLE com senha nova e atualizar o .env.
-- Desligar em emergência: ALTER ROLE cerebro_leitor NOLOGIN;
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 1. Role (cria NOLOGIN; o LOGIN + senha é o passo manual acima)
-- ───────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'cerebro_leitor') then
    create role cerebro_leitor
      nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls
      connection limit 5;
  end if;
end $$;

-- Atributos reaplicados sempre (rerun). NÃO inclui NOSUPERUSER (exige superuser
-- no PG16+) nem LOGIN/PASSWORD (passo manual).
-- connection limit 5 (doc da Aria: ~3): folga para o pool do loader (queries em
-- paralelo + checagem de frescor) e reconexões do Supavisor sem "too many connections".
alter role cerebro_leitor
  nocreatedb nocreaterole noinherit noreplication nobypassrls
  connection limit 5;

-- Guard: se alguém deu superuser/bypassrls à role por fora, aborta (RLS e grants
-- deixariam de valer). Corrigir manualmente como superuser antes de prosseguir.
do $$
begin
  if exists (select 1 from pg_roles
             where rolname = 'cerebro_leitor' and (rolsuper or rolbypassrls)) then
    raise exception 'cerebro_leitor está com SUPERUSER ou BYPASSRLS: abortando a 051';
  end if;
end $$;

-- Defaults de sessão (aplicados quando a role conecta)
alter role cerebro_leitor set default_transaction_read_only = on;
-- 15s (doc da Aria: ~10s): o loader carrega veiculos/vendas/custos inteiros em uma
-- query cada; 15s dá margem com pooler frio sem permitir query presa por muito tempo.
alter role cerebro_leitor set statement_timeout = '15s';
alter role cerebro_leitor set lock_timeout = '3s';
alter role cerebro_leitor set idle_in_transaction_session_timeout = '10s';
alter role cerebro_leitor set idle_session_timeout = '10min';
alter role cerebro_leitor set search_path = public;

comment on role cerebro_leitor is
  'Somente leitura para o serviço cérebro (Claude no Docker). Ver migration 051 e docs/arquitetura/cerebro-claude.md.';


-- ───────────────────────────────────────────────────────────────────────────
-- 2. Zera qualquer privilégio anterior da role no schema public (rerun limpo)
--    REVOKE de tabela também revoga os privilégios de COLUNA da role
--    (doc do REVOKE), então grants por coluna antigos/acidentais somem aqui.
-- ───────────────────────────────────────────────────────────────────────────
revoke all on all tables    in schema public from cerebro_leitor;
revoke all on all sequences in schema public from cerebro_leitor;
revoke all on all functions in schema public from cerebro_leitor;
revoke create on schema public from cerebro_leitor;

-- Acesso futuro:
--   - TABELAS/SEQUENCES novas: os default privileges do projeto (postgres e
--     supabase_admin) concedem só a anon/authenticated/service_role, nunca a PUBLIC.
--     Tabela nova NÃO fica visível para cerebro_leitor sem grant explícito.
--   - FUNÇÕES novas: NÃO há essa garantia. O Postgres dá EXECUTE a PUBLIC por padrão
--     e cerebro_leitor herda isso via PUBLIC (o REVOKE acima, por role, não remove
--     o grant de PUBLIC). A seção 2b trata as que existem HOJE.
--     REGRA: toda função SECURITY DEFINER nova deve ter
--       revoke execute on function <nome>(<args>) from public;
--     seguido de grant explícito só para quem precisa (padrão da 026/029/036).
--     A verificação A4 abaixo lista qualquer SECURITY DEFINER que escapar.
-- Reforço explícito (no-op hoje; não altera defaults de outras roles):
alter default privileges for role postgres in schema public revoke all on tables    from cerebro_leitor;
alter default privileges for role postgres in schema public revoke all on sequences from cerebro_leitor;
alter default privileges for role postgres in schema public revoke all on functions from cerebro_leitor;

-- Schemas do Supabase: auth/storage não têm USAGE para PUBLIC; reforço explícito.
do $$
declare s text;
begin
  foreach s in array array['auth','storage','extensions','graphql','graphql_public','realtime','vault','supabase_functions','net','cron','pgsodium']
  loop
    if exists (select 1 from pg_namespace where nspname = s) then
      begin
        execute format('revoke all on schema %I from cerebro_leitor', s);
      exception when insufficient_privilege then
        -- postgres não tem privilégio nenhum nesse schema (ex.: vault/pgsodium):
        -- então cerebro_leitor também não recebeu nada dele. Seguro ignorar.
        raise notice 'cerebro_leitor: sem privilégio para revogar em schema %, ignorado', s;
      end;
    end if;
  end loop;
end $$;

grant usage on schema public to cerebro_leitor;


-- ───────────────────────────────────────────────────────────────────────────
-- 2b. EXECUTE: nenhuma função SECURITY DEFINER de public para cerebro_leitor
--
--     Alvo: toda função SECURITY DEFINER em public (ignoram RLS e gravam/expõem
--     dado com privilégio do owner) + as RPCs da 020 por nome (defensivo).
--     No main de hoje (050) isso cobre, entre outras:
--       fila_disparo_whatsapp(integer)                       020/026/028 — lê nome+telefone de leads
--       marcar_lead_contatado(bigint,text,bigint)            020/026/028/034 — UPDATE leads/lead_interesses
--     e as que já nasceram sem PUBLIC (029/036/045) ficam conferidas pelo mesmo laço.
--     Trigger functions (ex.: repasses_congela_desfecho_nos_snapshots, 035) ficam
--     de fora: não podem ser chamadas diretamente ("can only be called as triggers").
--
--     Como cerebro_leitor só executa via PUBLIC, o REVOKE tem que ser em PUBLIC.
--     Para não mudar o app, antes do REVOKE cada papel do Supabase que HOJE
--     executa a função (anon/authenticated/service_role, mesmo que só via PUBLIC)
--     recebe GRANT explícito. Resultado: só quem dependia de PUBLIC sem ser um
--     desses papéis (cerebro_leitor) perde o acesso.
--     Funções SECURITY INVOKER não entram: rodam como cerebro_leitor, que só tem
--     SELECT e sessão read-only — não conseguem gravar.
-- ───────────────────────────────────────────────────────────────────────────
do $$
declare
  f regprocedure;
  papel text;
begin
  for f in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind in ('f', 'p')
      and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
      and (p.prosecdef or p.proname in ('fila_disparo_whatsapp', 'marcar_lead_contatado'))
      and has_function_privilege('cerebro_leitor', p.oid, 'EXECUTE')
  loop
    foreach papel in array array['anon', 'authenticated', 'service_role'] loop
      if exists (select 1 from pg_roles where rolname = papel)
         and has_function_privilege(papel, f, 'EXECUTE') then
        execute format('grant execute on function %s to %I', f, papel);
      end if;
    end loop;
    execute format('revoke execute on function %s from public', f);
    execute format('revoke execute on function %s from cerebro_leitor', f);
    raise notice 'cerebro_leitor: EXECUTE revogado (via PUBLIC) em %', f;
  end loop;
end $$;


-- ───────────────────────────────────────────────────────────────────────────
-- 3. SELECT por tabela inteira (sem PII de cliente, sem texto livre)
--    Tools da fatia 1: resumo_estoque, carros_parados, buscar_veiculo,
--    vendas_periodo, comparar_fipe, resumo_executivo, listar_lojas.
-- ───────────────────────────────────────────────────────────────────────────
do $$
declare
  t text;
  tabelas text[] := array[
    'estoque_snapshots',         -- data/id do snapshot; usado por veiculos_atual
    'veiculos',                  -- base de veiculos_atual/veiculos_origem (security_invoker);
                                 -- inclui valoriza (039) e custo_* por categoria (040/043/046/048)
    'custos_detalhados',         -- custos por placa das vendas (margem real)
    'custos_estoque_detalhado',  -- custos do estoque atual (upload manual de PDF, 006)
    'fipe_batch',                -- FIPE por chassi (+ score/referência 021/022)
    'lojas'                      -- listar_lojas
  ];
begin
  foreach t in array tabelas
  loop
    if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and c.relname = t and c.relkind in ('r','p')) then
      execute format('grant select on public.%I to cerebro_leitor', t);
      execute format('drop policy if exists "cerebro_leitor_select" on public.%I', t);
      execute format(
        'create policy "cerebro_leitor_select" on public.%I for select to cerebro_leitor using (true)', t);
    end if;
  end loop;
end $$;

-- Views security_invoker = true → checam as tabelas base como cerebro_leitor:
--   veiculos_atual  (039/040) → veiculos + estoque_snapshots (concedidos acima)
--   veiculos_origem (038/050) → veiculos (concedido acima). Loja de origem do chassi
--                               (estoque próprio vs. repasse) para análises de vendas.
do $$
declare v text;
begin
  foreach v in array array['veiculos_atual', 'veiculos_origem']
  loop
    if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and c.relname = v and c.relkind = 'v') then
      execute format('grant select on public.%I to cerebro_leitor', v);
    end if;
  end loop;
end $$;


-- ───────────────────────────────────────────────────────────────────────────
-- 4. SELECT POR COLUNA (allowlist ∩ colunas existentes; fail-closed)
--
--    vendas — excluídas (decisão do Marcos, Q5): cliente_nome, cliente_codigo
--      (é CPF/CNPJ em ~63% das linhas), vendedor_cpf, renavam.
--      Liberadas as novas do main: financiado/financeira (037; financeira é nome
--      da instituição, não do cliente), valoriza (039), consignado (042).
--      placa_troca liberada (placa do carro dado na troca; não identifica pessoa
--      sem consulta externa — decisão do Marcos).
--      ESPELHO EXATO de VENDAS_COLUNAS_CEREBRO (src/lib/data/mappers/vendas.ts).
--
--    cautelar — sem `observacao` (texto livre do laudo; pode conter nome/telefone
--      de quem fez a vistoria ou do antigo dono). Decisão pendente do Marcos:
--      BLOQUEADO por padrão. Para liberar depois: nova migration adicionando a coluna.
--
--    veiculos_flags — sem `observacao_brinde` (texto livre). Mesma decisão pendente:
--      BLOQUEADO por padrão.
--
--    sync_log (041) — liberado só o necessário para "dados atualizados há X"
--      (mesmo uso do SyncIndicator do app): fonte/status/horários/contagens.
--      Sem PII. `erro_mensagem` BLOQUEADA: texto de erro do Oracle/script pode
--      trazer host, usuário de banco ou trecho de dado.
--
--    Não concedidas de propósito: markup_piloto_debug (049: debug de piloto,
--      JSONB bruto não validado, sem uso no chat), e o resto listado no topo.
-- ───────────────────────────────────────────────────────────────────────────
do $$
declare
  cfg record;
  cols text;
  conflito text;
begin
  for cfg in
    select * from (values
      ('vendas',
       array[
         'id','chassi','placa','modelo','marca','ano_fabricacao','ano_modelo','cor_externa','km',
         'cod_empresa','empresa_nome','patio',
         'vendedor_codigo','vendedor_nome','vendedor_recebeu',
         'cliente_tipo','cliente_cidade','cliente_uf',
         'data_venda','data_faturamento','data_entrada',
         'valor_venda','preco_venda_tabela','total_nota_fabrica','custo_floor_plan','custo_total_final',
         'despesas_gerais','margem_pct','comissao_vendedor','dias_estoque','placa_troca',
         'atualizado_em','financiado','financeira','valoriza','consignado'
       ]::text[],
       array['cliente_nome','cliente_codigo','vendedor_cpf','renavam']::text[]),
      ('cautelar',
       array['chassi','status','atualizado_em']::text[],
       array['observacao']::text[]),
      ('veiculos_flags',
       array['chassi','em_promocao','brinde_acessorios','atualizado_em']::text[],
       array['observacao_brinde']::text[]),
      ('sync_log',
       array['id','fonte','iniciado_em','finalizado_em','status',
             'linhas_lidas','linhas_gravadas','duracao_ms']::text[],
       array['erro_mensagem']::text[])
    ) as x(tabela, permitidas, bloqueadas)
  loop
    -- Sanidade: allowlist e blocklist nunca se cruzam (erro de edição futura)
    select string_agg(c, ', ') into conflito
    from unnest(cfg.permitidas) c where c = any (cfg.bloqueadas);
    if conflito is not null then
      raise exception 'cerebro_leitor: coluna(s) % de % estão na allowlist E na blocklist', conflito, cfg.tabela;
    end if;

    if not exists (select 1 from pg_class c2 join pg_namespace n on n.oid = c2.relnamespace
                   where n.nspname = 'public' and c2.relname = cfg.tabela and c2.relkind in ('r','p')) then
      continue;
    end if;

    -- Limpa grant de tabela (a seção 2 já fez; reforço explícito por tabela sensível)
    execute format('revoke select on public.%I from cerebro_leitor', cfg.tabela);

    select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
      into cols
    from information_schema.columns
    where table_schema = 'public' and table_name = cfg.tabela
      and column_name = any (cfg.permitidas)
      and column_name <> all (cfg.bloqueadas);

    if cols is not null then
      execute format('grant select (%s) on public.%I to cerebro_leitor', cols, cfg.tabela);
    end if;

    execute format('drop policy if exists "cerebro_leitor_select" on public.%I', cfg.tabela);
    execute format(
      'create policy "cerebro_leitor_select" on public.%I for select to cerebro_leitor using (true)', cfg.tabela);
  end loop;
end $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO PÓS-APLICAÇÃO
-- (A) SQL Editor como postgres — não precisa de senha nem de SET ROLE
-- ═══════════════════════════════════════════════════════════════════════════
-- -- A1. Atributos e defaults da role
-- select rolname, rolcanlogin, rolsuper, rolbypassrls, rolinherit, rolconnlimit, rolconfig
-- from pg_roles where rolname = 'cerebro_leitor';
-- -- Esperado: rolsuper=f, rolbypassrls=f, rolinherit=f, rolconnlimit=5,
-- -- rolconfig com default_transaction_read_only=on, statement_timeout=15s, ...
-- -- rolcanlogin=f até o passo manual; t depois.
--
-- -- A2. Tabelas/views: o que a role enxerga; nunca INSERT/UPDATE/DELETE/TRUNCATE
-- select c.relname, c.relkind,
--        has_table_privilege('cerebro_leitor', c.oid, 'SELECT')      as sel,
--        has_any_column_privilege('cerebro_leitor', c.oid, 'SELECT') as sel_alguma_coluna,
--        has_table_privilege('cerebro_leitor', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE') as escreve
-- from pg_class c join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'public' and c.relkind in ('r','v','m','p')
--   and has_any_column_privilege('cerebro_leitor', c.oid, 'SELECT')
-- order by c.relname;
-- -- Esperado (10 linhas):
-- --   sel=t: estoque_snapshots, veiculos, custos_detalhados, custos_estoque_detalhado,
-- --          fipe_batch, lojas, veiculos_atual, veiculos_origem
-- --   sel=f + sel_alguma_coluna=t: vendas, cautelar, veiculos_flags, sync_log
-- -- (são 12 com as de coluna; qualquer outra tabela na lista = erro)
-- -- escreve=f em TODAS.
--
-- -- A3. Colunas bloqueadas negadas, úteis liberadas
-- select t, col, has_column_privilege('cerebro_leitor', format('public.%I', t), col, 'SELECT') as pode
-- from (values ('vendas','cliente_nome'),('vendas','cliente_codigo'),('vendas','vendedor_cpf'),
--              ('vendas','renavam'),('cautelar','observacao'),('veiculos_flags','observacao_brinde'),
--              ('sync_log','erro_mensagem'),
--              ('vendas','valor_venda'),('vendas','financiado'),('vendas','consignado'),
--              ('vendas','placa_troca'),('cautelar','status'),('veiculos_flags','em_promocao'),
--              ('sync_log','finalizado_em')) as x(t, col);
-- -- Esperado: 7 x f, depois 7 x t
--
-- -- A4. Schemas e funções
-- select has_schema_privilege('cerebro_leitor','auth','USAGE')    as auth_usage,     -- f
--        has_schema_privilege('cerebro_leitor','storage','USAGE') as storage_usage,  -- f
--        has_schema_privilege('cerebro_leitor','public','CREATE') as public_create,  -- f
--        has_function_privilege('cerebro_leitor','public.fila_disparo_whatsapp(integer)','EXECUTE') as rpc_fila,          -- f
--        has_function_privilege('cerebro_leitor','public.marcar_lead_contatado(bigint,text,bigint)','EXECUTE') as rpc_lead, -- f
--        has_function_privilege('authenticated','public.marcar_lead_contatado(bigint,text,bigint)','EXECUTE') as app_ok;   -- t
-- -- Nenhuma SECURITY DEFINER executável pela role (esperado: 0 linhas)
-- select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.prosecdef
--   and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
--   and has_function_privilege('cerebro_leitor', p.oid, 'EXECUTE');
--
-- -- A5. Policies criadas
-- select tablename, policyname, roles, cmd from pg_policies
-- where policyname = 'cerebro_leitor_select' order by tablename;
-- -- Esperado: 10 linhas (6 tabelas inteiras + vendas, cautelar, veiculos_flags, sync_log),
-- -- roles={cerebro_leitor}, cmd=SELECT.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- (B) Teste funcional conectado COMO cerebro_leitor (depois do passo manual)
--     psql "postgresql://cerebro_leitor.gjyzcyamwdldnriqydua:<senha>@<host-pooler>:5432/postgres?sslmode=require"
-- ═══════════════════════════════════════════════════════════════════════════
-- select current_user, current_setting('default_transaction_read_only'),
--        current_setting('statement_timeout');            -- cerebro_leitor | on | 15s
-- select count(*) from veiculos_atual;                    -- OK (> 0)
-- select count(*) from veiculos_origem;                   -- OK
-- select count(*), sum(valor_venda) from vendas;          -- OK
-- select chassi, status from cautelar limit 1;            -- OK
-- select fonte, max(finalizado_em) from sync_log group by fonte; -- OK
-- select cliente_nome from vendas limit 1;                -- ERRO: permission denied for table vendas
-- select * from vendas limit 1;                           -- ERRO: permission denied (há colunas negadas)
-- select observacao from cautelar limit 1;                -- ERRO: permission denied for table cautelar
-- select * from veiculos_flags limit 1;                   -- ERRO: permission denied
-- select erro_mensagem from sync_log limit 1;             -- ERRO: permission denied
-- select count(*) from leads;                             -- ERRO: permission denied for table leads
-- select count(*) from chat_messages;                     -- ERRO: permission denied
-- select count(*) from markup_piloto_debug;               -- ERRO: permission denied
-- select count(*) from auth.users;                        -- ERRO: permission denied for schema auth
-- insert into lojas (cod_empresa, nome) values (999,'x'); -- ERRO: cannot execute INSERT in a read-only transaction
-- begin read write;                                       -- tenta furar o read-only
--   insert into lojas (cod_empresa, nome) values (999,'x'); -- ERRO: permission denied for table lojas
-- rollback;
-- select fila_disparo_whatsapp(1);                        -- ERRO: permission denied for function
-- select marcar_lead_contatado(1,'sondagem');             -- ERRO: permission denied for function
-- select pg_sleep(20);                                    -- ERRO: canceling statement due to statement timeout
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK (se precisar desfazer)
-- ═══════════════════════════════════════════════════════════════════════════
-- do $$ declare t text; begin
--   foreach t in array array['estoque_snapshots','veiculos','vendas','custos_detalhados',
--     'custos_estoque_detalhado','fipe_batch','lojas','cautelar','veiculos_flags','sync_log'] loop
--     execute format('drop policy if exists "cerebro_leitor_select" on public.%I', t);
--   end loop; end $$;
-- drop owned by cerebro_leitor;   -- remove todos os grants (tabela e coluna) da role
-- drop role cerebro_leitor;
-- -- Os REVOKE de PUBLIC da seção 2b NÃO precisam ser desfeitos: anon/authenticated/
-- -- service_role receberam GRANT explícito equivalente. Se quiser o estado exato
-- -- anterior: grant execute on function <f> to public; para as funções listadas
-- -- nos NOTICEs da aplicação.
-- ═══════════════════════════════════════════════════════════════════════════
-- FIM
-- ═══════════════════════════════════════════════════════════════════════════
