# ADR-003 — Persistência e derivação da sugestão de preço de repasse

- **Status:** Aceito. Dos 3 pontos devolvidos ao Marcos, **2 decididos por ele em 2026-08-12** (§7.1 razão = 95,2%; §7.2 sugestão editável); resta **§7.3** (`TETO_REF_AA_PCT`), que não bloqueia o dev.
- **Data:** 2026-08-12
- **Autora:** Aria (arquitetura)
- **Contexto de decisão:** decisões D1/D2/D3 abertas em `docs/stories/story-3.1-aba-precificar.md` (linhas 120-123)
- **Afeta:** story 3.1 (escopo **muda** — ver §8), `supabase/migrations/` (migration nova), `src/lib/pricing/sugerir-preco-repasse.ts` (novo)
- **Relação com ADR-002:** **estende**. Não supersede. Aciona formalmente o gatilho **G1** (§6).

---

## 1. Contexto

A aba `/precificar` produz dois preços sobre `custo_real` e precisa devolvê-los pro fluxo de `/repasses`. Três perguntas ficaram sem dono:

1. **Onde gravar** — `valor_minimo`/`valor_compre_por` são reescritos pelo import (025/028 texto, 029 arquivo).
2. **Como derivar** os dois preços da régua de n=16.
3. **Quanto vale** `TETO_REF_AA_PCT`.

Fato de fluxo que governa as três: **não existe API do Auto Avaliar** (ROADMAP.md:83 — "Marcos vai investigar"). O Marcos lê a sugestão aqui e **digita no portal**. O portal é a fonte da verdade; o valor real volta pelo import.

---

## 2. Fatos apurados que reordenam as decisões

### 2.1 `valor_subir` não está livre — é campo carregado

A story tratou `valor_subir` como "campo manual existente, fora do caminho do sync". Ele está fora do sync, mas **não está livre**:

| Consumidor | Arquivo | O que quebra |
|---|---|---|
| `calcularBonus()` = `valor_aquisicao − valor_subir` | `src/lib/repasses/bonus.ts:13-16` | Bônus vira número sem sentido |
| KPI `calcularValorPraSubir()` (soma dos `subido`) | `src/lib/repasses/kpis.ts:18-30` | KPI da lista infla |
| Coluna "Valor pra subir" do XLSX | `src/lib/export/relatorio-repasse-xlsx.ts:94,293,317` | Relatório entregue com número errado |
| Inline edit (Caminho B) | `src/components/repasses/RepassesLista.tsx:1065-1066` | Sugestão e edição manual disputam o mesmo campo |

Além disso, a migration 023 já **rejeitou explicitamente** reusar `valor_subir` (`023:9-12`: "legacy/inconsistentes… reaproveitá-las herda o lixo"). Gravar sugestão ali reabre uma decisão já fechada, e o dano é silencioso: nada erra, os números só ficam errados.

**Consequência: a alternativa `valor_subir` está morta.** Não é tradeoff, é regressão.

### 2.2 A sobrescrita pelo import não é perda — é convergência

A story descreve o import como "a sugestão desaparece". A leitura precisa é outra, e ela é diferente por caminho:

| Caminho | Código | Comportamento sobre `valor_minimo` |
|---|---|---|
| **Texto** (colagem da tela) | `028:257` `NULLIF(v_reg->>'minimo','')::numeric` | Escreve incondicional. Campo ausente na colagem ⇒ `NULL`. |
| **Arquivo** (`relatorio_VeiculosEmOferta.xls`) | `029:532` `COALESCE(o.valor_minimo, r.valor_minimo)` | Só escreve o que observou. Ausente ⇒ **preserva**. |

E o que o import escreve é **o preço que está de fato no ar no portal** — ou seja, exatamente o que o Marcos digitou lá depois de ler a sugestão. `valor_minimo` significando "o mínimo anunciado" e sendo governado pelo portal está **correto**. O import não destrói a sugestão: ele substitui a intenção pelo fato.

O que se perde não é o valor. É a **procedência**: depois do import ninguém sabe se o anunciado veio da sugestão, se o Marcos corrigiu, e em quanto.

### 2.3 O dado de recalibração é irrecuperável se não for capturado na hora

