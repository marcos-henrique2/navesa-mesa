# Story 3.1 — Aba `/precificar`: sugerir preço de repasse por placa e avaliar oferta recebida

> Épico 3 — **Precificação assistida de repasse**. Primeira story do épico.
> Depende do núcleo do Épico 1 (margem/semáforo) e dos dados importados do Épico 2 (Ref. AA / FIPE).
>
> **v2 (12/ago/2026)** — revisada após `docs/design/adr-003-persistencia-e-derivacao-da-sugestao-de-preco.md`
> (@aria-architect) e duas decisões do Marcos. Mudou **escopo** (entra a migration do snapshot), a
> **derivação do compre-por**, o **alvo do teto Ref. AA** e a **semântica do import**. Correções
> factuais da v1 aplicadas: Amarok era % da FIPE (não da Ref. AA); "3,85%" era prêmio, não razão;
> `valor_subir` **não** é alternativa de persistência.
>
> **v4 (12/ago/2026)** — **AC16 revisada durante a 3.1a**: o ajuste de km saiu (decisão do
> Marcos, 2026-08-12) por double-count contra a própria régua, medido em placas reais. A régua é
> plana em quilometragem; dias parados e `qtde_anuncios` seguem como ajuste. Ver o bloco sob a
> AC16 e o item aberto em Risk #14. Nenhuma outra AC muda.
>
> **v3 (12/ago/2026)** — 5 fixes de redação do `@pax-po` (GO 8/10, sem revalidação). Explicitada a
> **invariante das AC13–AC15** (referência não entra no preço — era o caminho pelo qual G1-b dispararia
> sem ninguém perceber); seam de parâmetros na AC10 que torna a AC31 testável; **030 é o snapshot,
> 031 é o `COALESCE`**; AC24 e AC20 com as branches que faltavam. **Liberada pro `@dex-dev`.**

## Contexto

Hoje o Marcos digita **Mínimo** e **Compre por** no olho, direto na lista `/repasses`, e o sistema só mostra a margem *depois* que ele já decidiu. Não existe nada que sugira o preço.

A análise de 16 vendas reais (jun–ago/2026) mostrou que o problema **não é o nível da régua**: os carros que venderam no preço pedido e os que precisaram baixar pediram praticamente o mesmo inicial (111% vs 109% do custo real) — quem encalhou até pediu *menos*. O preço certo varia por carro, e errar custa **9,4 pontos de margem** (lucro mediano +14,3% quem vendeu no pedido, +4,9% quem teve que cortar −8,4% mediano em 2 anúncios).

Dois achados fecham o desenho desta aba:

1. **A FIPE não serve de âncora porque ignora km.** O Amarok com 249 mil km fechou a **58,8% da FIPE** — e a **76,0% da Ref. AutoAvaliar**. A Ref. AA erra bem menos, e por isso é a referência primária; a FIPE é o fallback que degrada a confiança da sugestão.
2. **Gastos são o ponto cego**: a plataforma calcula rentabilidade sobre o valor de compra e ignora gastos. Foi isso que exibiu o Frontier PRD1J39 como "0,00%" quando na verdade era **prejuízo de R$ 2.000**.

Todos os carros já são da Navesa e já estão no sistema — logo a entrada é **placa**, não formulário.

**Não existe API do Auto Avaliar** (ROADMAP.md:83). O Marcos lê a sugestão aqui e **digita no portal**. O portal é a fonte da verdade do que está no ar; o valor real volta pelo import. Esse fato governa toda a decisão de persistência (ADR-003 §1).

## User Story

Como **Marcos (gestor de repasse B2B)**, eu quero **digitar a placa e receber um Mínimo e um Compre por sugeridos sobre o custo real do carro — podendo ajustar antes de aplicar — e avaliar na hora qualquer oferta que chegar** para **parar de precificar no olho e não repetir os 9,4 pontos de margem que perco quando erro o preço inicial**.

---

## Régua calibrada (base de todas as constantes)

Sobre `custo_real = valor_compra_repasse + Σ repasse_gastos`:

| Parâmetro | Valor | Origem |
|---|---|---|
| Mínimo que efetivamente vendeu — mediana | **106,6%** | n=16, jun–ago/2026 |
| Banda p25 do **mínimo** | 104,2% | idem |
| Banda p75 do **mínimo** | 110,7% | idem |
| Faixa observada completa do mínimo | 97,2% – 118,1% | idem |
| Mínimo que costuma ser pedido (referência do "olho") | 110,1% | idem |
| **Razão mínimo ÷ compre-por — mediana dos vendidos** | **95,2%** | n=16 (decisão do Marcos, ADR-003 §7.1 opção B) |
| **Piso de aceite** | **0% (nunca abaixo do `custo_real`)** | decisão do Marcos |

### Derivação dos dois preços (ADR-003 §4)

As duas grandezas são de **eixos diferentes** e por isso têm âncoras próprias:

- **p25–p75 é dispersão do mínimo *entre carros*.** É banda do mínimo — não é a faixa entre mínimo e compre-por.
- **A razão mínimo÷compre-por é distância *dentro do mesmo carro*.**

Usar o p75 do primeiro como valor do segundo era coincidência numérica com aparência de rigor. O comentário no código é instrução de recalibração: se disser "compre-por = p75", quem recalibrar daqui a 40 vendas recomputa o percentil errado.

