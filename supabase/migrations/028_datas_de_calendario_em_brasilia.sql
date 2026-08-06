-- Navesa Mesa — Migration 028: datas de CALENDÁRIO passam a usar o fuso de Brasília
-- =====================================================================================
-- PROBLEMA
--   `SHOW TimeZone` no projeto devolve `UTC`. Logo, entre 21h e a meia-noite de
--   Brasília (UTC−3) o `current_date` do banco JÁ É O DIA SEGUINTE.
--
--   Toda coluna `date` que representa um DIA DO CALENDÁRIO DE QUEM USA O SISTEMA
--   ("falei com o lojista hoje", "o carro subiu hoje", "esse gasto é de hoje") e que
--   é gravada com `current_date` nasce um dia à frente quando escrita nesse intervalo.
--   É exatamente o mesmo bug que `new Date().toISOString().slice(0,10)` causava no
--   lado do app e que já foi corrigido em `src/lib/utils/data-local.ts` (hojeLocal).
--   Ele é silencioso: ninguém vê o erro, ele só desloca o número em 1 dia — e "dias
--   parados" é a métrica principal da mesa.
--
-- DECISÃO (Marcos, 06/08/2026)
--   NÃO mudar o TimeZone do banco. Isso reescreveria o significado de toda query e
--   comparação existente de uma vez, sem análise de impacto. A correção é CIRÚRGICA:
--   só onde o valor representa dia de calendário do usuário.
--
--   O helper `public.hoje_brasilia()` foi criado na migration 027 (é a primeira que
--   precisa dele). Aqui ele é reutilizado.
--
-- ESCOPO — o que muda e o que NÃO muda
--   ✅ marcar_lead_contatado (020)          → data_contato (3 UPDATEs + retorno JSONB)
--   ✅ importar_repasse_auto_avaliar (025)  → data_subiu/data_subido do INSERT e
--                                             repasse_gastos.data (2 INSERTs)
--   ✅ repasses.data_subiu       (default de coluna, 008)
--   ✅ repasse_gastos.data       (default de coluna, 008)
--   ✅ fila_disparo_whatsapp (020)          → janela de 7 dias (ver §4, com ressalva)
--
--   ❌ `atualizado_em`/`criado_em` (now(), timestamptz)  → INSTANTE técnico. O ponto
--      absoluto no tempo é exatamente o que se quer; converter seria o bug ao contrário.
--   ❌ Comparações de `timestamptz` em geral                 → mesma razão.
--   ❌ `data_vendido` vindo do payload da reconciliação      → data que o USUÁRIO
--      informou, não "hoje". Nada a converter.
--
-- IDEMPOTENTE: CREATE OR REPLACE FUNCTION / ALTER COLUMN SET DEFAULT / REVOKE+GRANT.
-- Não dropa nada, não altera assinatura de função nenhuma, não faz backfill de dado
-- histórico (o passado não tem como ser desambiguado retroativamente).
-- =====================================================================================


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 1. marcar_lead_contatado — data do contato com o lead
-- =====================================================================================
-- Recriada IDÊNTICA à migration 020, trocando só `current_date` por
-- `public.hoje_brasilia()`. Assinatura (BIGINT, TEXT, BIGINT), SECURITY DEFINER e
-- `SET search_path = public` preservados.
--
-- Este é o caso de MAIOR impacto real: a RPC é chamada pelo app quando Marcos clica
-- no botão de WhatsApp (src/lib/leads/contato.ts). Um contato às 21h30 gravava a data
-- de amanhã — e a UI, que já mostra `hojeLocal()` otimisticamente, exibia hoje. Duas
-- verdades diferentes pro mesmo clique.
--
-- Efeito colateral bom: a janela de "não recontatar por 7 dias" (§4) passa a comparar
-- duas datas escritas na MESMA régua.
--
-- GRANTS: `CREATE OR REPLACE FUNCTION` preserva as permissões existentes, mas o §5
-- reafirma explicitamente — `authenticated` e `service_role`, NUNCA `anon`
-- (revogado na 026 por vazamento de PII: nome + telefone via anon key do bundle).
-- ─────────────────────────────────────────────────────────────────────────────────────
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
  -- Fixa "hoje" UMA vez no início: os 3 caminhos de UPDATE e o retorno JSONB precisam
  -- concordar. hoje_brasilia() é STABLE (não muda dentro da transação), então isso é
  -- redundância barata — mas deixa explícito que é UMA data, não três leituras.
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

    -- Fallback: se o carro alvo não existe mais como interesse, ainda assim tira
    -- o lead da fila marcando os interesses sem data_contato.
    IF v_interesses_marcados = 0 THEN
      UPDATE lead_interesses
         SET data_contato    = v_hoje,
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
       SET data_contato    = v_hoje,
           status_followup = CASE WHEN status_followup = 'novo'
                                  THEN 'contatado' ELSE status_followup END
     WHERE lead_id = p_lead_id
       AND data_contato IS NULL;
    GET DIAGNOSTICS v_interesses_marcados = ROW_COUNT;
  END IF;

  -- Promove o lead a 'contatado' só se ainda estiver 'novo'.
  -- `status_promovido` no retorno é o que o "Desfazer" do app usa pra saber se
  -- precisa rebaixar de volta pra 'novo' (src/lib/leads/contato.ts).
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
  'via hoje_brasilia()) e status_followup nos interesses (carro específico ou todos NULL) e '
  'promove leads.status_relacionamento de novo→contatado. Tira o lead da fila por 7 dias. '
  'SECURITY DEFINER, atômica. Retorna contagens em JSONB. Migrations 020 + 026 + 028.';


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 2. importar_repasse_auto_avaliar — datas do importador
-- =====================================================================================
-- Recriada IDÊNTICA à migration 025, trocando só `current_date` por
-- `public.hoje_brasilia()` em 3 pontos:
--   a) repasse_gastos.data no INSERT do caminho "atualizar";
--   b) repasses.data_subiu + repasses.data_subido no INSERT do caminho "criar";
--   c) repasse_gastos.data no INSERT do caminho "criar".
--
-- Todos os três são dia de calendário: "o gasto é de hoje", "o carro subiu hoje".
-- `atualizado_em = now()` NÃO muda — é timestamptz, instante técnico.
--
-- Assinatura (JSONB), SECURITY INVOKER e `SET search_path = public` preservados.
-- SECURITY INVOKER importa: a RPC continua respeitando o RLS de quem chama.
-- ─────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION importar_repasse_auto_avaliar(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_item        JSONB;
  v_reg         JSONB;
  v_acao        TEXT;
  v_placa_norm  TEXT;
  v_chassi      TEXT;
  v_gastos      NUMERIC(12,2);
  v_target      BIGINT;      -- id que recebe o UPDATE (atualizar OU criar-matched)
  v_do_insert   BOOLEAN;
  v_new_id      BIGINT;
  v_cnt         INTEGER;
  v_novo_status TEXT;

  v_criados     INTEGER := 0;
  v_atualizados INTEGER := 0;
  v_rec_vend    INTEGER := 0;
  v_rec_marc    INTEGER := 0;
  v_conflitos   INTEGER := 0;

  -- "Hoje" fixado uma vez: uma importação inteira roda numa transação só e não pode
  -- ficar meio ontem meio hoje se atravessar a meia-noite de Brasília.
  v_hoje        DATE    := public.hoje_brasilia();
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'p_payload deve ser um objeto JSONB';
  END IF;

  -- ── ITENS (criar / atualizar) ──────────────────────────────────────────────────────
  IF jsonb_typeof(p_payload->'itens') = 'array' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload->'itens')
    LOOP
      v_acao := v_item->>'acao';
      v_reg  := v_item->'registro';
      IF v_reg IS NULL OR jsonb_typeof(v_reg) <> 'object' THEN
        CONTINUE;  -- item malformado, ignora defensivamente
      END IF;

      v_placa_norm := NULLIF(trim(v_reg->>'placa_norm'), '');
      v_chassi     := NULLIF(trim(v_item->>'chassi'), '');
      v_gastos     := COALESCE(NULLIF(v_reg->>'gastos', '')::numeric, 0);

      v_target    := NULL;
      v_do_insert := FALSE;

      IF v_acao = 'atualizar' THEN
        v_target := NULLIF(v_item->>'repasse_id', '')::bigint;

      ELSIF v_acao = 'criar' THEN
        -- Match defensivo por placa_norm em repasse ATIVO (usa idx_repasses_placa_norm).
        IF v_placa_norm IS NOT NULL THEN
          SELECT id INTO v_target
          FROM repasses
          WHERE regexp_replace(upper(placa), '[^A-Z0-9]', '', 'g') = v_placa_norm
            AND status IN ('marcado', 'subido')
          ORDER BY id
          LIMIT 1;
        END IF;

        IF v_target IS NULL THEN
          -- Não achou por placa → vai inserir, salvo conflito de chassi ativo.
          IF v_chassi IS NULL THEN
            -- chassi é NOT NULL na tabela; sem ele não dá pra criar → conta conflito.
            v_conflitos := v_conflitos + 1;
            CONTINUE;
          END IF;
          -- Chassi já tem repasse ativo (placa divergente, senão o match acima acharia)?
          PERFORM 1 FROM repasses
          WHERE chassi = v_chassi AND status IN ('marcado', 'subido')
          LIMIT 1;
          IF FOUND THEN
            v_conflitos := v_conflitos + 1;
            CONTINUE;
          END IF;
          v_do_insert := TRUE;
        END IF;

      ELSE
        CONTINUE;  -- acao desconhecida, ignora
      END IF;

      -- ── UPDATE compartilhado (atualizar OU criar-matched) ────────────────────────────
      IF v_target IS NOT NULL THEN
        UPDATE repasses SET
          valor_compra_repasse = NULLIF(v_reg->>'valor_compra', '')::numeric,
          valor_minimo         = NULLIF(v_reg->>'minimo', '')::numeric,
          valor_compre_por     = NULLIF(v_reg->>'compre_por', '')::numeric,
          valor_auto_avaliar   = NULLIF(v_reg->>'media_aa', '')::numeric,
          valor_fipe           = NULLIF(v_reg->>'media_fipe', '')::numeric,
          valor_web            = NULLIF(v_reg->>'media_web', '')::numeric,
          atualizado_em        = now()   -- timestamptz: instante técnico, NÃO converter
        WHERE id = v_target;              -- NÃO toca valor_aquisicao (custo do sistema/NBS)
        GET DIAGNOSTICS v_cnt = ROW_COUNT;

        IF v_cnt > 0 THEN
          v_atualizados := v_atualizados + 1;
          -- Gasto Auto Avaliar em sync com a planilha: DELETE INCONDICIONAL do tipo
          -- 'auto_avaliar' (se gastos caiu pra 0, o gasto some) + INSERT só quando
          -- gastos>0. Escopo tipo='auto_avaliar' => preserva gastos de OUTROS tipos.
          DELETE FROM repasse_gastos
          WHERE repasse_id = v_target AND tipo = 'auto_avaliar';
          IF v_gastos > 0 THEN
            INSERT INTO repasse_gastos (repasse_id, tipo, descricao, valor, data)
            VALUES (v_target, 'auto_avaliar', 'Gastos Auto Avaliar', v_gastos, v_hoje);
          END IF;
        END IF;
      END IF;

      -- ── INSERT (criar novo) ──────────────────────────────────────────────────────────
      IF v_do_insert THEN
        BEGIN
          INSERT INTO repasses (
            chassi, placa, modelo, cor, ano_modelo, km,
            canal, status, data_subiu, data_subido,
            valor_compra_repasse, valor_minimo, valor_compre_por,
            valor_auto_avaliar, valor_fipe, valor_web
          )
          VALUES (
            v_chassi,
            v_placa_norm,
            v_reg->>'modelo',
            NULLIF(v_reg->>'cor', ''),
            NULLIF(v_reg->>'ano_modelo', '')::integer,
            NULLIF(v_reg->>'km', '')::integer,
            -- veio do Auto Avaliar => efetivamente no ar: data_subido = hoje (Brasília)
            'auto_avaliar', 'subido', v_hoje, v_hoje,
            NULLIF(v_reg->>'valor_compra', '')::numeric,
            NULLIF(v_reg->>'minimo', '')::numeric,
            NULLIF(v_reg->>'compre_por', '')::numeric,
            NULLIF(v_reg->>'media_aa', '')::numeric,
            NULLIF(v_reg->>'media_fipe', '')::numeric,
            NULLIF(v_reg->>'media_web', '')::numeric
          )
          RETURNING id INTO v_new_id;

          v_criados := v_criados + 1;

          IF v_gastos > 0 THEN
            INSERT INTO repasse_gastos (repasse_id, tipo, descricao, valor, data)
            VALUES (v_new_id, 'auto_avaliar', 'Gastos Auto Avaliar', v_gastos, v_hoje);
          END IF;
        EXCEPTION WHEN unique_violation THEN
          -- Corrida contra repasses_chassi_ativo_uniq → não estoura, conta conflito.
          v_conflitos := v_conflitos + 1;
        END;
      END IF;
    END LOOP;
  END IF;

  -- ── RECONCILIAÇÃO (vendido / marcado) ────────────────────────────────────────────────
  IF jsonb_typeof(p_payload->'reconciliacao') = 'array' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload->'reconciliacao')
    LOOP
      v_target      := NULLIF(v_item->>'repasse_id', '')::bigint;
      v_novo_status := v_item->>'novo_status';

      IF v_target IS NULL OR v_novo_status NOT IN ('vendido', 'marcado') THEN
        CONTINUE;  -- defensivo
      END IF;

      -- GUARDA no WHERE: só mexe em auto_avaliar que está subido.
      -- `data_vendido` vem do PAYLOAD (data que o usuário informou), não de "hoje" —
      -- nada a converter aqui.
      UPDATE repasses SET
        status       = v_novo_status,
        data_vendido = CASE WHEN v_novo_status = 'vendido'
                            THEN NULLIF(v_item->>'data_vendido', '')::date
                            ELSE data_vendido END,
        valor_vendido = CASE WHEN v_novo_status = 'vendido'
                             THEN NULLIF(v_item->>'valor_vendido', '')::numeric
                             ELSE valor_vendido END,
        atualizado_em = now()
      WHERE id = v_target
        AND canal = 'auto_avaliar'
        AND status = 'subido';
      GET DIAGNOSTICS v_cnt = ROW_COUNT;

      IF v_cnt > 0 THEN
        IF v_novo_status = 'vendido' THEN
          v_rec_vend := v_rec_vend + 1;
        ELSE
          v_rec_marc := v_rec_marc + 1;
        END IF;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'criados',                 v_criados,
    'atualizados',             v_atualizados,
    'reconciliados_vendidos',  v_rec_vend,
    'reconciliados_marcados',  v_rec_marc,
    'conflitos',               v_conflitos
  );
