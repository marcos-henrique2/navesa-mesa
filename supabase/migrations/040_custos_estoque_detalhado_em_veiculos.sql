-- Navesa Mesa — Migration 040: custos de estoque detalhados (8 categorias) em veiculos
-- =====================================================================================
-- Hoje `veiculos.custo_total` é um valor AGREGADO vindo direto do Oracle
-- (NBS.VEICULOS.CUSTO_TOTAL_FINAL). Esta migration adiciona 8 colunas novas
-- pra quebrar esse agregado nas mesmas categorias do relatório nativo NBS
-- "Custos de Veículos em Estoque": Revisões, Forplan (sem HoldBack),
-- HoldBack, Acessórios, ADM, Impostos, Comissões, Despesas Gerais.
-- (Nota Fábrica já existe = valor_aquisicao; Ganhos Indiretos/Bônus já existe
-- = valoriza, ver 039_valoriza_bonus_fabrica.sql — nenhum dos dois é tocado
-- aqui.)
--
-- Mesmo padrão arquitetural de valoriza/valor_aquisicao/custo_total: colunas
-- direto em `veiculos` (NÃO uma tabela separada), numeric(12,2) NOT NULL
-- DEFAULT 0 — ausência de custo lançado naquela categoria é um FATO
-- CONHECIDO (zero), não "não sabemos" (NULL).
--
-- custo_total CONTINUA vindo direto do Oracle e NÃO é deprecado.
--
-- ⚠️ ARMADILHA — NÃO CONFUNDIR com a tabela `custos_estoque_detalhado`
-- (006_custos_estoque_detalhado.sql): aquela é de um fluxo MANUAL de upload
-- de PDF (/upload → nbs-custos-estoque-pdf.ts → upsertCustosEstoque()),
-- chave `placa`. As colunas desta migration são de um fluxo 100% AUTOMÁTICO
-- via sync Oracle (mesma família de valoriza/valor_aquisicao). Os dois
-- fluxos continuam coexistindo sem relação entre si.
--
-- =====================================================================================
-- INVESTIGAÇÃO NBS.CUSTOS_ESPECIFICOS (541 tipos de custo) — 01/10/2026
-- Metodologia: mesma de valoriza.ts (achar candidatos por nome, validar
-- somando VALOR_FINAL de NBS.VEICULOS_CUSTOS_ESPECIFICOS por CODIGO_CUSTO,
-- sem JOIN, contra uma amostra de 15 dos 22 veículos em estoque hoje que
-- têm CUSTO_TOTAL_FINAL preenchido no Oracle — ver achado de cobertura
-- abaixo). Scripts de investigação já deletados (convenção
-- scripts/**/*.local.*) — queries reproduzidas aqui e no relatório da Dara
-- pro Marcos.
--
-- ALTA CONFIANÇA:
--   Impostos (CODIGO_CUSTO 142,143,268,363,404,409,410,413,414,420,422,423,
--   437,490,526,572,605,623,686,690 — ICMS/PIS/COFINS, várias variantes por
--   loja/cidade): nao-zero em 14 dos 15 veiculos testados (R$ 541 a R$ 2.953),
--   ordem de grandeza plausivel (~0,5%-2% do custo_total).
--
-- CONFIANÇA MÉDIA:
--   Revisões (CODIGO_CUSTO 154,250,269,280,300,301,302,303,547,558,559,560,
--   561,562,563,564,565,566,567,568,569,570,571,573,574,575,576,577,606,629,
--   630,631,650): nao-zero em 5 dos 15 veiculos (R$ 230 a R$ 16.095) — plausivel
--   que nem todo carro tenha revisao feita antes da venda.
--
-- BAIXA CONFIANÇA (nome bate, mas ZERO nos 15 veiculos testados — os
-- codigos existem e tem uso real na base completa, so nao bateram nessa
-- amostra pequena; usar com cautela, validar de novo quando houver mais
-- veiculos com CUSTO_TOTAL_FINAL preenchido):
--   HoldBack (CODIGO_CUSTO 144 "Hold Back", 681 "Hold Back (Retido)").
--   Acessórios (CODIGO_CUSTO 146 "Cortesia Acessórios", 424 "Acessórios",
--   640 "Acessorios Interno").
--   Forplan sem HoldBack (CODIGO_CUSTO 133 "Foorplan" — ATENÇÃO: nome tem
--   erro de digitação no NBS, "Foorplan" com dois "o", não "Forplan".
--   Candidatos alternativos tambem testados e tambem zerados na amostra:
--   609 "Rebate Floor Plan", 522 "Bonus isencao de Floor Plan", 659 "Juros
--   Floor Plan" — qualquer um desses pode ser o certo, nao da pra desempatar
--   sem uma venda/veiculo que comprovadamente tenha Forplan no PDF nativo).
--   Comissões (CODIGO_CUSTO 129,239,273,297,447,490,498,529,545,658):
--   ZERO nos 15 veiculos apesar do codigo ter 1,6 MILHAO de linhas na base
--   inteira (o maior volume entre todas as categorias testadas) — hipotese
--   forte: comissao so e lancada quando o carro VENDE (comissao de venda),
--   entao fica legitimamente zero pra carro ainda em estoque. Precisa
--   confirmar comparando com venda realizada, nao com estoque.
--   ⚠️ CODIGO_CUSTO 490 "Imposto Comissão sobre Venda Direta" aparece em
--   AMBAS as listas (Impostos e Comissões) — ambiguo. Atribuido a Impostos
--   nos testes acima (e o que da match de magnitude); se o sync real usar
--   490 nas duas categorias ao mesmo tempo vai contar o valor em dobro.
--
-- SEM CÓDIGO ENCONTRADO (não é falta de busca — varri os 541 tipos de custo
-- inteiros por "admin", "geral"/"gerais", "gastos", nada bateu):
--   ADM, Despesas Gerais. Hipótese: no relatório nativo NBS, essas duas são
--   RATEIO/ALOCAÇÃO calculado pelo motor do relatório (ex: % fixo sobre
--   nota fábrica, ou rateio de despesa administrativa da loja), não um
--   custo lançado por veículo em NBS.VEICULOS_CUSTOS_ESPECIFICOS. Não dá
--   pra popular via sync simples — precisa confirmar a fórmula de rateio
--   com alguém que opera o NBS. DECISÃO (Marcos, 02/10/2026): por isso
--   `custo_adm` e `custo_despesas_gerais`, diferente das outras 6 colunas
--   desta migration, são NULLABLE SEM DEFAULT — NULL = "não apurado",
--   explicitamente diferente de 0 ("fato conhecido de custo zero"). Fora
--   de escopo agora; ficam NULL até alguém mapear o cálculo.
--
-- ACHADO CRÍTICO DE COBERTURA (não tem relação com qual CODIGO_CUSTO usar,
-- mas afeta diretamente a utilidade de TODAS essas colunas): dos ~1.123
-- veículos em estoque hoje (STATUS='E', NOVO_USADO='U', CONSIGNATO='N'),
-- SÓ 22 têm NBS.VEICULOS.CUSTO_TOTAL_FINAL preenchido — os outros 1.101
-- estão NULL. Isso é um fato PRÉ-EXISTENTE do Oracle (não causado por esta
-- migration): o NBS só "fecha" o custo de um veículo em algum momento do
-- processo (provavelmente ligado a algum evento tipo chegada/transferência/
-- preparação), não no momento em que ele entra no estoque. Na prática,
-- essas 8 colunas novas (e o próprio custo_total que já existe hoje) vão
-- aparecer como 0/vazio pra ~98% do estoque atual, mesmo depois do sync
-- ser implementado — isso é esperado e não é bug do sync, é limitação de
-- dado de origem. Reportar pro Marcos antes de alguém estranhar "por que
-- quase todo carro está com custo zerado".
--
-- Validação adicional: nota_fábrica + Σ(categorias confirmadas) − valoriza
-- NÃO fecha exatamente com custo_total pra nenhum dos 15 veículos testados
-- (diffs de R$ -962 a R$ +46.355) — esperado, já que ADM/Despesas Gerais
-- (sem código) e as categorias de baixa confiança (zeradas na amostra) não
-- entraram na conta, e pode haver outros CODIGO_CUSTO (dos 541 totais) que
-- compõem custo_total sem corresponder a nenhuma das 8 categorias do
-- relatório "Custos de Veículos em Estoque". NÃO forçar essa soma bater.
--
-- Fora de escopo aqui (fica pro Dex, usando as queries acima como ponto de
-- partida): scripts/sync-nbs/mapear-veiculo.ts e qualquer código que
-- efetivamente leia NBS.VEICULOS_CUSTOS_ESPECIFICOS pra popular estas
-- colunas no dia a dia. Recomendação: seguir o padrão de valoriza.ts (query
-- sem JOIN filtrando só por CODIGO_CUSTO, cruzamento em memória via Map por
-- chassi_resumido+loja), rodando uma query por categoria (uma query com
-- MUITOS códigos num IN() grande — testamos com 73 — ficou lenta demais e
-- precisou ser cancelada depois de 15+ minutos; separar por categoria, como
-- valoriza.ts já faz, é mais lento no total mas previsível).
--
-- Idempotente (ADD COLUMN IF NOT EXISTS). Rodar 2x sem erro.
-- =====================================================================================

