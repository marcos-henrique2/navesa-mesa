# ADR-003 — Persistência e derivação da sugestão de preço de repasse

- **Status:** Aceito. Dos 3 pontos devolvidos ao Marcos, **2 decididos por ele em 2026-08-12** (§7.1 razão = 95,2%; §7.2 sugestão editável); resta **§7.3** (`TETO_REF_AA_PCT`), que não bloqueia o dev.
- **⚠️ EMENDADA em 2026-08-12 pela §12** (story 3.1c, dois modos de preço). A §12 **não supersede** esta ADR: ela acrescenta uma segunda derivação à §4 e **reescreve a invariante da §11** (`compre_por ≥ mínimo ≥ custo_real` passa a ser função da **base do modo**). Leia a §12 antes de tratar qualquer afirmação sobre `custo_real` como piso universal.
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

> ⚠️ **A §12 acrescenta uma SEGUNDA derivação** sobre esta mesma estrutura — o modo "girar rápido", que aplica **estas mesmas duas constantes** sobre `valor_compra_repasse` em vez de `custo_real`. Nenhuma constante nova: nem a âncora do mínimo nem a razão são duplicadas (a razão mede distância dentro do mesmo carro e independe da base; a âncora é uma só, por decisão do Marcos — §12.1). Nada desta seção é revertido.

### Invariante de ordenação (nova, e barata)

> ⚠️ **Formulação SUBSTITUÍDA pela §12.2.** O terceiro termo deixou de ser `custo_real` fixo e passou a ser `base(modo)`. O texto abaixo descreve o estado da 3.1a (modo único).

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

> ⚠️ **A formulação da invariante desta seção (`compre_por ≥ mínimo ≥ custo_real`) foi SUBSTITUÍDA pela §12.2** (emenda de 2026-08-12, story 3.1c). O refinamento "vale sobre o par sugerido, nunca sobre o aplicado" **permanece válido e foi mantido** (I3 da §12.2). O que mudou é o terceiro termo: deixou de ser `custo_real` fixo e passou a ser `base(modo)`.

---

## 12. Emenda — dois modos de preço (story 3.1c). A invariante passa a ser função da base

- **Status:** Aceita. **Emenda, não supersessão.** Data: 2026-08-12. Autora: Aria.
- **Origem:** decisão do Marcos de 2026-08-12 registrada na story `docs/stories/story-3.1c-dois-precos-recuperar-girar.md` (**D1 = (b)**), e as questões que ela abre: a invariante (**C4**), o modo no snapshot (**C12**), o enquadramento do alerta (**C16**) e os **Riscos #4, #5 e #7** da 3.1c.
- **⚠️ Numeração das ACs:** todos os ponteiros `Cnn` desta §12 são da **v3 da story** (renumerada na v2). Se a story renumerar de novo, **os ponteiros se corrigem AQUI** — a ADR é o documento estável e a story continua mudando; tabela de-para foi descartada de propósito.
- **O que muda nesta ADR:** §4 ganha uma **segunda derivação** (não substitui a primeira); **§11 tem a invariante reescrita** (§12.2).
- **O que NÃO muda:** §3 (onde persistir e a ordem de escrita), §5 (Ref. AA informa; custo manda), §6 (G1/G1-b), §7.1, §7.2, §9, §10. Nenhuma decisão anterior é revertida.
- **Consequência de processo:** a 3.1c **passa a ter migration** (§12.6) e muda o contrato do motor ⇒ volta pro `@pax-po` antes do dev; a `@dara-data-engineer` vira **bloqueante**.
- **⚠️ Revisada no mesmo dia, 2026-08-12, por segunda decisão do Marcos: UMA CONSTANTE SÓ.** `REGUA_GIRAR_PCT` **deixa de existir**; os dois modos usam `REGUA_MINIMO_PCT` sobre bases diferentes (§12.1). Motivo: com duas constantes (1,066 sobre custo × 1,072 sobre compra), o modo "girar rápido" exibia o número **maior** nos 12 de 16 carros sem gasto — as duas constantes vinham de populações diferentes e invertiam quando as bases coincidiam. A revisão **não altera** I0–I3 nem a I-morta da §12.2: ela só torna a diferença entre os modos **inteiramente atribuível à base**.

### 12.0 A decisão que gera a emenda, e o que ela não autoriza

O modo "girar rápido" tem **piso em `valor_compra_repasse`**, não em `custo_real` — o Marcos escolheu ciente de que o preço fica **abaixo do custo total**.

O argumento decisivo é do River e é álgebra: `compra × K < compra + gastos ⟺ gastos > (K−1) × compra`. Sob piso no `custo_real`, **todo** carro com gastos acima desse limiar devolveria exatamente o custo (margem 0,0%) qualquer que fosse `K` — o modo viraria uma constante justamente nos carros que ele existe pra atender, e os gastos seriam sempre integralmente recuperados **por construção**, que é o oposto do comportamento descrito. (Com o `K = 1,072` vigente quando a D1 foi decidida, o limiar era 7,2%; com a constante única de §12.1, `K = 1,066` e o limiar é **6,6%** — o argumento não muda de força, só de número, e fica **mais** abrangente.) Coerente com o medido: PRD1J39 vendeu a 90.000 com custo 92.000 (−2,2%); RWI9B84 teve mínimo 222.500 com custo 223.000.