END;
$$;

COMMENT ON FUNCTION importar_repasse_auto_avaliar(JSONB) IS
  'Fatia 2: aplica (não recalcula) o snapshot decidido pelo preview do importador Auto Avaliar. '
  'SECURITY INVOKER, atômica, idempotente. Payload JSONB {itens, reconciliacao} → JSONB de contagens. '
  'Datas de calendário (data_subiu/data_subido/gasto) via hoje_brasilia(). Migrations 025 + 028.';


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 3. DEFAULTS DE COLUNA — o mesmo bug, pelo caminho mais silencioso de todos
-- =====================================================================================
-- `createRepasse` (src/lib/repasses/queries.ts) NÃO passa `data_subiu` no INSERT: ele
-- depende do DEFAULT da coluna. E `data_subiu` é lido como `data_marcado` na UI e entra
-- em `calcularDiasNoRepasse`. Ou seja: marcar um carro pra repasse às 21h30 gravava
-- amanhã, e "dias em repasse" nascia com 1 dia de erro — pelo caminho que ninguém
-- inspeciona, porque não tem código escrito.
--
-- Mesma coisa em `repasse_gastos.data`: o INSERT manual de gasto na UI depende do
-- default. É a data do gasto no calendário, não um instante.
--
-- ALTER COLUMN ... SET DEFAULT não reescreve tabela e não toca em linha existente —
-- é só metadado. Rápido e sem lock pesado.
-- ─────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE repasses       ALTER COLUMN data_subiu SET DEFAULT public.hoje_brasilia();
ALTER TABLE repasse_gastos ALTER COLUMN data       SET DEFAULT public.hoje_brasilia();


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 4. fila_disparo_whatsapp — a janela de 7 dias
-- =====================================================================================
-- ⚠️ FORA dos 3 itens pedidos. Incluído porque deixar de fora quebra a simetria que o
--    resto da migration cria — e a assimetria é justamente onde bug de fuso mora.
--    Se preferir, esta seção pode ser removida isoladamente: o resto não depende dela.
--
-- O `current_date` daqui NÃO é uma data sendo gravada — é o lado direito de uma
-- comparação: `li.data_contato >= current_date - 7`. Poderia passar por "janela de
-- tempo técnica". Não é: `data_contato` é uma coluna `date` que, a partir do §1, passa
-- a ser SEMPRE escrita no calendário de Brasília. Comparar uma régua com a outra é o
-- bug, não a solução.
--
-- Efeito concreto de deixar como estava: um disparo rodando às 22h de Brasília leria
-- `current_date` = amanhã, e o piso da janela viraria (hoje−6) em vez de (hoje−7). Um
-- lead contatado há exatamente 7 dias deixaria de ser excluído e receberia mensagem
-- um dia antes do combinado. Impacto pequeno na prática (o n8n dispara em horário
-- comercial), mas o custo de corrigir é uma linha.
--
-- Recriada IDÊNTICA à 020 no resto: assinatura (INTEGER), LANGUAGE sql, STABLE,
-- SECURITY DEFINER, `SET search_path = public`. Grants reafirmados no §5.
-- ─────────────────────────────────────────────────────────────────────────────────────
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
          -- hoje_brasilia() e não current_date: data_contato é gravada no calendário
          -- de Brasília (migration 028 §1). As duas pontas da comparação precisam
          -- estar na mesma régua, senão a janela encolhe pra 6 dias à noite.
          AND li.data_contato >= public.hoje_brasilia() - 7
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
  'Fila de disparo WhatsApp do dia, segmentada (carro_visto|sondagem) e deduplicada (1 linha/lead). '
  'Ordena carro_visto>sondagem e por views DESC, com LIMIT p_limite. Exclui tratativa e contato '
  '<7 dias (janela no fuso de Brasília, via hoje_brasilia()). SECURITY DEFINER. Migrations 020 + 026 + 028.';


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 5. GRANTS — reafirma a decisão da migration 026
-- =====================================================================================
-- `CREATE OR REPLACE FUNCTION` PRESERVA as permissões existentes (não é DROP+CREATE),
-- então nada foi perdido acima. Reafirmar é defesa em profundidade e deixa a regra
-- legível junto do código que ela protege.
--
-- `anon` fica FORA de propósito: é a chave pública embarcada no bundle do navegador.
-- Com EXECUTE em fila_disparo_whatsapp, qualquer pessoa lia nome + telefone dos leads
-- sem autenticação (auditoria de 04/08/2026 → migration 026). NÃO reintroduzir.
--
-- `importar_repasse_auto_avaliar` não aparece aqui: é SECURITY INVOKER (respeita RLS
-- por si) e a 025 nunca customizou seus grants — mexer agora mudaria o comportamento.
-- ─────────────────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.fila_disparo_whatsapp(integer) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fila_disparo_whatsapp(integer) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.marcar_lead_contatado(bigint, text, bigint) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.marcar_lead_contatado(bigint, text, bigint) TO authenticated, service_role;