ALTER TABLE public.veiculos ADD COLUMN IF NOT EXISTS custo_revisoes        NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.veiculos ADD COLUMN IF NOT EXISTS custo_forplan         NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.veiculos ADD COLUMN IF NOT EXISTS custo_holdback        NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.veiculos ADD COLUMN IF NOT EXISTS custo_acessorios      NUMERIC(12,2) NOT NULL DEFAULT 0;
-- custo_adm e custo_despesas_gerais são NULLABLE, SEM DEFAULT (diferente das
-- outras 6 colunas desta migration): nenhum CODIGO_CUSTO foi encontrado pra
-- essas duas categorias (ver investigação abaixo) — aqui NULL = "não apurado"
-- (motor de rateio do NBS, não um custo lançado por veículo; não é fato
-- conhecido de zero). Decisão confirmada pelo Marcos em 02/10/2026: manter
-- a distinção em vez de forçar 0, pra não comunicar "custo zero" onde na
-- verdade é "não sabemos calcular isso ainda".
ALTER TABLE public.veiculos ADD COLUMN IF NOT EXISTS custo_adm             NUMERIC(12,2);
ALTER TABLE public.veiculos ADD COLUMN IF NOT EXISTS custo_impostos        NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.veiculos ADD COLUMN IF NOT EXISTS custo_comissoes       NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.veiculos ADD COLUMN IF NOT EXISTS custo_despesas_gerais NUMERIC(12,2);

