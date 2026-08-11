# Desenho — RPC de sincronização por ARQUIVO do Auto Avaliar

**Autora:** Dara (data engineer) · **Data:** 2026-08-11 · **Status:** desenho, não implementado
**Escopo:** documento de design. Nenhuma migration foi criada, nada foi aplicado no banco.
**Não altera** `supabase/migrations/028_datas_de_calendario_em_brasilia.sql` nem a RPC `importar_repasse_auto_avaliar`.

---

## 0. Resumo executivo

| Item | Decisão |
|---|---|
| Funções | **Duas**: `..._preview` (STABLE, read-only) e `...` (VOLATILE, aplica). A de aplicar **chama** a de preview — o diff é calculado uma vez só, em um lugar só. |
| Nomes | `sincronizar_repasse_arquivo_auto_avaliar_preview(jsonb)` e `sincronizar_repasse_arquivo_auto_avaliar(jsonb)` |
| Escrita parcial | `COALESCE(observado, coluna)` sobre **whitelist estática de 8 colunas**, com guarda `IS DISTINCT FROM` que impede UPDATE em linha sem mudança real |
| Colunas novas | `repasses.valor_maior_oferta numeric(12,2) NULL`, `repasses.qtde_anuncios integer NULL CHECK (>= 0)` |
| Índices novos | **Nenhum.** `idx_repasses_placa_norm` (025) já cobre o match |
| Segurança | `SECURITY INVOKER` + `SET search_path = public` + GRANT explícito para `authenticated`/`service_role`, REVOKE de `anon`/`public` |
| Cria repasse? | **Nunca.** Não existe `INSERT INTO repasses` no corpo das funções |
| Toca `repasse_gastos`? | **Nunca.** A string `repasse_gastos` não aparece no corpo das funções |

---

## 1. Por que uma RPC nova (e não parametrizar a 028)

A decisão já foi tomada pela arquitetura; registro aqui os motivos que **também** valem do ponto de vista de banco, porque eles mudam o desenho:

1. **`CREATE OR REPLACE FUNCTION` com assinatura diferente cria sobrecarga, não substitui.** `importar_repasse_auto_avaliar(jsonb)` e `importar_repasse_auto_avaliar(jsonb, boolean)` conviveriam. PostgREST resolveria a chamada pelos nomes dos parâmetros do JSON body — e uma chamada antiga que não mandasse o novo parâmetro cairia silenciosamente na versão antiga, destrutiva. Bug de produção invisível.
2. **Semântica oposta no mesmo corpo.** A 028 é "espelho da tela": o que não veio, não existe (por isso `NULLIF(...)` incondicional e `DELETE` de gastos). A do arquivo é "patch": o que não veio, não foi observado. Um `IF p_modo = 'arquivo'` dentro do mesmo `UPDATE` transformaria cada uma das 6 colunas em um `CASE` e as duas semânticas passariam a compartilhar destino de teste.
3. **A 028 tem privilégio que a nova não precisa**: ela `INSERT`a em `repasses` e `DELETE`a em `repasse_gastos`. A garantia "o arquivo nunca cria carro e nunca apaga gasto" fica muito mais forte quando é **ausência de statement** do que quando é um `IF` que alguém pode reordenar.

A contrapartida honesta está na seção 9 (risco de ordem de execução entre os dois fluxos).

---

## 2. Nomes e assinaturas

Nomenclatura do projeto: verbo em pt-BR + objeto (`importar_repasse_auto_avaliar`, `marcar_lead_contatado`, `fila_disparo_whatsapp`). Mantenho a raiz sugerida e diferencio o preview por sufixo, para que as duas apareçam juntas em qualquer `\df sincronizar*` e em qualquer grep.

```sql
-- READ-ONLY. Calcula o diff e devolve o relatório em 3 grupos. Não escreve nada.
CREATE OR REPLACE FUNCTION public.sincronizar_repasse_arquivo_auto_avaliar_preview(
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
STABLE                      -- ← a engine PROÍBE UPDATE/INSERT/DELETE aqui dentro
SECURITY INVOKER
SET search_path = public;

-- APLICA. Recalcula o diff chamando a função acima e escreve. Uma transação.
CREATE OR REPLACE FUNCTION public.sincronizar_repasse_arquivo_auto_avaliar(
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public;
```

Comprimento: 48 e 40 caracteres — folgado dentro do limite de 63 do identificador Postgres.

### 2.1 Por que duas funções, e não uma com `p_dry_run boolean`

Considerei três formatos:

| Alternativa | Problema |
|---|---|
| **(a) Uma função com `p_dry_run boolean DEFAULT true`** | O read-only vira uma promessa do código, não do banco. Um `IF NOT p_dry_run THEN` mal aninhado grava. Pior: o valor do flag vem do **navegador** — e esse projeto não tem nenhuma camada de servidor entre o browser e a RPC (não existe `"use server"` nem route handler em `src/`). Um payload adulterado com `p_dry_run: false` grava na tela de preview. Rejeitada. |
| **(b) Duas funções independentes, cada uma com seu diff** | Duas implementações da mesma normalização (zero→ausência, arredondamento, tipagem estrita). Elas divergem na primeira manutenção e o preview passa a mentir sobre o que a gravação faz. É o pior defeito possível numa tela de confirmação. Rejeitada. |
| **(c) Duas funções, a de aplicar CHAMA a de preview** | **Escolhida.** |

O que (c) compra:

