# Plano de Projeto — Dashboard de Lucratividade por Captação de Seminovos

**Solicitante:** Diretoria | **Responsável pela proposta:** Marcos Henrique
**Caráter:** Interno / Confidencial | **Data:** 22/06/2026 | **Status:** Proposta para alinhamento

---

## 1. Resumo executivo

A ferramenta solicitada acompanha, mês a mês, **a lucratividade de cada seminovo a partir de quem o CAPTOU/AVALIOU na troca** — não de quem o revendeu. O objetivo é responsabilizar o vendedor pela qualidade da avaliação que ele fez na entrada do usado, já que uma avaliação ruim contamina a rentabilidade da revenda depois, em qualquer unidade do Grupo.

**Veredito honesto:** já temos uma base sólida e validada para construir isso (o Navesa Mesa cobre hoje ~40-50% do pedido, incluindo o motor de cálculo de margem validado contra o NBS). O que falta é justamente o **eixo central** — atribuir o resultado da revenda ao captador e cruzar a entrada com a saída do mesmo veículo. Esse eixo depende de **confirmar dados do NBS antes de cravar prazo**. Por isso o plano começa com uma Fase 0 de descoberta de dados: o maior risco do projeto não é técnico, é de dado.

Uma ressalva de expectativa: o pedido fala em "fixar no NBS Gold". O Mesa é uma aplicação web externa que importa planilhas do NBS — não é um módulo dentro do NBS. A entrega será um **dashboard próprio (web)**, com a mesma função pedida. Isso precisa ser alinhado com a diretoria.

---

## 2. Objetivo e resultado esperado

**O que a ferramenta permite decidir (linguagem de gestão):**

- **Treinamento:** identificar quais vendedores avaliam mal os usados na troca (margem individual abaixo da média geral) e direcionar capacitação.
- **Estratégia de avaliação:** entender se erros de avaliação são pontuais ou padrão de uma pessoa/loja.
- **Bonificação:** dar base objetiva para premiar quem capta bem — quem traz ativos que geram lucro na revenda, não só quem fecha a venda do novo.
- **Gestão de estoque:** enxergar veículos parados há muito tempo (semáforo) e o capital travado por avaliação otimista.

**Resultado esperado:** uma visão mensal, individual e comparativa, que conecta a **qualidade da avaliação na entrada** ao **resultado financeiro na saída**, mesmo quando entrada e saída acontecem em unidades diferentes do Grupo.

---

## 3. O que já temos pronto (aproveitar do Navesa Mesa)

Não começamos do zero. O Mesa já entrega, validado em produção:

| Capacidade existente | Status |
|---|---|
| Motor de cálculo de margem centavo-perfect, validado contra o NBS | Pronto e forte |
| Agregação de margem por vendedor (mecânica de cálculo) | Pronto (medindo quem vendeu, não quem captou) |
| Agregação por loja e cruzamento giro × margem | Pronto |
| Detecção de carros parados (dias ≥ 50) com score de urgência e capital travado | Pronto |
| Infraestrutura de semáforo visual (verde/amarelo/vermelho) já usada em KM, margem, FIPE | Pronto |

Em resumo: a "engenharia financeira" e a parte visual já existem. **O que falta é redirecionar a atribuição do resultado para o captador e cruzar entrada com saída.**

---

## 4. Fases do projeto

### FASE 0 — Descoberta e Validação de Dados (pré-requisito, sem código)
> O risco do projeto está nos dados. Esta fase tem que vir antes de qualquer estimativa firme de build.

**Atividades:**
1. Obter os anexos do email (Word de especificação + Excel modelo) — referência de exatamente o que a diretoria espera ver.
2. Confirmar a semântica do campo "Vendedor que Recebeu" do NBS — **é ele o captador/avaliador da troca?** (hoje é só hipótese de confiança média).
3. Mapear o que o NBS exporta sobre a **entrada do usado**: avaliador, data e loja de captação.
4. Confirmar se o NBS exporta **vendas de OUTRAS unidades** do Grupo (necessário para o cross-loja).
5. Alinhar com a diretoria a expectativa "no NBS" → **dashboard web**.

**Entregável:** relatório de viabilidade de dados + decisão GO/NO-GO por funcionalidade.
**Dependência:** acesso aos anexos e a alguém do TI/NBS que conheça a exportação.

---

### FASE 1 — Quick wins (baixo risco, valor imediato)
Funcionalidades que dependem só de dado que já temos.

- **Semáforo na coluna "dias em estoque"** (verde/amarelo/vermelho) — infra já existe, é trivial.
- **Comparativo de cada vendedor vs. média geral** de margem — derivável do que o Mesa já calcula; falta a tela.

**Entregável:** primeira versão do dashboard com semáforo de estoque e ranking comparativo.
**Dependência:** nenhuma além do dado atual. Pode começar em paralelo à Fase 0.

---

### FASE 2 — Eixo da captação (núcleo do pedido)
O coração da ferramenta: atribuir o resultado da revenda ao **captador**.

- Vincular **entrada → saída do mesmo veículo** via chassi (captação → revenda).
- Atribuir lucro/prejuízo por veículo **ao vendedor que captou**.
- Margem média individual **por captação** e comparativo com a média geral, já na ótica correta.

