-- Navesa Mesa — Migration 042: flag de consignado na venda
-- =====================================================================================
-- Relatório "Vendas Usados Matriz" (PR #25) distingue, no original feito à mão pelo
-- Marcos, "COM CONSIGNADOS" vs "SEM CONSIGNADOS" em alguns blocos de resumo (ex: total
-- de carros faturados no mês, incluindo e excluindo vendas de consignado). Hoje
-- public.vendas não guarda esse dado.
--
-- Fonte: NBS.VEICULOS.CONSIGNATO ('S'/'N'), já usado como FILTRO (não como dado) no
-- sync de ESTOQUE (sync-veiculos.ts, FILTRO_ESTOQUE). Pro sync de VENDAS, agora também
-- lido como valor (sync-vendas.ts/mapear-venda.ts) — v.* já trazia a coluna de graça,
-- não precisou mudar o SELECT.
--
-- consignado: BOOLEAN, NOT NULL DEFAULT false.
--   Validado contra o Oracle real em 02/10/2026 (ver scripts/sync-nbs/sync-vendas.ts):
--   dentro da janela de vendas realmente sincronizada (NOVO_USADO='U'), CONSIGNATO só
--   veio 'S' ou 'N' — nunca nulo/vazio (1.084 vendas/90d e 4.062 vendas/365d, 0 nulos).
--   Diferente de `financiado` (migration 037, NULLABLE): lá o XLSX de origem podia vir
--   em branco (coluna opcional do relatório manual). Aqui a coluna Oracle é sempre
--   preenchida com um valor binário conhecido, e para vendas já sincronizadas ANTES
--   desta migration, "não sabemos" e "não é consignado" coincidem de fato (o sync nunca
--   leu nem gravou esse campo) — DEFAULT false representa um fato conhecido, não um
--   chute. Por isso NOT NULL DEFAULT false é o padrão certo aqui (ao contrário do
--   financiado).
--
--   ACHADO IMPORTANTE (mesma validação): vendas de consignado usam NOVO_USADO='C' em
--   NBS.VEICULOS, não 'U'. O FILTRO_VENDAS atual (NOVO_USADO='U') exclui 100% das vendas
--   de consignado — logo, HOJE esta coluna sempre será gravada como `false` por todo
--   sync (0 de 1.084 vendas/90d e 0 de 4.062/365d tinham CONSIGNATO='S' dentro do
--   universo sincronizado). O código está correto e pronto pra quando o filtro for
--   expandido, mas o bloco "COM CONSIGNADOS" do relatório NÃO vai mostrar nenhuma venda
--   de consignado até essa decisão arquitetural ser tomada (expandir FILTRO_VENDAS pra
--   incluir NOVO_USADO='C' — fora do escopo desta migration, consultar @aria-architect).
--
-- Sem índice dedicado: baixa cardinalidade (maioria `false`), e as queries de relatório
-- já filtram por data_venda/cod_empresa (idx_vendas_data, idx_vendas_loja existentes) —
-- um filtro booleano adicional em memória sobre esse resultado já filtrado é barato.
--
-- Idempotente (ADD COLUMN IF NOT EXISTS). Rodar 2x sem erro.
-- =====================================================================================

ALTER TABLE public.vendas ADD COLUMN IF NOT EXISTS consignado BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.vendas.consignado IS
  'Venda de veiculo consignado (NBS.VEICULOS.CONSIGNATO = S/N). NOT NULL DEFAULT false: campo binario sempre preenchido no Oracle dentro da janela sincronizada, ausencia = fato conhecido "nao e consignado". ATENCAO: FILTRO_VENDAS atual (NOVO_USADO=U) exclui vendas de consignado (NOVO_USADO=C) -- hoje este campo sempre vem false ate essa decisao arquitetural ser revista (ver sync-vendas.ts).';
