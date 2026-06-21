-- Navesa Mesa — Mini-CRM de Interessados (follow-up de repasse)
--
-- Leads que VISUALIZARAM o anúncio no Auto Avaliar (revendedores). O Auto Avaliar
-- mostra, por carro anunciado, quem acessou: nome, cidade/UF, telefones, e-mail,
-- data do acesso e qtd de visualizações. São leads quentes pra follow-up.
--
-- O Marcos importa essa lista (colar a tabela), gera uma mensagem de WhatsApp
-- personalizada (link wa.me, sem disparo automático) e acompanha o funil.
--
-- RLS segue o padrão do projeto: 1 policy "authenticated_all_access" por tabela
-- (`auth.uid() is not null`). Single user no MVP — sem segregação.
--
-- Idempotente (IF NOT EXISTS / DROP POLICY IF EXISTS) — pode rodar várias vezes
-- sem efeito colateral.

CREATE TABLE IF NOT EXISTS repasse_interessados (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  repasse_id BIGINT NOT NULL REFERENCES repasses(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  cidade_uf TEXT,
  telefone_whatsapp TEXT,
  telefones_raw TEXT,
  email TEXT,
  qtd_visualizacoes INTEGER DEFAULT 1,
  data_acesso TEXT,
  status_followup TEXT NOT NULL DEFAULT 'novo'
    CHECK (status_followup IN ('novo','contatado','respondeu','negociando','fechou','perdido')),
  observacao TEXT,
  data_contato DATE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_repasse_interessados_repasse ON repasse_interessados(repasse_id);

-- Dedup por (repasse, email): re-importar o mesmo lote não duplica leads.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_interessado_repasse_email
  ON repasse_interessados(repasse_id, email) WHERE email IS NOT NULL;

-- ─── Trigger updated_at (reusa a função existente do 008) ─────────────────────
DROP TRIGGER IF EXISTS trg_repasse_interessados_atualizado_em ON repasse_interessados;
CREATE TRIGGER trg_repasse_interessados_atualizado_em
  BEFORE UPDATE ON repasse_interessados
  FOR EACH ROW EXECUTE FUNCTION repasses_set_atualizado_em();

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE repasse_interessados ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all_access" ON repasse_interessados;
CREATE POLICY "authenticated_all_access" ON repasse_interessados
  FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

COMMENT ON TABLE repasse_interessados IS 'Leads que visualizaram o anuncio no Auto Avaliar (follow-up de repasse).';