**O que a decisão não autoriza:** piso na compra **não é ausência de piso**. O motor continua tendo piso, e continua sendo proibido de sugerir abaixo dele. O que mudou é **de que número** ele é piso. Essa distinção é a §12.2 inteira, e é o que separa esta emenda de "afrouxar a guarda".

### 12.1 Uma constante só, duas bases — e os cruzamentos que sobram

**Decisão do Marcos, 2026-08-12 (segunda da mesma data):**

```
recuperar_tudo :  REGUA_MINIMO_PCT × custo_real
girar_rapido   :  REGUA_MINIMO_PCT × valor_compra_repasse     // MESMA constante, 1,066
```

**`REGUA_GIRAR_PCT` não existe.** Não é simplificação de código: é a correção de um defeito de calibração. As duas constantes vinham de **populações diferentes** — 1,066 é a mediana sobre `custo_real` nos **16**; 1,072 era a mediana nos **12 sem gasto**, onde compra ≡ custo. Comparar uma com a outra sobre bases que coincidem invertia o sinal, e a inversão aparecia justamente no caso majoritário.

**O que a constante única compra, e que duas constantes não compravam:**

```
minimo_recuperar − minimo_girar  =  REGUA_MINIMO_PCT × Σ gastos      (exato)
```

A diferença entre os modos passa a ser **inteiramente atribuível à base**, é monotônica em `Σ gastos`, e é **zero se e somente se `Σ gastos = 0`**. Igualdade por construção — afirmável como identidade em teste, não como coincidência numérica a R$ 480 de distância. Idem no compre-por, com o fator `REGUA_MINIMO_PCT / RAZAO_MINIMO_SOBRE_COMPRE_POR`.

**Consequência pra honestidade de amostra (C17), e ela melhora:** não há mais "constante de n=12 transposta" pra declarar. Há **uma** constante de n=16 e **duas** bases. A incerteza residual deixa de ser *"qual constante"* e passa a ser *"a base está certa"* — que é exatamente onde a evidência fraca mora (os n=4 com gasto, 102,0% sobre custo × 105,6% sobre compra). A C17 fica mais simples **e** mais verdadeira: a assimetria a declarar é de **base**, não de constante. É também o Risco #6 da 3.1c: a régua única roda em duas bases sem calibração específica de nenhuma delas.

**Consequência pra C3 e o Edge case #1 (`@uma-ux`):** em carro sem gasto os dois modos não ficam "a R$ 480 de distância" — ficam **idênticos, byte a byte**. Isso agrava o "essa tela mostra a mesma coisa duas vezes" em vez de aliviá-lo, porque agora é literalmente verdade em 12 de 16 carros. A C3 deixa de poder dizer "coincidem, e o girar está por cima": tem que **colapsar as duas colunas numa só** com a explicação, ou dizer sem rodeio que não há segunda conta a fazer neste carro. Isso é decisão de tela, não de motor — passa pra `@uma-ux`.

#### Os cruzamentos, recalculados

Tudo continua sendo função de uma única razão adimensional:

```
g = Σ gastos ÷ valor_compra_repasse
```

Com `M = REGUA_MINIMO_PCT = 1,066` e `R = RAZAO_MINIMO_SOBRE_COMPRE_POR = 0,952`:

| | Limiar | Fórmula | O que muda ao cruzar | Quem consome |
|---|---|---|---|---|
| ~~**C-a**~~ | — | — | **EXTINTO.** Com constante única, `girar ≤ recuperar` sempre, com igualdade sse `g = 0` | — |
| **C-b** | `g > 6,6%` | `g > M − 1` | `mínimo_girar < custo_real` | **alerta C10; enquadramento C16 (§12.8); Risco #4** |
| **C-c** | `g > 11,97%` | `g > M/R − 1` | `compre_por_girar < custo_real` | `classificarBadge` em `/repasses` |

**⚠️ C-b NÃO se extingue, e a confusão é fácil de fazer** — os dois papéis do "7,2%" na story eram distintos:

1. **Papel na D1** — sob piso em `custo_real`, era o ponto em que o modo girar **travava** no custo e virava constante. Sob piso na compra o motor não trava mais no custo, e **esse** papel de fato desaparece.
2. **Papel na C10 / C16 / §12.8** — é o ponto em que o mínimo do modo girar **cai abaixo** do `custo_real`. Esse papel é o **gatilho de tudo que a §12.8 organiza**, e ele não só permanece como **passa a morder mais cedo: 6,6% em vez de 7,2%**.

Tratar C-b como extinto deixaria a **C16** sem condição de disparo definida — e a C16 existe precisamente porque `valor_minimo < custo_real` vira rotina. **O limiar da C10 e da C16 é 6,6% de `g`.**

