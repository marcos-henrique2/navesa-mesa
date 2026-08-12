# UX — `/precificar`, dois preços (story 3.1c, passos 3 e 4)

> Autoria: `@uma-ux`, 2026-08-12. Bloqueia a C3.
> Cobre: **C3, C10, C13, C14, C15, C17** + hierarquia do alerta.
> Arquivo alvo: `src/components/repasses/PrecificarAba.tsx`.
>
> **JTBD:** *"Neste carro, decidir se vale segurar a margem ou sacrificar os gastos pra tirar ele do pátio — sem refazer a conta de cabeça."*
>
> ⚠️ Os textos em pt-BR abaixo são **para colar**. Não reescrever. Se algum não couber no componente sem gambiarra, parar e reportar.

---

## 1. Decisão da C3: **colapsar**

**Quando `custo.gastosTotal === 0`, a tela mostra UMA coluna** — exatamente a tela da 3.1a, sem seletor — mais uma linha que nomeia o modo ausente e diz por que ele não existe neste carro.

Por que colapsar e não manter duas:

1. **Um controle que não faz nada em 12 de 16 carros ensina a ignorá-lo.** Se ele tocar "girar rápido" num carro sem gasto e nenhum número mudar, a leitura natural não é "não há segunda conta" — é "está quebrado". Depois disso ele não toca mais no seletor **nos 4 carros em que ele importa**. É o Risk #13 da 3.1 chegando pelo caminho mais caro.
2. **O caso majoritário fica com regressão visual zero.** A 3.1a já está em uso e funciona.
3. **O seletor vira sinal.** Ver dois cards passa a significar "este carro tem gasto e portanto tem escolha" — informação de graça, antes de ler qualquer número.

**Consequência de dado, declarada:** em carro sem gasto o motor roda só em `recuperar_tudo`, então o snapshot grava `modo = 'recuperar_tudo'` nos ~12/16. Isso é **correto e não perde nada** — com `compra == custo` as duas populações são a mesma medição, e a identidade `mínimo = 1,066 × base` fecha igual nas duas. A população `girar_rapido` nasce pequena **e é justamente aquela em que o modo significa alguma coisa**.

### Regra de cálculo (sem margem pra adivinhar)

```
recuperarResultado = sugerirPrecoRepasse(entrada, REGUA_PADRAO, "recuperar_tudo")   // sempre

girarResultado =
  recuperarResultado.ok && recuperarResultado.custo.gastosTotal > 0
    ? sugerirPrecoRepasse(entrada, REGUA_PADRAO, "girar_rapido")
    : null                                    // ⚠️ null, não "calculado e escondido"
```

`girarResultado === null` ⇒ não existe estado de UI em que `modo = girar_rapido` — a **C19 fica fechada também pelo lado da tela**, não só pela assinatura.

`recuperarResultado.ok === false` ⇒ `girarResultado` também seria `!ok` (se `custoReal ≤ 0` então `compra ≤ 0`). Bloco neutro atual, **inalterado**, sem colunas.

---

## 2. Layout

### 2.1 Estado A — dois modos (há gasto), ≥640px

Colunas = **modos**. Dentro de cada coluna, os dois `PrecoCard` empilhados. A decomposição do custo continua **acima**, uma vez só (C14) — `BlocoCusto` sem mudança.

