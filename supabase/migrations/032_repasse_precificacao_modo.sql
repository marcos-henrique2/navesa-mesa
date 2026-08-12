-- Navesa Mesa — Migration 032: `modo` como coluna de primeira classe no snapshot de preço
-- =====================================================================================
-- Implementa a §12.6 da ADR-003 (`docs/design/adr-003-persistencia-e-derivacao-da-sugestao-
-- de-preco.md`, emenda de 2026-08-12). Story 3.1c (dois preços em `/precificar`).
--
-- O QUE ESTA MIGRATION FAZ — três coisas, e nada além:
--   1. `repasse_precificacao_sugerida.modo` TEXT NOT NULL, domínio fechado em DOIS valores.
--   2. Um CHECK de defesa em profundidade: a BASE do modo tem que ser > 0 (§12.2, I0).
--   3. Corrige o COMMENT de `bateu_piso`, que a emenda tornou falso (§12.7).
--
-- POR QUE AGORA, E NÃO DEPOIS — o argumento é de janela, não de conveniência (§12.6)
--   A aba `/precificar` ganha um segundo modo com BASE DIFERENTE:
--       base(recuperar_tudo) = custo_real
--       base(girar_rapido)   = valor_compra_repasse
--
--   SOB D3 (decisão do Marcos de 2026-08-12, story 3.1c v2): a régua é ÚNICA —
--   `REGUA_MINIMO_PCT` = 1,066 aplicada às DUAS bases. **`REGUA_GIRAR_PCT` não existe.**
--   Consequência que importa PRA ESTA MIGRATION, e que a torna mais necessária, não menos:
--   `parametros_regua` fica BYTE A BYTE IDÊNTICO nos dois modos. A opção 3 da §12.6 (derivar
--   o modo do conteúdo da linha) já era inferência frágil com duas constantes; sob D3 ela é
--   **impossível**. Esta coluna deixa de ser a melhor fonte do modo e passa a ser a ÚNICA.
--   Sem discriminador, a recalibração agrega DUAS POPULAÇÕES num número só — e a
--   recalibração é a única razão de a 030 existir (ADR-003 §2.3). A tabela não fica
--   "menos útil": ela perde a função.
--
--   Verificado no projeto `mesa` (gjyzcyamwdldnriqydua) em 2026-08-12, antes de escrever:
--   a 030 está aplicada (`20260812122106`) e a tabela tem ZERO LINHAS. Em tabela vazia,
--   `ADD COLUMN ... NOT NULL` SEM `DEFAULT` é instantâneo e dispensa backfill — não há
--   passado pra inventar. É a ÚLTIMA JANELA em que a coluna sai de graça: na primeira
--   linha gravada, o `NOT NULL` passaria a exigir ou um `DEFAULT` que CHUTA o modo de uma
--   linha histórica, ou uma coluna NULLABLE. Discriminador de população nullable é o
--   defeito que destrói a tabela — e é dano da mesma classe irrecuperável (§2.3) que
--   motivou a tabela existir. Ver §1 abaixo: a guarda de tabela vazia é explícita.
--
-- O QUE ESTA MIGRATION **NÃO** FAZ — todas decisões da §12.6, nenhuma é esquecimento:
--   ❌ NÃO reserva um terceiro valor no CHECK. Ao contrário de `confianca.media`
--      (030:99-101, §11 desvio 4), um terceiro modo mudaria a BASE DO PREÇO — não é o
--      mesmo eixo. Um CHECK que já o aceita convida a gravar linhas de um modo que o motor
--      não implementa. Volta como DECISÃO (gatilho T6, §12.11), não como slot vago.
--   ❌ NÃO tem `DEFAULT`. O ponto todo é que o modo seja sempre explícito.
--   ❌ NÃO cria índice. Vale o mesmo argumento da 030 §3: dezenas de linhas por ano, seq
--      scan de qualquer jeito. Índice se decide com EXPLAIN ANALYZE sobre query real.
--   ❌ NÃO cria CHECK cruzado da invariante de ordenação
--      (`modo='recuperar_tudo' ⇒ minimo_sugerido >= custo_real`). Mesmo motivo do desvio 1
--      da §11: a invariante é do motor; o Marcos PODE aplicar fora de ordem e essa é
--      exatamente a correção que a tabela existe pra capturar. Ver §3, que explica por que
--      o CHECK que ENTRA não é da mesma classe do que fica de fora.
--   ❌ NÃO toca `minimo_razao_efetiva` / `compre_por_razao_efetiva` nem seus COMMENTs.
--      Ver §5 — isso é decisão verificada, e o silêncio aqui é deliberado.
--   ❌ NÃO valida a convenção de sufixo em `versao_regua`. Ver §5.
--
-- NUMERAÇÃO: 032. A 031 segue RESERVADA pro `COALESCE` nos writes da 028 (ADR-003 §6, nota
--   de numeração) e continua NÃO APLICADA — confirmado na lista de migrations do projeto,
--   onde a 030 é a última. Pular a 031 não a cancela nem a antecipa; G1-b segue desarmado
--   (§12.9). Aplicar a 032 antes da 031 é seguro: elas não se tocam.
--
-- IDEMPOTENTE: guarda de existência da coluna em DO block · constraint nomeada em DO block ·
--   COMMENT ON é sempre sobrescrita. Roda 2× sem erro. Não dropa nada, não faz backfill.
-- =====================================================================================


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 1. A COLUNA `modo` — e a guarda que protege a janela
-- =====================================================================================
-- `ADD COLUMN IF NOT EXISTS` sozinho seria idempotente, mas seria idempotente CALADO: numa
-- tabela que já tivesse linhas, ele estouraria com "column contains null values" — erro
-- correto e mensagem inútil, do tipo que convida ao conserto errado (adicionar um DEFAULT
-- pra "destravar", que é precisamente o chute que esta migration existe pra impedir).
--
-- Por isso a guarda explícita abaixo. Os três estados possíveis, e o que cada um faz:
--   • coluna já existe            → NOTICE e segue (2ª execução, ou ambiente já migrado);
--   • coluna não existe, 0 linhas → ADD COLUMN NOT NULL sem DEFAULT (o caminho feliz);
--   • coluna não existe, N linhas → EXCEPTION com instrução pt-BR. Parar é a ação certa:
--     a decisão de como preencher N linhas históricas é da @aria-architect, não de quem
--     está rodando o arquivo às 23h.
-- ─────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_linhas BIGINT;
BEGIN
  -- Pré-requisito explícito: sem a 030 não há tabela. Falhar aqui com mensagem própria é
  -- melhor que um "relation does not exist" três statements adiante.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'repasse_precificacao_sugerida'
  ) THEN
    RAISE EXCEPTION '032 ABORTADA: a tabela repasse_precificacao_sugerida nao existe.'
      USING HINT = 'Aplique a migration 030_repasse_precificacao_sugerida.sql primeiro. '
                   'A 032 so adiciona a coluna `modo` a uma tabela que a 030 cria.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'repasse_precificacao_sugerida'
      AND column_name  = 'modo'
  ) THEN
    RAISE NOTICE '032: coluna `modo` já existe — nada a fazer.';
  ELSE
    SELECT count(*) INTO v_linhas FROM repasse_precificacao_sugerida;

    IF v_linhas > 0 THEN
      RAISE EXCEPTION
        '032 ABORTADA: repasse_precificacao_sugerida tem % linha(s) e a coluna `modo` ainda não existe.', v_linhas
        USING HINT =
          'A janela de adicionar `modo` NOT NULL sem backfill fechou. NAO adicione DEFAULT nem torne a '
          'coluna nullable pra destravar: DEFAULT chuta o modo de linhas historicas e nullable e o defeito '
          'que a coluna existe pra evitar (ADR-003 §12.6). Pare, e leve as N linhas pra @aria-architect '
          'decidir como classifica-las — a maioria provavelmente e recuperar_tudo, mas "provavelmente" nao '
          'e criterio pra gravar dado.';
    END IF;

    -- Tabela vazia: reescrita instantânea, sem backfill, sem DEFAULT.
    ALTER TABLE repasse_precificacao_sugerida
      ADD COLUMN modo TEXT NOT NULL;

    RAISE NOTICE '032: coluna `modo` criada (tabela vazia, sem backfill).';
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 2. DOMÍNIO FECHADO — dois valores, e só dois
-- =====================================================================================
-- Em DO block pelo mesmo motivo da 030 §2: CHECK não tem `IF NOT EXISTS` antes do PG 17.
--
-- Os literais são os MESMOS do contrato do motor (`sugerirPrecoRepasse`, story 3.1c C1/C2):
-- `recuperar_tudo` e `girar_rapido`. snake_case, sem acento — o padrão de `confianca`
-- (030:166) e das demais colunas de domínio do projeto.
-- ─────────────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rep_prec_modo_chk'
      AND conrelid = 'repasse_precificacao_sugerida'::REGCLASS
  ) THEN
    ALTER TABLE repasse_precificacao_sugerida
      ADD CONSTRAINT rep_prec_modo_chk
      CHECK (modo IN ('recuperar_tudo','girar_rapido'));
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 3. I0 — A BASE DO MODO TEM QUE SER POSITIVA (defesa em profundidade)
-- =====================================================================================
-- O BUG QUE ISTO ANTEPARA (achado pela @aria-architect, §12.4, e cujo conserto principal é
-- no motor, com o @dex-dev):
--   `decomporCusto` aceita compra = 0 — só recusa negativo. Com compra 0 e gastos > 0:
--       custo_real = 0 + gastos > 0   ⇒ passa a guarda atual (`custoReal <= 0`)
--       base(girar) = valor_compra_repasse = 0  ⇒ mínimo sugerido R$ 0,00
--   A guarda do motor tem que virar `base(modo) <= 0`. ESTE CHECK NÃO SUBSTITUI AQUELA
--   GUARDA — o motor precisa recusar ANTES, com mensagem pt-BR própria, pra que o Marcos
--   nunca veja R$ 0,00 na tela. Aqui é o último anteparo, no mesmo espírito do
--   `rep_prec_custo_decomposto_chk` (030:212).
--
-- POR QUE ESTE CHECK ENTRA E O DA ORDENAÇÃO NÃO ENTRA — a distinção é de ORIGEM DO DADO, e
-- ela é o que separa "anteparo contra bug de cálculo" de "banco recusando a correção do
-- usuário" (§11 desvio 1):
--   • A invariante de ordenação toca o par APLICADO — DECISÃO do Marcos. Bloqueá-la
--     destruiria o rótulo mais caro do conjunto (sugerido × aplicado). Fica fora. ✅
--   • I0 toca `valor_compra_repasse` / `custo_real` — CONTEXTO MEDIDO do banco, que o
--     Marcos não digita e não decide. Base zero não é escolha dele: é dado ausente. E a
--     linha resultante não seria "dado caro": seria mínimo R$ 0,00 travado — lixo com
--     aparência de dado, exatamente o que a 030:108-109 recusou pra `custo_real`.
--   • O aborto do clique aqui só acontece num caminho onde o motor JÁ deveria ter recusado.
--     Abortar é o comportamento desejado; gravar é pior.
--
-- FORMA CONDICIONAL, e não `valor_compra_repasse > 0` global — de propósito: compra 0 com
-- gastos lançados no modo `recuperar_tudo` tem base = custo_real > 0, satisfaz I0, e o motor
-- sugere legitimamente. Um CHECK global barraria esse insert legítimo. O CHECK segue a
-- GRANDEZA (a base do modo), não a coluna.
--
-- Nota de leitura do CASE: o domínio de `modo` já está fechado pelo `rep_prec_modo_chk`, então
-- o ramo implícito `ELSE NULL` é inalcançável. Os dois CHECKs juntos é que fecham a garantia.
-- ─────────────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rep_prec_base_do_modo_positiva_chk'
      AND conrelid = 'repasse_precificacao_sugerida'::REGCLASS
  ) THEN
    ALTER TABLE repasse_precificacao_sugerida
      ADD CONSTRAINT rep_prec_base_do_modo_positiva_chk
      CHECK (
        (CASE modo
           WHEN 'recuperar_tudo' THEN custo_real
           WHEN 'girar_rapido'   THEN valor_compra_repasse
         END) > 0
      );
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 4. COMMENTS — a coluna nova, e a CORREÇÃO que a emenda obriga
-- =====================================================================================
-- `COMMENT ON` é sempre sobrescrita: idempotente por construção, sem guarda.
-- ─────────────────────────────────────────────────────────────────────────────────────