```
REGUA_MINIMO_PCT              = 1.066   // mediana do MÍNIMO que vendeu (n=16)
RAZAO_MINIMO_SOBRE_COMPRE_POR = 0.952   // mediana de (mínimo ÷ compre-por) nos vendidos (n=16)
REGUA_COMPRE_POR_PCT          = REGUA_MINIMO_PCT / RAZAO_MINIMO_SOBRE_COMPRE_POR  // ≈ 1.120
```

**Termos, para não trocar um pelo outro:** a **razão** mínimo÷compre-por é 95,2%. O **prêmio** do compre-por sobre o mínimo é `1/0,952 − 1 ≈ 5,0%`. O código parametriza a **razão**.

**Incerteza registrada:** 95,2% é o *hábito* do Marcos, não uma otimização — os dois números da amostra foram escolhidos no olho, e a diferença vendidos (95,2%) × encalhados (97,1%) é de 1,9 ponto, alavanca fraca. Entra como parâmetro nomeado e ajustável, nunca como achado. O raciocínio do Marcos para escolher o observado em vez de um spread menor: **se errar, errar pra cima é mais barato** — compre-por alto só deixa de fechar a compra direta na hora, não derruba o leilão de 24h.

---

## Acceptance Criteria

### A. Entrada por placa

1. **AC1** — GIVEN a aba `/precificar` aberta WHEN digito uma placa (com ou sem hífen, maiúscula ou minúscula) e confirmo THEN o sistema resolve o carro usando `placaCasa` (`@/lib/utils/placa`) e carrega **sem nenhum outro campo obrigatório**: modelo, marca, ano fab/mod, km, status, dias em repasse, `valor_compra_repasse`, Σ gastos, Ref. AA (`valor_auto_avaliar`), FIPE (`valor_fipe`), `valor_maior_oferta` e `qtde_anuncios`.
2. **AC2** — GIVEN uma placa que não existe em `repasses` WHEN busco THEN vejo estado vazio em pt-BR ("Placa não encontrada nos repasses") sem sugestão, sem erro técnico e sem crash — e, se a placa existir em `veiculos` (estoque, ainda não marcada pra repasse), a mensagem diz isso e oferece o caminho de marcar o carro.
3. **AC3** — GIVEN uma placa com mais de um registro em `repasses` (carro repassado em ciclos diferentes) WHEN busco THEN o sistema usa o **mais recente com status ≠ `cancelado`** e sinaliza na tela qual ciclo está sendo precificado. A identidade do repasse é por **ciclo** (`repasse_id`), nunca por chassi.
4. **AC4** — GIVEN um carro com status `vendido` ou `cancelado` WHEN busco THEN a tela abre em **modo consulta**: mostra os números, mas o botão de aplicar preço fica desabilitado com o motivo visível.

### B. Custo real e gastos (o ponto cego)

5. **AC5** — GIVEN um carro carregado WHEN o custo é calculado THEN vem de `calcularCustoReal(valor_compra_repasse, gastos)` de `@/lib/repasses/margem-repasse` — **nunca** de `valor_aquisicao` (REGRA DE OURO do módulo: `valor_aquisicao` é custo de varejo e acende vermelhos falsos no repasse).
6. **AC6** — GIVEN um carro com `valor_compra_repasse` nulo WHEN abro a tela THEN **nenhuma sugestão é produzida**, a cor é `neutro` ("Dados incompletos") e a UI explica que falta o R$ Compra do Auto Avaliar — sem fallback pra `valor_aquisicao` em nenhuma hipótese.
7. **AC7** — GIVEN um carro sem gastos lançados (caso majoritário) WHEN precifico THEN o cálculo roda normalmente e a UI rotula explicitamente "Sem gastos lançados" — ausência de gasto não é erro nem bloqueio.
8. **AC8** — GIVEN um carro **com** gastos WHEN vejo o resultado THEN o custo aparece decomposto (`R$ Compra` + `Σ gastos` = `custo real`), com os gastos listados, de forma que o caso Frontier PRD1J39 não possa mais ser lido como "0,00%".
9. **AC9** — GIVEN a tela de um carro WHEN lanço um gasto ali mesmo (valor + descrição, campo **opcional**) THEN ele é gravado em `repasse_gastos` e a sugestão recalcula na hora.

### C. Motor de sugestão

10. **AC10** — GIVEN o módulo do motor (`src/lib/pricing/sugerir-preco-repasse.ts`, novo) WHEN leio o topo do arquivo THEN todos os parâmetros são **constantes nomeadas e ajustáveis**, com `REGUA_COMPRE_POR_PCT` **derivado** de `REGUA_MINIMO_PCT / RAZAO_MINIMO_SOBRE_COMPRE_POR` (não hard-coded), e o comentário registra **a âncora de cada constante separadamente**:
    - `REGUA_MINIMO_PCT` = mediana do **mínimo que vendeu**, n=16 jun–ago/2026;
    - `RAZAO_MINIMO_SOBRE_COMPRE_POR` = mediana de **mínimo ÷ compre-por** nos mesmos vendidos;
    - e a instrução de recalibração conforme entram novas vendas.
    **O comentário não pode dizer "compre-por = p75"** — a p25–p75 mede outra grandeza (ADR-003 §4).
    As constantes são agrupadas num **objeto exportado** (`REGUA_PADRAO`) e a função aceita override opcional — `sugerirPrecoRepasse(entrada, params = REGUA_PADRAO)`. Não é conveniência de teste: a migration 030 exige `parametros_regua JSONB NOT NULL`, ou seja, **os valores vigentes precisam ser serializáveis** pra ir no snapshot (AC22). O mesmo objeto serve de seam pros testes da AC31.
