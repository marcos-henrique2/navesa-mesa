# Backlog — Diagnóstico Fase A (tech-debt)

Itens identificados pelo Quinn no QA da Fase A que **não bloqueiam** o release, mas
ficam registrados pra serem endereçados em Fase A.2 ou junto da Fase B.

> Contexto: a Fase A.1 (este ciclo) aplicou 1 HIGH + 3 MEDIUM do Quinn. O que segue
> abaixo é o resto — 1 MEDIUM (cobertura de testes ausente) + 5 LOW.

---

## MEDIUM — não bloqueia, mas precisa entrar antes da Fase B / próximo ciclo

> M2-M3 adicionados pelo Quinn na Fase B (review do `DiagnosticoBlock`).

### M1. Criar `tests/medianas.test.ts` (4+ casos)
Hoje `src/lib/pricing/medianas.ts` tem **zero cobertura de teste**. Casos mínimos:

1. **Match exato:** estoque + vendas com (FORD, RANGER, 2022) ≥ 3 amostras → mediana correta.
2. **Fallback ano ± 1:** lookup pra (FORD, RANGER, 2023) com dados só em 2022 → encontra via delta.
3. **Fallback "qualquer ano do modelo":** lookup pra (FORD, RANGER, 2025) com dados em 2018/2019/2020 → retorna mediana cruzada.
4. **Heurística por idade:** lookup pra modelo sem nenhum dado → retorna `heuristica: true` + km coerente com regra 15k/18k/20k por ano.
5. **(bônus) Janela 24 meses:** vendas antigas (> 24m) são ignoradas no bucket.
6. **(bônus) Min amostras = 3:** bucket com 2 amostras NÃO entra no mapa.

### M2. Acessibilidade do `DiagnosticoBlock` (aria-label / aria-hidden)
Ícones decorativos (`AlertOctagon`, `CheckCircle`, etc.) e CTAs do bloco não têm
tratamento de acessibilidade. **Sugestão:**

- `aria-hidden="true"` nos ícones `lucide-react` quando puramente decorativos
  (label visual ao lado já carrega o texto).
