# Story 2.2 — Sync incremental do arquivo `relatorio_VeiculosEmOferta.xls` (Fatia 3a do Importador Auto Avaliar)

> **Autor:** River (SM) · **Data:** 2026-08-11 · **Status:** rev. 2 — endereça o NO-GO 6/10 do @pax-po
> **Linhagem:** Fatia 2 (commit `0dfd308`, migration 025) criou o importador por **texto colado**. Esta story adiciona uma **segunda fonte** para os mesmos campos — um arquivo — sem substituir e **sem tocar** a primeira.

> ### ⚠️ Decisão estrutural desta revisão: RPC nova e separada
> A rev. 1 propunha adaptar a RPC existente. **Isso é inviável.** Além do `DELETE FROM repasse_gastos` incondicional, o **`UPDATE` compartilhado também é destrutivo** (`028_datas_de_calendario_em_brasilia.sql:255-263`): grava os 6 campos de valor **incondicionalmente**, e campo não observado vira `NULL`. Como `Vlr Ref. Web` só vem preenchido em **25 das 61** linhas, reusar aquela RPC **apagaria o `valor_web` de 36 carros**.
>
> E não dá para "consertar" o `UPDATE`: o fluxo de texto **depende** de zerar campo não observado — o comentário nas linhas 268-270 diz isso com todas as letras (*"se gastos caiu pra 0, o gasto some"*). Não é bug, é o **contrato daquela fonte**. Uma fonte afirma o estado completo; a outra afirma só o que enxerga. São semânticas opostas na mesma função.
>
> **Portanto:** esta story cria uma RPC nova e separada — **`sincronizar_repasse_arquivo_auto_avaliar`** (+ a de preview, `..._preview`). A migration **028 não é alterada**, `importar_repasse_auto_avaliar` **não é tocada**.
>
> **Escopo exato dessa garantia — não arredondar:** risco zero é sobre o **fluxo de texto**, provado pelo diff vazio da AC12. **Não** sobre o sistema inteiro. A **AC18 toca produção**: mexe em `src/lib/repasses/types.ts` e em `RepassesLista`, que é a tela que o Marcos usa todo dia. Regressão de UI ali é possível e o review precisa olhar para isso. A frase correta é *"aditiva sobre o fluxo de texto"*, nunca *"não encosta em produção"*.
>
> A unificação das duas RPCs e o débito do `DELETE`/`UPDATE` incondicional ficam para a **Fatia 3b** (seção no fim deste documento).

---

## Contexto

Hoje o Marcos alimenta os valores dos carros de repasse colando um **texto** copiado da tela do Auto Avaliar (`src/lib/repasses/parse-auto-avaliar.ts`). Esse fluxo **cria** o carro e preenche valor de compra, mínimo, compre-por, médias e **gastos**, porque o texto traz km, cor e gastos.

Agora o Auto Avaliar permite **baixar um arquivo** — `relatorio_VeiculosEmOferta.xls` — com os veículos em oferta. O arquivo é mais rápido e menos sujeito a erro de cópia que o texto, mas é **mais pobre**: não traz km, nem cor, nem gastos. Em compensação traz duas informações que o texto não tem: **maior oferta recebida** e **quantidade de anúncios**.

Por isso o arquivo **não é um segundo criador de carro** — é um **sincronizador**. Ele atualiza o que enxerga nos carros que já existem e cala a boca sobre o resto. O parser de texto continua sendo o único caminho para nascer um repasse.

O comportamento que o Marcos pediu explicitamente, comparando com o fluxo de upload do NBS: **ver o que vai mudar antes de confirmar**. Com o arquivo de hoje (61 linhas), o preview deve dizer "57 sem alteração, 1 muda, 2 não encontradas, 2 de outra loja" — e não "61 importados".

### Valor de negócio
- Sincronização semanal de valores em ~30 segundos, sem colar 60 textos um a um.
- Duas métricas novas de decisão que hoje não existem no sistema: **maior oferta recebida** (o mercado já disse quanto paga) e **qtde de anúncios** (pressão competitiva no mesmo carro).
- O preview incremental transforma o import de um ato de fé num ato auditável.

### Evidência que fundamenta a story (já levantada, não refazer)
Comparação das 61 linhas do arquivo contra o banco: **59 casaram** com repasses em `subido`/`marcado`.

| Coluna do arquivo | Campo em `repasses` | Iguais | Diferem |
|---|---|---|---|
| `Valor Compra` | `valor_compra_repasse` | 57 | 0 |
| `Valor Anunciado` | `valor_minimo` | 56 | 1 |
| `Valor ComprePor` | `valor_compre_por` | 57 | 0 |
| `Vlr Ref. FIPE` | `valor_fipe` | 55 | 1 |
| `Vlr Ref. Web` | `valor_web` | 22 | 0 |
| `Vlr Ref. AutoAvaliar` | `valor_auto_avaliar` (coluna já existe, migration 013) | 49 | 0 |
| `Vlr Maior Oferta` | **coluna não existe** | — | — |
| `Qtde Anuncios` | **coluna não existe** | — | — |

As **6** colunas estão confirmadas pelo mesmo método. A única divergência real (placa **RBM3C09**) é o arquivo estando **mais atualizado** que o banco — não é erro de mapeamento. Amostras de `Vlr Ref. AutoAvaliar` batendo centavo a centavo: SCC1G90 = 137.361,26 · PRT8B67 = 89.667,28 · RCF9D56 = 90.696,63 · SCJ0A79 = 163.537,67.

**Preenchimento por coluna (não-zero, em 61 linhas)** — calibra a expectativa de quanto cada import realmente escreve:
`Qtde Anuncios` **61/61** · `Vlr Ref. FIPE` 60/61 · `Vlr Ref. AutoAvaliar` 53/61 · `Vlr Maior Oferta` 37/61 · `Vlr Ref. Web` 25/61.

**Composição do arquivo (61 linhas):** 59 `NAVESA - GO/MATRIZ`, 1 `NAVESA - GO/CIAASA`, 1 `NAVESA - GO/AP DE GOIÂNIA`.
**Contra o banco (60 repasses `subido`):** 57 sem alteração · 1 muda valor (RBM3C09) · 2 no arquivo sem repasse correspondente (PRU3B12, TGK0B80 — travados por falta de chassi) · 2 de outra loja · **1 repasse `subido` que não aparece no arquivo** (QWB0G76, sem nenhum valor preenchido) — ver AC17.

**Colunas do arquivo, nessa ordem:** `Loja`, `Placa`, `Marca`, `Modelo`, `Versão`, `Ano Fab.`, `Ano Mod.`, `Qtde Anuncios`, `Valor Compra`, `Valor Anunciado`, `Valor ComprePor`, `Vlr Maior Oferta`, `Vlr Ref. Web`, `Vlr Ref. FIPE`, `Vlr Ref. AutoAvaliar`.

**Formato do arquivo:** apesar da extensão `.xls`, é **HTML disfarçado** (uma `<table>`). O SheetJS (`xlsx`, já em `package.json` — instalado via tarball `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`) lê esse formato nativamente. **Não escrever parser de HTML novo.**

**Formato numérico:** pt-BR (`251.800,00`). Já existe `parseValorBR` em `src/lib/utils/parse-br.ts` — reusar.

---

## Onde isso encosta no código (verificado no repo)