11. **AC11** — GIVEN um carro com `custo_real` válido WHEN o motor roda THEN devolve `minimoSugerido = custo_real × REGUA_MINIMO_PCT` e `comprePorSugerido = custo_real × REGUA_COMPRE_POR_PCT`, e a UI exibe a faixa p25–p75 **rotulada como "banda do mínimo entre os carros que venderam"** — nunca apresentada como a faixa entre os dois preços sugeridos.
12. **AC12** — GIVEN qualquer combinação de ajustes que jogaria a sugestão **abaixo do `custo_real`** WHEN o motor calcula THEN o valor **trava em `custo_real`** (piso de aceite 0%) e um alerta explícito aparece ("Sugestão bateu no piso de custo — não há espaço pra desconto"). **Pós-condição, avaliada depois do clamp:** `compre_por ≥ mínimo ≥ custo_real`. As constantes são editáveis à mão e uma edição desatenta produziria um par invertido que a UI mostraria sem reclamar — a invariante é guarda + teste, não bloqueio de fluxo.
> **Invariante das AC13–AC15 — a referência NUNCA entra no preço.** Os dois preços saem
> exclusivamente de `custo_real × régua` (AC11). Ref. AA e FIPE determinam **apenas** o nível de
> `confianca` e o alerta de teto — nunca o valor. ADR-003 §5: *"Ref. AA informa; custo manda."*
> Isso não é estilo: se a referência passar a ter efeito **numérico**, o gatilho **G1-b** dispara e
> a migration 031 (`COALESCE` nos writes da 028) vira **bloqueante retroativamente** (ADR-003 §6 e
> §10-T3). Qualquer leitura das ACs abaixo que faça a referência mexer no número está errada.

13. **AC13** — GIVEN um carro **com** Ref. AA WHEN o motor calcula THEN `confianca = "alta"` e, se o **`minimoSugerido`** passar de `TETO_REF_AA_PCT` da Ref. AA, um alerta é emitido:
    - o teto aplica-se **ao mínimo, não ao compre-por** — o compre-por *deve* ficar acima da referência (é prêmio por encerrar o anúncio na hora); alertar ali seria ruído recorrente, e alerta que toca sempre é alerta que ninguém lê;
    - **alerta, jamais trava** — o Amarok fechou a 76,0% da Ref. AA e a régua sobre custo o teria precificado bem; referência informa, custo manda;
    - **não existe alerta de piso** ("muito abaixo da referência") — o Amarok é justamente o caso em que ficar bem abaixo estava certo;
    - `TETO_REF_AA_PCT = 1.05` marcado no código como **heurística NÃO calibrada**, no mesmo tom de `DEPRECIACAO_MENSAL_PCT`, com o motivo registrado: a razão `minimo_que_vendeu ÷ Ref.AA` só tem **n=4** (mediana 87,7%, faixa 76,0–97,8%), porque os vendidos saem do relatório de ofertas.
14. **AC14** — GIVEN um carro **sem** Ref. AA (campo vem de relatório importado e pode faltar) WHEN o motor calcula THEN **os dois preços continuam saindo de `custo_real × régua`, inalterados**, e o que muda é só a referência do alerta: passa a usar a **FIPE ajustada por km como referência do alerta de teto**, marca `confianca = "baixa"` e emite alerta em pt-BR avisando que a FIPE ignora quilometragem (o Amarok fechou a 58,8% dela).
15. **AC15** — GIVEN um carro sem Ref. AA **e** sem FIPE WHEN o motor calcula THEN **não há referência para alerta** — nenhum alerta de teto é emitido —, a régua sobre o custo é **a mesma dos demais casos** (o preço não muda por faltar referência), `confianca = "muito_baixa"` e alerta correspondente informando que não há referência de mercado pra checar a sugestão.
16. **AC16** *(revisada em 2026-08-12 — ver bloco abaixo)* — GIVEN um carro parado há muitos dias (`calcularDiasNoRepasse`) ou com `qtde_anuncios` > 1 WHEN o motor calcula THEN aplica ajustes **limitados por constantes nomeadas** (teto por ajuste + teto explícito da soma) e cada ajuste aplicado gera uma linha na `justificativa` dizendo quanto mexeu e por quê. **A régua é PLANA em quilometragem: km NÃO gera ajuste de preço.**

