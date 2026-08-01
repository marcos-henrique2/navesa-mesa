-- Navesa Mesa — Épico Inteligência de Repasse — Story 1.1 (amenda: regra de negócio)
--
-- CORREÇÃO DE REGRA DE NEGÓCIO (Marcos): repasse é venda B2B pra outro lojista,
-- base de custo MENOR que o varejo do sistema. Portanto o custo que entra na
-- MARGEM DE REPASSE NÃO é `valor_aquisicao` (custo do sistema/NBS), e sim o
-- "R$ Compra" do Auto Avaliar + os "Gastos" do Auto Avaliar.
--
--   Custo da margem de repasse = valor_compra_repasse + Σ repasse_gastos(auto_avaliar)
--
-- `valor_aquisicao` PERMANECE como referência do sistema (não tocar, não entra
-- na margem de repasse).
--
-- Mudanças:
--   1. ADD COLUMN valor_compra_repasse numeric(12,2) nullable
--      (custo-base do repasse, vindo do "R$ Compra" do Auto Avaliar).
--   2. RELAXA o CHECK de repasse_gastos.tipo pra aceitar o novo valor
--      'auto_avaliar' (gastos importados do Auto Avaliar). Mantém os valores
--      legacy. DROP CONSTRAINT IF EXISTS + ADD → idempotente.
--
-- Precisão numeric(12,2) centavo-perfect, consistente com as demais colunas.
-- 100% idempotente (ADD COLUMN IF NOT EXISTS / DROP CONSTRAINT IF EXISTS).
-- RLS já coberto pela policy existente das tabelas (por linha, não por coluna).

ALTER TABLE repasses ADD COLUMN IF NOT EXISTS valor_compra_repasse numeric(12, 2);

COMMENT ON COLUMN repasses.valor_compra_repasse IS
  'Custo-base do repasse = "R$ Compra" do Auto Avaliar. Base da MARGEM de repasse (B2B, menor que varejo). Distinto de valor_aquisicao (custo do sistema/NBS, que NAO entra na margem de repasse). numeric(12,2) centavo-perfect. Nullable = dados incompletos. Story 1.1.';

-- Relaxa o CHECK de repasse_gastos.tipo pra incluir 'auto_avaliar'.
ALTER TABLE repasse_gastos DROP CONSTRAINT IF EXISTS repasse_gastos_tipo_check;
ALTER TABLE repasse_gastos ADD CONSTRAINT repasse_gastos_tipo_check
  CHECK (tipo IN ('documentacao','vistoria','pintura','mecanica','multas','auto_avaliar','outro'));