- **Read-only garantido pela engine.** `STABLE` não é documentação: se alguém escrever um `UPDATE` dentro do preview, o Postgres estoura em runtime com `ERROR: UPDATE is not allowed in a non-volatile function`. Não dá pra "esquecer de checar o flag".
- **Zero duplicação de regra.** Existe uma única implementação de "o que este arquivo observa e o que isso muda". A função de aplicar consome o resultado dela.
- **Sem confiança no cliente.** A confirmação **não** recebe o diff que o usuário viu na tela; ela recalcula do zero contra o banco vivo, a partir do mesmo payload bruto. O cliente não consegue confirmar uma mudança que o banco não derivaria sozinho.
- **Relatório idêntico nas duas etapas.** O retorno da confirmação tem exatamente o mesmo formato do preview, com `modo: "aplicado"`. O front reaproveita o componente de tela e pode diffar preview × aplicado para detectar "mudou entre o preview e o OK".

Custo aceito: o diff roda duas vezes (uma no preview, uma na confirmação). São 61 linhas contra uma tabela de poucas centenas de repasses ativos. Irrelevante.

> Nota PostgREST: `supabase-js.rpc()` faz POST. Chamar uma função `STABLE` via POST funciona normalmente — a volatilidade não impede a chamada, só impede a escrita. Não é preciso usar `{ get: true }`.

---

## 3. Payload de entrada

```jsonc
{
  "versao": 1,
  "origem": "arquivo_xls",
  "linhas": [
    {
      "linha": 3,                         // nº da linha no arquivo — só pra reportar de volta
      "placa": "ABC-1D23",                // CRUA. A RPC normaliza; não confia em placa_norm do cliente
      "valor_compra_repasse": 68000,
      "valor_minimo":         71900,
      "valor_compre_por":     74900,
      "valor_fipe":           72300,
      "valor_web":            null,       // não observado
      "valor_auto_avaliar":   70100,
      "valor_maior_oferta":   66000,
      "qtde_anuncios":        4
    }
  ]
}
```

Decisões do contrato:

1. **As chaves são nomes de COLUNA, não rótulos do arquivo.** O mapeamento `"Vlr Ref. Web" → valor_web` mora no parser SheetJS, no cliente. A RPC não conhece rótulo de fornecedor — quando o Auto Avaliar renomear uma coluna do export, muda só o parser, e a whitelist estática do SQL continua intacta.
2. **`placa` crua, normalizada dentro da RPC** com `regexp_replace(upper(placa),'[^A-Z0-9]','','g')`. Duas razões: é uma coisa a menos pra confiar no cliente, e garante que a expressão do match seja *literalmente* a mesma do índice funcional `idx_repasses_placa_norm`.
3. **Chave ausente ≡ chave com `null`.** As duas formas significam "não observado". Serializadores diferem (`JSON.stringify` omite `undefined`, mantém `null`); aceitar as duas evita bug de borda no cliente.
4. **Sem `repasse_id` no payload.** Ver seção 8 — o match é feito no servidor, por placa. Isto é uma melhoria deliberada sobre a 028, que aceita `repasse_id` do cliente no caminho `atualizar`.
5. **Sem `chassi`, sem `status`, sem `canal`, sem `gastos`, sem `km`, sem `cor`.** Nada que a função não vá usar entra no payload. Superfície mínima.
6. **Sem bloco `reconciliacao`.** O arquivo não observa venda. Ausência de placa no arquivo não significa nada (seção 9, caso 5).
7. **Teto de tamanho:** `jsonb_array_length(p_payload->'linhas') > 2000` → `RAISE EXCEPTION`. Hoje são 61 linhas; o teto existe para que um payload adulterado não vire DoS de CPU no Postgres compartilhado.

---

## 4. Estratégia de escrita parcial

### 4.1 Normalização na fronteira (uma implementação só)

Antes de comparar qualquer coisa, cada célula vira um "observado" ou um NULL:

```sql
-- valor monetário observado: só aceita JSON number; 0 é ausência; arredonda a 2 casas
CREATE OR REPLACE FUNCTION public.aa_arq_valor_obs(p_item jsonb, p_chave text)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
           WHEN jsonb_typeof(p_item -> p_chave) = 'number'
           THEN NULLIF(round((p_item ->> p_chave)::numeric, 2), 0)
         END
$$;

-- contagem observada: só aceita JSON number; ZERO É VALOR REAL (não vira NULL); negativo é lixo
CREATE OR REPLACE FUNCTION public.aa_arq_qtde_obs(p_item jsonb, p_chave text)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
           WHEN jsonb_typeof(p_item -> p_chave) = 'number'
                AND (p_item ->> p_chave)::numeric >= 0
           THEN trunc((p_item ->> p_chave)::numeric)::integer
         END
$$;
```

Três detalhes que não são cosméticos:

- **`jsonb_typeof(...) = 'number'`, não `->>` + cast direto.** A 028 faz `NULLIF(v_reg->>'campo','')::numeric`. Se uma célula chegar como `"R$ 68.000"`, esse cast estoura `22P02` e **aborta a transação inteira** — 61 linhas perdidas por uma célula. Com a checagem de tipo, célula inválida vira "não observado" e a linha é reportada, não explode. Endurecimento em relação à 028.
- **`round(..., 2)`.** O `.xls` do Auto Avaliar é HTML lido por SheetJS; valores em pt-BR (`"71.900,00"`) passam por parsing de float e podem chegar como `71900.00000000001`. Sem arredondamento isso é um diff falso, um UPDATE desnecessário e uma violação da regra centavo-perfect do projeto. Arredondar **no servidor** (não só no parser) é o que garante a regra, já que o parser roda no navegador.
- **`NULLIF(..., 0)` só nos monetários.** `Qtde Anuncios = 0` é uma medição real ("está sem anúncio ativo") e precisa ser gravável. É o único campo onde zero ≠ ausência.

### 4.2 O padrão de escrita: `COALESCE` + guarda `IS DISTINCT FROM`

