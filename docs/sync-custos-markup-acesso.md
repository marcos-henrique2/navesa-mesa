# Automação do relatório de custos de estoque (markup)

## Resultado da investigação — 08/10/2026

O arquivo fornecido `RELATORIO  CUSTO DETALHADO 2.txt` registra a execução do relatório NBS `Rel5-007`. O relatório consulta os veículos e chama o motor de simulação de markup para cada veículo. A simples soma dos lançamentos de custos não reproduz necessariamente esse resultado.

A investigação utilizou somente consultas SELECT no Oracle. Nenhum pacote de cálculo, procedure, DML ou alteração de privilégios foi executado.

## Fonte oficial identificada no trace

1. Consulta de veículos a partir da linha 150, com as chaves `COD_EMPRESA`, `COD_PRODUTO`, `COD_MODELO` e `CHASSI_RESUMIDO` original (`chassi_resumido_chave`). O chassi exibido é extraído de `CHASSI_COMPLETO`; para usados, o relatório também apresenta `PLACA_USADO`.
2. A partir da linha 280, chamada `PKG_MARKUP_VEIC.CALCULAR_MARKUP_ESTOQUE` para cada veículo. O arquivo registra 289 chamadas.
3. Parâmetros observados: `ACODPROPOSTA=0`, `ATIPO='SIMULACAO'`, `ACOMISSAOVENDEDOR=-1`, `ACOMISSAOGERENTE=-1`, `ACONSIDERARFVRFVN='N'` e `ACONSIDERARDI='N'`. Vários parâmetros de preço/custo entram como zero e são devolvidos pela chamada.
4. Depois de cada chamada: `SELECT * FROM VEICULOS_MARKUP_TMP ORDER BY ORDEM` e `Commit`.

O trace não inclui as linhas retornadas pela consulta à TMP. Também não contém o corpo do pacote. O nome TMP e o parâmetro SIMULACAO não provam que o cálculo seja isento de alterações permanentes ou seguro para execução automática.

### Filtros do relatório capturado

- `VEICULOS.STATUS = 'E'`.
- `VEICULOS.NOVO_USADO = 'U'`.
- Empresas pertencentes à matriz 1.
- `VEICULOS.INTERNET NOT IN ('I', 'F')`.
- Junções com produtos, modelos, pátio e dados de holdback.

Esses filtros descrevem este relatório específico. A configuração de outras matrizes ou veículos novos precisa ser validada antes de ampliar a automação.

## Acesso verificado com a conta COMISSAO

- `SELECT * FROM NBS.VEICULOS_MARKUP_TMP WHERE 1=0` retorna `ORA-00942`.
- Os sinônimos públicos de `PKG_MARKUP_VEIC` e `VEICULOS_MARKUP_TMP` apontam para o schema NBS.
- `ALL_TAB_PRIVS` não apresenta privilégios nos objetos contendo MARKUP, inclusive EXECUTE no pacote.
- `ALL_SOURCE`, `ALL_ARGUMENTS`, `ALL_PROCEDURES`, `ALL_TAB_COLUMNS` e `ALL_TABLES` não expõem os objetos de markup para essa conta.
- `SESSION_PRIVS` apresenta apenas `CREATE SESSION`.
- `NBS.PARM_SYS` e `NBS.CP_MARKUP` também retornam `ORA-00942` em consultas sem linhas.
- `NBS.VEICULOS`, `NBS.VEICULOS_CUSTOS_ESPECIFICOS` e `NBS.CUSTOS_ESPECIFICOS` estão acessíveis para leitura.

A conta atual não permite verificar se `VEICULOS_MARKUP_TMP` é uma tabela temporária global, seu escopo por sessão, suas chaves, retenção no commit ou se o pacote realiza DML permanente, commit interno ou transação autônoma.

## Limites da implementação atual

`scripts/sync-nbs/custos-estoque-detalhado.ts` agrega `VALOR_FINAL` por listas de códigos e usa `TIPO=9` para despesas gerais. Essa abordagem não equivale ao motor de simulação identificado no trace.

- Exemplo consultado: chassi resumido `163765`, empresa 2, tem `VEICULOS.COM_FINAL_VENDEDOR=650`, enquanto o lançamento `CODIGO_CUSTO=129` tem `VALOR_FINAL=0`. Nem um nem outro, isoladamente, comprova a comissão simulada do relatório.
- Em `mapear-veiculo.ts`, mapa ausente é tratado como mapa vazio; `buscarCustoDetalhado` retorna zero para ausência. Isso pode representar custo não apurado como zero real.
- ADM não possui fonte oficial implementada.
- Há sobreposição entre listas e classificação: acessórios `146`, `424`, `640` e comissões `239`, `273`, `297`, `447`, `498`, `529`, `545`, `658` são também `TIPO=9`. Assim, entram nas categorias específicas e em despesas gerais. É necessário conhecer as regras do relatório para interpretar os subtotais; não se deve remover códigos sem essa validação.

