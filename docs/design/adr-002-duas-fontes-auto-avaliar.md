# ADR-002 — Convivência entre as duas fontes Auto Avaliar (texto e arquivo)

- **Status:** Aceito
- **Data:** 2026-08-11
- **Autora:** Aria (arquitetura)
- **Contexto de decisão:** discordância **D2** levantada em `docs/design/rpc-sync-arquivo-auto-avaliar.md` (Dara)
- **Afeta:** Fatia 3a / `docs/stories/story-2.2-sync-arquivo-veiculos-em-oferta.md` (escopo **inalterado**)
- **Supersede:** nada. **Não altera** `supabase/migrations/028_datas_de_calendario_em_brasilia.sql`.

---

## 1. Contexto

Duas fontes vão alimentar as mesmas colunas de valor em `repasses`:

| | Fonte TEXTO (produção) | Fonte ARQUIVO (a construir) |
|---|---|---|
| Entrada | colagem da tela do Auto Avaliar | `relatorio_VeiculosEmOferta.xls` |
| RPC | `importar_repasse_auto_avaliar` (028) | `sincronizar_repasse_arquivo_auto_avaliar` (nova) |
| Semântica | **espelho** — "isto é o estado completo da tela" | **contribuição** — "isto é o que eu observei" |
| Write | incondicional (`028:255-263`); ausente ⇒ `NULL` | `COALESCE(observado, coluna)`; ausente ⇒ preserva |

A ordem de execução é do usuário. Se ele importar o arquivo e depois colar o texto, o texto sobrescreve com `NULL` o que o arquivo gravou. Isolar a RPC nova protege o fluxo de texto de regressão, mas **não** protege o dado do arquivo.

Medições contra produção: `Vlr Ref. Web` preenchido em **25/61** linhas do arquivo; **38 dos 60** repasses `subido` estão sem `valor_web`. O arquivo acrescentaria web a ~36 carros e uma colagem posterior zeraria boa parte deles, em silêncio.

---

## 2. Fato que reordena a decisão

`valor_web` **não é lido por nada no sistema hoje**. Verificado:

- Não consta do tipo `Repasse` em `src/lib/repasses/types.ts` (que tem `valor_aquisicao`, `valor_compra_repasse`, `valor_minimo`, `valor_compre_por`, `valor_vendido`, `valor_subir` — e nenhum dos três de referência).
- Nenhuma ocorrência de `valor_web`, `valor_fipe` ou `valor_auto_avaliar` em `src/app/` ou `src/components/` — inclusive em `RepassesLista.tsx`, `RelatorioAnuncio.tsx` e `MarcarVendidoModal.tsx`. O único cálculo de margem/semáforo (`MarcarVendidoModal.tsx:87-89`) usa `valor_minimo` e `valor_compre_por`.
- Nenhuma view SQL projeta `valor_web`. As únicas referências em `supabase/` são os próprios `INSERT`/`UPDATE` das migrations 025 e 028.

**`valor_web` é coluna write-only.** O campo em disputa não sustenta nenhuma decisão de negócio. Isso derruba o custo real do conflito de "perda de dado operacional" para "perda de dado latente".

Segundo fato, na direção oposta: o comportamento destrutivo do texto é **load-bearing**. O `DELETE` incondicional de `repasse_gastos WHERE tipo='auto_avaliar'` (`028:268-270`) existe para que, quando o gasto cai a zero no Auto Avaliar, ele suma do custo. Como `custo_real = valor_compra_repasse + Σ repasse_gastos`, converter o texto em "contribuição" quebraria a regra de domínio inviolável: gasto encerrado ficaria grudado no custo para sempre. **Existe caso real em que colar texto precisa apagar — é esse.** A semântica de espelho não é descuido e não vai embora.

---

## 3. Opções avaliadas

| # | Opção | Prós | Contras | Veredito |
|---|---|---|---|---|
| 1 | **Nada muda.** Duas semânticas convivem; texto vence por último. | Zero risco na entrega; 028 intocada. | `valor_web` do arquivo tem meia-vida de uma colagem. | **Base da decisão** (ver §4) |
| 2 | Migration do `COALESCE` (chamada aqui de "030"; **é a 031** — ver §5) só no write de `valor_web` da 028. | Elimina o conflito com 1 linha. | Toca RPC de produção **por um campo que ninguém lê**; a story deixa de ser "não encosta em produção"; exige reteste do fluxo texto sem harness de Postgres. | **Rejeitado agora** — vira gatilho (§5) |
| 3 | Texto inteiro vira contribuição (COALESCE em tudo + fim do DELETE de gastos). | Semântica única, sem ordem. | **Quebra `custo_real`**: gasto zerado nunca some. Regressão no fluxo que funciona. | **Rejeitado** |
| 4 | Procedência por campo (coluna `fonte_valor_web`, `escrito_por`, etc.). | Auditável; resolve "quem escreveu por último". | 1 usuário, 62 linhas, sem equipe. Metadados > dado. Custo de manutenção permanente. | **Rejeitado — overkill** |
| 5 | Arquivo **não** grava `valor_web`; fica nos 5 estáveis + as 2 colunas novas. | Zero campo disputado por construção. | Desvia do desenho da Dara sem ganho: com `COALESCE` já no `UPDATE` do arquivo, escrever custa zero, e o dado sobrevive até a próxima colagem. Perder de graça é pior que ganhar temporariamente. | **Rejeitado** |
| 6 | Disciplina operacional ("texto primeiro, arquivo depois"). | Grátis hoje. | Usuário único, uso diário, UI não impõe ordem. Solução que depende de disciplina **vai falhar**. | **Rejeitado explicitamente** |

---

## 4. Decisão

**Autoridade particionada por coluna, não semântica unificada.** As duas semânticas coexistem porque quase não se sobrepõem — e onde se sobrepõem, o texto vence.