```sql
UPDATE repasses r SET
  valor_compra_repasse = COALESCE(o.valor_compra_repasse, r.valor_compra_repasse),
  valor_minimo         = COALESCE(o.valor_minimo,         r.valor_minimo),
  valor_compre_por     = COALESCE(o.valor_compre_por,     r.valor_compre_por),
  valor_fipe           = COALESCE(o.valor_fipe,           r.valor_fipe),
  valor_web            = COALESCE(o.valor_web,            r.valor_web),
  valor_auto_avaliar   = COALESCE(o.valor_auto_avaliar,   r.valor_auto_avaliar),
  valor_maior_oferta   = COALESCE(o.valor_maior_oferta,   r.valor_maior_oferta),
  qtde_anuncios        = COALESCE(o.qtde_anuncios,        r.qtde_anuncios),
  atualizado_em        = now()
FROM v_observado o
WHERE r.id = o.repasse_id
  AND r.status IN ('subido','marcado')          -- guarda de escopo, redundante mas barata
  AND (                                          -- guarda de mudança real
       (o.valor_compra_repasse IS NOT NULL AND o.valor_compra_repasse IS DISTINCT FROM r.valor_compra_repasse)
    OR (o.valor_minimo         IS NOT NULL AND o.valor_minimo         IS DISTINCT FROM r.valor_minimo)
    OR (o.valor_compre_por     IS NOT NULL AND o.valor_compre_por     IS DISTINCT FROM r.valor_compre_por)
    OR (o.valor_fipe           IS NOT NULL AND o.valor_fipe           IS DISTINCT FROM r.valor_fipe)
    OR (o.valor_web            IS NOT NULL AND o.valor_web            IS DISTINCT FROM r.valor_web)
    OR (o.valor_auto_avaliar   IS NOT NULL AND o.valor_auto_avaliar   IS DISTINCT FROM r.valor_auto_avaliar)
    OR (o.valor_maior_oferta   IS NOT NULL AND o.valor_maior_oferta   IS DISTINCT FROM r.valor_maior_oferta)
    OR (o.qtde_anuncios        IS NOT NULL AND o.qtde_anuncios        IS DISTINCT FROM r.qtde_anuncios)
  );
```

**Como isso satisfaz "só escreve o que observa":** o `COALESCE` faz cada coluna cair de volta no próprio valor quando o observado é NULL. Um campo não observado é escrito com o valor que já estava lá — semanticamente um no-op. Nenhum caminho do código consegue gravar NULL por cima de valor existente, porque `COALESCE(NULL, r.coluna)` nunca é NULL quando `r.coluna` não é.

**O que a guarda de mudança real compra:** sem ela, as 22 linhas do grupo "sem alteração" ainda sofreriam UPDATE — mesma tupla reescrita, `atualizado_em = now()`, trigger disparado, WAL gravado. E `atualizado_em` é visível na UI: o usuário veria 61 carros "atualizados agora" tendo mudado 35. A guarda faz o grupo 1 do preview ser literalmente "o banco não foi tocado", não "foi tocado com o mesmo valor". `ROW_COUNT` passa a ser a contagem honesta de linhas alteradas.

**Sobre `IS DISTINCT FROM` em `numeric`:** compara valor, não escala. `71900.00` e `71900.0` são iguais — não geram diff falso. (É `numeric`, não `float`; era mais um motivo pra `numeric` já ser o tipo certo aqui.)

**Sobre `atualizado_em = now()`:** tecnicamente redundante — `trg_repasses_atualizado_em` (migration 008) já faz isso em todo UPDATE. Mantenho explícito por paridade com a 028 e legibilidade; o trigger sobrescreve com o mesmo `now()` da transação.

### 4.3 Alternativas descartadas

**Alternativa B — SQL dinâmico montando o `SET` só com as colunas observadas.**

```sql
-- NÃO FAZER
v_sets := string_agg(format('%I = %L', chave, valor), ', ') FROM jsonb_each(v_item);
EXECUTE format('UPDATE repasses SET %s WHERE id = $1', v_sets) USING v_id;
```

É a leitura mais literal de "só escreve o que observa": as colunas não observadas nem aparecem no comando. E é a pior opção aqui, por três motivos.

1. **Os nomes de coluna viriam do navegador.** Esta RPC é a única fronteira de confiança que o sistema tem — não há `"use server"` em `src/`. Montar `%I` a partir de chaves de um JSON adulterável significa que o conjunto de colunas graváveis passa a ser escolhido pelo atacante. Um payload com `{"status": "vendido"}` ou `{"valor_aquisicao": 1}` viraria SQL válido. Daria pra mitigar com uma whitelist antes do `format`, mas aí a whitelist volta a ser estática e o dinamismo só custou legibilidade.
2. **Sem plano cacheado.** Cada combinação de colunas gera um texto de comando diferente; o `EXECUTE` replaneja sempre. Para 61 linhas é invisível, mas é custo sem contrapartida.
3. **Não se lê.** O `UPDATE` da alternativa A é auditável em 10 segundos: dá pra ver, olhando, que `valor_aquisicao` e `repasse_gastos` não estão lá. O dinâmico exige provar uma propriedade sobre strings.

**Alternativa C — `jsonb_populate_record` (merge nativo de record).**

```sql
-- NÃO FAZER com patch vindo do cliente
UPDATE repasses r SET (...) = (SELECT ... FROM jsonb_populate_record(r.*, p_patch));
```

Tecnicamente elegante: `jsonb_populate_record` preenche do record base as chaves ausentes no JSON, que é exatamente a semântica de patch parcial, sem escrever um `COALESCE` por coluna. Descartada por duas razões:

- Herda o mesmo problema da B em forma mais silenciosa: **qualquer coluna de `repasses` presente no JSON é aplicada.** `status`, `canal`, `valor_aquisicao`, `data_vendido` — tudo gravável por payload. E aqui não há nem um `%I` visível pra denunciar.
- Uma chave presente com valor JSON `null` **grava NULL**, em vez de preservar. Ou seja, a distinção "ausente vs null" — que eu quis deliberadamente colapsar no contrato (seção 3, item 3) — voltaria a ser semântica, e um `JSON.stringify` que serializa `null` em vez de omitir apagaria dado. É exatamente o bug que este desenho existe pra evitar.

