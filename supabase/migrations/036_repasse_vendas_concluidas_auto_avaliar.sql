-- Navesa Mesa — Migration 036: importação do relatório "Vendas Concluídas" do Auto Avaliar
-- =====================================================================================
-- TERCEIRA forma de trazer o Auto Avaliar pro sistema, ao lado de:
--   • TEXTO colado  (importar_repasse_auto_avaliar, 025 → 028) — cria carro no ar.
--   • ARQUIVO .xls  (sincronizar_repasse_arquivo_auto_avaliar, 029) — só atualiza valores.
--   • VENDAS .xlsx  (esta migration) — registra a VENDA, e CRIA o carro quando ele nunca
--                                      passou pelo sistema.
--
-- Entrega: 3 helpers puros + 2 RPCs (preview STABLE e aplicação VOLATILE, esta chamando
--          aquela). ADITIVO PURO: nenhuma coluna nova, nenhuma constraint alterada.
--          A 028, a 029, a 033, a 034 e a 035 NÃO são tocadas.
--
--
-- ╔═══════════════════════════════════════════════════════════════════════════════════╗
-- ║  POR QUE ESTA RPC **CRIA** REPASSE, E A 029 NÃO                                    ║
-- ║  ─────────────────────────────────────────────────────────────────────────────    ║
-- ║  A 029 lê "Veículos em Oferta": um RETRATO MÓVEL do que está anunciado agora.      ║
-- ║  Placa que não casa lá é quase sempre ruído (carro de outra loja, carro que ainda  ║
-- ║  não foi cadastrado, carro que saiu) — criar seria inventar estoque.               ║
-- ║                                                                                    ║
-- ║  Aqui é o oposto. "Vendas Concluídas" é FATO CONSUMADO: o carro foi vendido, com   ║
-- ║  data, comprador e valor. Um carro pode ter subido e vendido no Auto Avaliar sem   ║
-- ║  nunca ter passado pelo sistema — e foi o que aconteceu com 7 das 17 vendas da     ║
-- ║  primeira carga, recuperadas na mão. NÃO criar é PERDER a venda, e com ela a       ║
-- ║  margem. Por isso criar é o comportamento correto desta fonte, e só desta.         ║
-- ║                                                                                    ║
-- ║  O repasse nasce com status 'vendido'. Ele NUNCA entra no universo ativo           ║
-- ║  ('marcado'/'subido'), então: (a) não aparece na lista de oferta, (b) não colide   ║
-- ║  com repasses_chassi_subido_uniq (009) nem com repasses_chassi_ativo_uniq (010),   ║
-- ║  que são índices PARCIAIS sobre status ativo, e (c) fica fora do alcance da RPC    ║
-- ║  de texto — ver a nota sobre gastos logo abaixo.                                   ║
-- ╚═══════════════════════════════════════════════════════════════════════════════════╝
--
--
-- ╔═══════════════════════════════════════════════════════════════════════════════════╗
-- ║  GASTOS: POR QUE `tipo = 'auto_avaliar'` É SEGURO AQUI (e por que um tipo novo     ║
-- ║  seria PIOR)                                                                       ║
-- ║  ─────────────────────────────────────────────────────────────────────────────    ║
-- ║  A `importar_repasse_auto_avaliar` (028:271) faz, no caminho de atualizar:         ║
-- ║      DELETE FROM repasse_gastos WHERE repasse_id = ? AND tipo = 'auto_avaliar'     ║
-- ║  incondicional. A pergunta óbvia é se ela varre o que gravamos aqui. Não varre:    ║
-- ║                                                                                    ║
-- ║  1. Aquele DELETE só roda para um `v_target` resolvido, e os DOIS caminhos que     ║
-- ║     resolvem `v_target` filtram `status IN ('marcado','subido')` (028:221-227) ou  ║
-- ║     vêm de `repasse_id` escolhido no cliente entre repasses ATIVOS                 ║
-- ║     (import-auto-avaliar.ts: `ativo` = status marcado|subido). Um repasse           ║
-- ║     'vendido' — que é como TODA linha desta importação termina — nunca é alvo.     ║
-- ║  2. "Gastos Previstos" do relatório de vendas e "Gastos" do texto colado são O     ║
-- ║     MESMO CAMPO do Auto Avaliar, para o mesmo carro. Verificado no arquivo real:   ║
-- ║     QTQ0226 traz 600 no relatório e já tem 600 em repasse_gastos(auto_avaliar).    ║
-- ║     Um tipo NOVO ('venda_auto_avaliar', o que for) faria as duas linhas conviverem ║
-- ║     e DOBRARIA o custo_real desse carro — exatamente o dano que a escolha de tipo  ║
-- ║     deveria evitar. Convergir no mesmo tipo é o que mantém UM gasto por carro.     ║
-- ║                                                                                    ║
-- ║  DIVERGÊNCIA DELIBERADA em relação à 028: aqui o DELETE **não é incondicional**.   ║
-- ║  Ele só acontece quando o relatório observou gasto > 0 E esse valor DIFERE do que  ║
-- ║  já está lançado. Gasto zero no relatório NÃO apaga gasto existente: 12 das 17     ║
-- ║  linhas vêm com 0, e a soma do relatório (R$ 13.350) não bate com a do sistema     ║
-- ║  (R$ 8.800) — os dois conjuntos não são o mesmo, então "0" aqui significa "o       ║
-- ║  relatório não informou", não "o gasto foi zerado". Apagar seria destruir dado     ║
-- ║  bom com base numa célula que não afirma nada.                                     ║
-- ╚═══════════════════════════════════════════════════════════════════════════════════╝
--
--
-- ╔═══════════════════════════════════════════════════════════════════════════════════╗
-- ║  O QUE ESTA MIGRATION DELIBERADAMENTE **NÃO** GRAVA                                ║
-- ║  ─────────────────────────────────────────────────────────────────────────────    ║
-- ║  • `Lucro R$` / `Lucro %` do relatório. Medidos linha a linha, eles são            ║
-- ║    Vendido − Compra, SEM os gastos. O sistema calcula margem por                   ║
-- ║    custo_real = valor_compra_repasse + Σ repasse_gastos, que é o número certo.     ║
-- ║    Importar o lucro do relatório seria gravar uma margem que já sabemos errada.    ║
-- ║    As duas chaves nem existem no contrato de payload abaixo.                       ║
-- ║  • `Valor TAC`. Decisão do dono do negócio: TAC não é custo do carro. O valor é    ║
-- ║    SOMADO E EXIBIDO no preview (cliente), mas não atravessa a fronteira: não há    ║
-- ║    chave `tac` no payload, então nenhum payload adulterado consegue fazer o banco  ║
-- ║    gravá-lo. Garantia estrutural, não regra de tela.                               ║
-- ║  • `valor_aquisicao` (custo do sistema/NBS) — fora da whitelist, como na 029.      ║
-- ║  • Comprador, CNPJ/CPF, telefone e cidade do comprador. São PII de terceiro e o    ║
-- ║    projeto já pagou o preço disso uma vez (026). Não entram no payload.            ║
-- ╚═══════════════════════════════════════════════════════════════════════════════════╝
--
--
-- GARANTIAS ESTRUTURAIS (ausência de statement, não flag de runtime)
--   • Preview é STABLE: a engine do Postgres RECUSA qualquer escrita lá dentro. Não há
--     `p_dry_run boolean` — um booleano vindo do navegador não é fronteira de confiança.
--   • Sem SQL dinâmico: zero EXECUTE, zero format(). Nome de coluna nunca vem do cliente.
--     Todas as escritas usam whitelist estática, auditável de olho.
--   • Nunca apaga valor de compra: `valor_compra_repasse = COALESCE(r.<coluna>, observado)`
--     — a coluna vem PRIMEIRO no COALESCE, então valor existente jamais é sobrescrito.
--   • Nunca apaga gasto: o DELETE de repasse_gastos é guardado por `gasto > 0` E por
--     `IS DISTINCT FROM` do valor já lançado. Ver caixa acima.
--   • Nunca toca repasse_documentos, repasse_fotos, repasse_interessados, leads,
--     veiculos, nem `valor_aquisicao`.
--   • Não há camada de servidor no projeto: estas RPCs são chamadas DIRETO do navegador
--     e o payload é integralmente adulterável. Todo limite abaixo (teto de linhas, teto
--     de texto, faixa de data, whitelist de colunas) existe por causa disso.
--
-- DATAS DE CALENDÁRIO: `data_vendido`, `data_subiu` e `data_subido` vêm OBSERVADAS do
--   relatório (o Auto Avaliar exporta em horário de Brasília; o parser corta o horário e
--   manda só o dia). A única data derivada do relógio é `repasse_gastos.data`, e ela usa
--   `public.hoje_brasilia()` (027) — nunca current_date, que no banco em UTC já está no
--   dia seguinte entre 21h e a meia-noite de Brasília (ver cabeçalho da 028).
--
-- IDEMPOTENTE: CREATE OR REPLACE FUNCTION + REVOKE/GRANT. Roda 2x sem erro, não dropa
--   nada. E o IMPORT é idempotente: reimportar o mesmo arquivo grava 0 linhas.
-- =====================================================================================


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 1. HELPERS DE NORMALIZAÇÃO NA FRONTEIRA
-- =====================================================================================
-- Mesma disciplina da 029: uma implementação só de "o que este arquivo observa", usada
-- pelo preview E pela aplicação. É isto que impede a tela de mentir sobre o que vai ser
-- gravado — a RPC de aplicar reprocessa com as MESMAS funções.
--
-- `jsonb_typeof(...) = 'number'` em vez de `->>` + cast: a 028 faz
-- `NULLIF(v_reg->>'campo','')::numeric` e, se uma célula chegar como "R$ 68.000", estoura
-- 22P02 e ABORTA A TRANSAÇÃO INTEIRA. Aqui, célula inválida vira "não observado" e a
-- linha é REPORTADA. Endurecimento deliberado, herdado da 029.
--
-- Prefixo `aa_vnd_` (Auto Avaliar / vendas) em vez de reaproveitar os `aa_arq_` da 029:
-- os helpers de lá são o contrato do arquivo de OFERTAS. Compartilhar assinatura criaria
-- um acoplamento em que mexer numa fonte muda a outra em silêncio.
-- ─────────────────────────────────────────────────────────────────────────────────────