> **Remoção do ajuste de km — decisão do Marcos, 2026-08-12.** A v3 desta AC pedia
> ajuste por "km alto vs. o ano". Ele foi implementado, medido contra placas reais e
> **removido**.
>
> **Por quê:** cobrava **duas vezes pelo mesmo sinal**. `REGUA_MINIMO_PCT` (106,6%) é a
> mediana do mínimo que vendeu numa amostra que **já é** desta frota de picape rodada —
> descontar km por cima dessa mediana subestima sistematicamente.
>
> **A medição que fechou a decisão** (3 placas reais, PRD2189 / QEZ8J18 / TIU1F38): o
> ajuste mordia em **todas** e derrubava o mínimo de 106,6% para ~103–105% do custo,
> **abaixo do que o Marcos tinha pedido nos três carros**.
>
> **Reintroduzir exige recalibrar a base junto.** Com n=16 não dá pra separar o efeito
> do km do efeito geral. Ou a referência de km/ano vira a mediana observada da própria
> frota — e aí `REGUA_MINIMO_PCT` tem que ser recomputado sobre o resíduo —, ou o ajuste
> não entra. Uma coisa não vem sem a outra.
>
> **km continua sendo lido**, só que fora do preço: alimenta a FIPE ajustada por km, que
> é a **referência do alerta de teto** quando falta Ref. AA (AC14). Isso não conflita com
> a invariante das AC13–AC15 — referência não é preço.
>
> Trava contra regressão: `tests/precificar-repasse.test.ts`, bloco *"a régua é PLANA em
> quilometragem"* — dois carros idênticos com km muito diferente têm que receber o mesmo
> preço.
17. **AC17** — GIVEN qualquer sugestão produzida WHEN vejo o resultado THEN vem acompanhada de `justificativa` (texto curto em pt-BR) e `alertas: string[]` — mesmo contrato de saída de `@/lib/pricing/suggest.ts`, que serve de **referência de estilo** (constantes no topo, bandas, justificativa, alertas) e **não** deve ser reaproveitado como implementação, já que mira varejo e só aceita `VeiculoParsed` do NBS.
18. **AC18** — GIVEN a sugestão exibida WHEN olho os números THEN os preços são arredondados pra múltiplo de R$ 100 **na apresentação**, e o valor efetivamente gravado no banco é centavo-perfect (`numeric(12,2)`), sem drift de ponto flutuante.

### D. Aplicar: editar, gravar o operacional e capturar a decisão

19. **AC19** — GIVEN uma sugestão na tela de um carro editável WHEN vou aplicar THEN os dois campos vêm **preenchidos com o sugerido e são editáveis** — posso ajustar qualquer um dos dois antes de confirmar. A UI mostra a diferença entre o sugerido e o que eu digitei. **Editar abaixo do `custo_real` é permitido**, com aviso em vermelho: o piso de 0% é regra do **motor** ("nunca *sugerir* abaixo do custo", AC12), não do que o Marcos pode decidir — e a migration 030 deliberadamente não recusa. O snapshot grava a edição sem reclamar; é justamente esse tipo de correção que a AC21 existe pra capturar.
20. **AC20** — GIVEN que confirmo "Aplicar no repasse" WHEN a gravação roda THEN a ordem é **snapshot → `UPDATE` dos dois campos → carimbo do aplicado no snapshot**:
    - o **snapshot** é uma linha nova em `repasse_precificacao_sugerida` (tabela append-only da **migration 030**, já escrita pela `@dara-data-engineer`; forma dos dados na §3 do ADR-003);
    - depois `valor_minimo` e `valor_compre_por` do repasse são gravados — é o que faz margem e semáforo funcionarem antes do import chegar;
    As três falhas possíveis têm comportamento definido:
    - **snapshot falha** ⇒ aborta tudo com erro visível em pt-BR e **nada é gravado** (um usuário, um clique, retry grátis — consistência vale mais que disponibilidade neste volume);
    - **`UPDATE` falha depois do snapshot** ⇒ sobra uma linha "sugerida e não aplicada" — **isso é sinal, não lixo**, e não deve ser limpo. Rollback do estado otimista com mensagem (mesmo padrão do inline edit do `/repasses`);
    - **`UPDATE` sucede e o carimbo falha** ⇒ estado pior dos três: `repasses` fica com os valores aplicados e o snapshot **mente** dizendo "não aplicou" (`aplicado_em` NULL). A UI **oferece retry do carimbo** com o estado explicado em pt-BR. O retry é seguro: `trg_rep_prec_append_only` permite a transição `NULL → valor` **uma vez** — recarimbar a mesma linha funciona; uma segunda vez estoura com erro do trigger. Se o retry falhar de novo, avisa e para (não gerar linha nova, que duplicaria a decisão).
