-- Navesa Mesa — Migration 018: CRM de Leads central
-- =====================================================================================
-- Evolui o "interessados por carro" (repasse_interessados, migrations 016/017) num CRM
-- de Leads central. Um LEAD é um contato único (dedup por email, senão por whatsapp);
-- um LEAD_INTERESSE é o vínculo lead↔carro (repasse OU estoque), preservando o funil
-- já trabalhado pelo Marcos.
--
-- Princípios:
--   - 100% idempotente: rodar 2x produz o MESMO resultado, sem duplicar dados.
--     (IF NOT EXISTS / DROP IF EXISTS / ON CONFLICT DO NOTHING / âncora legacy_interessado_id)
--   - SEGURO: o backfill SÓ faz INSERT. Nunca DELETE/UPDATE na origem.
--     repasse_interessados permanece intacta como backup vivo. NÃO é dropada.
--   - RLS no padrão do projeto: 1 policy "authenticated_all_access" FOR ALL por tabela.
--   - Reusa a trigger function existente repasses_set_atualizado_em() (migration 008).
--   - timestamptz sempre; numeric explícito p/ dinheiro (não há dinheiro aqui, mas a regra fica).
--
-- A view veiculos_atual NÃO é tocada (chassi é a chave estável do estoque; id/snapshot_id
-- mudam a cada import NBS). Interesses de estoque referenciam carro por `chassi`.
-- =====================================================================================


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 1. TABELA leads (contato único)
-- ─────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leads (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nome TEXT NOT NULL,
  cidade_uf TEXT,
  telefone_whatsapp TEXT,                 -- normalizado: 55+DDD+numero
  telefones_raw TEXT,
  email TEXT,
  email_norm TEXT,                        -- lower(trim(email)) ou NULL — chave de dedup
  status_relacionamento TEXT NOT NULL DEFAULT 'novo'
    CHECK (status_relacionamento IN ('novo','contatado','respondeu','negociando','fechou','perdido')),
  observacao TEXT,
  -- Âncora de re-execução / auditoria: aponta pro menor repasse_interessados.id que
  -- originou este lead. Garante idempotência do backfill p/ leads SEM email E SEM whatsapp
  -- (que não têm outra chave natural de dedup).
  legacy_interessado_id BIGINT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Dedup principal: email normalizado (parcial — NULLs não colidem)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_leads_email_norm
  ON leads(email_norm) WHERE email_norm IS NOT NULL;
-- Dedup secundário: whatsapp (parcial — NULLs não colidem)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_leads_whatsapp
  ON leads(telefone_whatsapp) WHERE telefone_whatsapp IS NOT NULL;
-- Âncora de backfill p/ leads sem email/whatsapp (parcial)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_leads_legacy_interessado
  ON leads(legacy_interessado_id) WHERE legacy_interessado_id IS NOT NULL;
-- Busca por nome (case-insensitive)
CREATE INDEX IF NOT EXISTS idx_leads_nome ON leads(lower(nome));

COMMENT ON TABLE leads IS 'Contato único do CRM (dedup por email_norm, senão por telefone_whatsapp).';
COMMENT ON COLUMN leads.email_norm IS 'lower(trim(email)) — chave de dedup. NULL quando sem email.';
COMMENT ON COLUMN leads.legacy_interessado_id IS 'Âncora de backfill/auditoria: menor repasse_interessados.id que originou o lead.';


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 2. TABELA lead_interesses (vínculo lead ↔ carro)
-- ─────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lead_interesses (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lead_id BIGINT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  repasse_id BIGINT REFERENCES repasses(id) ON DELETE SET NULL,
  chassi TEXT,                            -- chave estável do estoque (carro NBS)
  modelo_snapshot TEXT NOT NULL,         -- nome do carro no momento do interesse (histórico)
  tipo_carro TEXT NOT NULL CHECK (tipo_carro IN ('repasse','estoque')),
  origem TEXT NOT NULL DEFAULT 'visualizou' CHECK (origem IN ('visualizou','oferta')),
  qtd_visualizacoes INTEGER NOT NULL DEFAULT 1,
  data_acesso TEXT,
  status_followup TEXT NOT NULL DEFAULT 'novo'
    CHECK (status_followup IN ('novo','contatado','respondeu','negociando','fechou','perdido')),
  data_contato DATE,
  observacao TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Coerência: repasse usa repasse_id (chassi NULL); estoque usa chassi (repasse_id NULL).
  CONSTRAINT chk_carro_presente CHECK (
    (tipo_carro = 'repasse' AND repasse_id IS NOT NULL AND chassi IS NULL)
    OR (tipo_carro = 'estoque' AND chassi IS NOT NULL AND repasse_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_lead_interesses_lead ON lead_interesses(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_interesses_repasse ON lead_interesses(repasse_id);
CREATE INDEX IF NOT EXISTS idx_lead_interesses_chassi ON lead_interesses(chassi);
-- Dedup do interesse: 1 por (lead, repasse) e 1 por (lead, chassi). Parciais → NULLs ok.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_interesse_lead_repasse
  ON lead_interesses(lead_id, repasse_id) WHERE repasse_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_interesse_lead_chassi
  ON lead_interesses(lead_id, chassi) WHERE chassi IS NOT NULL;

COMMENT ON TABLE lead_interesses IS 'Vínculo lead↔carro (repasse ou estoque). Preserva o funil de follow-up.';


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 3. TRIGGERS updated_at (reusa repasses_set_atualizado_em() do 008)
-- ─────────────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_leads_atualizado_em ON leads;
CREATE TRIGGER trg_leads_atualizado_em
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION repasses_set_atualizado_em();

DROP TRIGGER IF EXISTS trg_lead_interesses_atualizado_em ON lead_interesses;
CREATE TRIGGER trg_lead_interesses_atualizado_em
  BEFORE UPDATE ON lead_interesses
  FOR EACH ROW EXECUTE FUNCTION repasses_set_atualizado_em();


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 4. RLS — padrão do projeto (authenticated_all_access FOR ALL)
-- ─────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_interesses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all_access" ON leads;
CREATE POLICY "authenticated_all_access" ON leads
  FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "authenticated_all_access" ON lead_interesses;
CREATE POLICY "authenticated_all_access" ON lead_interesses
  FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 5. BACKFILL SEGURO — repasse_interessados → leads + lead_interesses
-- =====================================================================================
-- Só INSERT. Idempotente via ON CONFLICT DO NOTHING + âncora legacy_interessado_id.
-- Precedência de identidade do lead: email_norm > telefone_whatsapp > linha (legacy).
-- Em todos os casos o registro mais ANTIGO (menor repasse_interessados.id) vence
-- nome/cidade/whatsapp/email, e vira a âncora legacy_interessado_id.
-- =====================================================================================

-- 5.A — Leads COM email. Dedup por lower(trim(email)). Menor id vence.
INSERT INTO leads (nome, cidade_uf, telefone_whatsapp, telefones_raw, email, email_norm, legacy_interessado_id, criado_em)
SELECT DISTINCT ON (lower(trim(ri.email)))
  ri.nome,
  ri.cidade_uf,
  ri.telefone_whatsapp,
  ri.telefones_raw,
  ri.email,
  lower(trim(ri.email)) AS email_norm,
  ri.id                 AS legacy_interessado_id,
  ri.criado_em
FROM repasse_interessados ri
WHERE ri.email IS NOT NULL AND trim(ri.email) <> ''
ORDER BY lower(trim(ri.email)), ri.id ASC
ON CONFLICT (email_norm) WHERE email_norm IS NOT NULL DO NOTHING;

-- 5.B — Leads SEM email mas COM whatsapp. Dedup por telefone_whatsapp. Menor id vence.
INSERT INTO leads (nome, cidade_uf, telefone_whatsapp, telefones_raw, email, email_norm, legacy_interessado_id, criado_em)
SELECT DISTINCT ON (ri.telefone_whatsapp)
  ri.nome,
  ri.cidade_uf,
  ri.telefone_whatsapp,
  ri.telefones_raw,
  ri.email,
  NULL::text AS email_norm,
  ri.id      AS legacy_interessado_id,
  ri.criado_em
FROM repasse_interessados ri
WHERE (ri.email IS NULL OR trim(ri.email) = '')
  AND ri.telefone_whatsapp IS NOT NULL AND trim(ri.telefone_whatsapp) <> ''
ORDER BY ri.telefone_whatsapp, ri.id ASC
ON CONFLICT (telefone_whatsapp) WHERE telefone_whatsapp IS NOT NULL DO NOTHING;

-- 5.C — Leads SEM email E SEM whatsapp. 1 lead por linha. Âncora = legacy_interessado_id.
--        ON CONFLICT na âncora garante rerun sem duplicar.
INSERT INTO leads (nome, cidade_uf, telefone_whatsapp, telefones_raw, email, email_norm, legacy_interessado_id, criado_em)
SELECT
  ri.nome,
  ri.cidade_uf,
  ri.telefone_whatsapp,
  ri.telefones_raw,
  ri.email,
  NULL::text AS email_norm,
  ri.id      AS legacy_interessado_id,
  ri.criado_em
FROM repasse_interessados ri
WHERE (ri.email IS NULL OR trim(ri.email) = '')
  AND (ri.telefone_whatsapp IS NULL OR trim(ri.telefone_whatsapp) = '')
ON CONFLICT (legacy_interessado_id) WHERE legacy_interessado_id IS NOT NULL DO NOTHING;

-- 5.D — lead_interesses: 1 por linha de repasse_interessados, ligado ao lead resolvido.
--        Resolução do lead: email_norm → senão whatsapp → senão legacy_interessado_id.
--        Preserva o funil (status_followup, data_contato, observacao, qtd, data_acesso, criado_em).
INSERT INTO lead_interesses (
  lead_id, repasse_id, chassi, modelo_snapshot, tipo_carro, origem,
  qtd_visualizacoes, data_acesso, status_followup, data_contato, observacao, criado_em
)
SELECT
  l.id AS lead_id,
  ri.repasse_id,
  NULL::text AS chassi,
  COALESCE(r.modelo, 'Repasse #' || ri.repasse_id) AS modelo_snapshot,
  'repasse'    AS tipo_carro,
  'visualizou' AS origem,
  COALESCE(ri.qtd_visualizacoes, 1) AS qtd_visualizacoes,
  ri.data_acesso,
  ri.status_followup,
  ri.data_contato,
  ri.observacao,
  ri.criado_em
FROM repasse_interessados ri
LEFT JOIN repasses r ON r.id = ri.repasse_id
JOIN leads l ON l.id = (
  CASE
    WHEN ri.email IS NOT NULL AND trim(ri.email) <> '' THEN
      (SELECT id FROM leads WHERE email_norm = lower(trim(ri.email)) LIMIT 1)
    WHEN ri.telefone_whatsapp IS NOT NULL AND trim(ri.telefone_whatsapp) <> '' THEN
      (SELECT id FROM leads WHERE telefone_whatsapp = ri.telefone_whatsapp LIMIT 1)
    ELSE
      (SELECT id FROM leads WHERE legacy_interessado_id = ri.id LIMIT 1)
  END
)
ON CONFLICT (lead_id, repasse_id) WHERE repasse_id IS NOT NULL DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 6. RPC importar_interesses_repasse(p_repasse_id, p_itens)
-- =====================================================================================
-- Importa um lote de interessados de UM repasse, com dedup server-side e atomicidade.
-- SECURITY INVOKER → respeita a RLS do caller (precisa estar autenticado).
--
-- p_itens: JSONB array de objetos (saída do parser do front), cada um:
--   { nome, cidade_uf, telefone_whatsapp, telefones_raw, email, qtd_visualizacoes, data_acesso }
--
-- Para cada item:
--   1. Resolve/cria o lead: email_norm primeiro, senão whatsapp, senão cria novo.
--      NÃO sobrescreve nome/cidade/whatsapp/email de lead existente — só anexa interesse.
--   2. Cria lead_interesse (tipo='repasse', origem='visualizou', repasse_id,
--      modelo_snapshot do repasse) com ON CONFLICT (lead_id, repasse_id) DO NOTHING.
--
-- Retorna JSONB: { leads_novos, leads_existentes, interesses_novos, interesses_ignorados }
-- A função roda como UMA transação (atômica): erro em qualquer item desfaz tudo.
-- =====================================================================================
CREATE OR REPLACE FUNCTION importar_interesses_repasse(
  p_repasse_id BIGINT,
  p_itens JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_item            JSONB;
  v_email           TEXT;
  v_email_norm      TEXT;
  v_whatsapp        TEXT;
  v_nome            TEXT;
  v_cidade          TEXT;
  v_tel_raw         TEXT;
  v_qtd             INTEGER;
  v_data_acesso     TEXT;
  v_modelo          TEXT;
  v_lead_id         BIGINT;
  v_lead_existia    BOOLEAN;
  v_interesse_id    BIGINT;
  v_leads_novos          INTEGER := 0;
  v_leads_existentes     INTEGER := 0;
  v_interesses_novos     INTEGER := 0;
  v_interesses_ignorados INTEGER := 0;
BEGIN
  IF p_repasse_id IS NULL THEN
    RAISE EXCEPTION 'p_repasse_id é obrigatório';
  END IF;

  -- modelo_snapshot vem do repasse (fallback defensivo se o repasse sumir)
  SELECT modelo INTO v_modelo FROM repasses WHERE id = p_repasse_id;
  v_modelo := COALESCE(v_modelo, 'Repasse #' || p_repasse_id);

  IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array' THEN
    RETURN jsonb_build_object(
      'leads_novos', 0, 'leads_existentes', 0,
      'interesses_novos', 0, 'interesses_ignorados', 0
    );
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens)
  LOOP
    v_nome        := NULLIF(trim(v_item->>'nome'), '');
    v_cidade      := NULLIF(trim(v_item->>'cidade_uf'), '');
    v_whatsapp    := NULLIF(trim(v_item->>'telefone_whatsapp'), '');
    v_tel_raw     := NULLIF(trim(v_item->>'telefones_raw'), '');
    v_email       := NULLIF(trim(v_item->>'email'), '');
    v_email_norm  := lower(v_email);  -- v_email já é trim/NULLIF
    v_data_acesso := NULLIF(trim(v_item->>'data_acesso'), '');
    v_qtd         := COALESCE((v_item->>'qtd_visualizacoes')::INTEGER, 1);

    -- Nome é NOT NULL no schema; defensivo p/ não derrubar o lote inteiro.
    IF v_nome IS NULL THEN
      v_nome := 'Sem nome';
    END IF;

    v_lead_id := NULL;
    v_lead_existia := FALSE;

    -- 1. Resolve lead existente: email_norm primeiro, senão whatsapp.
    IF v_email_norm IS NOT NULL THEN
      SELECT id INTO v_lead_id FROM leads WHERE email_norm = v_email_norm LIMIT 1;
    END IF;
    IF v_lead_id IS NULL AND v_whatsapp IS NOT NULL THEN
      SELECT id INTO v_lead_id FROM leads WHERE telefone_whatsapp = v_whatsapp LIMIT 1;
    END IF;

    IF v_lead_id IS NOT NULL THEN
      -- Lead já existe → NÃO sobrescreve dados, só anexa interesse depois.
      v_lead_existia := TRUE;
      v_leads_existentes := v_leads_existentes + 1;
    ELSE
      -- 2. Cria lead novo. ON CONFLICT cobre corrida e dedup defensivo.
      INSERT INTO leads (nome, cidade_uf, telefone_whatsapp, telefones_raw, email, email_norm)
      VALUES (v_nome, v_cidade, v_whatsapp, v_tel_raw, v_email, v_email_norm)
      ON CONFLICT DO NOTHING
      RETURNING id INTO v_lead_id;

      IF v_lead_id IS NULL THEN
        -- Conflitou (outra corrida ou dedup parcial) → resolve de novo.
        v_lead_existia := TRUE;
        v_leads_existentes := v_leads_existentes + 1;
        IF v_email_norm IS NOT NULL THEN
          SELECT id INTO v_lead_id FROM leads WHERE email_norm = v_email_norm LIMIT 1;
        END IF;
        IF v_lead_id IS NULL AND v_whatsapp IS NOT NULL THEN
          SELECT id INTO v_lead_id FROM leads WHERE telefone_whatsapp = v_whatsapp LIMIT 1;
        END IF;
        -- Se ainda assim NULL (item sem email e sem whatsapp colidiu impossível),
        -- força um insert sem chaves de dedup.
        IF v_lead_id IS NULL THEN
          INSERT INTO leads (nome, cidade_uf, telefone_whatsapp, telefones_raw, email, email_norm)
          VALUES (v_nome, v_cidade, v_whatsapp, v_tel_raw, v_email, v_email_norm)
          RETURNING id INTO v_lead_id;
          v_lead_existia := FALSE;
          v_leads_existentes := v_leads_existentes - 1;
          v_leads_novos := v_leads_novos + 1;
        END IF;
      ELSE
        v_leads_novos := v_leads_novos + 1;
      END IF;
    END IF;

    -- 3. Cria o interesse (dedup por (lead, repasse)).
    INSERT INTO lead_interesses (
      lead_id, repasse_id, chassi, modelo_snapshot, tipo_carro, origem,
      qtd_visualizacoes, data_acesso
    )
    VALUES (
      v_lead_id, p_repasse_id, NULL, v_modelo, 'repasse', 'visualizou',
      v_qtd, v_data_acesso
    )
    ON CONFLICT (lead_id, repasse_id) WHERE repasse_id IS NOT NULL DO NOTHING
    RETURNING id INTO v_interesse_id;

    IF v_interesse_id IS NOT NULL THEN
      v_interesses_novos := v_interesses_novos + 1;
    ELSE
      v_interesses_ignorados := v_interesses_ignorados + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'leads_novos', v_leads_novos,
    'leads_existentes', v_leads_existentes,
    'interesses_novos', v_interesses_novos,
    'interesses_ignorados', v_interesses_ignorados
  );
END;
$$;

COMMENT ON FUNCTION importar_interesses_repasse(BIGINT, JSONB) IS
  'Importa lote de interessados de um repasse com dedup server-side (email→whatsapp). SECURITY INVOKER, atômica. Retorna contagens em JSONB.';

-- =====================================================================================
-- FIM da migration 018
-- =====================================================================================