**Alternativa D — `INSERT ... ON CONFLICT DO UPDATE` com `EXCLUDED`.** Não se aplica: exigiria um `INSERT`, e "nunca cria repasse" é requisito. Mesmo com `WHERE` no `DO UPDATE`, ter um `INSERT INTO repasses` no corpo derrota a garantia estrutural da seção 8.

---

## 5. Formato de retorno

Objeto JSONB único, mesmo formato para preview e para aplicação (segue a convenção JSONB in / JSONB out das migrations 018, 025 e 028).

```jsonc
{
  "versao": 1,
  "modo": "preview",                      // "preview" | "aplicado"
  "gerado_em": "2026-08-11T14:32:07-03:00",
  "resumo": {
    "linhas_no_arquivo": 61,
    "sem_alteracao":     22,
    "com_alteracao":     35,
    "nao_encontradas":    3,
    "ignoradas":          1,
    "campos_a_alterar":  87,
    "linhas_gravadas":    0                // 0 no preview; ROW_COUNT real no aplicado
  },

  // GRUPO 2 — vão mudar (o grupo que o usuário realmente lê)
  "com_alteracao": [
    {
      "linha": 3,
      "placa_norm": "ABC1D23",
      "repasse_id": 412,
      "modelo": "ONIX 1.0 LT",
      "status": "subido",
      "campos": [
        { "campo": "valor_web",          "antes": null,     "depois": 72500.00, "acao": "preenche" },
        { "campo": "valor_fipe",         "antes": 71000.00, "depois": 71900.00, "acao": "altera"   },
        { "campo": "valor_maior_oferta", "antes": 66000.00, "depois": 64000.00, "acao": "altera"   }
      ],
      "campos_observados_sem_mudanca": ["valor_compra_repasse","valor_minimo","qtde_anuncios"],
      "patch": { "valor_web": 72500.00, "valor_fipe": 71900.00, "...": "..." }   // interno
    }
  ],

  // GRUPO 1 — sem alteração
  "sem_alteracao": [
    { "linha": 5, "placa_norm": "XYZ4A56", "repasse_id": 388, "modelo": "HB20 1.0",
      "campos_observados": 6 }
  ],

  // GRUPO 3a — placa do arquivo que não casou com repasse ativo
  "nao_encontradas": [
    { "linha": 14, "placa_norm": "QRS7B89", "motivo": "sem_repasse" },
    { "linha": 22, "placa_norm": "TUV1C23", "motivo": "repasse_inativo", "status_atual": "vendido" }
  ],

  // GRUPO 3b — linhas descartadas antes do match
  "ignoradas": [
    { "linha": 47, "placa_norm": "ABC1D23", "motivo": "placa_duplicada_no_arquivo" },
    { "linha": 58, "placa_norm": null,      "motivo": "placa_invalida" },
    { "linha": 60, "placa_norm": "DEF2E34", "motivo": "nenhum_campo_observado" },
    { "linha": 12, "placa_norm": "GHI3F45", "motivo": "repasse_ambiguo", "repasse_ids": [201, 377] }
  ]
}
```

Decisões do formato:

- **Os três grupos da tela são três arrays do retorno.** O front não precisa reagrupar nem recalcular nada — ele renderiza. Toda a regra fica no banco, que é onde ela é aplicada.
- **`campos[]` só lista o que muda; `antes`/`depois` vêm par a par.** O que não foi observado simplesmente não aparece — a ausência no relatório *é* a semântica "o arquivo não falou disso". Não existe `{"depois": null}` em lugar nenhum.
- **`acao: "preenche" | "altera"`.** Distinção que vale ouro na tela: preencher um buraco (`antes: null`) é seguro e pode vir agrupado/colapsado; mudar um número que já existia merece destaque. Sem isso o usuário revisa 87 campos com o mesmo peso visual.
- **`campos_observados_sem_mudanca`** dá ao usuário a leitura "o arquivo confirmou estes, iguais ao que está no banco" — evita a dúvida "cadê o valor_compra que eu sei que veio no arquivo?".
- **`motivo` é enum fechado**, para o front mapear em mensagem pt-BR: `sem_repasse`, `repasse_inativo`, `placa_duplicada_no_arquivo`, `placa_invalida`, `nenhum_campo_observado`, `repasse_ambiguo`.
- **`repasse_inativo` separado de `sem_repasse`.** Custa um lookup a mais (sem o filtro de status) e responde a pergunta que o usuário faz de verdade: "esse carro sumiu do sistema ou já foi vendido?".
- **`patch`** é o objeto de valores observados já normalizados, produzido **pela própria RPC**. É o que a função de aplicar consome (seção 2.1) e o que garante que preview e gravação usem a mesma normalização. O front deve renderizar a partir de `campos`, não de `patch`.
- **Teto de payload de resposta:** se `linhas_no_arquivo > 500`, devolver `resumo` completo e truncar os arrays em 200 itens cada, com `"truncado": true`. Em 61 linhas o retorno fica na casa de 20–40 KB, sem problema; o teto existe pro dia em que o arquivo crescer.

### 5.1 Detecção de deriva entre preview e confirmação

A confirmação recalcula tudo, então **nunca grava um `antes` obsoleto**. Mas ela pode gravar uma mudança que o usuário não viu na tela (alguém editou o carro no meio do caminho). Como o retorno da confirmação tem o mesmo formato do preview, o front consegue diffar os dois `com_alteracao` e avisar: *"3 carros mudaram entre a conferência e a confirmação"*. Custo zero de banco.

**Não recomendo optimistic locking por campo agora** (mandar o `antes` de volta e recusar se divergir). O projeto é declaradamente single-user no MVP (`008_create_repasses.sql`: *"Single user no MVP — sem segregação"*), e a complexidade de resolver conflito na UI não se paga. Revisitar quando houver segundo usuário simultâneo.

