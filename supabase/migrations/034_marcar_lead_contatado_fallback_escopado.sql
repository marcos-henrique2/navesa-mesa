-- 034 — marcar_lead_contatado: o fallback deixa de contaminar os carros vivos
--
-- PROBLEMA (latente desde a 020, tornado ALCANÇÁVEL pela 033)
-- ─────────────────────────────────────────────────────────────
-- Em marcar_lead_contatado (028:92-112), quando p_tipo='carro_visto' e o UPDATE
-- escopado em (lead_id, repasse_id) casa 0 linhas, o fallback marcava
-- **TODOS** os interesses pendentes daquele lead:
--
--     IF v_interesses_marcados = 0 THEN
--       UPDATE lead_interesses SET data_contato = v_hoje, ...
--        WHERE lead_id = p_lead_id AND data_contato IS NULL;   -- <== amplo demais
--
-- A intenção era boa: garantir que o lead saia da fila por 7 dias e não seja
-- redisparado. O problema é o alcance.
--
-- Por que a 033 tornou isso alcançável: antes, um repasse com interesse não
-- podia ser deletado (o CHECK abortava), então (lead_id, repasse_id) sempre
-- casava. Agora o repasse pode ser removido, e o repasse_id do interesse vira
-- NULL. O n8n lê (lead_id, repasse_id) da fila e chama esta RPC **depois**; se o
-- carro for removido nesse intervalo, o UPDATE escopado casa 0 e o fallback
-- marcava como contatado todos os outros carros daquele lojista.
--
-- Caso real: o lojista com 8 carros na lista teria os outros 7 marcados como
-- contatado por causa de um WhatsApp sobre o carro removido. Corrompe o
-- follow-up em silêncio — e follow-up é justamente o dado mais escasso aqui,
-- porque a conversa acontece no WhatsApp e quase nada volta pro sistema.
--
-- CORREÇÃO
-- ─────────────────────────────────────────────────────────────
-- O fallback passa a mirar só os interesses **órfãos** (repasse_id IS NULL com
-- tipo_carro='repasse'), que são exatamente os carros removidos. Preserva a
-- intenção original — o lead sai da fila — sem encostar em nenhum carro vivo.
--
-- Se o lead tiver interesse em dois carros removidos, os dois são marcados. É
-- aceitável: ambos são carros que não existem mais. Nenhum carro ativo é tocado
-- em nenhum cenário.
--
-- O ramo 'sondagem' NÃO muda: ali marcar todos é o comportamento pretendido
-- (sondagem não é sobre um carro específico).
--
-- Recriada IDÊNTICA à 028 fora isso. Mantém SECURITY DEFINER, search_path,
-- hoje_brasilia() e o contrato JSONB (o "Desfazer" do app depende de
-- `status_promovido` — ver src/lib/leads/contato.ts).
--
-- GRANTS: reafirmados ao fim. A 026 nasceu de vazamento de PII por RPC exposta
-- a anon; CREATE OR REPLACE preserva grants, mas deixar explícito é barato e
-- documenta a intenção.
--
-- Numeração: 034. As 030 e 032 pertencem a outra frente de trabalho e ainda não
-- foram aplicadas; 031 fica livre de propósito pra não fazê-las rodar fora de
-- ordem.

CREATE OR REPLACE FUNCTION marcar_lead_contatado(
  p_lead_id    BIGINT,
  p_tipo       TEXT,
  p_repasse_id BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_interesses_marcados INTEGER := 0;
  v_status_rows         INTEGER := 0;
  v_hoje                DATE    := public.hoje_brasilia();
BEGIN
  IF p_lead_id IS NULL THEN
    RAISE EXCEPTION 'p_lead_id é obrigatório';
  END IF;
  IF p_tipo IS NULL OR p_tipo NOT IN ('carro_visto','sondagem') THEN
    RAISE EXCEPTION 'p_tipo inválido (%): use ''carro_visto'' ou ''sondagem''', p_tipo;
  END IF;

  PERFORM 1 FROM leads WHERE id = p_lead_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lead % não existe', p_lead_id;
  END IF;

  IF p_tipo = 'carro_visto' AND p_repasse_id IS NOT NULL THEN
    -- Marca o interesse específico daquele carro.
    UPDATE lead_interesses
       SET data_contato    = v_hoje,
           status_followup = CASE WHEN status_followup = 'novo'
                                  THEN 'contatado' ELSE status_followup END
     WHERE lead_id = p_lead_id
       AND repasse_id = p_repasse_id;
    GET DIAGNOSTICS v_interesses_marcados = ROW_COUNT;

    -- Fallback ESCOPADO (034): o carro alvo não casou — quase sempre porque o
    -- repasse foi removido entre o enfileiramento e o disparo, e o interesse
    -- virou órfão (033). Marca só os órfãos, nunca os carros vivos do lead.
    IF v_interesses_marcados = 0 THEN
      UPDATE lead_interesses
         SET data_contato    = v_hoje,
             status_followup = CASE WHEN status_followup = 'novo'
                                    THEN 'contatado' ELSE status_followup END
       WHERE lead_id = p_lead_id
         AND data_contato IS NULL
         AND tipo_carro = 'repasse'
         AND repasse_id IS NULL;
      GET DIAGNOSTICS v_interesses_marcados = ROW_COUNT;
    END IF;
  ELSE
    -- 'sondagem' (ou carro_visto sem repasse): marca TODOS os interesses ainda
    -- não contatados. Aqui é intencional — sondagem não é sobre um carro.
    UPDATE lead_interesses
       SET data_contato    = v_hoje,
           status_followup = CASE WHEN status_followup = 'novo'
                                  THEN 'contatado' ELSE status_followup END
     WHERE lead_id = p_lead_id
       AND data_contato IS NULL;
    GET DIAGNOSTICS v_interesses_marcados = ROW_COUNT;
  END IF;

  UPDATE leads
     SET status_relacionamento = 'contatado'
   WHERE id = p_lead_id
     AND status_relacionamento = 'novo';
  GET DIAGNOSTICS v_status_rows = ROW_COUNT;

  RETURN jsonb_build_object(
    'lead_id',             p_lead_id,
    'tipo',                p_tipo,
    'repasse_id',          p_repasse_id,
    'interesses_marcados', v_interesses_marcados,
    'status_promovido',    (v_status_rows > 0),
    'data_contato',        v_hoje
  );
END;
$$;

COMMENT ON FUNCTION marcar_lead_contatado(BIGINT, TEXT, BIGINT) IS
  'Marca lead como contatado após disparo (n8n/app): seta data_contato (fuso de Brasília, '
  'via hoje_brasilia()) e status_followup nos interesses e promove '
  'leads.status_relacionamento de novo→contatado. Tira o lead da fila por 7 dias. '
  'O fallback de carro_visto mira só interesses órfãos (carro removido), nunca os ativos. '
  'SECURITY DEFINER, atômica. Retorna contagens em JSONB. Migrations 020 + 026 + 028 + 034.';

REVOKE EXECUTE ON FUNCTION public.marcar_lead_contatado(BIGINT, TEXT, BIGINT) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.marcar_lead_contatado(BIGINT, TEXT, BIGINT) TO authenticated, service_role;
