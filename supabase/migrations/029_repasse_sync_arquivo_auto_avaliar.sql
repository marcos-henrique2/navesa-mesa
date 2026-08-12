-- Navesa Mesa — Migration 029: sync incremental do arquivo `relatorio_VeiculosEmOferta.xls`
-- =====================================================================================
-- Story:   docs/stories/story-2.2-sync-arquivo-veiculos-em-oferta.md (rev. 3, Fatia 3a)
-- Desenho: docs/design/rpc-sync-arquivo-auto-avaliar.md (Dara)
-- ADR:     docs/design/adr-002-duas-fontes-auto-avaliar.md (Aria)
--
-- Entrega: 2 colunas novas em `repasses` + 3 helpers puros + 2 RPCs (preview STABLE e
--          aplicação VOLATILE, esta chamando aquela). ADITIVO PURO.
--
--
-- ╔═══════════════════════════════════════════════════════════════════════════════════╗
-- ║  INVARIANTE PERMANENTE DE ARQUITETURA — ADR-002, item 3                           ║
-- ║  ─────────────────────────────────────────────────────────────────────────────    ║
-- ║  `repasses.valor_maior_oferta` e `repasses.qtde_anuncios` NUNCA podem entrar no   ║
-- ║  UPDATE nem no INSERT de `importar_repasse_auto_avaliar` (a RPC do fluxo de       ║
-- ║  TEXTO, definida em 028_datas_de_calendario_em_brasilia.sql).                     ║
-- ║                                                                                    ║
-- ║  POR QUÊ: aquela RPC é ESPELHO — grava os campos de valor INCONDICIONALMENTE      ║
-- ║  (028:255-263) e campo não observado vira NULL. O arquivo é a FONTE AUTORITATIVA  ║
-- ║  ÚNICA destas duas colunas, e o texto não as conhece. Adicioná-las lá converteria ║
-- ║  a fonte espelho na DESTRUIDORA do único ganho real da Fatia 3a: toda colagem de  ║
-- ║  texto zeraria a maior oferta e a qtde de anúncios de todos os carros, em         ║
-- ║  silêncio, sem nenhum sintoma na tela.                                            ║
-- ║                                                                                    ║
-- ║  SE VOCÊ ABRIU A 028 PARA "SÓ ADICIONAR MAIS UM CAMPO": é destas duas colunas que ║
-- ║  se trata. Não adicione. Se precisar de paridade texto↔arquivo nelas, use         ║
-- ║  COALESCE(observado, coluna) — nunca escrita incondicional — e abra story própria ║
-- ║  (gatilho G2 do ADR-002 §5).                                                      ║
-- ╚═══════════════════════════════════════════════════════════════════════════════════╝
--
--
-- GARANTIAS ESTRUTURAIS DESTA MIGRATION (ausência de statement, não flag de runtime)
--   • NUNCA cria repasse .... não existe INSERT em `repasses` no corpo das RPCs.
--     Placa sem repasse ativo é REPORTADA, nunca inserida. Vale no banco, não só na
--     tela: não há camada de servidor no projeto, toda RPC é chamada direto do
--     navegador e o payload é integralmente adulterável.
--   • NUNCA toca a tabela de gastos do repasse (a que a 028 apaga incondicionalmente
--     no fluxo de texto): nenhum SELECT, nenhum DELETE, nenhum INSERT. O nome daquela
--     tabela não aparece no corpo de nenhuma das duas RPCs — verificável com
--     pg_get_functiondef (§11 do desenho, query 5).
--   • NUNCA toca o custo de aquisição de varejo/NBS: fora da whitelist estática de 8
--     colunas do SET. Sem SQL dinâmico, sem EXECUTE format(), sem nome de coluna vindo
--     do cliente.
--   • NUNCA apaga valor existente: COALESCE(observado, coluna) jamais resulta em NULL
--     sobre coluna preenchida.
--   • A 028 NÃO É ALTERADA. Nem assinatura, nem corpo, nem grants.
--
-- DATAS DE CALENDÁRIO: nenhuma é gravada aqui — as 8 colunas da whitelist são numéricas
--   e `atualizado_em` é timestamptz (instante técnico, now()). Se um dia esta RPC
--   precisar carimbar um DIA, use public.hoje_brasilia() (migration 027), nunca o
--   equivalente do Postgres em UTC: o banco roda em UTC e entre 21h e a meia-noite de
--   Brasília ele já está no dia seguinte (ver cabeçalho da 028).
--
-- IDEMPOTENTE: ADD COLUMN IF NOT EXISTS · DROP CONSTRAINT IF EXISTS + ADD ·
--   CREATE OR REPLACE FUNCTION · REVOKE + GRANT. Roda 2x sem erro, não dropa nada.
-- =====================================================================================


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 1. COLUNAS NOVAS (§6 do desenho / AC9 / AC9b)
-- =====================================================================================
-- RLS: nada a fazer. A policy `authenticated_all_access` de `repasses` é por LINHA, não
-- por coluna — colunas novas herdam automaticamente (mesma observação das migrations
-- 023 e 025).
--
-- ÍNDICES: nenhum novo (§7). O match usa `idx_repasses_placa_norm` (índice funcional da
-- 025, expressão literalmente idêntica à usada aqui) e o UPDATE usa a PK. Não há consulta
-- planejada que filtre ou ordene pelas colunas novas.
-- ─────────────────────────────────────────────────────────────────────────────────────

