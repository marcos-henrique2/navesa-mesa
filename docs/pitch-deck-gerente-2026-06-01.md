# MESA DE PRECIFICAÇÃO SEMINOVOS
## Material Executivo — Apresentação Diretoria

**Autor:** Marcos Henrique | **Data:** 01/06/2026 | **Período analisado:** 02/01 a 29/05/2026 (4,8 meses, 1.636 vendas)

---

## PÁGINA 1 — PITCH EXECUTIVO

**Em 4,8 meses, 1.182 das 1.636 vendas (72%) saíram abaixo da nossa própria tabela do NBS. A diferença acumulada é R$ 13,9 milhões. Não sei ainda quanto disso é capturável — mas sei como descobrir em 60 dias, com risco controlado e zero impacto em taxa de fechamento.**

### Os 3 fatos que mudam a conversa

| # | Fato medido | Leitura |
|---|---|---|
| 1 | **R$ 13,9M de diferença** vs `preco_venda_tabela` em 4,8 meses (anualização ilustrativa: R$ 34,4M/ano) | Não é caixa perdido. É margem teórica não capturada. Quanto é real, o piloto mede. |
| 2 | **70% concentrado em 2 lojas Ford** — Aeroporto (R$ 6,2M) + CIAASA (R$ 3,5M) | Aeroporto fecha 86% das vendas abaixo da tabela. Padrão sistêmico de uma operação, não ruído. |
| 3 | **57% da perda em carros 0–30 dias de pátio** | Contraintuitivo: o problema NÃO é estoque parado. É fechamento sem referência na tela. |

### O que pedimos

**Piloto de 60 dias em Navesa Ford Aeroporto. 1 sponsor. 1 KPI.**

| Item | Compromisso |
|---|---|
| **Escopo** | Loja de maior sangria absoluta (R$ 6,2M/ano ilustrativo) |
| **Sponsor** | 1 diretor Ford com autoridade sobre política de desconto |
| **Cronograma honesto** | Semanas 1–4: fechar HIGH debts técnicos (race FIPE, fórmula mínimo) + auth multi-loja + CI/CD. Semanas 5–8: piloto operacional com medição. |
| **Intervenção** | **Alerta + segunda assinatura, NÃO bloqueio duro.** Toda venda passa pela tela do diagnóstico antes do contrato. Desconto > 5% exige aprovação do gerente. |
| **KPI único** | % de vendas dentro de ±3% da tabela (hoje: 26,1%) |
| **Investimento** | ~4 semanas de dev (time interno) + R$ 230/mês infra. Sem capex de balanço; com custo de oportunidade reconhecido. |

**Critério de parada:** se em 60 dias a taxa de fechamento cair >5pp ou o ticket médio cair mais do que a margem recuperada, recuamos. Se mover o KPI sem queimar conversão, replicamos pra CIAASA.

### Por que agora

O sistema existe (13 módulos em produção interna, 42/42 testes, RLS ativa, diagnóstico versionado por veículo). Não estamos pedindo budget pra construir — estamos pedindo autorização pra **medir num ambiente real** se mudar comportamento de fechamento move o KPI. O downside é 4 semanas de dev. O upside é desativar a maior fonte de erosão de margem que conseguimos medir.

---

## PÁGINA 2 — ANÁLISE DE DADOS (parte 1)

### Distribuição de 1.636 vendas vs `preco_venda_tabela` do NBS

| Faixa | Vendas | % | R$ diferença acumulada |
|---|---:|---:|---:|
| **Subprec grave (< -7%)** | 642 | 39,2% | **R$ 9.589.082** |
| **Subprec leve (-7% a -3%)** | 540 | 33,0% | R$ 4.315.890 |
| Coerente (±3%) | 427 | 26,1% | — |
| Neutro (+3% a +5%) | 11 | 0,7% | — |
| Acima do mercado (>+5%) | 16 | 1,0% | — |
| **TOTAL deixado na mesa** | **1.182** | **72,2%** | **R$ 13.904.973** |

**Leitura honesta:** em cada 10 vendas, 4 saem com desconto pesado (>7%), 3 com desconto leve, 3 no preço alvo. A exceção virou regra. A média de diferença nas vendas "graves" é R$ 14.937/carro — dentro do range normal de negociação automotiva brasileira (8–15%), o que reforça que parte significativa pode ser elasticidade legítima de mercado, não erro puro.

### Top 5 lojas por R$ acumulado