21. **AC21** — GIVEN que editei o valor sugerido antes de aplicar WHEN o snapshot é gravado THEN ele guarda **os dois pares**: o que o motor sugeriu e o que eu de fato apliquei. A diferença entre eles é **a correção do Marcos** — o rótulo mais valioso do conjunto de recalibração, porque mostra onde a régua erra e em que direção. Aplicar sem editar grava sugerido == aplicado (que também é informação: a régua foi aceita como veio).
22. **AC22** — GIVEN que `custo_real` **muda depois** (gastos entram tarde via AC9, e o import por texto faz `DELETE` incondicional dos gastos `tipo='auto_avaliar'`) WHEN o snapshot é gravado THEN ele registra o **contexto do momento**, porque ele é irrecuperável seis meses depois: `custo_real` e sua decomposição (`valor_compra_repasse` + `gastos_total`), `valor_auto_avaliar` e `valor_fipe` como estavam, km, dias no repasse, `qtde_anuncios`, as **razões efetivas** aplicadas (`minimo_razao_efetiva` / `compre_por_razao_efetiva`, após ajustes e após o piso — vocabulário da migration 030, que nomeia `_razao_` de propósito pra evitar a confusão razão × prêmio da ADR-003 §8), flag de "bateu no piso", nível de confiança, `justificativa` e `alertas`, os `parametros_regua` vigentes (AC10) e a **versão nomeada da régua** (string livre — **não** reusar o CHECK `diagnostico_v[N]` da migration 003).
23. **AC23** — GIVEN que o import do Auto Avaliar governa `valor_minimo`/`valor_compre_por` WHEN aplico uma sugestão THEN a UI avisa em pt-BR que **o valor gravado é a intenção e vai convergir pro real**: "esse valor é sua intenção; quando o carro subir e o relatório for importado, ele passa a refletir o que está no ar". O import **não apaga** a sugestão — ele substitui a intenção pelo fato (o preço que o Marcos digitou no portal depois de ler a sugestão). O que se perde é a **procedência**, e é justamente isso que o snapshot preserva.
24. **AC24** — GIVEN que aplico valores **idênticos** aos já gravados no repasse WHEN confirmo THEN o app **compara e pula o `UPDATE`** (não manda a escrita; não é "manda e aceita") — mas o snapshot é gravado **e carimbado normalmente**, com `minimo_aplicado`/`compre_por_aplicado`/`aplicado_em` preenchidos. **Não carimbar seria um bug de dado**: os três NULL significam, pela constraint `rep_prec_carimbo_coerente_chk`, *"sugeriu e não aplicou"* — uma decisão legitimamente aplicada viraria indistinguível de uma aplicação falhada, corrompendo justamente o rótulo que a tabela existe pra capturar. O evento é a decisão, não a mudança de valor.

### E. Avaliar oferta recebida

25. **AC25** — GIVEN um carro carregado e uma oferta digitada WHEN informo o valor THEN vejo margem em R$, margem em % sobre `custo_real` e a **cor canônica do semáforo** vinda de `simularLance` / `classificarMargem` de `@/lib/repasses/margem-repasse` — nenhuma regra de cor nova é escrita nesta story.
26. **AC26** — GIVEN uma oferta 0, negativa ou não-numérica WHEN digito THEN não há cálculo e aparece a mensagem já definida em `simularLance` ("Informe uma oferta válida (maior que zero)").
27. **AC27** — GIVEN uma oferta abaixo do mínimo WHEN avalio THEN vejo o **custo de recusar**: depreciação estimada no período (constante nomeada `DEPRECIACAO_MENSAL_PCT`, marcada como heurística **não calibrada**), dias já parados e nº de anúncios (`qtde_anuncios`) — pra comparar "aceitar agora" contra "esperar mais um ciclo".
28. **AC28** — GIVEN um carro com dados incompletos (custo/mínimo/compre-por nulos) WHEN digito uma oferta THEN cor `neutro` e "Dados incompletos — margem indisponível", nunca um número inventado.

### F. Navegação

29. **AC29** — GIVEN o app rodando WHEN olho a navegação lateral THEN existe o item **"Precificar"** no array `NAV` do `AppShell.tsx`, posicionado logo abaixo de "Repasses", com `match: (p) => p.startsWith("/precificar")`.
30. **AC30** — GIVEN uma linha do `/repasses` WHEN aciono "Precificar" naquele carro THEN vou pra `/precificar?placa=XXX0000` com o carro já carregado; e depois de aplicar o preço, volto pro `/repasses` com o valor refletido.

### G. Qualidade

31. **AC31** — GIVEN a suíte de testes WHEN rodo `node --import tsx --test tests/*.test.ts` THEN existe `tests/precificar-repasse.test.ts` cobrindo, sobre **funções puras**:
    - régua: mínimo pela mediana e **compre-por derivado da razão** — o teste falha se alguém hard-codar `1.120`, porque a derivação dá `1,1197478…`;
    - trava no piso de custo;
    - **invariante `compre_por ≥ mínimo ≥ custo_real`** depois do clamp, exercitada via o **override de parâmetros da AC10** (`sugerirPrecoRepasse(entrada, { ...REGUA_PADRAO, RAZAO_MINIMO_SOBRE_COMPRE_POR: 1.2 })` produz par invertido se a guarda não existir). Constante de módulo não é adulterável a partir do teste — sem esse seam a invariante não é testável;
    - fallback Ref. AA → FIPE → sem referência, com os três níveis de confiança **e a asserção de que os dois preços não mudam entre os três casos** (invariante das AC13–AC15: referência não entra no preço);
    - teto Ref. AA aplicado **ao mínimo** e nunca ao compre-por; e que ele alerta sem alterar o número;
    - `custo_real` com e sem gastos; `custo_real` nulo → sem sugestão; `custo_real == 0` → sem sugestão;
    - **montagem do objeto de snapshot como função pura** — montável e testável sem banco, incluindo o par sugerido × aplicado quando houve edição.
    Zero `any`, imports `@/`, tudo verde junto com a suíte existente.

---

## Scope