```
┌─ Sugestão pro anúncio ───────────────────────────── [Confiança alta] ─┐
│ Mede se há referência de mercado pra conferir — não se o preço está    │
│ certo. (texto existente, sem mudança)                                  │
│                                                                        │
│ Como precificar este carro:              ← radiogroup, rótulo visível  │
│ ┌────────────────────────────┐ ┌────────────────────────────┐         │
│ │ (•) Recuperar tudo         │ │ ( ) Girar rápido           │         │
│ │     Selecionado            │ │                            │         │
│ │ sobre o custo real         │ │ sobre a compra             │         │
│ │ R$ 86.850,00               │ │ R$ 80.000,00               │         │
│ │ régua de 16 vendas         │ │ dessas 16, só 4 tinham     │         │
│ │                            │ │ gasto — é a base mais fraca│         │
│ │ ┌────────────────────────┐ │ │ ┌────────────────────────┐ │         │
│ │ │ MÍNIMO                 │ │ │ │ MÍNIMO                 │ │         │
│ │ │ R$ 92.600              │ │ │ │ R$ 85.300              │ │         │
│ │ │ Piso do leilão de 24h  │ │ │ │ Piso do leilão de 24h  │ │         │
│ │ │ · 106,6% do custo      │ │ │ │ · 98,2% do custo       │ │         │
│ │ │ Régua crua: 92.582,10  │ │ │ │ Régua crua: 85.280,00  │ │         │
│ │ └────────────────────────┘ │ │ └────────────────────────┘ │         │
│ │ ┌────────────────────────┐ │ │ ┌────────────────────────┐ │         │
│ │ │ COMPRE POR             │ │ │ │ COMPRE POR             │ │         │
│ │ │ R$ 97.300              │ │ │ │ R$ 89.600              │ │         │
│ │ │ Encerra o anúncio na   │ │ │ │ Encerra o anúncio na   │ │         │
│ │ │ hora · 112,0% do custo │ │ │ │ hora · 103,1% do custo │ │         │
│ │ │ Régua crua: 97.250,10  │ │ │ │ Régua crua: 89.579,83  │ │         │
│ │ └────────────────────────┘ │ │ └────────────────────────┘ │         │
│ │                            │ │ ┌── nota cinza (C10) ────┐ │         │
│ │ Banda do mínimo entre os   │ │ │ Neste preço você abre  │ │         │
│ │ carros que venderam        │ │ │ mão de R$ 1.550 dos    │ │         │
│ │ (p25–p75, n=16):           │ │ │ R$ 6.850 de gastos.    │ │         │
│ │ R$ 88.400 – R$ 95.100.     │ │ │ Não é erro: é o que    │ │         │
│ │ Não é a faixa entre o      │ │ │ este modo faz.         │ │         │
│ │ mínimo e o compre por.     │ │ └────────────────────────┘ │         │
│ └────────────────────────────┘ └────────────────────────────┘         │
│                                  ↑ SEM espaço reservado pra banda (C7)│
│                                                                        │
│ [ justificativa do modo SELECIONADO — bloco cinza existente ]          │
│ [ alertas do modo SELECIONADO — lista de Aviso, existente ]            │
│ [ rodapé da régua — texto novo, §5 ]                                   │
└────────────────────────────────────────────────────────────────────────┘
```

Notas de implementação:

- Grid de modos: `grid gap-4 sm:grid-cols-2` (é o grid que hoje segura Mínimo/Compre por — **sobe um nível**). Dentro de cada coluna: `space-y-3`.
- `PrecoCard` **reusado sem alteração de props**. As `descricao` repetem nas quatro instâncias de propósito: no empilhado (mobile) a segunda coluna ficaria com números sem rótulo.
- A coluna girar **não reserva altura** onde a banda estaria (C7). **Altura desigual entre colunas é correto** — significa "aqui tem menos evidência", que é verdade.
- Coluna selecionada: `border-[var(--brand-600)]` + `ring-1 ring-[var(--brand-600)]` + a palavra **"Selecionado"** no cabeçalho. **Nunca só cor** — o rádio e a palavra carregam o estado (AA).
- A não-selecionada **não é esmaecida**. Ele precisa comparar os números; opacidade em número de dinheiro é hostil.
- Subir a linha de razão do `PrecoCard` de `text-[11px]` pra `text-xs` — quatro números de 11px num tablet em pé de pátio é pouco.

### 2.2 Estado B — colapsado (sem gasto, ~12 de 16). **É a tela da 3.1a**

