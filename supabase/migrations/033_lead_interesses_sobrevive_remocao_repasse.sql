-- 033 — lead_interesses sobrevive à remoção do repasse
--
-- PROBLEMA (bug pré-existente, veio à tona em 12/08/2026)
-- ─────────────────────────────────────────────────────────
-- Remover um repasse que tenha lead interessado era IMPOSSÍVEL:
--
--   FK   lead_interesses.repasse_id -> repasses(id) ON DELETE SET NULL
--   CHK  chk_carro_presente (018_leads_crm.sql:81-84):
--          (tipo_carro='repasse' AND repasse_id IS NOT NULL AND chassi IS NULL)
--          OR (tipo_carro='estoque' AND chassi IS NOT NULL AND repasse_id IS NULL)
--
-- O DELETE dispara o SET NULL, a linha continua com tipo_carro='repasse' e
-- repasse_id nulo, o CHECK reprova e a transação inteira aborta:
--
--   new row for relation "lead_interesses" violates check constraint
--   "chk_carro_presente"
--
-- Atingia o botão "Remover" de RepassesLista.tsx desde a 018 — nunca apareceu
-- porque ninguém tinha removido um carro com interessado.
--
-- DECISÃO (do Marcos, 12/08/2026): PRESERVAR O HISTÓRICO.
-- ─────────────────────────────────────────────────────────
-- Os 8 carros da primeira tentativa de remoção carregavam 58 interesses — o
-- registro de quem procurou aqueles carros. Esse histórico é escasso: o
-- follow-up acontece no WhatsApp e quase nada volta pro sistema. Apagá-lo como
-- efeito colateral de "remover carro" seria a pior das saídas.
--
-- Alternativas descartadas:
--   CASCADE          -> destruiria os 58. Rejeitado pelo Marcos.
--   bloquear DELETE  -> mantém o histórico mas trava o fluxo de limpeza.
--
-- O que torna o órfão aceitável: `modelo_snapshot` é NOT NULL e guarda o nome
-- do carro no momento do interesse (018:69). Um interesse sem repasse_id ainda
-- diz "fulano se interessou na Ranger 3.2 XLT" — degrada o vínculo, não o fato.
--
-- O QUE MUDA
-- ─────────────────────────────────────────────────────────
-- Só o ramo 'repasse' do CHECK deixa de exigir repasse_id NOT NULL.
-- O ramo 'estoque' fica intacto — chassi continua obrigatório e repasse_id
-- continua proibido, então "estoque" nunca vira órfão por esse caminho.
--
-- NÃO altera a FK: ON DELETE SET NULL continua sendo o comportamento certo.
-- NÃO altera 028 (fluxo de texto) nem 029 (sync do arquivo).
--
-- Numeração: 033 e não 031 porque 030 e 032 existem no working tree de outra
-- frente de trabalho e ainda não foram aplicadas. Ocupar 031 faria elas
-- rodarem fora de ordem depois.
--
-- Idempotente: DROP IF EXISTS + ADD.

BEGIN;

ALTER TABLE public.lead_interesses
  DROP CONSTRAINT IF EXISTS chk_carro_presente;

ALTER TABLE public.lead_interesses
  ADD CONSTRAINT chk_carro_presente CHECK (
    -- repasse: chassi continua proibido; repasse_id pode ser NULL (carro removido)
    (tipo_carro = 'repasse' AND chassi IS NULL)
    -- estoque: inalterado
    OR (tipo_carro = 'estoque' AND chassi IS NOT NULL AND repasse_id IS NULL)
  );

COMMENT ON CONSTRAINT chk_carro_presente ON public.lead_interesses IS
  'Coerência do carro. repasse: chassi sempre NULL; repasse_id NULL = carro '
  'removido do sistema (o interesse sobrevive via modelo_snapshot). '
  'estoque: chassi obrigatório, repasse_id sempre NULL. Ver migration 033.';

COMMIT;
