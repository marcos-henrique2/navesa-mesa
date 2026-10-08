# Auditoria — Vendas Usados Matriz, outubro/2026

Arquivo analisado: `C:/Users/marcos.jesus/Desktop/vendas-usados-outubro-matriz (2).xlsx`.
Consultas de leitura no Oracle e Supabase realizadas em 08/10/2026, aproximadamente 16h35–16h37, horário de Brasília. O arquivo foi salvo às 16h32. Bancos ativos podem mudar após essa conferência.

## Conclusão

A planilha é consistente com suas próprias fórmulas, mas ainda não representa integralmente a margem oficial do NBS. Foram conferidas as nove abas, 778 fórmulas e seus resultados armazenados. Não foram encontrados erros Excel, resultados ausentes ou placas duplicadas. A conferência das fórmulas foi independente, sem abrir/recalcular o arquivo no Excel instalado.

As 26 linhas existentes conferem com as vendas do sistema e com o Oracle quanto a placa, modelo, cliente, vendedor, quilometragem, data da venda, Valoriza e valor bruto vendido. Os campos financeiros exportados conferem com o Supabase consultado. Isso não significa que todos os campos do Supabase estejam atualizados frente ao Oracle: foi localizada uma diferença de despesas gerais de R$ 1.700,00.

## Conferência das nove abas

| Aba | Conferência | Resultado e limite |
|---|---|---|
| VENDAS USADOS OUTUBRO MATRIZ | 26 linhas; fórmulas por carro e totais | 23 não consignados e 3 consignados; margens diferem do NBS em dois carros. FIPE agregada inválida por cobertura de apenas um carro. |
| VENDAS OUTUBRO SÓ ESTOQUE | 10 linhas; origem e totais | Subconjunto do estoque de origem da Ford Aeroporto consistente. FIPE agregada também usa populações diferentes. |
| RESUMO VENDAS MATRIZ OUTUBRO | Contagens, canais, consignados, vendedor e dias | Contas consistentes. 11 canais não informados. Diferentes seções incluem/excluem consignados e Auto Avaliar; explicitar as populações. |
| MARGENS | Total não consignado, origem própria e outras lojas | Total comparável de 23 carros: −R$ 198.053,42; NBS atual: −R$ 220.367,85. |
| MARGENS VENDAS LOJISTAS | Critérios e totais | Contas corretas para classificados. Clientes sem canal ficam de fora. PJ é aproximação de lojista, não comprovação do canal comercial. |
| MARGENS VENDAS CLIENTES | Critérios e totais | Contas corretas para classificados. As duas abas de canal juntas cobrem apenas 12 dos 23 não consignados. |
| MÉDIA VENDEDOR 2025 | Soma e média | Total 537, média 107,4 (5 meses). Valores fixos do modelo, não sincronizados com NBS. |
| MEDIA 2026 | Contagens e 139 fórmulas | Janeiro–junho 570, contra 628 vendas válidas no NBS: faltam 58. Julho/agosto conferem. Setembro exige esclarecer dois registros do mesmo VIN. Outubro aberto é excluído por regra existente. |
| PLAY PLAN VENDEDOR INFLUENCER | Faixas e prêmios | Tabela fixa, sem sobreposição detectada nas faixas. Não calcula pagamento individual efetivo por vendedor. |

## Divergências de margem confirmadas

Comparação restrita às mesmas 23 placas não consignadas presentes no arquivo, sem incluir as duas vendas que aparecem posteriormente na base do sistema.

| Placa / célula | Planilha | NBS atual | Explicação |
|---|---:|---:|---|
| TFW5A62 / O7 | R$ 170.444,43 | R$ 150.000,00 líquidos | Desconto incondicional de R$ 20.444,43 não abatido na venda da matriz. |
| TFW5A62 / AA7 | R$ 31.776,99 | R$ 11.332,56 | Mesma diferença do desconto. |
| TFW5A62 / AB7 | 18,64% | 7,56% | Numerador e denominador usam bases diferentes. |
| SDC2J60 / AA16 | −R$ 58.045,49 | −R$ 59.915,49 | Oficina R$ 170,00 não entra na fórmula da matriz; despesas gerais no Supabase/PDF exportado são R$ 15.293,26, contra R$ 16.993,26 atuais no Oracle. |

Ponte do total comparável: −R$ 198.053,42 − R$ 20.444,43 − R$ 170,00 − R$ 1.700,00 = −R$ 220.367,85. O motivo temporal da diferença adicional de R$ 1.700,00 não foi demonstrado; ela foi confirmada em duas consultas. O cálculo atual dos custos vendidos aprova a linha da SDC2J60 e reproduz o total do Oracle. Revalidar depois da próxima sincronização antes de atribuir essa diferença a falha permanente da rotina.

A fórmula da matriz é gerencial: venda bruta − (nota líquida − Valoriza) − despesas gerais − Forplan − impostos − comissões − ADM. A composição oficial considera também oficina, frete, ganhos indiretos e, quando aplicável, desconto/deságio. Valoriza não equivale universalmente a todos os ganhos indiretos. Recomenda-se apresentar a margem oficial NBS separada da margem gerencial, com definição explícita, em vez de trocar a regra existente silenciosamente.