```
┌─ Sugestão pro anúncio ───────────────────────────── [Confiança alta] ─┐
│ (motivo da confiança — existente)                                      │
│                                                                        │
│ ┌── nota cinza, ANTES dos preços ────────────────────────────────────┐ │
│ │ Este carro não tem gasto lançado, então os dois modos dão          │ │
│ │ exatamente o mesmo preço — 106,6% sobre a compra é 106,6% sobre    │ │
│ │ o custo. Não há segunda conta a fazer neste carro.                 │ │
│ └────────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│ ┌──── MÍNIMO ────────────┐ ┌──── COMPRE POR ────────┐                 │
│ │ R$ 106.600             │ │ R$ 112.000             │   ← grid atual, │
│ │ Piso do leilão de 24h  │ │ Encerra na hora        │     intocado    │
│ └────────────────────────┘ └────────────────────────┘                 │
│ banda · justificativa · alertas · rodapé (recuperar_tudo)             │
└────────────────────────────────────────────────────────────────────────┘
```

Sem seletor, sem coluna fantasma, sem rádio desabilitado.

**Duas redações, escolhidas por `gastosQtde`** — existe gasto lançado de R$ 0,00 (`gastosTotal === 0` com `gastosQtde > 0`), e a primeira frase mentiria nesse caso:

- **`gastosQtde === 0`:**
  > Este carro não tem gasto lançado, então os dois modos dão exatamente o mesmo preço — 106,6% sobre a compra é 106,6% sobre o custo. Não há segunda conta a fazer neste carro.

- **`gastosQtde > 0 && gastosTotal === 0`:**
  > Os gastos lançados neste carro somam R$ 0,00, então os dois modos dão exatamente o mesmo preço — 106,6% sobre a compra é 106,6% sobre o custo. Não há segunda conta a fazer neste carro.

Os "106,6%" saem de `REGUA_PADRAO.REGUA_MINIMO_PCT` formatado — **nenhum literal** (mesmo precedente do rodapé atual, linha 699).

### 2.3 Estado C — mobile (<640px)

Empilha: nota do modo → coluna Recuperar (rádio, 2 cards, banda) → coluna Girar (rádio, 2 cards, nota C10) → justificativa → alertas → rodapé.

Cabeçalho de coluna **não** é `sticky` (complica sem pagar). Em vez disso: **cada cabeçalho repete a base em dinheiro**, então nenhum número fica órfão ao rolar.