- `aria-label` nos botões "Marcar pra reprecificar" / "Desfazer" / CTA primário
  pra screen reader anunciar a ação completa (ex: "Marcar Renault Sandero 2020
  pra reprecificar").
- Verificar contraste WCAG AA nas variantes `subprecificado_grave` (red-700 em
  red-50) e `repasse` (blue-700 em blue-50).

### M3. Fórmula da faixa `{0.95, 1, 1.05}` pode gerar Mínimo abaixo do custo
Em [`DiagnosticoBlock.tsx:179-186`](../src/components/veiculos/DiagnosticoBlock.tsx#L179):
```ts
minimo: Math.round(alvo * 0.95)
```
Risco: se `precoEsperado` já está apertado (classe D/E), `× 0.95` pode descer
abaixo do custo de aquisição → vendedor toparia preço com prejuízo.

**Sugestão:** considerar `Math.max(alvo * 0.95, custo_minimo)` onde
`custo_minimo = valor_aquisicao × (1 + impostos + comissao_min)`. Pedir parecer
da Aria sobre a regra de negócio (qual % de margem mínima é aceitável?).

---

## LOW — polish, encaixar quando passar perto

> L6-L8 adicionados pelo Quinn na Fase B.

### L1. Mapping `baseClassePct → classe` (em `reprecificacao.ts`)
[`extrairClasseDoDiagnostico`](../src/lib/data/reprecificacao.ts) compara floats com `Math.abs(... ) < 1e-9`.
Funciona hoje porque os pcts são literais constantes, mas fica frágil se alguém mudar pra
valores derivados. **Sugestão:** passar `classe` explicitamente como argumento de `marcarParaReprecificar`
(o call site já tem essa info via `classesPorChassi`).

### L2. Precisão de `desvio_pct_snapshot` (`numeric(6,3)` vs `round4`)
A coluna persiste com 3 casas (`numeric(6,3)`) mas o cálculo arredonda pra 4 (`round4`).
Resultado: a 4ª casa é perdida no DB. **Sugestão:** alterar coluna pra `numeric(7,4)` na migration 003
**ou** mudar `round4 → round3` em `diagnostico.ts`. Coerência > precisão extra.

### L3. Label "+" duplicado em km abaixo da mediana
Em [`diagnostico.ts:240`](../src/lib/pricing/diagnostico.ts#L240):
```ts
label = `KM ${formatPct(Math.abs(desvio))} abaixo da mediana (+${formatPct(kmPct).replace("+", "")})`;
```
Faz `+${formatPct(0.01).replace("+", "")}` → produz `+1.0%`. Funciona, mas é gambiarra de regex.
**Sugestão:** ter uma `formatPctSemSinal()` ou passar opção pro `formatPct`.

### L4. `modelo` vazio em `buscarMedianaKm` cai direto na heurística
[`medianas.ts:95`](../src/lib/pricing/medianas.ts#L95): `if (!modelo) return aplicarHeuristica(veiculo);`
**Sem motivo no log/retorno.** Pra debugging, valeria adicionar um `motivo` ou expor que a heurística
foi forçada por falta de modelo (vs. falta de match).

### L5. Testes faltantes (4+ cases identificados pelo Quinn)
Cobertura atual do `diagnostico.test.ts` está em 14/14 (após Fase A.1). Faltam cenários:

- **Cap superior** (ajuste +2%): conseguir gerar ajusteTotalPct > +2% e validar cap.
  → Hoje só `km_vs_mediana.desvio20Abaixo` é positivo (+1%), não dá pra estourar o teto de +2%.
  Pode virar bug latente quando ajustes positivos novos forem adicionados.
- **Cautelar com_restricao isoladamente** (sem combinar com outros ajustes).
- **Veículo com km=null** + mediana existente → comportamento do ramo `km_vs_mediana`.
- **`precoAtual=null`** → status `sem_dados` (esse caminho está no código mas sem teste explícito).

### L6. `contarPorModelo(veiculos)` chamado 2× por render no detalhe do veículo
Identificado pelo Quinn na review Fase B. Refatorar pra `useContagemPorModelo`
(hook com `useMemo`) — evita reprocessar a lista inteira de veículos a cada
render do detalhe.

### L7. Duplicação `extrairClasseDoDiagnostico` × `inferirClasse`
- [`reprecificacao.ts:173`](../src/lib/data/reprecificacao.ts#L173) tem
  `extrairClasseDoDiagnostico(d)`
- [`DiagnosticoBlock.tsx:691`](../src/components/veiculos/DiagnosticoBlock.tsx#L691)
  tem `inferirClasse(baseClassePct)`

Ambas têm a **mesma `TABELA`** literal e a **mesma lógica** de match por
`Math.abs(... ) < 1e-9`. Extrair pra `@/lib/pricing/classificacao.ts` (já existe
um arquivo de classificação lá).

> Casa com **L1** — se passarmos `classe` como argumento explícito de
> `marcarParaReprecificar`, o `extrairClasseDoDiagnostico` desaparece e só sobra
> o `inferirClasse` do componente.

### L8. `useEffect` no `DiagnosticoBlock` sem timeout em `listarSugestoesPorChassi`
[`DiagnosticoBlock.tsx:205-224`](../src/components/veiculos/DiagnosticoBlock.tsx#L205).
Em offline parcial (Supabase fetch trava por minutos sem rejeitar), o estado
`carregandoMarca` fica `true` indefinidamente e o botão de marcar nunca aparece.

**Sugestão:** envolver com `Promise.race([fetch, timeout(5000)])` e cair pro
estado "não disponível agora" com retry manual.

---

## Fase B.2b — Pós-unificação visual

> Itens identificados durante a implementação da Fase B.2a (unificação `PrecificacaoBlock`).
> Não bloqueiam a B.2a, mas precisam entrar no próximo ciclo de pricing.

### B.2b-F1. Race condition `upsertBatchItem` × `runFipeBatch` (MEDIUM)

Identificado pelo Quinn no review da Fase B.2a.

[`src/lib/fipe/batch.ts`](../src/lib/fipe/batch.ts) — se o usuário clicar em "Re-rodar batch
FIPE" enquanto um override manual está pendente de persistir no Supabase, o `runFipeBatch`
sobrescreve `cached` com o resultado novo (que NÃO inclui o override manual ainda em voo).
Resultado: override pode ser perdido silenciosamente.

**Fix sugerido pelo Quinn:**
- Manter um `Set<string>` de chassis com override manual pendente.
- Em `runFipeBatch`, antes de sobrescrever `cached`, mesclar os items existentes que
  estão no set de override → preservar a escolha manual.
- Limpar o set quando `saveBatchToSupabase` resolver.

Alternativa mais simples: serializar com uma mutex (`Promise` em fila) entre `upsertBatchItem`
e `runFipeBatch`.

### B.2b-F3. Timestamp do override renova TTL do batch inteiro (LOW)

[`src/lib/fipe/batch.ts:276`](../src/lib/fipe/batch.ts#L276) — `upsertBatchItem` atualiza
`cached.timestamp = now`, fazendo o batch inteiro parecer "fresco" mesmo quando os outros
items são de 6 dias atrás. O TTL de 7 dias para de funcionar como esperado.

**Fix sugerido:** Não atualizar `cached.timestamp` no upsert — só o batch inteiro do `runFipeBatch`
deve renovar timestamp. Item override fica como anotação separada (ex: `cached.items[chassi].overridenAt`).

### B.2b-F4. `upsertBatchItems` em bulk (LOW)

[`src/components/veiculos/FipeReviewDrawer.tsx:140-148`](../src/components/veiculos/FipeReviewDrawer.tsx#L140)
— quando `aplicarTodos=true`, hoje cada chassi vira uma chamada `saveBatchToSupabase` separada
(N round-trips). Pra estoques grandes com muitos modelos iguais, fica lento.

**Fix sugerido:** Adicionar `upsertBatchItems(items: BatchFipeItem[]): Promise<{ok: number; fail: number}>`
que faz UM `saveBatchToSupabase` com todos os items + 1 `notify()`.

### B.2b-F6 a F11 (LOW — manter listados)

Itens menores identificados pelo Quinn no review B.2a — detalhamento pendente:

- **F6:** falta `aria-live` polite no banner de erro do `FipeReviewDrawer` (acessibilidade).
- **F7:** `forgetMatch`/`saveMatch` não são `await` (localStorage é síncrono, mas comentário sumiu).
- **F8:** `findModelos(... 5 ...)` hardcoded — extrair como const nomeada `MAX_SUGESTOES_FIPE`.
- **F9:** `saoSimilares` em `FipeReviewDrawer.tsx` duplica lógica do `groupKey` em `batch.ts` —
  consolidar num helper `mesmoGrupoFipe(a, b)`.
- **F10:** copy do alert de falha de Supabase no FipeReviewDrawer poderia ser toast persistente
  (alert blocking não combina com flow de revisão massiva).
- **F11:** `userOverride` em `PrecificacaoBlock` poderia persistir no `sessionStorage` por chassi
  pra sobreviver a re-mount (ex: navegar fora e voltar).

## Concluído na Fase B.2b (implementado)

- **B.2b-1. `diagnostico_v2` — estados PARADO + NEGATIVO** ✓
  Adicionados `DIAGNOSTICO_PARAMS_V2` (com `paradoDiasLimite: 60`) e 2 novos status
  (`parado` + `negativo`). V2 é o default; V1 fica preservado pra compat. Aparência
  + copy + pré-seleção atualizados em `precificacao-copy.ts`. +5 testes.
- **B.2b-2. `preco_alvo_interno`** ✓
  Migration `004_preco_alvo.sql` (tabela dedicada com unique parcial por chassi ativo).
  Data layer `src/lib/data/preco-alvo.ts`. CTA primário virou "Definir preço-alvo R$ X"
  + indicador "✓ Preço-alvo: R$ X (em DD/MM)" + botão Revogar.
- **B.2b-F12. Badge "FIPE local não sincronizado"** ✓
  Set `chassisDirty` em `batch.ts` + hook `useFipeDirty` + badge no header do bloco.
- **B.2b-F13. Copy ramificado do alert FIPE Drawer** ✓
  Diferencia falha total ("Nenhum match foi salvo…") de parcial.
- **B.2b-F14. Feedback visual mobile do chip de estratégia** ✓
  Ring emerald + microcopy "✓ Estratégia escolhida pra esse carro" só mobile
  quando `userOverride=true`.

---

## Backlog — Export Excel

> Itens LOW identificados pelo Quinn no review do `excel-consolidado.ts`. F1 + F5
> foram aplicados nesse ciclo (verdict CONCERNS → PASS pendente re-review). Os
> demais ficam aqui pra serem encaixados quando alguém passar pelo arquivo.

### F2. Extrair `precomputarDiagnostico(input)` (perf ~50%)
[`src/lib/export/excel-consolidado.ts`](../src/lib/export/excel-consolidado.ts)
— `montarResumo` e `montarEstoque` duplicam o mesmo pipeline de
pré-computação (contagem por modelo, classificação, medianas, `fipeRecord`,
`computarDiagnosticoLista`). Pra estoque com 400+ carros, é trabalho dobrado.

**Sugestão:** extrair `precomputarDiagnostico(input): PrecomputedDiag` que retorna
`{ contagem, classesPorChassi, classifsPorChassi, medianas, fipeRecord, diagMap }`
e chamar 1× no topo de `gerarExcelConsolidado`, passando o resultado pras duas
funções. Reduz tempo de geração em ~50%.

### F3. Acessibilidade do botão de export (`aria-busy`, `aria-label`, `role="alert"`)
No componente que chama `gerarExcelConsolidado` (procurar usuários do export):

- `aria-busy={gerando}` no botão enquanto o blob é montado.
- `aria-label` dinâmico — ex: `gerando ? "Gerando relatório Excel…" : "Exportar Excel consolidado"`.
- `role="alert"` + `aria-live="assertive"` no container de erro de export
  pra screen reader anunciar falha imediatamente.

### F4. Filtrar `coerente` / `sem_dados` da tabela "Carros em Atenção"
[`src/lib/export/excel-consolidado.ts:185-199`](../src/lib/export/excel-consolidado.ts#L185)
— a seção chama-se "Carros em Atenção" mas inclui `coerente` (carros ok!) e
`sem_dados` (não tem como diagnosticar). Confunde quem só bate o olho na aba Resumo.

**Sugestão:** ou (a) **filtrar** esses dois da tabela e mover pra um sumário
separado tipo "Carros sem indicação de ação", ou (b) **renomear** a seção pra
"Diagnóstico por Status" (descritivo, não prescritivo).

### F6. Watermark + futuro toggle "anonimizar clientes"
- **Watermark:** topo da aba Resumo com `"Gerado por: <user> em DD/MM/AAAA HH:mm"`.
  Útil pra rastreabilidade quando contador/sócio recebe versões em datas
  diferentes (qual é a mais recente?).
- **Anonimizar clientes (futuro):** flag opcional em `ExportInput` tipo
  `anonimizarClientes?: boolean` — se `true`, na aba Vendas substitui
  `cliente_nome` por hash curto (ex: `Cliente #A4F2`) e zera `cliente_cidade` /
  `cliente_uf` / `cliente_tipo`. Use-case: compartilhar com gestor regional sem
  expor base de clientes da loja.

---

## Notas

- Tudo aqui é **tech-debt da Fase A**, identificado durante o QA. Nada bloqueia o release atual.
- Fase B (UI) começa em paralelo. Esses itens entram numa **Fase A.2 de polish** ou
  são consumidos junto da Fase B quando alguém passar perto do código.
- Reavaliar prioridade quando o Quinn fizer re-review do release real.