COMMENT ON COLUMN public.veiculos.custo_revisoes IS
  'Categoria "Revisoes" do relatorio nativo NBS "Custos de Veiculos em Estoque". CODIGO_CUSTO (NBS.VEICULOS_CUSTOS_ESPECIFICOS): 154,250,269,280,300,301,302,303,547,558,559,560,561,562,563,564,565,566,567,568,569,570,571,573,574,575,576,577,606,629,630,631,650. Confianca MEDIA: nao-zero em 5/15 veiculos testados (R$230-16095), ordem de grandeza plausivel. NUNCA null: ausencia de custo lancado = fato conhecido (zero), mesmo padrao de valoriza.';

COMMENT ON COLUMN public.veiculos.custo_forplan IS
  'Categoria "Forplan sem HoldBack" do relatorio nativo NBS "Custos de Veiculos em Estoque". CODIGO_CUSTO candidato: 133 "Foorplan" (typo no NBS, nao "Forplan"). Confianca BAIXA: zerado nos 15 veiculos testados (mas codigo tem 163 mil linhas na base inteira). Alternativas nao desempatadas: 609 "Rebate Floor Plan", 522 "Bonus isencao de Floor Plan", 659 "Juros Floor Plan" — ver migration 040 para detalhes. NUNCA null: zero = fato conhecido ate confirmacao.';

COMMENT ON COLUMN public.veiculos.custo_holdback IS
  'Categoria "HoldBack" do relatorio nativo NBS "Custos de Veiculos em Estoque". CODIGO_CUSTO: 144 "Hold Back", 681 "Hold Back (Retido)". Confianca BAIXA: nome bate exato mas zerado nos 15 veiculos testados (codigo tem 150 mil linhas na base inteira). NUNCA null: zero = fato conhecido ate confirmacao.';

COMMENT ON COLUMN public.veiculos.custo_acessorios IS
  'Categoria "Acessorios" do relatorio nativo NBS "Custos de Veiculos em Estoque". CODIGO_CUSTO: 146 "Cortesia Acessórios", 424 "Acessórios", 640 "Acessorios Interno". Confianca BAIXA: zerado nos 15 veiculos testados (codigo tem 385 mil linhas na base inteira). NUNCA null: zero = fato conhecido ate confirmacao.';

