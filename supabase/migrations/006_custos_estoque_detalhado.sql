-- Navesa Mesa — Sprint Custos em Estoque
-- Custos detalhados de carros EM ESTOQUE (relatório PDF do NBS "Custos de Veículos em Estoque").
-- Análogo a custos_detalhados (que cobre só carros VENDIDOS), mas para carros que ainda
-- não foram vendidos. Permite mostrar o breakdown de margem (markup) na tela do veículo
-- mesmo antes da venda.
--
-- Diferenças vs custos_detalhados:
--   - Sem data_venda/data_fatura (carro ainda não foi vendido).
--   - Tem dias_patio (do PDF) — fonte primária pra esse dataset.
--   - Tem campos próprios do markup: nota_fabrica, revisoes, forplan, holdback,
--     acessorios, adm, impostos, comissoes, desp_gerais, ganhos_indiretos, bonus,
--     custo_total, tabela (preço de venda tabela), lucro_bruto.
--
-- Idempotente: roda várias vezes sem quebrar.

create table if not exists custos_estoque_detalhado (
  id                bigserial primary key,
  placa             text not null,
  cod_empresa       integer,
  modelo            text,
  dias_patio        integer,
  nota_fabrica      numeric(12, 2),
  revisoes          numeric(12, 2),
  forplan           numeric(12, 2),
  holdback          numeric(12, 2),
  acessorios        numeric(12, 2),
  adm               numeric(12, 2),
  impostos          numeric(12, 2),
  comissoes         numeric(12, 2),
  desp_gerais       numeric(12, 2),
  custo_total       numeric(12, 2),
  tabela            numeric(12, 2),  -- preço de venda tabela
  lucro_bruto       numeric(12, 2),
  bonus             numeric(12, 2),
  ganhos_indiretos  numeric(12, 2),
  atualizado_em     timestamptz default now(),
  unique (placa)
);

create index if not exists idx_custos_estoque_placa       on custos_estoque_detalhado (placa);
create index if not exists idx_custos_estoque_cod_empresa on custos_estoque_detalhado (cod_empresa);

alter table custos_estoque_detalhado enable row level security;

drop policy if exists "authenticated_all_access" on custos_estoque_detalhado;
create policy "authenticated_all_access" on custos_estoque_detalhado
  for all to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);