| O quê | Caminho | Observação |
|---|---|---|
| Tela de import (única) | `src/app/repasses/importar/page.tsx` → `ImportarAutoAvaliar.tsx` (casca de abas) → `ImportarPorTexto.tsx` | `"use client"`. A colagem é um `<textarea id="aa-textarea">`. O preview já é feito de **blocos/cards** (`BlocoItens`), não tabela: Avisos · Criar · Atualizar · Reconciliação · Pendências · trava de risco (checkbox) · barra de ação. **Os 3 grupos novos devem seguir esse mesmo padrão de bloco.** |
| Parser de texto | `src/lib/repasses/parse-auto-avaliar.ts` | `parseAutoAvaliar(texto: string): ParseResultAA` + `diagnosticarParseVazio`. Tipos `RegistroAA`, `Aviso`, `AvisoCodigo` moram **aqui**, não em `types.ts`. |
| Núcleo puro do preview | `src/lib/repasses/import-auto-avaliar.ts` | `montarPreviewPuro`, `avaliarRiscoReconciliacao`, **`montarPayloadImport`** (quem monta o payload da RPC). Tipos `ImportPreview`, `PreviewItem`, `Pendencia`, `ReconItem`, `PayloadImport`, `ImportResultado` moram **aqui**. Já usa `calcularCustoReal` de `margem-repasse.ts`. |
| Camada de I/O | `src/lib/repasses/import-auto-avaliar-queries.ts` | `"use client"`. `montarPreviewImport` (carrega repasses ativos, `veiculos_atual`, `vendas`) e `confirmarImport` — que chama `sb.rpc("importar_repasse_auto_avaliar", { p_payload })` **direto do browser**. **Não existe server action nem route handler de import no projeto.** |
| Padrão de upload já estabelecido | `src/components/UploadDropzone.tsx` + `src/lib/parsers/nbs-*.ts` | Único uso de `react-dropzone`. Fluxo canônico: `onDrop → file.arrayBuffer() → parseX(buf) → store`. `src/lib/parsers/nbs-custos-xls.ts` já lida com `.xls` via `XLSX.read(buf, { type: "array" })`. Alternativa mais leve usada em `CautelarBatchActions.tsx`: `<input type="file" hidden>` + `arrayBuffer()`. |
| Regra de custo | `src/lib/repasses/margem-repasse.ts` | `calcularCustoReal(valor_compra_repasse, gastos[])`. O docblock já diz, em letras garrafais, "NUNCA usar `valor_aquisicao`". |
| Testes | `tests/` (flat) + `tests/fixtures/` | `node:test` nativo. Fixtures do Auto Avaliar hoje são `.txt` lidas com `readFileSync(..., "utf8")` (`auto-avaliar-sample.txt`, `aa_real_validacao.txt`). **Não há fixture binária no projeto** — mas como o `.xls` é HTML texto, ele pode virar fixture `.txt`/`.html` lida como utf8 e passada ao SheetJS como string. |
| RPC do texto (definição vigente) | `supabase/migrations/028_datas_de_calendario_em_brasilia.sql` | Recriada a partir da `025_repasse_auto_avaliar_import.sql`. `UPDATE` incondicional dos 6 valores nas **linhas 255-263**; `DELETE` incondicional de `repasse_gastos` nas **linhas 268-270**. **NÃO é alterada por esta story** — é a referência de contrato da outra fonte. |

---

## User Story

**Como** Marcos (dono do produto, gestor de repasses da Navesa),
**eu quero** subir o arquivo `relatorio_VeiculosEmOferta.xls` do Auto Avaliar e ver, antes de confirmar, exatamente quais carros vão mudar e de que valor para que valor,
**para** manter os valores do `/repasses` sincronizados com o Auto Avaliar toda semana, sem digitar nada, sem criar carro duplicado e sem risco de o import corromper a margem.

---

## Acceptance Criteria

### Grupo A — Leitura do arquivo

**AC1 — SheetJS lê o `.xls` HTML-disfarçado**
GIVEN o arquivo `relatorio_VeiculosEmOferta.xls` baixado do Auto Avaliar (conteúdo HTML `<table>`, extensão `.xls`)
WHEN o usuário sobe o arquivo na tela de importação de `/repasses`
THEN o parser usa a dependência `xlsx` (SheetJS) já presente no `package.json` para ler o arquivo
AND devolve uma linha por veículo, com as 15 colunas nomeadas
AND **nenhum parser de HTML/regex próprio é adicionado ao projeto**
AND o teste automatizado assere contra a **contagem da fixture** (`N_FIXTURE`, uma constante declarada junto dela), não contra o número do arquivo real — a fixture é ofuscada e terá composição própria.
> _Números do arquivo real (61 linhas, 59/1/1 por loja, 57-1-2-2 contra o banco) vivem **só** na seção de Evidência e no roteiro de verificação manual. Nenhuma AC automatizada depende deles._

**AC2 — Header por nome, não por posição**
GIVEN o arquivo cujo cabeçalho é `Loja | Placa | Marca | Modelo | Versão | Ano Fab. | Ano Mod. | Qtde Anuncios | Valor Compra | Valor Anunciado | Valor ComprePor | Vlr Maior Oferta | Vlr Ref. Web | Vlr Ref. FIPE | Vlr Ref. AutoAvaliar`
WHEN o parser mapeia colunas
THEN o mapeamento é feito **pelo nome do cabeçalho** (normalizado: trim + case-insensitive + acento-insensitive), nunca por índice numérico
AND se uma coluna obrigatória (`Loja`, `Placa`, `Valor Compra`, `Valor Anunciado`, `Valor ComprePor`) estiver ausente, a importação é **abortada antes de qualquer escrita** com mensagem em pt-BR nomeando a coluna que faltou.

**AC3 — Números pt-BR e a semântica do zero**
GIVEN uma célula de dinheiro com valor `251.800,00`
WHEN o parser converte
THEN o resultado é o número `251800.00` (centavo-perfect, sem `parseFloat` de string bruta)
AND GIVEN uma célula de dinheiro com `0,00`, vazia, `-` ou `R$ 0,00`
THEN o resultado é `null` ("o arquivo não observou esse valor"), **nunca** o número `0`
AND GIVEN a coluna `Qtde Anuncios` com valor `0`
THEN o resultado é o inteiro `0` (zero real: "está sem anúncio ativo"), **não** `null` — a regra de zero-é-ausência vale só para colunas de dinheiro.

**AC4 — Arquivo errado é rejeitado, com erro nominal**
GIVEN um arquivo que não é o `relatorio_VeiculosEmOferta`
WHEN o usuário sobe o arquivo
THEN o parser devolve um código de erro de um conjunto **fechado e tipado** (união de literais, no padrão de `AvisoCodigo` em `parse-auto-avaliar.ts`), e a tela renderiza a mensagem pt-BR correspondente via mapa `ROTULO_*` — nunca uma string solta montada no componente:

| Código | Quando | Mensagem exibida |
|---|---|---|
| `ARQUIVO_ILEGIVEL` | SheetJS não consegue abrir / nenhuma planilha | "Não consegui ler esse arquivo. Baixe de novo o relatório 'Veículos em Oferta' no Auto Avaliar e tente outra vez." |
| `COLUNA_OBRIGATORIA_AUSENTE` | falta `Loja`, `Placa`, `Valor Compra`, `Valor Anunciado` ou `Valor ComprePor` (AC2) | "Esse arquivo não parece ser o relatório 'Veículos em Oferta' — não encontrei a coluna «{nome}»." |
| `ARQUIVO_SEM_LINHAS` | abriu e tem cabeçalho válido, mas 0 linhas de dados | "O arquivo está vazio — só tem o cabeçalho, nenhum veículo." |
| `ARQUIVO_GRANDE_DEMAIS` | acima do teto de tamanho/linhas (R10) | "Arquivo grande demais ({n} linhas). O esperado é algo em torno de 60." |

AND o código do erro é o que os testes asseguram (a mensagem é detalhe de UI e pode ser reescrita pelo @uma-ux sem quebrar teste)
AND nenhuma linha é gravada em nenhum dos quatro casos.

### Grupo B — Filtro de loja e casamento

**AC5 — Só a matriz é importada; as outras aparecem, não somem**
> ⚠️ **Conflito de nome resolvido.** A rev. 2 chamava de "ignoradas" as linhas de outra loja; o §5 do desenho já usa `ignoradas[]` para descartes detectados no **banco** (placa duplicada, inválida, ambígua, nenhum campo observado). São coisas diferentes. **Nomenclatura desta story em diante:**
> - **`outra_loja`** — filtradas **no cliente**, antes do payload sair. Nunca chegam à RPC.
> - **`ignoradas[]`** — descartadas **no banco**, enum `motivo` do §5 (+ `valor_compra_zerado`, AC13c).

