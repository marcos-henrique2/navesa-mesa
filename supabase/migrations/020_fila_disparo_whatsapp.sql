-- Navesa Mesa — Migration 020: Fila de disparo controlado de WhatsApp (n8n + Evolution)
-- =====================================================================================
-- Base de banco para automação de follow-up via n8n + Evolution API.
--
-- Fluxo:
--   1. O n8n chama fila_disparo_whatsapp() (RPC) → recebe os leads a contatar HOJE,
--      já segmentados ('carro_visto' | 'sondagem'), deduplicados (1 linha por lead).
--   2. O n8n dispara a mensagem no WhatsApp via Evolution.
--   3. Após sucesso, o n8n chama marcar_lead_contatado() → o lead sai da fila pelos
--      próximos 7 dias (data_contato setada) e o status_relacionamento vira 'contatado'.
--
-- Princípios:
--   - 100% idempotente: CREATE OR REPLACE FUNCTION + CREATE INDEX IF NOT EXISTS.
--   - NÃO dropa nada. NÃO mexe em veiculos_atual nem em outras tabelas.
--   - SECURITY DEFINER + SET search_path = public: o n8n chama via service_role pela
--     REST; DEFINER garante acesso consistente e isola o search_path (segurança).
--   - timestamptz/date conforme padrão do projeto.
--
-- Tabelas usadas (criadas na migration 018):
--   leads(id, nome, telefone_whatsapp, status_relacionamento, ...)
--   lead_interesses(id, lead_id, repasse_id, modelo_snapshot, origem,
--                   qtd_visualizacoes, data_contato, status_followup, ...)
--   repasses(id, modelo, ...)
--
-- Regras de negócio:
--   * Só leads com telefone_whatsapp IS NOT NULL.
--   * EXCLUIR lead já "em tratativa": status_relacionamento ∈
--     ('respondeu','negociando','fechou','perdido').
--   * EXCLUIR lead contatado nos últimos 7 dias: existe algum lead_interesses.data_contato
--     >= current_date - 7 para esse lead.
--   * Fila A 'carro_visto': lead que viu (origem='visualizou') ao menos 1 repasse cujo
--     TOTAL de views (SUM(qtd_visualizacoes) de TODOS os interesses 'visualizou' daquele
--     repasse_id, somando todos os leads) seja >= 5; E o lead nunca foi contatado
--     (data_contato IS NULL em TODOS os interesses dele). Escolhe o carro de MAIOR total
--     de views que ele viu.
--   * Fila B 'sondagem': lead que NÃO se qualifica pra A, mas é recorrente
--     (SUM(qtd_visualizacoes) de TODOS os interesses do lead >= 2). Sem carro específico.
--   * Dedup: 1 linha por lead. 'carro_visto' tem prioridade sobre 'sondagem'.
--   * Ordenação: carro_visto primeiro, depois qtd_views_carro DESC. LIMIT p_limite.
-- =====================================================================================


-- ─────────────────────────────────────────────────────────────────────────────────────
-- Índices de apoio (a fila roda agregações por repasse_id e filtros por origem/data_contato)
-- Volume é baixo, mas índice barato evita seq scan desnecessário quando a base crescer.
-- ─────────────────────────────────────────────────────────────────────────────────────
-- Agregação "total de views por repasse" (origem='visualizou').
CREATE INDEX IF NOT EXISTS idx_lead_interesses_repasse_visualizou
  ON lead_interesses(repasse_id)
  WHERE origem = 'visualizou' AND repasse_id IS NOT NULL;