---

## 6. DDL das colunas novas

```sql
-- Idempotente (ADD COLUMN IF NOT EXISTS) — roda 2x sem erro.
ALTER TABLE repasses ADD COLUMN IF NOT EXISTS valor_maior_oferta numeric(12, 2);
COMMENT ON COLUMN repasses.valor_maior_oferta IS
  'Maior oferta recebida no Auto Avaliar ("Vlr Maior Oferta"), vinda do arquivo .xls. '
  'numeric(12,2) centavo-perfect. NULL = nenhuma oferta observada (distinto de R$ 0,00). '
  'Preenchimento observado: 37/61 no arquivo de referência.';

ALTER TABLE repasses ADD COLUMN IF NOT EXISTS qtde_anuncios integer;
ALTER TABLE repasses DROP CONSTRAINT IF EXISTS repasses_qtde_anuncios_check;
ALTER TABLE repasses ADD  CONSTRAINT repasses_qtde_anuncios_check
  CHECK (qtde_anuncios >= 0);
COMMENT ON COLUMN repasses.qtde_anuncios IS
  'Quantidade de anúncios ativos do carro no Auto Avaliar ("Qtde Anuncios"), vinda do arquivo .xls. '
  'NULL = não medido (carro que nunca passou pelo arquivo). ZERO É VALOR REAL: "medido, sem anúncio". '
  'Único campo do arquivo em que 0 não significa ausência.';
```

**`valor_maior_oferta numeric(12, 2)` NULL**

- **`numeric(12,2)`** porque é dinheiro. Regra 4 do projeto e precedente de todas as colunas irmãs (`valor_fipe`, `valor_web`, `valor_compre_por`, `valor_compra_repasse`). `real`/`double` está fora de questão — a margem de repasse é comparada centavo a centavo contra o NBS. `12,2` comporta R$ 9.999.999.999,99, folga absurda pra um carro.
- **Nullable, e nunca `NOT NULL DEFAULT 0`.** "Nenhuma oferta recebida" e "oferta de R$ 0,00" são fatos diferentes, e `0` seria uma afirmação falsa sobre 24 dos 61 carros. Além disso, `NOT NULL DEFAULT 0` no `ALTER TABLE` escreveria zero em todo o histórico de repasses que nunca passou pelo arquivo — inventando dado retroativamente.
- **Sem `CHECK (>= 0)`**, por paridade: nenhuma das colunas monetárias de `repasses` tem check de sinal. Introduzir uma regra só aqui cria inconsistência sem ganho — o valor vem de um arquivo que não produz negativo.

**`qtde_anuncios integer` NULL `CHECK (>= 0)`**

- **`integer`, não `smallint`.** Convenção do projeto para contagens (`ano_modelo`, `km`, `loja_origem`, `ordem` são todos `integer`). O ganho de 2 bytes do `smallint` é comido pelo alinhamento da tupla — economia zero, inconsistência real.
- **Nullable.** Mesmo argumento do anterior, e mais forte: hoje o preenchimento é 61/61 no arquivo, mas a coluna vive numa tabela onde a maioria das linhas **nunca vai passar pelo arquivo**. Para essas, `0` afirmaria "medi e não tem anúncio", que é falso. `NULL` = "não medido". Esta distinção é literalmente a mesma que motiva a RPC inteira; seria incoerente escrever a RPC pra preservá-la e depois destruí-la no DEFAULT da coluna.
- **`CHECK (qtde_anuncios >= 0)`** aqui sim, porque é contagem: negativo não é "valor incomum", é dado corrompido, e vale falhar alto. `NULL >= 0` avalia como `NULL`, que um CHECK aceita — então a constraint não impede o nullable. `DROP CONSTRAINT IF EXISTS` antes do `ADD` mantém a idempotência (padrão das migrations 010, 011 e 024).

**RLS:** nada a fazer. A policy `authenticated_all_access` de `repasses` é por **linha**, não por coluna — colunas novas herdam automaticamente (mesma observação que a 025 e a 023 registram).

---

## 7. Índices

**Nenhum índice novo. Justificativa por caminho de acesso:**

| Caminho | Índice usado | Veredito |
|---|---|---|
| Match `regexp_replace(upper(placa),'[^A-Z0-9]','','g') = :placa_norm` | `idx_repasses_placa_norm` (índice funcional, migration 025) | Já existe e é *exatamente* a mesma expressão. Reuso direto — foi por isso que a 025 criou índice funcional em vez de btree plano em `placa`. |
| Filtro `status IN ('subido','marcado')` | `idx_repasses_status` (migration 008) | Existe. Na prática o planner vai usar o de placa e aplicar status como filtro; um composto `(placa_norm, status)` não se paga. |
| `WHERE r.id = o.repasse_id` no UPDATE | PK | — |
| Colunas novas em `WHERE`/`ORDER BY` | — | Não há consulta planejada que filtre por `valor_maior_oferta` ou `qtde_anuncios`. |

Ordem de grandeza que sustenta a decisão: `repasses` tem poucas centenas de linhas ativas e o arquivo traz 61. Nesse volume o planner provavelmente escolhe seq scan + hash join, e isso é o **correto** — índice em tabela pequena é overhead de escrita sem ganho de leitura. O índice funcional da 025 continua valendo porque protege o crescimento sem custar nada hoje.

**Gatilhos para revisitar:**
- `repasses` passar de ~50 mil linhas (não vai tão cedo);
- surgir um painel que filtre `qtde_anuncios = 0` ou ordene por `valor_maior_oferta` sobre o histórico inteiro → aí sim, índice parcial `WHERE status IN ('subido','marcado')`;
- o arquivo passar de algumas centenas de linhas por importação.

Verificar com `EXPLAIN (ANALYZE, BUFFERS)` na primeira execução real, com o arquivo de 61 linhas.

