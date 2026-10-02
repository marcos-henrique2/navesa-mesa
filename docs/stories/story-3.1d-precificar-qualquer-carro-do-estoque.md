# Story 3.1d — `/precificar` responde por qualquer carro do estoque, não só pelos que estão em repasse

> Épico 3 — **Precificação assistida de repasse**. Quarta fatia da story 3.1
> (`docs/stories/story-3.1-aba-precificar.md`, v4). Depende da **3.1a e da 3.1c implementadas e em
> produção**. Não substitui nenhuma das duas — **estende o alcance da busca** com uma **terceira
> base de custo**, para os carros que não têm ciclo de repasse.
>
> **v1 (13/ago/2026)** — River, a partir do pedido do Marcos e da medição de recalibração sobre
> `veiculos.custo_total` (n=57).
>
> **Convenção de numeração:** as ACs desta fatia são **E1…E20** (E de *estoque*), pra não colidirem
> com as AC1–AC31 da 3.1 nem com as C1–C19 da 3.1c. Referências cruzadas aparecem como
> "AC*nn* da 3.1" e "C*nn* da 3.1c".
>
> **Estado:** 🟡 rascunho — aguardando `@pax-po`. **Duas decisões do Marcos em aberto** (D-E1 e
> D-E2, no fim do documento) e **uma medição de cobertura pendente** que não bloqueia o desenho,
> só o estado vazio.

---

## Contexto

A aba `/precificar` hoje só existe para carro que já tem linha em `repasses`. Fora disso ela devolve
um estado vazio — *"Esse carro está no estoque, mas ainda não foi marcado pra repasse"*
(`precificar-queries.ts:329-333`). O Marcos pediu o contrário:

> *"quando eu for pesquisar um carro nela eu preciso que pegue todos os carros de todas as lojas.
> Não é pra pegar só os carros de repasse"*

E, sobre de onde sairia o custo:

> *"a minha ideia era que essa calculadora já puxasse todos os dados que já temos no estoque, onde
> preciso ficar atualizando todo dia os gastos que os carros de estoque estão dando, independente se
> é repasse ou não. Todos vão ter esses gastos que já tem no sistema, tanto para venda normal quanto
> para venda de repasse. A base dos custos é sobre esses dados que já temos salvos."*

**O obstáculo era a base.** A régua de 106,6% da 3.1a foi calibrada sobre `custo_real =
valor_compra_repasse + Σ repasse_gastos`, e `valor_compra_repasse` **não existe** para carro fora do
repasse. Pior: ele não é importado — é **decisão do Marcos**. Medido em 58 carros, **21 têm
`valor_compra_repasse` diferente do custo do NBS**, sempre em valores redondos (R$ 25.000,
R$ 30.000, R$ 60.000) e quase sempre em carro com muitos dias de pátio. Quando o carro vai pro
repasse, ele **reavalia o custo pra baixo** (*write-down*). Não há como derivar isso para um carro
que ainda não foi reavaliado.

**A saída não é inventar a compra — é recalibrar a régua sobre a base que existe para todo carro.**
`veiculos.custo_total` é o custo do NBS, e é exatamente onde entram as despesas que o Marcos atualiza
todo dia. Medido nos mesmos vendidos (2026-08-13):

| Base | n | p25 | **Mediana** | p75 | Desvio | IQR |
|---|---|---|---|---|---|---|
| `custo_real` de repasse (a régua em produção) | 57 | 104,2% | **106,5%** | 109,6% | 0,1140 | 5,4 pt |
| **`veiculos.custo_total` (NBS)** | 57 | 91,8% | **96,2%** | 101,4% | **0,1115** | **9,6 pt** |

**As duas têm a mesma confiabilidade** — o desvio é praticamente idêntico (0,1115 × 0,1140). O que a
segunda perde é **precisão**, não confiança: o IQR abre de 5,4 para 9,6 pontos. Essa perda é aceita
e vai **declarada na tela** (E13), não escondida.

**Por que a régua fica abaixo de 100%:** o custo do NBS é **11% maior** que a base de repasse
(mediana de `custo_total ÷ custo_real` = 1,1079). É o mesmo fato que já motivou o modo "girar
rápido" da 3.1c — **o repasse não recupera as despesas de preparação**. A régua de 96,2% apenas
mede isso sobre a base cheia, em vez de sobre a base já reavaliada.

**Corroboração (empírica, não tautológica — medianas não compõem):** `1,066 ÷ 1,1079 = 0,9622`,
contra os **0,962** medidos direto. As duas medições independentes fecham em **0,02 ponto**. Isso é
evidência de coerência entre as duas réguas; **não é derivação**, e a constante **não pode** ser
escrita no código como `REGUA_MINIMO_PCT / 1.1079` — seria fabricar precisão a partir de um quociente
de medianas.

**A régua de 96,2% já absorve o write-down implicitamente.** Ela foi medida contra o custo do NBS
**sem** reavaliação — que é exatamente a situação do carro fora do repasse. Descontar o write-down
por cima dela seria cobrar duas vezes pelo mesmo sinal, o mesmo erro que derrubou o ajuste de km na
AC16 da 3.1.

### Decisão de escopo do Marcos (2026-08-13) — não ampliar

**A aba continua respondendo APENAS preço de repasse** — *"quanto eu pediria no Auto Avaliar"* — só
que para qualquer carro. Ele **descartou explicitamente** sugerir preço de showroom e mostrar os dois
lado a lado. Preço de varejo, classes A–E e o motor `@/lib/pricing/suggest.ts` seguem **fora** desta
fatia e de qualquer leitura dela.

---

## User Story

Como **Marcos (gestor de repasse B2B)**, eu quero **digitar a placa de qualquer carro de qualquer
loja e receber o preço de repasse sobre o custo que já está salvo no sistema** para **decidir se vale
mandar aquele carro pro Auto Avaliar sem precisar marcá-lo pra repasse antes, e sem refazer a conta
sobre um custo que eu já atualizo todo dia.**

---