`custo_real` **muda depois**: gastos entram tarde (AC9), e o texto faz `DELETE` incondicional dos gastos `tipo='auto_avaliar'` (ADR-002 §2). Então não dá pra reconstruir, seis meses depois, qual era o `custo_real` no momento em que a régua foi aplicada — logo não dá pra recomputar "a sugestão acertou?". A régua de n=16 só recalibra se o par **sugerido × anunciado × vendido** for gravado no instante da decisão.

### 2.4 Já existe precedente vivo desse padrão no projeto

`reprecificacao_sugerida` (migration 003) é exatamente isso para o varejo — snapshot auditável com `versao_formula`, `motivo jsonb`, `preco_aplicado`, `aplicado_em` — e tem CRUD ativo em `src/lib/data/reprecificacao.ts`. Não é padrão novo; é o padrão da casa.

**Mas não se reusa a tabela dela**, por três impedimentos concretos: `versao_formula` tem CHECK `^diagnostico_v[0-9]+$` (`003:71`); `uniq_reprec_pendente` é único por `chassi` (`003:103-105`) e faria uma sugestão de repasse colidir com uma de varejo do mesmo carro; e `preco_sugerido` é **um** preço, aqui são dois. Chave também é diferente: repasse tem identidade por ciclo (AC3, placa duplicada), então a referência é `repasse_id`, não `chassi`.

---

## 3. Decisão 1 — onde persistir

### Opções

| # | Opção | Prós | Contras | Veredito |
|---|---|---|---|---|
| 1 | Gravar só em `valor_minimo`/`valor_compre_por` | Zero migration; margem/semáforo funcionam antes do import; o import converge pro real (§2.2) | Perde a procedência (§2.2); adiciona um **terceiro escritor** a colunas que a ADR-002 §4.1 declarou autoritativas do texto; entre aplicar e importar, uma *intenção* é lida como *fato* por `MarcarVendidoModal`/KPIs | **Aceita — mas só como metade da resposta** |
| 2 | Gravar em `valor_subir` | Fora do sync | Corrompe Bônus, KPI e XLSX em silêncio (§2.1); reabre decisão da 023 | **Rejeitado — é regressão** |
| 3 | Colunas próprias em `repasses` (`valor_minimo_sugerido`, `…_compre_por_sugerido`, `sugerido_em`) | Migration pequena; join grátis | Guarda só a última sugestão. Justo os carros que importam (`qtde_anuncios > 1` = reanunciado) são os que têm mais de uma, e a reprecificação é o evento que mais ensina | **Rejeitado — perde o caso interessante** |
| 4 | **Tabela de snapshot append-only** (`repasse_precificacao_sugerida`), sem UI de histórico nesta story | Preserva sugerido × aplicado × contexto do momento (§2.3); padrão já existente e vivo (§2.4); `valor_minimo` fica intocado como campo operacional; procedência derivável sem coluna de metadado | 1 migration + 1 módulo de escrita; a story dizia "sem migration nova" | **Adotado**, combinado com a opção 1 |
| 5 | Não persistir — só exibir na tela | Custo zero | Joga fora o único dado que recalibra a régua, e ele é irrecuperável (§2.3). Barato hoje, caro pra sempre | **Rejeitado** |
| 6 | Coluna de procedência por campo (`fonte_valor_minimo`) | Distingue intenção de fato no próprio campo | ADR-002 §4.5 já rejeitou procedência por campo pro mesmo sistema. E aqui é **desnecessário**: com a tabela do snapshot, "esse `valor_minimo` ainda é intenção?" é derivável comparando o snapshot mais recente com a data do último import | **Rejeitado — ADR-002 §4.5 permanece** |

### Decidido

**Separar o campo operacional do registro da decisão.** São duas coisas diferentes e a story as tratou como uma.

