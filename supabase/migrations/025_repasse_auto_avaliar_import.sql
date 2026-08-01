-- Navesa Mesa — Fatia 2: Importador Auto Avaliar (schema + RPC transacional)
-- =====================================================================================
-- O /repasses ganha um importador do XLSX/planilha do Auto Avaliar. O PREVIEW no app
-- decide cada linha (criar vs atualizar, reconciliar vendidos/marcados) e manda pra cá
-- um SNAPSHOT JÁ DECIDIDO. Esta RPC NÃO recalcula regra de negócio — ela só APLICA,
-- de forma atômica e idempotente.
--
-- Molde: mesma linhagem da RPC importar_interesses_repasse (migration 018) —
--   SECURITY INVOKER, payload JSONB in / JSONB out, uma transação (atômica).
--
-- Princípios (padrão do projeto):
--   - 100% idempotente: rodar 2x com o MESMO payload => MESMO estado final.
--     (ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS / CREATE OR REPLACE FUNCTION;
--      gasto auto_avaliar via DELETE+INSERT => não acumula; criar re-executado cai em UPDATE.)
--   - Centavo-perfect: todo dinheiro é numeric(12,2), extraído via ::numeric (NUNCA ::float).
--   - RLS já coberto: a policy authenticated_all_access de repasses/repasse_gastos é por
--     LINHA, não por coluna — colunas novas herdam. A RPC é SECURITY INVOKER (respeita RLS).
-- =====================================================================================


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 1. COLUNAS NOVAS em repasses (Médias Fipe / Web do Auto Avaliar)
-- ─────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE repasses ADD COLUMN IF NOT EXISTS valor_fipe numeric(12, 2);
COMMENT ON COLUMN repasses.valor_fipe IS
  'Media Fipe do Auto Avaliar. numeric(12,2). Fatia 2.';

ALTER TABLE repasses ADD COLUMN IF NOT EXISTS valor_web numeric(12, 2);
COMMENT ON COLUMN repasses.valor_web IS
  'Media Web do Auto Avaliar. numeric(12,2). Fatia 2.';

-- valor_auto_avaliar deixa de ser coluna "zumbi" (013): agora é a Média AA gravada
-- pelo importador do Auto Avaliar (Fatia 2), lida/escrita pela aplicação de novo.
COMMENT ON COLUMN repasses.valor_auto_avaliar IS
  'Media AA (Auto Avaliar), gravada pelo importador do Auto Avaliar. numeric(12,2). '
  'Fatia 2 reativou a coluna (antes era legacy/zumbi, ver migration 013).';


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 2. ÍNDICES FUNCIONAIS de placa normalizada (match / reconciliação sem seq-scan)
-- =====================================================================================
-- A normalização de placa é regexp_replace(upper(placa),'[^A-Z0-9]','','g') (remove
-- máscara/traço, uppercase). upper() e regexp_replace() são IMMUTABLE => indexáveis.
-- Os btrees PLANOS já existentes em vendas(placa)/veiculos(placa) NÃO servem essa
-- expressão; por isso índices funcionais dedicados, com a MESMA expressão nos 3 lados
-- (repasse ↔ vendas ↔ veiculos) pro planner conseguir casar.
-- ─────────────────────────────────────────────────────────────────────────────────────

-- repasse: lado do match "criar" e da reconciliação (obrigatório pelo design).
CREATE INDEX IF NOT EXISTS idx_repasses_placa_norm
  ON repasses ((regexp_replace(upper(placa), '[^A-Z0-9]', '', 'g')));

-- vendas (2k linhas): lado do cruzamento da reconciliação (repasse subido x venda NBS).
CREATE INDEX IF NOT EXISTS idx_vendas_placa_norm
  ON vendas ((regexp_replace(upper(placa), '[^A-Z0-9]', '', 'g')));

-- veiculos (49k linhas): base do estoque, usada pra resolver chassi por placa no preview.
-- É onde o seq-scan realmente dói. veiculos_atual é VIEW — indexa-se a base veiculos.
CREATE INDEX IF NOT EXISTS idx_veiculos_placa_norm
  ON veiculos ((regexp_replace(upper(placa), '[^A-Z0-9]', '', 'g')));


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 3. RPC importar_repasse_auto_avaliar(p_payload jsonb) RETURNS jsonb
-- =====================================================================================
-- Aplica o snapshot já decidido pelo preview. Molde da 018 (SECURITY INVOKER, atômica).
--
-- p_payload:
-- {
--   "itens": [ { "acao":"criar"|"atualizar", "repasse_id":int|null, "chassi":str|null,
--                "registro": { "placa_norm":str, "modelo":str, "cor":str|null,
--                              "ano_modelo":int|null, "km":int|null,
--                              "valor_compra":num|null, "gastos":num,
--                              "minimo":num|null, "compre_por":num|null,
--                              "media_aa":num|null, "media_fipe":num|null, "media_web":num|null } } ],
--   "reconciliacao": [ { "repasse_id":int, "novo_status":"vendido"|"marcado",
--                        "data_vendido":date|null, "valor_vendido":num|null } ]
-- }
--
-- Comportamento (tudo em UMA transação):
--   - atualizar: UPDATE dos 6 valores + atualizado_em WHERE id=repasse_id. NÃO toca
--     valor_aquisicao. Gasto auto_avaliar via DELETE+INSERT (só se gastos>0; idempotente,
--     preserva gastos de outros tipos).
--   - criar: match defensivo por placa_norm em repasse ATIVO (marcado|subido); se achou,
--     cai em UPDATE (idempotência de re-run). Senão, se o chassi já tem repasse ativo
--     (placa divergente) => pula e conta conflito (não estoura 23505). Senão INSERT novo
--     (canal='auto_avaliar', status='subido', data_subiu=current_date) + gasto se gastos>0.
--   - reconciliacao: UPDATE status (e data/valor vendido quando 'vendido') com GUARDA no
--     WHERE: canal='auto_avaliar' AND status='subido' — nunca mexe em quem não é AA/subido.
--
-- Retorno JSONB: { criados, atualizados, reconciliados_vendidos, reconciliados_marcados,
--                  conflitos } (conflitos = criar pulado por chassi ativo divergente).
-- =====================================================================================
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
          atualizado_em        = now()
        WHERE id = v_target;              -- NÃO toca valor_aquisicao (custo do sistema/NBS)
        GET DIAGNOSTICS v_cnt = ROW_COUNT;

        IF v_cnt > 0 THEN
          v_atualizados := v_atualizados + 1;
          -- Gasto Auto Avaliar: DELETE+INSERT (idempotente, preserva outros tipos).
          IF v_gastos > 0 THEN
            DELETE FROM repasse_gastos
            WHERE repasse_id = v_target AND tipo = 'auto_avaliar';
            INSERT INTO repasse_gastos (repasse_id, tipo, descricao, valor, data)
            VALUES (v_target, 'auto_avaliar', 'Gastos Auto Avaliar', v_gastos, current_date);
          END IF;
        END IF;
      END IF;

      -- ── INSERT (criar novo) ──────────────────────────────────────────────────────────
      IF v_do_insert THEN
        BEGIN
          INSERT INTO repasses (
            chassi, placa, modelo, cor, ano_modelo, km,
            canal, status, data_subiu,
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
            'auto_avaliar', 'subido', current_date,
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
            VALUES (v_new_id, 'auto_avaliar', 'Gastos Auto Avaliar', v_gastos, current_date);
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
  'SECURITY INVOKER, atômica, idempotente. Payload JSONB {itens, reconciliacao} → JSONB de contagens.';

-- =====================================================================================
-- FIM da migration 025
-- =====================================================================================
