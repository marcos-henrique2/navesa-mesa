-- Navesa Mesa — Migration 019: responsável pelo IPVA em aberto
-- =====================================================================================
-- Quando o IPVA está "em_aberto", o anúncio precisa dizer QUEM PAGA (decisão do Marcos:
-- status + quem paga, sem valor). Padrão de negócio: por conta do COMPRADOR (revendedor);
-- com opção de marcar que a NAVESA quita antes da entrega, caso a caso.
--
-- ipva_responsavel: 'comprador' | 'navesa' | NULL.
--   NULL = não definido → o gerador de anúncio assume 'comprador' (default de negócio).
-- Só faz sentido quando ipva_status = 'em_aberto'. Idempotente.
-- =====================================================================================

ALTER TABLE repasses
  ADD COLUMN IF NOT EXISTS ipva_responsavel TEXT
  CHECK (ipva_responsavel IN ('comprador','navesa'));

COMMENT ON COLUMN repasses.ipva_responsavel IS
  'Quem paga o IPVA quando em_aberto: comprador (default de negocio) ou navesa. NULL = nao definido; anuncio assume comprador.';