-- 4.1 — A coluna nova.
COMMENT ON COLUMN repasse_precificacao_sugerida.modo IS
  'DISCRIMINADOR DE POPULACAO — qual regua produziu esta linha (ADR-003 §12.6). '
  'recuperar_tudo = preco sobre custo_real (compra + gastos). '
  'girar_rapido   = preco sobre valor_compra_repasse: abre mao dos gastos DE PROPOSITO, '
  'e portanto pode ficar ABAIXO do custo real — isso e desenho, nao anomalia (§12.0). '
  'SEM DEFAULT: toda linha declara o modo explicitamente. Dois valores e so dois — um '
  'terceiro modo mudaria a BASE do preco e volta como decisao (gatilho T6, §12.11), nao '
  'como slot vago no CHECK. Agrupar por esta coluna e o unico jeito correto de recalibrar: '
  'sem ela as duas populacoes viram uma media sem significado. O sufixo em versao_regua '
  '(__recuperar_tudo / __girar_rapido) e REDUNDANCIA LEGIVEL, nunca a fonte. '
  'SOB D3 (regua UNICA: REGUA_MINIMO_PCT = 1.066 aplicada as DUAS bases) esta coluna e a '
  'UNICA fonte possivel: parametros_regua fica BYTE A BYTE IDENTICO nos dois modos, entao '
  'derivar o modo do conteudo da linha deixou de ser inferencia fraca e passou a ser '
  'IMPOSSIVEL. Sem esta coluna a populacao seria irrecuperavel, nao apenas dificil.';