-- Checagem de "contatado nos últimos 7 dias" e de "nunca contatado".
CREATE INDEX IF NOT EXISTS idx_lead_interesses_lead_data_contato
  ON lead_interesses(lead_id, data_contato);


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 1. FUNÇÃO fila_disparo_whatsapp(p_limite INTEGER DEFAULT 30) → TABLE
-- =====================================================================================
-- Retorna a fila de disparo de HOJE, segmentada e deduplicada (1 linha por lead),
-- já ordenada (carro_visto > sondagem; views DESC) e limitada a p_limite.
--
-- Estrutura interna (CTEs):
--   elegiveis        → leads com whatsapp e fora de tratativa/contato recente (7 dias).
--   views_por_repasse→ total de views (SUM qtd_visualizacoes, origem='visualizou')
--                      agregado POR repasse_id (somando todos os leads). É o "hype" do carro.
--   nunca_contatado  → leads sem NENHUM data_contato (pré-condição da Fila A).
--   fila_a           → 'carro_visto': lead elegível + nunca contatado, que viu um repasse
--                      com total de views >= 5. Pega o carro de MAIOR total de views (DISTINCT ON).
--   recorrencia_lead → SUM(qtd_visualizacoes) de TODOS os interesses do lead.
--   fila_b           → 'sondagem': lead elegível, recorrente (soma >= 2), que NÃO entrou na A.
--
-- O LIMIT é aplicado APÓS a ordenação global (todos os carro_visto antes dos sondagem),
-- garantindo que a Fila A nunca seja "cortada" por leads de sondagem.
-- =====================================================================================
CREATE OR REPLACE FUNCTION fila_disparo_whatsapp(p_limite INTEGER DEFAULT 30)
RETURNS TABLE (
  lead_id           BIGINT,
  nome              TEXT,
  telefone_whatsapp TEXT,
  tipo              TEXT,      -- 'carro_visto' | 'sondagem'
  repasse_id        BIGINT,    -- NULL para 'sondagem'
  modelo_carro      TEXT,      -- NULL para 'sondagem'
  qtd_views_carro   INTEGER    -- views do carro escolhido (A); 0 para 'sondagem'
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH elegiveis AS (
    -- Leads contatáveis: têm whatsapp, não estão em tratativa, e não foram
    -- contatados nos últimos 7 dias (em nenhum interesse).
    SELECT l.id, l.nome, l.telefone_whatsapp
    FROM leads l
    WHERE l.telefone_whatsapp IS NOT NULL
      AND l.status_relacionamento NOT IN ('respondeu','negociando','fechou','perdido')
      AND NOT EXISTS (
        SELECT 1 FROM lead_interesses li
        WHERE li.lead_id = l.id
          AND li.data_contato IS NOT NULL
          AND li.data_contato >= current_date - 7
      )
  ),
  views_por_repasse AS (
    -- "Hype" de cada carro = soma das visualizações de TODOS os leads naquele repasse.
    SELECT li.repasse_id,
           SUM(li.qtd_visualizacoes)::INTEGER AS total_views
    FROM lead_interesses li
    WHERE li.origem = 'visualizou'
      AND li.repasse_id IS NOT NULL
    GROUP BY li.repasse_id
  ),
  nunca_contatado AS (
    -- Leads SEM nenhum data_contato (pré-condição da Fila A: lead "virgem").
    SELECT e.id
    FROM elegiveis e
    WHERE NOT EXISTS (
      SELECT 1 FROM lead_interesses li
      WHERE li.lead_id = e.id
        AND li.data_contato IS NOT NULL
    )
  ),
  fila_a AS (
    -- 'carro_visto': para cada lead nunca-contatado, o repasse de MAIOR total_views
    -- que ele viu, desde que esse total seja >= 5. DISTINCT ON garante 1 carro por lead.
    SELECT DISTINCT ON (e.id)
      e.id                                   AS lead_id,
      e.nome,
      e.telefone_whatsapp,
      'carro_visto'::TEXT                    AS tipo,
      li.repasse_id,
      COALESCE(r.modelo, li.modelo_snapshot) AS modelo_carro,
      vpr.total_views                        AS qtd_views_carro
    FROM elegiveis e
    JOIN nunca_contatado nc    ON nc.id = e.id
    JOIN lead_interesses li    ON li.lead_id = e.id
                              AND li.origem = 'visualizou'
                              AND li.repasse_id IS NOT NULL
    JOIN views_por_repasse vpr ON vpr.repasse_id = li.repasse_id
                              AND vpr.total_views >= 5
    LEFT JOIN repasses r       ON r.id = li.repasse_id
    ORDER BY e.id, vpr.total_views DESC, li.repasse_id  -- repasse_id desempata determinístico
  ),
  recorrencia_lead AS (
    -- Recorrência total do lead (soma de TODAS as visualizações dele, qualquer carro).
    SELECT e.id,
           COALESCE(SUM(li.qtd_visualizacoes), 0)::INTEGER AS total_views_lead
    FROM elegiveis e
    LEFT JOIN lead_interesses li ON li.lead_id = e.id
    GROUP BY e.id
  ),
  fila_b AS (
    -- 'sondagem': lead recorrente (>= 2 no total) que NÃO entrou na Fila A. Sem carro.
    SELECT
      e.id              AS lead_id,
      e.nome,
      e.telefone_whatsapp,
      'sondagem'::TEXT  AS tipo,
      NULL::BIGINT      AS repasse_id,
      NULL::TEXT        AS modelo_carro,
      0::INTEGER        AS qtd_views_carro
    FROM elegiveis e
    JOIN recorrencia_lead rl ON rl.id = e.id AND rl.total_views_lead >= 2
    WHERE e.id NOT IN (SELECT lead_id FROM fila_a)
  )
  SELECT
    f.lead_id,
    f.nome,
    f.telefone_whatsapp,
    f.tipo,
    f.repasse_id,
    f.modelo_carro,
    f.qtd_views_carro
  FROM (
    SELECT * FROM fila_a
    UNION ALL
    SELECT * FROM fila_b
  ) f
  ORDER BY
    CASE f.tipo WHEN 'carro_visto' THEN 0 ELSE 1 END,  -- carro_visto primeiro
    f.qtd_views_carro DESC,
    f.lead_id                                            -- desempate determinístico
  LIMIT GREATEST(p_limite, 0)
$$;

COMMENT ON FUNCTION fila_disparo_whatsapp(INTEGER) IS
  'Fila de disparo WhatsApp do dia, segmentada (carro_visto|sondagem) e deduplicada (1 linha/lead). Ordena carro_visto>sondagem e por views DESC, com LIMIT p_limite. Exclui tratativa e contato <7 dias. SECURITY DEFINER. Chamada pelo n8n via RPC.';


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 2. FUNÇÃO marcar_lead_contatado(p_lead_id, p_tipo, p_repasse_id DEFAULT NULL) → JSONB
-- =====================================================================================
-- Chamada pelo n8n DEPOIS de disparar com sucesso. Tira o lead da fila por 7 dias.
--
-- Efeito (atômico):
--   * tipo='carro_visto' COM p_repasse_id → marca data_contato=current_date e
--     status_followup='contatado' no interesse (lead_id, repasse_id) específico.
--     Se nenhum interesse casar (carro já não existe?), faz fallback: marca todos
--     os interesses do lead com data_contato NULL (garante saída da fila por 7 dias).
--   * tipo='sondagem' (ou sem p_repasse_id) → marca data_contato=current_date e
--     status_followup='contatado' em TODOS os interesses do lead que ainda têm
--     data_contato NULL. Isso ativa a exclusão de 7 dias da fila.
--   * leads.status_relacionamento: vira 'contatado' apenas se ainda for 'novo'
--     (não rebaixa quem já avançou no funil).
--
-- Retorna JSONB com contagens, para o n8n logar/validar.
-- =====================================================================================
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
       SET data_contato    = current_date,
           status_followup = CASE WHEN status_followup = 'novo'
                                  THEN 'contatado' ELSE status_followup END
     WHERE lead_id = p_lead_id
       AND repasse_id = p_repasse_id;
    GET DIAGNOSTICS v_interesses_marcados = ROW_COUNT;

    -- Fallback: se o carro alvo não existe mais como interesse, ainda assim tira
    -- o lead da fila marcando os interesses sem data_contato.
    IF v_interesses_marcados = 0 THEN
      UPDATE lead_interesses
         SET data_contato    = current_date,
             status_followup = CASE WHEN status_followup = 'novo'
                                    THEN 'contatado' ELSE status_followup END
       WHERE lead_id = p_lead_id
         AND data_contato IS NULL;
      GET DIAGNOSTICS v_interesses_marcados = ROW_COUNT;
    END IF;
  ELSE
    -- 'sondagem' (ou carro_visto sem repasse): marca TODOS os interesses ainda
    -- não contatados. Garante que o lead saia da fila pelos próximos 7 dias.
    UPDATE lead_interesses
       SET data_contato    = current_date,
           status_followup = CASE WHEN status_followup = 'novo'
                                  THEN 'contatado' ELSE status_followup END
     WHERE lead_id = p_lead_id
       AND data_contato IS NULL;
    GET DIAGNOSTICS v_interesses_marcados = ROW_COUNT;
  END IF;

  -- Promove o lead a 'contatado' só se ainda estiver 'novo'.
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
    'data_contato',        current_date
  );
END;
$$;

COMMENT ON FUNCTION marcar_lead_contatado(BIGINT, TEXT, BIGINT) IS
  'Marca lead como contatado após disparo (n8n): seta data_contato/status_followup nos interesses (carro específico ou todos NULL) e promove leads.status_relacionamento de novo→contatado. Tira o lead da fila por 7 dias. SECURITY DEFINER, atômica. Retorna contagens em JSONB.';


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 3. GRANTS — o n8n chama via service_role (bypassa RLS); a função roda como owner.
--    Mantemos grant a authenticated também, caso o app queira pré-visualizar a fila.
-- ─────────────────────────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION fila_disparo_whatsapp(INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION marcar_lead_contatado(BIGINT, TEXT, BIGINT) TO authenticated, service_role;

-- =====================================================================================
-- FIM da migration 020
-- =====================================================================================