**IN**
- Rota `/precificar` (client-side, padrão das demais páginas) + item no `NAV` do `AppShell`.
- Motor puro novo: `src/lib/pricing/sugerir-preco-repasse.ts` (régua + ajustes + fallbacks + invariante + justificativa/alertas).
- **Migration 030** — `repasse_precificacao_sugerida` (append-only, FK pra `repasses(id)` com cascade). **DDL já escrito pela `@dara-data-engineer`** (`supabase/migrations/030_repasse_precificacao_sugerida.sql`); o dev consome, não redesenha. Forma dos dados na ADR-003 §3.
- Módulo de escrita do snapshot + montagem do objeto como função pura testável.
- Query de carregamento por placa: `src/lib/repasses/precificar-queries.ts` (repasse + gastos + referências, no molde de `getDadosMargemRepasse`).
- Gravação de `valor_minimo` / `valor_compre_por` (função nova — `updateRepasseCampos` **não** cobre esses campos hoje, só os 6 manuais do Caminho B: `ipva_status`, `ipva_responsavel`, `documentacao_status`, `cautelar_status_manual`, `valor_subir`, `observacoes`).
- Campos editáveis antes de aplicar, com captura da correção no snapshot.
- Lançamento opcional de gasto em `repasse_gastos` a partir da aba.
- Metade 2 (avaliar oferta) plugando `simularLance` + bloco de custo de recusar.
- Testes puros do motor e da montagem do snapshot.

**OUT** (explicitamente fora desta story)
- **Tela de histórico de sugestões.** A tabela nasce **write-only** — entra *captura*, não *feature*. O read é story futura, quando houver n suficiente pra recalibrar.
- Comparação "sugerido vs. praticado" e recalibração automática da régua — nesta story os números são **constantes editáveis à mão**.
- Coluna de procedência por campo (`fonte_valor_minimo` e similares) — ADR-002 §4.5 rejeitou, ADR-003 §3 manteve rejeitado: com o snapshot, "esse `valor_minimo` ainda é intenção?" é derivável.
- **Migration 031** (`COALESCE` nos writes da 028) — G1 da ADR-002 está **acionado e registrado**, mas **não bloqueia** esta story (ver Dependências). *A 030 é a do snapshot, que está **dentro** do escopo.*
- Qualquer alteração nas regras de cor do semáforo ou em `margem-repasse.ts` (só consumo).
- Reescrita ou generalização de `@/lib/pricing/suggest.ts` (varejo) — fica como está.
- Sugestão em lote / precificar vários carros de uma vez.
- Integração com API do Auto Avaliar (empurrar preço pro portal) — continua manual.
- Precificação de varejo/showroom, e a política de classes A–E.

**Descartado, não é alternativa** — gravar a sugestão em `valor_subir`. O campo **não está livre**: tem quatro consumidores vivos (`calcularBonus()` em `src/lib/repasses/bonus.ts:13-16`; KPI `calcularValorPraSubir()` em `src/lib/repasses/kpis.ts:18-30`; coluna "Valor pra subir" do XLSX em `src/lib/export/relatorio-repasse-xlsx.ts`; inline edit do `/repasses`). Gravar sugestão ali corromperia Bônus, KPI e relatório **em silêncio** — nada erra, os números só ficam errados. A migration 023 já rejeitou explicitamente reusar o campo. Registrado aqui para que ninguém reabra por parecer mais barato.

## Dependências

- **ADR:** `docs/design/adr-003-persistencia-e-derivacao-da-sugestao-de-preco.md` (persistência, derivação, teto). Estende a ADR-002, não supersede.
- **Bloqueante — `@dara-data-engineer`:** DDL da tabela `repasse_precificacao_sugerida` (acionada em paralelo). Sem ela, AC20/AC21/AC22 não implementam.
- **Bloqueante — `@pax-po`:** a story **mudou de escopo** (migration nova entrou no IN), então precisa revalidar antes do dev.
- **Não bloqueante — `@alex-analyst`:** distribuição de `minimo_que_vendeu ÷ valor_auto_avaliar` nos 16 vendidos (p50/p75/p90 + quantos têm Ref. AA preenchida), pra calibrar `TETO_REF_AA_PCT`. Hoje **n=4** — é a amostra que existe, então o retorno provável do Alex é *"insuficiente pra calibrar"*, e isso é resposta válida. O gate está no DoD: revisar com o retorno dele **ou** registrar no código que segue não calibrado e **sem efeito numérico**. Trocar a constante é uma linha.
- **Stories:** Épico 1 (1.1 valores de repasse, 1.2/1.3 margem, semáforo e simulador — `margem-repasse.ts`); Story 2.2 / migrations 025, 028 e 029 (origem de `valor_auto_avaliar`, `valor_fipe`, `valor_maior_oferta`, `qtde_anuncios`).
- **Gatilho G1 da ADR-002 — acionado e registrado.** AC1 lê `valor_auto_avaliar`/`valor_fipe` e AC13/AC14 os tornam insumo de **confiança e alerta**. A **migration 031** (`COALESCE` nos writes da 028) sai do backlog para "próxima story" mas **não bloqueia a 3.1**: o dano do write destrutivo da 028 é `NULL` → `confianca` cai → **alerta visível em pt-BR** (AC14/AC15), ou seja, degradação anunciada, não decisão errada em silêncio. Vira bloqueante se **G1-a** (medir que a colagem de texto vem sem `media_aa` com frequência relevante) ou **G1-b** (Ref. AA passar a ter efeito **numérico** na sugestão — o que a invariante das AC13–AC15 proíbe nesta story).
- **Código a reaproveitar (não reescrever):** `@/lib/repasses/margem-repasse` (`calcularCustoReal`, `classificarMargem`, `simularLance`, `calcularDiasNoRepasse`), `@/lib/repasses/queries` (`listGastosPorRepasse`), `@/lib/repasses/anuncio-queries` (`getDadosMargemRepasse` como molde), `@/lib/utils/placa` (`placaCasa`), `@/lib/utils/data-local` (`hojeLocal`), `@/lib/fipe/*`, `@/lib/parsers/auto-avaliar-ofertas-xls`. Padrão de snapshot já vivo na casa: `reprecificacao_sugerida` (migration 003) + `src/lib/data/reprecificacao.ts` — **molde, não tabela a reusar** (o CHECK `^diagnostico_v[0-9]+$`, o índice único por `chassi` e o preço único impedem).
- **Decisões fechadas** (não reabrir sem novo ADR): razão mínimo÷compre-por = 95,2%; sugestão editável antes de aplicar; piso de aceite 0%; `valor_minimo`/`valor_compre_por` seguem governados pelo portal.

