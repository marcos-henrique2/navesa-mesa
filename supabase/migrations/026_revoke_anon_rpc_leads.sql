-- 026 — Fecha o furo de RLS nas RPCs de disparo de WhatsApp.
--
-- PROBLEMA (auditoria de 04/08/2026):
--   `fila_disparo_whatsapp` e `marcar_lead_contatado` foram criadas em 020 como
--   SECURITY DEFINER — ou seja, rodam com os privilégios do owner e IGNORAM o RLS.
--   O EXECUTE estava concedido ao papel `anon`, que é a chave pública embarcada no
--   bundle do navegador. Resultado: qualquer pessoa com a anon key chamava
--   POST /rest/v1/rpc/fila_disparo_whatsapp e recebia nome + telefone dos leads,
--   sem autenticação. A segunda função ainda faz UPDATE em leads/lead_interesses.
--
--   Confirmado no catálogo: pg_proc.prosecdef = true e
--   has_function_privilege('anon', oid, 'EXECUTE') = true para as duas.
--
-- CORREÇÃO:
--   Tira o EXECUTE de `anon` e de `public` (o grant implícito), e reafirma
--   explicitamente para `authenticated` e `service_role` — os papéis que o app
--   de fato usa. Usuário logado continua funcionando igual; anônimo perde acesso.
--
-- Idempotente: REVOKE e GRANT podem rodar quantas vezes for.

REVOKE EXECUTE ON FUNCTION public.fila_disparo_whatsapp(integer) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fila_disparo_whatsapp(integer) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.marcar_lead_contatado(bigint, text, bigint) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.marcar_lead_contatado(bigint, text, bigint) TO authenticated, service_role;