**C-c muda de número:** `1,066/0,952 = 1,119748` ⇒ `g > 11,9748%`, contra os 12,61% da versão de duas constantes. O efeito é idêntico: acima disso `classificarBadge` (`src/lib/repasses/margem-repasse.ts:153`) avalia a função canônica em `oferta = valor_compre_por`, o primeiro teste de `classificarMargem` (`:142`) devolve vermelho, e **o badge do carro na lista `/repasses` fica 🔴**. O DoD da 3.1c manda "verificar o que `/repasses` faz" sem dizer o número — **é 11,97%**.

**PRD2189 recalculado** (`compra 80.000 · gastos 6.850 · custo 86.850 · g = 8,5625%`) — entre C-b e C-c, como antes:

| | Mínimo exato | Mínimo exibido | Compre-por exato | Compre-por exibido | Sobre `custo_real` | Gastos não recuperados |
|---|---|---|---|---|---|---|
| Recuperar tudo | 92.582,10 | **92.600** | 97.250,63 | **97.300** | +6,6% | R$ 0 |
| Girar rápido | **85.280,00** | **85.300** | **89.579,83** | **89.600** | −1,8% | 1.570 sobre o sugerido · **R$ 1.550 sobre o aplicado ← é este que vai pra tela** |

Os números da 3.1c mudam: o mínimo do girar era 85.760/85.800 e o não-recuperado era R$ 1.090. **Passam a ser 85.280/85.300 e R$ 1.570 sobre o par sugerido.** A **C10** exige o valor **calculado** — o texto do alerta tem que sair da conta, nunca de constante escrita à mão.

> **⚠️ Desempate: o número que vai pra TELA é R$ 1.550, não R$ 1.570.**
> A divergência é real e tem explicação: esta §12 calcula sobre o par **sugerido** (85.280,00 ⇒ 86.850 − 85.280 = **1.570**), porque o sugerido é o canônico da derivação e é o que fecha com I1/I2. A **C10 manda calcular sobre o par aplicado** — o arredondado a R$ 100 que preenche os campos e que o Marcos de fato digita no portal (85.300 ⇒ 86.850 − 85.300 = **1.550**).
> **Prevalece a C10.** O alerta descreve o que ele está prestes a fazer, não o que o motor calculou antes de arredondar; dizer "você abre mão de R$ 1.570" e anunciar um preço que abre mão de R$ 1.550 põe um número errado na tela — a mesma falha que a C10 já barrou ao proibir "não recupera R$ 6.850".
> Os R$ 1.570 desta seção são **derivação**, não especificação de UI. **Não hard-codar nenhum dos dois:** os dois saem de conta, e a diferença entre eles é exatamente o arredondamento da AC18 da 3.1.

**Efeito colateral sob C-b, dentro de `classificarMargem`** (inalterado pela revisão): com `mínimo < custo_real`, a faixa 🟠 ("Abaixo do mínimo, acima do custo") fica **vazia** — e ofertas **no ou acima do mínimo anunciado** classificam 🔴. "Bateu o mínimo" e "vermelho" passam a coexistir. É semanticamente correto (é prejuízo de fato) e **não se conserta em `margem-repasse.ts`** — a função continua certa. O que muda é que, em carro girado, o vermelho perde a leitura "alguém errou". Ver §12.8.

### 12.2 A invariante nova — substitui a formulação da §11

```
base(modo) =  recuperar_tudo → custo_real
              girar_rapido   → valor_compra_repasse

I0   base(modo) > 0                              pré-condição: sem ela não há sugestão
I1   minimo_sugerido      ≥ base(modo) × PISO_PCT
I2   compre_por_sugerido  ≥ minimo_sugerido      incondicional, nos DOIS modos
I3   I1 e I2 valem sobre o par SUGERIDO, NUNCA sobre o par APLICADO   (mantida da §11)
```

E, com o mesmo peso, o que **deixa de ser** invariante — escrito aqui em negativo de propósito, porque existe um teste que o afirma:

```
I-morta   minimo_sugerido ≥ custo_real
```

Não é invariante do sistema. É **corolário** de I1 no modo `recuperar_tudo` (onde `base = custo_real`) e é **falso por desenho** no modo `girar_rapido` sempre que `g > 6,6%` (C-b, §12.1). *(O limiar era 7,2% enquanto existia `REGUA_GIRAR_PCT`; sob a constante única é `REGUA_MINIMO_PCT − 1`. Este parágrafo é a autoridade citada pela C4 da story — o número aqui tem que ser o vigente.)*

**Três propriedades que derivam de graça, e que valem teste** (I0–I3 valem palavra por palavra com constante única — a revisão da §12.1 não toca em nenhuma delas):

1. `base(girar) ≤ base(recuperar)` **sempre**, porque `Σ gastos ≥ 0`. Com **constante única**, isso agora implica também `minimo_girar ≤ minimo_recuperar` e `compre_por_girar ≤ compre_por_recuperar` — o que **não** era verdade com duas constantes (era o cruzamento C-a, extinto).
2. `minimo_recuperar − minimo_girar = REGUA_MINIMO_PCT × Σ gastos`, **exato**, com igualdade a zero **sse** `Σ gastos = 0`. É a identidade da §12.1 e é a asserção mais forte da suíte: falha se alguém reintroduzir uma segunda constante.
3. `minimo_sugerido ≥ valor_compra_repasse` nos **dois** modos. É o piso comum, e é a única garantia de *"não perco no carro"* que sobrevive à emenda. **Recomendo que seja essa a invariante afirmada globalmente na suíte**, com I1 afirmada por modo.