---

## 8. Segurança

### 8.1 Volatilidade, `search_path` e `SECURITY`

`SECURITY INVOKER` nas duas funções, `SET search_path = public` nas duas. É o padrão de `importar_repasse_auto_avaliar` (025/028) e é a decisão certa aqui:

- **`SECURITY INVOKER` faz o RLS valer.** As funções rodam com os privilégios de quem chama, então a policy `authenticated_all_access` (`auth.uid() is not null`) é avaliada de verdade. Um chamador sem sessão enxerga zero linhas em `repasses`: o preview devolve tudo em `nao_encontradas` e o UPDATE casa zero linhas. **Esse é o backstop real**, não o GRANT.
- **`SECURITY DEFINER` seria um erro grave aqui.** Nada nestas funções precisa de privilégio elevado — elas só leem e escrevem `repasses`, que o usuário autenticado já pode ler e escrever direto pela tabela. DEFINER converteria uma RPC chamável do navegador em caminho de escrita que **ignora RLS**. Foi exatamente essa combinação (DEFINER + `anon` com EXECUTE) que produziu o vazamento de PII corrigido pela `026_revoke_anon_rpc_leads.sql`. Não repetir.
- **`SET search_path = public`** impede sequestro de resolução de nome (um `search_path` do cliente apontando pra um schema com uma tabela `repasses` falsa). Obrigatório em qualquer função exposta via PostgREST.

### 8.2 GRANTs explícitos

```sql
REVOKE EXECUTE ON FUNCTION public.sincronizar_repasse_arquivo_auto_avaliar_preview(jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.sincronizar_repasse_arquivo_auto_avaliar_preview(jsonb) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.sincronizar_repasse_arquivo_auto_avaliar(jsonb)         FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.sincronizar_repasse_arquivo_auto_avaliar(jsonb)         TO authenticated, service_role;

-- helpers puros (não tocam tabela); ainda assim, sem anon
REVOKE EXECUTE ON FUNCTION public.aa_arq_valor_obs(jsonb, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.aa_arq_qtde_obs(jsonb, text)  FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.aa_arq_valor_obs(jsonb, text) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.aa_arq_qtde_obs(jsonb, text)  TO authenticated, service_role;
```

**Por que declarar, se o RLS já protege.** O Postgres concede `EXECUTE` a `PUBLIC` por padrão em toda função nova — ou seja, sem `REVOKE`, `anon` sai com permissão de execução no instante em que a migration roda. Hoje isso é inofensivo (INVOKER + RLS barram), mas cria uma armadilha: no dia em que alguém trocar para `SECURITY DEFINER` "pra resolver um problema de permissão", o buraco abre **em silêncio**, sem nenhuma linha de migration mencionando `anon`. Foi assim que a 020 virou a 026. Revogar agora custa 4 linhas e torna a intenção legível junto do código que ela protege.

A nota da 028 (linhas 547–548) diz que `importar_repasse_auto_avaliar` ficou sem GRANT explícito porque "mexer agora mudaria o comportamento" — argumento de retrocompatibilidade que **não se aplica a uma função nova**. Função nova nasce com os grants certos.

### 8.3 Modelo de ameaça: payload adulterado

A RPC é a única fronteira de confiança do sistema — não existe `"use server"` nem route handler em `src/`, então toda chamada sai do navegador e o payload é integralmente controlável pelo cliente. O que um payload hostil consegue e o que não consegue:

| Ataque | Bloqueio | Onde vive a garantia |
|---|---|---|
| Criar repasse ("carro fantasma") | **Não existe `INSERT INTO repasses` no corpo.** Nenhum caminho, nenhum `IF`, nenhum flag. | Estrutural — ausência de statement |
| Apagar/alterar `repasse_gastos` | **A string `repasse_gastos` não aparece no corpo.** | Estrutural |
| Zerar `valor_aquisicao` (custo NBS) | Não está na whitelist de 8 colunas do `SET`. | Whitelist estática, sem SQL dinâmico |
| Mudar `status`, `canal`, `data_vendido`, `valor_vendido` | Idem — fora da whitelist. | Whitelist estática |
| Apontar a escrita para um repasse arbitrário | **O payload não carrega `repasse_id`.** O match é feito no servidor, por placa normalizada, com escopo `status IN ('subido','marcado')`. | Match server-side |
| Apagar um valor existente (gravar NULL) | `COALESCE(observado, coluna)` nunca resulta em NULL sobre coluna preenchida. | Padrão de escrita |
| Zerar `valor_web` mandando `0` | `NULLIF(..., 0)` transforma zero em "não observado" **no servidor**, não no parser. | Normalização server-side |
| Injetar SQL por nome de coluna | Não há `EXECUTE format(...)`. Nenhum SQL dinâmico. | Estrutural |
| Estourar a transação com célula lixo (`"R$ 68.000"`) | `jsonb_typeof(...) = 'number'` → vira "não observado" e é reportado; não há cast que possa levantar `22P02`. | Normalização estrita |
| DoS por payload gigante | `jsonb_array_length > 2000` → `RAISE EXCEPTION`. | Guarda de entrada |
| Chamar sem estar logado | INVOKER + RLS: zero linhas visíveis, zero linhas escritas. E `anon` sem `EXECUTE`. | RLS + GRANT |
| Chamar a versão "aplicar" achando que é preview | Funções separadas, sem flag. O preview é `STABLE` — a engine recusa escrita. | Volatilidade |

**O que um payload adulterado CONSEGUE, e por que tudo bem:** gravar números errados nas 8 colunas de um repasse cuja placa o atacante conheça — desde que ele esteja autenticado. Isso é **exatamente** a autoridade que o usuário autenticado já tem via `UPDATE` direto na tabela, permitido pela policy `authenticated_all_access`. A RPC não concede nenhum privilégio novo; ela apenas embrulha, com regras mais estritas, o que já era possível. Essa é a propriedade que se quer de uma RPC INVOKER.