## ⚠️ Por que isto NÃO viola a REGRA DE OURO

`src/lib/repasses/margem-repasse.ts:5-10` diz, em caixa alta: *"NUNCA usar `valor_aquisicao` — ele é
custo de VAREJO; repasse é B2B, base de custo MENOR. Cair pra `valor_aquisicao` acende carros
vermelhos falsos."* **Esta seção existe pra que o `@quinn-qa` não reprove corretamente uma coisa
certa** — e para que ninguém, seis meses depois, "conserte" a régua de estoque de volta.

1. **Não estamos usando `valor_aquisicao`.** A base é `veiculos.custo_total`. São colunas diferentes,
   com significados diferentes: `valor_aquisicao` é a nota de fábrica; `custo_total` é a nota **mais
   as despesas acumuladas**, que é justamente o dado que o Marcos mantém atualizado.
2. **Não estamos aplicando a régua de repasse sobre uma base de varejo.** A régua **foi recalibrada
   sobre esta base**, com `n=57` e desvio equivalente ao da régua em produção (0,1115 × 0,1140).
   O que a REGRA DE OURO proíbe é **transpor** uma constante de uma base pra outra — exatamente o
   defeito que a D3 da 3.1c corrigiu. Aqui a constante **nasce** da base.
3. **O efeito da regra é o oposto do que ela teme, e é declarado.** A REGRA DE OURO existe pra impedir
   que um custo maior produza **margem falsamente negativa**. Aqui o preço fica **legitimamente
   abaixo do custo total** (96,2%), a UI diz isso em pt-BR (E12), e o teste **exige** que fique
   (E19) — no mesmo espírito do teste do PRD2189 na C18 da 3.1c.
4. **A proibição vira garantia de tipo, não de disciplina.** `valor_aquisicao` é **exibido** na
   decomposição do custo (E7) mas **não tem campo** na entrada do motor (E6): "precificar sobre a
   nota de fábrica" não é um estado representável. Mesmo padrão da C19 da 3.1c — o conserto é de
   assinatura, não de teste.

**O que continua proibido, sem exceção:** usar `valor_aquisicao` como base de preço, como piso, ou
como fallback de `custo_total`. Carro sem `custo_total` não recebe sugestão (E10).

---

## A régua de estoque

```
base_estoque = veiculos.custo_total          (do último snapshot de estoque)

REGUA_MINIMO_ESTOQUE_PCT      = 0.962   // mediana de (mínimo que vendeu ÷ custo_total), n=57, 2026-08-13
BANDA_ESTOQUE_P25             = 0.918   // mesma amostra
BANDA_ESTOQUE_P75             = 1.014   // mesma amostra
RAZAO_MINIMO_SOBRE_COMPRE_POR = 0.952   // REUSADA da 3.1 — NÃO duplicar

minimo_estoque     = custo_total × 0.962                    ≈  96,20% do custo total
compre_por_estoque = minimo_estoque ÷ 0.952                 ≈ 101,05% do custo total
```

Três consequências que precisam estar na tela e no código:

- **O mínimo fica 3,8% abaixo do custo total. Isso é a régua, não um erro.** É o mesmo fato que a
  D1 da 3.1c fixou pro modo girar: o repasse não recupera a preparação.
- **O compre-por fica 1,05% ACIMA do custo total.** Ou seja: quem encerra o anúncio na hora paga o
  custo cheio com 1 ponto em cima. Esse contraste é a frase mais honesta da tela (E12) e desarma a
  leitura "o sistema está sugerindo prejuízo".
- **A razão mínimo÷compre-por é reusada, não recalibrada** — ela mede distância *dentro do mesmo
  carro* (ADR-003 §4) e independe da base. Duplicá-la criaria duas constantes que sempre andariam
  juntas e que alguém recalibraria separadamente por engano.

### A banda p25–p75 **existe** aqui, e é obrigatória

Diferente do modo girar (C7 da 3.1c, onde `bandaMinimo` vem `null` porque **não há banda calibrada
sobre a compra**), aqui a banda foi medida **sobre a mesma base do preço**: 91,8% – 101,4%. Ela é
calculada e exibida — e é **ela** que comunica a perda de precisão aceita (IQR de 9,6 pontos contra
5,4 da régua de repasse). Suprimi-la seria esconder exatamente o que esta fatia trocou por alcance.

⚠️ **Amostras diferentes, não harmonizar:** as constantes de repasse em produção vêm de **n=16**
(jun–ago/2026); as de estoque vêm de **n=57** (2026-08-13). Os números não batem entre si de
propósito. **Recalibrar `REGUA_MINIMO_PCT` está OUT** (gatilho T2, n > ~40 vendas) — e um diff que
"alinhe" os dois conjuntos está violando esta story.

### Sem ajustes, sem piso: e por que cada ausência é uma decisão