GIVEN uma fixture contendo pelo menos uma linha de cada loja (`NAVESA - GO/MATRIZ`, `NAVESA - GO/CIAASA`, `NAVESA - GO/AP DE GOIÂNIA`)
WHEN o preview é gerado
THEN apenas as linhas de `NAVESA - GO/MATRIZ` entram no payload enviado à RPC
AND **toda** linha de outra loja é retida no cliente em `outra_loja[]`, com placa, modelo e o nome da loja, e exibida no preview
AND a invariante verificada é de **4 baldes**, como igualdade de soma e não contra números fixos:
`linhas do arquivo = outra_loja + resumo.sem_alteracao + resumo.com_alteracao + resumo.nao_encontradas + resumo.ignoradas`
AND, equivalentemente, `linhas do arquivo − outra_loja = resumo.linhas_no_arquivo` (a RPC só enxerga o que passou pelo filtro de loja)
AND **nenhuma linha é descartada silenciosamente** em nenhum dos dois lados.

**AC6 — Match por placa normalizada, em repasse ativo**
GIVEN uma linha do arquivo com placa `RBM-3C09`
WHEN o sistema procura o repasse correspondente
THEN a busca usa placa normalizada com a **mesma expressão do banco**: `regexp_replace(upper(placa),'[^A-Z0-9]','','g')` (índice `idx_repasses_placa_norm`, criado na migration 025)
AND o match só considera repasses com `status IN ('marcado','subido')`
AND se a placa casar com um repasse `vendido`/`nao_vendido`/`cancelado`, a linha vai para **"não encontrada"** (não se atualiza carro que saiu do ciclo).

**AC7 — Arquivo nunca cria carro**
GIVEN uma placa presente no arquivo que não existe em `repasses` (com os dados de hoje: **PRU3B12** e **TGK0B80**, ambas travadas por falta de chassi)
WHEN o preview é gerado
THEN a linha aparece no grupo **"Não encontradas no sistema"**, com placa, modelo e os valores que o arquivo trazia
AND o texto do grupo instrui: *"para criar esse carro, use a importação por texto do Auto Avaliar"*
AND ao confirmar a importação **nenhum `INSERT` em `repasses` acontece** — a contagem de linhas de `repasses` antes e depois é idêntica.

### Grupo C — Escrita não-destrutiva (o coração da story)

**AC8 — Cada fonte escreve só o que enxerga (semântica COALESCE)**
GIVEN um repasse com `valor_web = 118.000,00` gravado anteriormente pelo fluxo de texto
AND a linha correspondente no arquivo traz `Vlr Ref. Web = 0,00` (o arquivo não observou esse valor — situação de **36 das 61 linhas**, já que só 25 têm `Vlr Ref. Web` preenchido)
WHEN a importação do arquivo é confirmada
THEN `valor_web` continua `118.000,00` — este é o motivo pelo qual a RPC do texto **não pode** ser reusada: o `UPDATE` dela (`028:255-263`) gravaria `NULL` aqui
AND o campo **não aparece** no diff do preview (não é uma mudança)
AND a mesma regra vale para **todos** os campos de valor: `valor_compra_repasse`, `valor_minimo`, `valor_compre_por`, `valor_fipe`, `valor_web`, `valor_auto_avaliar`, `valor_maior_oferta`
AND campos que o arquivo **não possui** (`km`, `cor`, `gastos`) **nunca** entram no `UPDATE`.

**AC9 — Colunas novas em `repasses`**
GIVEN a migration nova aplicada
WHEN o schema é inspecionado
THEN existem em `repasses` as colunas `valor_maior_oferta numeric` (mapeada de `Vlr Maior Oferta`) e `qtde_anuncios integer` (mapeada de `Qtde Anuncios`)
AND ambas são nullable, com `COMMENT ON COLUMN` explicando origem e fonte
AND a migration é **idempotente** (`ADD COLUMN IF NOT EXISTS`), padrão do projeto
AND `valor_maior_oferta` **não** entra em nenhum cálculo de custo ou margem — é informação de mercado (ver AC14).
> _DDL detalhada, tipo exato, precisão e índices são decisão do **@dara-data-engineer** (§6 do desenho). A story declara a necessidade e o porquê._

**AC9b — A invariante do ADR-002 fica gravada no código, não só num documento**
GIVEN a regra permanente do `docs/design/adr-002-duas-fontes-auto-avaliar.md` item 3: `valor_maior_oferta` e `qtde_anuncios` **nunca** podem entrar no `UPDATE` nem no `INSERT` de `importar_repasse_auto_avaliar` — adicioná-las converteria a fonte espelho na destruidora do único ganho real desta fatia
WHEN a migration `029` é escrita
THEN o **cabeçalho SQL da 029** contém essa invariante como comentário explícito, nomeando o ADR-002 e explicando a consequência de violá-la (conforme pedido pelo próprio ADR §6)
AND o comentário está posicionado onde alguém que abrir a 028 para "só adicionar mais um campo" tenha chance de encontrá-lo
AND os `COMMENT ON COLUMN` das duas colunas novas registram que a **fonte autoritativa única é o arquivo**.
> _Sem isto, a invariante é uma frase num documento que ninguém vai reler. O gatilho **G2** do ADR §5 depende de alguém lembrar que ela existe._

### Grupo D — RPC nova, isolada da que está em produção
> **Verificação destas 4 AC é MANUAL roteirizada** — ver *DoD → Roteiro de verificação manual*. Não existe hoje harness de teste contra Postgres no projeto (`tests/` é `node:test` sobre funções puras, nenhum teste toca banco). Criar esse harness está **fora do escopo** desta fatia; ver *Fatia 3b*.

**AC10 — A RPC do arquivo é nova, separada, e não toca `repasse_gastos`**
GIVEN que `importar_repasse_auto_avaliar` (definição vigente em `028_datas_de_calendario_em_brasilia.sql`) faz `DELETE FROM repasse_gastos ... tipo = 'auto_avaliar'` incondicional **e** `UPDATE` incondicional dos 6 campos de valor
AND que o arquivo não tem coluna de gastos nem preenche todos os valores
WHEN a importação por arquivo é implementada
THEN ela usa uma **RPC nova e separada** (sugestão de nome: `sincronizar_repasse_arquivo_auto_avaliar`)
AND essa RPC **não contém nenhum `DELETE`, `INSERT` ou `UPDATE` em `repasse_gastos`** — a tabela inteira está fora do seu alcance
AND `importar_repasse_auto_avaliar` **não é alterada**: nem assinatura, nem corpo, nem a migration 028.

**AC11 — Verificação observável: importar o arquivo duas vezes não mexe em gasto nem em margem**
GIVEN um repasse com um `repasse_gastos` de `tipo = 'auto_avaliar'` e `valor = 1.850,00`
AND `custo_real = valor_compra_repasse + Σ repasse_gastos` anotado antes do import
WHEN o arquivo é importado **duas vezes seguidas**
THEN os `repasse_gastos` de tipo `auto_avaliar` permanecem intactos — **mesma contagem de linhas, mesma soma e mesmos `id`**
AND a **margem real não muda** em nenhuma das duas execuções
AND o preview do 2º import mostra **100% em "Sem alteração"** e **0 em "Vão mudar"**.

**AC12 — O fluxo de texto fica literalmente intocado**
GIVEN que a Fatia 3a não altera `importar_repasse_auto_avaliar` nem a migration 028 (AC10)
WHEN o diff da story é revisado
THEN **nenhum arquivo do fluxo de texto aparece no diff**: nem `supabase/migrations/028_*.sql`, nem `supabase/migrations/025_*.sql`, nem `src/lib/repasses/parse-auto-avaliar.ts`
AND `montarPayloadImport` / `confirmarImport` em `import-auto-avaliar.ts` e `import-auto-avaliar-queries.ts` continuam chamando `importar_repasse_auto_avaliar` com o mesmo payload de hoje
AND os testes existentes (`tests/import-auto-avaliar.test.ts`, `tests/parse-auto-avaliar.test.ts`) passam sem alteração — o que aqui é uma garantia **fraca mas real**: eles não enxergam SQL, mas provam que o núcleo puro do fluxo de texto não regrediu.
> _A garantia forte da AC12 é o diff vazio da AC10, não a suíte de testes._

