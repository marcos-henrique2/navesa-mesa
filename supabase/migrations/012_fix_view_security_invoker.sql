-- ═══════════════════════════════════════════════════════════════════════════
-- 012 — CORREÇÃO CRÍTICA DE SEGURANÇA
-- ═══════════════════════════════════════════════════════════════════════════
-- A view public.veiculos_atual foi criada SEM security_invoker, então rodava
-- como SECURITY DEFINER (privilégios do owner) e FURAVA o RLS da tabela base
-- `veiculos`. Resultado: a role `anon` (sem login — anon key é pública no
-- bundle JS do browser) conseguia ler 1.033 veículos com placa, chassi,
-- valor_aquisicao, custo_total e preco_venda. Custo e margem de cada carro
-- expostos pra internet inteira.
--
-- Fix: security_invoker = true faz a view respeitar o RLS de QUEM consulta.
-- A tabela `veiculos` já tem RLS habilitado com policy `authenticated_all_access`
-- USING (auth.uid() IS NOT NULL) só pra role `authenticated`. Não há policy
-- pra `anon`, então após o fix o anon vê 0 linhas. O app sempre lê logado
-- (authenticated), então não quebra nada.
--
-- ALTER VIEW (mudança mínima, não redefine o SELECT) — evita divergência.
-- Idempotente: SET (security_invoker = true) pode rodar N vezes sem erro.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER VIEW public.veiculos_atual SET (security_invoker = true);

-- ───────────────────────────────────────────────────────────────────────────
-- Hardening menor (advisor WARN function_search_path_mutable):
-- fixar search_path nas funções de trigger evita sequestro de resolução de
-- nomes via search_path mutável. Baixo risco — não altera o corpo da função,
-- só pina o resolver. Idempotente (ALTER FUNCTION ... SET pode rerodar).
-- ───────────────────────────────────────────────────────────────────────────

ALTER FUNCTION public.repasses_set_atualizado_em()        SET search_path = pg_catalog, public;
ALTER FUNCTION public.reprec_set_atualizado_em()          SET search_path = pg_catalog, public;
ALTER FUNCTION public.veiculos_flags_set_atualizado_em()  SET search_path = pg_catalog, public;
ALTER FUNCTION public.update_preco_alvo_atualizado_em()   SET search_path = pg_catalog, public;