ALTER TABLE repasses ADD COLUMN IF NOT EXISTS valor_maior_oferta numeric(12, 2);

COMMENT ON COLUMN repasses.valor_maior_oferta IS
  'Maior oferta recebida no Auto Avaliar ("Vlr Maior Oferta"), vinda do arquivo '
  'relatorio_VeiculosEmOferta.xls. FONTE AUTORITATIVA ÚNICA: o arquivo (ADR-002 item 2). '
  'O fluxo de TEXTO (importar_repasse_auto_avaliar) NÃO conhece nem pode escrever esta '
  'coluna — ver invariante no cabeçalho da migration 029. '
  'numeric(12,2) centavo-perfect. NULL = nenhuma oferta observada (distinto de R$ 0,00). '
  'Informação de MERCADO: não entra em custo nem em margem (custo_real usa apenas '
  'valor_compra_repasse + gastos). Migration 029.';

ALTER TABLE repasses ADD COLUMN IF NOT EXISTS qtde_anuncios integer;

ALTER TABLE repasses DROP CONSTRAINT IF EXISTS repasses_qtde_anuncios_check;
ALTER TABLE repasses ADD  CONSTRAINT repasses_qtde_anuncios_check
  CHECK (qtde_anuncios >= 0);

COMMENT ON COLUMN repasses.qtde_anuncios IS
  'Quantidade de anúncios ativos do carro no Auto Avaliar ("Qtde Anuncios"), vinda do '
  'arquivo relatorio_VeiculosEmOferta.xls. FONTE AUTORITATIVA ÚNICA: o arquivo '
  '(ADR-002 item 2). O fluxo de TEXTO NÃO conhece nem pode escrever esta coluna — ver '
  'invariante no cabeçalho da migration 029. '
  'NULL = não medido (carro que nunca passou pelo arquivo). ZERO É VALOR REAL: '
  '"medido, sem anúncio ativo". Único campo do arquivo em que 0 não significa ausência. '
  'Contexto competitivo, não entra em nenhuma comparação de valor. Migration 029.';


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 2. HELPERS DE NORMALIZAÇÃO NA FRONTEIRA (§4.1 do desenho)
-- =====================================================================================
-- Uma implementação só de "o que este arquivo observa", usada pelo preview E pela
-- aplicação. É isto que impede a tela de mentir sobre o que vai ser gravado.
--
-- `jsonb_typeof(...) = 'number'` em vez de `->>` + cast: a 028 faz
-- `NULLIF(v_reg->>'campo','')::numeric` e, se uma célula chegar como "R$ 68.000",
-- estoura 22P02 e ABORTA A TRANSAÇÃO INTEIRA — 61 linhas perdidas por uma célula.
-- Aqui, célula inválida vira "não observado" e a linha é reportada. Endurecimento
-- deliberado em relação à 028.
--
-- `round(..., 2)` no SERVIDOR: o .xls é HTML lido por SheetJS no navegador; pt-BR
-- ("71.900,00") passa por parsing de float e pode chegar como 71900.00000000001. Sem
-- arredondar aqui vira diff falso, UPDATE inútil e violação da regra centavo-perfect.
-- Arredondar no parser não bastaria — o parser roda no cliente.
-- ─────────────────────────────────────────────────────────────────────────────────────