-- 4.2 — A CORREÇÃO. Antes: "travou no piso de custo" (030:376-377). A emenda tornou essa
-- frase falsa no modo girar, e um COMMENT falso aqui é PIOR que COMMENT nenhum: a
-- recalibração confia nele e não tem como saber que está errado (§12.7).
COMMENT ON COLUMN repasse_precificacao_sugerida.bateu_piso IS
  'true = a sugestao travou no piso DO MODO (AC12 da 3.1 / ADR-003 §12.2): recuperar_tudo '
  'trava em custo_real, girar_rapido trava em valor_compra_repasse. LER SEMPRE JUNTO DA '
  'COLUNA modo — o piso e a mesma linha de codigo nos dois modos, o que muda e de que numero '
  'ele e piso. Substitui o texto original da 030 ("piso de custo"), verdadeiro so ate a 3.1c.';

-- 4.3 — Reforço na tabela: quem ler o COMMENT da tabela primeiro precisa saber que a
-- granularidade de análise ganhou uma dimensão.
COMMENT ON TABLE repasse_precificacao_sugerida IS
  'Snapshot append-only da sugestao de preco de repasse (aba /precificar), gravado no clique '
  'de "Aplicar". Preserva sugerido x aplicado x contexto do momento pra recalibrar a regua '
  '(hoje n=16). NAO substitui repasses.valor_minimo/valor_compre_por, que seguem sendo o '
  'campo operacional governado pelo portal via import. ADR-003 §3. '
  'DESDE A 032: toda leitura de calibracao e POR MODO (coluna modo) — recuperar_tudo e '
  'girar_rapido tem BASES DIFERENTES (custo_real x valor_compra_repasse) e agregar os dois '
  'juntos mistura duas populacoes (§12.6). Write-only exceto a leitura pontual do snapshot '
  'mais recente por repasse, que desambigua o vermelho de abaixo-do-custo (§12.8, C16 da 3.1c).';


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 5. O QUE FOI VERIFICADO E DELIBERADAMENTE **NÃO** MUDOU
-- =====================================================================================
-- Registrado aqui porque, sem registro, cada um destes vira um "conserto" numa sessão
-- futura — e os quatro seriam regressões.
--
-- 5.1 `minimo_razao_efetiva` / `compre_por_razao_efetiva` e seus COMMENTs (030:372-375):
--     INTACTOS. A razão efetiva continua sendo gravada SOBRE `custo_real` nos DOIS modos.
--     Não é inércia — é §12.5: a coluna existe pra que `razao × custo_real` reproduza o
--     preço gravado, e essa identidade só sobrevive com DENOMINADOR UNIFORME entre modos.
--     `custo_real` é o único candidato uniforme (NOT NULL + verificado pelo
--     `rep_prec_custo_decomposto_chk`). Se o denominador variasse com o modo, toda leitura
--     futura precisaria saber o modo ANTES de saber o que a razão significa.
--     ⚠️ Não "corrigir" estes COMMENTs: eles continuam verdadeiros palavra por palavra, e
--     mexer neles sinalizaria uma mudança de semântica que NÃO houve.
--
--     Confere no PRD2189 sob girar (compra 80.000 · gastos 6.850 · custo 86.850), SOB D3:
--       mínimo = 80.000 × 1,066         = 85.280,00   (numeric(12,2), exato)
--       razão  = 85.280,00 ÷ 86.850,00  = 0,981923    (numeric(9,6), truncada em 6 casas)
--
--     ⚠️ RESSALVA DE CENTAVO — escrita aqui de propósito, porque sem ela alguém "conserta"
--     o motor. O round-trip da razão fecha com tolerância de **±R$ 0,01**, NÃO exato:
--         0,981923 × 86.850,00 = 85.280,01   contra   85.280,00 gravados.
--     Isso NÃO é divergência financeira e NÃO é o bug crítico da AGENTS.md §4: o valor
--     gravado e enviado ao portal é 85.280,00, exato e centavo-perfect. O R$ 0,01 é perda de
--     precisão da RECONSTRUÇÃO a partir de uma razão truncada em 6 casas — a coluna é
--     auditoria, não fonte do preço. Quem auditar deve comparar com tolerância de 1 centavo.
--     A assimetria entre modos é esperada e não indica defeito: no modo recuperar a razão é
--     a própria constante (1,066000, 3 casas) e o round-trip fecha EXATO — 1,066000 × 86.850
--     = 92.582,10. Só o girar produz razão não-terminante. Verificado em Postgres numeric,
--     a mesma aritmética que roda em produção.
--
-- 5.2 NENHUM CHECK liga `modo` ao sufixo de `versao_regua`. Tentador (`versao_regua LIKE
--     '%\_\_' || modo`), e errado: a §12.6 rejeitou o sufixo COMO FONTE justamente por ser
--     convenção não-verificada; verificá-la agora no banco reintroduziria o acoplamento pela
--     porta dos fundos e faria um bump de versão sem sufixo ABORTAR o clique de "Aplicar".
--     Com a coluna presente, `modo` × sufixo é inconsistência DETECTÁVEL numa query — que é
--     exatamente o status que a ADR pediu. Ver a query 6 da §7.
--
-- 5.3 RLS: nada a fazer. A policy `authenticated_all_access` (030:349) é FOR ALL sobre a
--     TABELA — cobre a coluna nova automaticamente. Recriá-la aqui seria ruído, e um DROP
--     POLICY desnecessário é uma janela de segundos sem policy à toa. Verificado que
--     `relrowsecurity = true` segue valendo (query 1 da §7).
--
-- 5.4 TRIGGER de append-only: nada a fazer, e isto é um ACERTO DA 030 sendo colhido.
--     `trg_rep_prec_append_only` compara `to_jsonb(OLD) - v_mutaveis` contra
--     `to_jsonb(NEW) - v_mutaveis`, com `v_mutaveis` = {minimo_aplicado, compre_por_aplicado,
--     aplicado_em}. Toda coluna NOVA cai fora dessa lista e portanto nasce IMUTÁVEL — que é
--     o default certo pra um discriminador de população. `modo` fica protegido de reescrita
--     sem uma linha de código nova (030:266-268 previu exatamente isto).
--
-- 5.5 FUSO: nenhuma coluna `date` entra aqui. `modo` é TEXT. A 028 continua intacta e o
--     UTC-shift não tem por onde renascer nesta migration.
-- ─────────────────────────────────────────────────────────────────────────────────────


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 6. CONTRATO PRO `@dex-dev` — o que o app passa a ser obrigado a enviar
-- =====================================================================================
--   • `modo` em TODO insert de snapshot: 'recuperar_tudo' | 'girar_rapido'. Não há DEFAULT;
--     um insert sem a coluna estoura 23502 (not-null). Isso é a rede, não o plano.
--   • O modo enviado tem que ser O MESMO que produziu os números da linha, e tem que vir DO
--     OBJETO QUE O MOTOR DEVOLVEU (`SugestaoPrecoRepasse`) — nunca de um estado de UI lido em
--     separado, nunca de um parâmetro à parte de `montarSnapshotPrecificacao`. É o único jeito
--     de corromper esta tabela que o banco NÃO consegue detectar: a coluna fecha o DOMÍNIO,
--     não a VERDADE. Um `modo` trocado passa em todos os CHECKs e produz linha internamente
--     coerente que MENTE sobre a própria população. Formalizado como **C19** da 3.1c.
--   • `versao_regua` continua ganhando o sufixo (`…__girar_rapido`), como redundância (C12).
--   • `parametros_regua` NÃO ganha chave nova. Sob **D3** (régua única, decisão do Marcos de
--     2026-08-12) `REGUA_GIRAR_PCT` NÃO EXISTE: é `REGUA_MINIMO_PCT` = 1,066 aplicada às duas
--     bases. O mapa fica byte a byte idêntico nos dois modos — se o diff introduzir uma
--     constante nova, a C2 está violada. ⚠️ Uma versão anterior deste arquivo (pré-D3) mandava
--     gravar `REGUA_GIRAR_PCT` aqui; se você leu aquilo, era o contrato antigo.
--   • Razões efetivas: SOBRE `custo_real` nos dois modos, com a ressalva de ±R$ 0,01 no
--     round-trip da auditoria (§5.1 acima) — que NÃO se conserta no motor.
--   • A guarda do motor tem que virar `base(modo) <= 0` (§3 acima). O CHECK daqui é o
--     ANTEPARO; se ele disparar em produção, o bug está no motor, não na constraint.
-- ─────────────────────────────────────────────────────────────────────────────────────