1. **O texto continua sendo espelho.** A 028 não é alterada — nem nesta story, nem como pré-requisito. É a fonte autoritativa de: `valor_compra_repasse`, `valor_minimo`, `valor_compre_por`, `valor_auto_avaliar`, `valor_fipe`, `valor_web`, `km`, `cor` e dos gastos `tipo='auto_avaliar'`.
2. **O arquivo é contribuição** (`COALESCE(observado, coluna)`, conforme o desenho da Dara) e é a **fonte autoritativa única** de `valor_maior_oferta` e `qtde_anuncios` — colunas que o texto não conhece.
3. **Regra permanente (invariante de arquitetura):** `valor_maior_oferta` e `qtde_anuncios` **nunca** podem entrar no `UPDATE` nem no `INSERT` de `importar_repasse_auto_avaliar`. Adicioná-las converteria a fonte espelho em destruidora do único ganho real da Fatia 3a. Quem precisar de paridade texto↔arquivo nesses campos: use `COALESCE`, ou não mexa.
4. **`valor_web` é declarado campo de autoridade do texto.** O arquivo continua preenchendo (custo marginal zero, já está no mesmo `UPDATE`), **sem garantia de durabilidade**. É best-effort.
5. **Nenhum registro de procedência por campo.** Um usuário, ~60 linhas ativas, sem equipe: o custo de manter metadados de origem supera o de reimportar.

### Custo aceito, explicitamente

**`valor_web` volta a `NULL` em até ~36 carros a cada colagem de texto, em silêncio, e o sistema não avisa.** Aceito porque `valor_web` é write-only hoje (§2): não alimenta margem, semáforo, relatório de anúncio, nem qualquer view. O prejuízo é dado latente, não decisão errada. Em troca, a Fatia 3a mantém risco de entrega zero sobre o fluxo que roda todo dia e entrega `valor_maior_oferta` sem atraso.

Segundo custo, menor: aceitamos que o sistema tem **duas semânticas de escrita convivendo**, o que é uma inconsistência conceitual real. Ela fica documentada aqui em vez de ser resolvida por unificação — a unificação é a Fatia 3b.

---

## 5. Gatilhos de reversão

> **Correção de numeração (2026-08-12).** Onde esta ADR escreveu "migration 030", leia-se **migration 031**. O "030" aqui era nome de rascunho, não reserva de número: a 030 foi consumida por `030_repasse_precificacao_sugerida.sql` (ADR-003), porque a 029 era a última aplicada e deixar buraco na sequência faria o preenchimento tardio rodar fora de ordem. Nenhuma decisão desta ADR muda.

A opção 2 (migration 031) sai do backlog e vira **pré-requisito bloqueante** quando qualquer um destes ocorrer:

- **G1** — `valor_web` (ou `valor_fipe`, ou `valor_auto_avaliar`) passar a ser lido: entrar no tipo `Repasse`, aparecer em `RepassesLista.tsx`/`RelatorioAnuncio.tsx`, ou virar insumo de precificação. Deixa de ser dado latente.
- **G2** — Alguém precisar que o texto escreva `valor_maior_oferta` ou `qtde_anuncios` (viola o item 3 acima).
- **G3** — Marcos reportar que o valor de web sumindo o incomoda na prática.

Qualquer gatilho ⇒ migration 031 com `COALESCE` nos campos afetados da 028, como **story própria**, com roteiro de verificação manual do fluxo de texto. Nunca embutida numa story de feature.

**Status: G1 acionado em 2026-08-12** pela story 3.1 — `valor_auto_avaliar` e `valor_fipe` viraram insumo de precificação. Ver ADR-003 §6: a 031 sai do backlog pra "próxima story", mas **não bloqueia** a 3.1, porque a falha é degradação anunciada (`confianca` cai + alerta em pt-BR), não erro silencioso. `valor_web` segue sem leitor e fora do gatilho.

Fora dos gatilhos, o débito é absorvido pela **Fatia 3b** (unificação das duas RPCs), que já está no backlog e é onde a decisão de semântica única deve ser tomada de verdade.

---

## 6. Consequências para a Fatia 3a

- **Escopo inalterado.** Nada entra, nada sai da story 2.2. A proibição "não alterar a 028" (linha 291 da story) fica **confirmada como decisão arquitetural**, não como conveniência de escopo.
- Nenhuma migration nova além da que a própria story já prevê (colunas `valor_maior_oferta`, `qtde_anuncios` + RPC nova).
- A AC8 (`COALESCE`) permanece como está — inclusive para `valor_web`.
- **Ação de documentação (barata, dentro da story):** ao criar a RPC nova, incluir no cabeçalho SQL a invariante do item 3, para que a próxima pessoa que abrir a 028 encontre o aviso. Um comentário, não código.
- **Esta decisão não gera mudança de UI, nem aviso de ordem de importação.** Se a ordem não importa por design, não gastar pixel dizendo que importa. Não confundir com a story 2.2 em si, que **tem** mudança de UI (AC18/AC19 exibem `valor_maior_oferta` e `qtde_anuncios` e tocam `types.ts` e `RepassesLista.tsx`). A garantia de risco zero desta ADR é sobre o **fluxo de importação por texto**, não sobre o sistema inteiro.

---

## 7. Pendência herdada (não decidida aqui)

**D1** da Dara continua aberta e é de negócio, não de arquitetura: se `Valor Compra = 0,00` pode ser custo real, `valor_compra_repasse` precisa distinguir "zero observado" de "não observado" — senão a margem fica errada em silêncio. Isso **é** um campo lido (`custo_real`). Pergunta para o Marcos, encaminhada via `@morgan-pm` ou direto; não bloqueia esta decisão.