**Entregável:** dashboard mostrando lucro/prejuízo por veículo e por captador.
**Dependência crítica:** resultado da Fase 0, item 2 (semântica do captador). Se "Vendedor que Recebeu" = captador, viável com dado atual. Se não, depende de dado novo do NBS.

---

### FASE 3 — Cross-loja (consolidação Grupo)
Lucro/prejuízo por veículo independente de **qual unidade** revendeu.

- Consolidar entrada e saída entre unidades do Grupo.
- Atribuir corretamente o resultado ao captador mesmo quando a revenda foi em outra loja.

**Entregável:** visão consolidada Grupo, cross-loja.
**Dependência crítica:** Fase 0, item 4 — o NBS precisa exportar vendas de outras unidades ao Mesa. Se hoje não chega, vira pré-requisito de integração/processo.

---

## 5. Estimativa de esforço (faixas — não números cravados)

> O esforço real só fica firme **depois da Fase 0**. As faixas abaixo são indicativas e mudam conforme o que os dados do NBS permitirem.

| Fase | Faixa de esforço | Risco | Observação |
|---|---|---|---|
| Fase 0 — Descoberta | **Curta** (dias) | Baixo (mas é o que destrava tudo) | Depende de pessoas/anexos, não de código |
| Fase 1 — Quick wins | **Baixa** | Baixo | Infra existe; valor rápido |
| Fase 2 — Captação | **Média a alta** | **Médio/Alto** | Faixa de cima se "Vendedor que Recebeu" = captador; faixa de baixo se exigir dado novo do NBS |
| Fase 3 — Cross-loja | **Média a alta** | **Alto** | Depende de o NBS exportar dados de outras unidades — pode virar projeto de dado/processo, não só de tela |

**Leitura rápida:** Fase 1 entrega valor visível rápido e barato. Fases 2 e 3 são onde mora o esforço e o risco, e ambas dependem de confirmação de dados antes de comprometer prazo.

---

## 6. Premissas e dependências

- **Acesso aos anexos** (Word de specs + Excel modelo) — ainda não temos.
- **Dados do NBS** são a dependência-mãe: semântica do captador, dados de entrada do usado e exportação cross-loja.
- **O Mesa importa XLSX do NBS** — não há integração nativa/API. O fluxo continua sendo via exportação de planilhas.
- **Decisão sobre "no NBS" vs. web:** entrega será dashboard web próprio. Precisa de aceite da diretoria.
- Disponibilidade de alguém do TI/NBS para a Fase 0.

---

## 7. Riscos e mitigação

| Risco | Impacto | Mitigação |
|---|---|---|
| "Vendedor que Recebeu" **não** for o captador | Alto — derruba o eixo central com dado atual | Confirmar na Fase 0; se confirmar que não, escalar pedido de campo novo ao NBS antes do build |
| NBS **não exportar** vendas cross-loja ao Mesa | Alto — inviabiliza a Fase 3 como está | Fase 0 item 4; se faltar, tratar como pré-requisito de dado/processo separado |
| Anexos revelarem regras/colunas não previstas | Médio — pode mudar escopo | Obter anexos antes de cravar escopo e prazo |
| Expectativa "fixar no NBS" não atendida | Médio — frustração de quem pediu | Alinhar cedo: entrega é web, com a mesma função |
| Dado do usado na entrada incompleto no NBS | Médio/Alto | Mapear na Fase 0; sem ele, captação não fecha |

---

## 8. Critérios de aceite (alto nível)

1. A ferramenta atribui o **resultado da revenda ao vendedor que CAPTOU** o seminovo (não a quem revendeu).
2. Mostra **lucro/prejuízo por veículo captado**, independente de quem revendeu e de qual unidade.
3. Calcula **margem média individual por vendedor** (ótica de captação).
4. Apresenta **comparativo de cada vendedor vs. média geral**.
5. Exibe **dias em estoque com semáforo** (verde/amarelo/vermelho).
6. É **mensal**, interna e confidencial.
7. Os números **batem com o NBS** (motor de margem já validado).

---

## 9. Fora de escopo / a definir

**Fora de escopo (por ora):**
- Integração nativa / módulo embutido dentro do NBS Gold.
- Bonificação automática (a ferramenta dá subsídio; o cálculo/pagamento de bônus é decisão de gestão).
- Integração via API em tempo real com o NBS (fluxo segue por exportação XLSX).

**A definir (depende da Fase 0):**
- Se "Vendedor que Recebeu" serve como captador.
- Se haverá necessidade de campo novo no NBS.
- Se cross-loja é viável já ou vira fase posterior.

---

## 10. Recomendação e próximos passos

**Recomendação:** aprovar a ferramenta com abordagem faseada e **não cravar prazo antes da Fase 0**. A base técnica existe e é forte; o risco está concentrado nos dados do NBS — e isso se resolve com informação, não com código.

**Próximos passos imediatos:**
1. **Obter os anexos** do email (Word de specs + Excel modelo).
2. **Agendar uma reunião curta de alinhamento de dados** com o TI/NBS para confirmar os 4 pontos da Fase 0 (semântica do captador, dados de entrada do usado, exportação cross-loja) e alinhar a expectativa "no NBS → web".
3. Em paralelo, **liberar a Fase 1 (quick wins)** — entrega valor rápido e de baixo risco enquanto a descoberta de dados corre.