## Risk / Edge cases

1. **Régua calibrada em n=16.** Amostra pequena, janela de 3 meses. Mitigação: constantes nomeadas + comentário de recalibração + `confianca` visível + snapshot que torna a recalibração possível. Risco real de a sugestão parecer mais científica do que é — a UI **não** pode apresentar o número como verdade fechada, e ele é editável (AC19) justamente por isso.
2. **A janela entre aplicar e importar: `valor_minimo` guarda intenção e é lido como fato.** O import **não apaga a sugestão — converge pro real**, gravando o preço que está de fato no ar. Mas o comportamento difere por caminho: o **texto** (`028:257`) escreve incondicional e **`NULL`a o campo se ele estiver ausente na colagem**; o **arquivo** (`029:532`) usa `COALESCE` e **preserva** o que já havia. Nesse intervalo, `MarcarVendidoModal` e os KPIs leem uma intenção como fato. Aceito (ADR-003 §9.3) porque não gravar deixaria a lista cega até o import, e o aviso da AC23 cobre a semântica pro único usuário. Se um dia gerar decisão errada de verdade, a saída **não** é coluna de procedência — é derivar o estado comparando o snapshot mais recente com a data do último import.
3. **O dado de recalibração é irrecuperável se não for capturado na hora.** `custo_real` muda depois (gastos tardios; `DELETE` incondicional dos gastos `auto_avaliar` no caminho de texto). Sem o snapshot no instante da decisão, ninguém consegue responder seis meses depois "a sugestão acertou?". É a razão de a tabela existir mesmo nascendo sem leitor.
4. **Carro sem `valor_compra_repasse`.** Tentação de cair pra `valor_aquisicao` pra "não deixar a tela vazia". É exatamente o bug que a REGRA DE OURO proíbe. Estado neutro é o comportamento correto (AC6).
5. **Placa duplicada em `repasses`** (carro que voltou pro repasse num segundo ciclo) — AC3. Justo os carros com `qtde_anuncios > 1` são os que mais ensinam, e são os que teriam mais de uma sugestão: por isso a tabela é append-only e não coluna em `repasses`.
6. **`custo_real == 0`** (compra lançada como zero): `calcularMargemPct` já devolve `null` por div/0; a régua daria R$ 0 — guarda própria e mensagem, nunca sugerir zero.
7. **Ref. AA desatualizada** — vem de arquivo importado em alguma data. Carro parado há muito tempo pode ter referência velha; exibir a data da última importação junto do valor.
8. **Gasto lançado depois de aplicar o preço:** o custo sobe e o mínimo gravado pode virar prejuízo silencioso. Ao carregar um carro cujo `valor_minimo` gravado está **abaixo do `custo_real` atual**, mostrar em vermelho já na abertura.
9. **Constantes editáveis à mão + par invertido.** Uma edição desatenta de `RAZAO_MINIMO_SOBRE_COMPRE_POR` produz `compre_por < mínimo` e a UI mostraria sem reclamar. Coberto pela invariante da AC12 + teste da AC31.
10. **Drift de centavo** em multiplicação por percentual (`custo × 1.066`) — arredondar com o mesmo critério do módulo (`Math.round((v + EPSILON) * 100) / 100`); divergência R$ 0,01+ é bug crítico no projeto.
11. **`TETO_REF_AA_PCT` vai pra produção sem calibração.** Aceitável **só enquanto ele apenas alerta** — a pior falha é um aviso a mais ou a menos, nunca um preço diferente. Deixa de ser aceitável no instante em que a Ref. AA mexer no número (G1-b).
12. **Depreciação mensal do "custo de recusar" é chute** — não saiu da análise. Rotulada como estimativa, nunca número duro.
13. **Marcos ignorar a sugestão.** Se a tela só mostrar um número sem o porquê, ele volta a digitar no olho. A `justificativa` não é enfeite — é o que faz a aba ser usada. E "ignorar" sem aplicar **não deixa rastro**: só o clique de aplicar vira snapshot.
14. **Os dois ajustes que sobraram (dias parados e `qtde_anuncios`) seguem NÃO calibrados — decisão pendente do Marcos.** Depois de remover o km, medi os dois contra a frota ativa real (59 carros com custo e mínimo preenchidos, 2026-08-12):

    | | n | Marcos pede (mediana `mínimo ÷ custo`) | Régua plana | Régua c/ ajuste de dias |
    |---|---|---|---|---|
    | Até 30 dias | 38 | **1,0716** | 1,066 | 1,066 (não dispara) |
    | Parado > 30 dias | 21 | **1,0513** | 1,066 | ~1,058 (média do grupo) |

    - **Dias parados: o ajuste tem suporte empírico e é conservador.** O próprio Marcos já pede **2,0 pontos a menos** nos carros parados (1,0716 → 1,0513). O ajuste do motor tira em média **0,77 pt** no grupo afetado (teto 3 pt) — ou seja, ele **corrige cerca de metade** do que o Marcos já faz à mão, e na direção certa. É o oposto do caso do km. Sobre a frota inteira o ajuste tira em média R$ 1.263 dos 21 carros afetados; o delta médio da sugestão contra o pedido vai de **+R$ 214 (plana)** para **−R$ 235 (com dias)**.
    - **Contra-argumento a considerar:** `REGUA_MINIMO_PCT` é a mediana do mínimo que **vendeu** — população que por definição girou rápido —, então o sinal "está parado" pode ser informação genuinamente nova, e não algo que a mediana já absorveu. A assimetria: km é **característica** do carro; dias e reanúncio são **estado**.
    - **`qtde_anuncios`: não é mensurável hoje.** Os **59/59** carros ativos estão com o campo `NULL` — o ajuste de reanúncio **nunca dispara** na frota atual. O campo só se popula pelo import do arquivo (migration 029). Enquanto estiver assim, ele é código sem efeito: não faz mal, mas também não foi validado contra nada.

    **Decisão do Marcos, não do dev.** As duas opções são "manter como está" (a plana já fica praticamente centrada no hábito dele, +R$ 214 de delta médio) ou "manter o ajuste de dias" (aproxima do comportamento dele nos parados, ao custo de sair do centro na frota toda).