COMMENT ON COLUMN public.veiculos.custo_adm IS
  'Categoria "ADM" do relatorio nativo NBS "Custos de Veiculos em Estoque". NENHUM CODIGO_CUSTO encontrado em NBS.CUSTOS_ESPECIFICOS (541 tipos, busca exaustiva por "admin" nao bateu) — hipotese: e rateio/alocacao calculado pelo motor do relatorio, nao um custo lancado por veiculo. NULLABLE SEM DEFAULT (diferente de valoriza/revisoes/impostos/etc): NULL = "nao apurado" (falta mapear o calculo), NAO "fato conhecido de custo zero" — por isso nao usa o padrao NOT NULL DEFAULT 0 das outras colunas desta migration. Fica NULL ate confirmar a formula de rateio com quem opera o NBS (fora de escopo agora).';

COMMENT ON COLUMN public.veiculos.custo_impostos IS
  'Categoria "Impostos" do relatorio nativo NBS "Custos de Veiculos em Estoque". CODIGO_CUSTO (ICMS/PIS/COFINS, varias variantes por loja): 142,143,268,363,404,409,410,413,414,420,422,423,437,490,526,572,605,623,686,690. Confianca ALTA: nao-zero em 14/15 veiculos testados, ordem de grandeza plausivel (~0,5-2% do custo_total). ATENCAO: codigo 490 "Imposto Comissao sobre Venda Direta" tambem aparece como candidato de Comissoes — ambiguo, atribuido aqui pra evitar dupla contagem. NUNCA null: zero = fato conhecido.';

COMMENT ON COLUMN public.veiculos.custo_comissoes IS
  'Categoria "Comissoes" do relatorio nativo NBS "Custos de Veiculos em Estoque". CODIGO_CUSTO candidatos: 129,239,273,297,447,490,498,529,545,658. Confianca BAIXA: ZERO nos 15 veiculos testados apesar do codigo ter 1,6 MILHAO de linhas na base inteira (maior volume de todas as categorias) — hipotese forte: comissao so e lancada na VENDA, nao enquanto o carro esta em estoque. Ver migration 040. NUNCA null: zero = fato conhecido ate confirmacao.';

COMMENT ON COLUMN public.veiculos.custo_despesas_gerais IS
  'Categoria "Despesas Gerais" do relatorio nativo NBS "Custos de Veiculos em Estoque". NENHUM CODIGO_CUSTO encontrado em NBS.CUSTOS_ESPECIFICOS (541 tipos, busca exaustiva por "geral"/"gerais" nao bateu) — mesma hipotese de custo_adm: provavel rateio/alocacao do motor do relatorio. NULLABLE SEM DEFAULT (diferente de valoriza/revisoes/impostos/etc): NULL = "nao apurado" (falta mapear o calculo), NAO "fato conhecido de custo zero". Fica NULL ate confirmar a formula de rateio com quem opera o NBS (fora de escopo agora).';

-- A view veiculos_atual lista colunas explicitamente (ver 014_veiculos_cod_proposta.sql
-- e 039_valoriza_bonus_fabrica.sql) — precisa incluir as 8 colunas novas pra
-- elas chegarem ao app. Recria preservando security_invoker=true, mesmo padrão
-- DROP + CREATE (não CREATE OR REPLACE) das migrations anteriores, pelo mesmo
-- motivo: CREATE OR REPLACE VIEW só permite adicionar colunas ao fim, não
-- reordenar/renomear as existentes.
DROP VIEW IF EXISTS veiculos_atual;
CREATE VIEW veiculos_atual
WITH (security_invoker = true) AS
SELECT
  id,
  snapshot_id,
  cod_empresa,
  chassi,
  placa,
  marca,
  modelo,
  ano_fabricacao,
  ano_modelo,
  cor_externa,
  combustivel,
  km,
  patio,
  descricao_situacao,
  preco_venda,
  valor_aquisicao,
  custo_total,
  dias_patio,
  data_entrada,
  vendedor_recebeu,
  cod_proposta,
  valoriza,
  custo_revisoes,
  custo_forplan,
  custo_holdback,
  custo_acessorios,
  custo_adm,
  custo_impostos,
  custo_comissoes,
  custo_despesas_gerais
FROM veiculos v
WHERE snapshot_id = (SELECT max(estoque_snapshots.id) FROM estoque_snapshots);