-- Valor monetário observado: só aceita JSON number; ZERO É AUSÊNCIA; arredonda a 2 casas.
CREATE OR REPLACE FUNCTION public.aa_arq_valor_obs(p_item jsonb, p_chave text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
           WHEN jsonb_typeof(p_item -> p_chave) = 'number'
           THEN NULLIF(round((p_item ->> p_chave)::numeric, 2), 0)
         END
$$;

COMMENT ON FUNCTION public.aa_arq_valor_obs(jsonb, text) IS
  'Normaliza uma célula monetária do arquivo Auto Avaliar: JSON number → numeric(2 casas); '
  'zero → NULL (ausência); qualquer outro tipo JSON → NULL (não observado, sem estourar '
  'a transação). Migration 029.';

-- Contagem observada: só aceita JSON number; ZERO É VALOR REAL (não vira NULL);
-- negativo é lixo (vira "não observado" antes mesmo do CHECK da coluna).
CREATE OR REPLACE FUNCTION public.aa_arq_qtde_obs(p_item jsonb, p_chave text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
           WHEN jsonb_typeof(p_item -> p_chave) = 'number'
                AND (p_item ->> p_chave)::numeric >= 0
           THEN trunc((p_item ->> p_chave)::numeric)::integer
         END
$$;

COMMENT ON FUNCTION public.aa_arq_qtde_obs(jsonb, text) IS
  'Normaliza uma célula de CONTAGEM do arquivo Auto Avaliar: JSON number >= 0 → integer '
  '(ZERO preservado: "medido, sem anúncio"); negativo ou outro tipo → NULL. É o único '
  'campo do arquivo em que 0 não é ausência. Migration 029.';

-- Zero monetário EXPLÍCITO: distingue "veio 0,00 no arquivo" de "não veio nada".
-- Existe só por causa da AC13c: `Valor Compra = 0,00` não pode virar "não observado"
-- em silêncio, porque valor_compra_repasse é a base de custo_real.
CREATE OR REPLACE FUNCTION public.aa_arq_zero_explicito(p_item jsonb, p_chave text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(
           jsonb_typeof(p_item -> p_chave) = 'number'
             AND round((p_item ->> p_chave)::numeric, 2) = 0,
           false)
$$;

COMMENT ON FUNCTION public.aa_arq_zero_explicito(jsonb, text) IS
  'TRUE quando a célula veio no arquivo como número ZERO (distinto de ausente/inválida). '
  'Usada só para o custo-base: AC13c manda a linha para ignoradas/valor_compra_zerado em '
  'vez de deixá-la passar como "sem alteração". Migration 029.';


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 3. RPC DE PREVIEW — STABLE, read-only garantido pela ENGINE (§2.1 do desenho)
-- =====================================================================================
-- STABLE não é documentação: se alguém escrever um UPDATE aqui dentro, o Postgres estoura
-- em runtime com "UPDATE is not allowed in a non-volatile function". Não dá pra esquecer
-- de checar um flag, porque não existe flag — a alternativa "uma função com
-- p_dry_run boolean" foi rejeitada justamente porque o valor viria do navegador.
--
-- SECURITY INVOKER: o RLS é o backstop real, não o GRANT. Chamador sem sessão enxerga
-- zero linhas em `repasses` → tudo cai em nao_encontradas e nada é escrito.
-- SECURITY DEFINER aqui seria repetir a combinação que produziu o vazamento de PII
-- corrigido pela 026 (DEFINER + anon com EXECUTE). Não repetir.
--
-- Retorno: contrato do §5 do desenho — 3 grupos + resumo, mesmo formato do modo aplicado.
-- ─────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sincronizar_repasse_arquivo_auto_avaliar_preview(
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE
  v_total      integer;
  v_lim        integer;   -- teto por array do retorno (§5, teto de payload de resposta)
  v_truncado   boolean;
  v_gerado_em  text;

  v_com        jsonb;  v_n_com integer;
  v_sem        jsonb;  v_n_sem integer;
  v_nao        jsonb;  v_n_nao integer;
  v_ign        jsonb;  v_n_ign integer;
  v_campos     integer;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'p_payload deve ser um objeto JSONB';
  END IF;
  IF jsonb_typeof(p_payload -> 'linhas') <> 'array' THEN
    RAISE EXCEPTION 'p_payload.linhas deve ser um array JSONB';
  END IF;

  v_total := jsonb_array_length(p_payload -> 'linhas');

  -- Guarda de entrada: hoje são ~61 linhas. O teto existe para que um payload adulterado
  -- não vire DoS de CPU num Postgres compartilhado.
  IF v_total > 2000 THEN
    RAISE EXCEPTION 'payload com % linhas excede o teto de 2000', v_total;
  END IF;

  -- Arrays do retorno são truncados acima de 500 linhas; o `resumo` continua exato.
  -- EXCEÇÃO DELIBERADA (divergência consciente do §5 do desenho): `com_alteracao` NUNCA
  -- é truncado, porque é ele que carrega o `patch` que a função de aplicar consome.
  -- Truncar aquele array transformaria "arquivo grande" em GRAVAÇÃO PARCIAL SILENCIOSA.
  v_truncado := v_total > 500;
  v_lim      := CASE WHEN v_truncado THEN 200 ELSE 2000 END;

  -- Instante técnico de geração do relatório (não é data de calendário).
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
      -- Placa CRUA normalizada no servidor, com a expressão LITERALMENTE igual à do
      -- índice funcional idx_repasses_placa_norm (025). Não se confia em placa_norm
      -- vinda do cliente, e o payload não carrega repasse_id: o match é server-side.
      NULLIF(regexp_replace(upper(COALESCE(t.item ->> 'placa', '')),
                            '[^A-Z0-9]', '', 'g'), '') AS placa_norm,
      CASE WHEN jsonb_typeof(t.item) = 'object' THEN t.item ELSE '{}'::jsonb END AS item
    FROM jsonb_array_elements(p_payload -> 'linhas') WITH ORDINALITY AS t(item, ord)
  ),
  obs AS (
    SELECT l.ord, l.linha, l.placa_norm,
           aa_arq_valor_obs(l.item, 'valor_compra_repasse') AS o_compra,
           aa_arq_valor_obs(l.item, 'valor_minimo')         AS o_minimo,
           aa_arq_valor_obs(l.item, 'valor_compre_por')     AS o_compre_por,
           aa_arq_valor_obs(l.item, 'valor_fipe')           AS o_fipe,
           aa_arq_valor_obs(l.item, 'valor_web')            AS o_web,
           aa_arq_valor_obs(l.item, 'valor_auto_avaliar')   AS o_aa,
           aa_arq_valor_obs(l.item, 'valor_maior_oferta')   AS o_oferta,
           aa_arq_qtde_obs (l.item, 'qtde_anuncios')        AS o_qtde,
           aa_arq_zero_explicito(l.item, 'valor_compra_repasse') AS compra_zerada,
           -- Patch = valores observados já normalizados PELA PRÓPRIA RPC. É o que a
           -- função de aplicar consome, e o que garante normalização única.
           jsonb_strip_nulls(jsonb_build_object(
             'valor_compra_repasse', aa_arq_valor_obs(l.item, 'valor_compra_repasse'),
             'valor_minimo',         aa_arq_valor_obs(l.item, 'valor_minimo'),
             'valor_compre_por',     aa_arq_valor_obs(l.item, 'valor_compre_por'),
             'valor_fipe',           aa_arq_valor_obs(l.item, 'valor_fipe'),
             'valor_web',            aa_arq_valor_obs(l.item, 'valor_web'),
             'valor_auto_avaliar',   aa_arq_valor_obs(l.item, 'valor_auto_avaliar'),
             'valor_maior_oferta',   aa_arq_valor_obs(l.item, 'valor_maior_oferta'),
             'qtde_anuncios',        aa_arq_qtde_obs (l.item, 'qtde_anuncios')
           )) AS patch
    FROM linhas l
  ),
  dup AS (
    -- Placa repetida no MESMO arquivo: vence a primeira ocorrência. Sem isto, um
    -- UPDATE ... FROM com duas linhas casando o mesmo id aplicaria uma ARBITRÁRIA
    -- (o Postgres não define qual) — não determinismo é o pior bug de um importador.
    SELECT ord, row_number() OVER (PARTITION BY placa_norm ORDER BY ord) AS rn
    FROM obs
    WHERE placa_norm IS NOT NULL
  ),
  cand AS (
    SELECT o.*, COALESCE(d.rn, 1) AS rn
    FROM obs o
    LEFT JOIN dup d ON d.ord = o.ord
  ),
  ativos AS (
    SELECT c.ord,
           count(*)::integer          AS n_ativos,
           min(r.id)                  AS repasse_id,
           jsonb_agg(r.id ORDER BY r.id) AS ids
    FROM cand c
    JOIN repasses r
      ON regexp_replace(upper(r.placa), '[^A-Z0-9]', '', 'g') = c.placa_norm
     AND r.status IN ('subido', 'marcado')
    WHERE c.placa_norm IS NOT NULL AND c.rn = 1
    GROUP BY c.ord
  ),
  inativos AS (
    -- Lookup extra (sem filtro de status) só para responder a pergunta que o usuário faz
    -- de verdade: "esse carro sumiu do sistema ou já foi vendido?".
    SELECT c.ord, (array_agg(r.status ORDER BY r.id DESC))[1] AS status_atual
    FROM cand c
    JOIN repasses r
      ON regexp_replace(upper(r.placa), '[^A-Z0-9]', '', 'g') = c.placa_norm
     AND r.status NOT IN ('subido', 'marcado')
    WHERE c.placa_norm IS NOT NULL AND c.rn = 1
    GROUP BY c.ord
  ),
  clas AS (
    SELECT c.*,
           COALESCE(a.n_ativos, 0) AS n_ativos,
           a.repasse_id,
           a.ids,
           i.status_atual,
           CASE
             WHEN c.placa_norm IS NULL   THEN 'ign:placa_invalida'
             WHEN c.rn > 1               THEN 'ign:placa_duplicada_no_arquivo'
             -- AC13c: custo-base zerado explicitamente NÃO pode virar "sem alteração".
             WHEN c.compra_zerada        THEN 'ign:valor_compra_zerado'
             WHEN c.o_compra IS NULL AND c.o_minimo  IS NULL AND c.o_compre_por IS NULL
              AND c.o_fipe   IS NULL AND c.o_web     IS NULL AND c.o_aa         IS NULL
              AND c.o_oferta IS NULL AND c.o_qtde    IS NULL
                                         THEN 'ign:nenhum_campo_observado'
             -- Divirjo da 028 de propósito: ela resolve ambiguidade com ORDER BY id
             -- LIMIT 1. Sem UNIQUE de placa em repasse ativo (a 009 é sobre chassi),
             -- "menor id" é um chute que o usuário nunca vê. Ambíguo aparece na tela.
             WHEN COALESCE(a.n_ativos, 0) > 1 THEN 'ign:repasse_ambiguo'
             WHEN COALESCE(a.n_ativos, 0) = 0 AND i.status_atual IS NOT NULL
                                         THEN 'nao:repasse_inativo'
             WHEN COALESCE(a.n_ativos, 0) = 0 THEN 'nao:sem_repasse'
             ELSE 'match'
           END AS classe
    FROM cand c
    LEFT JOIN ativos   a ON a.ord = c.ord
    LEFT JOIN inativos i ON i.ord = c.ord
  ),
  m AS (
    SELECT cl.*, r.modelo, r.status,
           r.valor_compra_repasse AS a_compra,
           r.valor_minimo         AS a_minimo,
           r.valor_compre_por     AS a_compre_por,
           r.valor_fipe           AS a_fipe,
           r.valor_web            AS a_web,
           r.valor_auto_avaliar   AS a_aa,
           r.valor_maior_oferta   AS a_oferta,
           r.qtde_anuncios        AS a_qtde
    FROM clas cl
    JOIN repasses r ON r.id = cl.repasse_id
    WHERE cl.classe = 'match'
  ),
  campos AS (
    -- WHITELIST ESTÁTICA DE 8 COLUNAS. Não há SQL dinâmico em lugar nenhum desta
    -- migration: nome de coluna nunca vem do cliente.
    SELECT m.ord, x.campo, x.obs, x.atual, (x.obs IS DISTINCT FROM x.atual) AS mudou
    FROM m
    CROSS JOIN LATERAL (VALUES
      ('valor_compra_repasse', m.o_compra,           m.a_compra),
      ('valor_minimo',         m.o_minimo,           m.a_minimo),
      ('valor_compre_por',     m.o_compre_por,       m.a_compre_por),
      ('valor_fipe',           m.o_fipe,             m.a_fipe),
      ('valor_web',            m.o_web,              m.a_web),
      ('valor_auto_avaliar',   m.o_aa,               m.a_aa),
      ('valor_maior_oferta',   m.o_oferta,           m.a_oferta),
      ('qtde_anuncios',        m.o_qtde::numeric,    m.a_qtde::numeric)
    ) AS x(campo, obs, atual)
    WHERE x.obs IS NOT NULL          -- não observado simplesmente não aparece
  ),
  agg AS (
    SELECT ord,
           jsonb_agg(jsonb_build_object(
             'campo',  campo,
             'antes',  to_jsonb(atual),
             'depois', to_jsonb(obs),
             -- preencher buraco é seguro; mudar número que já existia merece destaque
             'acao',   CASE WHEN atual IS NULL THEN 'preenche' ELSE 'altera' END
           ) ORDER BY campo) FILTER (WHERE mudou)          AS campos,
           count(*) FILTER (WHERE mudou)::integer           AS n_mudou,
           COALESCE(jsonb_agg(to_jsonb(campo) ORDER BY campo)
                    FILTER (WHERE NOT mudou), '[]'::jsonb)  AS iguais,
           count(*)::integer                                AS n_observados
    FROM campos
    GROUP BY ord
  ),
  com AS (
    SELECT m.ord, m.linha, m.placa_norm, m.repasse_id, m.modelo, m.status,
           a.campos, a.iguais, m.patch
    FROM m JOIN agg a ON a.ord = m.ord
    WHERE a.n_mudou > 0
  ),
  sem AS (
    SELECT m.ord, m.linha, m.placa_norm, m.repasse_id, m.modelo, a.n_observados
    FROM m JOIN agg a ON a.ord = m.ord
    WHERE a.n_mudou = 0
  ),
  nao AS (
    SELECT ord, linha, placa_norm, split_part(classe, ':', 2) AS motivo, status_atual
    FROM clas WHERE classe LIKE 'nao:%'
  ),
  ign AS (
    -- `repasse_ids` só faz sentido em repasse_ambiguo (é a lista que o usuário precisa
    -- desempatar). Nos outros motivos ele seria ruído no contrato do §5, e some via
    -- jsonb_strip_nulls.
    SELECT ord, linha, placa_norm, split_part(classe, ':', 2) AS motivo,
           CASE WHEN classe = 'ign:repasse_ambiguo' THEN ids END AS ids
    FROM clas WHERE classe LIKE 'ign:%'
  )
  SELECT
    -- GRUPO 2 — vão mudar (nunca truncado: carrega o patch que a aplicação consome)
    COALESCE((SELECT jsonb_agg(z.j ORDER BY z.ord) FROM (
       SELECT ord, jsonb_build_object(
         'linha', linha, 'placa_norm', placa_norm, 'repasse_id', repasse_id,
         'modelo', modelo, 'status', status,
         'campos', campos,
         'campos_observados_sem_mudanca', iguais,
         'patch', patch
       ) AS j FROM com ORDER BY ord) z), '[]'::jsonb),
    (SELECT count(*)::integer FROM com),

    -- GRUPO 1 — sem alteração
    COALESCE((SELECT jsonb_agg(z.j ORDER BY z.ord) FROM (
       SELECT ord, jsonb_build_object(
         'linha', linha, 'placa_norm', placa_norm, 'repasse_id', repasse_id,
         'modelo', modelo, 'campos_observados', n_observados
       ) AS j FROM sem ORDER BY ord LIMIT v_lim) z), '[]'::jsonb),
    (SELECT count(*)::integer FROM sem),

    -- GRUPO 3a — placa do arquivo que não casou com repasse ativo
    COALESCE((SELECT jsonb_agg(z.j ORDER BY z.ord) FROM (
       SELECT ord, jsonb_strip_nulls(jsonb_build_object(
         'linha', linha, 'placa_norm', placa_norm, 'motivo', motivo,
         'status_atual', status_atual
       )) AS j FROM nao ORDER BY ord LIMIT v_lim) z), '[]'::jsonb),
    (SELECT count(*)::integer FROM nao),

    -- GRUPO 3b — linhas descartadas antes do match
    COALESCE((SELECT jsonb_agg(z.j ORDER BY z.ord) FROM (
       SELECT ord, jsonb_strip_nulls(jsonb_build_object(
         'linha', linha, 'placa_norm', placa_norm, 'motivo', motivo,
         'repasse_ids', ids
       )) AS j FROM ign ORDER BY ord LIMIT v_lim) z), '[]'::jsonb),
    (SELECT count(*)::integer FROM ign),

    COALESCE((SELECT sum(n_mudou)::integer FROM agg), 0)
  INTO v_com, v_n_com, v_sem, v_n_sem, v_nao, v_n_nao, v_ign, v_n_ign, v_campos;

  RETURN jsonb_build_object(
    'versao',    1,
    'modo',      'preview',
    'gerado_em', v_gerado_em,
    'truncado',  v_truncado,
    'resumo', jsonb_build_object(
      'linhas_no_arquivo', v_total,
      'sem_alteracao',     v_n_sem,
      'com_alteracao',     v_n_com,
      'nao_encontradas',   v_n_nao,
      'ignoradas',         v_n_ign,
      'campos_a_alterar',  v_campos,
      'linhas_gravadas',   0        -- preview nunca grava
    ),
    'com_alteracao',   v_com,
    'sem_alteracao',   v_sem,
    'nao_encontradas', v_nao,
    'ignoradas',       v_ign
  );
END;
$fn$;

COMMENT ON FUNCTION public.sincronizar_repasse_arquivo_auto_avaliar_preview(jsonb) IS
  'Fatia 3a: calcula o diff do arquivo relatorio_VeiculosEmOferta.xls contra os repasses '
  'ativos e devolve o relatório em 3 grupos (contrato §5 do desenho). READ-ONLY garantido '
  'pela engine (STABLE). SECURITY INVOKER: respeita o RLS de quem chama. Nunca cria '
  'repasse, nunca toca a tabela de gastos, nunca toca o custo de aquisição. Migration 029.';


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 4. RPC DE APLICAÇÃO — VOLATILE, chama o preview e escreve (§2.1 e §4.2 do desenho)
-- =====================================================================================
-- A confirmação NÃO recebe o diff que o usuário viu na tela: ela RECALCULA do zero contra
-- o banco vivo, a partir do mesmo payload bruto, chamando a função de preview. O cliente
-- não consegue confirmar uma mudança que o banco não derivaria sozinho, e não existe
-- duplicação da regra de normalização entre preview e gravação.
--
-- O retorno tem exatamente o mesmo formato do preview, com modo = "aplicado": o front
-- reaproveita o componente de tela e pode diffar preview × aplicado para detectar deriva
-- ("3 carros mudaram entre a conferência e a confirmação").
-- ─────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sincronizar_repasse_arquivo_auto_avaliar(
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
  v_gravadas integer := 0;
BEGIN
  v_preview := public.sincronizar_repasse_arquivo_auto_avaliar_preview(p_payload);

  WITH alvo AS (
    SELECT (e ->> 'repasse_id')::bigint AS repasse_id,
           e -> 'patch'                 AS patch
    FROM jsonb_array_elements(v_preview -> 'com_alteracao') AS e
  ),
  o AS (
    -- Mesmos helpers do preview: uma normalização só, aplicada duas vezes.
    SELECT a.repasse_id,
           aa_arq_valor_obs(a.patch, 'valor_compra_repasse') AS valor_compra_repasse,
           aa_arq_valor_obs(a.patch, 'valor_minimo')         AS valor_minimo,
           aa_arq_valor_obs(a.patch, 'valor_compre_por')     AS valor_compre_por,
           aa_arq_valor_obs(a.patch, 'valor_fipe')           AS valor_fipe,
           aa_arq_valor_obs(a.patch, 'valor_web')            AS valor_web,
           aa_arq_valor_obs(a.patch, 'valor_auto_avaliar')   AS valor_auto_avaliar,
           aa_arq_valor_obs(a.patch, 'valor_maior_oferta')   AS valor_maior_oferta,
           aa_arq_qtde_obs (a.patch, 'qtde_anuncios')        AS qtde_anuncios
    FROM alvo a
    WHERE a.repasse_id IS NOT NULL
  )
  -- WHITELIST ESTÁTICA DE 8 COLUNAS + atualizado_em. Auditável em 10 segundos: dá pra
  -- ver, olhando, o que NÃO está aqui. COALESCE(observado, coluna) faz cada coluna cair
  -- de volta no próprio valor quando o arquivo não observou — nenhum caminho do código
  -- consegue gravar NULL por cima de valor existente.
  UPDATE repasses r SET
    valor_compra_repasse = COALESCE(o.valor_compra_repasse, r.valor_compra_repasse),
    valor_minimo         = COALESCE(o.valor_minimo,         r.valor_minimo),
    valor_compre_por     = COALESCE(o.valor_compre_por,     r.valor_compre_por),
    valor_fipe           = COALESCE(o.valor_fipe,           r.valor_fipe),
    valor_web            = COALESCE(o.valor_web,            r.valor_web),
    valor_auto_avaliar   = COALESCE(o.valor_auto_avaliar,   r.valor_auto_avaliar),
    valor_maior_oferta   = COALESCE(o.valor_maior_oferta,   r.valor_maior_oferta),
    qtde_anuncios        = COALESCE(o.qtde_anuncios,        r.qtde_anuncios),
    atualizado_em        = now()   -- timestamptz: instante técnico, NÃO converter
  FROM o
  WHERE r.id = o.repasse_id
    AND r.status IN ('subido', 'marcado')     -- guarda de escopo, redundante mas barata
    AND (                                      -- guarda de MUDANÇA REAL
         (o.valor_compra_repasse IS NOT NULL AND o.valor_compra_repasse IS DISTINCT FROM r.valor_compra_repasse)
      OR (o.valor_minimo         IS NOT NULL AND o.valor_minimo         IS DISTINCT FROM r.valor_minimo)
      OR (o.valor_compre_por     IS NOT NULL AND o.valor_compre_por     IS DISTINCT FROM r.valor_compre_por)
      OR (o.valor_fipe           IS NOT NULL AND o.valor_fipe           IS DISTINCT FROM r.valor_fipe)
      OR (o.valor_web            IS NOT NULL AND o.valor_web            IS DISTINCT FROM r.valor_web)
      OR (o.valor_auto_avaliar   IS NOT NULL AND o.valor_auto_avaliar   IS DISTINCT FROM r.valor_auto_avaliar)
      OR (o.valor_maior_oferta   IS NOT NULL AND o.valor_maior_oferta   IS DISTINCT FROM r.valor_maior_oferta)
      OR (o.qtde_anuncios        IS NOT NULL AND o.qtde_anuncios        IS DISTINCT FROM r.qtde_anuncios)
    );

  GET DIAGNOSTICS v_gravadas = ROW_COUNT;

  RETURN jsonb_set(
           jsonb_set(v_preview, '{modo}', '"aplicado"'::jsonb),
           '{resumo,linhas_gravadas}', to_jsonb(v_gravadas)
         );
END;
$fn$;

COMMENT ON FUNCTION public.sincronizar_repasse_arquivo_auto_avaliar(jsonb) IS
  'Fatia 3a: aplica o sync do arquivo relatorio_VeiculosEmOferta.xls. Recalcula o diff '
  'chamando a RPC de preview (normalização única) e grava com COALESCE(observado, coluna) '
  'sobre whitelist estática de 8 colunas, com guarda IS DISTINCT FROM. Uma transação, '
  'idempotente. SECURITY INVOKER. Nunca cria repasse, nunca toca a tabela de gastos, '
  'nunca toca o custo de aquisição. Retorno = mesmo contrato do preview, modo "aplicado". '
  'Migration 029.';


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 5. GRANTS EXPLÍCITOS — `anon` não executa NADA (§8.2 do desenho)
-- =====================================================================================
-- O Postgres concede EXECUTE a PUBLIC por padrão em toda função nova: sem REVOKE, `anon`
-- (a chave pública embarcada no bundle do navegador) sai com permissão no instante em que
-- esta migration roda. Hoje isso é inofensivo — INVOKER + RLS barram — mas cria a
-- armadilha: no dia em que alguém trocar para SECURITY DEFINER "pra resolver um problema
-- de permissão", o buraco abre EM SILÊNCIO, sem nenhuma linha de migration mencionando
-- anon. Foi exatamente assim que a 020 virou a 026 (vazamento de nome + telefone de lead
-- via anon key). Revogar agora custa 6 linhas e deixa a intenção legível junto do código.
--
-- A ressalva da 028 (§5, linhas 547-548) — "importar_repasse_auto_avaliar ficou sem GRANT
-- explícito porque mexer agora mudaria o comportamento" — é retrocompatibilidade e NÃO se
-- aplica a função nova. Função nova nasce com os grants certos.
-- ─────────────────────────────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.sincronizar_repasse_arquivo_auto_avaliar_preview(jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.sincronizar_repasse_arquivo_auto_avaliar_preview(jsonb) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.sincronizar_repasse_arquivo_auto_avaliar(jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.sincronizar_repasse_arquivo_auto_avaliar(jsonb) TO authenticated, service_role;

-- Helpers puros (não tocam tabela nenhuma); ainda assim, sem anon.
REVOKE EXECUTE ON FUNCTION public.aa_arq_valor_obs(jsonb, text)      FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.aa_arq_valor_obs(jsonb, text)      TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.aa_arq_qtde_obs(jsonb, text)       FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.aa_arq_qtde_obs(jsonb, text)       TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.aa_arq_zero_explicito(jsonb, text) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.aa_arq_zero_explicito(jsonb, text) TO authenticated, service_role;


-- =====================================================================================
-- VERIFICAÇÃO PÓS-MIGRATION (§11 do desenho — rodar manualmente depois de aplicar)
-- =====================================================================================
-- 1) Colunas criadas com o tipo certo (esperado: numeric 12/2 YES | integer YES):
--      SELECT column_name, data_type, numeric_precision, numeric_scale, is_nullable
--        FROM information_schema.columns
--       WHERE table_name = 'repasses'
--         AND column_name IN ('valor_maior_oferta','qtde_anuncios');
--
-- 2) anon NÃO executa (esperado: false, false):
--      SELECT has_function_privilege('anon','public.sincronizar_repasse_arquivo_auto_avaliar_preview(jsonb)','EXECUTE'),
--             has_function_privilege('anon','public.sincronizar_repasse_arquivo_auto_avaliar(jsonb)','EXECUTE');
--
-- 3) authenticated executa (esperado: true, true):
--      SELECT has_function_privilege('authenticated','public.sincronizar_repasse_arquivo_auto_avaliar_preview(jsonb)','EXECUTE'),
--             has_function_privilege('authenticated','public.sincronizar_repasse_arquivo_auto_avaliar(jsonb)','EXECUTE');
--
-- 4) Nenhuma é SECURITY DEFINER; preview é STABLE e aplicação é VOLATILE
--    (esperado: f/s e f/v):
--      SELECT proname, prosecdef, provolatile
--        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public' AND proname LIKE 'sincronizar_repasse_arquivo_auto_avaliar%';
--
-- 5) O corpo NÃO menciona o que não pode mencionar (esperado: 0 linhas):
--      SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname='public' AND proname LIKE 'sincronizar_repasse_arquivo_auto_avaliar%'
--         AND (pg_get_functiondef(p.oid) ~* '(insert\s+into\s+repasses|repasse_gastos|valor_aquisicao|current_date)');
--
-- 5b) A RPC do fluxo de TEXTO segue intacta (esperado: true):
--      SELECT pg_get_functiondef(p.oid) ~* 'DELETE\s+FROM\s+repasse_gastos' AS delete_ainda_existe
--        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname='public' AND proname = 'importar_repasse_auto_avaliar';
--
-- 6) Pré-condição do efeito colateral do trigger da 027 (esperado: 0). Nosso UPDATE não
--    toca `status`, mas DISPARA trg_repasses_preenche_data_subido se a linha for 'subido'
--    com data_subido NULL — carimbaria hoje num carro que subiu meses atrás. Documentado,
--    não mitigado: mitigar exigiria mexer na 027.
--      SELECT count(*) FROM repasses WHERE status = 'subido' AND data_subido IS NULL;
--
-- 7) Smoke idempotente (2x o MESMO payload, dentro de transação com ROLLBACK):
--      BEGIN;
--        SELECT sincronizar_repasse_arquivo_auto_avaliar('{...payload real...}'::jsonb) -> 'resumo';
--        -- 2ª execução: linhas_gravadas = 0 e com_alteracao = 0
--        SELECT sincronizar_repasse_arquivo_auto_avaliar('{...mesmo payload...}'::jsonb) -> 'resumo';
--      ROLLBACK;
--
-- 8) Plano de execução do match, com o arquivo real:
--      EXPLAIN (ANALYZE, BUFFERS)
--        SELECT sincronizar_repasse_arquivo_auto_avaliar_preview('{...payload real...}'::jsonb);
-- =====================================================================================
-- FIM da migration 029
-- =====================================================================================