### 12.3 O teste que quebra — a quebra é ESPERADA, e o conserto errado é previsível

Alvo: `tests/precificar-repasse.test.ts`, o caso que afirma `minimo ≥ custo_real`.

**A quebra é o comportamento correto.** Registro aqui os três "consertos" errados, porque cada um deles é mais barato de escrever do que o certo e cada um reverte a decisão do Marcos em silêncio, dentro de um arquivo de teste que ninguém revisa como decisão:

- ❌ afrouxar pra `minimo ≥ custo_real * 0,9` — inventa uma tolerância que não sai de dado nenhum;
- ❌ pular a asserção no modo girar — apaga a única garantia que o modo ainda tem (I1);
- ❌ passar `custo_real` como base do girar "só pro teste passar" — é literalmente a opção (a) que o Marcos recusou.

**Reescrita correta, em três casos:**

1. **`recuperar_tudo`:** `minimo ≥ custo_real` — **inalterado**. É o corolário de I1 nesse modo, e é a não-regressão da 3.1a (C1 da 3.1c).
2. **`girar_rapido`:** `minimo ≥ valor_compra_repasse` (I1) **e — no mesmo caso — `minimo < custo_real` afirmado como resultado ESPERADO** num carro com `g > 6,6%` (C-b). Usar o PRD2189 (compra 80.000, gastos 6.850, custo 86.850 ⇒ **mínimo 85.280,00**). **Um teste que EXIGE o preço abaixo do custo é o que impede o conserto na direção errada** — é a asserção que transforma a decisão do Marcos em regressão detectável.
3. **`compre_por ≥ minimo` nos dois modos** (I2), via o override de parâmetros da AC10.
4. **Identidade da constante única** (propriedade 2 da §12.2): `minimo_recuperar − minimo_girar = REGUA_MINIMO_PCT × Σ gastos`, e **os dois modos byte a byte iguais** quando `Σ gastos = 0`. É o teste que barra a reintrodução de uma segunda constante — inclusive por engano, num merge.

**Comentário obrigatório no arquivo**, apontando pra esta §12.2 e pra decisão do Marcos de 2026-08-12. Sem ele, o caso 2 lê como bug na próxima sessão — e o dano é que alguém o "conserta".

### 12.4 Os sítios de `custo.custoReal` no motor — são mais de três

O River contou **três clamps**. A conta correta sobre `src/lib/pricing/sugerir-preco-repasse.ts` como está hoje: **cinco sítios trocam de número, três não podem trocar, um não muda e um falta.** Deixar qualquer um de fora não produz erro visível — produz um par internamente coerente com a base errada, que é o modo de falha que o River identificou corretamente mesmo tendo errado a contagem.

**Trocam para `base(modo)`:**