### Grupo E — Preview incremental

**AC13 — Três grupos, com diff campo a campo**
GIVEN uma fixture com pelo menos um caso de cada situação (sem alteração, muda valor, não encontrada, outra loja)
WHEN o preview é exibido em `SyncOfertasConferencia.tsx` (aba "Subir arquivo .xls" de `/repasses/importar`), **antes** de qualquer escrita
THEN a tela mostra três grupos, no mesmo padrão de bloco/card já usado por `BlocoItens` (Criar/Atualizar/Reconciliação, em `ImportarPorTexto.tsx`), com contagem no cabeçalho de cada um:
1. **Sem alteração** — colapsado por padrão, expansível
2. **Vão mudar** — para cada carro, **campo a campo**, `campo · valor antes → valor depois` (ex.: `Valor mínimo · R$ 96.900,00 → R$ 94.500,00`), mostrando **apenas** os campos que realmente mudam
3. **Ignorados / não encontrados** — rotulados com o motivo (padrão do mapa `ROTULO_AVISO` de `ImportarPorTexto.tsx`)
AND a soma dos três grupos é igual ao total de linhas do arquivo (invariante, não número fixo)
AND existe um botão **Descartar preview** que limpa tudo sem escrever nada, como já faz o fluxo de texto.
> _Com o arquivo real de hoje isso dá 57 / 1 / 4 — conferido na verificação manual do DoD, não em teste automatizado._

**AC13b — A classificação vive no banco; o front renderiza o contrato de saída**
> _Revisado: a rev. 2 exigia classificação como função pura em TS. Isso **colide** com `docs/design/rpc-sync-arquivo-auto-avaliar.md` §5, que põe a regra dentro da RPC de preview. **Ruling: o desenho do Dara vence**, por dois motivos que ficam registrados aqui:_
> 1. _Preview e gravação **precisam** compartilhar uma normalização só. Se o TS classifica e o SQL grava, os dois divergem no primeiro arredondamento e a tela passa a **mentir** sobre o que vai ser gravado. O `patch` do §5 é produzido pela própria RPC exatamente para fechar isso._
> 2. _Não existe camada de servidor no projeto (sem `"use server"`, sem route handler). Classificação no cliente é classificação **adulterável** (R8)._

GIVEN a RPC de preview `sincronizar_repasse_arquivo_auto_avaliar_preview(jsonb)` (§2 do desenho), `STABLE`, que não grava nada
WHEN o front a chama com o payload do parser
THEN ela devolve um JSONB único no contrato do §5, e o front **renderiza sem reagrupar nem recalcular**:
- `resumo` com `linhas_no_arquivo`, `sem_alteracao`, `com_alteracao`, `nao_encontradas`, `ignoradas`, `campos_a_alterar`, `linhas_gravadas`
- `com_alteracao[]` com o diff **já pronto**: `campos[] = { campo, antes, depois, acao }`, onde `acao ∈ {"preenche","altera"}`, mais `campos_observados_sem_mudanca[]`
- `sem_alteracao[]`, `nao_encontradas[]` (`motivo ∈ {sem_repasse, repasse_inativo}`) e `ignoradas[]` (`motivo` do enum fechado do §5)
AND campo não observado **não aparece** em `campos[]` — não existe `{"depois": null}` em lugar nenhum
AND o front renderiza a partir de `campos`, **nunca** de `patch` (que é interno da RPC)
AND o front **não recalcula** `antes`/`depois`, não reordena grupos por conta própria e não infere `acao`
AND os tipos TS são apenas o **espelho declarativo** desse contrato, em `src/lib/repasses/sync-arquivo-auto-avaliar.ts` (nada vai para `types.ts`, que é só domínio persistido).

**AC13c — `Valor Compra = 0,00` nunca passa em silêncio**
GIVEN uma linha do arquivo cujo `Valor Compra` é `0,00` (hoje: **0 ocorrências em 61 linhas**, mas o modo de falha é grave)
AND que, pela normalização do §4.1, `0,00` significa "não observado" — o que manteria o `valor_compra_repasse` antigo **sem aparecer em nenhum grupo do preview**
WHEN o preview é gerado
THEN a linha **não** cai em "sem alteração": ela vai para `ignoradas[]` com `motivo = "valor_compra_zerado"` (valor novo no enum fechado do §5)
AND a mensagem pt-BR correspondente aponta que o custo-base não foi informado e que o carro ficou de fora do sync
AND nenhum outro campo dessa linha é gravado.
> _`valor_compra_repasse` é a base de `custo_real`. Um silêncio aqui é margem errada sem sintoma. Isto **não** decide se `0,00` pode ser custo real (pergunta D1, aberta com o @morgan-pm/Marcos) — apenas **proíbe o modo silencioso**._

**AC14 — Margem no preview respeita a regra de ouro**
GIVEN o preview de um carro que muda de valor
WHEN o preview exibe qualquer número de margem ou custo
THEN o cálculo usa `custo_real = valor_compra_repasse + Σ repasse_gastos`, via os helpers de `src/lib/repasses/margem-repasse.ts`
AND **nunca** usa `valor_aquisicao` (custo de varejo/NBS) como base
AND `valor_maior_oferta` e `qtde_anuncios` são exibidos como informação, **fora** da fórmula de custo.

**AC15 — Erro fatal aborta tudo; conflito por item é reportado e a importação segue**
GIVEN o preview confirmado
WHEN a escrita é aplicada
THEN tudo acontece em **uma transação** (`SECURITY INVOKER`, payload JSONB in / JSONB out, molde da RPC existente)
AND um **erro fatal** (payload malformado, coluna inexistente, violação de constraint não tratada) **aborta a transação inteira** — nada é gravado
AND um **conflito de item** (placa ambígua, item malformado, linha que não casa) **não aborta**: o item é pulado, contabilizado e devolvido no JSONB de retorno, e os demais são aplicados — mesmo comportamento da RPC existente, que faz `CONTINUE` e engole `unique_violation` contando em `conflitos`
AND a tela exibe, em pt-BR, a contagem real do que foi aplicado **e** a contagem de conflitos, com a lista das placas conflitantes
AND se `conflitos > 0` o resultado é apresentado como **atenção**, não como sucesso limpo.

**AC17 — Repasse que está no sistema mas não está no arquivo é intocado**
GIVEN um repasse com `status = 'subido'` cuja placa **não aparece** no arquivo (no arquivo de hoje: **QWB0G76**, que está subido no sistema e sem nenhum valor preenchido)
WHEN a importação é confirmada
THEN esse repasse **não é alterado, não é deletado e não muda de status** — nenhum campo, nem `atualizado_em`
AND ele **não aparece** em nenhum dos três grupos do preview (o arquivo não fala sobre ele; ausência não é informação)
AND, em particular, ausência do arquivo **não** é lida como "saiu do ar" nem dispara reconciliação — o arquivo só afirma, nunca nega.
> _Isso distingue o sync por arquivo do fluxo de texto, onde "colei a lista completa" habilita reconciliar quem sumiu (`avaliarRiscoReconciliacao`). Para o arquivo, essa inferência está **fora de escopo**._

### Grupo G — O dado novo chega ao Marcos (o ganho real da story)
> _Sem este grupo a story entrega duas colunas no banco e o Marcos continua olhando o WhatsApp para saber quanto ofereceram. As AC 8/10/11 protegem valores que **já estão corretos**; estas duas são o único **ganho novo**._