| Peça da régua de repasse | Na régua de estoque | Motivo |
|---|---|---|
| Ajuste de **dias parados** (até −3 pt) | **NÃO aplica** | O relógio é outro (`dias_patio`, não `dias_no_repasse`) e a mediana de 96,2% foi medida numa amostra que **já mistura** carro parado e carro novo. Aplicar por cima é o double-count que matou o ajuste de km (AC16 da 3.1). Constante `AJUSTES_APLICAM_NA_REGUA_ESTOQUE = false`, com a medição que a flipa declarada **antes** (E20). |
| Ajuste de **`qtde_anuncios`** | **NÃO aplica** | O campo não existe fora de `repasses`, e mesmo lá está `NULL` em 59/59 (Risk #14 da 3.1). |
| **Piso** `PISO_PCT = 1.0` sobre a base | **NÃO existe** | ⚠️ **Load-bearing.** Um piso em 100% de `custo_total` travaria **todo** carro no custo — a régua é 96,2%, abaixo do piso. O modo viraria uma constante em 100% dos casos, que é literalmente o argumento algébrico que decidiu a D1 da 3.1c, repetido. Sem ajustes, não há nada a clampar: o mínimo é `base × 0,962`, exato. |

**Invariantes que sobrevivem** (adaptação da C4 da 3.1c):

- `I0` — `custo_total > 0` como **pré-condição**: sem ela não há sugestão (E10).
- `I2` — `compre_por_sugerido ≥ minimo_sugerido`, incondicional (vale porque `1/0,952 > 1`).
- `I3` — I0/I2 valem sobre o par **sugerido**, nunca sobre o exibido arredondado.
- **`minimo_sugerido ≥ custo_total` é FALSO POR DESENHO.** Não é invariante, não é alerta, não é bug.

---

## Acceptance Criteria

> As AC1–AC31 da 3.1 e as C1–C19 da 3.1c continuam valendo **na íntegra para carro em repasse**.
> Nenhuma AC desta fatia altera comportamento de carro com `repasse_id`.

### A. Busca — precedência e não-regressão

1. **E1** — GIVEN uma placa que **existe em `repasses`** WHEN busco THEN **nada muda**: mesma
   resolução de ciclo (AC3 da 3.1), mesmos dois modos, mesma banda, mesmo snapshot, mesmo Aplicar,
   mesmos textos. **Não-regressão total é AC, não expectativa** — a 3.1a e a 3.1c estão em produção.
   A busca em `repasses` acontece **primeiro**; o estoque só é consultado quando ela não casa
   (`precificar-queries.ts:241-243`, comportamento preservado).
2. **E2** — GIVEN uma placa que **não está em `repasses` mas está no estoque** WHEN busco THEN o
   carro carrega em **modo estoque**, com sugestão calculada (E6) — o estado vazio
   `so_no_estoque` (`precificar-queries.ts:326-334`) **deixa de existir** como caminho de saída.
3. **E3** — GIVEN a busca no estoque WHEN a query roda THEN ela usa **o snapshot mais recente**, via
   a view `veiculos_atual` (`002:65-67`, recriada em `014:26-52`, `security_invoker = true`), que já
   filtra `snapshot_id = (SELECT max(id) FROM estoque_snapshots)`.
   ⚠️ **`veiculos` tem ~55.695 linhas porque guarda histórico por `snapshot_id`.** Consultar a tabela
   base sem esse filtro traria carro que já saiu do estoque e o mesmo carro várias vezes. **A view é
   obrigatória; `veiculos` cru é proibido nesta fatia.**
4. **E4** — GIVEN a busca no estoque WHEN a query roda THEN o filtro de placa é aplicado **no
   servidor**, nunca trazendo a tabela e filtrando em JavaScript.
   ⚠️ **Isto conserta um bug vivo.** Hoje `buscarNoEstoque` faz
   `sb.from("veiculos_atual").select("placa, modelo, chassi")` **sem filtro e sem paginação**
   (`precificar-queries.ts:313`) e casa em JS. Com **1.063 carros no snapshot atual** isso passa a
   depender do teto de linhas do PostgREST (`db-max-rows` — historicamente **1000** no Supabase):
   se o teto estiver ativo, **~63 carros ficam invisíveis, em silêncio, sem erro**. Duas saídas
   aceitáveis, escolha do `@dex-dev`: (i) RPC com a expressão normalizada, no molde já vivo em
   `025:150` — `regexp_replace(upper(placa),'[^A-Z0-9]','','g') = $1`, que usa o
   `idx_veiculos_placa_norm` (`025:59-60`); ou (ii) `selectAll` paginado
   (`src/lib/data/supabase.ts:27-46`) **mais** filtro server-side. **Fetch-all + filtro em JS é NO-GO.**
   O teto vigente precisa ser **verificado**, não presumido — e o conserto vale nos dois casos.
5. **E5** — GIVEN um termo parcial que casa com **mais de uma placa** no estoque WHEN busco THEN o
   resultado é `ambiguo` com a mesma mensagem e o mesmo comportamento da busca em repasses
   (`precificar-queries.ts:247-254`) — pedir a placa completa, nunca escolher sozinho.
   GIVEN uma placa que não está em **nenhuma** das duas THEN o estado vazio atual é mantido, palavra
   por palavra.

### B. Motor

6. **E6** — GIVEN um carro só no estoque com `custo_total > 0` WHEN o motor roda THEN
   `minimo = custo_total × REGUA_MINIMO_ESTOQUE_PCT` e
   `compre_por = minimo ÷ RAZAO_MINIMO_SOBRE_COMPRE_POR`, com `bandaMinimo` preenchida a partir de
   `BANDA_ESTOQUE_P25`/`BANDA_ESTOQUE_P75`. E, como **contrato de tipo**:
   - a entrada é um tipo próprio (`EntradaSugestaoEstoque`) que **não tem campo** para
     `valorCompraRepasse` nem para `valorAquisicao` — as duas bases erradas são **inexprimíveis**;
   - o retorno é `SugestaoPrecoEstoque`, com `origem: "estoque"` e **sem o campo `modo`**;
   - portanto `montarSnapshotPrecificacao`, que exige `SugestaoPrecoRepasse.modo` (C19 da 3.1c),
     **não aceita** este retorno. "Gravar snapshot de carro de estoque" não compila (E14).
7. **E7** — GIVEN a sugestão de estoque WHEN olho a tela THEN o custo aparece **decomposto e somando
   exatamente `custo_total`**: `valor_aquisicao` (rotulado "Aquisição — nota de fábrica") +
   `custo_total − valor_aquisicao` (rotulado "Despesas acumuladas"). As duas parcelas vêm da
   **mesma linha do mesmo snapshot** — nunca de `custos_estoque_detalhado` (fonte separada, importada
   por PDF, que pode estar velha ou ausente e divergiria da base do preço). Filosofia idêntica à do
   `rep_prec_custo_decomposto_chk`: **a decomposição fecha com o total, sem tolerância.**
8. **E8** — GIVEN `custo_total − valor_aquisicao < 0` (os **ganhos indiretos** — bônus de fábrica e
   valorização — reduzem o custo; ver `002:135`) WHEN a decomposição é exibida THEN o valor negativo
   é rotulado como redução de custo em pt-BR, **nunca** exibido como "despesas" negativas.
   GIVEN `valor_aquisicao` nulo THEN só o total é exibido, sem decomposição inventada.
9. **E9** — GIVEN um carro só no estoque WHEN a `confianca` é atribuída THEN ela é **`muito_baixa`**,
   porque `valor_auto_avaliar` e `valor_fipe` vivem em `repasses` e **não existem** para este carro —
   e o alerta em pt-BR diz que **não há referência de mercado pra conferir a sugestão**, no texto da
   AC15 da 3.1.
   ⚠️ **`confianca` continua significando exclusivamente "qualidade da referência de mercado"**
   (C9 da 3.1c). Ela **não** é um juízo sobre a régua. Como o badge é o elemento mais visível da tela
   e vai aparecer em ~1.063 carros, o **motivo visível ao lado dele** (padrão da 3.1a: motivo como
   texto, nunca tooltip) é obrigatório aqui — sem ele, "confiança muito baixa" será lido como "o
   preço é ruim". **Ver D-E2** — puxar a FIPE de `fipe_batch` por chassi está OUT nesta fatia.
10. **E10** — GIVEN `custo_total` nulo, zero ou negativo WHEN busco THEN **nenhuma sugestão é
    produzida**, o estado é `neutro` ("Dados incompletos"), a UI explica que **falta o custo total do
    NBS naquele carro** — e **em nenhuma hipótese** há fallback pra `valor_aquisicao`, `preco_venda`
    ou qualquer outro campo. Mesma disciplina da AC6 da 3.1.
11. **E11** — GIVEN um carro do estoque **reservado ou em situação que impede repasse**
    (`descricao_situacao`, avaliada por `estaReservado` — `@/lib/inventory/reservado`) WHEN busco
    THEN a sugestão **é calculada normalmente** (é consulta, não ação) e a situação aparece **em
    destaque** junto da identidade do carro. Não bloquear: o Marcos pediu todos os carros.

### C. Tela

12. **E12** — GIVEN a sugestão de estoque na tela WHEN olho THEN está declarado, em pt-BR e sem
    tooltip:
    - **qual base está sendo usada** — "sobre o custo total do estoque (NBS), que já inclui as
      despesas lançadas", com o valor em dinheiro;
    - **que o mínimo abaixo do custo total é esperado** — e o contraste que fecha a leitura:
      o mínimo pede **96,2%** do custo total, o compre-por pede **101,1%**. Ambos os percentuais
      formatados a partir das constantes, **zero literal** (mesmo precedente da §2.2 do
      `ux-3.1c-dois-precos.md`);
    - **a amostra e a perda de precisão** — n=57, e a banda 91,8%–101,4% rotulada como
      *"banda do mínimo entre os carros que venderam"*, **nunca** como a faixa entre os dois preços
      sugeridos (mesma armadilha da AC11 da 3.1).
13. **E13** — GIVEN um carro só no estoque WHEN a tela monta THEN aparecem, além dos preços: **loja**
    (`cod_empresa` resolvido pelo nome em `lojas`), **pátio**, **dias de pátio**, **km**, **data de
    entrada**, **situação**, **aquisição** e o **custo total decomposto** (E7).
    **NÃO existe campo pra digitar custo, gasto ou compra** — o Marcos foi explícito que quer usar o
    que já está salvo. O bloco "Lançar gasto" (AC9 da 3.1) **não aparece**: ele escreve em
    `repasse_gastos`, que exige `repasse_id`.
14. **E14** — GIVEN um carro só no estoque WHEN olho a tela THEN **não existe botão "Aplicar"**, e a
    ausência é explicada em pt-BR: não há `repasses.valor_minimo`/`valor_compre_por` onde gravar
    enquanto o carro não for pra repasse. A tela é **consulta**. Consequências, todas declaradas:
    - **nenhuma linha em `repasse_precificacao_sugerida`** é criada — coerente com a C13 da 3.1c
      (*"o evento é a decisão, não a consulta"*): sem Aplicar, não há decisão a capturar;
    - **nenhum `UPDATE`** em lugar nenhum. Esta fatia é **read-only no banco**;
    - o caminho pra transformar consulta em decisão continua sendo marcar o carro pra repasse pelo
      `/repasses` (fluxo existente, `MarcarRepasseModal`) — e a tela **aponta** esse caminho em
      texto. **Ver D-E1**: colocar o botão de marcar aqui dentro está OUT, e por um motivo concreto
      (Risk #5).
15. **E15** — GIVEN a tela de um carro do estoque WHEN comparo com a de um carro em repasse THEN
    **não há seletor de modo** (os dois cards "recuperar tudo / girar rápido" não aparecem) e a
    ausência é **nomeada**, no mesmo espírito do estado colapsado da C3 (`ux-3.1c-dois-precos.md`
    §2.2): fora do repasse **existe um preço só**, porque a base já inclui as despesas — a base do
    "girar rápido" é o que foi **pago** no carro, e isso não existe aqui.
    ⚠️ **A tentação a barrar:** o único candidato a base de "girar rápido" fora do repasse é
    `valor_aquisicao`, que é a coluna que a REGRA DE OURO proíbe. Um segundo modo sobre ela seria a
    violação de verdade — não esta story.
16. **E16** — GIVEN o deep-link `/precificar?placa=XXX0000` WHEN o carro só existe no estoque THEN
    ele carrega em modo estoque normalmente (AC30 da 3.1 preservada). GIVEN uma nova busca THEN o
    estado da tela é zerado do mesmo jeito nos dois modos (repasse e estoque), sem vazar dado de um
    carro pro outro.

### D. Não-regressão fora da aba

17. **E17** — GIVEN esta fatia WHEN o diff é revisado THEN **não há alteração** em
    `margem-repasse.ts`, em `sugerir-preco-repasse.ts` **no que diz respeito ao comportamento dos dois
    modos existentes**, em `snapshot-precificacao.ts`, em `origem-abaixo-do-custo.ts`, nas migrations,
    no `/repasses`, no `/repasses/anuncio` (painel de prejuízo latente da C16), nos KPIs, no Bônus,
    no XLSX ou em `@/lib/pricing/suggest.ts`.
    A adição permitida em `sugerir-preco-repasse.ts` é **aditiva**: o novo tipo de entrada, o novo
    tipo de retorno, a nova função e as novas constantes. **Nenhum corpo de função existente muda.**
    *(O motor de estoque mora nesse arquivo de propósito: o preço que ele calcula **é** preço de
    repasse — só a base do custo é outra.)*
18. **E18** — GIVEN as constantes novas WHEN o diff é revisado THEN elas entram num **objeto próprio**
    (`REGUA_ESTOQUE_PADRAO`), **fora** de `REGUA_PADRAO`.
    ⚠️ **Isto é o que preserva o gate da 3.1c.** O DoD da 3.1c manda `grep` no diff por constante
    nova em `REGUA_PADRAO`, e o teste da identidade
    `minimo_recuperar − minimo_girar = REGUA_MINIMO_PCT × Σ gastos` (C18) é a trava contra a
    reintrodução de uma segunda constante nos modos de repasse. **As duas continuam valendo, sem
    afrouxamento**: a régua de estoque é um terceiro objeto, inalcançável a partir do caminho de
    repasse.

### E. Qualidade

19. **E19** — GIVEN a suíte WHEN rodo `node --import tsx --test tests/*.test.ts` THEN
    `tests/precificar-repasse.test.ts` (ou um arquivo irmão) cobre, sobre **funções puras**:
    - **não-regressão**: todos os casos da 3.1a e da 3.1c passam **sem uma linha de edição**;
    - **o teste que torna a decisão do Marcos uma regressão detectável**: carro de estoque com
      `custo_total` conhecido ⇒ **`minimo < custo_total` afirmado como resultado ESPERADO**, e
      **`compre_por > custo_total`** — com **comentário obrigatório** apontando pra esta story e pra
      seção "Por que isto NÃO viola a REGRA DE OURO". *(Espelha o teste do PRD2189 da C18.)*
      ⚠️ **Consertos errados previsíveis**, cada um mais barato de escrever que o certo:
      ❌ pôr piso em `custo_total` "porque preço abaixo do custo é bug";
      ❌ trocar a base pra `valor_aquisicao` "porque é o custo de compra";
      ❌ afrouxar a asserção pra `≥ custo_total × 0,9`.
    - **`compre_por ≥ minimo`** (I2) via override de parâmetros, no seam da AC10 da 3.1;
    - **`custo_total` nulo / 0 / negativo ⇒ sem sugestão** (E10), os três ramos;
    - **a banda vem preenchida** com os p25/p75 de estoque (contraste explícito com
      `bandaMinimo === null` do modo girar — C7);
    - **`RAZAO_MINIMO_SOBRE_COMPRE_POR` é a MESMA constante** dos modos de repasse — o teste falha se
      alguém duplicar o valor num literal;
    - **nenhuma constante nova em `REGUA_PADRAO`** (E18) e a identidade da diferença da C18 **verde,
      sem edição**;
    - **inexprimibilidade**: um teste de tipo (ou um comentário + a ausência de sobrecarga) que
      documente que `montarSnapshotPrecificacao` não aceita `SugestaoPrecoEstoque` (E6/E14).
    Zero `any`, imports `@/`, suíte inteira verde.
20. **E20** — GIVEN `AJUSTES_APLICAM_NA_REGUA_ESTOQUE = false` WHEN alguém quiser virar a chave THEN
    o **critério da medição está escrito no código, antes de medir** — no mesmo padrão da C11/D2 da
    3.1c: reproduzir a tabela do Risk #14 da 3.1 com denominador `custo_total`, quebrada por
    `dias_patio` (⚠️ **o corte de 30 dias é do relógio do repasse e não se transporta** — o corte
    do estoque precisa sair da própria distribuição de `dias_patio`). **Se a diferença entre os
    grupos não for material, o ajuste não entra.** Chave liga/desliga, **jamais** uma segunda fórmula
    (restrição da ADR-003 §12.10, que continua valendo).

---

## Scope

**IN**

- Busca no estoque via `veiculos_atual`, **filtrada no servidor**, com precedência para `repasses`
  (E1–E5). Inclui o conserto do fetch-all de `buscarNoEstoque` (E4).
- Novo tipo de resultado de busca: `ResultadoBuscaPlaca` ganha uma **terceira forma de sucesso**
  (`{ encontrado: true, origem: "estoque", carroEstoque }`). ⚠️ **`CarroPrecificar` NÃO é alterado**
  — mexer nele obrigaria a revisar todo caminho de repasse que compila hoje. Forma nova, tipo velho
  intacto.
- Régua de estoque no motor: `REGUA_ESTOQUE_PADRAO`, `EntradaSugestaoEstoque`,
  `SugestaoPrecoEstoque`, `sugerirPrecoRepasseDeEstoque(...)` — aditivos, em
  `src/lib/pricing/sugerir-preco-repasse.ts`.
- Resolução do nome da loja por `cod_empresa` (tabela `lojas`, `002:236-242`).
- Branch de UI em `PrecificarAba.tsx` para o modo estoque: identidade + custo decomposto + um par de
  preços + banda + declaração de base e amostra (E12, E13, E15).
- Testes puros da régua de estoque + não-regressão das duas fatias anteriores.

**OUT** (explicitamente fora)

- **Preço de showroom / varejo, e os dois preços lado a lado.** Descartado pelo Marcos em
  2026-08-13. A aba responde **só** preço de repasse.
- **Snapshot de precificação para carro fora do repasse** e, com ele, **o botão "Aplicar"** (E14).
  Ver a análise em Dependências — exigiria migration nova.
- **Marcar pra repasse a partir da `/precificar`** — ver **D-E1** e Risk #5.
- **Lançar gasto** para carro de estoque (não existe tabela; a base já contém as despesas).
- **FIPE de `fipe_batch` como referência de alerta** para carro de estoque — ver **D-E2**.
- **`custos_estoque_detalhado` como fonte da decomposição** (E7) ou de qualquer número.
- **Preencher a régua de estoque num carro que JÁ está em repasse mas está sem
  `valor_compra_repasse`** (hoje cai no estado neutro da AC6 da 3.1). É tentador e é coerente — e é
  **mudança de comportamento em carro de repasse**, que esta fatia não faz. Registrado em D-E1 como
  pergunta ao Marcos.
- **Recalibrar `REGUA_MINIMO_PCT`, a razão 0,952 ou as bandas da 3.1** — gatilho T2, n > ~40.
- **Escolher a base automaticamente** ("carro de estoque parado abre em régua X").
- Sugestão em lote, integração com API do Auto Avaliar, metade 2 da 3.1 (avaliar oferta — é a 3.1b).

---

## Dependências

| Estado | O quê | Quem |
|---|---|---|
| 🟢 **Pronta** | 3.1a e 3.1c implementadas e em produção; migrations 030/032/035 aplicadas | — |
| 🟢 **Pronta** | View `veiculos_atual` (`014:26-52`), índice `idx_veiculos_placa_norm` (`025:59-60`), helper `selectAll` paginado, tabela `lojas` | — |
| 🟡 **Bloqueante — validação** | Story nova, terceira base de custo, constante nova. Precisa de GO antes do dev | `@pax-po` |
| 🟠 **Bloqueante SE o escopo mudar** | **Migration 036**, necessária **apenas** se o Marcos quiser "Aplicar" em carro de estoque (D-E1). Ver a análise abaixo — são **quatro** constraints no caminho, não uma | `@dara-data-engineer` |
| 🟡 **Não bloqueia o desenho; bloqueia o estado vazio** | **Cobertura de `custo_total`** no snapshot atual: quantos dos 1.063 carros têm `custo_total NOT NULL AND > 0`, quebrado por loja. Se a cobertura for baixa, E10 deixa de ser edge case e vira o caminho principal em algumas lojas — e o estado vazio precisa de desenho próprio | `@alex-analyst` → `@uma-ux` |
| 🟡 **Não bloqueia** | Verificar o `db-max-rows` vigente do projeto (E4). O conserto vale independente da resposta, mas a resposta diz se **hoje já há carro invisível** na busca | `@gage-devops` |
| 🟠 **Bloqueia a UI** | Hierarquia da tela de estoque: onde vai a banda larga, como o badge `muito_baixa` não é lido como "preço ruim" (E9), e como a ausência do seletor de modo é nomeada (E15). Molde pronto: §2.2 do `ux-3.1c-dois-precos.md` | `@uma-ux` |

### Por que o snapshot está OUT — a análise, para não ser reaberta por parecer barato

Gravar uma linha em `repasse_precificacao_sugerida` para um carro sem `repasse_id` **é impossível
hoje**, e não por um detalhe:

1. **`rep_prec_orfao_tem_desfecho_chk`** (035:327-328) —
   `CHECK (repasse_id IS NOT NULL OR desfecho_congelado_em IS NOT NULL)`. Uma linha de carro de
   estoque tem os dois `NULL`. **Um carro fora do repasse não é órfão** — órfão é linha cujo repasse
   foi apagado. É outra coisa, e o CHECK não tem como distinguir.
2. **`valor_compra_repasse NUMERIC NOT NULL`** (030) — não existe para o carro.
3. **`rep_prec_custo_decomposto_chk`** — exige `custo_real = valor_compra_repasse + gastos_total`,
   **sem tolerância**. A decomposição do estoque é outra (`custo_total = aquisição + despesas`).
4. **`rep_prec_modo_chk`** aceita **exatamente dois** valores, e a 3.1c registrou por escrito que um
   terceiro valor **não** é seguro barato (§C12, T6): mudaria a base do preço e convidaria a gravar
   linhas de um modo que o motor não implementa.

Uma migration 036 que acomodasse isso mudaria a semântica da tabela — que hoje é **"decisão de preço
de um ciclo de repasse"** — para "decisão de preço de um carro qualquer". É decisão de arquitetura
(`@aria-architect` + emenda de ADR) e de schema (`@dara-data-engineer`), **não** um efeito colateral
de uma fatia de busca. **Enquanto não houver "Aplicar", não há decisão a capturar** e a C13 da 3.1c
já responde: consulta não grava.

**Acoplamento a declarar:** no instante em que "Aplicar" entrar para carro de estoque, o snapshot
passa a ser **obrigatório** (o dado de recalibração é irrecuperável — ADR-003 §2.3) e a 036 vira
bloqueante. As duas coisas andam juntas ou nenhuma anda.

**Código a reaproveitar, não reescrever:** `reguaComprePorPct`, `arredondarCentavos`,
`arredondarParaCentena`, `arredondarRespeitandoPiso`, `RAZAO_MINIMO_SOBRE_COMPRE_POR`, `PrecoCard`,
`BlocoCusto`, `CabecalhoCarro`, `Aviso` (com o `tom="neutro"` criado na 3.1c), `normalizarPlaca` /
`placaCasa`, `formatBRL`, `selectAll`, `estaReservado`.

---

## Risk / Edge cases

### Riscos

1. **O `@quinn-qa` reprovar corretamente por causa da REGRA DE OURO.** É o risco mais provável desta
   fatia — a regra está em caixa alta no topo do módulo mais canônico do projeto. **Mitigação:** a
   seção dedicada acima, os quatro argumentos, e o `EntradaSugestaoEstoque` sem campo pra
   `valor_aquisicao` (E6). **Gate explícito pro Quinn:** a pergunta certa não é "está usando um custo
   maior?" — é *"a constante foi medida sobre a base que está sendo usada?"*. Aqui foi, com n=57.
2. **A régua de 96,2% ser lida como "o sistema sugere prejuízo".** 1.063 carros × mínimo abaixo do
   custo total. **Mitigação:** E12 (o compre-por a 101,1% é o contraste que desarma) e a banda visível.
   ⚠️ Se a leitura pegar mesmo assim, o conserto **não** é mexer na constante — é texto.
3. **Perda de precisão real, não só declarada.** IQR de 9,6 pontos: em um carro de R$ 100.000 de
   custo total, a banda vai de R$ 91.800 a R$ 101.400 — quase **R$ 10.000** de largura. A régua de
   repasse tem metade disso. **É o preço que se paga por não ter a reavaliação do Marcos.**
   **Mitigação:** a banda é exibida (nunca suprimida) e o par é o ponto de partida da conversa, não a
   resposta fechada. **Não mitigável por código.**
4. **Duas réguas no mesmo módulo, e alguém "harmoniza".** `1,066` e `0,962` no mesmo arquivo pedem
   pra virar uma constante derivada da outra. **Mitigação:** o comentário de cada constante registra a
   **âncora separada** (padrão da AC10 da 3.1) e diz que `1,066 ÷ 1,1079 ≈ 0,962` é **corroboração,
   não derivação**; e E18 mantém os dois objetos separados.
5. **"Marcar pra repasse" a partir daqui apagaria o preço que acabou de aparecer.**
   `snapshotFromVeiculo` (`queries.ts:625-644`) **não preenche `valor_compra_repasse`** — de
   propósito, porque esse número é a reavaliação do Marcos. Logo, um carro recém-marcado cai na
   **AC6 da 3.1** (estado neutro, sem sugestão). Um botão "marcar pra repasse" na tela de estoque
   levaria, com um clique, de *"seu mínimo é R$ 96.200"* para *"dados incompletos"*. **É por isso
   que o botão está OUT** (E14), e é por isso que D-E1 é pergunta de produto e não de implementação.
6. **A régua de estoque virar a régua de todo mundo pela porta dos fundos.** Um carro em repasse sem
   `valor_compra_repasse` "poderia" usar a base de estoque. Coerente, tentador — e é **mudança de
   comportamento em carro de repasse**, que E1 e E17 proíbem nesta fatia. Registrado em D-E1.
7. **Snapshot de estoque parcial ou velho.** `veiculos_atual` segue `max(estoque_snapshots.id)`: se
   um upload estiver pela metade, a view já aponta pra ele. **Mitigação:** exibir a **data do
   snapshot** (`estoque_snapshots.data_geracao`) junto do custo, no mesmo espírito do Risk #7 da 3.1
   ("Ref. AA desatualizada — exibir a data").

### Edge cases

1. **Placa no estoque **e** em repasse.** Repasse ganha, sempre (E1). O modo estoque é o **fallback**,
   nunca uma alternativa oferecida.
2. **Todos os ciclos de repasse `cancelado`.** Comportamento atual preservado (abre o mais recente em
   modo consulta) — **não** cai pro estoque. Mudar isso é regressão silenciosa da AC3/AC4 da 3.1.
3. **Duas linhas com a mesma placa no snapshot atual** (chassis diferentes, erro de cadastro): trata
   como `ambiguo` (E5), nunca escolhe.
4. **Carro vendido/faturado ainda presente no snapshot** (`descricao_situacao`): precifica, mas a
   situação aparece em destaque (E11). O snapshot de estoque é uma foto; ela envelhece.
5. **`custo_total` presente mas absurdo** (R$ 1,00, ou 10× o `preco_venda`): a régua devolve um
   número absurdo com a mesma cara de um número bom. **Não há guarda de plausibilidade nesta fatia** —
   registrado como limitação conhecida. `fipe_batch.plausibilidade_verificada` (`021:31-47`) é
   precedente de como se faria, e depende da D-E2.
6. **`valor_aquisicao > custo_total`** (ganhos indiretos altos): a "despesa" fica negativa. E8.
7. **Carro sem placa legível** (`placa = ""`): não é alcançável pela busca por placa. Fora de escopo,
   como já é hoje.
8. **Ler o mínimo do estoque e o mínimo do "girar rápido" como a mesma coisa.** Não são: girar é
   `1,066 × o que ele pagou`; estoque é `0,962 × o custo cheio do NBS`. Coincidem em espírito
   ("abrir mão de parte da preparação") e **divergem em número** — nenhum texto pode sugerir que um
   é o outro.

---

## Complexity (T-shirt)

**M** — menor que a 3.1c (L−), e o motivo é estrutural: **sem migration, sem escrita no banco, sem
alteração de comportamento existente**. O trabalho está em (1) a busca server-side no estoque, que
conserta um bug vivo de teto de linhas; (2) uma régua nova, curta, com quatro constantes e nenhum
ajuste; (3) uma terceira forma de resultado de busca sem tocar no tipo antigo; e (4) uma branch de UI
que precisa ser honesta sobre uma banda larga.

**O que faz essa fatia parecer maior do que é:** a régua nova mora ao lado da REGRA DE OURO, e metade
do custo é **justificar por escrito** que ela não a viola. Esse custo já foi pago aqui.

### Sequenciamento — obrigatório, nesta ordem

1. **Busca no estoque + a terceira forma de `ResultadoBuscaPlaca`** (E1–E5). Primeiro porque conserta
   o fetch-all e porque é a peça que se prova sozinha, com placa real, antes de haver preço.
2. **Régua + testes** (E6–E10, E18, E19). O teste que **exige** `minimo < custo_total` entra aqui,
   não depois.
3. **UI de estoque** (E11–E16), com a `@uma-ux` já respondida.

**A linha de corte limpa é a decomposição do custo (E7/E8)** — dá pra entregar mostrando só o
`custo_total` cheio. **Com o preço declarado:** sem a decomposição, o Marcos vê a base mas não vê que
as despesas que ele atualiza todo dia estão dentro dela, que é literalmente o motivo pelo qual ele
pediu a feature. Corta **dentro do mesmo sprint**, não pra depois.

**O que não dá pra cortar:** E4 (a busca parcial é bug, não performance), E10 (sugerir sobre custo
ausente é número inventado) e o teste da E19 que fixa `minimo < custo_total` (sem ele, o primeiro
"conserto" bem-intencionado reverte a decisão do Marcos em silêncio).

---

## Definition of Done

- [ ] Código + testes verdes (`node --import tsx --test tests/*.test.ts`, **suíte inteira**)
- [ ] Typecheck (`tsc`) + lint clean, zero `any`, imports `@/`
- [ ] **Não-regressão da 3.1a e da 3.1c comprovada** — nenhum teste das duas fatias editado, e o
      teste da identidade `minimo_recuperar − minimo_girar = REGUA_MINIMO_PCT × Σ gastos` (C18)
      **verde sem edição**
- [ ] **`grep` no diff: nenhuma constante nova em `REGUA_PADRAO`** (E18); as constantes de estoque
      vivem em `REGUA_ESTOQUE_PADRAO`
- [ ] **O teste que exige `minimo < custo_total` e `compre_por > custo_total` existe**, com o
      comentário obrigatório apontando pra esta story (E19)
- [ ] **`valor_aquisicao` não aparece em nenhum caminho de cálculo** — grep no diff: ele só ocorre em
      código de **exibição** (E7). `EntradaSugestaoEstoque` não tem campo pra ele
- [ ] **Zero escrita no banco nesta fatia** — grep no diff por `insert`/`update`/`upsert` nos arquivos
      tocados devolve **nada** (E14)
- [ ] **Nenhuma migration**, nenhuma alteração em `margem-repasse.ts`, `snapshot-precificacao.ts`,
      `origem-abaixo-do-custo.ts`, `/repasses`, `/repasses/anuncio`, KPIs, Bônus, XLSX (E17)
- [ ] **Busca server-side comprovada**: a query traz **uma linha**, não a tabela. Testado com uma
      placa que esteja **fora das primeiras 1000 linhas** de `veiculos_atual` na ordem natural — é o
      único jeito de provar que E4 foi resolvida de verdade
- [ ] Testado no ambiente local com pelo menos **5 placas reais**: uma em repasse (não-regressão
      total, dois modos intactos), uma só no estoque com custo completo, uma só no estoque **sem
      `custo_total`** (estado neutro), uma de **outra loja** (nome da loja resolvido), e uma
      **reservada** (situação em destaque, sugestão calculada)
- [ ] **Precedência verificada:** placa presente nas duas tabelas abre em **modo repasse**, com o
      ciclo correto (AC3 da 3.1)
- [ ] **A tela declara, em texto visível (nunca tooltip):** a base usada e seu valor, os dois
      percentuais formatados **a partir das constantes**, a amostra n=57 e a banda 91,8%–101,4%
      rotulada como banda **do mínimo entre carros que venderam** (E12)
- [ ] **A tela nomeia a ausência do seletor de modo** (E15) e a ausência do "Aplicar" (E14) — nenhuma
      das duas aparece como controle desabilitado sem explicação
- [ ] **Data do snapshot de estoque visível** junto do custo (Risk #7)
- [ ] **Cobertura de `custo_total` medida** e registrada na story antes do merge — se for alta, é nota
      de rodapé; se for baixa, E10 volta pra `@uma-ux` antes de ir pro ar
- [ ] `db-max-rows` vigente verificado e registrado (E4) — a resposta diz se já havia carro invisível
      em produção antes desta fatia
- [ ] **D-E1 e D-E2 respondidas pelo Marcos** (ou registradas como adiadas com o custo declarado)
- [ ] `AJUSTES_APLICAM_NA_REGUA_ESTOQUE = false` no código, com o **critério da medição escrito
      antes** e o aviso de que o corte de 30 dias não se transporta do relógio do repasse (E20)

---

## Decisões que são do Marcos, não minhas

> Levar as duas junto com a story. Nenhuma bloqueia o começo do trabalho — E14/E15 já entregam o
> comportamento conservador em ambas.

**D-E1 — o que fazer com o carro depois que ele viu o preço.** Hoje a resposta é "vá em `/repasses`
e marque". Três caminhos, com custo real diferente:
- **(a) Nada — consulta pura.** É o que a story propõe. Custo: nenhum. Limitação: nenhuma consulta
  deixa rastro de calibração.
- **(b) Botão "marcar pra repasse" na própria tela.** Custo: ⚠️ **o preço some no clique** — o carro
  recém-marcado não tem `valor_compra_repasse` e cai no estado neutro da AC6 (Risk #5). Só faz sentido
  junto de um campo pra ele digitar a compra ali mesmo, o que é outra fatia.
- **(c) "Aplicar" de verdade em carro de estoque.** Custo: **migration 036** + emenda de ADR (quatro
  constraints, semântica da tabela 030 muda). É a única que preserva o dado de calibração, e é a mais
  cara das três.

  *Pergunta derivada, mesma família:* **um carro que JÁ está em repasse mas está sem
  `valor_compra_repasse`** hoje não recebe preço nenhum (AC6). A régua de estoque conseguiria
  precificá-lo. Quer isso? É mudança de comportamento em carro de repasse, e por isso está OUT aqui.

**D-E2 — a referência de mercado do carro de estoque.** A story propõe `confianca = "muito_baixa"`
com o motivo visível ("não há referência pra conferir") — honesto e barato, e **sem nenhum efeito no
preço** (a invariante das AC13–AC15 vale nos três caminhos). A alternativa é puxar a FIPE de
`fipe_batch` por chassi (existe, com `score` e `plausibilidade_verificada` — `021`), o que subiria a
confiança pra `baixa` e habilitaria o alerta de teto. Custo: uma fonte de dados nova na aba e um
gate de qualidade a respeitar. **Pergunta pro Marcos:** um badge "confiança muito baixa" em ~1.063
carros incomoda a ponto de valer esse trabalho, ou o motivo escrito ao lado resolve?
