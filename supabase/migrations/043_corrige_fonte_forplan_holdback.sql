-- Navesa Mesa — Migration 043: corrige a fonte documentada de custo_forplan/custo_holdback
-- =====================================================================================
-- Migration 040 (01/10/2026) mapeou custo_forplan/custo_holdback pra candidatos de
-- CODIGO_CUSTO em NBS.VEICULOS_CUSTOS_ESPECIFICOS (133 "Foorplan" / 144+681 "Hold Back"),
-- com confiança BAIXA porque vieram zerados numa amostra pequena (15 veículos). Essas
-- colunas JÁ EXISTEM e JÁ ESTÃO POPULADAS em produção — esta migration NÃO faz
-- ALTER TABLE nenhum, só corrige a documentação (COMMENT ON COLUMN) com a fonte certa.
-- O fix de verdade (código) está em scripts/sync-nbs/mapear-veiculo.ts e
-- scripts/sync-nbs/custos-estoque-detalhado.ts (ver commits desta mesma mudança) — essa
-- migration só garante que o schema conta a mesma história.
--
-- INVESTIGAÇÃO 05/10/2026 (Dara, a pedido do Marcos): Marcos trouxe o relatório nativo
-- NBS "Custos de Veículos em Estoque" de hoje (PDF, 8 páginas, 283 veículos) mostrando
-- Forplan sem HoldBack com valor REAL (não-zero) em praticamente todo carro — contradizia
-- direto a confiança BAIXA de 040. Decodificado o bug de renderização do PDF (texto de
-- Placa/Modelo intercalado caractere-a-caractere entre duas linhas sobrepostas) pra achar
-- 2 veículos com certeza (AMAROK placa RBV7G98, BOREAL placa TFJ3B59) e, a partir deles,
-- cruzado CHASSI_RESUMIDO+COD_EMPRESA direto no Oracle sem filtro de código nenhum
-- (WHERE CHASSI_RESUMIDO=? AND COD_EMPRESA=?) contra NBS.VEICULOS_CUSTOS_ESPECIFICOS:
-- NENHUM CODIGO_CUSTO lançado pro veículo (nem os 4 candidatos de 040, nem nenhum outro)
-- somava o valor de Forplan do PDF.
--
-- ACHADO: Forplan sem HoldBack NÃO é um CODIGO_CUSTO em NBS.VEICULOS_CUSTOS_ESPECIFICOS
-- — é uma COLUNA DIRETA em NBS.VEICULOS: CUSTO_FORPLAN_FINAL. Confirmado batendo EXATO
-- (ao centavo) em 3 veículos diferentes (2 marcas):
--   - AMAROK, chassi 163765/empresa 2, placa RBV7G98: CUSTO_FORPLAN_FINAL=9.667,36 =
--     Forplan do PDF (9.667,36). HOLD_BACK_FINAL=0 = HoldBack do PDF (0,00).
--     CUSTO_TOTAL_FINAL=137.013,48 também bate com o Oracle (mas NÃO bate com a coluna
--     "CustoTotal" do PDF, 144.111,28 — ver nota "CustoTotal do PDF" abaixo).
--   - RANGER XLT 3.0 CD, chassi 175371/empresa 2, placa SGF9C59: CUSTO_FORPLAN_FINAL=
--     4.428,40 = Forplan do PDF (4.428,40).
--   - RANGER 2.2 XLS 4X4, chassi 179000/empresa 9, placa SCA5E72 (achado via lista de
--     veículos "fechados" no Oracle, cruzado por valor): CUSTO_FORPLAN_FINAL=9.503,67,
--     consistente com o padrão.
-- NBS.VEICULOS também tem HOLD_BACK_FINAL (coluna direta, mesmo padrão) — nos 283
-- veículos do PDF de hoje, HoldBack vem 0,00 em TODOS (sem exemplo não-zero pra validar
-- o valor), mas a fonte (coluna direta, não CODIGO_CUSTO) segue o mesmo raciocínio.
--
-- NOTA "CustoTotal do PDF": a coluna "CustoTotal" do relatório nativo NÃO é
-- NBS.VEICULOS.CUSTO_TOTAL_FINAL direto — é um valor CALCULADO pelo motor do relatório
-- (Nota Fábrica + soma das 8 categorias da página, incluindo ADM/Despesas Gerais que são
-- rateio, não lançamento). Confirmado batendo exato pro AMAROK: 115.000,00 (Nota Fábrica,
-- derivada por diferença) + 9.667,36 (Forplan) + 2.740,80 (Impostos) + 16.703,12 (Desp.
-- Gerais) = 144.111,28 = CustoTotal do PDF. Isso NÃO afeta custo_total (que já documenta
-- corretamente vir de CUSTO_TOTAL_FINAL desde a migration original) — só explica por que
-- CUSTO_TOTAL_FINAL do Oracle (137.013,48) e "CustoTotal" do PDF (144.111,28) divergem
-- pro mesmo veículo: não são a mesma coisa, nunca foram.
--
-- ACHADO EM ABERTO (não resolvido, documentado pra não forçar resposta errada): Comissões
-- também foi testado contra o mesmo RANGER (chassi 175371/empresa 2) — PDF mostra
-- Comissões=R$406,48 e Impostos=R$3.296,65, mas os CODIGO_CUSTO lançados pro veículo (via
-- WHERE sem filtro) não têm nenhuma combinação óbvia que some R$406,48, e os códigos de
-- Impostos já mapeados (142 ICMS + 143 PIS/COFINS = R$2.953,96) deixam ~R$342,69 sem
-- explicação. HOLD_BACK_FINAL confirma a hipótese "campo direto" só por analogia
-- estrutural (ambas 0 em todos os 283 exemplos, não há exemplo não-zero pra provar o
-- valor). custo_acessorios/custo_comissoes CONTINUAM confiança baixa, códigos
-- inalterados — não mude sem revalidar com mais veículos (idealmente um com Comissões
-- não-zero decodificado com certeza, ou acesso a NBS.VEICULOS.COMISSAO_* pra descartar).
--
-- Idempotente (COMMENT ON COLUMN sempre substitui o anterior). Rodar 2x sem erro.
-- =====================================================================================