**Rejeitado de propósito:** uma linha "girar rápido pede R$ 7.300 a menos". Dois valores em reais lado a lado — R$ 7.300 (diferença de preço) e R$ 1.550 (gasto que não volta) — parecem os dois "o custo de girar", e só um é. O R$ 1.550 é o que responde à pergunta dele. Também evita a leitura "o girar tira ~6%" (Edge case #7), falsa em 12 de 16 carros.

### 2.4 Estado D — girar indisponível (C6: compra = 0 com gasto)

Duas colunas; a de girar em estado neutro, rádio **desabilitado**, com o `motivo` que **o próprio motor devolve** (não reescrever):

```
┌ ( ) Girar rápido  — indisponível neste carro ┐
│ Girar rápido: o R$ Compra do repasse está    │
│ zerado, e a base deste modo é a COMPRA (não  │
│ o custo). …                                  │
└──────────────────────────────────────────────┘
```

`aria-disabled` + `title` com o mesmo motivo. Default segue `recuperar_tudo`, que sugere normalmente — **os dois ramos da C6 visíveis na mesma tela**.

---

## 3. C10 — onde mora o valor de que ele abre mão

**Fórmula única, um helper só, zero literais:**

```
naoRecuperado(custoReal, minimo) = max(0, arredondarCentavos(custoReal − minimo))
```

**Três zonas do mínimo, no modo girar** — é isto que resolve o "alerta que toca sempre":

| Zona | Condição | Significa | Tratamento |
|---|---|---|---|
| **A** | `mínimo ≥ custoReal` (g ≤ 6,6%) | recupera tudo mesmo girando | nota cinza curta (§3.2) |
| **B** | `compra ≤ mínimo < custoReal` (g > 6,6%) | **a descrição do modo** | **nota cinza, nunca vermelho** |
| **C** | `mínimo < compra` | abaixo do que ele pagou — só por edição manual | **vermelho** |

Zona B nunca ultrapassa `gastosTotal` por construção (`custoReal − 1,066×compra ≤ gastos`), então a frase "dos R$ X de gastos" nunca fica incoerente. **Zona C é o único vermelho**, e é exatamente a fronteira entre *abaixo do custo porque o Marcos escolheu* e *abaixo do custo por erro*.

### 3.1 Instância 1 — na coluna girar (contexto de comparação)

Calculada sobre `girar.minimoArredondado` (o par que a coluna exibe). **Zona B:**

> **Neste preço você abre mão de R$ 1.550 dos R$ 6.850 de gastos.** Não é erro: é o que este modo faz — ele recupera o que você pagou no carro, não o que gastou nele.

`tom="neutro"`, sem ícone de alerta.

### 3.2 Zona A (tem gasto, mas g ≤ 6,6%) — o slot não fica vazio

> Mesmo girando, o mínimo ainda cobre os R$ 2.100 de gastos. Entre os dois modos aqui a diferença é só de margem.

### 3.3 Instância 2 — no bloco Aplicar (contexto de decisão)

Calculada sobre `minimoAplicar` (o que está no campo). **Enquanto ele não editar, é o mesmo número** da coluna — não há duplicidade percebida. Se editar, o rótulo desambigua:

- **Zona B, sem edição:**
  > Com esse mínimo, R$ 1.550 dos R$ 6.850 de gastos não voltam.

- **Zona B, com edição:**
  > **Com o valor que você digitou**, R$ 2.300 dos R$ 6.850 de gastos não voltam.

- **Zona C** (`tom="erro"`):
  > **O mínimo ficou abaixo do que você pagou no carro (R$ 80.000,00).** Girar rápido abre mão dos gastos, não da compra — isso aqui é prejuízo sobre a compra. Dá pra aplicar assim mesmo, mas confira.

- **Compre por em zona C** (`comprePorAplicar < compra`): mesma redação trocando "mínimo" por "compre por".

**Recálculo:** os dois derivam de `useMemo`/expressão direta sobre `custoReal` e o valor corrente. Gasto lançado, edição de campo e troca de modo já mudam essas entradas — **nenhum efeito colateral a escrever**.

### 3.4 O que muda no alerta existente (linhas 769–771 e 807–815)

Hoje `abaixoDoCusto` compara os dois campos com `custoReal`, **nos dois modos**. Passa a ser por modo:

```
limiarVermelho = modo === "girar_rapido" ? custo.valorCompraRepasse : custo.custoReal
```

- **`recuperar_tudo`: comportamento e texto idênticos aos de hoje.** Não-regressão da 3.1a também na UI.
- **`girar_rapido`:** vermelho só abaixo de `valorCompraRepasse` (zona C); zona B é a nota cinza.

O alerta `invertido` (compre por < mínimo) fica igual nos dois modos.

---

## 4. C15 — seleção de modo

- **Componente:** `role="radiogroup"` com rótulo visível **"Como precificar este carro:"** (`aria-labelledby`). Cada coluna é um `<label>` envolvendo um `<input type="radio" name="modo-preco">` real. Card inteiro clicável, alvo ≥44px, `focus-visible` no card.
- **Default `recuperar_tudo` em todo carro.** `buscar()` já zera `minimoInput`/`comprePorInput`; acrescentar `setModo(MODO_PADRAO)` no mesmo ponto (linhas 100–102) **e no efeito do deep-link**.
- **Zero persistência (C13/C15):** sem `localStorage`, sem `sessionStorage`, sem contexto, **e sem o modo na URL** — um `?placa=X&modo=girar` compartilhado ou revisitado reintroduz memória entre carros pela porta dos fundos.
- **Lançar gasto NÃO reseta o modo.** Ele está no meio da decisão daquele carro.
- **Trocar de modo não grava nada** (C13). Nenhuma chamada de rede no `onChange`.

### 4.1 Sobrescrita de valores digitados

`minimoInput === null && comprePorInput === null` → troca direto, silenciosa.

Algum foi editado → **o rádio não muda ainda**; abre uma tira de confirmação logo abaixo do grid de colunas:

```
┌─ atenção (âmbar) ──────────────────────────────────────────────┐
│ Trocar pra "Girar rápido" vai substituir os valores que você   │
│ digitou (mínimo R$ 91.000,00 · compre por R$ 96.000,00).       │
│  [ Trocar e substituir ]   [ Cancelar ]                        │
└────────────────────────────────────────────────────────────────┘
```

- O rádio **só flipa** no "Trocar e substituir" — estado visual nunca mente.
- Foco vai pro "Trocar e substituir" ao abrir; **Esc** cancela; `role="alertdialog"` + `aria-modal="false"` (é inline, não modal).
- Tira inline, **não** `window.confirm` nem modal: em tablet o modal cobre justamente os números que ele precisa ver pra decidir.
- Botões: **"Trocar e substituir"** (primário) e **"Cancelar"**.

### 4.2 O modo tem que estar visível na hora de aplicar

No cabeçalho do `BlocoAplicar`, um chip ao lado do título — é o último ponto antes de uma escrita irreversível, e é a mitigação viva do Risk #2:

```
Aplicar no repasse   [ Girar rápido ]
Os dois campos vêm preenchidos com o par de "girar rápido" e são editáveis.
Sua correção é gravada junto com a sugestão — é ela que ensina onde a régua erra.
```

(Segunda frase **preservada palavra por palavra** da 3.1a. O chip usa o estilo do badge de status do `CabecalhoCarro`.)

**Toast de sucesso ganha o modo:**

> `Preço aplicado (girar rápido): mínimo R$ 85.300,00 · compre por R$ 89.600,00.`

Variante `updatePulado` idem. Custa nada e torna a decisão auditável no instante.

**D-UX1 — decisão do Marcos (2026-08-12): NÃO pedir confirmação extra ao aplicar no girar.** Só o chip e o toast. Racional: usuário único e especialista; confirmação que aparece toda vez vira clique automático em duas semanas e deixa de proteger — e o snapshot já torna o erro detectável depois.

---

## 5. C17 — declarar a evidência (o texto que não pode se perder)

**Rodapé, substitui o das linhas 697–701.** Duas versões:

**Colapsado (uma coluna)** — mantém o texto atual da 3.1a, **sem uma palavra a mais**.

**Dois modos:**

> Régua calibrada em 16 vendas reais (jun–ago/2026) — amostra pequena, número editável. É a **mesma** régua nos dois modos (mínimo = 106,6% da base; compre por derivado da razão mínimo÷compre-por de 95,2%): o que muda é a base, não a constante. A base do "girar rápido" é a mais fraca das duas — dessas 16 vendas, só **4** tinham gasto, e esses 4 venderam a 105,6% da compra contra os 106,6% que a régua pede. Nenhum dos dois é número fechado.

(Percentuais formatados de `REGUA_PADRAO`; o 105,6% e o "4" são fatos da amostra, escritos no texto, como o "16 vendas" já é hoje.)

**Nos cabeçalhos das colunas** — a assimetria fica onde o número está, não só no rodapé:

| Coluna | Linha 1 | Linha 2 |
|---|---|---|
| **Recuperar tudo** | `sobre o custo real` · `R$ 86.850,00` | `régua de 16 vendas` |
| **Girar rápido** | `sobre a compra` · `R$ 80.000,00` | `dessas 16, só 4 tinham gasto — é a base mais fraca` |

**Preservado integralmente da 3.1a:** motivo da confiança como texto visível (não tooltip), "Régua crua" ao lado do arredondado nos quatro cards, justificativa em bloco, campos editáveis com o diff. **Nada disso se dilui.**

---

## 6. Estados

| Estado | Comportamento |
|---|---|
| **Loading — busca de placa** | Inalterado (spinner no botão Buscar). |
| **Loading — recálculo dos modos** | **Nenhum.** É `useMemo` síncrono. ⚠️ **Não colocar skeleton** — flash de esqueleto num cálculo instantâneo é pior que a troca direta. |
| **Loading — lançar gasto** | Spinner só no botão "Lançar gasto"; as colunas **seguram os valores antigos** até a resposta. Sem skeleton, sem colunas vazias. |
| **Empty — sem placa buscada** | Inalterado. |
| **Empty — placa não encontrada / só no estoque** | Inalterado. |
| **Empty — sem sugestão (compra ausente/negativa/custo 0)** | Bloco neutro atual, **sem nenhuma coluna** (C6/Edge case #6). Inalterado. |
| **Empty — girar indisponível (compra 0 + gasto)** | §2.4. |
| **Empty — sem gasto** | §2.2 (colapsado). **Não é estado vazio:** é o estado normal de 12 em 16 carros. |
| **Error — falha de busca** | Inalterado. |
| **Error — falhas de aplicar (3 etapas)** | Inalterado, inclusive o fluxo de carimbo pendente. |
| **Error — zona C (abaixo da compra no girar)** | §3.3, vermelho, **não bloqueia** o Aplicar (mesma filosofia da AC19). |
| **Sucesso — aplicado** | Toast existente **+ o modo** (§4.2). |
| **Sucesso — gasto lançado (colapsado → dois modos)** | Toast atual + nota cinza persistente sob as colunas:<br>*"Gasto lançado: este carro passou a ter dois preços. O **girar rápido** é o mesmo número de antes — a base dele é a compra, e ela não mudou."* |
| **Sucesso — gasto lançado (já com dois modos)** | Nota cinza (Edge case #5):<br>*"Gasto lançado: o **recuperar tudo** subiu, porque o custo subiu. O **girar rápido** não se moveu — a base dele é a compra."* |
| **Bloqueado (`carro.editavel === false`)** | Campos desabilitados como hoje; **o seletor de modo continua ativo** — comparar é leitura e não grava nada. |

As duas notas de "gasto lançado" vivem até a próxima busca de placa (`useState<boolean>` zerado em `buscar()`).

---

## 7. Componentes

**Reusados sem mudança:** `PrecoCard`, `Linha`, `Campo`, `CampoPreco`, `BlocoCusto`, `CabecalhoCarro`, badge de confiança, `showSuccessToast`/`showErrorToast`, tokens `--brand-*`/`--border-*`/`--text-*`, ícones Lucide já importados.

**Alterados:**

| Componente | Mudança |
|---|---|
| `Aviso` | ganha `tom="neutro"` (borda `--border-base`, fundo `--bg-muted`, texto `--text-body`, ícone `Info`). ⚠️ **Neste tom, `role="alert"` NÃO é aplicado.** Leitor de tela anunciando "alerta" na frase que descreve o modo recria em áudio exatamente o problema que estamos consertando. Usar `role="note"` ou nenhum. |
| `BlocoSugestao` | recebe `recuperar`, `girar: SugestaoPrecoRepasse \| null`, `modo`, `onModo`; renderiza colapsado ou dois modos. |
| `BlocoAplicar` | recebe `modo`; chip do modo; limiar do vermelho por modo; nota da C10. |
| `PrecificarAba` (raiz) | `useState<ModoPreco>(MODO_PADRAO)`; dois cálculos; reset do modo na busca; tira de confirmação. |

**Novos (pequenos, locais ao arquivo):**

| Novo | O que é |
|---|---|
| `ColunaModo` | cabeçalho com rádio + base + linha de amostra + slot de filhos. |
| `naoRecuperado(custoReal, minimo)` | a fórmula da C10. **Um só lugar. Nenhum literal — nem 1.550, nem 1.570, nem 6.850.** |
| `ConfirmarTrocaModo` | a tira inline de §4.1. |

---

## 8. Acessibilidade

- Radiogroup real com rótulo visível; setas navegam entre modos; `focus-visible` de 2px em `--brand-600`.
- Estado de seleção por **rádio + palavra "Selecionado" + borda** — nunca só cor.
- Nota da C10 **não** é `role="alert"` (§7). Vermelho da zona C **é**.
- Contraste AA: textos de razão sobem de 11px pra 12px; `--text-muted` sobre `--bg-muted` já validado na 3.1a; a nota cinza usa `--text-body`, não `--text-subtle`.
- Cada `PrecoCard` da coluna girar precisa de rótulo acessível que **inclua o modo** — `aria-label="Girar rápido — mínimo R$ 85.300"` — senão o leitor de tela lê quatro preços sem saber de qual coluna.
- Tira de confirmação: foco programático no botão primário, Esc cancela.
- **Nada essencial em `title`/tooltip** (regra herdada da 3.1a: não aparece em toque nem em leitor de tela).

## 9. Mobile

- <640px: tudo empilhado, cabeçalho de coluna repete a base em dinheiro.
- Alvos de toque ≥44px em rádio, "Lançar gasto" e botões da tira.
- Inputs de preço seguem `inputMode="decimal"`.
- Sem tabela horizontal, sem scroll lateral.

---

## 10. O que da tela atual atrapalha

1. **`abaixoDoCusto` no `BlocoAplicar` (769–771, 807–815).** Compara com `custoReal` nos dois modos ⇒ vermelho em **todo** carro girado com g > 6,6%. Alerta que toca sempre deixa de ser lido, e apaga a diferença entre escolha e erro. **Conserto: §3.4** (limiar por modo).

2. **Alerta de topo "mínimo gravado abaixo do custo" (`PrecificarAba.tsx:329-334`).** Depois do primeiro carro girado e aplicado, ele acende vermelho **na volta a esse carro, para sempre**, dizendo "vender no mínimo anunciado hoje dá prejuízo" — descrevendo uma decisão consciente como falha. **Isto é a C16 (passo 4), não a C3.** Textos prontos:

   - **Decisão** — último snapshot `girar_rapido` **e** `minimo_aplicado == valor_minimo` atual — `tom="neutro"`:
     > Este carro foi girado sobre a compra em 12/08/2026: R$ 1.550 de gastos não são recuperados no mínimo anunciado. Foi uma decisão, não um erro.

   - **Deriva** — existe snapshot e o `custo_real` dele < o de hoje — **vermelho, texto atual palavra por palavra**.

   - **Fora do sistema** — sem snapshot, ou o aplicado não bate — vermelho, texto atual **+**:
     > Não há registro de decisão de preço para este valor.

   ⚠️ **Se a C16 for cortada do sprint, o defeito aparece no primeiro carro que ele girar.**

3. **Rodapé da régua (697–701)** diz "% do custo" como se houvesse uma base. Substituído (§5).

4. **Cabeçalho do `BlocoAplicar` (778–781)** diz "preenchidos com o sugerido" sem dizer de qual modo. Substituído (§4.2) — a segunda frase, sobre a correção dele ser gravada, **fica intacta**.

5. **Nada mais.** `BlocoCusto`, `CabecalhoCarro`, fluxo de carimbo, deep-link e toasts ficam como estão.

---

## 11. Decisões que não são da `@uma-ux`

- **D-UX1 — confirmação extra ao aplicar no girar:** ✅ **decidida pelo Marcos em 2026-08-12 — NÃO.** Só o chip do modo e o modo no toast. Ver §4.2.
- **D-UX2 — sequenciamento da C16:** ✅ **mantida no mesmo sprint**, como o `@pax-po` já havia fixado. O motivo está em §10.2.

---

## Handoff

- **→ `@dex-dev`:** passo 3 e 4. C3 = colapsar (§1) · C10 = três zonas (§3) · C14/C15/C17 = §2/§4/§5. §3.4 e §10.1 são **alteração de comportamento existente** — parte do escopo desta fatia.
- **→ `@quinn-qa`:** dois pontos de gate que nascem do desenho — (1) carro sem gasto grava `modo = 'recuperar_tudo'` **e é esperado** (§1); (2) o vermelho do `BlocoAplicar` no modo girar tem limiar `valor_compra_repasse`, **não** `custo_real` — um "conserto" que devolva `custo_real` reintroduz o alerta que toca sempre.
- **→ `@aria-architect`:** ciente da consequência de população em §1 (a coorte `girar_rapido` da 030 nasce restrita aos carros com gasto — que é onde o modo tem significado).