## Pedido concreto ao responsável pelo NBS

Para automatizar fielmente o relatório, solicitamos uma das alternativas abaixo, com o menor acesso necessário.

### Alternativa A — informação para avaliar o cálculo oficial

Fornecer exportação do PACKAGE BODY de `NBS.PKG_MARKUP_VEIC`, em especial `CALCULAR_MARKUP_ESTOQUE`, e dos trechos/pacotes auxiliares efetivamente chamados por essa rotina. Fornecer também:

- DDL ou metadados de `NBS.VEICULOS_MARKUP_TMP`: colunas, tipos, chaves/índices, indicação TEMPORARY e DURATION, definição de retenção no commit e regras de isolamento entre sessões/usuários.
- Assinatura completa da rotina e significado dos valores `SIMULACAO`, `-1`, FVR/FVN e DI.
- Identificação de todos os efeitos: gravações permanentes, updates em VEICULOS/custos, commits internos, transações autônomas e dependência do usuário/sessão/configuração da empresa.
- Mapeamento das linhas ORDEM/TIPO/DESCRICAO para as categorias exibidas no relatório, com regras de arredondamento.

A exportação pode ser entregue como arquivo; não é necessário conceder acesso geral ao schema. Somente depois dessa avaliação deve ser considerada uma permissão específica de execução, caso seja comprovadamente segura e necessária.

### Alternativa B — interface somente leitura suportada pelo NBS

Disponibilizar uma view ou API de leitura com o resultado oficial atualizado do relatório, contendo:

- Chave composta: empresa, produto, modelo e chassi resumido original; placa/chassi completo para conferência.
- Data/hora de cálculo e parâmetros/configuração usados, inclusive condição novo/usado e flags FVR/FVN/DI.
- Valores oficiais de impostos, revisões, acessórios, comissões, despesas gerais, ADM, forplan, holdback e total, além das demais parcelas necessárias para reconciliar o relatório.
- Indicação explícita de valores não apurados, separada de zero.
- Definição de atualização e validade dos resultados, garantindo cobertura dos veículos em estoque.

Para uma view, conceder apenas SELECT nessa interface à conta COMISSAO. Não é solicitado GRANT amplo nem acesso de gravação.

## Validação antes de ativar

Comparar a saída automática com um relatório NBS emitido no mesmo período e com os mesmos filtros/configuração, incluindo veículos com impostos e comissões simulados, ADM e despesas gerais. A validação deve reconciliar cada categoria e total ao centavo e distinguir ausência de informação de zero verdadeiro.

Até existir uma fonte oficial acessível e validada, não executar o pacote às cegas nem afirmar que somas heurísticas reproduzem integralmente o relatório.

## Comparação com exportações oficiais de 08/10/2026

O PDF `custos estoque.pdf`, Filial Todos, contém 287 placas únicas, todas encontradas no Oracle. Comparação por veículo, com arredondamento em centavos:

- Nota (`TOTAL_NOTA_FABRICA - CREDITO_ICMS`) e despesas gerais (`TIPO=9`) conferem em 287/287.
- Revisões por classificação `NBS.CUSTOS_ESPECIFICOS.TIPO=7` e ganhos indiretos por `NBS.CUSTOS_ESPECIFICOS.TIPO=11` conferem em 287/287. Listas fixas de códigos de revisão divergem em 19 veículos.
- `CUSTO_FORPLAN_FINAL` diverge em 276/287; impostos por listas divergem em 286/287. `CUSTO_TOTAL_FINAL` diverge nos 287 veículos. Esses valores finais não substituem o cálculo simulado do relatório.
- As listas de comissão deixam zerados os 18 veículos com comissão positiva no PDF.
- ADM, acessórios, HoldBack e bônus estão zerados nos 287 veículos do PDF; isso não valida suas fontes para casos positivos.
- O total oficial é R$ 48.823.680,93. As parcelas com ganhos indiretos abatidos reconciliam os 287 veículos.

O leitor do PDF deixava de capturar R$ 7,11 de lucro bruto da placa TFU0G74 porque a posição X do número ficava fora da faixa. A faixa foi corrigida e testada. O exportador passa a priorizar o Forplan do PDF quando disponível (inclusive zero) e a indicar divergência da fonte automática. Essas alterações de frontend precisam ser publicadas para aparecer no site.

O XLS `custo detalhados.xls` contém 84 vendidos de 01 a 08/10/2026: todos os componentes e custos totais conferem com a nova sincronização, somando R$ 11.598.468,39. Uma placa, TFW5A62, apresenta venda/margem brutas no XLS e líquidas no SQL fornecido, devido ao desconto incondicional de R$ 20.444,43. O percentual do próprio XLS é líquido. Mantida a regra explícita do SQL, sem trocar bases silenciosamente.

Os arquivos foram usados para comparação; nenhum destes dois relatórios foi importado no banco durante essa análise. A automação integral do markup ainda depende da fonte oficial descrita acima.