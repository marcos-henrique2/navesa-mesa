-- Navesa Mesa — Migration 045: reconciliação automática de status no sync por ARQUIVO
-- =====================================================================================
-- CAUSA RAIZ (investigação de 05/10/2026, a pedido do Marcos): `repasses` acumulou 194
-- linhas canal='auto_avaliar' quando o Auto Avaliar só tem ~97-99 carros realmente no ar
-- (produção: 97 'subido' + 80 'marcado' + 17 'vendido' = 194). Das 3 formas de trazer o
-- Auto Avaliar pro sistema, só UMA reconcilia status sozinha:
--   • TEXTO colado        (importar_repasse_auto_avaliar,              migration 025→028)
--     — reconcilia: repasse 'subido' cuja placa sumiu da colagem vira 'vendido' (bate com
--     `vendas`) ou 'marcado' (não bate). Decisão tomada em TS (montarPreviewPuro, em
--     src/lib/repasses/import-auto-avaliar.ts) e enviada como snapshot já pronto — a RPC
--     só aplica.
--   • ARQUIVO .xls         (sincronizar_repasse_arquivo_auto_avaliar,  migration 029)
--     — É O FLUXO MAIS USADO NO DIA A DIA E NÃO RECONCILIA NADA. Só atualiza valores de
--     quem já existe. Placa sumida só gera uma SUGESTÃO passiva no painel
--     `SumidosDoArquivoPainel.tsx` — se o Marcos não agir carro a carro, o repasse fica
--     'subido' pra sempre. É esta lacuna que esta migration fecha.
--   • VENDAS .xlsx         (importar_vendas_concluidas_auto_avaliar,   migration 036)
--     — fora do escopo desta migration; já reconcilia (marca vendido) o que casa.
--
-- ENTREGA: estende as DUAS funções da 029 (CREATE OR REPLACE, mesma assinatura) com um
-- bloco de reconciliação OPT-IN, gated por 2 flags novas no payload — nenhuma delas
-- existia antes, então o contrato antigo (sem essas chaves) continua funcionando
-- IDÊNTICO a hoje. Nenhuma coluna nova, nenhuma constraint alterada. ADITIVO PURO.
--
--
-- ╔═══════════════════════════════════════════════════════════════════════════════════╗
-- ║  DECISÃO DE ARQUITETURA — FUNÇÃO COMPARTILHADA ENTRE AS DUAS RPCs, OU DUPLICADA?    ║
-- ║  ─────────────────────────────────────────────────────────────────────────────    ║
-- ║  DUPLICADA. A lógica de reconciliação é reescrita aqui dentro da 029, em vez de     ║
-- ║  extrair um `public.aa_reconciliar_subidos(...)` chamado também pela              ║
-- ║  `importar_repasse_auto_avaliar` (025→028). Três motivos, todos no padrão real do  ║
-- ║  projeto, não inventados agora:                                                     ║
-- ║                                                                                      ║
-- ║  1. PRECEDENTE EXPLÍCITO CONTRA COMPARTILHAR ENTRE AS FONTES DO AUTO AVALIAR. A      ║
-- ║     036 (linhas 109-124) tinha EXATAMENTE a opção de reaproveitar os helpers         ║
-- ║     `aa_arq_*` da 029 nos helpers novos de "Vendas Concluídas" — são normalizadores  ║
-- ║     quase idênticos — e REJEITOU, com o argumento: "Compartilhar assinatura criaria  ║
-- ║     um acoplamento em que mexer numa fonte muda a outra em silêncio." Criar agora    ║
-- ║     uma função compartilhada entre TEXTO e ARQUIVO reabriria exatamente o risco que  ║
-- ║     aquela decisão evitou — e entre estas duas fontes o acoplamento seria PIOR: são  ║
-- ║     as DUAS RPCs que escrevem `repasses.status`, cada uma com histórico de bugs      ║
-- ║     próprio (a troca de `current_date` por `hoje_brasilia()` foi só na 028; o        ║
-- ║     invariante da 029 sobre `valor_maior_oferta`/`qtde_anuncios` é só da 029).       ║
-- ║                                                                                      ║
-- ║  2. CONTRATOS DE ENTRADA INCOMPATÍVEIS, NÃO SÓ SINTAXE DIFERENTE. A 028 recebe um    ║
-- ║     SNAPSHOT JÁ DECIDIDO pelo cliente (`reconciliacao: [{repasse_id, novo_status,    ║
-- ║     data_vendido, valor_vendido}]` — a decisão vendido×marcado foi tomada em TS,      ║
-- ║     contra `vendas` carregada no browser). A 029 não decide nada no cliente: ela      ║
-- ║     recebe `linhas` CRUAS e decide tudo dentro do SQL (é por isso que ela tem uma     ║
-- ║     RPC de PREVIEW que a de aplicar RECALCULA chamando de novo — a 028 não tem        ║
-- ║     preview nenhum). Uma função compartilhada teria que servir os dois modelos ao     ║
-- ║     mesmo tempo (decisão no cliente E decisão no banco) — a única forma de fazer      ║
-- ║     isso sem gambiarra seria reescrever a 028 pra also ter preview/aplicar, o que     ║
-- ║     está FORA do escopo desta story e arrisca uma RPC em produção sem necessidade.    ║
-- ║                                                                                      ║
-- ║  3. A TRAVA DE RISCO (piso/proporção) PRECISA SER COMPUTADA DIFERENTE. No fluxo de    ║
-- ║     TEXTO ela mora inteiramente em TS (`avaliarRiscoReconciliacao`,                  ║
-- ║     RECON_PISO_ABSOLUTO/RECON_PROPORCAO_LIMITE em import-auto-avaliar.ts) e só        ║
-- ║     decide se a TELA mostra um aviso ANTES de montar o payload — a RPC da 028 nunca   ║
-- ║     viu essa trava, aplica cegamente o que o array `reconciliacao` trouxer. Aqui a    ║
-- ║     trava TEM que morar no SQL, porque é o SQL que decide quem reconcilia (não existe  ║
-- ║     TS decidindo antes). Replicar os MESMOS NÚMEROS (piso 5, proporção 30%) é o que    ║
-- ║     a story pede — replicar a MESMA FUNÇÃO não, porque o lugar onde a trava mora é     ║
-- ║     estruturalmente diferente nas duas fontes.                                         ║
-- ║                                                                                      ║
-- ║  O que REALMENTE se compartilha entre as duas fontes é só o NÚMERO da trava (5 e      ║
-- ║  30%) e a EXPRESSÃO de normalização de placa — e essa já é compartilhada, pela via    ║
-- ║  certa: é a MESMA expressão regexp (`regexp_replace(upper(x),'[^A-Z0-9]','','g')`)    ║
-- ║  usada no índice funcional `idx_repasses_placa_norm` (025), em `normalizarPlaca()`    ║
-- ║  (src/lib/utils/placa.ts) e em todo match desta própria migration 029 — não uma       ║
-- ║  função PL/pgSQL chamada de dois lugares, mas uma CONVENÇÃO DE EXPRESSÃO repetida de  ║
-- ║  propósito, porque é curta, estável desde a 025 e precisa casar byte-a-byte com o     ║
-- ║  índice. Extrair isso numa função custaria uma chamada de função por linha num        ║
-- ║  JOIN que hoje usa índice — contra a prioridade #1 de Dara (índice antes da query      ║
-- ║  lenta).                                                                                ║
-- ╚═══════════════════════════════════════════════════════════════════════════════════╝
--
--
-- ╔═══════════════════════════════════════════════════════════════════════════════════╗
-- ║  ARMADILHA QUE ESTA MIGRATION TINHA QUE FECHAR ANTES DE RECONCILIAR SOZINHA         ║
-- ║  ─────────────────────────────────────────────────────────────────────────────    ║
-- ║  `src/lib/repasses/presenca-arquivo-auto-avaliar.ts` (Fatia 3b, painel              ║
-- ║  `SumidosDoArquivoPainel`) já resolveu esta exata pergunta e documenta a armadilha   ║
-- ║  no próprio cabeçalho: "O sync sincroniza SÓ a Matriz, então o cliente filtra as     ║
-- ║  outras lojas antes de montar o payload. Mas 'sumiu do anúncio' NÃO é o complemento   ║
-- ║  das linhas da Matriz: um carro pode ter sido transferido de loja e continuar        ║
-- ║  anunciado." O `p_payload.linhas` que chega em `sincronizar_repasse_arquivo_*` HOJE   ║
-- ║  já vem filtrado pra uma loja só — é assim desde a 029. Se esta migration comparasse  ║
-- ║  o universo 'subido' só contra `linhas`, reintroduziria exatamente o bug que a 3b      ║
-- ║  existe pra evitar: acusar de "vendido/saiu" um carro que só mudou de loja.           ║
-- ║                                                                                      ║
-- ║  POR ISSO o contrato de entrada ganha `placas_outras_lojas` (array de texto,         ║
-- ║  qualquer formato de placa — normalizado aqui dentro, nunca confiado do cliente) —    ║
-- ║  o equivalente SQL de `placasVistasNoArquivo(linhasLojaAlvo, linhasOutraLoja)`. O     ║
-- ║  universo de "ainda está anunciado" é `linhas` ∪ `placas_outras_lojas`, igual à 3b.    ║
-- ╚═══════════════════════════════════════════════════════════════════════════════════╝
--
--
-- ╔═══════════════════════════════════════════════════════════════════════════════════╗
-- ║  POR QUE A RECONCILIAÇÃO É OPT-IN (`reconciliar_sumidos: true`), NÃO AUTOMÁTICA     ║
-- ║  NO PRIMEIRO DEPLOY DESTA MIGRATION                                                 ║
-- ║  ─────────────────────────────────────────────────────────────────────────────    ║
-- ║  O deploy de uma MIGRATION e o deploy do FRONT são dois eventos diferentes. No       ║
-- ║  instante em que esta migration roda em produção, o front em produção ainda é o      ║
-- ║  de HOJE — que nunca manda `placas_outras_lojas` nem `reconciliar_sumidos`. Se a      ║
-- ║  reconciliação fosse incondicional, toda chamada antiga ao sync por arquivo           ║
-- ║  passaria a reconciliar usando um universo de "ainda anunciado" INCOMPLETO (só a      ║
-- ║  loja alvo) — reabrindo a armadilha do item acima em todo upload normal, não só nos    ║
-- ║  grandes. `reconciliar_sumidos` ausente/false preserva o comportamento ATUAL           ║
-- ║  byte-a-byte (nem computa o bloco novo). ⚠️ HANDOFF PRA @dex-dev: só ligar esta flag   ║
-- ║  no cliente DEPOIS de montar `placas_outras_lojas` a partir do MESMO parser que já     ║
-- ║  alimenta `placasVistasNoArquivo` hoje — reaproveitar o dado, não os refazer.          ║
-- ╚═══════════════════════════════════════════════════════════════════════════════════╝
--
--
-- CONTRATO NOVO DE ENTRADA (chaves adicionais, todas opcionais — payload sem elas se
-- comporta EXATAMENTE como antes da 045):
--   p_payload.reconciliar_sumidos        boolean  -- liga o bloco desta migration.
--   p_payload.placas_outras_lojas        text[]   -- qualquer formato; normalizado aqui.
--   p_payload.confirmar_reconciliacao_arriscada  boolean
--     -- só lido quando o risco (ver trava abaixo) exige confirmação. Sem ele, ou com
--     -- false, a reconciliação arriscada NÃO é aplicada nesta chamada — devolve os
--     -- candidatos e o risco pra UI decidir (não é flag de "dry run": é a MESMA UX de
--     -- confirmação em 2 passos que o fluxo de texto já tem, só que aqui o 2º passo é
--     -- "rode de novo com este campo true" em vez de "mande o array já filtrado").
--
-- CONTRATO NOVO DE SAÍDA (chaves adicionais, mesmo payload antigo intacto):
--   a_reconciliar               jsonb[]  -- candidatos: {repasse_id, placa, modelo,
--                                            novo_status, data_vendido, valor_vendido}.
--   risco_reconciliacao         jsonb    -- {total, universo, proporcao, exige_confirmacao}
--                                            — MESMO formato de `RiscoReconciliacao` em
--                                            import-auto-avaliar.ts, pra UI reaproveitar.
--   resumo.reconciliar                   -- = a_reconciliar.length (candidatos, não grava).
--   resumo.reconciliados_vendidos        -- 0 no preview; ROW_COUNT real no aplicado.
--   resumo.reconciliados_marcados        -- idem.
--   resumo.reconciliacao_pendente_confirmacao  -- true quando o risco travou e NADA foi
--                                                  reconciliado NESTA chamada.
--
-- TRAVA DE RISCO (mesmos números do fluxo de texto, RECON_PISO_ABSOLUTO=5 e
--   RECON_PROPORCAO_LIMITE=0.3, de src/lib/repasses/import-auto-avaliar.ts):
--   total_candidatos >= 5 E total_candidatos / universo_subido > 0.3
--   → `exige_confirmacao = true` → a função de APLICAR só escreve a reconciliação se
--   `confirmar_reconciliacao_arriscada = true` vier no MESMO payload. Sem isso, com ou
--   sem risco alto, as outras 3 partes do sync (atualizar valor / criar nada / reportar)
--   continuam acontecendo normalmente — só a reconciliação fica pendente.
--
-- GARANTIAS ESTRUTURAIS HERDADAS DA 029 (continuam valendo, ver cabeçalho original):
--   • NUNCA cria repasse — limitação estrutural real, não corrigida aqui: o relatório
--     "Veículos em Oferta" só tem PLACA, e `repasses.chassi` é NOT NULL (migration 008).
--     Repasse 100% novo continua só nascendo pelo fluxo de TEXTO (025→028) ou pelo de
--     VENDAS (036). Documentado, não resolvido — fora do escopo desta story.
--   • NUNCA toca `repasse_gastos`, `valor_aquisicao`, nem os 8 campos de valor que já
--     eram a whitelist da 029 — a reconciliação só escreve `status`, `data_vendido`,
--     `valor_vendido`, `atualizado_em`, com a MESMA guarda de escopo da 028:
--     `canal = 'auto_avaliar' AND status = 'subido'` no WHERE do UPDATE.
--   • SECURITY INVOKER nas duas funções, sem SQL dinâmico, sem EXECUTE/format(). Grants
--     (REVOKE anon/public + GRANT authenticated/service_role) já estão certos desde a
--     029 e CREATE OR REPLACE FUNCTION não os altera — não repetidos aqui de propósito,
--     pra não sugerir que mudaram.
--
-- DATA DE CALENDÁRIO NOVA NESTA MIGRATION: `data_vendido` passa a poder ser escrita por
--   esta RPC quando reconcilia pra 'vendido' — vem OBSERVADA de `vendas.data_venda`
--   (fato do NBS), nunca do relógio. Isso ATUALIZA o invariante do cabeçalho original da
--   029 ("nenhuma data de calendário é gravada aqui"), que valia só até esta migration.
--
-- IDEMPOTENTE: CREATE OR REPLACE FUNCTION. A reconciliação em si também é idempotente —
--   depois de reconciliar, o repasse sai de `status='subido'`, então a MESMA chamada
--   (ou o mesmo arquivo reimportado) não o encontra mais em `candidatos` na 2ª rodada.
-- =====================================================================================


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 1. RPC DE PREVIEW — mesma assinatura da 029, corpo estendido (STABLE preservado)
-- =====================================================================================
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
  v_lim        integer;
  v_truncado   boolean;
  v_gerado_em  text;

  v_com        jsonb;  v_n_com integer;
  v_sem        jsonb;  v_n_sem integer;
  v_nao        jsonb;  v_n_nao integer;
  v_ign        jsonb;  v_n_ign integer;
  v_campos     integer;

  -- ── Novo nesta migration: reconciliação de status (opt-in) ──────────────────────
  v_reconciliar_ativo boolean;
  v_rec        jsonb;  v_n_rec integer;
  v_n_rec_vendido  integer;
  v_n_rec_marcado  integer;
  v_universo_subido integer;
  v_proporcao  numeric;
  v_exige_confirmacao boolean;
  v_risco      jsonb;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'p_payload deve ser um objeto JSONB';
  END IF;
  IF jsonb_typeof(p_payload -> 'linhas') <> 'array' THEN
    RAISE EXCEPTION 'p_payload.linhas deve ser um array JSONB';
  END IF;

  v_total := jsonb_array_length(p_payload -> 'linhas');

  IF v_total > 2000 THEN
    RAISE EXCEPTION 'payload com % linhas excede o teto de 2000', v_total;
  END IF;

  v_truncado := v_total > 500;
  v_lim      := CASE WHEN v_truncado THEN 200 ELSE 2000 END;

  v_gerado_em := to_char(now() AT TIME ZONE 'America/Sao_Paulo',
                         'YYYY-MM-DD"T"HH24:MI:SS') || '-03:00';

  -- ═══════════════════════════════════════════════════════════════════════════════
  -- BLOCO ORIGINAL DA 029 — intacto, byte-a-byte. Ver aquela migration pra comentários
  -- linha a linha; aqui só o necessário pra não perder contexto na leitura.
  -- ═══════════════════════════════════════════════════════════════════════════════
  WITH linhas AS (
    SELECT
      t.ord::integer AS ord,
      CASE WHEN jsonb_typeof(t.item -> 'linha') = 'number'
           THEN trunc((t.item ->> 'linha')::numeric)::integer
           ELSE t.ord::integer END AS linha,
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
             WHEN c.compra_zerada        THEN 'ign:valor_compra_zerado'
             WHEN c.o_compra IS NULL AND c.o_minimo  IS NULL AND c.o_compre_por IS NULL
              AND c.o_fipe   IS NULL AND c.o_web     IS NULL AND c.o_aa         IS NULL
              AND c.o_oferta IS NULL AND c.o_qtde    IS NULL
                                         THEN 'ign:nenhum_campo_observado'
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
    WHERE x.obs IS NOT NULL
  ),
  agg AS (
    SELECT ord,
           jsonb_agg(jsonb_build_object(
             'campo',  campo,
             'antes',  to_jsonb(atual),
             'depois', to_jsonb(obs),
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
    SELECT ord, linha, placa_norm, split_part(classe, ':', 2) AS motivo,
           CASE WHEN classe = 'ign:repasse_ambiguo' THEN ids END AS ids
    FROM clas WHERE classe LIKE 'ign:%'
  )
  SELECT
    COALESCE((SELECT jsonb_agg(z.j ORDER BY z.ord) FROM (
       SELECT ord, jsonb_build_object(
         'linha', linha, 'placa_norm', placa_norm, 'repasse_id', repasse_id,
         'modelo', modelo, 'status', status,
         'campos', campos,
         'campos_observados_sem_mudanca', iguais,
         'patch', patch
       ) AS j FROM com ORDER BY ord) z), '[]'::jsonb),
    (SELECT count(*)::integer FROM com),

    COALESCE((SELECT jsonb_agg(z.j ORDER BY z.ord) FROM (
       SELECT ord, jsonb_build_object(
         'linha', linha, 'placa_norm', placa_norm, 'repasse_id', repasse_id,
         'modelo', modelo, 'campos_observados', n_observados
       ) AS j FROM sem ORDER BY ord LIMIT v_lim) z), '[]'::jsonb),
    (SELECT count(*)::integer FROM sem),

    COALESCE((SELECT jsonb_agg(z.j ORDER BY z.ord) FROM (
       SELECT ord, jsonb_strip_nulls(jsonb_build_object(
         'linha', linha, 'placa_norm', placa_norm, 'motivo', motivo,
         'status_atual', status_atual
       )) AS j FROM nao ORDER BY ord LIMIT v_lim) z), '[]'::jsonb),
    (SELECT count(*)::integer FROM nao),

    COALESCE((SELECT jsonb_agg(z.j ORDER BY z.ord) FROM (
       SELECT ord, jsonb_strip_nulls(jsonb_build_object(
         'linha', linha, 'placa_norm', placa_norm, 'motivo', motivo,
         'repasse_ids', ids
       )) AS j FROM ign ORDER BY ord LIMIT v_lim) z), '[]'::jsonb),
    (SELECT count(*)::integer FROM ign),

    COALESCE((SELECT sum(n_mudou)::integer FROM agg), 0)
  INTO v_com, v_n_com, v_sem, v_n_sem, v_nao, v_n_nao, v_ign, v_n_ign, v_campos;

  -- ═══════════════════════════════════════════════════════════════════════════════
  -- BLOCO NOVO (migration 045) — reconciliação de status, opt-in.
  -- ═══════════════════════════════════════════════════════════════════════════════
  -- COALESCE é obrigatório aqui: chave ausente faz `jsonb = 'true'::jsonb` avaliar
  -- NULL (não false). Sem o COALESCE, `IF NOT v_reconciliar_ativo` com NULL cai no
  -- ramo ERRADO (plpgsql trata IF NULL como falso) — o payload de hoje, que nunca
  -- manda esta chave, ligaria o bloco de reconciliação por engano.
  v_reconciliar_ativo := COALESCE((p_payload -> 'reconciliar_sumidos') = 'true'::jsonb, false);

  IF NOT v_reconciliar_ativo THEN
    v_rec := '[]'::jsonb;
    v_n_rec := 0; v_n_rec_vendido := 0; v_n_rec_marcado := 0;
    v_universo_subido := 0; v_proporcao := 0; v_exige_confirmacao := false;
  ELSE
    WITH arquivo AS (
      -- Universo de "ainda anunciado": TODA placa das linhas enviadas (qualquer
      -- classificação — match, ignorada, não-encontrada; sumir do SYNC não é sumir
      -- do ANÚNCIO) MAIS as placas de QUALQUER OUTRA LOJA do mesmo arquivo, que o
      -- cliente manda em paralelo (ver caixa "ARMADILHA" acima). Sem o segundo
      -- conjunto, carro transferido de loja seria acusado de vendido/saiu.
      SELECT NULLIF(regexp_replace(upper(COALESCE(t.item ->> 'placa', '')),
                                    '[^A-Z0-9]', '', 'g'), '') AS placa_norm
      FROM jsonb_array_elements(p_payload -> 'linhas') AS t(item)
      UNION
      SELECT NULLIF(regexp_replace(upper(COALESCE(x.v, '')), '[^A-Z0-9]', '', 'g'), '')
      FROM jsonb_array_elements_text(
             CASE WHEN jsonb_typeof(p_payload -> 'placas_outras_lojas') = 'array'
                  THEN p_payload -> 'placas_outras_lojas' ELSE '[]'::jsonb END
           ) AS x(v)
    ),
    arquivo_placas AS (
      SELECT DISTINCT placa_norm FROM arquivo WHERE placa_norm IS NOT NULL
    ),
    subido AS (
      -- Universo completo canal=auto_avaliar/status=subido — é o DENOMINADOR da
      -- trava de proporção (mesma semântica de `subido_total` em
      -- import-auto-avaliar.ts: inclui quem vai ficar E quem vai reconciliar).
      SELECT r.id, r.placa, r.modelo,
             regexp_replace(upper(r.placa), '[^A-Z0-9]', '', 'g') AS placa_norm
      FROM repasses r
      WHERE r.canal = 'auto_avaliar' AND r.status = 'subido'
    ),
    candidatos AS (
      -- Normaliza na leitura (não depende da migration 044 já ter rodado): bate
      -- byte-a-byte com `arquivo_placas` mesmo que `r.placa` ainda tenha separador.
      SELECT s.* FROM subido s
      WHERE NOT EXISTS (SELECT 1 FROM arquivo_placas ap WHERE ap.placa_norm = s.placa_norm)
    ),
    venda_norm AS (
      SELECT regexp_replace(upper(v.placa), '[^A-Z0-9]', '', 'g') AS placa_norm,
             v.data_venda, v.valor_venda
      FROM vendas v
      WHERE v.placa IS NOT NULL
    ),
    venda_melhor AS (
      -- Carro pode ter mais de uma linha em `vendas` (raro); fica a venda mais
      -- recente — mesma régua de "fato mais atual vence" da 036.
      SELECT DISTINCT ON (placa_norm) placa_norm,
             data_venda::date AS data_vendido, valor_venda AS valor_vendido
      FROM venda_norm
      WHERE placa_norm <> ''
      ORDER BY placa_norm, data_venda DESC NULLS LAST
    ),
    recon AS (
      SELECT c.id AS repasse_id, c.placa, c.modelo,
             CASE WHEN vm.placa_norm IS NOT NULL THEN 'vendido' ELSE 'marcado' END AS novo_status,
             vm.data_vendido, vm.valor_vendido
      FROM candidatos c
      LEFT JOIN venda_melhor vm ON vm.placa_norm = c.placa_norm
    )
    SELECT
      COALESCE(jsonb_agg(jsonb_build_object(
        'repasse_id', repasse_id, 'placa', placa, 'modelo', modelo,
        'novo_status', novo_status, 'data_vendido', data_vendido, 'valor_vendido', valor_vendido
      ) ORDER BY repasse_id), '[]'::jsonb),
      count(*)::integer,
      count(*) FILTER (WHERE novo_status = 'vendido')::integer,
      count(*) FILTER (WHERE novo_status = 'marcado')::integer,
      (SELECT count(*)::integer FROM subido)
    INTO v_rec, v_n_rec, v_n_rec_vendido, v_n_rec_marcado, v_universo_subido
    FROM recon;

    v_proporcao := CASE WHEN v_universo_subido > 0
                        THEN round(v_n_rec::numeric / v_universo_subido, 4)
                        ELSE 0 END;
    -- Trava: MESMOS números do fluxo de texto (RECON_PISO_ABSOLUTO=5,
    -- RECON_PROPORCAO_LIMITE=0.3 em import-auto-avaliar.ts).
    v_exige_confirmacao := v_n_rec >= 5 AND v_proporcao > 0.3;
  END IF;

  v_risco := jsonb_build_object(
    'total', v_n_rec, 'universo', v_universo_subido,
    'proporcao', v_proporcao, 'exige_confirmacao', v_exige_confirmacao
  );

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
      'linhas_gravadas',   0,
      -- NOVO (045): candidato é a priori (não depende de ter sido gravado);
      -- os dois de baixo seguem a convenção existente — 0 no preview, contagem
      -- real só no modo 'aplicado'.
      'reconciliar',               v_n_rec,
      'reconciliados_vendidos',    0,
      'reconciliados_marcados',    0,
      'reconciliacao_pendente_confirmacao', v_exige_confirmacao
    ),
    'com_alteracao',   v_com,
    'sem_alteracao',   v_sem,
    'nao_encontradas', v_nao,
    'ignoradas',       v_ign,
    'a_reconciliar',         v_rec,
    'risco_reconciliacao',   v_risco
  );