1. **`valor_minimo` / `valor_compre_por` continuam sendo o campo operacional** e continuam governados pelo portal via import. A aba grava neles ao aplicar — é o que faz margem e semáforo funcionarem antes do import chegar. **A ADR-002 §4.1 não é violada**: o texto continua sendo autoritativo; a aba escreve uma intenção que o texto tem o direito de substituir pelo fato. A ordem de precedência não muda.
2. **A sugestão vira uma linha em tabela própria, append-only, gravada no clique de "Aplicar"** — não a cada placa digitada (senão vira ruído: toda consulta viraria linha). O evento que interessa é a decisão, não a consulta.
3. **Nenhuma coluna de procedência.**
4. **Sem tela de histórico nesta story.** A tabela é write-only por enquanto. Isso mantém honesto o OUT da story ("histórico de sugestões, comparação sugerido vs. praticado") — não entra *feature*, entra *captura*. O read é uma story futura, quando houver n suficiente pra recalibrar.

### Forma dos dados (para `@dara-data-engineer` — DDL é dela, não minha)

Uma linha por aplicação, referenciando `repasses(id)` com cascade. Precisa carregar:

- **Identidade:** referência ao repasse; momento; versão nomeada da régua (string livre — **não** reusar o CHECK `diagnostico_v[N]` da 003).
- **O que o motor sugeriu:** os dois preços; os dois percentuais efetivos aplicados (após ajustes e após o piso); flag/derivação de "bateu no piso"; nível de confiança; `justificativa` e `alertas` (jsonb, no molde de `motivo jsonb` da 003).
- **O contexto do momento, porque ele muda depois (§2.3):** `custo_real`, e decomposto em `valor_compra_repasse` + Σ gastos; `valor_auto_avaliar` e `valor_fipe` como estavam; km; dias no repasse; `qtde_anuncios`.
- **O que foi de fato aplicado:** os dois valores gravados e o instante. Se o Marcos puder editar o número antes de aplicar (**pendência §7.2**), a diferença entre sugerido e aplicado é a correção dele — e é o rótulo mais valioso do conjunto todo.

### Ordem de escrita e falha parcial

Gravar o snapshot **primeiro** (como sugestão), depois o `UPDATE` dos dois campos, depois carimbar o aplicado no snapshot.

- Snapshot falha ⇒ **aborta com erro visível**, nada é gravado. Custo operacional real desse bloqueio é ~zero: o portal é a fonte da verdade de qualquer jeito, o Marcos digita lá e tenta de novo aqui. Um usuário, um clique, retry grátis — consistência vale mais que disponibilidade neste volume.
- `UPDATE` falha depois do snapshot ⇒ sobra uma linha "sugerida e não aplicada". **Isso é sinal, não lixo**: "sugeriu e não aplicou" é informação de calibração legítima.
- Sem RPC nova, sem transação distribuída. Duas escritas sequenciais resolvem.

---

## 4. Decisão 2 — derivação dos dois preços

### O problema com `compre-por = p75`

A proposta (mínimo = mediana 106,6%; compre-por = p75 110,7%) parece derivar os dois da mesma régua, mas mistura duas grandezas:

- **p25–p75 é a dispersão do mínimo *entre carros*** — "o mínimo do quartil mais caro da amostra".
- **O compre-por é uma distância *dentro do mesmo carro*** — quanto acima do próprio mínimo fica o preço de compra direta.

São eixos diferentes. Usar o p75 de um como valor do outro é coincidência numérica com aparência de rigor. O número que sai é razoável (razão 96,3%, contra 95,2% mediano dos vendidos), mas o **raciocínio registrado no comentário do código é o que vai guiar a recalibração** (AC10 manda registrar a origem). Se o comentário disser "compre-por = p75", quem recalibrar daqui a 40 vendas vai recomputar o percentil errado e propagar o erro com mais confiança do que hoje.

### Opções

| # | Opção | Razão mín÷compre | Prós | Contras | Veredito |
|---|---|---|---|---|---|
| 1 | Manter `compre_por = p75 = 110,7%` | 96,3% | Zero mudança; número cai perto do observado | Ancoragem conceitualmente errada, gravada num comentário que é instrução de recalibração | **Rejeitado como *derivação*** (o valor segue sobre a mesa, §7.1) |
| 2 | Spread fixo inventado (ex.: +5%) | arbitrária | Simples | Inventa requisito; não sai de dado nenhum | **Rejeitado** |
| 3 | **Duas constantes: mínimo ancorado na mediana; compre-por derivado do mínimo pela razão observada** | parâmetro explícito | Cada constante tem âncora própria e verificável; recalibrar mínimo e spread são operações independentes; o comentário instrui a query certa | Exige nomear a razão como constante (custo: uma linha) | **Adotado** |
| 4 | Âncora totalmente independente pro compre-por (percentil dos compre-por que venderam) | observada | Seria o mais correto | Não existe amostra: o compre-por que "vendeu" é observável em pouquíssimos casos (a maioria fecha no leilão, não na compra direta). n insuficiente | **Rejeitado por falta de dado** — reavaliar quando houver |