## FIPE

Apenas PRA5C20 possui FIPE preenchida: R$ 84.336,00 e venda de R$ 57.000,00, correspondendo a 67,59% da FIPE. A razão total em `P32` divide a receita dos 26 carros por essa única FIPE e mostra 4.678,84%. A aba Só Estoque, `P16`, mostra 1.884,60% pelo mesmo motivo.

Usar somente carros com venda e FIPE válidas tanto no numerador quanto no denominador, e mostrar cobertura: 1/26 na aba principal e 1/10 em estoque próprio. Não preencher os outros carros com FIPE estimada sem validação.

## Cobertura e classificações

- Canal ausente em 11 vendas: receita R$ 1.796.934,43 e margem gerencial −R$ 121.551,06. As abas clientes/lojistas apresentam apenas R$ −76.502,36 de margem combinada, porque excluem esse grupo.
- O total `AA32`, −R$ 193.803,42, inclui os três consignados. `MARGENS!D15`, −R$ 198.053,42, os exclui. Os consignados adicionam R$ 4.250,00 calculados com despesas gerais/impostos/ADM ausentes. Identificar essa diferença e não tratar dados não apurados como zero real.
- Todos os 26 valores da coluna COR (`E4:E29`) são códigos numéricos do Oracle. Reusar/validar o mapeamento de nomes de cor já existente na integração do estoque.
- “Usado na troca” usa fonte ainda não confirmada; ausência de placa de troca pode produzir NÃO sem comprovar que não houve troca.
- Comissão detalhada representa gerente + vendedor + terceiros; o fallback é só vendedor. O rodapé “COMISSÃO VENDEDOR” deve ser uniformizado com a métrica efetivamente usada.
- A base consultada já contém 28 vendas da loja em outubro. SDB6C88 (R$ 173.000,00) e RCE2A28 (R$ 89.900,00) não estão no arquivo enviado. Regenerar após a sincronização completa; isso, isoladamente, não demonstra erro de seleção do relatório.

## Melhorias prioritárias

1. Separar margem oficial NBS e gerencial; mostrar desconto, oficina, frete e demais parcelas que expliquem a diferença.
2. Corrigir a população usada no percentual FIPE e apresentar cobertura.
3. Mostrar grupo “canal não informado” nos totais financeiros e consultar a classificação correta de cliente/lojista no NBS.
4. Separar consignados nos totais e indicar custos não apurados; não converter ausência em zero silenciosamente.
5. Conferir a atualização dos custos depois da sincronização e mostrar data/hora e cobertura das fontes antes de gerar.
6. Completar a carga histórica para médias anuais, preservando duplicatas/eventos corretamente.
7. Incluir data de venda e chassi no detalhe, nomes das cores e rótulos de comissão consistentes.
8. Cruzar custo com o evento/data de venda, além da placa. O arquivo atual tem custos com a data correta para os 23 não consignados, mas a implementação atual pode cruzar custo de outra revenda em períodos históricos.
9. Identificar as abas de 2025 e Play Plan como referências fixas e registrar vigência/origem das regras.

Nenhuma célula do Excel, rotina de produção ou dado de Oracle/Supabase foi alterado nesta auditoria.
## Cobertura histórica confirmada — MEDIA 2026

| Mês | Planilha / Supabase | Oracle | Faltantes |
|---|---:|---:|---:|
| Janeiro | 98 | 105 | 7 |
| Fevereiro | 99 | 108 | 9 |
| Março | 118 | 127 | 9 |
| Abril | 112 | 119 | 7 |
| Maio | 82 | 97 | 15 |
| Junho | 61 | 72 | 11 |
| Total | 570 | 628 | 58 |

As 58 ausências são vendas STATUS V, loja vendedora 2 e vendedores identificados: 37 consignadas e 21 próprias. Nenhuma pertence ao Auto Avaliar. O indicador EXTRA=0 nas consignadas não as invalida para a contagem adotada nesta aba.

A média mensal do semestre (J28) muda de 95 para 104,6667. Mantido o tratamento atual de setembro, a diferença entre a média de julho–setembro e a do primeiro semestre (P28) muda de −5,6667 para −15,3333. Siumara Miguel tem uma venda no NBS e não possui linha na planilha.

Setembro contém dois registros vendidos da TGD4A97, mesmo VIN LGWFFUA5XTJ610701 e vendedor Francisco Neto: propostas 20245950 (09/09, empresa 86, modelo 4126967) e 20246013 (10/09, empresa 2, modelo 4127154). Não é duplicação de JOIN. Esclarecer o evento/cadastro antes de substituir a contagem atual de uma venda por duas.

O vendedor Auto Avaliar aparece no histórico com duas grafias: MOZAINEL CORREA e MOZAINIEL CORREA. A aba anual inclui ambas. Normalizar vendedores por identificador estável e manter nomes históricos/aliases evita separar a mesma pessoa em duas linhas.