**AC18 — `valor_maior_oferta` e `qtde_anuncios` aparecem na listagem de `/repasses`**
GIVEN um repasse sincronizado pelo arquivo, com `valor_maior_oferta = 92.500,00` e `qtde_anuncios = 3`
WHEN o Marcos abre `/repasses`
THEN a listagem (`RepassesLista`) mostra as duas informações como colunas novas, formatadas em pt-BR (`R$ 92.500,00` e `3`)
AND quando o valor é `null` a célula mostra **`—`**, nunca `R$ 0,00`, `null` ou célula vazia
AND `valor_maior_oferta` é visualmente distinguível dos valores de custo — é **oferta de mercado**, não custo (reforça AC14).

**AC19 — Maior oferta é legível como sinal de decisão**
GIVEN um repasse com `valor_maior_oferta` preenchido e `custo_real` conhecido
WHEN a maior oferta é exibida
THEN o Marcos consegue ler, sem fazer conta de cabeça, se a maior oferta recebida está **acima ou abaixo do custo real** (`custo_real = valor_compra_repasse + Σ repasse_gastos`, via `margem-repasse.ts`)
AND quando `valor_maior_oferta` for `null`, nenhuma comparação é exibida (não inventar semáforo sobre ausência de dado)
AND a forma exata dessa leitura (semáforo reusando o padrão existente, delta em R$, ou só ordenação) é decisão do **@uma-ux** — a AC exige que a informação seja **acionável**, não um número solto.
> _`qtde_anuncios` é contexto competitivo (quantos anúncios do mesmo carro), não entra em nenhuma comparação de valor._

### Grupo F — Datas

**AC16 — Toda data de calendário nasce no banco, em Brasília**
GIVEN a importação rodando às 22h de Brasília (quando o `current_date` do Postgres, que roda em UTC, já é o dia seguinte)
WHEN qualquer data de calendário é gravada (`repasse_gastos.data`, `data_subiu`, `data_subido`, ou qualquer carimbo novo desta story)
THEN o valor vem de `public.hoje_brasilia()` (helper criado na migration 027)
AND **não** de `current_date`, **não** de `toISOString().slice(0,10)`, e **não** de `hojeLocal()` de `src/lib/utils/data-local.ts` calculado no servidor (na Vercel o servidor é UTC — ver Risco R2)
AND `atualizado_em = now()` permanece `timestamptz` (instante técnico, não converter).

---

## Scope

### IN
1. Migration nova: `valor_maior_oferta numeric` + `qtde_anuncios integer` em `repasses` (idempotente, com `COMMENT ON COLUMN`).
2. **RPC nova e separada** (sugestão: `sincronizar_repasse_arquivo_auto_avaliar`), com escrita COALESCE e **sem tocar `repasse_gastos`**. A `importar_repasse_auto_avaliar` e a migration 028 **não são alteradas**.
3. Parser do `relatorio_VeiculosEmOferta.xls` via **SheetJS já instalado**, com mapeamento de coluna por nome e códigos de erro tipados (AC4).
4. Filtro `Loja = 'NAVESA - GO/MATRIZ'` + grupo de ignorados visível.
5. Match por placa normalizada contra repasses em `marcado`/`subido`.
6. Escrita não-destrutiva (semântica COALESCE) nos 7 campos de valor.
7. Preview incremental com 3 grupos e diff campo a campo antes de confirmar.
8. **Exibição de `valor_maior_oferta` e `qtde_anuncios` em `/repasses`** (listagem e detalhe), com `—` para null (AC18/AC19).
9. Fix barato do `hojeLocal()`: `America/Sao_Paulo` explícito + teste com `TZ=UTC` (R2).
10. Testes automatizados (só do que é puro): parser, códigos de erro, zero-é-ausência, filtro de loja, invariante de soma dos grupos, diff campo a campo.
11. Roteiro de **verificação manual** para as 5 AC que tocam banco (AC10, AC11, AC12, AC15, AC17).

### OUT (não vai ser feito agora)
- **Remover ou aposentar o parser de texto** — ele continua sendo o único caminho de criação; o arquivo não tem km, cor nem gastos.
- **Criar repasse a partir do arquivo** — explicitamente proibido (AC7).
- **Importar as outras lojas** (CIAASA, AP DE GOIÂNIA) — só listar como ignoradas.
- **Reconciliação de vendidos/marcados a partir do arquivo** — o bloco `reconciliacao` da RPC continua exclusivo do fluxo de texto (AC17).
- **Alterar `importar_repasse_auto_avaliar` ou a migration 028** — proibido nesta fatia (AC10/AC12). O `DELETE`/`UPDATE` incondicional do texto é débito conhecido e documentado, endereçado na **Fatia 3b**.
- **Criar harness de teste contra Postgres** — não existe hoje; 5 AC caem em verificação manual roteirizada. Vai para a **Fatia 3b**, item 3.
- **Unificar as duas RPCs** — Fatia 3b. A 3a aceita conscientemente a duplicação.
- **Histórico/série temporal de `valor_maior_oferta` e `qtde_anuncios`** — nesta story é snapshot (último valor visto), não série.
- **Integração via API do Auto Avaliar** — segue no backlog do ROADMAP, depende de credenciais.
- **Consolidar `xlsx` (SheetJS) × `exceljs`** — débito técnico já registrado no ROADMAP; não é desta story (mas ver Risco R4).
- **Upload agendado / automático** — o upload é manual, disparado pelo Marcos.
- **Mexer em `valor_aquisicao`** — jamais tocado por importador.
- **Adaptar o arquivo para o formato TAB e reusar `parseAutoAvaliar`** — tentador, mas errado: as duas fontes têm colunas e semânticas de escrita diferentes (uma cria com km/cor/gastos, a outra só sincroniza valores). Parser separado (ver Risco R9).
- **Criar server action / API route** — o projeto inteiro processa arquivo no browser e chama a RPC direto do client. Não introduzir uma camada nova só para isso.

---

## Dependências

### Stories / entregas anteriores
- **Fatia 2 — Importador Auto Avaliar** (commit `0dfd308`): RPC `importar_repasse_auto_avaliar`, índices funcionais de placa normalizada, colunas `valor_fipe` / `valor_web` / `valor_auto_avaliar`. Esta story **estende** esse importador.
- **Migration 027** — helper `public.hoje_brasilia()` e trigger de `data_subido`.
- **Migration 028** — definição vigente da RPC do texto. **Referência, não alvo**: esta story não a altera.

### Agentes / handoffs
- **@dara-data-engineer** — DDL das 2 colunas novas **e o desenho da RPC nova** `sincronizar_repasse_arquivo_auto_avaliar` (em documento próprio, em andamento em paralelo). Esta story **não contém DDL nem corpo de função** de propósito — declara requisito e critério observável (AC8, AC10, AC15, AC16).
- **@uma-ux** — layout dos 3 grupos do preview (qual vem primeiro, o que colapsa, como o diff `antes → depois` é lido no celular) **e** como `valor_maior_oferta` vira sinal acionável na listagem sem competir visualmente com os valores de custo (AC18/AC19).
- **@dex-dev** — parser, preview, exibição na listagem, wiring, e execução do roteiro manual do DoD.
- **@quinn-qa** — verdict, com atenção especial ao diff limpo (AC12, passo 1) e aos passos 2, 3 e 6 do roteiro manual.

### Recursos externos / dados
- **Fixture derivada do arquivo real.** O `.xls` real existe em `C:\Users\marcos.jesus\Desktop\relatorio_VeiculosEmOferta.xls` (61 linhas, 15 colunas), mas **não pode ser commitado como está** — tem placas reais e valores de compra reais. A fixture em `tests/fixtures/` (ao lado de `auto-avaliar-sample.txt` e `aa_real_validacao.txt`) precisa ser **derivada dele com placas e valores ofuscados**, preservando: a estrutura HTML disfarçada, os nomes e a ordem das 15 colunas, o formato numérico pt-BR (`251.800,00`), os zeros `0,00` onde eles existem, e pelo menos **uma linha de cada loja** (`NAVESA - GO/MATRIZ`, `NAVESA - GO/CIAASA`, `NAVESA - GO/AP DE GOIÂNIA`) mais **uma placa inexistente no banco**.
- Dependência `xlsx` (SheetJS 0.20.3) — já em `package.json`.
- `parseValorBR` em `src/lib/utils/parse-br.ts` e `normalizarPlaca` em `src/lib/utils/placa.ts` — já existem, reusar.
- Padrão de upload: `react-dropzone` via `src/components/UploadDropzone.tsx`, ou `<input type="file" hidden>` como em `src/components/CautelarBatchActions.tsx`. Escolha é do @uma-ux + @dex-dev; **não criar backend novo** (o projeto não tem server actions).