### Decidido

**Duas constantes independentes, compre-por parametrizado como razão sobre o mínimo, não como percentil.**

```
MINIMO_PCT          = mediana do mínimo que vendeu (n=16)
RAZAO_MINIMO_SOBRE_COMPRE_POR = razão mín÷compre-por observada
COMPRE_POR_PCT      = MINIMO_PCT / RAZAO_MINIMO_SOBRE_COMPRE_POR
```

Com `MINIMO_PCT = 106,6%` e a razão mediana dos vendidos, sai `COMPRE_POR_PCT ≈ 112,0%` — contra os 110,7% propostos. **Diferença: 1,3 ponto de custo** (R$ 1.300 num carro de R$ 100 mil), sempre pra cima no teto de compra direta. **Valor decidido pelo Marcos: razão = 95,2% ⇒ `COMPRE_POR_PCT ≈ 112,0%`** (§7.1).

**Incerteza registrada, sem maquiagem:** a razão de 95,2% é o hábito do Marcos, não uma otimização — os dois números da amostra foram escolhidos no olho. A diferença vendidos (95,2%) × encalhados (97,1%) é de **1,9 ponto e não é alavanca forte**; já houve uma tese anterior descartada por superestimar exatamente esse spread. Portanto: a razão entra como **parâmetro nomeado e ajustável**, nunca como achado. O ganho arquitetural aqui não é acertar o número — é que trocar o spread deixa de exigir recomputar percentil nenhum.

### Invariante de ordenação (nova, e barata)

Depois do clamp do piso, o motor deve garantir `compre_por ≥ mínimo ≥ custo_real`. Com as constantes atuais é impossível violar — mas as constantes são explicitamente editáveis à mão (AC10), e uma edição desatenta produziria um par invertido que a UI mostraria sem reclamar. Guarda + teste, não bloqueio de fluxo.

### Sobre a banda p25–p75 na UI (AC11)

Fica, e fica **rotulada como banda do mínimo** — que é o que ela mede. Não é a faixa entre mínimo e compre-por.

---

## 5. Decisão 3 — `TETO_REF_AA_PCT`

### Confirmado: alerta, nunca trava

A trava está errada pelo caso que a story já cita: o Amarok com 249 mil km fechou a 58,8% da referência e a régua sobre custo o teria precificado bem. Uma referência que erra por 41 pontos num caso real não pode ter poder de veto sobre um cálculo ancorado no custo. **Ref. AA informa; custo manda.**

### Ajustes ao desenho

1. **O teto se aplica ao `minimoSugerido`, não ao compre-por.** O mínimo é o piso do leilão — se nem ele cabe abaixo da referência de mercado, nada vende, e o alerta é útil. O compre-por *deve* ficar acima da referência: é um prêmio por encerrar o anúncio na hora. Alertar sobre ele seria ruído recorrente, e alerta que toca sempre é alerta que ninguém lê.
2. **Só alerta de teto. Sem alerta de piso.** A tentação de avisar "muito abaixo da referência" morre no mesmo Amarok: ficar bem abaixo da Ref. AA foi o comportamento *correto* naquele carro. Seria ruído no caso que mais precisa passar limpo.

### Valor: não tenho o dado, e não vou inventar

Calibrar esse teto exige uma grandeza que ninguém mediu: a distribuição de `minimo_que_vendeu ÷ valor_auto_avaliar` nos mesmos 16 carros. O teto deve ficar no p75–p90 dessa razão, pra disparar só na cauda.

**Provisório: `TETO_REF_AA_PCT = 105%`**, marcado no código com o **mesmo tratamento de `DEPRECIACAO_MENSAL_PCT` (AC24): heurística NÃO calibrada**. Não é um número derivado — é um placeholder honesto que não trava nada e cuja pior falha é um alerta a mais ou a menos.