COMMENT ON COLUMN public.veiculos.custo_forplan IS
  'Categoria "Forplan sem HoldBack" do relatorio nativo NBS "Custos de Veiculos em Estoque". FONTE CORRIGIDA 05/10/2026: coluna DIRETA NBS.VEICULOS.CUSTO_FORPLAN_FINAL (NAO um CODIGO_CUSTO em VEICULOS_CUSTOS_ESPECIFICOS como se pensava na migration 040 original). Confianca ALTA: confirmado batendo ao centavo contra o relatorio nativo PDF em 3 veiculos (AMAROK chassi163765/empresa2 placa RBV7G98: 9667.36; RANGER chassi175371/empresa2 placa SGF9C59: 4428.40; RANGER chassi179000/empresa9 placa SCA5E72: 9503.67). Ver scripts/sync-nbs/mapear-veiculo.ts (candidato de coluna, mesmo padrao de custo_total) e migration 043. NUNCA null: ausencia de valor (NULL no Oracle) e tratada como zero = fato conhecido.';

COMMENT ON COLUMN public.veiculos.custo_holdback IS
  'Categoria "HoldBack" do relatorio nativo NBS "Custos de Veiculos em Estoque". FONTE CORRIGIDA 05/10/2026: coluna DIRETA NBS.VEICULOS.HOLD_BACK_FINAL (mesmo padrao de custo_forplan, NAO um CODIGO_CUSTO em VEICULOS_CUSTOS_ESPECIFICOS). Confianca BAIXA MANTIDA: fonte corrigida por analogia estrutural com custo_forplan, mas sem exemplo nao-zero no PDF de 05/10/2026 (283 veiculos testados, todos R$0,00) pra confirmar o valor de fato. Ver migration 043. NUNCA null: zero = fato conhecido ate confirmacao com um veiculo com HoldBack real.';

COMMENT ON COLUMN public.veiculos.custo_impostos IS
  'Categoria "Impostos" do relatorio nativo NBS "Custos de Veiculos em Estoque". CODIGO_CUSTO (ICMS/PIS/COFINS, varias variantes por loja): 142,143,268,363,404,409,410,413,414,420,422,423,437,490,526,572,605,623,686,690. Confianca ALTA: nao-zero em 14/15 veiculos testados, ordem de grandeza plausivel (~0,5-2% do custo_total). ATENCAO (revalidado 05/10/2026, ainda em aberto): pelo menos 1 veiculo (RANGER chassi175371/empresa2) tem ~R$342,69 do Impostos do PDF sem explicacao pelos codigos 142/143 lancados — pode haver mais um codigo de imposto fora da lista atual, nao investigado a fundo nesta rodada. Codigo 490 "Imposto Comissao sobre Venda Direta" tambem aparece como candidato de Comissoes — ambiguo, atribuido aqui pra evitar dupla contagem. NUNCA null: zero = fato conhecido.';

COMMENT ON COLUMN public.veiculos.custo_comissoes IS
  'Categoria "Comissoes" do relatorio nativo NBS "Custos de Veiculos em Estoque". CODIGO_CUSTO candidatos: 129,239,273,297,447,498,529,545,658. Confianca BAIXA MANTIDA (revalidado 05/10/2026): testado contra 1 veiculo com Comissoes real no PDF (RANGER chassi175371/empresa2, R$406,48) e NENHUMA combinacao dos codigos lancados pro veiculo bate com esse valor — diferente de custo_forplan/custo_holdback, Comissoes pode nao ser nem CODIGO_CUSTO nem coluna direta simples; fonte real ainda em aberto. Ver migration 043. NUNCA null: zero = fato conhecido ate confirmacao.';