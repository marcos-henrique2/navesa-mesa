# Story 3.1c — Dois preços lado a lado em `/precificar`: "recuperar tudo" × "girar rápido"

> Épico 3 — **Precificação assistida de repasse**. Terceira fatia da story 3.1
> (`docs/stories/story-3.1-aba-precificar.md`, v4). Depende da **3.1a implementada e revisada**.
> Não substitui a 3.1 — **estende** o motor com uma segunda **base**.
>
> **v4 (12/ago/2026)** — 8 findings do `@pax-po` (**GO 8/10**, F11 bloqueava). **F11:** a C19 vira
> contrato de **tipo** — "girar com modo recuperar" deixa de ser estado representável. **F4:** o
> alerta de `bateuPiso` (`577-578`) é um **sexto sítio**, e a C5 passa a nomear a AC12 da 3.1 que
> revoga e os sítios que ficam de fora das duas listas. **F5:** a supressão da banda vira do
> **motor** (`bandaMinimo: null`), pra ser testável. **F6:** sufixo de `versao_regua` **nos dois
> modos**. **F7:** as 2 constraints novas e os **7 CHECKs** declarados. **F8:** query **de lista**
> autorizada no IN. **F10:** proibição do round-trip exato movida pra dentro da C18. **F2:**
> desempate dos R$ 20 escrito na C10. Somado: **sequenciamento obrigatório** e linha de corte.
> **Não volta pro Pax** — o `@quinn-qa` pega o resto no gate.
>
> **v3 (12/ago/2026)** — fecha com a **§12 revisada** (`@aria-architect`, commit `5e8bbcf`) e a
> **migration 032 entregue** (`@dara-data-engineer`). Correções: **C6 estava errada** — compra 0
> com gastos é legítima no modo recuperar e só o girar recusa; a §12.4 **encolheu para 5 sítios**
> (o clamp em espaço de razão saiu da lista); a **C3 piora, não melhora** (os modos ficam
> idênticos, não próximos) e passa pra `@uma-ux`; entram a **C19** (o `modo` gravado tem que ser o
> que produziu os números) e a identidade da diferença como asserção de teste.
>
> **v2 (12/ago/2026)** — reescrita após **D1 e D3 decididas pelo Marcos** e a **emenda §12 da
> ADR-003** (commit `22a2d0d`). Mudanças estruturais em relação à v1:
> **D3 elimina a constante nova** (`REGUA_GIRAR_PCT` deixa de existir — régua única, bases
> diferentes); a story **passa a ter migration** (032, coluna `modo`); **leitura pontual da 030
> entra no IN**; os "três clamps" viraram **cinco sítios + três que não podem trocar + uma guarda
> que falta**; os limiares de gasto foram recalculados sob a régua única. T-shirt sobe pra **L−**.
>
> **v1 (12/ago/2026)** — River. Escrita a partir do uso da 3.1a com o PRD2189. Levantou D1 e o
> argumento algébrico do piso, que decidiu D1.
>
> **Convenção de numeração:** ACs desta fatia são **C1…C18**, pra não colidirem com as AC1–AC31
> da 3.1. Referências cruzadas aparecem como "AC*nn* da 3.1".
>
> **Estado:** 🟢 GO 8/10 do `@pax-po`. **Nenhuma decisão em aberto** — D1, D3 e **D2**
> (2026-08-12, com medição) estão fechadas.

---

## Decisões — estado

| # | Decisão | Estado |
|---|---|---|
| **D1** | Piso do modo girar | ✅ **DECIDIDA — `valor_compra_repasse`** (Marcos, 2026-08-12) |
| **D3** | Uma constante ou duas | ✅ **DECIDIDA — régua ÚNICA `REGUA_MINIMO_PCT = 1.066` nas duas bases** (Marcos, 2026-08-12) |
| **D2** | Ajuste de dias parados no modo girar | ✅ **RESPONDIDA COM DADO — o ajuste APLICA** (medição do `@alex-analyst`, 2026-08-12, n=62). Não é adiamento |

### ✅ D2 — o ajuste de dias parados APLICA no modo girar

Medição do `@alex-analyst` (2026-08-12, **n=62**), com o **critério declarado antes de rodar**,
conforme a medição (ii) do Risco #3: reproduzir a tabela do Risk #14 da 3.1 trocando o denominador
de **custo** pra **compra**. Se os pontos **encolhessem** materialmente, "pedir sobre a compra" já
seria o desconto de carro parado e aplicar o ajuste por cima seria **double-count**.

| Grupo | n | mínimo ÷ custo | mínimo ÷ compra |
|---|---|---|---|
| ≤ 30 dias | 41 | 1,0785 | 1,0816 |
| **> 30 dias** | 21 | 1,0513 | 1,0513 |
| **Diferença** | | **2,72 pt** | **3,03 pt** |

**A diferença não encolheu — cresceu de leve.** Logo **não há double-count**: "parado" e "base da
compra" são sinais **independentes**, e o ajuste sobrevive nos dois modos.
`AJUSTES_APLICAM_NO_MODO_GIRAR = true`.

A chave **permanece no código** de propósito. Se a medição virar com n maior, o conserto é **flipar
a chave** — nunca escrever uma segunda fórmula: a ADR-003 §12.10 impõe que o ajuste opere em
**espaço de razão** e seja base-agnóstico por construção.

### ✅ D1 — piso = `valor_compra_repasse`

O Marcos escolheu ciente de que o preço fica **abaixo do custo total**. O argumento que decidiu foi
algébrico: sob piso no `custo_real`, todo carro com gastos acima de ~7% da compra devolveria
exatamente o custo (margem 0,0%) **qualquer que fosse a constante** — o modo viraria uma constante
justamente nos carros que existe pra atender, e os gastos seriam sempre integralmente recuperados
*por construção*, que é o oposto do comportamento descrito. Coerente com o medido: **PRD1J39**
vendeu a R$ 90.000 com custo R$ 92.000 (−2,2%); **RWI9B84** teve mínimo R$ 222.500 com custo
R$ 223.000.

**Piso na compra não é ausência de piso** (ADR-003 §12.0). O motor continua com piso e continua
proibido de sugerir abaixo dele; mudou **de que número** ele é piso. Essa distinção é a C4 inteira.

### ✅ D3 — régua única, bases diferentes

A v1 propunha duas constantes: 1,066 sobre o custo e 1,072 sobre a compra. **Era defeito da
proposta**, exposto pela análise de carro sem gasto: com `compra == custo`, 1,072 > 1,066 e a
coluna "girar rápido" mostraria o preço **mais alto** — em **12 dos 16 vendidos**. Causa: os 107,2%
vêm da mediana dos **sem gasto**, os 106,6% da mediana de **todos**; duas populações que invertem
quando as bases coincidem.

```
recuperar_tudo : 1.066 × custo_real
girar_rapido   : 1.066 × valor_compra_repasse
```

**Consequências, todas simplificadoras:**
- **`REGUA_GIRAR_PCT` não existe.** Nenhuma constante nova entra no sistema, nada novo pra recalibrar em T2.
- A relação vira **exata e monotônica**: `mínimo_girar = mínimo_recuperar − 1,066 × Σ gastos`. Iguais **se e somente se** gastos = 0; girar **sempre** menor caso contrário. Isso é afirmável em teste (C3), não é "coincidentemente próximo".
- **Aproxima do observado:** os 4 com gasto venderam a **105,6%** da compra; a régua única pede 106,6% — **1,0 ponto** de distância, contra os 1,6 ponto da proposta com 1,072.