END;
$fn$;

COMMENT ON FUNCTION public.sincronizar_repasse_arquivo_auto_avaliar_preview(jsonb) IS
  'Fatia 3a (029) + reconciliação automática opt-in (045): calcula o diff de VALORES '
  'do arquivo relatorio_VeiculosEmOferta.xls (inalterado) e, quando '
  'p_payload.reconciliar_sumidos=true, também lista em a_reconciliar os repasses '
  'canal=auto_avaliar/status=subido cuja placa não aparece em p_payload.linhas nem em '
  'p_payload.placas_outras_lojas — vendido (cruza com vendas) ou marcado (não cruza). '
  'risco_reconciliacao replica a trava do fluxo de texto (piso 5, proporção 30%) — '
  'ver RECON_PISO_ABSOLUTO/RECON_PROPORCAO_LIMITE em import-auto-avaliar.ts. '
  'READ-ONLY garantido pela engine (STABLE). SECURITY INVOKER. Migration 045.';


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 2. RPC DE APLICAÇÃO — mesma assinatura da 029, corpo estendido (VOLATILE preservado)
-- =====================================================================================
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

  -- ── Novo nesta migration: reconciliação de status (opt-in) ──────────────────────
  v_reconciliar_ativo boolean;
  v_exige      boolean;
  v_confirmado boolean;
  v_rec_vend   integer := 0;
  v_rec_marc   integer := 0;
  v_pendente   boolean;