**Tarefa que resolve isso de vez:** uma query pra `@alex-analyst` sobre os 16 vendidos. Não bloqueia o desenvolvimento (constante nomeada, trocar é uma linha), mas deveria entrar antes do go-live da aba.

---

## 6. Gatilho G1 da ADR-002 — **acionado**

A ADR-002 §5 define: *"G1 — `valor_web` (ou `valor_fipe`, ou `valor_auto_avaliar`) passar a ser lido: entrar no tipo `Repasse`, aparecer em `RepassesLista.tsx`/`RelatorioAnuncio.tsx`, ou **virar insumo de precificação**. Deixa de ser dado latente."*

A story 3.1 faz exatamente isso: AC1 carrega `valor_auto_avaliar` e `valor_fipe`, e AC13/AC14 os tornam insumo de precificação e de nível de confiança. **G1 está acionado para `valor_auto_avaliar` e `valor_fipe`** (não para `valor_web`, que continua sem leitor).

A ADR-002 diz que o gatilho torna **a migration do `COALESCE` nos writes da 028** pré-requisito bloqueante. Reavaliando com o caso concreto na mão:

> **Nota de numeração.** A ADR-002 §5 chamou essa migration de "030". Era nome de rascunho, não reserva: o número 030 foi consumido por `supabase/migrations/030_repasse_precificacao_sugerida.sql` (o snapshot desta ADR), porque a 029 era a última aplicada e deixar buraco na sequência faria o preenchimento tardio rodar fora de ordem. **A migration do `COALESCE` é a 031.** Correção de referência apenas — nenhum mérito das duas ADRs muda.


- O dano do write destrutivo aqui é: colagem de texto sem esses campos ⇒ `NULL` ⇒ a aba cai pra `confianca = "baixa"` ou `"muito_baixa"` e **emite alerta em pt-BR** (AC14/AC15).
- Isso é **degradação visível**, não decisão errada em silêncio. A distinção é exatamente a que a ADR-002 §4 usou pra aceitar o custo do `valor_web`.

**Leitura desta ADR:** G1 fica **formalmente registrado como acionado**, e a migration 031 **sai do backlog para "próxima story"**, mas **não bloqueia a 3.1**. O que ela protege degrada de forma anunciada, e a story já trata o caso.

**Reclassificação para bloqueante** se qualquer um ocorrer:
- **G1-a** — medir que a colagem de texto vem sem `media_aa` com frequência relevante (a frequência **não foi medida**; a ADR-002 §1 mediu isso só pro `valor_web`, 25/61). Uma contagem resolve.
- **G1-b** — a Ref. AA passar a ter qualquer efeito **numérico** na sugestão (hoje só alerta e nível de confiança). Aí `NULL` deixa de ser degradação e vira preço diferente.

Enquanto a Ref. AA só informa, ela pode faltar. No dia em que ela mexer no número, não pode.

---

## 7. Pontos que eram do Marcos — dois decididos, um ainda aberto

> **Decisões do Marcos em 2026-08-12** (as três desta sessão, para o registro):
> **(1)** piso de aceite **0%** — nunca sugerir abaixo do `custo_real`; **(2)** razão mínimo÷compre-por = **95,2%**; **(3)** a sugestão **é editável antes de aplicar**, e a correção dele é capturada no snapshot.

### 7.1 O valor da razão mínimo÷compre-por — ✅ **decidido: 95,2%**

A estrutura era minha; o número era dele. Duas opções estavam na mesa:

| | Razão | `COMPRE_POR_PCT` | Leitura | |
|---|---|---|---|---|
| **A — conservadora** | 96,3% | 110,7% | Mantém o número proposto pelo River. Spread menor que o histórico dele. | Descartada |
| **B — observada** | 95,2% | ≈112,0% | Reproduz o spread mediano dos 16 que venderam. Teto de compra direta 1,3 ponto mais alto. | **✅ Escolhida** |

**O Marcos escolheu B em 2026-08-12** — a mediana observada nos 16 vendidos, que é o spread que ele já pratica. O racional aceito é o que eu tinha registrado: **errar pra cima é o mais barato dos dois erros**, porque um compre-por alto só deixa de fechar a compra direta na hora — não derruba o leilão de 24h, que segue rodando a partir do mínimo. Errar pra baixo custa dinheiro deixado na mesa toda vez que alguém aceita.