---

## Contexto

A 3.1a entregou **uma** régua sobre `custo_real`. O Marcos usou com carro real e fez a pergunta que
ela não responde — **como calcular sem os gastos**:

> "normalmente os carros quando dão o valor não levamos em conta os gastos que o carro nos gerou
> porque precisamos vender esse carro rápido, porque está parado há muito tempo, ou só queremos
> abaixar o número de carros de estoque, se for um carro que não vai ser vendido no showroom"

**Os 16 vendidos confirmam que ele já faz isso:**

| Grupo | n | Mediana do mínimo que vendeu |
|---|---|---|
| Carros **com** gasto — sobre o **`custo_real`** | 4 | **102,0%** |
| Os **mesmos 4** — sobre o **`valor_compra_repasse`** | 4 | **105,6%** |
| Carros **sem** gasto (compra = custo) | 12 | **107,2%** |

Se o gasto entrasse no preço, os 4 com-gasto fechariam nos mesmos ~107% do custo que os 12
sem-gasto. Fecham em 102,0% — **5,2 pontos abaixo**. Medidos sobre a compra, ficam a **1,6 ponto**
do grupo sem-gasto. **O gasto sai do bolso dele, não do preço.**

**Força da evidência — registrada como fraca, de propósito.** Desvio-padrão do mínimo: 5,95 sobre a
compra × 6,15 sobre o custo (n=16) — mesma direção, margem estreita. O grupo com-gasto é **n=4**.
Suficiente pra *oferecer* o segundo cálculo; **não** pra trocar a base globalmente, e **não** pra
apresentar o modo girar com cara de rigor (Risk #1).

**Por isso o desenho é mostrar os dois, não trocar um pelo outro** — validado com o Marcos. Ele
opera dos dois jeitos: showroom que vai girar no varejo pede um preço; carro parado que só precisa
sair do pátio pede outro.

```
PRD2189 · custo real R$ 86.850 (compra 80.000 + gastos 6.850)

  RECUPERAR TUDO              GIRAR RÁPIDO
  Mínimo   R$ 92.600          Mínimo   R$ 85.300
  Compre   R$ 97.300          Compre   R$ 89.600
  +6,6% sobre o custo         −1,8% sobre o custo
                              abre mão de R$ 1.570 dos R$ 6.850 de gastos
                              (R$ 1.550 sobre o par arredondado que vai ao portal)
```

*Exatos: girar mínimo 85.280,00 · compre-por 89.579,83 · `minimo_razao_efetiva` 0,981923.*
**Nenhum destes números pode virar literal em lugar nenhum — ver C10.**

---

## User Story

Como **Marcos (gestor de repasse B2B)**, eu quero **ver, lado a lado, o preço que recupera tudo que
o carro me custou e o preço que só recupera o que paguei nele** para **decidir na hora se aquele
carro específico vale segurar por margem ou vale sacrificar os gastos pra girar — sem refazer a
conta de cabeça e sem trocar a régua de todos os carros por causa de alguns.**

---

## A régua, e o que ela faz com a razão gastos/compra

```
base(modo) =  recuperar_tudo → custo_real
              girar_rapido   → valor_compra_repasse

M = REGUA_MINIMO_PCT              = 1.066   (ÚNICA — D3)
R = RAZAO_MINIMO_SOBRE_COMPRE_POR = 0.952   (REUSADA, não duplicada)
    compre_por_pct = M / R ≈ 1.11975
PISO_PCT = 1.0, aplicado sobre base(modo)
```

**A razão mínimo÷compre-por é reusada e não recalibrada** porque mede distância *dentro do mesmo
carro* (ADR-003 §4) — independe da base. Duplicá-la criaria duas constantes que sempre andariam
juntas e que alguém recalibraria separadamente por engano.

### Os dois limiares que sobraram (`g = Σ gastos ÷ valor_compra_repasse`)

A ADR-003 §12.1 listou **três** cruzamentos com a régua de duas constantes. **Sob D3 sobram dois**, e
os dois mudaram de número:

| | Limiar | Fórmula | O que muda ao cruzar | Quem consome |
|---|---|---|---|---|
| ~~C-a~~ | — | — | **Extinto.** Girar ≤ recuperar **sempre**; iguais ⟺ `g = 0` | — |
| **C-b′** | `g > 6,6%` | `g > M − 1` | `mínimo_girar < custo_real` | alerta da **C10**, desambiguação da **C16** |
| **C-c′** | `g > 11,97%` | `g > M/R − 1` | `compre_por_girar < custo_real` ⇒ **badge 🔴 no `/repasses`** | `classificarBadge` (`margem-repasse.ts:153`) |

> ⚠️ **C-b′ NÃO se extingue — muda de número.** Os 7,2% da §12.1 original tinham **dois** papéis, e
> só um morreu: (1) o ponto em que o girar **travava** no `custo_real` e virava constante — esse
> **some**, porque sob piso na compra o motor não trava mais, e `bateu_piso` sai da lista de
> consumidores (Edge case #3); (2) o ponto em que o mínimo do girar **cai abaixo** do `custo_real`
> — esse **permanece e morde mais cedo** com a constante menor: **6,6%**.
> **Isso é load-bearing:** a **C16** existe justamente porque `valor_minimo < custo_real` vira
> rotina. Tratar C-b′ como extinto deixaria a C16 e a C10 **sem condição de disparo definida**.

**PRD2189: `g = 6.850 ÷ 80.000 = 8,56%`** ⇒ acima de C-b′, abaixo de C-c′. Mínimo abaixo do custo
(alerta da C10); compre-por acima do custo (**sem** badge 🔴).

---

## Acceptance Criteria

> As AC1–AC31 da story 3.1 continuam valendo **na íntegra**, exceto onde uma AC abaixo diz o
> contrário.

### A. Motor

1. **C1** — GIVEN o motor `sugerirPrecoRepasse` WHEN é chamado no modo `recuperar_tudo` THEN o resultado é **idêntico ao da 3.1a**: mesma base, mesmas constantes, mesmo piso, mesmos alertas, mesma banda, mesmos preços até o centavo. **Duas exceções declaradas**, e só elas: o campo novo `modo` (C19) e **`versaoRegua`, que passa a carregar o sufixo `__recuperar_tudo`** (C12). Não-regressão é AC, não expectativa — a 3.1a foi revisada e está em uso.
2. **C2** — GIVEN o motor WHEN é chamado no modo `girar_rapido` THEN o mínimo sai de `valor_compra_repasse × REGUA_MINIMO_PCT` e o compre-por de `mínimo ÷ RAZAO_MINIMO_SOBRE_COMPRE_POR` — **a mesma constante e a mesma razão do outro modo**. **Nenhuma constante nova entra em `REGUA_PADRAO`** (D3): se o diff introduzir um `REGUA_GIRAR_PCT`, a AC está violada.
3. **C3** — GIVEN um carro **sem gastos lançados** (12 dos 16 vendidos; maioria da frota) WHEN os dois modos rodam THEN os dois pares são **idênticos até o centavo, por construção** — `base(girar) == base(recuperar)` e a constante é a mesma —, e a UI **não apresenta duas colunas com o mesmo número sem dizer por quê**. Duas soluções são aceitáveis e a escolha é da `@uma-ux`: **(i) colapsar** nas duas colunas numa só enquanto `gastos = 0`, ou **(ii)** manter as duas e declarar sem rodeios que **não há segunda conta a fazer neste carro**. A AC **não prescreve pixel**; o que ela exige é que a tela nunca sugira que houve duas contas quando houve uma. O **teste afirma igualdade exata**, não proximidade (C18).
   > **Isto piorou, não melhorou, com D3.** Sob a proposta antiga os números ficavam *próximos* (R$ 480 de distância, com o girar por cima — o extinto C-a). Agora ficam **idênticos byte a byte, em 12 de 16 carros**. O conserto antigo ("diga que coincidem, e qual está por cima") deixou de existir junto com o C-a.
4. **C4** — GIVEN a invariante da ADR-003 **§12.2** (que **substitui** a formulação da §11) WHEN o motor roda THEN valem:
   - `I0` — `base(modo) > 0` como **pré-condição**: sem ela não há sugestão (ver C6);
   - `I1` — `minimo_sugerido ≥ base(modo) × PISO_PCT`;
   - `I2` — `compre_por_sugerido ≥ minimo_sugerido`, **incondicional nos dois modos**;
   - `I3` — I1 e I2 valem sobre o par **sugerido**, **nunca** sobre o aplicado *(mantido da §11)*;
   - e a garantia global que sobrevive à emenda: **`minimo_sugerido ≥ valor_compra_repasse` nos dois modos** — é o "não perco no carro".
   **`minimo_sugerido ≥ custo_real` deixa de ser invariante** (`I-morta` da §12.2): é corolário de I1 no modo recuperar e **falso por desenho** no girar sempre que `g > 6,6%`.
5. **C5** — GIVEN a troca de base no motor `src/lib/pricing/sugerir-preco-repasse.ts` WHEN o dev implementa THEN os sítios são tratados **um a um**, conforme ADR-003 §12.4 — deixar qualquer um de fora não produz erro visível, produz um par internamente coerente com a base errada:
   - **trocam pra `base(modo)` (6):** `custo.custoReal * razaoMinimo` (**base do mínimo**, `599`); `if (minimoSugerido < custo.custoReal)` (`600`); `custo.custoReal * razaoComprePor` (**base do compre-por**, `601`); `arredondarRespeitandoPiso(minimoSugerido, custo.custoReal)` (`605`); **`formatBRL(custo.custoReal)` no texto do alerta de arredondamento (`609`)**; e **o texto do alerta de `bateuPiso` (`577-578`)** — hoje diz *"O mínimo travou no **custo real**"*, que sob girar **nomeia a base errada**. É exatamente o argumento que esta AC usa pro sítio `609`, e o fato de a flag ser inalcançável com `REGUA_PADRAO` (Edge case #3) **não dispensa** — é o mesmo raciocínio com que a C12 exige corrigir o COMMENT de `bateu_piso` "pro dia em que alguém editar";
   - **NÃO trocam (3):** `minimoSugerido / custo.custoReal` (`615`) e `comprePorSugerido / custo.custoReal` (`616`) — razões efetivas, ver C12 — e a `bandaMinimo` (`697-698`), ver C7;
   - **PERMANECEM sobre `custo_real` por desenho, e não estão em nenhuma das duas listas:** a **decomposição do custo** em `decomporCusto` (`396-403`) e o **texto da justificativa** que exibe o custo decomposto (`670`). São `custo_real` porque *são* o custo real — não porque alguém esqueceu. *(Sem esta linha o dev grepa `custoReal`, acha 15 ocorrências e fica com 3 órfãs.)*
   - **O clamp `razaoMinimo < params.PISO_PCT` (`574`) saiu da lista** na §12.4 revisada: com a constante única, `razaoMinimo` parte do **mesmo número** nos dois modos. Vive em **espaço de razão** (`PISO_PCT = 1,0` já significa "100% da base", qualquer que seja a base) — **não tocar**. Convertê-lo pra dinheiro é regressão.

   > **Esta AC revoga a AC12 da 3.1** na parte em que ela manda o valor *"travar em `custo_real`"* e enuncia a pós-condição `compre_por ≥ mínimo ≥ custo_real`. No modo `recuperar_tudo` a AC12 continua valendo palavra por palavra; no `girar_rapido` ela é **substituída** por `I1`/`I2` da C4. O resto da AC12 (o piso ser guarda + teste e não bloqueio de fluxo) permanece intacto.
6. **C6** — GIVEN um carro com **`valor_compra_repasse` = 0 e gastos > 0** WHEN os modos rodam THEN:
   - **`girar_rapido` NÃO produz sugestão** (`base = 0`), com mensagem pt-BR própria;
   - **`recuperar_tudo` produz sugestão normalmente** — `base = custo_real > 0` satisfaz `I0`, e é caso **legítimo**.
   Hoje o girar **passa** e mostra **R$ 0,00**: `decomporCusto` recusa compra negativa mas **aceita zero** (`~390`), então `custo_real > 0` atravessa a guarda. A guarda de `custo.custoReal <= 0` (~555) vira **`base(modo) <= 0`** — que é condicional ao modo, **não** um `valor_compra_repasse > 0` global.
   **A guarda é do motor, não do banco.** O `rep_prec_base_do_modo_positiva_chk` da migration 032 é o **último anteparo** e segue a mesma forma condicional; ele **não substitui** a guarda. **Se esse CHECK disparar em produção, o bug é do motor** — o Marcos nunca deve chegar a ver R$ 0,00 na tela, e um clique de "Aplicar" abortando pela constraint é o sintoma, não a proteção.
   *(Bug real, não coberto por nenhuma AC da 3.1 nem pelo Risk #9 da v1 desta story, que só falava em compra "nula ou negativa".)*
7. **C7** — GIVEN o modo `girar_rapido` WHEN o motor devolve o resultado THEN **`bandaMinimo` vem `null`** — a supressão é do **motor**, não da UI, pra que a regra seja testável sobre função pura (C18) e pra que nenhuma tela futura possa exibi-la por engano. A UI simplesmente não tem o que mostrar.
   Motivo: a banda é dispersão do mínimo **sobre o custo** entre 16 carros; reaplicá-la sobre a compra é o **erro de eixo** que a ADR-003 §4 registrou no "compre-por = p75", repetido. Não existe banda calibrada sobre a compra, e inventar uma seria fabricar rigor.
   **Nota de coerência com a C5:** o sítio `697-698` continua na lista dos que **não trocam de base** — quando a banda é calculada (modo recuperar), ela é sobre `custo_real`. O que o girar faz é **não calcular**, não calcular sobre outra base. `bandaMinimo` passa a ser `{ p25, p75 } | null` no tipo de retorno.
8. **C8** — GIVEN qualquer um dos dois modos WHEN o motor calcula THEN **Ref. AA e FIPE não tocam em nenhum número** — a invariante das AC13–AC15 da 3.1 vale integralmente nos dois. A ADR-003 §12.9 **reforça** a regra: com **duas** bases, uma referência com poder numérico teria que escolher **qual** base corrigir, e não há dado que decida. **G1-b segue desarmado e a migration 031 segue não-bloqueante.** O teto continua sobre o **mínimo** e nunca sobre o compre-por; sob girar ele morde **menos**, que é a direção certa.
9. **C9** — GIVEN o modo girar WHEN a `confianca` é atribuída THEN ela continua significando **exclusivamente "qualidade da referência de mercado"** (Ref. AA → `alta`; FIPE → `baixa`; nenhuma → `muito_baixa`). **Não é rebaixada no girar**: a calibração mais fraca é propriedade **do modo, não da linha**, e já está declarada pela coluna `modo` (C12). Misturar dois eixos no único campo da tabela com significado fechado o destruiria — e o nível `media` reservado no CHECK da 030 é do **mesmo eixo** (ADR-003 §11 desvio 4), não um slot livre.
10. **C10** — GIVEN o modo girar num carro com `g > 6,6%` (C-b′) WHEN o resultado aparece THEN a UI informa **quanto** dos gastos não é recuperado — nunca o total de gastos. No PRD2189: **R$ 1.570** sobre o par sugerido (86.850 − 85.280) e **R$ 1.550** sobre o par arredondado que vai ao portal (86.850 − 85.300). **O número exibido acompanha o par exibido naquela coluna naquele momento**, e é recalculado a cada mudança — gasto lançado pela aba (AC9 da 3.1), edição manual do campo (AC19 da 3.1) ou troca de modo.
    > **⚠️ Este número é PROIBIDO de ser escrito à mão, em qualquer lugar** — código, comentário, teste ou texto de UI. Ele mudou **duas vezes em um único dia**: R$ 6.850 (leitura errada da v1) → R$ 1.090 (régua de duas constantes) → **R$ 1.570** (régua única). Um literal aqui estaria errado hoje e ninguém perceberia. Registrado na ADR-003 §12.8 exatamente por isso.
    >
    > **Desempate dos R$ 20 — prevalece esta AC.** A ADR-003 §12.1/§12.8 cita **R$ 1.570** porque calcula sobre o par **sugerido**; a C10 manda calcular sobre o par **aplicado** (R$ 1.550), que é o preço que vai de fato ao portal e portanto o dinheiro de que o Marcos realmente abre mão. **Prevalece a C10.** Sem esta frase, o dev que abrir a §12.8 primeiro hard-coda 1.570 — que é o literal que o parágrafo acima proíbe.

    E o **enquadramento** é o da §12.8: sob o modo girar, "abaixo do custo" **não é alerta — é a descrição do modo**; o vermelho fica reservado pro que ele **não** escolheu (C16).
11. **C11** ✅ *(D2 respondida — o ajuste **APLICA**)* — GIVEN um carro parado há mais de `DIAS_PARADO_LIMIAR` WHEN o modo **girar** calcula THEN o ajuste de dias parados **aplica**, com os **mesmos pontos de razão** do modo recuperar. Base da decisão: a diferença ≤30 × >30 **não encolheu** ao trocar o denominador pra compra (2,72 pt → 3,03 pt, n=62, 2026-08-12) ⇒ sinais **independentes**, sem double-count. A constante nomeada `AJUSTES_APLICAM_NO_MODO_GIRAR` **permanece no código**, agora com a tabela da medição e o critério no lugar do bloco de ambiguidade — pra que uma virada futura seja **flipar a chave**, não reabrir a pergunta. **Restrição da ADR-003 §12.10, que a resposta não revoga:** o ajuste opera em **espaço de razão** e é **base-agnóstico por construção** — chave **liga/desliga**, jamais uma segunda fórmula. *(Testado: os `ajustes` são `deepEqual` entre modos, e a identidade da diferença continua fechando com a régua já ajustada.)*

### B. Snapshot e schema

12. **C12** — GIVEN que aplico um preço WHEN o snapshot é gravado THEN **o modo é recuperável da linha sem inferência e sem parsing**, porque sem isso a recalibração mistura duas populações e a tabela 030 perde a razão de existir:
    - **coluna `modo TEXT NOT NULL`, migration 032**, domínio fechado por **`rep_prec_modo_chk`** com **exatamente dois** valores (`recuperar_tudo`, `girar_rapido`), **sem `DEFAULT`**, **sem terceiro valor reservado** e **sem índice novo** (ADR-003 §12.6). *Um terceiro valor no CHECK não é seguro barato como o `confianca.media`: mudaria a **base do preço**, e um CHECK que já o aceita convida a gravar linhas de um modo que o motor não implementa — ver T6;*
    - **`rep_prec_base_do_modo_positiva_chk`** — `I0` como defesa em profundidade, na forma condicional `CASE modo … END > 0`. É o último anteparo da **C6**, e **não substitui** a guarda do motor. *(Com ele, a tabela passa a ter **7 CHECKs nomeados**: os 5 da 030 + estes 2.)*;
    - **`versao_regua` ganha o sufixo do modo NOS DOIS MODOS** — `…__recuperar_tudo` (49 chars) e `…__girar_rapido` (47), ambos sob o limite de 60 do `rep_prec_versao_nao_vazia_chk`. **Não como fonte**, como **redundância legível**. ⚠️ **Obrigatório nos dois:** a query 6 de verificação da 032 detecta inconsistência com `WHERE versao_regua NOT LIKE '%\_\_' || modo` e espera **0 linhas** — sem o sufixo no recuperar, **100% das linhas desse modo aparecem como inconsistentes** e o detector vira ruído. Com o sufixo nos dois, bumpar a versão e esquecer vira inconsistência **detectável**, em vez de população perdida em silêncio;
    - **`parametros_regua`** segue como está — **nenhuma chave nova** (D3 eliminou `REGUA_GIRAR_PCT`);
    - **`minimo_razao_efetiva` / `compre_por_razao_efetiva` continuam sendo razão sobre `custo_real` nos dois modos.** Motivo (ADR-003 §12.5, mais forte que "senão o COMMENT mente"): a coluna existe pra que **`razão × custo_real` reproduza o preço gravado**, e essa identidade só sobrevive se o denominador for **uniforme entre modos** — `custo_real` é o único candidato uniforme (`NOT NULL`, verificado por `rep_prec_custo_decomposto_chk`). Denominador variável obrigaria toda leitura futura a saber o modo **antes** de saber o que a razão significa. **Nenhuma correção de COMMENT é necessária aqui;**
    - **`bateu_piso` tem o COMMENT corrigido na mesma 032**: passa a significar "travou no piso **do modo**" (recuperar → `custo_real`; girar → `valor_compra_repasse`), com "ler sempre junto da coluna `modo`". *Se por qualquer motivo a coluna `modo` cair, este COMMENT **continua** exigindo migration própria e passa a ser bloqueante sozinho — um COMMENT dizendo "piso de custo" numa coluna que significa "piso da compra" é pior que COMMENT nenhum.*
13. **C19** — GIVEN o snapshot sendo montado WHEN o `modo` é gravado THEN **"girar com modo recuperar" não é um estado representável no código.** Concretamente:
    - `modo` é **campo do retorno do motor** — `SugestaoPrecoRepasse.modo` —, gravado por quem calculou os preços;
    - `montarSnapshotPrecificacao` **deriva o `modo` desse retorno**. Ele **não aceita `modo` como parâmetro separado**, e **não lê o estado do seletor da C15**. Se a assinatura permitir passar os dois independentemente, a AC está violada mesmo que todos os testes passem;
    - o mesmo vale pro sufixo de `versao_regua` (C12): derivado do mesmo campo, nunca montado à parte.

    **O modo de falha que isto fecha é concreto:** o seletor guarda o modo em estado de UI; o motor devolve os preços; os dois chegam à montagem por **caminhos separados**. Trocar de modo depois do cálculo — ou simplesmente passar o estado do seletor em vez do modo que rodou — grava uma linha que **nenhum CHECK e nenhum trigger pegam**: `rep_prec_modo_chk`, `rep_prec_base_do_modo_positiva_chk` e `rep_prec_custo_decomposto_chk` **todos passam**, porque a linha é coerente por fora. Ela só **mente sobre a própria população**, e envenena a recalibração em silêncio — que é a única coisa que a 030 existe pra fazer.

    **É o único jeito de corromper a tabela que o banco não detecta** (`@dara-data-engineer`), e por isso **o fix é de tipo, não de teste**: o teste da C18 confirma o comportamento, mas quem impede o bug é a assinatura que torna o par inconsistente inexprimível.
14. **C13** — GIVEN a tela com os dois modos WHEN eu troco de modo THEN **nada é gravado**. O snapshot nasce **só no clique de Aplicar** (ADR-003 §3.2: o evento é a decisão, não a consulta). Duas colunas na tela não podem virar duas linhas por placa digitada.

### C. Tela e vizinhança

14. **C14** — GIVEN um carro carregado WHEN a sugestão aparece THEN vejo **as duas colunas simultaneamente** com: rótulo do modo, mínimo, compre-por, margem sobre `custo_real` em cada um, e — no girar, quando `g > 6,6%` — a linha do quanto se abre mão (C10). A decomposição do custo (AC8 da 3.1) aparece **uma vez, acima das duas colunas**: é a mesma pros dois, e repeti-la sugere dois custos. A banda p25–p75 aparece **só na coluna recuperar** (C7).
15. **C15** — GIVEN as duas colunas WHEN vou aplicar THEN **um dos modos está selecionado** e é o par dele que preenche os campos editáveis (arredondado a R$ 100, AC18 da 3.1). E:
    - **default = "recuperar tudo"**, em todo carro — é o que a 3.1a já entrega e o que ele vem usando; mudar o default em silêncio trocaria a régua de todos os carros, que é exatamente o que esta fatia recusou fazer, e é o lado conservador do erro (ADR-003 §7.1);
    - **a escolha NÃO é lembrada** — nem por carro, nem por sessão. Lembrar **por carro** exigiria persistir a cada toque no seletor, transformando consulta em escrita (recusado na ADR-003 §3.2); lembrar **por sessão** abriria o próximo carro no modo escolhido pra **outro** carro — modo errado em silêncio, que é a falha que um default explícito evita. A única persistência com consumidor é o snapshot da decisão aplicada (C12);
    - trocar de modo **repreenche** os campos, e se eu já tinha digitado à mão, a UI **avisa antes de sobrescrever**.
16. **C16** — GIVEN um carro cujo `valor_minimo` gravado está abaixo do `custo_real` WHEN abro `/precificar` ou olho `/repasses` THEN o sistema **distingue as três origens** do mesmo predicado (ADR-003 §12.8), todas **derivadas** — nenhuma coluna de procedência é criada (§3 opção 6 e ADR-002 §4.5 seguem de pé):

    | Origem | Como se identifica | Reação |
    |---|---|---|
    | **Decisão** — girado deliberadamente | último snapshot do repasse com `modo = 'girar_rapido'` e `minimo_aplicado` batendo com o `valor_minimo` atual | **nota neutra**: "girado sobre a compra — R$ X de gastos não recuperados" |
    | **Deriva** — custo subiu depois por gasto tardio | existe snapshot e o `custo_real` **dele** é menor que o de hoje | **o vermelho original, intacto** — é o caso que o Risk #8 da 3.1 mirava |
    | **Fora do sistema** — veio do import ou de edição inline | não há snapshot, **ou** o `minimo_aplicado` do último não bate com o `valor_minimo` de hoje | **vermelho** — o mais informativo dos três |

    E, **acima de `g > 11,97%` (C-c′)**, o `compre_por` fica abaixo do custo e o **badge do `/repasses` vira 🔴** via `classificarBadge` (`margem-repasse.ts:153`, que avalia em `oferta = valor_compre_por`). O mesmo tratamento de três origens vale para o badge — senão o ruído que a C16 remove do alerta reaparece na lista, num limiar diferente e mais alto.
17. **C17** — GIVEN a UI dos dois modos WHEN olho a tela THEN a base de cada régua está declarada em pt-BR (n e período), e o que se declara é **assimetria de BASE, não de constante** — D3 eliminou a "constante de n=12 transposta" que a v1 precisava explicar. **Uma constante de n=16, duas bases.** A incerteza residual vai pro lugar certo: os **n=4 carros com gasto**, que venderam a 105,6% da compra contra os 106,6% que a régua pede sobre ela. Nenhum dos dois é número fechado. É a mitigação viva do Risk #1 da 3.1, e pesa mais aqui: **duas** colunas passam impressão de método comparativo que a amostra não sustenta.

### D. Qualidade

18. **C18** — GIVEN a suíte WHEN rodo `node --import tsx --test tests/*.test.ts` THEN `tests/precificar-repasse.test.ts` cobre, sobre funções puras:
    - **não-regressão do modo recuperar** — casos da 3.1a passam **sem edição**, exceto o caso da invariante (abaixo);
    - **girar:** mínimo sobre `valor_compra_repasse` com a **mesma** constante — falha se alguém introduzir uma segunda;
    - **A identidade da diferença, como asserção própria:** `minimo_recuperar − minimo_girar = REGUA_MINIMO_PCT × Σ gastos`, **exato**, e **zero se e somente se `gastos = 0`** (que é a igualdade da C3). ⚠️ **Esta é a asserção que barra a reintrodução de uma segunda constante** — inclusive por engano num merge, que é o modo de falha mais provável já que a v1 desta story propunha exatamente isso. Sem ela, um `REGUA_GIRAR_PCT` reintroduzido passa em todos os outros testes;
    - **`base(girar) ≤ base(recuperar)` ⇒ `preço_girar ≤ preço_recuperar`** — sob D3 a implicação **vale** (era falsa com duas constantes: era o extinto C-a);
    - **I1 por modo, I2 nos dois** (via o override de parâmetros da AC10 da 3.1), e **`minimo ≥ valor_compra_repasse` afirmado globalmente**;
    - **o caso que impede o conserto errado** (ADR-003 §12.3): no PRD2189 (compra 80.000, gastos 6.850), modo girar, **`minimo < custo_real` afirmado como resultado ESPERADO** — R$ 85.280 contra custo R$ 86.850. Um teste que **exige** o preço abaixo do custo é o que transforma a decisão do Marcos em regressão detectável. **Comentário obrigatório** no arquivo apontando pra ADR-003 §12.2 e pra decisão de 2026-08-12;
    - **`base(modo) <= 0`**: compra 0 com gastos > 0 ⇒ **sem sugestão no girar, com sugestão normal no recuperar** (C6) — os dois ramos afirmados, senão a guarda vira global e barra um caso legítimo;
    - **o `modo` do snapshot vem do resultado do motor** (C19): montar snapshot a partir de uma sugestão `girar_rapido` produz `modo = 'girar_rapido'`, e não existe caminho de código que aceite os dois separadamente;
    - referência **não entra no preço em nenhum modo** — pares idênticos entre Ref. AA / FIPE / sem referência (C8);
    - **`bandaMinimo === null` no girar** e preenchida no recuperar (C7) — testável porque a supressão é do motor;
    - ⛔ **NÃO escrever teste de round-trip exato da razão efetiva** — `razão × custo_real` fecha a **±R$ 0,01**, não exatamente (Edge case #4). O valor autoritativo é `minimo_sugerido`. *Este bullet é negativo de propósito: quem escreve teste lê esta AC, não os edge cases — e os dois documentos que um "consertador" abriria (ADR-003 §12.5 e `032:244`) afirmam a identidade como **exata**. A ressalva "±R$ 0,01" foi pedida à `@aria-architect` e à `@dara-data-engineer`; até ela entrar, **esta AC é a fonte**;*
    - montagem do snapshot **nos dois modos**: `modo` correto, `versao_regua` com sufixo coerente com a coluna, `parametros_regua` sem chave nova, razões efetivas **sobre `custo_real`** (C12).
    Zero `any`, imports `@/`, suíte inteira verde.

> **⚠️ A quebra de teste é esperada e o conserto errado é previsível.** O caso da 3.1a que afirma
> `minimo ≥ custo_real` **vai falhar** no modo girar. A ADR-003 §12.3 registra os três consertos
> errados, cada um mais barato de escrever que o certo, cada um revertendo a decisão do Marcos em
> silêncio dentro de um arquivo que ninguém revisa como decisão: ❌ afrouxar pra
> `≥ custo_real * 0,9`; ❌ pular a asserção no girar; ❌ passar `custo_real` como base do girar "só
> pro teste passar" — que é literalmente a opção que o Marcos recusou.

---

## Scope

**IN**
- Motor: parâmetro de **modo**, `base(modo)`, os **5 sítios** trocados + os **3** preservados + a **guarda `base(modo) <= 0`** (C5, C6).
- Banda p25–p75 suprimida no modo girar (C7).
- **Migration 032** — coluna `modo TEXT NOT NULL` + CHECK nomeado + correção do COMMENT de `bateu_piso`. **DDL é da `@dara-data-engineer`** (já acionada).
- `snapshot-precificacao.ts`: campo `modo`, sufixo em `versao_regua`, razões efetivas mantidas sobre `custo_real`.
- `PrecificarAba.tsx`: duas colunas, seletor, prefill por modo, aviso de sobrescrita, rótulos de amostra.
- **Leitura da 030 — em duas formas, as duas autorizadas aqui.** É o **primeiro leitor da tabela**:
  1. **pontual**, o snapshot mais recente **de um repasse**, em `/precificar` (C16);
  2. **de lista**, o snapshot mais recente **por repasse, para a lista inteira** (~59 carros), porque a C16 aplica as três origens **também ao badge do `/repasses`**. Viável com o `idx_rep_prec_repasse_recente` da 030 (`repasse_id, criado_em DESC`), mas é **query de lista** e precisa estar autorizada por escrito — é parte do que faz esta fatia ser **L−**, e é a peça que o corte de escopo remove (ver Sequenciamento).
- Tratamento do badge 🔴 do `/repasses` acima de `g > 11,97%` (C16).
- Testes dos dois modos + reescrita documentada do caso da invariante.

**OUT** (explicitamente fora)
- **Tela de histórico da 030: OUT.** *(A leitura pontual da C16 é IN — ver acima. A distinção é obrigatória: sem ela o `@dex-dev` implementa a C16 e o `@quinn-qa` a marca corretamente como escopo fora.)*
- **Recalibrar `REGUA_MINIMO_PCT`** — vale pros dois modos e vai pro gatilho T2 (n > ~40) junto com as demais.
- **Escolher o modo automaticamente** por dias parados, status ou destino ("carro parado > 30 dias abre em girar"). É a pergunta da D2 com a resposta escondida num default. Story própria, e só depois de D2.
- **Um terceiro modo** ("preço de showroom", classes A–E) — e por isso o CHECK de `modo` **não** reserva slot (T6).
- **Persistir a escolha de modo** por carro ou sessão (C15).
- Coluna de procedência por campo — ADR-002 §4.5 e ADR-003 §3 seguem de pé; a C16 é derivação, não coluna.
- Qualquer alteração em `margem-repasse.ts`, nas cores do semáforo, ou em `@/lib/pricing/suggest.ts` (varejo).
- Metade 2 da 3.1 (avaliar oferta / custo de recusar) — é a **3.1b**, independente.

---

## Dependências

| Estado | O quê | Quem |
|---|---|---|
| 🟠 **Bloqueante — entregue, NÃO aplicada** | **Migration 032** — `supabase/migrations/032_repasse_precificacao_modo.sql`, esperando o Marcos aplicar. Coluna `modo TEXT NOT NULL` sem DEFAULT, `rep_prec_modo_chk` (2 valores), **`rep_prec_base_do_modo_positiva_chk` condicional ao modo** (barra compra 0 no girar, deixa passar no recuperar — C6) e COMMENT de `bateu_piso` corrigido | `@dara-data-engineer` ✅ |
| 🟡 **Bloqueante — revalidação** | A story muda o contrato do motor, ganha migration e ganha um leitor da 030 | `@pax-po` |
| 🟢 **Resolvida** | **D2** — ajuste de dias parados no modo girar: **aplica**. Medição de 2026-08-12 (n=62) fechou o Risk #3 — a diferença não encolheu sobre a compra (2,72 pt → 3,03 pt), logo sinais independentes | `@alex-analyst` ✅ |
| 🟢 **Resolvida** | **Emenda ADR-003 §12** — invariante em função de `base(modo)`, os 5 sítios, a guarda que falta, a decisão da coluna `modo`, as três origens de "abaixo do custo" | `@aria-architect` — commit `22a2d0d` |
| 🟢 **Resolvida** | **D1** (piso = compra) e **D3** (régua única) | Marcos, 2026-08-12 |
| 🟢 **Pronta** | Story **3.1a** implementada e revisada; migration **030 aplicada** (`20260812122106`), tabela com **zero linhas** | — |
| 🟠 **Bloqueia a C3** | **Como a tela se comporta quando os dois modos dão o mesmo número** (carro sem gasto — 12 de 16): colapsar numa coluna ou manter duas declarando que não há segunda conta. Encaminhado pela `@aria-architect`. Também: hierarquia e rótulos das duas colunas (C14, C17) | `@uma-ux` |

**Nota de numeração:** a **031 segue reservada** pro `COALESCE` nos writes da 028 (ADR-003 §6) e
**continua não aplicada**. Pular pra 032 não a cancela nem a antecipa; G1-b segue desarmado (C8).

**Código a reaproveitar, não reescrever:** `sugerirPrecoRepasse` / `REGUA_PADRAO` /
`reguaComprePorPct` / `arredondarRespeitandoPiso` / `decomporCusto`;
`montarSnapshotPrecificacao` / `serializarParametrosRegua`; `aplicarPrecoRepasse` e a ordem de
escrita em três passos; `calcularCustoReal` / `classificarMargem` / `classificarBadge`.

**Decisões fechadas — não reabrir aqui:** razão 0,952; sugestão editável antes de aplicar; prefill
arredondado (AC18 da 3.1); `valor_minimo`/`valor_compre_por` governados pelo portal via import;
régua **plana em quilometragem** (AC16 da 3.1) — nos **dois** modos.

---

## Risk / Edge cases

### Riscos

1. **Duas colunas parecem método; a amostra é n=16, e n=4 no grupo que motivou a fatia.** É o Risk #1 da 3.1 agravado. **Mitigação:** C17 (amostra e assimetria declaradas), C3 (dizer quando os modos coincidem), pares editáveis (AC19 da 3.1). D3 ajuda: sem constante nova, há um número a menos a defender.
2. **Modo girar aplicado por engano num carro de showroom.** O default conservador e a ausência de memória (C15) são a mitigação. O custo do erro é dinheiro deixado na mesa e **não é detectável depois** sem o snapshot — que é o que a C12 preserva.
3. **Double-count entre "girar rápido" e o ajuste de dias parados — o mesmo erro que derrubou o km. (D2, aberta.)** O modo girar **já é** a resposta pra carro parado ("precisamos vender esse carro rápido, porque está parado há muito tempo" — palavras dele). O ajuste desconta **de novo**, pelo mesmo motivo.
   **Levantado, não decidido. A medição que resolve** — mesma forma da que fechou o km:
   - **(i)** Nos 16 vendidos: mediana de `minimo_que_vendeu ÷ valor_compra_repasse`, quebrada por dias parados no momento do mínimo (**≤30 × >30**). Se o grupo >30 for materialmente mais baixo **medido sobre a compra**, o sinal é independente da base e o ajuste sobrevive nos dois modos.
   - **(ii)** Na frota ativa (59 carros): reproduzir a tabela do Risk #14 da 3.1 — hoje `mínimo ÷ custo`, 1,0716 (≤30) × 1,0513 (>30), **2,0 pontos** — **medida sobre a compra**. **Se os 2,0 pontos encolherem materialmente ao trocar o denominador**, então "pedir sobre a compra" *é* o desconto de carro parado que ele já faz, e aplicar o ajuste por cima é double-count. Se persistirem, são sinais independentes.
   - Critério de decisão declarado **antes** de rodar, pra não virar leitura post-hoc.
4. **"Abaixo do custo" deixa de ser anomalia e vira rotina, em dois lugares e dois limiares.** Acima de 6,6% de gastos o **mínimo** cai abaixo do custo; acima de 11,97%, o **compre-por** também, e o **badge da lista vira 🔴**. Sem a C16, a fatia entrega ruído permanente numa lista hoje limpa — e alerta que toca sempre é alerta que ninguém lê (a mesma razão que matou o alerta de piso na ADR-003 §5).
5. **Dentro de `classificarMargem`, sob `mínimo < custo_real`: a faixa 🟠 fica vazia e ofertas no ou acima do mínimo anunciado classificam 🔴.** "Bateu o mínimo" e "vermelho" passam a coexistir. É **semanticamente correto** (é prejuízo de fato) e **não se conserta em `margem-repasse.ts`** — a função continua certa. O que muda é que, em carro girado, o vermelho perde a leitura "alguém errou". Registrado (ADR-003 §12.1) pra que ninguém "corrija" a função canônica; a leitura certa vem do enquadramento da C16.
6. **A régua única é usada em duas bases sem calibração específica de nenhuma delas.** Os 4 com gasto venderam a 105,6% da compra; a régua pede 106,6% — 1,0 ponto acima, com n=4. Não trava nada (é a mesma constante já em produção), mas **não pode ser apresentada como calibrada sobre a compra**.
   **O item que isso põe no gatilho T2** (substituindo o de `REGUA_GIRAR_PCT`, que morreu com D3): medir `minimo_que_vendeu ÷ valor_compra_repasse` nos carros **com gasto** contra `REGUA_MINIMO_PCT`. **Convergiram ⇒ a base está validada e nada muda. Divergiram ⇒ o girar precisa de constante própria — e ela volta com dado, não por transposição**, que é exatamente o defeito que D3 corrigiu.
7. **Régua invertida por edição desatenta** (`RAZAO_MINIMO_SOBRE_COMPRE_POR > 1`) produz par invertido nos **dois** modos. Coberto por I2 + o override de parâmetros (C18).

### Edge cases

1. **Carro sem gastos = 12 dos 16 e a maioria da frota.** As duas colunas mostram **exatamente o mesmo número**. É "essa tela mostra a mesma coisa duas vezes" no caso majoritário — e tela redundante deixa de ser usada (Risk #13 da 3.1). **D3 piorou este ponto**: antes eram números *próximos* (R$ 480 de distância), agora são **idênticos**. Resolver é trabalho de desenho, não de rótulo — **C3**, com a `@uma-ux`.
2. **Compra = 0 com gastos lançados** ⇒ hoje produz mínimo R$ 0,00 no modo girar; no recuperar é caso legítimo e a sugestão sai normal. **C6** — e cuidado com o conserto global (`valor_compra_repasse > 0`), que barraria o caso legítimo.
3. **`bateu_piso` é inalcançável com `REGUA_PADRAO`, nos dois modos.** A soma dos ajustes tem teto efetivo de **5 pontos** (`AJUSTE_DIAS_MAX 0.03` + `AJUSTE_REANUNCIO_MAX 0.02`, sob `AJUSTE_TOTAL_MAX 0.06`) contra **6,6 pontos** de folga até `PISO_PCT = 1.0`. A flag só dispara com constantes editadas à mão — o que **não** dispensa a correção do COMMENT (C12): ela existe justamente pro dia em que alguém editar.
4. **Round-trip da razão efetiva fecha a ±R$ 0,01, não exatamente.** `minimo_razao_efetiva` é `numeric(9,6)`: no PRD2189/girar, `85.280 ÷ 86.850 = 0,981923` e a volta dá R$ 85.280,01. **O valor autoritativo é `minimo_sugerido`** (`numeric(12,2)`), nunca a razão. Não escrever teste que exija round-trip exato — o projeto trata R$ 0,01 como bug crítico e essa é a única exceção legítima, porque a razão é derivada e não é dinheiro.
5. **Gasto lançado na própria aba (AC9 da 3.1) recalcula os dois modos e move só um:** o recuperar sobe (custo subiu), o girar **não se move** (base inalterada). Correto, e visualmente confuso — a UI deve deixar claro que só uma coluna mexeu.
6. **`custo_real == 0` / compra negativa:** nenhum modo sugere; o estado neutro da AC6 da 3.1 vale **antes** da escolha de modo, e a UI não mostra colunas vazias.
7. **Ler a diferença entre os modos como "um desconto de X%".** Não é: a distância é **`1,066 × Σ gastos`** e varia por carro — zero em 12 dos 16. Um comentário dizendo "o girar tira ~6%" seria falso na maioria da frota.

---

## Complexity (T-shirt)

**L−** — subiu de **M** (v1) por causa da **migration 032** e da **leitura da 030** (C16), que entraram
depois. A matemática ficou **mais simples** com D3 (uma constante, relação exata, dois limiares em
vez de três); o trabalho está em (1) não regredir a 3.1a, (2) os 5+3+1+1 sítios do motor sem
deixar nenhum pra trás, (3) as três origens de "abaixo do custo" em dois lugares e dois limiares, e
(4) uma UI de duas colunas honesta sobre uma calibração fraca.

### Sequenciamento — obrigatório, nesta ordem

1. **Migration 032 + `modo` no snapshot (C12, C19).** Primeiro **porque tem janela**: a coluna `NOT NULL` sem `DEFAULT` só é grátis enquanto a tabela tem zero linhas. Qualquer aplicação de preço antes disso fecha a janela.
2. **Motor + testes** (C1–C6, C18).
3. **UI de duas colunas** (C3, C7, C14, C15, C17).
4. **C16** (três origens + badge).

**A única linha de corte limpa é a C16 + badge** — única peça fora do `/precificar`, primeiro leitor
da 030 e a que exige a query de lista. Mas com o **preço declarado**: sem ela, o `/repasses` ganha
**ruído permanente numa lista hoje limpa** (Risk #4). Por isso corta **dentro do mesmo sprint**, não
pra depois.

**C11** entrou (D2 respondida com dado em 2026-08-12). O que **não** dá pra cortar é a **C12/C19** — snapshot que não
diz qual régua produziu o número mistura duas populações e destrói o valor de calibração da 030
**retroativamente** — nem a **C6**, que é bug com dinheiro na tela.

---

## Definition of Done

- [ ] **Migration 032 aplicada** (`supabase/migrations/032_repasse_precificacao_modo.sql`, já escrita e revisada — falta o Marcos rodar), com a verificação pós-aplicação do próprio arquivo executada. ⚠️ **Aplicar enquanto a tabela ainda tem zero linhas** — é a janela em que `NOT NULL` sem `DEFAULT` sai de graça (ADR-003 §12.6)
- [ ] **`rep_prec_base_do_modo_positiva_chk` nunca dispara em teste manual** — se disparar, o bug é do motor, não da constraint (C6)
- [x] **D2 respondida COM DADO** (2026-08-12, n=62 — não adiada): o ajuste **aplica** no girar, `AJUSTES_APLICAM_NO_MODO_GIRAR = true`, com a tabela da medição e o critério registrados no código e na story (C11)
- [ ] Código + testes verdes (`node --import tsx --test tests/*.test.ts`, suíte inteira)
- [ ] Typecheck (`tsc`) + lint clean, zero `any`, imports `@/`
- [ ] **Não-regressão do modo recuperar comprovada** — casos da 3.1a passam sem edição, exceto o da invariante, reescrito conforme ADR-003 §12.3 **com o comentário obrigatório** apontando pra §12.2 e pra decisão de 2026-08-12 (C1, C18)
- [ ] **O teste que exige `minimo < custo_real` no girar existe** (PRD2189) — é ele que torna a decisão do Marcos uma regressão detectável
- [ ] **Nenhuma constante nova em `REGUA_PADRAO`** — grep no diff (C2/D3) **e** o teste da identidade da diferença verde (C18), que é a trava contra reintrodução por merge
- [ ] **Os 6 sítios trocados** (incluindo o alerta de `bateuPiso` em `577-578`), **os 3 preservados**, os **2 que ficam de fora por desenho** (`396-403`, `670`), o **clamp de razão `574` NÃO tocado** e a guarda `base(modo) <= 0` — conferidos um a um contra a C5. `grep custoReal` não pode deixar nenhuma ocorrência sem categoria
- [ ] **`versao_regua` com sufixo nos DOIS modos** — query 6 da 032 (`NOT LIKE '%\_\_' || modo`) devolve **0 linhas** depois de aplicar preço nos dois modos (C12/F6)
- [ ] **`bandaMinimo === null` no girar**, afirmado em teste de função pura (C7/C18)
- [ ] Testado com pelo menos 4 placas reais: uma **sem gasto** (os dois modos idênticos), uma com **`g` entre 6,6% e 11,97%** (PRD2189 — mínimo abaixo do custo, badge normal), uma com **`g > 11,97%`** (badge 🔴), e uma **sem Ref. AA**
- [ ] **Compra = 0 com gasto lançado** testado nos **dois** ramos: girar recusa com mensagem pt-BR própria; **recuperar sugere normalmente** (C6)
- [ ] **C19 verificada na ASSINATURA, não só em teste:** `montarSnapshotPrecificacao` **não aceita `modo` como parâmetro separado** e não lê o seletor — "girar com modo recuperar" tem que ser **inexprimível**, não apenas não-testado. É a única corrupção que o banco não detecta
- [ ] **Migration 032 aplicada ANTES de qualquer aplicação de preço** — o sequenciamento não é preferência: é a janela da coluna grátis
- [ ] Aplicar nos **dois** modos ponta a ponta: `modo` gravado, sufixo de `versao_regua` **coerente com a coluna**, `parametros_regua` sem chave nova, razões efetivas sobre `custo_real`, e `GROUP BY modo` separando as populações sem `split_part` (C12)
- [ ] **As três origens de "abaixo do custo"** verificadas no **alerta de abertura** do `/precificar` (C16). Carro girado deliberadamente **não** mostra vermelho; carro com gasto tardio **mostra**
- [ ] ⚠️ **O "badge do `/repasses`" da C16 NÃO foi implementado — a premissa não se confirma no código.** Achado do `@dex-dev` em 2026-08-12: `/repasses` é só `RepassesLista`, que **não tem coluna de `valor_minimo`/`valor_compre_por` e nunca chama `classificarBadge`**. Os dois consumidores reais de `classificarBadge` são `PainelNegociacao` (`InteressadosCRM.tsx:612`, rota `/repasses/[id]/interessados`) e `montarItemAnuncio` (`relatorio-anuncio.ts:125`, rota `/repasses/anuncio`) — **telas por carro, não a lista**. Consequências: (1) o Risk #4 ("ruído permanente numa lista hoje limpa") **não se materializa na lista**; (2) a **query de lista** do IN perde o consumidor e **não foi escrita** — seria código morto; (3) falta decidir com a `@uma-ux` **se** os dois consumidores por-carro recebem o mesmo tratamento de três origens, e **com que texto** (a spec de UX cobre só o alerta de abertura). **Reabrir com `@morgan-pm`/`@uma-ux` antes de fechar a fatia**
- [ ] Banda p25–p75 **ausente** na coluna girar (C7); alerta do girar mostra o valor **calculado** e não o total de gastos (C10)
- [ ] UI declara a amostra dos dois modos e a assimetria n=16/n=4 (C17); carro sem gasto rotulado "os dois modos dão o mesmo preço" (C3)
- [ ] Sem regressão em `/repasses` (lista, inline edit, KPIs, Bônus, XLSX), em `margem-repasse.ts` (**não alterado**), nem na 3.1a