BEGIN
  v_preview := public.sincronizar_repasse_arquivo_auto_avaliar_preview(p_payload);

  -- ═══════════════════════════════════════════════════════════════════════════════
  -- BLOCO ORIGINAL DA 029 — intacto, byte-a-byte (sync de valores).
  -- ═══════════════════════════════════════════════════════════════════════════════
  WITH alvo AS (
    SELECT (e ->> 'repasse_id')::bigint AS repasse_id,
           e -> 'patch'                 AS patch
    FROM jsonb_array_elements(v_preview -> 'com_alteracao') AS e
  ),
  o AS (
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
  FROM o
  WHERE r.id = o.repasse_id
    AND r.status IN ('subido', 'marcado')
    AND (
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

  -- ═══════════════════════════════════════════════════════════════════════════════
  -- BLOCO NOVO (migration 045) — reconciliação de status, opt-in e travada por risco.
  -- ═══════════════════════════════════════════════════════════════════════════════
  -- COALESCE nos 3: nenhuma destas chaves existe no payload de hoje, e chave ausente
  -- em jsonb vira SQL NULL na comparação — NULL se propaga por AND/OR e por
  -- to_jsonb() até o jsonb_set final, que devolveria a RPC INTEIRA como NULL em vez
  -- do payload normal. Ver nota equivalente no preview.
  v_reconciliar_ativo := COALESCE((p_payload -> 'reconciliar_sumidos') = 'true'::jsonb, false);
  v_exige      := COALESCE((v_preview -> 'risco_reconciliacao' ->> 'exige_confirmacao')::boolean, false);
  v_confirmado := COALESCE((p_payload -> 'confirmar_reconciliacao_arriscada') = 'true'::jsonb, false);

  IF v_reconciliar_ativo AND (NOT v_exige OR v_confirmado) THEN
    WITH alvo AS (
      SELECT (e ->> 'repasse_id')::bigint          AS repasse_id,
             (e ->> 'novo_status')                  AS novo_status,
             NULLIF(e ->> 'data_vendido', '')::date AS data_vendido,
             NULLIF(e ->> 'valor_vendido', '')::numeric AS valor_vendido
      FROM jsonb_array_elements(v_preview -> 'a_reconciliar') AS e
    ),
    atualizados AS (
      -- Guarda de escopo IDÊNTICA à 028: canal/status no WHERE, nunca no payload.
      -- Idempotente: na 2ª chamada com o mesmo arquivo, estas linhas já não são mais
      -- 'subido' (preview nem as devolve em `candidatos`) — ROW_COUNT fica 0.
      UPDATE repasses r SET
        status        = a.novo_status,
        data_vendido  = CASE WHEN a.novo_status = 'vendido' THEN a.data_vendido  ELSE r.data_vendido  END,
        valor_vendido = CASE WHEN a.novo_status = 'vendido' THEN a.valor_vendido ELSE r.valor_vendido END,
        atualizado_em = now()
      FROM alvo a
      WHERE r.id = a.repasse_id
        AND r.canal  = 'auto_avaliar'
        AND r.status = 'subido'
      RETURNING a.novo_status
    )
    SELECT count(*) FILTER (WHERE novo_status = 'vendido')::integer,
           count(*) FILTER (WHERE novo_status = 'marcado')::integer
    INTO v_rec_vend, v_rec_marc
    FROM atualizados;

    v_pendente := false;
  ELSE
    -- Ou a reconciliação não foi pedida (flag ausente), ou foi pedida mas o risco
    -- travou e o cliente não confirmou: zero escrita aqui. `a_reconciliar` e
    -- `risco_reconciliacao` já vêm no retorno (herdados de v_preview) pra UI decidir.
    v_pendente := v_reconciliar_ativo AND v_exige AND NOT v_confirmado;
  END IF;

  RETURN jsonb_set(
           jsonb_set(
             jsonb_set(
               jsonb_set(
                 jsonb_set(v_preview, '{modo}', '"aplicado"'::jsonb),
                 '{resumo,linhas_gravadas}', to_jsonb(v_gravadas)),
               '{resumo,reconciliados_vendidos}', to_jsonb(v_rec_vend)),
             '{resumo,reconciliados_marcados}', to_jsonb(v_rec_marc)),
           '{resumo,reconciliacao_pendente_confirmacao}', to_jsonb(v_pendente)
         );
END;
$fn$;

COMMENT ON FUNCTION public.sincronizar_repasse_arquivo_auto_avaliar(jsonb) IS
  'Fatia 3a (029) + reconciliação automática opt-in (045). Sync de valores inalterado. '
  'Quando p_payload.reconciliar_sumidos=true: reconcilia (status/data_vendido/'
  'valor_vendido) os repasses canal=auto_avaliar/status=subido sumidos do arquivo+outras '
  'lojas, SALVO se o risco (>=5 carros E >30% do universo subido) exigir '
  'p_payload.confirmar_reconciliacao_arriscada=true — sem essa confirmação, zero escrita '
  'de reconciliação nesta chamada e resumo.reconciliacao_pendente_confirmacao=true. '
  'Nunca cria repasse, nunca toca repasse_gastos nem valor_aquisicao. Uma transação, '
  'idempotente. SECURITY INVOKER. Migration 045.';


-- =====================================================================================
-- VERIFICAÇÃO PÓS-MIGRATION (rodar manualmente depois de aplicar)
-- =====================================================================================
-- 1) Assinatura e volatilidade preservadas (esperado: f/s e f/v, iguais à 029):
--      SELECT proname, prosecdef, provolatile
--        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname='public' AND proname LIKE 'sincronizar_repasse_arquivo_auto_avaliar%';
--
-- 2) Payload antigo (sem reconciliar_sumidos) se comporta IDÊNTICO à 029 — resumo novo
--    some em zero/false, nada é escrito em status (esperado: 0 em todos reconciliados_*):
--      SELECT sincronizar_repasse_arquivo_auto_avaliar_preview('{"linhas":[]}'::jsonb) -> 'resumo';
--
-- 3) Trava de risco: candidatos >= 5 E proporção > 30% exige confirmação (rodar com
--    payload real; conferir resumo.reconciliacao_pendente_confirmacao = true e nenhum
--    repasse saiu de 'subido' até confirmar_reconciliacao_arriscada=true).
--
-- 4) O corpo NÃO menciona o que não pode mencionar (esperado: 0 linhas — mesma guarda
--    que a 029 já tinha pra repasse_gastos/valor_aquisicao):
--      SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname='public' AND proname LIKE 'sincronizar_repasse_arquivo_auto_avaliar%'
--         AND (pg_get_functiondef(p.oid) ~* '(repasse_gastos|valor_aquisicao)');
--
-- 5) Smoke idempotente (2x o MESMO payload com reconciliar_sumidos=true, dentro de
--    transação com ROLLBACK): a 2ª chamada devolve reconciliados_vendidos=0 e
--    reconciliados_marcados=0 (quem reconciliou na 1ª já não é mais 'subido').
--
-- 6) Nenhum repasse 'vendido' por esta RPC sem valor ou sem data (esperado: 0 — mesma
--    guarda de qualidade da 036):
--      SELECT count(*) FROM repasses
--       WHERE canal = 'auto_avaliar' AND status = 'vendido'
--         AND (valor_vendido IS NULL OR data_vendido IS NULL);
-- =====================================================================================
-- FIM da migration 045
-- =====================================================================================
