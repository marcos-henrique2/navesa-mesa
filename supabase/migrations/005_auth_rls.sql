-- Navesa Mesa — Sprint Deploy: Fechar RLS pra exigir login
-- Antes do deploy na Vercel, todas as policies abertas (mvp_all_access + auth_*)
-- precisam virar "apenas autenticados". Sem isso, qualquer um com a anon key
-- (que vai pro browser) lê/escreve tudo.
--
-- Decisões:
--   - Granularidade: 1 policy "for all" por tabela (cobre select+insert+update+delete).
--     Quando precisar segregar gerente vs vendedor, criamos policies específicas.
--   - Mantém RLS habilitado em todas as tabelas que já estavam.
--   - Idempotente: drop if exists + create. Roda 2x sem erro.
--   - Cobre policies herdadas de 001 ("auth_read_*", "auth_write_*") e de 002-004 ("mvp_all_access").
--
-- IMPORTANTE pro Marcos: depois de rodar, crie ao menos 1 usuário em
-- Authentication > Users no Supabase Dashboard, senão o app vai 401 em tudo.

-- ═══════════════════════════════════════════════════════════════════════════
-- LISTA DE TABELAS — mantida em sync com migrations 001..004
-- ═══════════════════════════════════════════════════════════════════════════
-- Se adicionar nova tabela no schema, lembre de incluir aqui também.

do $$
declare
  t text;
  -- Tabelas com RLS habilitado em 001..004
  tabelas text[] := array[
    'estoque_snapshots',          -- 002 (renomeada de "snapshots" da 001)
    'veiculos',                   -- 001/002
    'vendas',                     -- 002
    'custos_detalhados',          -- 002
    'cautelar',                   -- 002
    'fipe_cache',                 -- 001/002
    'fipe_batch',                 -- 002
    'kpi_snapshots',              -- 002
    'chat_messages',              -- 002
    'lojas',                      -- 001/002
    'vendedores',                 -- 002
    'sugestoes_preco',            -- 001 (mantida por segurança, caso schema legado ainda exista)
    'reprecificacao_sugerida',    -- 003
    'preco_alvo'                  -- 004
  ];
  -- Policies antigas conhecidas (precisam ser dropadas antes de recriar limpo)
  policies_legadas text[] := array[
    'mvp_all_access',
    'auth_read_lojas','auth_write_lojas',
    'auth_read_snapshots','auth_write_snapshots',
    'auth_read_veiculos','auth_write_veiculos',
    'auth_read_fipe','auth_write_fipe',
    'auth_read_sugestoes','auth_write_sugestoes'
  ];
  p text;
begin
  foreach t in array tabelas
  loop
    -- Só age se a tabela existe (evita erro em ambiente que pulou alguma migration)
    if exists (select 1 from pg_class where relname = t and relkind = 'r') then
      -- Garante RLS ligado (defensivo — 001..004 já habilitam, mas alguém pode ter desligado manual)
      execute format('alter table %I enable row level security', t);

      -- Dropa policies legadas conhecidas (idempotente)
      foreach p in array policies_legadas
      loop
        execute format('drop policy if exists %I on %I', p, t);
      end loop;

      -- Dropa a policy nova também, pra permitir rerun limpo
      execute format('drop policy if exists "authenticated_all_access" on %I', t);

      -- Cria policy única: apenas usuários autenticados (auth.uid() not null)
      -- "to authenticated" já restringe ao role authenticated; using/with check redundantes mas explícitos.
      execute format(
        'create policy "authenticated_all_access" on %I '
        'for all to authenticated '
        'using (auth.uid() is not null) '
        'with check (auth.uid() is not null)',
        t
      );
    end if;
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO (rode manualmente após aplicar)
-- ═══════════════════════════════════════════════════════════════════════════
-- select schemaname, tablename, policyname, roles, cmd
-- from pg_policies
-- where schemaname = 'public'
-- order by tablename;
--
-- Esperado: 1 linha por tabela, policyname='authenticated_all_access',
-- roles={authenticated}, cmd=ALL. Nenhuma policy "mvp_all_access" ou "auth_*" remanescente.

-- ═══════════════════════════════════════════════════════════════════════════
-- FIM
-- ═══════════════════════════════════════════════════════════════════════════