---

## 9. Casos de borda

| # | Caso | Comportamento desenhado |
|---|---|---|
| 1 | Placa no arquivo sem repasse ativo | `nao_encontradas` / `motivo: "sem_repasse"`. **Nunca cria.** |
| 2 | Placa no arquivo com repasse em `vendido`/`nao_vendido`/`cancelado` | `nao_encontradas` / `motivo: "repasse_inativo"` + `status_atual`. Não escreve — carro fora de oferta não recebe preço de oferta. |
| 3 | Placa duplicada dentro do mesmo arquivo | `DISTINCT ON (placa_norm) ... ORDER BY placa_norm, linha` — vence a **primeira ocorrência**; as demais vão para `ignoradas` / `placa_duplicada_no_arquivo`. Sem isso, um `UPDATE ... FROM` com duas linhas casando o mesmo `id` aplicaria **uma arbitrária** (o Postgres não define qual) — resultado não determinístico, que é o pior tipo de bug num importador. |
| 4 | Duas repasses ativas com a mesma placa | Não escreve. `ignoradas` / `repasse_ambiguo` + `repasse_ids: [...]`. Divirjo aqui da 028, que pega `ORDER BY id LIMIT 1` silenciosamente: sem `UNIQUE` de placa ativa (a 009 é sobre **chassi**), escolher o menor id é um chute que o usuário nunca vê. Ambíguo deve aparecer na tela. |
| 5 | Repasse `subido` que **não aparece** no arquivo | Intocado, e **não reportado**. Ausência não significa nada nesta fonte. Não há bloco de reconciliação — isso é atribuição exclusiva do fluxo de texto. |
| 6 | Linha com todos os campos vazios/zerados | `ignoradas` / `nenhum_campo_observado`. Vai para "ignorados" e não para "sem alteração", para o usuário não achar que a linha foi conferida contra o banco. |
| 7 | Valor `0,00` em campo monetário | Tratado como ausência → campo intocado. **Consequência aceita: o arquivo nunca consegue zerar um valor.** Zerar é operação manual na UI. Ver discordância D1. |
| 8 | `Qtde Anuncios = 0` | **Gravado.** Único campo em que zero é medição. Hoje não ocorre (61/61 não-zero), mas o dia em que ocorrer é justamente o dado interessante ("carro sem anúncio ativo"). |
| 9 | Valor do arquivo idêntico ao do banco | Nenhum UPDATE (guarda `IS DISTINCT FROM`). Linha no grupo `sem_alteracao`. `atualizado_em` **não** muda. |
| 10 | Artefato de float do SheetJS (`71900.00000000001`) | `round(x, 2)` no servidor antes de comparar. Sem isso: diff falso, UPDATE inútil e violação da regra centavo-perfect. |
| 11 | Célula com texto (`"R$ 68.000"`, `"-"`, `"n/d"`) | `jsonb_typeof <> 'number'` → não observado. A transação **não** aborta (diferente da 028, que estouraria `22P02` e perderia o lote inteiro). |
| 12 | Placa ilegível / vazia na linha | `ignoradas` / `placa_invalida`. |
| 13 | **Trigger `trg_repasses_preenche_data_subido` (027)** | Efeito colateral real: o trigger é `BEFORE INSERT OR UPDATE ... WHEN (NEW.status='subido' AND NEW.data_subido IS NULL)`. Nosso UPDATE não toca `status`, mas **dispara o trigger** se a linha for `subido` com `data_subido` NULL — carimbando `data_subido = hoje_brasilia()` num carro que subiu meses atrás. Após o backfill da 027 não deve existir nenhuma linha nessa condição; verificar antes de aplicar: `SELECT count(*) FROM repasses WHERE status='subido' AND data_subido IS NULL;` (esperado: 0). Documentado, não mitigado — mitigar exigiria mexer no trigger, que é da 027. |
| 14 | Trigger `trg_repasses_atualizado_em` (008) | Redundante com o `SET atualizado_em = now()` explícito. Inofensivo — mesmo `now()` da transação. |
| 15 | Chamador sem sessão válida (token expirado) | RLS zera a visibilidade → o preview devolve **as 61 linhas em `nao_encontradas`**. Risco de UX: o usuário lê "nenhum carro encontrado" e conclui que perdeu o estoque. **O front deve verificar a sessão antes de chamar** e, se `nao_encontradas == linhas_no_arquivo`, sugerir "sua sessão pode ter expirado" em vez do texto padrão. |
| 16 | Concorrência preview → confirmação | A confirmação recalcula contra o banco vivo; nunca grava um `antes` obsoleto. Deriva detectável comparando os dois retornos (seção 5.1). |
| 17 | Rodar o mesmo arquivo duas vezes | Idempotente por construção: na segunda execução tudo cai em `sem_alteracao` e **nenhuma linha é escrita** (a guarda de mudança real). |
| 18 | **Ordem entre o fluxo texto e o fluxo arquivo** | Ver discordância D2 — o risco operacional mais sério deste desenho. |

---

## 10. Discordâncias e pontos em aberto

**D1 — "Zero = ausência" pode não valer para `Valor Compra`.** A regra está especificada como global para os monetários, e eu a implementei assim. Mas `Valor Compra` é o custo-base da margem de repasse (`valor_compra_repasse`, migration 024), e um carro de consignação/repasse a custo zero é um negócio que existe. Nos 61 registros, os 2 faltantes são quase certamente célula vazia, não `0,00` — então na prática dá na mesma hoje. Vale confirmar com o Marcos: **se `Valor Compra = 0,00` puder ser um custo real, a margem de repasse desse carro fica errada em silêncio**, porque o campo mantém um custo antigo em vez de zerar. Se a resposta for "pode ser real", `valor_compra_repasse` precisa de tratamento próprio (zero observado) e a garantia "nunca apaga" passa a valer só para os outros cinco.