---

## Risk / Edge cases

### Riscos

**R1 — ~~`Vlr Ref. AutoAvaliar` é presunção~~ — ✅ RESOLVIDO, não é mais risco**
Conferência empírica feita (mesmo método das outras colunas, 61 linhas × `repasses` em `subido`/`marcado`): **49 iguais, 0 diferem**, 10 sem comparar (banco null ou arquivo zero). Mapeamento `Vlr Ref. AutoAvaliar` → `valor_auto_avaliar` **confirmado**. A coluna já existe desde a migration `013_repasses_valor_auto_avaliar.sql`. A tabela de evidência agora valida **6 colunas**. Sem pendência, sem ação.

**R2 — `hojeLocal()` é uma armadilha latente de manutenção** ⚠️ MÉDIO
`src/lib/utils/data-local.ts` calcula a data no fuso **do processo**. Hoje **não é bug**: todos os call sites (`queries.ts:246,267,361`, `contato.ts:262`, `anuncio-queries.ts:100`) são importados apenas por componentes `"use client"`, e **não existe nenhum `"use server"` em `src/`** — então o processo é o navegador do Marcos, e o fuso do processo *é* o fuso dele. O risco é o dia em que alguém chamar `hojeLocal()` de um route handler ou server component: na Vercel o processo é UTC, a data sai um dia à frente, e o sintoma só aparece à noite. Passa em todo teste local.
**Mitigação (cabe nesta story, é barata):** (a) AC16 proíbe o caminho — nenhuma data de calendário desta story nasce em TypeScript, todas vêm de `public.hoje_brasilia()`; (b) fixar `America/Sao_Paulo` explicitamente em `hojeLocal()` via `Intl.DateTimeFormat` em vez de depender de `getFullYear()`/`getMonth()` locais; (c) um teste rodando com `TZ=UTC` que prove que `hojeLocal()` devolve o dia de Brasília. @quinn-qa deve grepar `hojeLocal`, `toISOString` e `current_date` no diff.

**R3 — O filtro de loja é string frágil, e falha para o lado errado** ⚠️ MÉDIO
`repasses.loja_origem` é `integer`; o `Loja` do arquivo é texto (`'NAVESA - GO/MATRIZ'`). Não há como cruzar com o banco — o filtro é comparação de string pura. Se o Auto Avaliar renomear a loja (`'NAVESA MATRIZ'`, `'NAVESA - GO / MATRIZ'`), **todas as linhas caem em "ignorados"** e o import vira um no-op que parece ter funcionado.
**Mitigação:** normalizar a string na comparação (trim + colapso de espaços + case/acento-insensitive) e, sobretudo, **fazer o preview gritar**: se 0 linhas forem importáveis e >0 forem ignoradas por loja, mostrar aviso destacado listando os nomes de loja encontrados no arquivo, em vez de um preview vazio silencioso. Já existe precedente exato disso no componente — a **trava de risco da reconciliação** (`avaliarRiscoReconciliacao`, checkbox "Confirmo que colei a lista completa" que bloqueia o botão de gravar). Reusar o mesmo padrão visual.

**R4 — SheetJS vem de tarball de CDN, não do registry npm** ⚠️ MÉDIO
`"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"`. Esta story torna o SheetJS **caminho crítico de um fluxo de produção** (hoje ele é mais periférico), e o projeto ainda carrega `exceljs` em paralelo — o ROADMAP já lista "consolidar libs XLSX" como débito. Se o CDN cair ou mudar a URL, o `npm ci` do CI e do build da Vercel quebra.
**Mitigação:** não resolver nesta story, mas registrar. Verificar que o `package-lock.json` fixa integridade e que o build da Vercel usa cache. Elevar a prioridade do item de consolidação no ROADMAP.

**R5 — Arquivo desatualizado sobrescreve dado mais novo** ⚠️ MÉDIO
O arquivo **não tem carimbo de data/hora**. Se o Marcos subir um download da semana passada (ou subir o arquivo depois de já ter colado o texto atualizado do mesmo carro), o sync escreve valores **mais velhos** por cima dos mais novos. Não há defesa técnica possível — o dado não carrega sua própria idade.
**Mitigação:** o preview **é** a mitigação. Toda mudança de valor aparece como `antes → depois` antes de confirmar; um valor regredindo fica visível. Reforçar isso na UI (@uma-ux): a seta `→` deve deixar óbvio o sentido da mudança.

**R6 — Semântica do zero difere entre dinheiro e contagem** ⚠️ BAIXO (decisão de parsing a documentar, não bug esperando acontecer)
A regra "zero é ausência" vale para dinheiro e **não** vale para contagem. Contagem no arquivo real: **61 de 61 linhas têm `Qtde Anuncios` não-zero — zero ocorrências de `0`**. Faz sentido por construção: é um relatório de *Veículos em Oferta*, o carro só entra se está anunciado. Então o caso não ocorre hoje.
**Mitigação:** manter a separação da AC3 como **design defensivo documentado** (se um dia o AA passar a listar carro pausado, o parser já está certo), sem tratá-la como risco ativo. O que importa de verdade é o inverso: as colunas de dinheiro **têm** zeros frequentes — `Vlr Ref. Web` só 25/61 preenchidas, `Vlr Maior Oferta` 37/61 — e é aí que a AC8 (COALESCE) carrega o peso.

**R7 — ~~Sobrecarga fantasma em `CREATE OR REPLACE FUNCTION`~~ — ✅ RESOLVIDO POR CONSTRUÇÃO**
O risco existia porque a rev. 1 propunha adicionar um parâmetro de origem à RPC existente. Com a decisão de **RPC nova e separada**, `importar_repasse_auto_avaliar(p_payload JSONB)` não é recriada nem alterada — não há assinatura para colidir. A função nova nasce com nome próprio. Sem ação.

**R8 — A garantia "arquivo nunca cria carro" existe só no browser** ⚠️ MÉDIO
Descoberta do mapeamento do código: **não há server action nem route handler**. `confirmarImport` chama `sb.rpc("importar_repasse_auto_avaliar", { p_payload })` **direto do navegador**, e a RPC, por design da Fatia 2, *"NÃO recalcula regra de negócio — ela só APLICA o snapshot já decidido pelo preview"*. Ou seja: a RPC continua aceitando `acao: "criar"` de quem chamar. A AC7 é uma regra de **cliente**, não uma trava de banco.
**Mitigação:** aceitável para single-user (o RLS `authenticated` já limita quem chama, e a superfície é o próprio Marcos logado). Mas o @dara-data-engineer deve avaliar se o flag de origem do arquivo pode **também** recusar `acao='criar'` no lado do banco — assim a garantia deixa de depender de código de UI. Registrar como decisão consciente se ficar só no cliente.

**R9 — Sem fixture binária no projeto, e o parser atual só aceita `string`** ⚠️ BAIXO
`parseAutoAvaliar` recebe `texto: string`; as duas fixtures existentes (`auto-avaliar-sample.txt`, `aa_real_validacao.txt`) são `.txt` lidas com `readFileSync(..., "utf8")`. Nenhum teste do projeto lê arquivo binário.
**Mitigação:** é um risco pequeno **justamente porque o `.xls` é HTML texto** — a fixture pode ser um `.txt`/`.html` lido como utf8 e entregue ao SheetJS como string, sem quebrar a convenção dos testes. O que **não** pode acontecer é adaptar o arquivo para o formato TAB do parser de texto e reusar `parseAutoAvaliar`: são fontes com colunas diferentes e semânticas de escrita diferentes (uma cria, a outra sincroniza). Parser separado, devolvendo sua própria estrutura.