**A incerteza da §4 continua valendo e não é anulada por esta decisão:** 95,2% é o hábito dele, não uma otimização — os dois números da amostra foram escolhidos no olho. A escolha do Marcos foi por qual hábito reproduzir, não por qual número é ótimo. A razão segue sendo **parâmetro nomeado e ajustável**; quando o n crescer (**T2**, §10), ela volta pra mesa com dado em vez de hábito.

### 7.2 A sugestão é editável antes de aplicar? — ✅ **decidido: sim, editável**

A AC19 dizia só "clico em Aplicar e confirmo". **O Marcos confirmou que quer poder ajustar o número antes de aplicar.** Isso não era detalhe de UI: **a correção dele é o rótulo mais valioso do conjunto de recalibração** — é o dado que ensina onde a régua erra. Por isso a 030 tem colunas separadas para o par sugerido e o par aplicado (`030:127-135`); a diferença entre os dois só existe se ocuparem colunas diferentes.

### 7.3 O valor de `TETO_REF_AA_PCT` — ⏳ **em aberto**

Precisa de um número que ninguém tem (§5). Encaminhar pro `@alex-analyst`: distribuição de `minimo_que_vendeu ÷ valor_auto_avaliar` nos 16, com p50/p75/p90 e quantos dos 16 têm Ref. AA preenchida. Com isso na mão o Marcos escolhe o percentil de corte. Até lá, 105% marcado como não calibrado.

---

## 8. O que muda na story 3.1

### Escopo

- **Sai do OUT, entra no IN:** "Migration nova de schema (todos os campos necessários já existem)" **deixa de valer** — a tabela de snapshot é a `030_repasse_precificacao_sugerida.sql`. Isso é **mudança de escopo** e a story precisa **voltar pro `@pax-po`** antes do dev.
- **Continua OUT:** tela de histórico, comparação sugerido × praticado, recalibração automática. A tabela é write-only nesta entrega.

### Acceptance criteria

| AC | Mudança |
|---|---|
| **AC10** | Constantes viram: `REGUA_MINIMO_PCT`, `RAZAO_MINIMO_SOBRE_COMPRE_POR` e `REGUA_COMPRE_POR_PCT` **derivado** das duas. Comentário registra a âncora de cada uma **separadamente** — mediana do mínimo que vendeu × razão mín÷compre-por dos vendidos. Não escrever "compre-por = p75". |
| **AC11** | Banda p25–p75 rotulada como **banda do mínimo**, não faixa entre os dois preços. |
| **AC12** | Somar a invariante `compre_por ≥ mínimo ≥ custo_real` como pós-condição **depois** do clamp do piso. |
| **AC13** | Teto se aplica ao **mínimo**, não ao compre-por. Valor provisório 105%, marcado "heurística NÃO calibrada" no mesmo tom da `DEPRECIACAO_MENSAL_PCT`. Confirmado: alerta, jamais trava. |
| **AC19** | Além de gravar `valor_minimo`/`valor_compre_por`, grava o snapshot. Ordem: snapshot → update → carimbo de aplicado. Snapshot falha ⇒ aborta tudo com erro visível. |
| **AC20** | Reescrever: o import **não apaga, converge pro real**. E distinguir os dois caminhos — texto (`028:257`, escreve incondicional, ausente ⇒ `NULL`) × arquivo (`029:532`, `COALESCE`, ausente ⇒ preserva). O texto do aviso ao usuário melhora com isso: "esse valor é sua intenção; quando o carro subir e o relatório for importado, ele passa a refletir o que está no ar". |
| **AC-nova** | Snapshot registra `custo_real` decomposto, referências, km, dias e `qtde_anuncios` **do momento** — porque `custo_real` muda depois (§2.3). |
| **AC28** | Somar aos testes: invariante de ordenação; `COMPRE_POR_PCT` derivado da razão (não hard-coded); montagem do snapshot como **função pura** (o objeto do snapshot é montável e testável sem banco). |

### Correções factuais na story