**D2 — Isolar o fluxo do arquivo não conserta o fluxo do texto; só define quem escreve por último.** Esta é minha discordância de fundo com "a 028 não é alterada, e pronto". Cenário concreto: o arquivo preenche `valor_web` em 25 carros; o usuário roda a importação por texto no dia seguinte; a 028 executa `valor_web = NULLIF(v_reg->>'media_web','')::numeric` **incondicionalmente** e apaga os 25. O dado sincronizado tem meia-vida de uma colagem de texto. Duas saídas:

- **(a) Operacional, imediata:** documentar e treinar — *texto primeiro, arquivo depois, sempre*. Frágil, depende de disciplina humana, e a UI hoje não impõe ordem nenhuma.
- **(b) Estrutural, recomendada como follow-up:** uma migration 030 que torne o write de `valor_web` na 028 condicional (`COALESCE(NULLIF(...), valor_web)`) **apenas para os campos que o texto também pode não observar**. Não é parametrizar a função nem mudar a assinatura — é uma linha de `COALESCE` numa coluna cujo apagamento ninguém pediu. O `DELETE` de gastos e o resto da semântica de espelho ficam intactos.

Não faz parte deste desenho e não bloqueia a entrega. Mas entregar a RPC do arquivo sem registrar isso seria entregar uma correção que o próximo import desfaz. Sugiro escalar para `@aria-architect`.

**D3 — Ambiguidade de placa: divirjo da 028 de propósito.** A 028 resolve placa duplicada com `ORDER BY id LIMIT 1`. Aqui eu recuso a escrita e reporto. Motivo: não existe constraint de unicidade de placa em repasse ativo (a `009` é sobre chassi), então "menor id" é uma convenção arbitrária que o usuário não enxerga. Se o Marcos preferir paridade estrita com a 028, é trocar `ignoradas/repasse_ambiguo` por "escolhe o menor id e emite aviso" — mas nesse caso o aviso tem que aparecer na tela, não só no retorno.

**D4 — Rótulos do arquivo vs. nomes de coluna no payload.** Coloquei o mapeamento `"Vlr Ref. Web" → valor_web` no parser do cliente, não na RPC. Se a preferência for que a RPC receba os rótulos originais (mais fiel à fonte, mais fácil de debugar com o arquivo na mão), o mapeamento vira uma tabela de/para dentro do SQL. Prefiro como está: rótulo de fornecedor muda sem aviso, e não quero migration cada vez que o Auto Avaliar redesenhar o export.

---

## 11. Checklist de verificação (rodar depois de aplicar a migration real)

```sql
-- 1) Colunas criadas com o tipo certo
SELECT column_name, data_type, numeric_precision, numeric_scale, is_nullable
  FROM information_schema.columns
 WHERE table_name = 'repasses'
   AND column_name IN ('valor_maior_oferta','qtde_anuncios');
-- esperado: numeric(12,2) YES  |  integer YES

-- 2) anon NÃO executa (esperado: false, false)
SELECT has_function_privilege('anon','public.sincronizar_repasse_arquivo_auto_avaliar_preview(jsonb)','EXECUTE'),
       has_function_privilege('anon','public.sincronizar_repasse_arquivo_auto_avaliar(jsonb)','EXECUTE');

-- 3) authenticated executa (esperado: true, true)
SELECT has_function_privilege('authenticated','public.sincronizar_repasse_arquivo_auto_avaliar_preview(jsonb)','EXECUTE'),
       has_function_privilege('authenticated','public.sincronizar_repasse_arquivo_auto_avaliar(jsonb)','EXECUTE');

-- 4) Nenhuma das duas é SECURITY DEFINER, e o preview é STABLE (esperado: f/s, f/v)
SELECT proname, prosecdef, provolatile
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND proname LIKE 'sincronizar_repasse_arquivo_auto_avaliar%';

-- 5) O corpo NÃO menciona o que não pode mencionar (esperado: 0 linhas)
SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname='public' AND proname LIKE 'sincronizar_repasse_arquivo_auto_avaliar%'
   AND (pg_get_functiondef(p.oid) ~* '(insert\s+into\s+repasses|repasse_gastos|valor_aquisicao|current_date)');

-- 6) Pré-condição do caso de borda #13 (esperado: 0)
SELECT count(*) FROM repasses WHERE status = 'subido' AND data_subido IS NULL;

-- 7) Smoke idempotente — rodar 2x o MESMO payload dentro de uma transação e dar ROLLBACK
BEGIN;
  SELECT sincronizar_repasse_arquivo_auto_avaliar('{...payload real...}'::jsonb) -> 'resumo';
  -- 2ª execução: linhas_gravadas TEM que ser 0 e com_alteracao TEM que ser 0
  SELECT sincronizar_repasse_arquivo_auto_avaliar('{...mesmo payload...}'::jsonb) -> 'resumo';
ROLLBACK;

-- 8) Plano de execução do match, com o arquivo real de 61 linhas
EXPLAIN (ANALYZE, BUFFERS)
  SELECT sincronizar_repasse_arquivo_auto_avaliar_preview('{...payload real...}'::jsonb);
```

---

## 12. Handoff

- **`@dex-dev`** — implementar a migration `029` a partir deste desenho (2 colunas + 2 helpers + 2 funções + grants), o parser SheetJS que produz o payload da seção 3 e a tela de preview em 3 grupos a partir do retorno da seção 5.
- **`@aria-architect`** — decidir sobre a discordância **D2** (o fluxo de texto continua apagando `valor_web`; isolar a RPC nova não resolve isso).
- **`@morgan-pm` / Marcos** — responder **D1** (`Valor Compra = 0,00` pode ser custo real?) e **D3** (ambíguo: recusar e reportar, ou seguir a 028 e escolher o menor id?).