**R10 — Limite de tamanho do upload** ⚠️ BAIXO
O processamento é 100% no navegador (padrão do `UploadDropzone`, que já usa `maxSize: 50MB`), então não há vetor de DoS de servidor. Ainda assim, um arquivo grande carregado em memória pelo SheetJS trava a aba.
**Mitigação:** reusar o teto do `UploadDropzone` (ou menor, ex.: 5 MB) e limitar número de linhas, com erro em pt-BR.

### Edge cases (todos precisam de comportamento definido)

1. **Placa repetida no arquivo** (mesmo carro em duas linhas) → tratar a última? a primeira? Definição: sinalizar como conflito no preview e **não** aplicar nenhuma das duas.
2. **Placa casa com mais de um repasse ativo** → a RPC do texto resolve com `ORDER BY id LIMIT 1`; a RPC nova **não deve** herdar esse silêncio — o preview mostra a ambiguidade e a linha é reportada como conflito (AC15), não escolhida sozinha.
3. **Repasse em `vendido`/`nao_vendido`/`cancelado`** com placa no arquivo → grupo "não encontradas" (AC6), com motivo explícito ("carro já saiu do ciclo").
4. **Arquivo só com cabeçalho / 0 linhas** → preview vazio com mensagem clara, botão de confirmar desabilitado.
5. **Célula com `R$ ` prefixado, `-`, `N/A` ou espaço em branco** → `null` para dinheiro; não estourar exceção.
6. **Acentuação no header** (`Versão`, `Ano Fab.`) → matching acento-insensitive (AC2); o arquivo é HTML e o encoding pode variar entre downloads.
7. **`Vlr Maior Oferta = 0,00`** → é "nenhuma oferta recebida ainda", não zero real. Regra de dinheiro se aplica → `null` (e AC8 impede que apague uma oferta registrada antes).
8. **Todos os 59 carros sem alteração** (caso mais comum a partir da 2ª semana) → o preview precisa ser útil nesse estado: "nada mudou" é a resposta correta e deve ser exibida com clareza, não como tela vazia.
9. **Arquivo cresce** (hoje 61 linhas; pode chegar a centenas) → o preview não pode virar N+1 de query; carregar os repasses candidatos em **uma** query por placa normalizada.
10. **Usuário fecha a aba com o preview aberto** → nada foi escrito; ao reabrir precisa subir o arquivo de novo (sem estado meio-aplicado).
11. **Duplo clique em "Confirmar"** → a segunda execução é inofensiva por idempotência (AC11), mas o botão deve travar mesmo assim.

---

## Complexity (T-shirt)

**L** _(revisado de M — o @pax-po estava certo)_

A rev. 1 estimou M assumindo "mudança cirúrgica numa RPC existente". A realidade é uma **RPC nova inteira** com semântica de escrita própria (COALESCE por campo), mais **migration**, mais **parser novo**, mais **preview de 3 grupos com diff campo a campo**, mais **duas colunas novas na listagem de `/repasses`** com leitura de decisão (AC19), mais o **roteiro de verificação manual** que substitui os testes que não existem. São cinco superfícies distintas, e três delas são código novo, não ajuste.

O que **segura** em L e não empurra para XL é a decisão de RPC separada: o fluxo de texto — o que roda todo dia — não é modificado, então não há trabalho de regressão nem janela de risco **daquele lado**. A AC18, porém, altera `types.ts` e `RepassesLista`, que são produção: a Fatia 3a é aditiva **sobre o fluxo de texto**, não sobre o sistema inteiro.

---

## Definition of Done

### Automatizado (`node:test`, funções puras — o que dá para automatizar hoje)
- [ ] Migration idempotente aplicada com `valor_maior_oferta` e `qtde_anuncios` + `COMMENT ON COLUMN`
- [ ] Fixture **ofuscada** em `tests/fixtures/` (sem placa/valor real) + constante `N_FIXTURE` declarada junto
- [ ] Parser: lê a fixture via SheetJS, devolve `N_FIXTURE` linhas com as 15 colunas (AC1, AC2)
- [ ] Códigos de erro tipados: um teste por código de AC4 (`ARQUIVO_ILEGIVEL`, `COLUNA_OBRIGATORIA_AUSENTE`, `ARQUIVO_SEM_LINHAS`, `ARQUIVO_GRANDE_DEMAIS`)
- [ ] Zero-é-ausência para dinheiro / zero-real para `Qtde Anuncios` (AC3)
- [ ] Filtro de loja no cliente: toda linha de outra loja vai para `outra_loja[]` e nenhuma entra no payload (AC5)
- [ ] **Invariante de soma de 4 baldes** (AC5), verificada sobre um retorno de RPC mockado — igualdade, não número fixo
- [ ] Tipos TS espelham o contrato §5 e o front renderiza a partir de `campos`, nunca de `patch` (AC13b)
- [ ] `hojeLocal()` fixa `America/Sao_Paulo` via `Intl.DateTimeFormat` + teste rodando com `TZ=UTC` (R2)

> **Perda consciente de cobertura automatizada, registrada por decisão.** Dois itens que a rev. 2 tinha aqui — *"classificação em 3 grupos é função pura"* e *"diff campo a campo"* — **saíram** do DoD automatizado e foram para o roteiro manual (passos 10 e 11). Motivo: a AC13b foi decidida a favor do desenho do Dara, e a classificação passou a viver dentro da RPC de preview. **Isto reabre parte do bloqueador B2** do @pax-po (regra de negócio sem teste automatizado) e é **aceito conscientemente**: o preço de manter a classificação testável em TS seria duas normalizações divergentes entre preview e gravação — uma tela que mente sobre o que vai gravar é pior que um teste manual. A dívida é endereçada pela **Fatia 3b, item 3** (harness contra Postgres), que é o que torna essa regra automatizável de verdade.
- [ ] Testes existentes de `import-auto-avaliar` e `parse-auto-avaliar` passam sem alteração (AC12, garantia fraca)
- [ ] Zero `any` no código novo; imports com `@/`
- [ ] `npm run test` 100% verde · `tsc` 0 erro · `npm run lint` 0 warning

### Roteiro de verificação manual — AC10, AC11, AC12, AC15, AC17
> Não há harness de teste contra Postgres no projeto. Estes passos são executados **uma vez**, no dev server contra o Supabase, com o arquivo real, e o resultado é colado no PR pelo @dex-dev. O @quinn-qa refaz os passos 2, 3 e 6.

1. **[AC12] Diff limpo.** `git diff --stat` **não** contém `supabase/migrations/025_*`, `supabase/migrations/028_*` nem `src/lib/repasses/parse-auto-avaliar.ts`.
2. **[AC10] RPC nova isolada + RPC antiga intacta.** `\df` é metacomando de psql e **não roda** no SQL editor do Supabase. Usar as queries 4 e 5 do §11 do desenho:
   ```sql
   -- 4) Nenhuma das duas é SECURITY DEFINER; preview é STABLE (esperado: f/s, f/v)
   SELECT proname, prosecdef, provolatile
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND proname LIKE 'sincronizar_repasse_arquivo_auto_avaliar%';

   -- 5) O corpo NÃO menciona o que não pode mencionar (esperado: 0 linhas)
   SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND proname LIKE 'sincronizar_repasse_arquivo_auto_avaliar%'
      AND (pg_get_functiondef(p.oid) ~* '(insert\s+into\s+repasses|repasse_gastos|valor_aquisicao|current_date)');
   ```
   E confirmar que a antiga segue lá, inalterada:
   ```sql
   SELECT pg_get_functiondef(p.oid) ~* 'DELETE\s+FROM\s+repasse_gastos' AS delete_ainda_existe
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND proname = 'importar_repasse_auto_avaliar';   -- esperado: true
   ```