- **Linha 121 — a alternativa `valor_subir` sai da story.** Não é opção (§2.1). Se ficar escrita como alternativa viável, alguém a escolhe depois por parecer mais barata.
- **Linha 13 × AC13 se contradizem** sobre o Amarok: a linha 13 diz "58,8% **da FIPE**", a AC13 diz "58,8% **da Ref. AA**". São referências diferentes e o argumento muda de força conforme qual for. Precisa checar a fonte e uniformizar.
- **Linha 37** — "razão implícita compre-por/mínimo ≈ 3,85%" é o **prêmio** (110,7÷106,6−1), não a razão. A razão é 96,3%. Vale explicitar qual das duas formas o código usa, senão a constante é lida errado.
- **Risk #2** — reescrever conforme §2.2: não é "a sugestão some", é "o portal substitui a intenção pelo fato", e só o caminho de texto garante isso.

### Não muda

- `valor_minimo`/`valor_compre_por` seguem sendo o campo operacional lido por margem, semáforo e KPIs. **Nenhuma migration toca a 028** — a ADR-002 §4.1 e §4.3 continuam de pé na íntegra.
- Nenhuma coluna de procedência por campo (ADR-002 §4.5).
- Piso de aceite em 0% sobre `custo_real`, decisão do Marcos, intocada.

---

## 9. Custos aceitos, explicitamente

1. **Uma migration e uma tabela a mais num sistema de um usuário e ~60 linhas ativas.** Aceito porque o dado que ela captura é irrecuperável (§2.3) e a régua vigente é de n=16 — recalibrar não é hipótese, é cronograma. É a mesma aposta que a migration 003 já fez pro varejo, e que se pagou.
2. **A tabela nasce write-only.** Pode ficar meses sem leitor — situação que a ADR-002 §2 usou como argumento *contra* proteger o `valor_web`. A diferença que justifica o tratamento oposto: `valor_web` é **reimportável** (basta colar de novo), o snapshot do `custo_real` no instante da decisão **não é**. Latente e recuperável ≠ latente e perdido pra sempre.
3. **Entre aplicar e importar, `valor_minimo` guarda intenção e é lido como fato** por `MarcarVendidoModal` e pelos KPIs. Aceito porque a alternativa (não gravar) deixa a lista cega até o import, e o aviso da AC20 cobre a semântica pro único usuário do sistema. Se um dia isso gerar decisão errada de verdade, a saída **não** é coluna de procedência — é derivar o estado comparando o snapshot mais recente com a data do último import.
4. **`TETO_REF_AA_PCT` vai pra produção sem calibração.** Aceito porque ele só emite alerta: a pior falha é um aviso a mais ou a menos, nunca um preço diferente. Deixa de ser aceitável no instante em que a Ref. AA mexer no número (**G1-b**, §6).

---

## 10. Gatilhos de revisão desta ADR

- **T1** — API do Auto Avaliar sair do backlog (ROADMAP.md:83). Com push automático, a "intenção" vira "anunciado" no mesmo clique e a §3 inteira se simplifica: some a janela entre aplicar e importar.
- **T2** — n de vendas passar de ~40. Aí a régua recalibra de verdade, a tabela ganha leitor, e a decisão 2 volta pra mesa com dado em vez de hábito — inclusive a âncora própria pro compre-por (opção 4 da §4), hoje rejeitada só por falta de amostra.
- **T3** — G1-b: a Ref. AA passar a ter efeito numérico na sugestão ⇒ migration 031 vira bloqueante de verdade (§6).
- **T4** — mais de um usuário no sistema. Aí procedência por campo deixa de ser overkill, e ADR-002 §4.5 e §3 desta ADR precisam ser reabertas juntas. (A coluna `criado_por` da 030 já nasceu preparada pra isso — ver §11.)
- **T5 — rotina de expurgo de repasses antigos.** O vínculo é `repasse_id` FK `ON DELETE CASCADE` (`030:61`), e a perna "o que vendeu" do trio mora em `repasses.valor_vendido`/`data_vendido`, não no snapshot. Isso está certo — a venda é fato que chega depois —, mas significa que **um hard-delete de repasse leva o histórico de calibração junto**. Hoje é risco teórico: `repasses` muda de status, não é apagada. **No dia em que entrar qualquer limpeza de repasses antigos, esta linha tem que ser revista *antes* de rodar** — a alternativa é `ON DELETE RESTRICT` ou desnormalizar o desfecho pro snapshot, e as duas só se decidem com a rotina de expurgo na mão. Fica como gatilho e não como comentário na migration de propósito: quem escrever o expurgo vai estar lendo uma story, não a 030.