| Loja | Vendas subprec / total | % subprec | R$ acumulado |
|---|---:|---:|---:|
| **NAVESA FORD AEROPORTO** | 447 / 519 | **86,1%** | **R$ 6.248.329** |
| **CIAASA FORD** | 306 / 389 | **78,7%** | **R$ 3.478.371** |
| NAVESA FORD APARECIDA | 90 / 163 | 55,2% | R$ 887.697 |
| NAVESA RENAULT T-63 | 113 / 206 | 54,9% | R$ 826.027 |
| NAVESA FORD ANÁPOLIS | 50 / 66 | 75,8% | R$ 725.960 |

**As 2 maiores Ford concentram R$ 9,7M (70% do total).** Importante: estamos olhando R$ absoluto E taxa de subprec. Aeroporto não lidera só por volume — lidera também em frequência (86% vs média geral 72%). Mesmo controlando volume, há padrão. Validação por mix (faixa de preço, origem do usado) está prevista antes do piloto.

---

## PÁGINA 3 — ANÁLISE DE DADOS (parte 2)

### A descoberta que muda a tese: perda por dias de estoque

| Faixa dias pátio | Vendas | Subprec | % subprec | R$ acumulado |
|---|---:|---:|---:|---:|
| **0–30 dias** | 838 | 652 | **77,8%** | **R$ 7.910.040** |
| 31–60 dias | 306 | 214 | 69,9% | R$ 2.393.041 |
| 61–90 dias | 186 | 124 | 66,7% | R$ 1.448.250 |
| 91–180 dias | 230 | 155 | 67,4% | R$ 1.708.049 |
| >180 dias | 76 | 37 | 48,7% | R$ 445.593 |

**O insight:** 57% da diferença total (R$ 7,9M) está em carros vendidos com 0–30 dias de pátio. Carros >180 dias representam apenas 3,2% da diferença (R$ 446k).

**Por que isso importa:** a tese clássica — "estoque parado destrói margem" — está errada para nosso caso. O carro parado >180 dias sai com 48,7% de subprec; o carro fresquinho sai com 77,8%. **O problema não é girar estoque. É fechar sem referência de preço na tela do vendedor no momento do fechamento.**

Caveat metodológica honesta: carros 0–30 dias representam volume desproporcionalmente maior (838 vendas = 51% do total), então R$ absoluto naturalmente concentra ali. Mesmo assim, a **taxa** de subprec (77,8% vs 48,7% no estoque velho) confirma o padrão.

### Validação secundária via FIPE (subset menor)

Para checar se a tabela do NBS não está sistematicamente inflada, cruzamos com FIPE em n=63 vendas (3,8% da amostra — subset com cobertura completa).

- Diferença acumulada anualizada por essa lente: **R$ 3,25M/ano** (uma ordem de grandeza abaixo da versão tabela)
- Classe B (intermediários — HB20, Onix, Polo, Ka, Argo): 36/43 subprec (83,7%) — R$ 831.873
- Maior diferença unitária: Mustang 2024 a R$ 59.900 abaixo da FIPE (n=1, anedota — pode ser troca casada ou unidade com avaria)

**A verdade está em algum lugar entre R$ 3,25M e R$ 34,4M anualizado.** Antes do piloto, comprometemos cruzamento adicional com Mercado Livre/OLX em amostra de 200 vendas das duas Ford. Se a tabela estiver consistentemente acima do mercado, o piloto muda de escopo (recalibrar tabela em vez de bloquear desconto).

---

## PÁGINA 4 — LIÇÕES OPERACIONAIS

### Para diretor de loja Ford (foco Aeroporto e CIAASA)

**1. O problema não é o carro parado — é o carro que sai rápido demais.**
57% da diferença está em 0–30 dias. Quando entra demanda, o vendedor fecha com desconto agressivo "pra não perder o cliente" — e ninguém percebe que R$ 5–15k de desconto era desnecessário (ou era — só medindo saberemos).

**2. Subprec grave virou regra.** 39,2% das vendas saem com >7% de desconto. Média: R$ 14.937/carro. Não é exceção pra trabalhar caso a caso — é padrão sistêmico que pede mudança de processo.

**3. Classe B é onde o piloto automático mais entra.** Carros que "todo mundo sabe vender" (HB20, Onix, Polo) saem com 83,7% de subprec na amostra FIPE. É exatamente onde o vendedor mais relaxa.

**4. Alto ticket precisa de segunda camada.** Mustang R$ 60k abaixo — sem alerta, sem segunda assinatura. Independente do contexto da venda, decisão de R$ 60k em desconto não pode estar na mão de um vendedor sozinho.

### Rotina diária sugerida para o diretor sponsor

