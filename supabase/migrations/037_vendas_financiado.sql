-- Navesa Mesa — Migration 037: financiamento na venda
-- =====================================================================================
-- O XLSX de vendas do NBS ("vendidos.xlsx") traz duas colunas hoje não persistidas
-- em public.vendas:
--   FINANCIADO  — Sim/Não por venda (valores observados no NBS: "N"/"S")
--   Financeira  — nome da financeira usada, texto livre, só preenchido quando financiado
--
-- financiado: boolean, NULLABLE, SEM DEFAULT.
--   NULL = "não sabemos" (venda antiga, ainda não reprocessada pelo import, ou coluna
--   vazia no XLSX de origem) — nunca tratar NULL como "não financiou". Só false quando
--   o NBS explicitamente marcar "N".
-- financeira: texto livre, NULL quando não financiado ou desconhecida.
--
-- Idempotente (ADD COLUMN IF NOT EXISTS). Rodar 2x sem erro.
-- Parser/upsert do import ficam por conta do dex-dev — esta migration é só schema.
-- =====================================================================================

ALTER TABLE public.vendas ADD COLUMN IF NOT EXISTS financiado BOOLEAN;
ALTER TABLE public.vendas ADD COLUMN IF NOT EXISTS financeira TEXT;

COMMENT ON COLUMN public.vendas.financiado IS
  'Venda financiada (col FINANCIADO do vendidos.xlsx, NBS: S/N). NULL = nao sabemos (nao confundir com "nao financiou"); so false quando o NBS marcar N explicitamente.';

COMMENT ON COLUMN public.vendas.financeira IS
  'Nome da financeira usada (col Financeira do vendidos.xlsx). Texto livre, NULL quando nao financiado ou desconhecida.';