---

## 11. Desvios da §3 na implementação (migration 030) — **aceitos**

A `@dara-data-engineer` implementou `supabase/migrations/030_repasse_precificacao_sugerida.sql` com cinco desvios da forma que a §3 pediu, mais duas adições. **Todos aceitos.** Registrados aqui porque a §3 continua sendo o documento que alguém vai ler primeiro, e ela ficaria mentindo em cinco pontos.

| # | Desvio | Veredito |
|---|---|---|
| 1 | Invariante `compre_por ≥ mínimo ≥ custo_real` **não** virou CHECK — só `>= 0` nas colunas monetárias | **Aceito, e o argumento dela é melhor que o meu.** Eu justifiquei "guarda + teste" pelo lado do motor. O lado que eu não vi: **o Marcos pode legitimamente aplicar fora da ordem, e essa é exatamente a correção que a tabela existe pra capturar.** Um banco que recusa a correção do usuário destrói o dado mais caro do conjunto. Ver refinamento abaixo. |
| 2 | `justificativa` é `text`, não `jsonb` | **Aceito — erro meu.** A §3 agrupou "justificativa e alertas (jsonb)" por descuido de redação; a AC17 define justificativa como texto curto em pt-BR. `alertas` como jsonb array está certo. |
| 3 | Percentuais efetivos viraram `minimo_razao_efetiva` / `compre_por_razao_efetiva`, `numeric(9,6)` | **Aceito.** É a §8 desta ADR aplicada ao schema: razão e prêmio já foram trocados uma vez na story. Seis caracteres que matam a ambiguidade na origem. |
| 4 | `confianca` aceita 4 níveis (`media` reservado) enquanto o motor emite 3 | **Aceito.** Um nível a mais custa zero; um a menos custa migration no meio de um clique que aborta (§3, falha parcial). |
| 5 | Sem `atualizado_em`, desviando do padrão 003/008/016/018 | **Aceito.** O trigger de append-only reduz a mutação permitida a uma só, e ela já tem timestamp semântico (`aplicado_em`). Uma segunda data diria a mesma coisa com menos precisão. |

**Refinamento que o desvio 1 obriga, e que a §4 não dizia:** a invariante de ordenação vale sobre o **par sugerido** (saída determinística do motor) e **nunca sobre o par aplicado** (decisão do Marcos). A AC28 tem que testar isso nessa forma — testar a ordenação sobre o aplicado transformaria um teste em proibição de corrigir a régua.

**Duas adições além da §3, ambas aceitas** — as duas com a mesma lógica de dado irrecuperável que motivou a tabela:

- **`parametros_regua jsonb`** guardando os *valores* das constantes, não só `versao_regua`. **Catch legítimo que eu não fiz:** a AC10 torna as constantes editáveis à mão, então uma edição sem bump de versão faz o nome mentir — e o nome é justo o que a recalibração usaria pra agrupar. Os números não mentem.
- **`criado_por uuid DEFAULT auth.uid()`**, pra não backfillar autoria quando o F7 (RLS multi-tenant) chegar. Autoria não é reconstituível depois. Ver **T4** (§10).

**Os números dos comentários da 030 estão certos.** `RAZAO_MINIMO_SOBRE_COMPRE_POR: 0.952` e `REGUA_COMPRE_POR_PCT: 1.1197` (`030:83-84`, `030:375`) refletem a **decisão do Marcos de 2026-08-12** (§7.1), não uma ilustração. E a linha `030:128-131` — "a sugestão É EDITÁVEL antes de aplicar (pendência §7.2, respondida pelo Marcos)" — também está correta: §7.2 fechou como editável. As duas colunas separadas de sugerido × aplicado são consequência direta disso.

**O que ainda não fechou é só a §7.3** (`TETO_REF_AA_PCT`), e ela não toca o schema: o teto vive no motor como constante nomeada e nunca chega a virar constraint. Trocar o valor não implica migration.