| Horário | Ação | Tempo |
|---|---|---|
| 8h–9h | Abrir tela "Hoje": % vendas D-1 dentro de ±3%, overrides realizados, top 3 carros 0–30d em risco | 10 min |
| 9h | Huddle com vendedores: número da loja vs meta, regra do dia ("desconto >5% passa por mim") | 10 min |
| Durante o dia | Assinar pessoalmente toda solicitação de desconto >5%. Sem WhatsApp, sem delegação. | sob demanda |
| 18h | Revisar as 5 maiores diferenças do dia. Padrão de vendedor? Padrão de segmento? **Sem punição — entender.** | 15 min |
| Sexta | Revisar curva dias-estoque vs % subprec. Se perde mais em 0–30d que em 90+d, problema é disciplina, não giro. | 20 min |

### A frase para colar na mesa de vendas

> **"Carro que sai rápido demais não é vitória — é diferença que pode estar ficando na mesa do cliente."**

---

## PÁGINA 5 — ROADMAP 90 DIAS

### Fase 1 — Semanas 1–4: Pré-piloto (fechar dívida técnica + validar tabela)

| Iniciativa | Justificativa | Saída |
|---|---|---|
| **Fix HIGH debts: race FIPE batch + fórmula mínimo abaixo de custo** | Diagnóstico precisa estar correto antes de aparecer na tela do vendedor. Um erro = perda de credibilidade permanente. | Diagnóstico confiável p95 <2s |
| **Auth multi-tenant + RLS por loja + CI/CD básico** | Pré-requisito pra delegar uso pros gerentes sem misturar dados. | Pronto pra 10–50 usuários |
| **Auditoria de 200 vendas Aeroporto+CIAASA vs Mercado Livre/OLX** (Alex) | Validar se tabela NBS está calibrada ou se está sistematicamente acima do mercado. **Pode mudar todo o piloto.** | Decisão: bloquear desconto OU recalibrar tabela |
| **Auditoria qualitativa de 50 deals "subprec grave"** | Foi troca casada? Pressão de meta? Bônus de montadora? Definir causa-raiz antes de codar. | Hipótese testável |

**Captura esperada na Fase 1:** R$ 0. Esta fase é investimento em qualidade de evidência.

### Fase 2 — Semanas 5–8: Piloto Aeroporto

| Iniciativa | Como funciona | Captura ilustrativa* |
|---|---|---|
| **Diagnóstico no fechamento (alerta + 2ª assinatura, NÃO bloqueio duro)** | Vendedor lança proposta → sistema mostra: "Este preço está R$ X abaixo da tabela / FIPE / histórico 90d. Aprovação do gerente necessária se < -5%." | Se capturar 30% da diferença Aeroporto: ~R$ 156k/mês |
| **Daily huddle automatizado** | Relatório 8h: vendas D-1, % subprec, top 3 piores deals. Ritual de exposição. | Comportamental — não estimável a priori |
| **Medição rigorosa de 3 variáveis** | (1) Taxa de fechamento antes vs depois, (2) ticket médio, (3) tempo até venda | Gate de continuidade |

\*Ilustrativo, assumindo que R$ 6,2M/ano em Aeroporto é capturável. Se a auditoria FIPE/ML revelar que metade é elasticidade legítima, recalibramos a meta para a realidade.

### Fase 3 — Semanas 9–12: Decisão e expansão controlada

| Cenário | Ação |
|---|---|
| KPI moveu, conversão segurou | Replicar pra CIAASA (mais R$ 3,5M/ano em escopo). Construir Tela "Hoje" + alertas push pras 5 lojas top-perda. |
| KPI moveu, conversão caiu | Recalibrar: alerta sem 2ª assinatura, ou rever política de desconto por classe. |
| KPI não moveu | Aceitar que o problema é tabela ou elasticidade, não disciplina. Pivot pra recalibração de tabela com Alex. |

### Métricas-norte (revisão semanal com diretoria)

| Métrica | Hoje | Meta 60d Aeroporto | Meta 90d se expandir |
|---|---:|---:|---:|
| % vendas dentro de ±3% | 26,1% | >40% | >50% |
| % vendas subprec grave (<-7%) | 39,2% | <25% | <20% |
| Taxa de fechamento (gate) | baseline a medir | sem queda >5pp | sem queda >5pp |
| Ticket médio | baseline a medir | sem queda líquida | sem queda líquida |

### Resumo executivo de impacto