-- Valor monetário observado: só aceita JSON number; ZERO É AUSÊNCIA; arredonda a 2 casas;
-- negativo é lixo (o relatório tem coluna de lucro negativo, mas ela não entra aqui).
CREATE OR REPLACE FUNCTION public.aa_vnd_valor_obs(p_item jsonb, p_chave text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
           WHEN jsonb_typeof(p_item -> p_chave) = 'number'
                AND (p_item ->> p_chave)::numeric >= 0
           THEN NULLIF(round((p_item ->> p_chave)::numeric, 2), 0)
         END
$$;

COMMENT ON FUNCTION public.aa_vnd_valor_obs(jsonb, text) IS
  'Normaliza uma célula monetária do relatório "Vendas Concluídas": JSON number >= 0 → '
  'numeric(2 casas); zero → NULL (ausência); negativo ou qualquer outro tipo JSON → NULL '
  '(não observado, sem estourar a transação). Migration 036.';

-- Data de calendário observada: só aceita JSON string em YYYY-MM-DD ESTRITO.
-- O parser do cliente recebe "24/06/2026 16:13:32" e corta o horário — o relatório é
-- exportado no fuso de Brasília, então o DIA já vem certo e não há conversão a fazer aqui.
-- Qualquer outro formato vira NULL: adivinhar DD/MM x MM/DD é como se troca 06/07 por
-- 07/06 em silêncio.
--
-- IMMUTABLE de propósito — a faixa é fixa (2000..2100) e NÃO consulta o relógio. A guarda
-- de "data no futuro" mora no preview, onde `public.hoje_brasilia()` (STABLE) pode ser
-- chamada sem contaminar a imutabilidade deste helper.
CREATE OR REPLACE FUNCTION public.aa_vnd_data_obs(p_item jsonb, p_chave text)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
           WHEN jsonb_typeof(p_item -> p_chave) = 'string'
                AND (p_item ->> p_chave) ~ '^\d{4}-\d{2}-\d{2}$'
                AND (p_item ->> p_chave) BETWEEN '2000-01-01' AND '2100-12-31'
           THEN (p_item ->> p_chave)::date
         END
$$;

COMMENT ON FUNCTION public.aa_vnd_data_obs(jsonb, text) IS
  'Normaliza uma DATA DE CALENDÁRIO do relatório "Vendas Concluídas": JSON string em '
  'YYYY-MM-DD estrito, entre 2000 e 2100 → date; qualquer outra coisa → NULL. Nunca '
  'adivinha formato e nunca consulta o relógio. Migration 036.';

-- Texto observado com TETO DE TAMANHO. O payload vem do navegador: sem o teto, um item
-- adulterado com 10 MB de `modelo` vira linha gigante em `repasses` e resposta gigante no
-- preview. Corta em vez de rejeitar — o dado real tem ~50 caracteres.
CREATE OR REPLACE FUNCTION public.aa_vnd_texto_obs(p_item jsonb, p_chave text, p_max integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
           WHEN jsonb_typeof(p_item -> p_chave) = 'string'
           THEN NULLIF(left(btrim(p_item ->> p_chave), greatest(p_max, 1)), '')
         END
$$;

COMMENT ON FUNCTION public.aa_vnd_texto_obs(jsonb, text, integer) IS
  'Texto observado do relatório "Vendas Concluídas": JSON string → trim + corte em p_max '
  'caracteres; vazio ou outro tipo → NULL. O teto existe porque o payload vem do '
  'navegador e é integralmente adulterável. Migration 036.';


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 2. RPC DE PREVIEW — STABLE, read-only garantido pela ENGINE
-- =====================================================================================
-- STABLE não é documentação: se alguém escrever um UPDATE aqui dentro, o Postgres estoura
-- em runtime com "UPDATE is not allowed in a non-volatile function".
--
-- SECURITY INVOKER: o RLS é o backstop real, não o GRANT. Chamador sem sessão enxerga
-- zero linhas em `repasses` → tudo cai em `a_criar`... e é por isso que a RPC de APLICAR
-- também é INVOKER: sem sessão, o INSERT bate no WITH CHECK da policy e falha. Não existe
-- caminho em que um anônimo popule a tabela.
-- SECURITY DEFINER aqui seria repetir a combinação que produziu o vazamento de PII
-- corrigido pela 026 (DEFINER + anon com EXECUTE). Não repetir.
--
-- Retorno: 4 grupos + resumo. Mesmo formato do modo aplicado, para o front reaproveitar a
-- tela e poder diffar preview × aplicado (deriva entre a conferência e o clique).
-- ─────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.importar_vendas_concluidas_auto_avaliar_preview(
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE
  v_total     integer;
  v_lim       integer;
  v_truncado  boolean;
  v_gerado_em text;
  v_hoje      date := public.hoje_brasilia();

  v_com jsonb; v_n_com integer;
  v_sem jsonb; v_n_sem integer;
  v_cri jsonb; v_n_cri integer;
  v_ign jsonb; v_n_ign integer;
  v_campos integer;
  v_gastos integer;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'p_payload deve ser um objeto JSONB';
  END IF;
  IF jsonb_typeof(p_payload -> 'linhas') <> 'array' THEN
    RAISE EXCEPTION 'p_payload.linhas deve ser um array JSONB';
  END IF;

  v_total := jsonb_array_length(p_payload -> 'linhas');

  -- Guarda de entrada: o relatório real tem 17 linhas. O teto existe para que um payload
  -- adulterado não vire DoS de CPU num Postgres compartilhado.
  IF v_total > 2000 THEN
    RAISE EXCEPTION 'payload com % linhas excede o teto de 2000', v_total;
  END IF;

  -- Arrays do retorno truncados acima de 500 linhas; o `resumo` continua exato.
  -- EXCEÇÃO DELIBERADA: `com_alteracao` e `a_criar` NUNCA são truncados — eles carregam
  -- o `patch` que a função de aplicar consome, e truncá-los transformaria "arquivo
  -- grande" em GRAVAÇÃO PARCIAL SILENCIOSA.
  v_truncado := v_total > 500;
  v_lim      := CASE WHEN v_truncado THEN 200 ELSE 2000 END;

  -- Instante técnico de geração (não é data de calendário).
  -- Brasil não observa horário de verão desde 2019: offset fixo -03:00.
  v_gerado_em := to_char(now() AT TIME ZONE 'America/Sao_Paulo',
                         'YYYY-MM-DD"T"HH24:MI:SS') || '-03:00';

  WITH linhas AS (
    -- Item não-objeto vira '{}' em vez de sumir: nenhuma linha desaparece do relatório.
    SELECT
      t.ord::integer AS ord,
      CASE WHEN jsonb_typeof(t.item -> 'linha') = 'number'
           THEN trunc((t.item ->> 'linha')::numeric)::integer
           ELSE t.ord::integer END AS linha,
      -- Placa e chassi CRUS normalizados no SERVIDOR. A expressão da placa é
      -- LITERALMENTE igual à do índice funcional idx_repasses_placa_norm (025). Não se
      -- confia em forma normalizada vinda do cliente, e o payload não carrega
      -- repasse_id: o match é inteiramente server-side.
      NULLIF(regexp_replace(upper(COALESCE(t.item ->> 'placa', '')),
                            '[^A-Z0-9]', '', 'g'), '') AS placa_norm,
      NULLIF(regexp_replace(upper(COALESCE(t.item ->> 'chassi', '')),
                            '[^A-Z0-9]', '', 'g'), '') AS chassi_norm,
      CASE WHEN jsonb_typeof(t.item) = 'object' THEN t.item ELSE '{}'::jsonb END AS item
    FROM jsonb_array_elements(p_payload -> 'linhas') WITH ORDINALITY AS t(item, ord)
  ),
  obs AS (
    SELECT l.ord, l.linha, l.placa_norm, l.chassi_norm,
           aa_vnd_texto_obs(l.item, 'modelo', 200)        AS o_modelo,
           aa_vnd_data_obs (l.item, 'data_publicacao')    AS o_data_pub,
           aa_vnd_data_obs (l.item, 'data_venda')         AS o_data_venda,
           aa_vnd_valor_obs(l.item, 'valor_compra')       AS o_compra,
           aa_vnd_valor_obs(l.item, 'valor_vendido')      AS o_vendido,
           aa_vnd_valor_obs(l.item, 'gastos')             AS o_gasto
    FROM linhas l
  ),
  dup AS (
    -- Placa repetida no MESMO arquivo: vence a primeira ocorrência.
    --
    -- ⚠️ Esta dedup e a de chassi NÃO bastam sozinhas: elas olham a CHAVE DO ARQUIVO, e
    -- duas chaves distintas podem apontar para o MESMO repasse (linha A casa o #5 pela
    -- placa; linha B, com outra placa, casa o #5 pelo chassi). Quem fecha esse buraco é
    -- `dup_rep`, lá embaixo, que deduplica pelo repasse_id JÁ RESOLVIDO.
    SELECT ord, row_number() OVER (PARTITION BY placa_norm ORDER BY ord) AS rn
    FROM obs WHERE placa_norm IS NOT NULL
  ),
  dup_ch AS (
    -- Mesma coisa por chassi: sem isto, duas linhas com o mesmo chassi e placas
    -- diferentes CRIARIAM dois repasses para o mesmo carro (os índices únicos de chassi
    -- são parciais sobre status ativo e não alcançam 'vendido').
    SELECT ord, row_number() OVER (PARTITION BY chassi_norm ORDER BY ord) AS rn
    FROM obs WHERE chassi_norm IS NOT NULL
  ),
  cand AS (
    SELECT o.*, COALESCE(d.rn, 1) AS rn, COALESCE(dc.rn, 1) AS rn_ch
    FROM obs o
    LEFT JOIN dup    d  ON d.ord  = o.ord
    LEFT JOIN dup_ch dc ON dc.ord = o.ord
  ),
  -- MATCH CONTRA QUALQUER STATUS (diferente da 029, que só olha repasse ativo): a venda é
  -- fato consumado e precisa pousar no carro mesmo que ele já esteja 'vendido',
  -- 'nao_vendido' ou 'cancelado'. Reimportar o mesmo arquivo tem que reencontrar o carro
  -- que a importação anterior marcou — senão a segunda rodada criaria tudo de novo.
  --
  -- Casa por PLACA ou por CHASSI. O chassi não é capricho: é o que impede criar um
  -- repasse duplicado para um carro que já existe e teve a placa trocada/redigitada.
  ach AS (
    SELECT c.ord,
           count(*)::integer             AS n,
           min(r.id)                     AS repasse_id,
           jsonb_agg(r.id ORDER BY r.id) AS ids,
           bool_or(regexp_replace(upper(r.placa), '[^A-Z0-9]', '', 'g') = c.placa_norm)
                                         AS por_placa
    FROM cand c
    JOIN repasses r
      ON (c.placa_norm  IS NOT NULL AND regexp_replace(upper(r.placa),  '[^A-Z0-9]', '', 'g') = c.placa_norm)
      OR (c.chassi_norm IS NOT NULL AND regexp_replace(upper(r.chassi), '[^A-Z0-9]', '', 'g') = c.chassi_norm)
    WHERE c.rn = 1 AND c.rn_ch = 1
    GROUP BY c.ord
  ),
  -- Classificação PARCIAL: tudo menos a dedup por repasse_id, que só pode ser feita
  -- depois de saber quem é `match` (ver `dup_rep`).
  pre AS (
    SELECT c.*,
           COALESCE(a.n, 0) AS n_match,
           a.repasse_id,
           a.ids,
           COALESCE(a.por_placa, false) AS por_placa,
           CASE
             WHEN c.placa_norm IS NULL AND c.chassi_norm IS NULL
                                                THEN 'ign:linha_sem_identificacao'
             WHEN c.rn    > 1                   THEN 'ign:placa_duplicada_no_arquivo'
             WHEN c.rn_ch > 1                   THEN 'ign:chassi_duplicado_no_arquivo'
             -- A DATA é o fato da venda. Sem ela não há o que registrar, e carimbar
             -- "hoje" transformaria uma venda de junho numa venda de agosto.
             WHEN c.o_data_venda IS NULL        THEN 'ign:sem_data_venda'
             WHEN c.o_data_venda > v_hoje       THEN 'ign:data_venda_futura'
             -- "Venda concluída" sem valor não é venda concluída — e um repasse
             -- 'vendido' com valor_vendido NULL envenena todo relatório de margem.
             WHEN c.o_vendido IS NULL           THEN 'ign:sem_valor_vendido'
             -- Divirjo da 028 de propósito: ela desempata ambiguidade com
             -- ORDER BY id LIMIT 1. "Menor id" é um chute que o usuário nunca vê.
             WHEN COALESCE(a.n, 0) > 1          THEN 'ign:repasse_ambiguo'
             WHEN COALESCE(a.n, 0) = 1          THEN 'match'
             -- Daqui pra baixo é CRIAÇÃO, e criar exige as 3 colunas NOT NULL de
             -- `repasses`: chassi, placa e modelo.
             WHEN c.chassi_norm IS NULL         THEN 'ign:sem_chassi_para_criar'
             WHEN c.placa_norm  IS NULL         THEN 'ign:sem_placa_para_criar'
             WHEN c.o_modelo    IS NULL         THEN 'ign:sem_modelo_para_criar'
             ELSE 'criar'
           END AS classe_pre
    FROM cand c
    LEFT JOIN ach a ON a.ord = c.ord
  ),
  dup_rep AS (
    -- ⚠️ DEDUP QUE FECHA O BURACO DAS OUTRAS DUAS: pelo repasse_id JÁ RESOLVIDO.
    --
    -- `dup` e `dup_ch` deduplicam a CHAVE DO ARQUIVO. Como o match casa por placa OU por
    -- chassi, duas linhas com chaves DIFERENTES podem resolver o MESMO repasse — linha A
    -- com placa P1 e chassi vazio casa o #5 pela placa; linha B com placa P2 e chassi C5
    -- casa o #5 pelo chassi. As duas passam com rn = 1 e rn_ch = 1.
    --
    -- Sem esta dedup, dois estragos silenciosos:
    --   1. o UPDATE lá embaixo tem DUAS linhas em `o` com o mesmo `repasse_id` e o
    --      Postgres aplica UMA ARBITRÁRIA — não define qual;
    --   2. pior, no bloco de gastos: `res` é DISTINCT sobre (repasse_id, gasto), então
    --      gastos DIFERENTES não colapsam. O DELETE roda uma vez e o INSERT grava DUAS
    --      linhas de gasto no mesmo carro (600 + 1250 = 1850 num carro que tem um só),
    --      inflando o custo_real e derrubando a margem sem nenhum sintoma na tela.
    --
    -- Vence a primeira ocorrência do arquivo; a segunda vai para `ignoradas` com motivo
    -- próprio. É uma DECISÃO VISÍVEL, não um desempate escondido.
    --
    -- Roda só sobre `classe_pre = 'match'`: se contasse as linhas já ignoradas por outro
    -- motivo, uma linha descartada por "sem data de venda" consumiria o rn = 1 e mataria
    -- a linha boa que vem depois.
    SELECT ord, row_number() OVER (PARTITION BY repasse_id ORDER BY ord) AS rn
    FROM pre WHERE classe_pre = 'match'
  ),
  clas AS (
    SELECT p.*,
           CASE WHEN p.classe_pre = 'match' AND COALESCE(dr.rn, 1) > 1
                THEN 'ign:repasse_ja_casado_no_arquivo'
                ELSE p.classe_pre
           END AS classe
    FROM pre p
    LEFT JOIN dup_rep dr ON dr.ord = p.ord
  ),
  m AS (
    SELECT cl.*, r.modelo AS a_modelo, r.status AS a_status,
           r.data_vendido         AS a_data,
           r.valor_vendido        AS a_vendido,
           r.valor_compra_repasse AS a_compra,
           (SELECT sum(g.valor) FROM repasse_gastos g
             WHERE g.repasse_id = r.id AND g.tipo = 'auto_avaliar') AS a_gasto
    FROM clas cl
    JOIN repasses r ON r.id = cl.repasse_id
    WHERE cl.classe = 'match'
  ),
  campos AS (
    -- WHITELIST ESTÁTICA DE 5 CAMPOS. Sem SQL dinâmico: nome de campo nunca vem do
    -- cliente. Dá pra auditar de olho o que NÃO está aqui — `valor_aquisicao`,
    -- `valor_minimo`, `valor_compre_por`, lucro, TAC, comprador.
    --
    -- ⚠️ `COALESCE(to_jsonb(...), 'null'::jsonb)` não é decoração: `to_jsonb` é STRICT,
    -- então `to_jsonb(NULL::date)` devolve SQL NULL, não o JSON `null`. Sem o COALESCE,
    -- `antes = 'null'::jsonb` avalia para NULL, o CASE cai no ELSE e todo campo que está
    -- VAZIO no banco seria rotulado 'altera' em vez de 'preenche' — a tela inverteria
    -- exatamente a distinção que existe para não assustar na primeira importação.
    SELECT m.ord, x.campo, x.antes, x.depois
    FROM m
    CROSS JOIN LATERAL (VALUES
      ('status',               COALESCE(to_jsonb(m.a_status),  'null'::jsonb), '"vendido"'::jsonb,
       m.a_status IS DISTINCT FROM 'vendido'),
      ('data_vendido',         COALESCE(to_jsonb(m.a_data),    'null'::jsonb), to_jsonb(m.o_data_venda),
       m.o_data_venda IS NOT NULL AND m.o_data_venda IS DISTINCT FROM m.a_data),
      ('valor_vendido',        COALESCE(to_jsonb(m.a_vendido), 'null'::jsonb), to_jsonb(m.o_vendido),
       m.o_vendido IS NOT NULL AND m.o_vendido IS DISTINCT FROM m.a_vendido),
      -- COALESCE, nunca sobrescrita: só entra no diff quando a coluna está VAZIA. Se já
      -- houver um valor de compra gravado, o do relatório é descartado em silêncio — e
      -- em silêncio é o certo, porque não há nada a decidir: o dado do sistema vence.
      ('valor_compra_repasse', COALESCE(to_jsonb(m.a_compra),  'null'::jsonb), to_jsonb(m.o_compra),
       m.a_compra IS NULL AND m.o_compra IS NOT NULL),
      -- Gasto: só quando o relatório observou > 0 (aa_vnd_valor_obs já matou o zero) E o
      -- total lançado difere. Ver a caixa "GASTOS" no cabeçalho.
      ('repasse_gastos',       COALESCE(to_jsonb(m.a_gasto),   'null'::jsonb), to_jsonb(m.o_gasto),
       m.o_gasto IS NOT NULL AND m.o_gasto IS DISTINCT FROM m.a_gasto)
    ) AS x(campo, antes, depois, incluir)
    WHERE x.incluir
  ),
  agg AS (
    SELECT ord,
           jsonb_agg(jsonb_build_object(
             'campo',  campo,
             'antes',  antes,
             'depois', depois,
             -- preencher buraco é seguro; trocar valor que já existia merece destaque
             'acao',   CASE WHEN antes = 'null'::jsonb THEN 'preenche' ELSE 'altera' END
           ) ORDER BY campo) AS campos,
           count(*)::integer AS n_campos,
           count(*) FILTER (WHERE campo = 'repasse_gastos')::integer AS n_gastos
    FROM campos
    GROUP BY ord
  ),
  com AS (
    SELECT m.ord, m.linha, m.placa_norm, m.repasse_id, m.a_modelo, m.a_status,
           m.por_placa, a.campos, a.n_gastos,
           -- PATCH: valores observados já normalizados PELA PRÓPRIA RPC. É o que a função
           -- de aplicar consome, e o que garante normalização única entre ver e gravar.
           jsonb_strip_nulls(jsonb_build_object(
             'repasse_id',           m.repasse_id,
             'data_vendido',         m.o_data_venda,
             'valor_vendido',        m.o_vendido,
             'valor_compra_repasse', CASE WHEN m.a_compra IS NULL THEN m.o_compra END,
             'gastos',               CASE WHEN m.o_gasto IS DISTINCT FROM m.a_gasto
                                          THEN m.o_gasto END
           )) AS patch
    FROM m JOIN agg a ON a.ord = m.ord
  ),
  sem AS (
    SELECT m.ord, m.linha, m.placa_norm, m.repasse_id, m.a_modelo
    FROM m LEFT JOIN agg a ON a.ord = m.ord
    WHERE a.ord IS NULL
  ),
  cri AS (
    SELECT cl.ord, cl.linha, cl.placa_norm, cl.chassi_norm, cl.o_modelo,
           cl.o_data_pub, cl.o_data_venda, cl.o_vendido, cl.o_compra, cl.o_gasto,
           jsonb_strip_nulls(jsonb_build_object(
             'placa',                cl.placa_norm,
             'chassi',               cl.chassi_norm,
             'modelo',               cl.o_modelo,
             -- data_subiu é NOT NULL: cai na data da venda quando o relatório não trouxe
             -- publicação. Nunca cai em "hoje", que inventaria um carro subido hoje.
             'data_subiu',           COALESCE(cl.o_data_pub, cl.o_data_venda),
             'data_publicacao',      cl.o_data_pub,
             'data_vendido',         cl.o_data_venda,
             'valor_vendido',        cl.o_vendido,
             'valor_compra_repasse', cl.o_compra,
             'gastos',               cl.o_gasto
           )) AS patch
    FROM clas cl WHERE cl.classe = 'criar'
  ),
  ign AS (
    -- `repasse_ids` só faz sentido nos dois motivos que APONTAM PARA UM REPASSE: a lista
    -- que o usuário precisa desempatar (ambíguo) e o carro que já foi casado por outra
    -- linha do mesmo arquivo. Nos outros motivos seria ruído, e some via jsonb_strip_nulls.
    SELECT ord, linha, placa_norm, chassi_norm, split_part(classe, ':', 2) AS motivo,
           CASE WHEN classe IN ('ign:repasse_ambiguo', 'ign:repasse_ja_casado_no_arquivo')
                THEN ids END AS ids
    FROM clas WHERE classe LIKE 'ign:%'
  )
  SELECT
    -- GRUPO 1 — repasse existe e VAI MUDAR (nunca truncado: carrega o patch)
    COALESCE((SELECT jsonb_agg(z.j ORDER BY z.ord) FROM (
       SELECT ord, jsonb_build_object(
         'linha', linha, 'placa_norm', placa_norm, 'repasse_id', repasse_id,
         'modelo', a_modelo, 'status', a_status,
         'casou_por', CASE WHEN por_placa THEN 'placa' ELSE 'chassi' END,
         'campos', campos,
         'patch', patch
       ) AS j FROM com ORDER BY ord) z), '[]'::jsonb),
    (SELECT count(*)::integer FROM com),

    -- GRUPO 2 — repasse existe e já está exatamente assim
    COALESCE((SELECT jsonb_agg(z.j ORDER BY z.ord) FROM (
       SELECT ord, jsonb_build_object(
         'linha', linha, 'placa_norm', placa_norm, 'repasse_id', repasse_id,
         'modelo', a_modelo
       ) AS j FROM sem ORDER BY ord LIMIT v_lim) z), '[]'::jsonb),
    (SELECT count(*)::integer FROM sem),

    -- GRUPO 3 — VAI SER CRIADO (nunca truncado: carrega o patch)
    COALESCE((SELECT jsonb_agg(z.j ORDER BY z.ord) FROM (
       SELECT ord, jsonb_strip_nulls(jsonb_build_object(
         'linha', linha, 'placa_norm', placa_norm, 'chassi', chassi_norm,
         'modelo', o_modelo,
         'data_subiu', COALESCE(o_data_pub, o_data_venda),
         'data_vendido', o_data_venda,
         'valor_vendido', o_vendido,
         'valor_compra_repasse', o_compra,
         'gastos', o_gasto,
         'patch', patch
       )) AS j FROM cri ORDER BY ord) z), '[]'::jsonb),
    (SELECT count(*)::integer FROM cri),

    -- GRUPO 4 — descartadas antes de qualquer escrita
    COALESCE((SELECT jsonb_agg(z.j ORDER BY z.ord) FROM (
       SELECT ord, jsonb_strip_nulls(jsonb_build_object(
         'linha', linha, 'placa_norm', placa_norm, 'chassi', chassi_norm,
         'motivo', motivo, 'repasse_ids', ids
       )) AS j FROM ign ORDER BY ord LIMIT v_lim) z), '[]'::jsonb),
    (SELECT count(*)::integer FROM ign),

    COALESCE((SELECT sum(n_campos)::integer FROM agg), 0),
    COALESCE((SELECT sum(n_gastos)::integer FROM agg), 0)
       + (SELECT count(*)::integer FROM cri WHERE o_gasto IS NOT NULL)
  INTO v_com, v_n_com, v_sem, v_n_sem, v_cri, v_n_cri, v_ign, v_n_ign, v_campos, v_gastos;

  RETURN jsonb_build_object(
    'versao',    1,
    'modo',      'preview',
    'gerado_em', v_gerado_em,
    'truncado',  v_truncado,
    'resumo', jsonb_build_object(
      'linhas_no_arquivo', v_total,
      'sem_alteracao',     v_n_sem,
      'com_alteracao',     v_n_com,
      'a_criar',           v_n_cri,
      'ignoradas',         v_n_ign,
      'campos_a_alterar',  v_campos,
      'gastos_a_lancar',   v_gastos,
      'linhas_gravadas',   0,   -- preview nunca grava
      'repasses_criados',  0,
      'gastos_lancados',   0
    ),
    'com_alteracao', v_com,
    'sem_alteracao', v_sem,
    'a_criar',       v_cri,
    'ignoradas',     v_ign
  );
END;
$fn$;

COMMENT ON FUNCTION public.importar_vendas_concluidas_auto_avaliar_preview(jsonb) IS
  'Calcula o diff do relatório "Vendas Concluídas" do Auto Avaliar contra os repasses e '
  'devolve o relatório em 4 grupos (com_alteracao / sem_alteracao / a_criar / ignoradas). '
  'READ-ONLY garantido pela engine (STABLE). SECURITY INVOKER: respeita o RLS de quem '
  'chama. Casa por placa OU chassi normalizados, contra QUALQUER status. Não grava lucro, '
  'não grava TAC, não grava PII de comprador, nunca sobrescreve valor_compra_repasse '
  'existente. Migration 036.';


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 3. RPC DE APLICAÇÃO — VOLATILE, chama o preview e escreve
-- =====================================================================================
-- A confirmação NÃO recebe o diff que o usuário viu na tela: ela RECALCULA do zero contra
-- o banco vivo, a partir do mesmo payload bruto, chamando a função de preview. O cliente
-- não consegue confirmar uma mudança que o banco não derivaria sozinho, e não existe
-- duplicação da regra de normalização entre preview e gravação.
--
-- O retorno tem o mesmo formato do preview, com modo = "aplicado": o front reaproveita o
-- componente de tela e pode diffar preview × aplicado para detectar deriva.
-- ─────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.importar_vendas_concluidas_auto_avaliar(
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE
  v_preview  jsonb;
  v_upd      integer := 0;
  v_ins      integer := 0;
  v_gas      integer := 0;
  -- "Hoje" fixado uma vez: a importação inteira roda numa transação só e não pode ficar
  -- meio ontem meio hoje se atravessar a meia-noite de Brasília (mesma regra da 028).
  v_hoje     date := public.hoje_brasilia();
BEGIN
  v_preview := public.importar_vendas_concluidas_auto_avaliar_preview(p_payload);

  -- ── 3.1 ATUALIZA quem já existe ────────────────────────────────────────────────────
  -- WHITELIST ESTÁTICA DE 4 COLUNAS + atualizado_em. `status` só anda para 'vendido'.
  -- `valor_compra_repasse = COALESCE(r.coluna, observado)` — a COLUNA VEM PRIMEIRO, então
  -- nenhum caminho deste código consegue sobrescrever um valor de compra existente.
  WITH alvo AS (
    SELECT (e -> 'patch') AS patch
    FROM jsonb_array_elements(v_preview -> 'com_alteracao') AS e
  ),
  o AS (
    -- Mesmos helpers do preview: uma normalização só, aplicada duas vezes.
    SELECT (a.patch ->> 'repasse_id')::bigint            AS repasse_id,
           aa_vnd_data_obs (a.patch, 'data_vendido')     AS data_vendido,
           aa_vnd_valor_obs(a.patch, 'valor_vendido')    AS valor_vendido,
           aa_vnd_valor_obs(a.patch, 'valor_compra_repasse') AS valor_compra_repasse
    FROM alvo a
    WHERE jsonb_typeof(a.patch -> 'repasse_id') = 'number'
  )
  UPDATE repasses r SET
    status               = 'vendido',
    data_vendido         = COALESCE(o.data_vendido,  r.data_vendido),
    valor_vendido        = COALESCE(o.valor_vendido, r.valor_vendido),
    valor_compra_repasse = COALESCE(r.valor_compra_repasse, o.valor_compra_repasse),
    atualizado_em        = now()   -- timestamptz: instante técnico, NÃO converter
  FROM o
  WHERE r.id = o.repasse_id
    AND (                                       -- guarda de MUDANÇA REAL (idempotência)
         r.status IS DISTINCT FROM 'vendido'
      OR (o.data_vendido  IS NOT NULL AND o.data_vendido  IS DISTINCT FROM r.data_vendido)
      OR (o.valor_vendido IS NOT NULL AND o.valor_vendido IS DISTINCT FROM r.valor_vendido)
      OR (r.valor_compra_repasse IS NULL AND o.valor_compra_repasse IS NOT NULL)
    );

  GET DIAGNOSTICS v_upd = ROW_COUNT;

  -- ── 3.2 CRIA quem nunca passou pelo sistema ────────────────────────────────────────
  -- WHITELIST ESTÁTICA DE 10 COLUNAS. O que NÃO está aqui é auditável de olho:
  -- valor_aquisicao, valor_minimo, valor_compre_por, valor_maior_oferta, qtde_anuncios,
  -- comprador, observacoes. Nasce 'vendido' — nunca entra no universo ativo.
  --
  -- ON CONFLICT DO NOTHING sem alvo: cobre qualquer índice único que exista ou venha a
  -- existir. Hoje os únicos de chassi (009, 010) são PARCIAIS sobre status ativo e não
  -- alcançam 'vendido'; se um dia virar total, isto degrada para "pula" em vez de
  -- estourar a transação e derrubar a importação inteira por causa de uma linha.
  WITH novo AS (
    SELECT (e -> 'patch') AS patch
    FROM jsonb_array_elements(v_preview -> 'a_criar') AS e
  ),
  n AS (
    SELECT aa_vnd_texto_obs(p.patch, 'chassi', 40)          AS chassi,
           aa_vnd_texto_obs(p.patch, 'placa', 10)           AS placa,
           aa_vnd_texto_obs(p.patch, 'modelo', 200)         AS modelo,
           aa_vnd_data_obs (p.patch, 'data_subiu')          AS data_subiu,
           aa_vnd_data_obs (p.patch, 'data_vendido')        AS data_vendido,
           aa_vnd_valor_obs(p.patch, 'valor_vendido')       AS valor_vendido,
           aa_vnd_valor_obs(p.patch, 'valor_compra_repasse') AS valor_compra_repasse
    FROM novo p
  )
  INSERT INTO repasses (
    chassi, placa, modelo, canal, status,
    data_subiu, data_subido, data_vendido, valor_vendido, valor_compra_repasse
  )
  SELECT n.chassi, n.placa, n.modelo, 'auto_avaliar', 'vendido',
         n.data_subiu, n.data_subiu, n.data_vendido, n.valor_vendido, n.valor_compra_repasse
  FROM n
  WHERE n.chassi IS NOT NULL AND n.placa IS NOT NULL
    AND n.modelo IS NOT NULL AND n.data_subiu IS NOT NULL
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_ins = ROW_COUNT;

  -- ── 3.3 GASTOS ─────────────────────────────────────────────────────────────────────
  -- Só entra quando o relatório observou gasto > 0 E o total já lançado do tipo
  -- 'auto_avaliar' DIFERE. Gasto zero no relatório NUNCA apaga gasto existente — ver a
  -- caixa "GASTOS" no cabeçalho desta migration.
  --
  -- Os repasses criados em 3.2 são reencontrados aqui por placa/chassi normalizados, não
  -- por RETURNING: `com_alteracao` e `a_criar` são grupos disjuntos do MESMO preview, e
  -- resolver os dois pela mesma expressão de match mantém uma regra só.
  --
  -- DELETE + INSERT na mesma tabela dentro de UM statement: as sub-instruções de um CTE
  -- data-modifying compartilham o snapshot, então o INSERT não enxerga o que o DELETE
  -- apagou e o DELETE não enxerga o que o INSERT criou. É exatamente o que se quer aqui —
  -- substituição atômica, sem janela em que o gasto exista duplicado ou não exista.
  WITH alvo AS (
    SELECT (e -> 'patch') AS patch, 'match'::text AS origem
      FROM jsonb_array_elements(v_preview -> 'com_alteracao') AS e
    UNION ALL
    SELECT (e -> 'patch') AS patch, 'novo'::text  AS origem
      FROM jsonb_array_elements(v_preview -> 'a_criar') AS e
  ),
  g AS (
    SELECT aa_vnd_valor_obs(a.patch, 'gastos') AS gasto,
           CASE WHEN a.origem = 'match' AND jsonb_typeof(a.patch -> 'repasse_id') = 'number'
                THEN (a.patch ->> 'repasse_id')::bigint END AS repasse_id,
           NULLIF(regexp_replace(upper(COALESCE(a.patch ->> 'placa',  '')), '[^A-Z0-9]', '', 'g'), '') AS placa_norm,
           NULLIF(regexp_replace(upper(COALESCE(a.patch ->> 'chassi', '')), '[^A-Z0-9]', '', 'g'), '') AS chassi_norm
    FROM alvo a
  ),
  res AS (
    -- Resolve o id: direto (match) ou pelo repasse recém-criado (novo).
    SELECT DISTINCT COALESCE(g.repasse_id, r.id) AS repasse_id, g.gasto
    FROM g
    LEFT JOIN repasses r
      ON g.repasse_id IS NULL
     AND r.status = 'vendido'
     AND ( (g.chassi_norm IS NOT NULL AND regexp_replace(upper(r.chassi), '[^A-Z0-9]', '', 'g') = g.chassi_norm)
        OR (g.placa_norm  IS NOT NULL AND regexp_replace(upper(r.placa),  '[^A-Z0-9]', '', 'g') = g.placa_norm) )
    WHERE g.gasto IS NOT NULL AND g.gasto > 0
  ),
  mudam AS (
    SELECT res.repasse_id, res.gasto
    FROM res
    WHERE res.repasse_id IS NOT NULL
      AND res.gasto IS DISTINCT FROM (
            SELECT sum(x.valor) FROM repasse_gastos x
             WHERE x.repasse_id = res.repasse_id AND x.tipo = 'auto_avaliar')
  ),
  apagados AS (
    -- Escopo tipo='auto_avaliar' => preserva gastos de OUTROS tipos (documentação,
    -- pintura, mecânica…), exatamente como a 028 faz.
    DELETE FROM repasse_gastos x USING mudam m
     WHERE x.repasse_id = m.repasse_id AND x.tipo = 'auto_avaliar'
    RETURNING x.id
  )
  -- `apagados` não é referenciado abaixo DE PROPÓSITO: um CTE data-modifying roda sempre,
  -- exatamente uma vez e até o fim, referenciado ou não. Amarrá-lo ao WHERE do INSERT só
  -- adicionaria um subplano que não muda nada.
  INSERT INTO repasse_gastos (repasse_id, tipo, descricao, valor, data)
  SELECT m.repasse_id, 'auto_avaliar', 'Gastos Auto Avaliar', m.gasto, v_hoje
  FROM mudam m;

  GET DIAGNOSTICS v_gas = ROW_COUNT;

  RETURN jsonb_set(jsonb_set(jsonb_set(
           jsonb_set(v_preview, '{modo}', '"aplicado"'::jsonb),
           '{resumo,linhas_gravadas}',  to_jsonb(v_upd)),
           '{resumo,repasses_criados}', to_jsonb(v_ins)),
           '{resumo,gastos_lancados}',  to_jsonb(v_gas));
END;
$fn$;

COMMENT ON FUNCTION public.importar_vendas_concluidas_auto_avaliar(jsonb) IS
  'Aplica a importação do relatório "Vendas Concluídas" do Auto Avaliar. Recalcula o diff '
  'chamando a RPC de preview (normalização única) e então: marca vendido + grava '
  'valor_vendido/data_vendido nos repasses que existem; CRIA como vendido os que não '
  'existem (a venda é fato consumado e o carro pode nunca ter passado pelo sistema); e '
  'lança Gastos Previstos como repasse_gastos(tipo=auto_avaliar) só quando > 0 e '
  'diferente do que já está lançado. valor_compra_repasse só PREENCHE, nunca sobrescreve. '
  'Uma transação, idempotente: reimportar o mesmo arquivo grava 0. SECURITY INVOKER. '
  'Nunca grava lucro, TAC nem PII de comprador. Migration 036.';


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 4. GRANTS EXPLÍCITOS — `anon` não executa NADA
-- =====================================================================================
-- O Postgres concede EXECUTE a PUBLIC por padrão em toda função nova: sem REVOKE, `anon`
-- (a chave pública embarcada no bundle do navegador) sai com permissão no instante em que
-- esta migration roda. Hoje isso é inofensivo — INVOKER + RLS barram — mas cria a
-- armadilha: no dia em que alguém trocar para SECURITY DEFINER "pra resolver um problema
-- de permissão", o buraco abre EM SILÊNCIO, sem nenhuma linha de migration mencionando
-- anon. Foi exatamente assim que a 020 virou a 026 (vazamento de nome + telefone de lead
-- via anon key). Aqui o risco é maior que na 029: esta RPC ESCREVE em `repasses`.
-- ─────────────────────────────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.importar_vendas_concluidas_auto_avaliar_preview(jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.importar_vendas_concluidas_auto_avaliar_preview(jsonb) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.importar_vendas_concluidas_auto_avaliar(jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.importar_vendas_concluidas_auto_avaliar(jsonb) TO authenticated, service_role;

-- Helpers puros (não tocam tabela nenhuma); ainda assim, sem anon.
REVOKE EXECUTE ON FUNCTION public.aa_vnd_valor_obs(jsonb, text)           FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.aa_vnd_valor_obs(jsonb, text)           TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.aa_vnd_data_obs(jsonb, text)            FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.aa_vnd_data_obs(jsonb, text)            TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.aa_vnd_texto_obs(jsonb, text, integer)  FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.aa_vnd_texto_obs(jsonb, text, integer)  TO authenticated, service_role;


-- =====================================================================================
-- VERIFICAÇÃO PÓS-MIGRATION (rodar manualmente depois de aplicar)
-- =====================================================================================
-- 1) anon NÃO executa (esperado: false, false):
--      SELECT has_function_privilege('anon','public.importar_vendas_concluidas_auto_avaliar_preview(jsonb)','EXECUTE'),
--             has_function_privilege('anon','public.importar_vendas_concluidas_auto_avaliar(jsonb)','EXECUTE');
--
-- 2) authenticated executa (esperado: true, true):
--      SELECT has_function_privilege('authenticated','public.importar_vendas_concluidas_auto_avaliar_preview(jsonb)','EXECUTE'),
--             has_function_privilege('authenticated','public.importar_vendas_concluidas_auto_avaliar(jsonb)','EXECUTE');
--
-- 3) Nenhuma é SECURITY DEFINER; preview é STABLE e aplicação é VOLATILE
--    (esperado: f/s e f/v):
--      SELECT proname, prosecdef, provolatile
--        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname='public' AND proname LIKE 'importar_vendas_concluidas_auto_avaliar%';
--
-- 4) O corpo NÃO menciona o que não pode mencionar (esperado: 0 linhas):
--      SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname='public' AND proname LIKE 'importar_vendas_concluidas_auto_avaliar%'
--         AND (pg_get_functiondef(p.oid) ~* '(valor_aquisicao|current_date|comprador|lucro|\mtac\M)');
--
-- 5) O preview NÃO escreve (esperado: 0 linhas — a engine já garante, isto é o cinto):
--      SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname='public' AND proname = 'importar_vendas_concluidas_auto_avaliar_preview'
--         AND pg_get_functiondef(p.oid) ~* '(insert\s+into|update\s+repasses|delete\s+from)';
--
-- 6) A RPC do fluxo de TEXTO segue intacta (esperado: true):
--      SELECT pg_get_functiondef(p.oid) ~* 'DELETE\s+FROM\s+repasse_gastos' AS delete_ainda_existe
--        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname='public' AND proname = 'importar_repasse_auto_avaliar';
--
-- 7) Smoke idempotente (2x o MESMO payload, dentro de transação com ROLLBACK):
--      BEGIN;
--        SELECT importar_vendas_concluidas_auto_avaliar('{...payload real...}'::jsonb) -> 'resumo';
--        -- 2ª execução: linhas_gravadas = 0, repasses_criados = 0, gastos_lancados = 0
--        SELECT importar_vendas_concluidas_auto_avaliar('{...mesmo payload...}'::jsonb) -> 'resumo';
--      ROLLBACK;
--
-- 8) Nenhum repasse ficou 'vendido' sem valor ou sem data (esperado: 0):
--      SELECT count(*) FROM repasses
--       WHERE status = 'vendido' AND (valor_vendido IS NULL OR data_vendido IS NULL);
--
-- 9) Nenhum carro com gasto auto_avaliar duplicado (esperado: 0 linhas):
--      SELECT repasse_id, count(*) FROM repasse_gastos WHERE tipo = 'auto_avaliar'
--       GROUP BY repasse_id HAVING count(*) > 1;
-- =====================================================================================
-- FIM da migration 036
-- =====================================================================================