## Complexity (T-shirt)

**L** — motor puro novo com régua de duas âncoras, três níveis de fallback, invariante de ordenação e ajustes limitados; migration + tabela de snapshot + módulo de escrita em duas etapas com regra de falha parcial; página com duas metades; gravação com estado otimista e valores editáveis; suíte de testes. Toda a matemática de margem/cor já existe e é só consumida.

Se precisar caber em menos, fatiar em:
- **3.1a (L−)** — motor + placa → sugestão editável → aplicar (inclui **migration e snapshot**, que são inseparáveis do clique de aplicar: o dado é irrecuperável se a captura ficar pra depois). Entrega valor sozinha. *Se a story inteira é L e a 3.1b é S, a 3.1a é `L − S` — não é uma sessão de trabalho.*
- **3.1b (S)** — metade 2: avaliar oferta + custo de recusar.

**Se precisar encolher, o corte barato não é o snapshot** (dado irrecuperável — ADR-003 §2.3). São **AC9** (lançar gasto pela própria aba — dá pra lançar pelo `/repasses` como hoje) e **AC30** (deep-link `/repasses` → `/precificar?placa=` e volta — dá pra digitar a placa). Ambas são conveniência e nenhuma carrega dado que se perca.

## Definition of Done

- [ ] Código + tests passing (`node --import tsx --test tests/*.test.ts`, suíte existente 100% verde)
- [ ] Typecheck (`tsc`) + lint clean, zero `any`, imports `@/`
- [ ] Migration idempotente, no padrão do `supabase/migrations/`, revisada pela `@dara-data-engineer`
- [ ] Testado no ambiente local com pelo menos 3 placas reais: uma completa, uma sem gastos, uma sem Ref. AA
- [ ] Aplicar com edição do valor testado ponta a ponta: snapshot grava sugerido **e** aplicado, e a diferença é recuperável em query
- [ ] Falha de snapshot testada: aborta com erro visível e **não** grava `valor_minimo`/`valor_compre_por`
- [ ] Falha de carimbo testada: retry recarimba a mesma linha; segunda tentativa de recarimbar estoura no trigger (comportamento esperado, não bug)
- [ ] **Contrato centavo-perfect com a migration honrado.** `rep_prec_custo_decomposto_chk` exige `custo_real = valor_compra_repasse + gastos_total` **sem tolerância** — aritmética `numeric` é exata. Combinado com a AC20 (snapshot antes do `UPDATE`), uma divergência de R$ 0,01 entre dois arredondamentos independentes **não gera aviso: impede aplicar o preço**. O app manda `gastos_total = arredondar2(Σ gastos)` e `custo_real = arredondar2(compra + Σ gastos)` — **os mesmos números, não dois cálculos** (comentário §2.4 da migration 030)
- [ ] **Gate do `TETO_REF_AA_PCT`:** revisado com o retorno do `@alex-analyst` **ou** registrado no código que segue não calibrado **e sem efeito numérico** (só alerta e confiança) — o que mantém G1-b desarmado
- [ ] Caso Frontier PRD1J39 verificado: custo com gastos aparece decomposto e a margem reflete o prejuízo
- [ ] Sem regressão em `/repasses` (lista, inline edit, KPIs, Bônus, XLSX) nem em `margem-repasse.ts`
- [ ] Constantes documentadas no topo do módulo com **âncora separada por constante** e a instrução de recalibração; `TETO_REF_AA_PCT` e `DEPRECIACAO_MENSAL_PCT` marcadas como não calibradas