| # | Sítio | Linha | Natureza |
|---|---|---|---|
| 1 | `custo.custoReal * razaoMinimo` | 599 | **BASE do mínimo** — não estava na lista do River |
| 2 | `if (minimoSugerido < custo.custoReal)` | 600 | clamp do dinheiro *(River #2)* |
| 3 | `custo.custoReal * razaoComprePor` | 601 | **BASE do compre-por** — não estava na lista do River |
| 4 | `arredondarRespeitandoPiso(minimoSugerido, custo.custoReal)` | 605 | clamp do arredondamento *(River #3)* |
| 5 | `formatBRL(custo.custoReal)` no alerta de arredondamento | 609 | texto — número errado na tela, não só cosmético |

**NÃO trocam — continuam sobre `custo_real`:**

| # | Sítio | Linha | Por quê |
|---|---|---|---|
| 6 | `minimoSugerido / custo.custoReal` | 615 | §12.5 |
| 7 | `comprePorSugerido / custo.custoReal` | 616 | §12.5 |
| 8 | `bandaMinimo` p25/p75 × `custo.custoReal` | 697-698 | a banda é dispersão do mínimo **sobre custo** entre 16 carros. Reaplicá-la sobre a compra é o **erro de eixo** que a §4 registrou no "compre-por = p75", repetido. **No modo girar a banda não deve existir** — a **C7** resolve melhor do que eu tinha proposto: o *motor* devolve `bandaMinimo = null`, em vez de a UI omitir. Regra testável sobre função pura, e nenhuma tela futura pode exibi-la por engano |

**O terceiro item do River (`razaoMinimo < params.PISO_PCT`, linha 574) NÃO muda — e isso merece nota**, porque parecer que muda é o caminho pra estragá-lo. Ele vive em **espaço de razão**, e razão é adimensional em relação à base: `PISO_PCT = 1,0` significa "nunca abaixo de 100% da base", qualquer que seja a base. Ele fica correto sozinho, e com a **constante única** da §12.1 fica correto **sem nenhuma mudança a montante também**: `razaoMinimo` parte de `REGUA_MINIMO_PCT` nos dois modos. Convertê-lo para dinheiro seria regressão — e é a "correção" que um leitor apressado da **C5** faria. **Sob constante única, este item some inteiramente da lista de trabalho:** o motor passa a ter **5 sítios que trocam de base e nada mais**.

*(Nota de coerência com o Edge case #3 da 3.1c: `bateu_piso` é **inalcançável** com `REGUA_PADRAO` nos dois modos — o teto efetivo dos ajustes é 5 pontos contra 6,6 de folga até `PISO_PCT`. Isso **não** dispensa nada aqui: a linha 574 continua tendo que estar correta, e o COMMENT da §12.7 existe justamente pro dia em que alguém editar uma constante à mão, que a AC10 permite.)*

**A guarda que FALTA, e que a emenda cria (linha 555):** hoje o motor recusa `custo.custoReal <= 0`. No modo girar a pré-condição é `base(modo) > 0`, e existe um carro que **passa hoje e não deveria**: **compra = 0 com gastos > 0**. `decomporCusto` aceita compra zero (só recusa negativo, linha 390), então `custo_real > 0` passa a guarda enquanto `base(girar) = 0` ⇒ mínimo R$ 0,00. A guarda tem que virar `base(modo) <= 0`, com mensagem pt-BR própria — dado errado e dado ausente pedem ações diferentes, como a linha 544 já faz.

**Estado:** era buraco sem AC na v1 da story (o antigo Risk #9 só falava em compra "nula ou negativa"); **a v3 fechou como C6 + Edge case #2**. Duas notas que a v3 acrescentou e que eu subscrevo: (a) o conserto **não** pode ser um `valor_compra_repasse > 0` global — barraria o caso legítimo do modo recuperar, onde compra 0 com gastos é custo válido; a guarda é **condicional ao modo**. (b) O CHECK `rep_prec_base_do_modo_positiva_chk` da 032 é **último anteparo**, não a proteção: se ele disparar em produção, o bug é do motor, e um clique de "Aplicar" abortando por constraint é o sintoma.

### 12.5 `minimo_razao_efetiva` — o River está certo, e por um motivo mais forte que o dele

**Confirmado: razão sobre `custo_real` nos DOIS modos.** As constantes vivem em `parametros_regua`, nunca na coluna de razão efetiva. (Com a constante única da §12.1 o risco de confusão diminui — não há mais uma constante "do girar" pra alguém gravar aqui por engano —, mas a decisão não muda: no modo girar a razão efetiva **continua** não sendo `REGUA_MINIMO_PCT`, porque o denominador é `custo_real` e a base foi a compra.)

O argumento do River é "senão o COMMENT mente". Verdadeiro, mas fraco — COMMENT se corrige. O argumento que sustenta a decisão: **a coluna existe pra que `razão × custo_real` reproduza o preço gravado**, e é essa identidade que torna a linha auditável seis meses depois sem reexecutar o motor. Ela sobrevive à emenda **só se o denominador for uniforme entre modos**, e `custo_real` é o único candidato uniforme — é `NOT NULL` e verificado pelo `rep_prec_custo_decomposto_chk` (`030:212`). Se o denominador variasse com o modo, toda leitura futura precisaria saber o modo **antes** de saber o que a razão significa; a coluna deixaria de ser legível isoladamente.

Confere no PRD2189 sob girar: `85.280,00 ÷ 86.850,00 = 0,981923`.

> **⚠️ A identidade fecha a ±R$ 0,01, NÃO exatamente — e isso é por construção, não bug.**
> A volta dá `0,981923 × 86.850 = 85.280,01`, R$ 0,01 acima. Motivo: `minimo_razao_efetiva` é `numeric(9,6)` e a razão exata é `0,9819228…` — seis casas não guardam o resto.
> **O valor autoritativo é sempre `minimo_sugerido`** (`numeric(12,2)`), nunca a razão. A razão é **derivada** e serve pra auditar a ordem de grandeza sem reexecutar o motor, não pra reconstituir o centavo.
> **Nenhum teste pode exigir round-trip exato**, e **nenhum COMMENT da 030/032 pode afirmar igualdade exata** — o COMMENT atual da 030 usa `0,987450 × 86850` e erra R$ 0,03, o que basta pra alguém "consertar" o motor.
> Registro isto com ênfase porque o projeto trata R$ 0,01 de divergência como **bug crítico** (AGENTS.md §4) e essa é a **única exceção legítima** da fatia: aqui o centavo não é dinheiro, é arredondamento de uma grandeza derivada. Está espelhado no Edge case #4 da 3.1c de propósito — são os dois documentos que um "consertador" abriria.

**Nenhuma correção de COMMENT é necessária aqui.** O COMMENT de `minimo_razao_efetiva` / `compre_por_razao_efetiva` (`030:372-375`) continua verdadeiro palavra por palavra — "razão sobre `custo_real` após ajustes e após o clamp do piso" descreve exatamente o que passa a ser gravado nos dois modos. O exemplo numérico embutido ("1.066000 = 106,60%") vira um dos dois casos; **acrescentar** o exemplo do girar é melhoria opcional, não correção. Isso separa nitidamente esta coluna de `bateu_piso` (§12.7), que **precisa** de correção.

**Consequência útil que ninguém registrou:** sob girar com o piso mordendo, fica `bateu_piso = true` **e** `minimo_razao_efetiva < 1`. Sob recuperar com o piso mordendo, fica `bateu_piso = true` **e** `minimo_razao_efetiva = 1,000000` exato. Os modos ficam distinguíveis a posteriori mesmo sem coluna. **Isso NÃO é argumento pra dispensar a coluna `modo`** — é inferência apoiada em coincidência numérica, o mesmo tipo de raciocínio que a §4 rejeitou no "compre-por = p75". Vale como **checagem cruzada** da coluna, jamais como substituta dela.

### 12.6 Decisão — o modo é **coluna de primeira classe**. Migration **032**.

| # | Opção | Prós | Contras | Veredito |
|---|---|---|---|---|
| 1 | **Sufixo em `versao_regua`** (`…__girar_rapido`) | Zero migration; `TEXT NOT NULL` garante que nenhuma linha nasce sem *alguma* string | O único CHECK é `length BETWEEN 1 AND 60`: `__girar-rapido`, `__girar_rapido ` (espaço) ou uma versão bumpada **sem** sufixo passam todos, e criam uma terceira população fantasma. `split_part` devolve `''` em silêncio. É **convenção não-verificada no campo que particiona a população** | **Rejeitado como FONTE** (mantido como redundância — ver abaixo) |
| 2 | Chave `modo` dentro de `parametros_regua` | Zero migration | String num mapa de números (o River já apontou); `rep_prec_jsonb_forma_chk` não alcança o valor; filtro por `->>` sem índice nem domínio | **Rejeitado** |
| 3 | Derivar do conteúdo (`bateu_piso` × razão efetiva, ou comparar a razão com as constantes) | Zero schema | Inferência sobre coincidência numérica (§12.5). **A revisão da §12.1 mata esta opção de vez:** com **constante única**, `parametros_regua` fica **idêntico** nos dois modos — não sobra nada no conteúdo que distinga a população. O modo passa a ser informação que existe *só* se for declarada | **Rejeitado — e agora impossível** |
| 4 | **Coluna `modo TEXT NOT NULL` + CHECK nomeado, migration 032** | O banco garante que **toda** linha declara sua população; `GROUP BY modo` sem `split_part`; a mesma migration carrega a correção do COMMENT de `bateu_piso` | Uma migration a mais; a 3.1c deixa de ser "sem migration" | **Adotado** |

**O fato que decide, e que a story não tinha na mão.** Consultei o projeto `mesa` (`gjyzcyamwdldnriqydua`) em 2026-08-12: a **030 está aplicada** (`20260812122106`) e a tabela `repasse_precificacao_sugerida` tem **zero linhas**. Numa tabela vazia, `ADD COLUMN modo TEXT NOT NULL` **sem `DEFAULT`** é instantâneo e **dispensa backfill** — não há passado pra inventar.

Esta é a **última janela em que a coluna é grátis.** No instante em que a primeira linha entrar, `NOT NULL` passa a exigir ou um `DEFAULT` que **chuta** o modo de uma linha histórica, ou uma coluna **nullable** — e discriminador de população nullable é precisamente o defeito que destruiria o valor da tabela. O custo de decidir errado aqui não é uma migration: é a mesma classe de dano irrecuperável (§2.3) que motivou a tabela existir.

**A revisão da §12.1 tornou a coluna ainda menos dispensável.** Com **constante única**, `parametros_regua` fica **byte a byte idêntico** nos dois modos: o único vestígio do modo dentro da linha passaria a ser o sufixo em `versao_regua` — texto livre, verificado só por `length BETWEEN 1 AND 60`. A opção 1 deixa de ter qualquer rede de segurança por trás dela.

**O argumento de princípio, que sustenta a decisão mesmo sem o fato acima:** a 030 inteira foi desenhada pra que **nenhuma garantia semântica dependesse de convenção** — `rep_prec_custo_decomposto_chk`, `rep_prec_carimbo_coerente_chk`, `rep_prec_jsonb_forma_chk`, `rep_prec_confianca_chk` e o trigger de append-only. Deixar de fora justamente o campo que **particiona a população pra recalibração** — a única razão de a tabela existir — inverteria o princípio do próprio arquivo, no campo mais importante dele.

**`versao_regua` continua ganhando o sufixo do modo** — não como fonte da verdade, como **redundância legível**. Com a coluna presente, bumpar a versão e esquecer o sufixo vira inconsistência **detectável** (`modo` × sufixo), em vez de uma população perdida em silêncio.

#### Forma dos dados para a `@dara-data-engineer` — DDL é dela (§3)

- **`modo`** `TEXT NOT NULL`, domínio fechado por CHECK nomeado, **dois** valores: `recuperar_tudo`, `girar_rapido`.
- **NÃO reservar um terceiro valor.** Ao contrário de `confianca.media` (§11, desvio 4), aqui um valor a mais no CHECK **não** é seguro barato: um terceiro modo mudaria a **base do preço**, e um CHECK que já o aceita convida a gravar linhas de um modo que o motor não implementa. O terceiro modo está OUT na 3.1c e volta como **decisão**, não como slot vago (ver **T6**, §12.11).
- **Sem `DEFAULT`.** Toda linha declara o modo explicitamente. Nascer com default é a mesma classe de erro que a coluna existe pra evitar.
- **Nenhum índice novo.** O argumento da §3 da 030 vale igual: dezenas de linhas por ano, seq scan de qualquer jeito. Índices se decidem com `EXPLAIN ANALYZE` sobre query real, quando houver volume.
- **Corrigir o COMMENT de `bateu_piso`** na mesma 032 (§12.7).
- **Sem CHECK cruzado** do tipo `modo='recuperar_tudo' ⇒ minimo_sugerido ≥ custo_real`. Tentador, e errado pelo mesmo motivo da §11 desvio 1: a invariante é do motor, e um CHECK que aborta o clique de "Aplicar" destrói o dado que a tabela existe pra capturar.
- **Numeração: 032.** A **031 segue reservada** pro `COALESCE` nos writes da 028 (§6, nota de numeração) e **continua não aplicada** — confirmado na lista de migrations do projeto, onde a 030 é a última. Pular a 031 não a cancela nem a antecipa; G1-b segue desarmado (§12.9).

### 12.7 `bateu_piso` — COMMENT corrigido na 032, e a armadilha que a coluna resolve

**Semântica nova:** *"a sugestão travou no piso do **modo**"*, sendo o piso `base(modo) × PISO_PCT`. É a mesma linha de código de sempre; o que mudou é de que número ela é piso.

**Exige migration?** `COMMENT ON COLUMN` é DDL, então tecnicamente sim — mas a pergunta certa é outra: **não se emite migration só pra comentário**. Aqui o COMMENT viaja na **032**, que já existe por causa da coluna `modo`, e o custo marginal é zero. **Se por qualquer motivo a coluna `modo` cair, o COMMENT ainda assim precisa de migration própria — e aí ele é bloqueante sozinho**, porque um COMMENT dizendo "piso de custo" numa coluna que significa "piso da compra" é **pior que COMMENT nenhum**: a recalibração confia nele e não tem como saber que está errado.

Texto sugerido, no padrão sem acento da 030:

```
'true = a sugestao travou no piso do MODO (AC12 / ADR-003 §12.2): recuperar_tudo trava
 em custo_real, girar_rapido trava em valor_compra_repasse. Ler SEMPRE junto da coluna modo.'
```

**Fecha o Risco #7 da v1 da story** (o `bateu_piso` com dois significados; na v3 o ponto está absorvido pela **C12** e pelo Edge case #3)**:** com a coluna `modo` existindo, `bateu_piso` deixa de ser *"booleano com dois significados dependendo de uma coluna que não está lá"* e vira *"booleano lido junto de uma coluna que o banco garante presente e de domínio fechado"*. A armadilha de recalibração que o River identificou é resolvida **pela coluna**, não pelo COMMENT — o COMMENT só a documenta.

### 12.8 Abaixo do custo **por decisão** × **por erro** — sim, a §11 precisa dizer

**Resposta: sim.** E a distinção não é de UI: é de **origem do dado**. Fica registrada em ADR porque a **C16** vai implementá-la e, sem isto escrito, ela lê como regra de alerta improvisada. É também a resposta ao **Risco #4** da 3.1c (o "abaixo do custo" que vira rotina em dois lugares e dois limiares).

O sistema hoje tem **um** predicado — `valor_minimo < custo_real` — atendendo **três** situações que pedem reações diferentes:

| Origem | Como se identifica (derivado, não armazenado) | Reação certa |
|---|---|---|
| **Decisão** — girado deliberadamente | snapshot mais recente do repasse com `modo = 'girar_rapido'` e `minimo_aplicado` batendo com o `valor_minimo` atual | **nota neutra**: "girado sobre a compra — R$ X de gastos não recuperados" |
| **Deriva** — o custo subiu depois, por gasto tardio | existe snapshot, e o `custo_real` **do snapshot** é menor que o `custo_real` de hoje | **o vermelho original, intacto.** É exatamente o caso que o Risk #8 da 3.1 mirava |
| **Fora do sistema** — veio do portal via import, ou de edição inline | não há snapshot, **ou** o `minimo_aplicado` do último snapshot não bate com o `valor_minimo` de hoje | **vermelho** — e é o mais informativo dos três: alguém anunciou abaixo do custo sem passar pela aba |

Os três são **derivados**. A §3 recusou coluna de procedência (opção 6) e a ADR-002 §4.5 recusou procedência por campo; **a emenda não reabre nenhuma das duas** — e note que a própria §3 já previu esta saída ao escrever que *"a saída não é coluna de procedência — é derivar o estado comparando o snapshot mais recente com a data do último import"* (§9.3).

**Mudança de status que precisa ficar registrada:** a §3.4 declarou a tabela **write-only** e a §9.2 aceitou explicitamente o custo de ela ficar sem leitor. **A C16 é o primeiro leitor da 030**, e ele chega **antes** do n de recalibração. Isso não invalida a §3.4 (não entra tela de histórico), mas muda o cálculo de custo/benefício da tabela pra melhor, e muda o escopo da story:

> **Correção de escopo obrigatória na 3.1c:** o OUT dizia *"tela de histórico / leitura da 030 — continua OUT"*. Tem que ser: **"tela de histórico: OUT. Leitura pontual do snapshot mais recente do repasse, para desambiguar o alerta de abaixo-do-custo (C16): IN."** Sem isso, o `@dex-dev` implementa a C16 e o `@quinn-qa` a marca corretamente como escopo fora.

**E a regra que fecha o assunto:** *sob o modo girar, "abaixo do custo" não é alerta — é a descrição do modo.* O número que o Marcos precisa ver não é "atenção, abaixo do custo" (foi ele que escolheu), é **quanto** ele está abrindo mão: **R$ 1.550 de R$ 6.850** no PRD2189 — sobre o par **aplicado**, conforme o desempate da §12.1 (a §12 deriva 1.570 sobre o sugerido; **prevalece a C10**). A C10 já está certa ao exigir o valor **calculado** e não o total de gastos. O fato de esse número ter mudado três vezes em um dia (1.090 → 1.570 → 1.550) é a melhor prova de que ele nunca pode ser escrito à mão. **O vermelho fica reservado pro que ele não escolheu.** Alerta que toca sempre é alerta que ninguém lê — a mesma razão que matou o alerta de piso na §5.2 e o alerta de teto sobre o compre-por na §5.1.

### 12.9 AC13–AC15 e `confianca` — confirmadas, sem alteração

1. **Ref. AA e FIPE seguem sem efeito numérico, nos dois modos.** A §5 (*"Ref. AA informa; custo manda"*) não é enfraquecida pela emenda — é **reforçada**: com **duas** bases, uma referência com poder numérico teria que escolher **qual** base corrigir, e não existe dado que decida isso. **G1-b (§6, §10-T3) continua desarmado** e a migration **031 continua não-bloqueante**. O teto continua se aplicando ao **mínimo** e nunca ao compre-por; sob girar ele passa a morder **menos** (o mínimo é menor), o que é a direção certa — o teto existe pra pegar mínimo caro demais, não barato demais (§5.2).
2. **`confianca` NÃO é rebaixada no modo girar.** Concordo com o River, e o argumento decisivo está na §11 desvio 4: `media` foi reservado no CHECK como nível do **mesmo eixo** — qualidade da referência de mercado. Usar `confianca` pra dizer "esta régua é menos calibrada" mistura dois eixos num campo de um eixo só, e o dano aparece na recalibração: o único campo da tabela com significado fechado deixaria de ter. A calibração mais fraca do modo girar é **propriedade do modo, não da linha** — e portanto **já está declarada pela coluna `modo`** (§12.6). Comunicá-la é trabalho de alerta e rótulo de amostra na UI (**C10** e **C17**), que é onde ela pertence.

### 12.10 O que esta emenda **não** decide

- **D2 — ajuste de dias parados no modo girar.** É do Marcos, com a medição do `@alex-analyst`. O **Risco #3** da 3.1c é o mesmo double-count que matou o ajuste de km, e ele se resolve pela medição (ii) — os 2,0 pontos remedidos **sobre a compra** —, não por argumento arquitetural. O que a emenda **impõe** é que, qualquer que seja a resposta, o ajuste continue operando em **espaço de razão** (§12.4, linha 574) e portanto seja base-agnóstico **por construção** — a constante `AJUSTES_APLICAM_NO_MODO_GIRAR` da **C11** é chave liga/desliga, nunca uma segunda fórmula.
- ~~**O valor de `REGUA_GIRAR_PCT`**~~ — **item extinto pela §12.1.** A constante não existe mais, e com ela sai do **T2** (§10) o item de recalibração próprio do modo girar. Resta o de `REGUA_MINIMO_PCT`, que já estava lá. **O que entra no lugar, e é mais barato de medir:** a pergunta do T2 pro modo girar deixa de ser "qual constante" e passa a ser **"a base está certa"** — mediana de `minimo_que_vendeu ÷ valor_compra_repasse` nos carros **com** gasto (hoje n=4, 105,6%) contra `REGUA_MINIMO_PCT`. Se as duas convergirem quando o n crescer, a escolha de base está validada; se divergirem, o modo girar precisa de constante própria **de novo** — e aí ela volta com dado, não com transposição.
- **§7.3, `TETO_REF_AA_PCT`** — segue aberta, e segue sem tocar o schema.
- **Escolha automática de modo** por dias parados/status/destino — OUT na 3.1c, e concordo: é a pergunta da D2 com a resposta escondida num default.

### 12.11 Gatilho novo

- **T6 — um terceiro modo de preço.** No dia em que existir ("preço de showroom", política de classes A–E), esta §12 volta inteira: `base(modo)` deixa de ser escolha binária, o CHECK de `modo` muda, os cruzamentos da §12.1 deixam de ser três, e a pergunta que hoje não precisa de resposta — *o piso é sempre `base(modo)`, ou existe modo cujo piso é de outra grandeza?* — passa a precisar. Registrado como gatilho e deliberadamente não resolvido agora: resolver hoje seria inventar requisito.