2b. **[SEGURANÇA — GRANTs] `anon` não executa nada.** A migration `026_revoke_anon_rpc_leads.sql` nasceu de RPC exposta a `anon`; não repetir. Queries 2 e 3 do §11:
   ```sql
   -- esperado: false, false
   SELECT has_function_privilege('anon','public.sincronizar_repasse_arquivo_auto_avaliar_preview(jsonb)','EXECUTE'),
          has_function_privilege('anon','public.sincronizar_repasse_arquivo_auto_avaliar(jsonb)','EXECUTE');
   -- esperado: true, true
   SELECT has_function_privilege('authenticated','public.sincronizar_repasse_arquivo_auto_avaliar_preview(jsonb)','EXECUTE'),
          has_function_privilege('authenticated','public.sincronizar_repasse_arquivo_auto_avaliar(jsonb)','EXECUTE');
   ```
   **Este passo é bloqueante:** `anon = true` em qualquer uma das duas reprova o PR.
3. **[AC11] Duplo import.** Anotar o estado dos gastos e a margem real **com esta query** (`custo_real = valor_compra_repasse + Σ repasse_gastos`, nunca `valor_aquisicao`):
   ```sql
   SELECT r.id, r.placa,
          r.valor_compra_repasse,
          COALESCE(SUM(g.valor), 0)                            AS soma_gastos,
          r.valor_compra_repasse + COALESCE(SUM(g.valor), 0)   AS custo_real,
          COUNT(g.id) FILTER (WHERE g.tipo = 'auto_avaliar')   AS qtd_gastos_aa,
          COALESCE(SUM(g.valor) FILTER (WHERE g.tipo = 'auto_avaliar'), 0) AS soma_gastos_aa
     FROM repasses r
     LEFT JOIN repasse_gastos g ON g.repasse_id = r.id
    WHERE r.status IN ('marcado','subido')
    GROUP BY r.id, r.placa, r.valor_compra_repasse
    ORDER BY r.id;
   ```
   Salvar o resultado. Importar o arquivo. Importar **de novo**. Rodar a mesma query: `custo_real`, `qtd_gastos_aa` e `soma_gastos_aa` **idênticos** linha a linha. O `resumo` do 2º preview traz `com_alteracao = 0` e `linhas_gravadas = 0`.
4. **[AC17] Ausente do arquivo é intocado.** Anotar `atualizado_em` do repasse **QWB0G76** (subido, fora do arquivo). Após o import, `atualizado_em` **não mudou** e ele não apareceu em nenhum grupo do preview.
5. **[AC8] COALESCE em campo real.** Escolher um carro com `valor_web` preenchido cuja linha no arquivo traga `Vlr Ref. Web = 0,00` (há 36 candidatos). Após o import, `valor_web` **inalterado**.
6. **[AC15] Conflito não aborta.** Duplicar manualmente uma placa na cópia local do arquivo. Importar: os demais carros são aplicados, o conflito é reportado com a placa, e o resultado aparece como **atenção**.
7. **[AC13] Composição real.** Com o arquivo real, o preview mostra **57 sem alteração / 1 muda (RBM3C09) / 2 não encontradas (PRU3B12, TGK0B80) / 2 outra loja**.
8. **[AC18] Dado novo na tela.** Em `/repasses`, as colunas de maior oferta e qtde de anúncios aparecem preenchidas para os carros sincronizados e mostram `—` para os demais.
9. **[AC12] Texto sem regressão.** Colar um texto real do Auto Avaliar e importar; comportamento idêntico ao de antes, gasto `auto_avaliar` ressincronizado como sempre.
10. **[AC13b — migrado do DoD automatizado] Classificação nos 4 baldes.** Com o arquivo real, conferir que `resumo.sem_alteracao + resumo.com_alteracao + resumo.nao_encontradas + resumo.ignoradas = resumo.linhas_no_arquivo`, e que `outra_loja` (contado no cliente) fecha o total do arquivo. Conferir que cada `motivo` em `nao_encontradas[]` e `ignoradas[]` pertence ao enum fechado do §5.
11. **[AC13b/AC8 — migrado do DoD automatizado] Diff campo a campo.** Escolher um carro em `com_alteracao[]`: cada entrada de `campos[]` tem `antes`, `depois` e `acao` coerentes com o banco; `acao = "preenche"` só quando `antes` é null; nenhum campo com `depois: null`; e um campo que o arquivo trouxe zerado **não** aparece em `campos[]` (aparece, se for o caso, em `campos_observados_sem_mudanca`).
12. **[AC13c] `Valor Compra` zerado.** Numa cópia local do arquivo, zerar o `Valor Compra` de uma linha. Importar: a linha aparece em `ignoradas[]` com `motivo = "valor_compra_zerado"`, **não** em "sem alteração", e nenhum campo dela é gravado.
13. **[AC9b] Invariante no código.** O cabeçalho da migration `029` contém a invariante do ADR-002 item 3, nomeando o ADR.

- [ ] Roteiro acima executado e resultado colado no PR (passo **2b é bloqueante**)
- [ ] ROADMAP.md atualizado (incluindo a entrada da Fatia 3b)

---

## Handoff

1. **@pax-po** — revalidar a rev. 2 (bloqueadores 1, 2 e 3 endereçados; AC vagas nominalizadas; sizing L; fatiado 3a/3b)
2. **@dara-data-engineer** — DDL das 2 colunas + desenho da RPC nova `sincronizar_repasse_arquivo_auto_avaliar` (em curso, documento próprio)
3. **@uma-ux** — 3 grupos do preview + como a maior oferta vira sinal acionável na listagem (AC18/AC19)
4. **@dex-dev** — implementação + execução do roteiro manual do DoD
5. **@quinn-qa** — verdict, com foco em: diff limpo (AC12), passos **2, 2b, 3 e 6** do roteiro (2b é bloqueante), e **regressão de UI em `RepassesLista`**, que é produção (AC18)
6. **@gage-devops** — push/PR

### Pendência antes do @dex-dev começar
- [ ] Gerar a **fixture ofuscada** a partir de `C:\Users\marcos.jesus\Desktop\relatorio_VeiculosEmOferta.xls` (regras em *Dependências → Recursos externos*). O arquivo real **não vai pro repo**.
- [ ] @dara-data-engineer entregar o desenho da RPC `sincronizar_repasse_arquivo_auto_avaliar` (em documento próprio, em andamento)
- [x] ~~Validar o mapeamento `Vlr Ref. AutoAvaliar` → `valor_auto_avaliar`~~ — resolvido (49 iguais / 0 diferem). As 6 colunas estão confirmadas.
- [x] ~~Definir o mecanismo de proteção dos gastos~~ — resolvido: **RPC nova e separada**, a 028 não é tocada.

---

## Próxima fatia — 3b (backlog, não é escopo desta story)

A Fatia 3a deixa o sistema com **duas RPCs de importação Auto Avaliar** que fazem coisas parecidas com semânticas de escrita opostas. Isso é uma dívida consciente, aceita para que a 3a não encoste em produção. A 3b paga:

1. **Consolidar o `UPDATE` e o `DELETE` incondicionais do fluxo de texto.** Hoje `importar_repasse_auto_avaliar` grava os 6 campos de valor incondicionalmente (`028:255-263`) e apaga `repasse_gastos` do tipo `auto_avaliar` sem condição (`028:268-270`). É **contrato deliberado** daquela fonte — "colei a lista completa, o que não está nela não existe mais" — mas nunca foi explicitado como opção; virou implícito no código.
2. **Unificar as duas RPCs** atrás de uma noção explícita de *fonte* com semântica declarada (`afirma_estado_completo` × `afirma_só_o_que_observa`), em vez de duas funções paralelas divergindo com o tempo.
3. **Criar o harness de teste contra Postgres** — hoje inexistente, e é a razão de 5 AC desta story caírem em verificação manual. Sem ele, toda garantia de SQL do projeto depende de alguém lembrar de rodar um roteiro.
4. **Reavaliar R8** (a trava "arquivo nunca cria carro" vive só no browser) à luz da RPC unificada.

**Gatilho sugerido:** quando a 3ª fonte de dados aparecer (API do Auto Avaliar, já no backlog do ROADMAP) — aí duas RPCs viram três e o custo de não unificar passa a doer. Ou antes, se o item 3 for priorizado por si só.