-- =====================================================================================
-- 7. VERIFICAÇÃO PÓS-APLICAÇÃO (rodar à mão no SQL editor)
-- =====================================================================================
-- 1) A coluna existe, NOT NULL, SEM default — e a RLS continua ligada:
--      SELECT column_name, data_type, is_nullable, column_default
--        FROM information_schema.columns
--       WHERE table_name = 'repasse_precificacao_sugerida' AND column_name = 'modo';
--      -- esperado: modo | text | NO | NULL   (column_default NULL é o ponto)
--      SELECT relrowsecurity FROM pg_class WHERE relname = 'repasse_precificacao_sugerida';
--      -- esperado: true
--
-- 2) As DUAS constraints novas existem (7 CHECKs nomeados no total, com os 5 da 030):
--      SELECT conname FROM pg_constraint
--       WHERE conrelid = 'repasse_precificacao_sugerida'::REGCLASS
--         AND contype = 'c' AND conname LIKE 'rep\_prec\_%'
--       ORDER BY conname;
--      -- esperado incluir: rep_prec_base_do_modo_positiva_chk, rep_prec_modo_chk
--
-- 3) IDEMPOTÊNCIA — rodar o arquivo inteiro 2× e conferir que nada duplicou:
--      SELECT count(*) FROM pg_index WHERE indrelid = 'repasse_precificacao_sugerida'::REGCLASS;
--      -- esperado: 2 (PK + idx_rep_prec_repasse_recente) — a 032 NÃO cria índice
--
-- 4) O domínio é fechado em dois e a base positiva é exigida (esperado: EXCEPTION 23514 nas 3):
--      BEGIN;
--        -- (a) terceiro modo -> deve estourar (rep_prec_modo_chk)
--        INSERT INTO repasse_precificacao_sugerida
--          (repasse_id, modo, versao_regua, parametros_regua, minimo_sugerido,
--           compre_por_sugerido, confianca, custo_real, valor_compra_repasse, gastos_total)
--        SELECT id, 'showroom', 'teste_v0', '{"x":1}'::jsonb, 1, 1, 'alta', 100000.00, 100000.00, 0
--          FROM repasses ORDER BY id LIMIT 1;
--        -- (b) girar com compra 0 e gasto lancado -> deve estourar (base_do_modo_positiva)
--        INSERT INTO repasse_precificacao_sugerida
--          (repasse_id, modo, versao_regua, parametros_regua, minimo_sugerido,
--           compre_por_sugerido, confianca, custo_real, valor_compra_repasse, gastos_total)
--        SELECT id, 'girar_rapido', 'teste_v0', '{"x":1}'::jsonb, 0, 0, 'alta', 6850.00, 0, 6850.00
--          FROM repasses ORDER BY id LIMIT 1;
--        -- (c) sem informar o modo -> deve estourar 23502 (not-null)
--        INSERT INTO repasse_precificacao_sugerida
--          (repasse_id, versao_regua, parametros_regua, minimo_sugerido,
--           compre_por_sugerido, confianca, custo_real, valor_compra_repasse, gastos_total)
--        SELECT id, 'teste_v0', '{"x":1}'::jsonb, 1, 1, 'alta', 100000.00, 100000.00, 0
--          FROM repasses ORDER BY id LIMIT 1;
--      ROLLBACK;
--
-- 5) O caminho FELIZ do girar (compra 80.000, gastos 6.850 — PRD2189) passa, e o par
--    abaixo do custo é ACEITO (é desenho, §12.0). E o modo é imutável (§5.4):
--      BEGIN;
--        INSERT INTO repasse_precificacao_sugerida
--          (repasse_id, modo, versao_regua, parametros_regua, minimo_sugerido,
--           compre_por_sugerido, minimo_razao_efetiva, confianca, custo_real,
--           valor_compra_repasse, gastos_total)
--        SELECT id, 'girar_rapido', 'teste_v0__girar_rapido',
--               '{"REGUA_MINIMO_PCT":1.066,"RAZAO_MINIMO_SOBRE_COMPRE_POR":0.952}'::jsonb,
--               85280.00, 89579.83, 0.981923,
--               'alta', 86850.00, 80000.00, 6850.00
--          FROM repasses ORDER BY id LIMIT 1;
--        -- Numeros SOB D3 (regua unica 1,066 nas duas bases): 80.000 x 1,066 = 85.280,00 e
--        -- 85.280,00 / 0,952 = 89.579,83. NAO ha REGUA_GIRAR_PCT — o parametros_regua acima e
--        -- IDENTICO ao que o modo recuperar grava, e e por isso que a coluna `modo` e a unica
--        -- fonte possivel do modo (§4.1).
--        -- minimo 85.280 < custo 86.850 e PASSA: correto, e desenho (§12.0), nao anomalia.
--        -- Round-trip da razao: 0,981923 x 86.850 = 85.280,01 — fecha com +-R$ 0,01, NAO
--        -- exato. Isso e esperado (§5.1): NAO ajustar o motor nem os numeros acima por causa
--        -- do centavo. No modo recuperar o round-trip fecha exato; a assimetria e normal.
--        -- trocar o modo depois -> deve estourar (trigger de append-only)
--        UPDATE repasse_precificacao_sugerida SET modo = 'recuperar_tudo'
--         WHERE versao_regua = 'teste_v0__girar_rapido';
--      ROLLBACK;
--
-- 6) A INCONSISTÊNCIA `modo` × sufixo é detectável (§5.2) — esperado: 0 linhas hoje,
--    e esta query é a que se roda depois de qualquer bump de `versao_regua`:
--      SELECT id, modo, versao_regua FROM repasse_precificacao_sugerida
--       WHERE versao_regua NOT LIKE '%\_\_' || modo;
--
-- 7) A leitura que a coluna existe pra permitir — sem `split_part`, sem inferência:
--      SELECT modo, count(*), round(avg(minimo_razao_efetiva), 6) AS razao_media
--        FROM repasse_precificacao_sugerida
--       WHERE aplicado_em IS NOT NULL
--       GROUP BY modo ORDER BY modo;
-- =====================================================================================
-- FIM
-- =====================================================================================
