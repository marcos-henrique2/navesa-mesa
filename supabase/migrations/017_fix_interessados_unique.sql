-- Navesa Mesa — Fix do ON CONFLICT na importacao de interessados
--
-- A migration 016 criou um indice unico PARCIAL (repasse_id, email) WHERE email IS NOT NULL.
-- O Postgres NAO usa indice unico parcial como arbitro de ON CONFLICT quando o cliente
-- passa apenas a lista de colunas (supabase-js nao envia o predicado WHERE), entao o
-- upsert em criarInteressados() falhava com:
--   "there is no unique or exclusion constraint matching the ON CONFLICT specification"
--
-- Fix: trocar o indice parcial por uma CONSTRAINT UNIQUE normal (repasse_id, email).
-- Isso casa exatamente com onConflict: "repasse_id,email" do supabase-js.
-- NULLs continuam DISTINCT (padrao do Postgres) → leads sem email nao colidem entre si,
-- preservando o comportamento desejado da 016.
--
-- Idempotente: pode rodar varias vezes sem efeito colateral.

-- 1. Remove o indice parcial (so existe se 016 ja rodou).
DROP INDEX IF EXISTS uniq_interessado_repasse_email;

-- 2. Adiciona a constraint UNIQUE nao-parcial (cria seu proprio indice de mesmo nome).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uniq_interessado_repasse_email'
  ) THEN
    ALTER TABLE repasse_interessados
      ADD CONSTRAINT uniq_interessado_repasse_email UNIQUE (repasse_id, email);
  END IF;
END $$;