-- =====================================================================================
-- VERIFICAÇÃO PÓS-MIGRATION (rodar manualmente depois de aplicar)
-- =====================================================================================
-- 1) O banco continua em UTC e o helper corrige (rodar depois das 21h pra ver diferir):
--      SELECT current_setting('TimeZone') AS tz,
--             current_date                AS hoje_utc,
--             public.hoje_brasilia()      AS hoje_brasilia;
--
-- 2) Nenhum `current_date` sobrou nas 3 funções tocadas (esperado: 0 linhas):
--      SELECT p.proname
--        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public'
--         AND p.proname IN ('marcar_lead_contatado','importar_repasse_auto_avaliar',
--                           'fila_disparo_whatsapp','repasses_preenche_data_subido')
--         AND pg_get_functiondef(p.oid) ILIKE '%current_date%';
--
-- 3) Defaults de coluna trocados:
--      SELECT table_name, column_name, column_default
--        FROM information_schema.columns
--       WHERE (table_name, column_name) IN (('repasses','data_subiu'),
--                                           ('repasse_gastos','data'));
--      -- esperado: hoje_brasilia() nos dois
--
-- 4) anon continua SEM acesso às RPCs de lead (esperado: false, false):
--      SELECT has_function_privilege('anon', 'public.fila_disparo_whatsapp(integer)', 'EXECUTE'),
--             has_function_privilege('anon', 'public.marcar_lead_contatado(bigint,text,bigint)', 'EXECUTE');
--
-- 5) authenticated e service_role continuam COM acesso (esperado: true, true):
--      SELECT has_function_privilege('authenticated', 'public.marcar_lead_contatado(bigint,text,bigint)', 'EXECUTE'),
--             has_function_privilege('service_role',  'public.marcar_lead_contatado(bigint,text,bigint)', 'EXECUTE');
--
-- 6) Smoke da RPC de contato (rodar numa transação e dar ROLLBACK):
--      BEGIN;
--        SELECT marcar_lead_contatado(
--                 (SELECT lead_id FROM lead_interesses WHERE repasse_id IS NOT NULL LIMIT 1),
--                 'carro_visto',
--                 (SELECT repasse_id FROM lead_interesses WHERE repasse_id IS NOT NULL LIMIT 1));
--        -- data_contato do retorno tem que bater com public.hoje_brasilia()
--      ROLLBACK;
-- =====================================================================================
-- FIM da migration 028
-- =====================================================================================