**Não vamos prometer R$ 7M/ano em 90 dias.** Vamos prometer:
- Semanas 1–4: evidência de qualidade (tabela é confiável? causa-raiz é disciplina?)
- Semanas 5–8: dado real de % capturável numa loja, sem destruir conversão
- Semanas 9–12: decisão informada sobre escala ou pivot

Se o piloto recuperar mesmo R$ 50k/mês em Aeroporto sem mexer em conversão, o ROI do investimento (~4 semanas de dev + R$ 230/mês) é claro. Acima disso, é upside.

---

## PÁGINA 6 — Q&A ANTECIPADO

### "Esses R$ 34 milhões existem ou são ficção contábil?"

O número correto é **R$ 13,9M de diferença acumulada vs nossa tabela em 4,8 meses**. A anualização x2,48 é ilustrativa, não promessa — ignora sazonalidade Ford (entressafra pós-Territory/Ranger no 1º semestre). E não é "perda contábil" — é **margem teórica não capturada assumindo que (a) a tabela está calibrada e (b) o cliente fecharia no preço cheio.** Os dois pressupostos precisam ser testados. Por isso o piloto é de medição, não de promessa.

### "Como sei que a tabela do NBS não está inflada?"

Pergunta correta — e o ponto mais frágil do número grande. Validação cruzada com FIPE em n=63 (subset com cobertura) deu R$ 3,25M/ano — uma ordem de grandeza menor. A verdade está entre os dois. **Compromisso pré-piloto:** Alex roda comparativo com Mercado Livre/OLX em 200 vendas das duas Ford (1 semana). Se a tabela estiver consistentemente acima do mercado, o problema vira recalibrar tabela, não bloquear desconto. Não vamos para produção com diagnóstico baseado em referência não validada.

### "Se eu bloquear desconto, o cliente vai pra concorrência. Cadê o estudo de elasticidade?"

Não temos estudo empírico nosso — esse é o ponto fraco real do plano, declarado. Por isso o piloto **não bloqueia, ele expõe**. Versão 1 é alerta + segunda assinatura, não trava dura. Medimos 3 coisas em 60 dias: taxa de fechamento, ticket médio, tempo até venda. **Gate explícito:** se taxa de fechamento cair >5pp, recuamos. A hipótese de que "metade dos descontos some quando precisa de aprovação real" é palpite — precisa virar dado antes de virar política.

### "Por que essas 2 lojas Ford concentram 70%? É problema delas ou da amostra?"

Parcialmente respondido pelos dados: Aeroporto vende 86% subprec em taxa, CIAASA 78,7% — não é só volume, é também frequência. Mas a crítica é válida em outra dimensão: não normalizamos por **mix** (faixa de preço, idade do estoque, origem do usado — troca vs avulso vs leilão). **Compromisso pré-piloto:** cruzamento controlando por (a) faixa de preço, (b) marca/modelo, (c) origem. Se controlando essas variáveis a diferença sumir, o problema é tabela ou mix — não disciplina, e o piloto muda de escopo.

### "Você diz que tá em produção e diz que faltam 4–6 semanas. Qual versão é verdade?"

Distinção justa, e foi imprecisão minha na primeira versão. **Está em produção interna** — eu uso, time de pricing usa. **Não está pronto pra 10–50 usuários simultâneos com SLA.** Os HIGH debts (race FIPE batch + fórmula mínimo) são bloqueantes para confiança no número que aparece na tela do vendedor — se o diagnóstico calcula errado uma vez, perdemos credibilidade pra sempre. **Cronograma corrigido:** as 4 semanas de dev vêm ANTES do piloto, não em paralelo. Resultado mensurável no dia 60, não no dia 30. Prefiro recalibrar a promessa do que entregar bug em produção pro vendedor.

### "A estimativa anterior do time era R$ 750k–1,2M. Agora é R$ 34M. Por que confiar na nova?"

Não peço confiança no número grande. Peço confiança no **método**: 100% de cobertura sobre 1.636 vendas reais do NBS, não amostra. O que aprendi entre uma estimativa e outra foi que estávamos olhando com lente errada (FIPE com baixa cobertura, em vez de tabela própria com cobertura total). A nova estimativa pode ainda estar errada — provavelmente para baixo do que o cético vai sugerir. **A pergunta correta não é "o número está certo", é "vale gastar 4 semanas de dev pra descobrir o número real numa loja?"** Eu argumento que sim, porque o downside está limitado e mensurável.

---

**Próximo passo solicitado:** autorização para iniciar Fase 1 (semanas 1–4 de dev + auditoria de validação de tabela) e indicação do sponsor diretor para a Fase 2.
