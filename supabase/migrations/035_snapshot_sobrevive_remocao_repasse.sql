-- Navesa Mesa — Migration 035: o snapshot de precificação sobrevive ao DELETE do repasse
-- =====================================================================================
-- Implementa a §13 da ADR-003 (`docs/design/adr-003-persistencia-e-derivacao-da-sugestao-
-- de-preco.md`, emenda de 2026-08-12, opção 3). Story 3.1a — CORREÇÃO DE SCHEMA, não feature.
--
-- ⚠️ O QUE ESTA MIGRATION CONSERTA — e por que a 030 estava errada
-- ─────────────────────────────────────────────────────────────────────────────────────
-- A 030 pôs `ON DELETE CASCADE` em `repasse_precificacao_sugerida.repasse_id` (030:61) sobre
-- uma premissa registrada em 030:270-272:
--
--     "Repasse apagado leva seus snapshots junto; `repasses` na prática muda de status
--      em vez de ser apagada."
--
-- **A PREMISSA É FALSA, e já era falsa quando foi escrita.** Repasses são apagados por
-- DELETE físico no fluxo de todo dia, por dois caminhos que já existiam no código:
--   • `src/lib/repasses/queries.ts:557` (`deleteRepasse`) e `:563` (`deleteRepasses`),
--     chamados de `src/components/repasses/RepassesLista.tsx:440` e `:464` — botão "Remover"
--     e remoção em lote;
--   • `SumidosDoArquivoPainel.removerSelecionados()` (frente `feat/sumidos-auto-avaliar`),
--     cujo próprio comentário (`:86-87`) já documentava o CASCADE em voz alta.
-- Evidência de produção: a placa PRD2189 existia com `status='subido'` por volta das 13h de
-- 2026-08-12 e não existia mais poucas horas depois. Não mudou de status — a linha sumiu.
-- O Marcos confirmou que a remoção é intencional e esperada.
--
-- E O DANO NÃO SERIA ALEATÓRIO. A remoção é CORRELACIONADA COM O DESFECHO: só se remove
-- carro que saiu do anúncio. Se o fluxo desenhado for seguido ("marcar vendido" antes de
-- remover), o que o CASCADE apaga são majoritariamente os NEGATIVOS — "sugeriu, anunciou,
-- não vendeu" —, que são exatamente o sinal de que a régua está alta e que nenhuma outra
-- fonte tem. Amostra cuja sobrevivência depende do resultado é o pior caso possível pra
-- recalibrar régua (ADR-003 §13.2). O único motivo de nada ter sido destruído ainda é que a
-- 3.1a não está em produção e a tabela tem ZERO LINHAS.
--
-- O QUE ESTA MIGRATION FAZ — seis coisas, e nada além:
--   1. As três colunas de IDENTIDADE do carro (`placa_snapshot`, `chassi_snapshot`,
--      `modelo_snapshot`), congeladas no INSERT, NOT NULL. Padrão `modelo_snapshot` da 033.
--   2. As seis colunas de DESFECHO (`desfecho_*`), congeladas no DELETE, todas nullable e
--      SEM NENHUMA CONSTRAINT (ADR-003 §13.6 — regra dura, ver §3 abaixo).
--   3. A FK `repasse_id` vira NULLABLE + `ON DELETE SET NULL`, com nome próprio.
--   4. O CHECK que torna "órfão sem desfecho" IMPOSSÍVEL — invariante, não convenção.
--   5. A REESCRITA do guard de append-only da 030 (030:278-306). Sem isto, o DELETE do
--      usuário passaria a ABORTAR SEMPRE — ver §5, é o ponto mais fácil de deixar passar.
--   6. O trigger `BEFORE DELETE` em `repasses` que congela o desfecho no instante da perda.
--   + Sobrescreve os COMMENTs que a premissa errada contaminou (§13.1: COMMENT errado é
--     PIOR que COMMENT nenhum — quem lê confia e não tem como saber).
--
-- O QUE ESTA MIGRATION **NÃO** FAZ:
--   ❌ NÃO toca nenhuma decisão de preço. §3, §4, §5, §6, §7 e §12 inteira da ADR-003 ficam
--      de pé. `sugerir-preco-repasse.ts`, `margem-repasse.ts`, `origem-abaixo-do-custo.ts`,
--      028, 029 e 032 não mudam uma linha.
--   ❌ NÃO usa `ON DELETE RESTRICT`. Rejeitado (§13.3 opção 2) e não só por travar o fluxo:
--      o contorno natural do usuário seria apagar o snapshot antes, ou parar de clicar
--      "Aplicar". **A guarda destruiria o dado por outro caminho.**
--   ❌ NÃO desnormaliza o desfecho nas linhas com repasse vivo. Enquanto o repasse existe, o
--      desfecho se lê por JOIN e as colunas `desfecho_*` ficam NULL. A cópia acontece no
--      único instante em que o join deixa de existir, e nunca antes.
--   ❌ NÃO cria índice novo. `idx_rep_prec_repasse_recente (repasse_id, criado_em DESC)`
--      (030:252) continua sendo o motivo NÃO-especulativo: com `SET NULL` o DELETE no pai
--      vira um UPDATE na filha, e a busca pela coluna filha é a mesma.
--   ❌ NÃO revoga o 030:44-51. Aquele parágrafo recusou placa/chassi COMO CHAVE e segue
--      certo — agrupar por placa mistura ciclos. Aqui elas entram como RÓTULO (sufixo
--      `_snapshot`). A chave do ciclo continua sendo `repasse_id`.
--   ❌ NÃO implementa soft-delete em `repasses`. É a opção 6 da §13.3, rejeitada agora e
--      registrada como gatilho T7 (§13.10): TERCEIRA tabela filha a precisar sobreviver ao
--      DELETE ⇒ soft-delete vira decisão a tomar. Esta é a segunda (a 033 foi a primeira).
--
-- NUMERAÇÃO: 035. A 031 segue RESERVADA pro `COALESCE` dos writes da 028 (ADR-003 §6) e
--   continua NÃO APLICADA. 032 é da 3.1c; 033 e 034 são da frente de leads e já estão
--   commitadas. Aplicar a 035 antes da 031 é seguro: elas não se tocam.
--
-- PRÉ-REQUISITOS VERIFICADOS no projeto `mesa` (gjyzcyamwdldnriqydua) em 2026-08-12, ANTES
--   de escrever este arquivo:
--     • `repasse_precificacao_sugerida` = **0 linhas** (a janela da §13.4 está aberta:
--       trocar a ação da FK e acrescentar colunas é instantâneo e dispensa backfill);
--     • 030 e 032 aplicadas (a coluna `modo` existe);
--     • a FK atual chama-se `repasse_precificacao_sugerida_repasse_id_fkey` e é
--       `ON DELETE CASCADE` (`confdeltype = 'c'`);
--     • `repasses` NÃO tem hoje nenhum trigger de DELETE (só os dois de UPDATE/INSERT
--       da 008 e da 027) — este é o primeiro, e não disputa ordem com ninguém.
--
-- IDEMPOTENTE: ADD COLUMN IF NOT EXISTS · DROP/ADD de constraint em DO block com guarda ·
--   SET NOT NULL (no-op se já for) · CREATE OR REPLACE FUNCTION · DROP TRIGGER IF EXISTS ·
--   COMMENT ON sempre sobrescreve. Roda 2× sem erro. Tudo numa transação só: não existe
--   instante em que a FK já seja `SET NULL` e o trigger de congelamento ainda não exista.
-- =====================================================================================

BEGIN;


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 0. PRÉ-REQUISITO — falhar aqui com mensagem própria (padrão da 032 §1)
-- =====================================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'repasse_precificacao_sugerida'
  ) THEN
    RAISE EXCEPTION '035 ABORTADA: a tabela repasse_precificacao_sugerida nao existe.'
      USING HINT = 'Aplique 030_repasse_precificacao_sugerida.sql (e 032) primeiro. '
                   'A 035 so corrige a FK e acrescenta colunas a uma tabela que a 030 cria.';
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 1. IDENTIDADE DO CARRO — congelada no INSERT, NOT NULL
-- =====================================================================================
-- POR QUE NO INSERT E NÃO NA DELEÇÃO (ADR-003 §13.4 ponto 2): é quando o app já tem os três
-- valores na mão (a tela de precificar carrega placa, chassi e modelo), e congelar ali
-- também protege de EDIÇÃO POSTERIOR do repasse. É o padrão `modelo_snapshot` da 033/018:69,
-- com o argumento textual dela: um registro sem `repasse_id` ainda diz "era a Ranger 3.2 XLT"
-- — degrada o VÍNCULO, não o FATO.
--
-- ⚠️ RÓTULO, NUNCA CHAVE. O sufixo `_snapshot` está no nome de propósito. Agrupar por
-- `placa_snapshot` MISTURA CICLOS: a mesma placa volta num segundo repasse (é o motivo de o
-- índice `repasses_chassi_subido_uniq` da 009 ser PARCIAL). A granularidade da recalibração
-- continua sendo `repasse_id`; quando ele é NULL, o que acabou foi o CICLO, não o registro.
--
-- NOT NULL, mas SEM CHECK de não-vazio — e isso é decisão, não esquecimento (§13.5):
-- `repasses.placa` / `repasses.chassi` são NOT NULL mas ADMITEM STRING VAZIA no uso real (o
-- painel de sumidos trata "sem placa legível" e testa `chassi !== ""`). Um CHECK de
-- não-vazio aqui abortaria o clique de "Aplicar" num carro que o resto do sistema aceita —
-- o erro da §11 desvio 1: banco recusando a ação legítima do usuário.
--
-- BACKFILL: o caminho feliz é a tabela vazia (0 linhas, verificado). Mas se algum ambiente
-- (branch, dev local) já tiver linhas, o backfill AQUI é legítimo e NÃO é chute — ao
-- contrário do `modo` da 032, que precisou abortar. A distinção é DERIVÁVEL × INVENTÁVEL:
-- toda linha existente tem `repasse_id` NOT NULL (era a FK antiga), então o valor vem de um
-- JOIN determinístico com o pai vivo. É TRANSPORTE, não adivinhação. Abortar aqui seria
-- pior que backfillar: deixaria o `ON DELETE CASCADE` de pé, que é o bug.
-- ─────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE repasse_precificacao_sugerida
  ADD COLUMN IF NOT EXISTS placa_snapshot  TEXT,
  ADD COLUMN IF NOT EXISTS chassi_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS modelo_snapshot TEXT;

DO $$
DECLARE
  v_pendentes BIGINT;
BEGIN
  SELECT count(*) INTO v_pendentes
    FROM repasse_precificacao_sugerida
   WHERE placa_snapshot IS NULL OR chassi_snapshot IS NULL OR modelo_snapshot IS NULL;

  IF v_pendentes = 0 THEN
    RAISE NOTICE '035: identidade — nada a backfillar (tabela vazia ou ja preenchida).';
  ELSE
    -- O guard de append-only da 030 (ainda o antigo neste ponto do arquivo) barraria este
    -- UPDATE — e o guard NOVO também barraria, porque identidade é imutável por desenho.
    -- Desligar o trigger PELO ESCOPO DESTE UNICO UPDATE, dentro da transação, é a forma
    -- honesta: se qualquer coisa falhar, o ROLLBACK devolve o trigger ligado.
    ALTER TABLE repasse_precificacao_sugerida DISABLE TRIGGER trg_rep_prec_append_only;

    UPDATE repasse_precificacao_sugerida s
       SET placa_snapshot  = COALESCE(s.placa_snapshot,  r.placa),
           chassi_snapshot = COALESCE(s.chassi_snapshot, r.chassi),
           modelo_snapshot = COALESCE(s.modelo_snapshot, r.modelo)
      FROM repasses r
     WHERE r.id = s.repasse_id
       AND (s.placa_snapshot IS NULL OR s.chassi_snapshot IS NULL OR s.modelo_snapshot IS NULL);

    ALTER TABLE repasse_precificacao_sugerida ENABLE TRIGGER trg_rep_prec_append_only;

    RAISE NOTICE '035: identidade backfillada por JOIN em % linha(s) preexistente(s).', v_pendentes;
  END IF;

  -- Se sobrou alguma sem identidade, o JOIN não fechou — parar é a ação certa. NÃO
  -- preencher com '' pra "destravar": string vazia aqui seria rótulo falso, e rótulo falso
  -- é exatamente a classe de dano que a §13.1 nomeia.
  SELECT count(*) INTO v_pendentes
    FROM repasse_precificacao_sugerida
   WHERE placa_snapshot IS NULL OR chassi_snapshot IS NULL OR modelo_snapshot IS NULL;

  IF v_pendentes > 0 THEN
    RAISE EXCEPTION '035 ABORTADA: % linha(s) ficaram sem identidade apos o backfill.', v_pendentes
      USING HINT = 'Sao linhas cujo repasse_id nao casou com repasses(id) — situacao que a FK '
                   'antiga tornava impossivel. Investigue antes de prosseguir. NAO preencha com '
                   'string vazia pra destravar: rotulo falso e pior que coluna ausente.';
  END IF;
END $$;

ALTER TABLE repasse_precificacao_sugerida
  ALTER COLUMN placa_snapshot  SET NOT NULL,
  ALTER COLUMN chassi_snapshot SET NOT NULL,
  ALTER COLUMN modelo_snapshot SET NOT NULL;


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 2. DESFECHO — congelado no DELETE, tudo nullable, ZERO CONSTRAINT
-- =====================================================================================
-- ⚠️ ADR-003 §13.6, REGRA DURA — leia antes de "melhorar" este bloco:
--   NENHUMA constraint nestas colunas. Sem CHECK de domínio em `desfecho_status`, sem
--   `>= 0` nos valores, sem NOT NULL, sem DEFAULT.
--
-- O motivo não é preguiça, é arquitetura: **se qualquer coisa no congelamento puder abortar,
-- a opção 3 vira a opção 2 (RESTRICT) pela porta dos fundos** — e pior, de forma
-- intermitente, num botão que hoje sempre funciona. Estas colunas COPIAM um estado que já
-- existe e já foi validado no pai (`repasses.status` tem CHECK próprio em 008:38-39,
-- os valores são numeric(12,2) na origem). Validar de novo só cria uma forma nova de o
-- DELETE do usuário falhar. É a §11 desvio 1 outra vez.
--
-- Se um dia o CHECK de `repasses.status` ganhar um valor, esta coluna aceita sem migration —
-- que é o comportamento certo pra uma cópia histórica: ela guarda o que ERA, não o que É
-- válido hoje.
--
-- AS DUAS OPCIONAIS DA §13.5 — **AS DUAS ENTRAM**, conforme recomendação da @aria-architect
-- e decisão do Marcos. Concordo com as duas, e o motivo é o mesmo em ambas: são a única
-- janela em que o dado existe.
--   • `desfecho_custo_real` = `valor_compra_repasse + Σ repasse_gastos` NO INSTANTE DA PERDA.
--     `repasse_gastos` cascateia junto e some (008:61) — depois do DELETE não existe forma
--     de saber se o custo estava completo. É o mesmo argumento da §2.3 aplicado ao outro
--     ponto do ciclo de vida. Fecha a pergunta que `gastos_qtde` (030:118) só LEVANTA.
--   • `desfecho_valor_minimo` = o `repasses.valor_minimo` final. Preserva post-mortem a
--     classificação da C16 (§12.8): comparar com `minimo_aplicado` diz se o Marcos mudou o
--     preço no portal DEPOIS de aplicar. Sem ela, some a capacidade de classificar origem
--     em carro removido.
--   As LINHAS itemizadas de `repasse_gastos` continuam morrendo, e isso é aceito: o snapshot
--   já congela `gastos_total`/`gastos_qtde` na DECISÃO e `desfecho_custo_real` fecha o total
--   no FIM. Reconstituir a lista não recalibra régua nenhuma.
--
-- ⚠️ `desfecho_data_vendido` É A PRIMEIRA E ÚNICA COLUNA `date` DESTA TABELA — e a §5 da 030
-- (030:316) afirma, palavra por palavra, que "esta tabela não tem NENHUMA coluna `date`".
-- A afirmação está EMENDADA aqui e no COMMENT da coluna (§7) em vez de virar mentira.
-- O que a torna aceitável e NÃO reintroduz o bug da 028: ela é CÓPIA de
-- `repasses.data_vendido`, um `date` JÁ CORRIGIDO pela 028. **Transporta um valor pronto;
-- não calcula data nenhuma.** O contrato da 030 (§5: "JAMAIS `current_date`") continua
-- valendo com força total sobre o trigger da §6 — que usa `OLD.data_vendido`, e `now()`
-- apenas no `desfecho_congelado_em`, que é INSTANTE TÉCNICO (timestamptz), não dia de
-- calendário. A 028 lista `now()`/timestamptz explicitamente entre o que NÃO se converte.
-- ─────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE repasse_precificacao_sugerida
  ADD COLUMN IF NOT EXISTS desfecho_congelado_em  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS desfecho_status        TEXT,
  ADD COLUMN IF NOT EXISTS desfecho_valor_vendido NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS desfecho_data_vendido  DATE,
  ADD COLUMN IF NOT EXISTS desfecho_custo_real    NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS desfecho_valor_minimo  NUMERIC(12,2);


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 3. A FK — de `CASCADE` pra `SET NULL`, nullable e com nome próprio
-- =====================================================================================
-- `repasse_id IS NULL` passa a ter UM significado, fechado: *"o ciclo de repasse a que esta
-- decisão pertencia foi removido do sistema"*. Nunca "ainda não sei" — não existe caminho
-- que insira sem repasse (a FK é obrigatória no INSERT pelo contrato do app, e o CHECK da
-- §4 fecha o resto).
--
-- A FK atual é AUTO-NOMEADA (`repasse_precificacao_sugerida_repasse_id_fkey`). Em vez de
-- confiar no nome gerado, o DO block DESCOBRE a FK que aponta `repasse_id` e cujo
-- `confdeltype` ainda NÃO é `n` (SET NULL) — assim a migration é idempotente E robusta a
-- ambiente onde o nome tenha divergido. Numa 2ª execução o SELECT não acha nada e o ADD é
-- pulado pela guarda de nome.
--
-- ORDEM: o DROP NOT NULL vem primeiro. Uma FK `SET NULL` sobre coluna NOT NULL é DDL válida
-- que só explodiria NO DELETE — e explodir no DELETE é precisamente o que esta migration
-- existe pra impedir.
-- ─────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE repasse_precificacao_sugerida
  ALTER COLUMN repasse_id DROP NOT NULL;

DO $$
DECLARE
  v_fk_antiga TEXT;
BEGIN
  SELECT c.conname INTO v_fk_antiga
    FROM pg_constraint c
   WHERE c.conrelid = 'repasse_precificacao_sugerida'::REGCLASS
     AND c.contype  = 'f'
     AND c.confdeltype <> 'n'                       -- 'n' = SET NULL: já é a nova
     AND EXISTS (
       SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = c.conrelid
          AND a.attname  = 'repasse_id'
          AND a.attnum   = ANY (c.conkey)
     )
   LIMIT 1;

  IF v_fk_antiga IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE repasse_precificacao_sugerida DROP CONSTRAINT %I', v_fk_antiga);
    RAISE NOTICE '035: FK antiga % (ON DELETE CASCADE) removida.', v_fk_antiga;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname  = 'rep_prec_repasse_fk'
       AND conrelid = 'repasse_precificacao_sugerida'::REGCLASS
  ) THEN
    ALTER TABLE repasse_precificacao_sugerida
      ADD CONSTRAINT rep_prec_repasse_fk
      FOREIGN KEY (repasse_id) REFERENCES repasses(id) ON DELETE SET NULL;
    RAISE NOTICE '035: FK rep_prec_repasse_fk (ON DELETE SET NULL) criada.';
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 4. "ÓRFÃO SEM DESFECHO" VIRA IMPOSSÍVEL — CHECK, não convenção
-- =====================================================================================
-- É o que converte o T5 de gatilho-que-alguém-precisa-notar em INVARIANTE DE BANCO, e é o
-- princípio da §12.6 ("nenhuma garantia semântica depende de convenção") aplicado ao ponto
-- que a 030 deixou de fora.
--
-- ⚠️ ESTE CHECK NÃO CONTRADIZ A §13.6. Ele NÃO é validação de domínio das colunas
-- `desfecho_*` — é a coerência entre o vínculo e o carimbo, e ele NUNCA PODE DISPARAR NUM
-- DELETE porque a ordem de execução do Postgres garante que o trigger `BEFORE DELETE` da §6
-- já congelou o desfecho quando a ação `SET NULL` da FK (que roda DEPOIS do delete, como
-- trigger AFTER interno) toca a linha. A sequência, explícita:
--     1. BEFORE DELETE em `repasses`  → UPDATE nos snapshots: desfecho_* preenchido,
--                                        `repasse_id` ainda NOT NULL ⇒ CHECK satisfeito.
--     2. o DELETE acontece.
--     3. ação RI `SET NULL`            → UPDATE: `repasse_id` = NULL, mas
--                                        `desfecho_congelado_em` já NOT NULL ⇒ CHECK satisfeito.
-- Em nenhum dos dois instantes existe uma linha órfã sem desfecho.
--
-- Em DO block pelo mesmo motivo da 030 §2 e da 032 §2: CHECK não tem `IF NOT EXISTS` antes
-- do PG 17.
-- ─────────────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname  = 'rep_prec_orfao_tem_desfecho_chk'
       AND conrelid = 'repasse_precificacao_sugerida'::REGCLASS
  ) THEN
    ALTER TABLE repasse_precificacao_sugerida
      ADD CONSTRAINT rep_prec_orfao_tem_desfecho_chk
      CHECK (repasse_id IS NOT NULL OR desfecho_congelado_em IS NOT NULL);
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 5. ⚠️ A REESCRITA DO GUARD DE APPEND-ONLY — sem isto, o DELETE aborta SEMPRE
-- =====================================================================================
-- ESTE É O PONTO QUE SOZINHO TRANSFORMARIA A DECISÃO EM REGRESSÃO SILENCIOSA (ADR-003 §13.7).
--
-- O guard da 030 (030:278-306) começava com:
--     IF OLD.aplicado_em IS NOT NULL THEN RAISE EXCEPTION ...
-- Toda linha JÁ APLICADA tem `aplicado_em IS NOT NULL`. Logo, DOIS updates legítimos
-- bateriam nessa cláusula e abortariam o DELETE DO USUÁRIO:
--     (a) o UPDATE do congelamento do desfecho (§6);
--     (b) o UPDATE que a PRÓPRIA FK faz pra zerar `repasse_id`.
-- Resultado: `SET NULL` se comportando EXATAMENTE COMO `RESTRICT`, com uma mensagem de erro
-- incompreensível ("snapshot já carimbado…") num botão de remover carro.
--
-- E o mecanismo `to_jsonb(OLD) - v_mutaveis` foi desenhado pra que COLUNA NOVA NASÇA
-- IMUTÁVEL (030:267-268) — default certo, e aqui é justamente o que precisa de exceção
-- explícita pras nove colunas novas.
--
-- A GUARDA DEIXA DE SER "a linha congela depois do carimbo" E PASSA A SER **TRÊS CARIMBOS
-- INDEPENDENTES, CADA UM DE MÃO ÚNICA**:
--
--   ┌─────────────┬──────────────────────────────────────┬───────────────────────────────┐
--   │ Grupo       │ Colunas mutáveis                     │ Só enquanto                   │
--   ├─────────────┼──────────────────────────────────────┼───────────────────────────────┤
--   │ A aplicado  │ minimo_aplicado, compre_por_aplicado,│ aplicado_em IS NULL           │
--   │             │ aplicado_em                          │ E repasse_id IS NOT NULL      │
--   │ B desfecho  │ desfecho_*  (por PREFIXO)            │ desfecho_congelado_em IS NULL │
--   │ C vínculo   │ repasse_id, só valor → NULL          │ (sempre, num sentido só)      │
--   │ resto       │ —                                    │ imutável SEMPRE, incl. futura │
--   └─────────────┴──────────────────────────────────────┴───────────────────────────────┘
--
-- TRÊS DETALHES QUE PRECISAM ESTAR NO CÓDIGO, e não só na tabela acima:
--
--   1. `repasse_id` é GRUPO PRÓPRIO (C), **não** parte do grupo B — e essa é a diferença
--      entre funcionar e não funcionar. Se `repasse_id` fosse governado pela condição do
--      grupo B ("só enquanto `desfecho_congelado_em IS NULL`"), o congelamento da §6 FECHARIA
--      o grupo B, e o UPDATE seguinte da FK — que roda DEPOIS — seria REJEITADO. O DELETE
--      abortaria de novo, agora pelo caminho novo. A §13.7 já dá a regra na forma correta,
--      no primeiro bullet: mutável **em um único sentido**, `NOT NULL → NULL`. Nunca o
--      inverso, nunca pra outro `id`. **Órfão não se readota** — o ciclo acabou, e reconectar
--      seria inventar um vínculo.
--   2. **Depois de órfã, não há mais carimbo de aplicado.** É a cláusula `repasse_id IS NOT
--      NULL` no grupo A. Carimbar "aplicado" num carro que não existe mais é gravar uma
--      decisão que não aconteceu.
--   3. Uma linha pode ser CONGELADA SEM NUNCA TER SIDO CARIMBADA (`aplicado_em IS NULL`): é
--      o carro cujo repasse foi removido ENTRE a sugestão e a aplicação. Estado legítimo,
--      mesma família do "sugeriu e não aplicou" da §3 — **é sinal, não lixo**. O
--      `rep_prec_carimbo_coerente_chk` (030:219-231) continua valendo intocado sobre o trio
--      do aplicado, e nada aqui o toca.
--
-- POR QUE O GRUPO B É DESCOBERTO POR PREFIXO E NÃO POR LISTA FIXA — é a §13.6 regra 3
-- ("nenhuma regra nova que impeça a atualização") transformada em estrutura em vez de
-- disciplina: com lista fixa, a próxima migration que acrescentasse uma `desfecho_xxx` e
-- esquecesse de editar este array faria o DELETE DO USUÁRIO VOLTAR A ABORTAR — exatamente o
-- bug que esta seção existe pra matar, ressuscitado por omissão. O prefixo `desfecho_` PASSA
-- A SER O CONTRATO: quem entra nesse namespace é congelável; todo o resto continua nascendo
-- imutável por padrão, como a 030 quis.
--   ⚠️ O `COALESCE(..., ARRAY[]::TEXT[])` no agregado NÃO é decoração: `jsonb - NULL::text[]`
--   devolve NULL, e `NULL IS DISTINCT FROM NULL` é FALSE — sem ele, um catálogo sem match
--   DESLIGARIA A GUARDA INTEIRA EM SILÊNCIO. Guarda que falha aberta é pior que guarda
--   nenhuma, porque ninguém percebe.
--
-- ⚠️ MUDANÇA DE COMPORTAMENTO EM RELAÇÃO À 030 — registrada porque foi VERIFICADA, e porque
-- quem só ler a 030 vai supor o contrário:
--   A 030 levantava exceção pelo ESTADO (`IF OLD.aplicado_em IS NOT NULL`), sem olhar o que o
--   UPDATE fazia. Aqui a exceção é pela MUDANÇA (`IS DISTINCT FROM`), porque a versão por
--   estado é exatamente a que abortaria o DELETE do usuário (o congelamento e o `SET NULL` da
--   FK chegam com `OLD.aplicado_em IS NOT NULL`). Consequência: um UPDATE que grave em cima
--   VALORES IDÊNTICOS aos que já estão lá passa em silêncio.
--   Isso é ACEITO e é o máximo de fidelidade disponível: o Postgres não expõe a lista do SET
--   ao trigger, só OLD e NEW — "coluna não mencionada" e "coluna mencionada com o mesmo
--   valor" são indistinguíveis. E é INÓCUO por construção: se nada muda, a linha continua
--   byte a byte a mesma, e append-only é sobre ESTADO, não sobre statement.
--   VERIFICADO no projeto `mesa` em 2026-08-12 (transação com ROLLBACK): recarimbar com
--   `aplicado_em` diferente → EXCEPTION; reescrever `minimo_aplicado` numa linha carimbada →
--   EXCEPTION; regravar o mesmo `aplicado_em` → passa, e a linha permanece com o carimbo
--   original. ⚠️ ARMADILHA DE TESTE: `NOW()` é CONSTANTE dentro de uma transação, então
--   `SET aplicado_em = NOW()` duas vezes no mesmo BEGIN cai no caso no-op e NÃO estoura —
--   isso é artefato do teste, não furo da guarda. Testar com timestamp literal (query 6-g).
-- ─────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION repasse_precificacao_guarda_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_desfecho TEXT[];
  v_mutaveis TEXT[];
  v_old      JSONB := to_jsonb(OLD);
  v_new      JSONB := to_jsonb(NEW);
  v_mudou_a  BOOLEAN;
  v_mudou_b  BOOLEAN;
BEGIN
  -- Grupo B por PREFIXO (ver comentário acima). COALESCE obrigatório: sem ele um catálogo
  -- sem match faria `v_mutaveis` virar NULL e a guarda falhar ABERTA.
  SELECT COALESCE(array_agg(a.attname::TEXT), ARRAY[]::TEXT[])
    INTO v_desfecho
    FROM pg_attribute a
   WHERE a.attrelid = TG_RELID
     AND a.attnum > 0
     AND NOT a.attisdropped
     AND a.attname LIKE 'desfecho\_%';

  v_mutaveis := ARRAY['minimo_aplicado','compre_por_aplicado','aplicado_em','repasse_id']
                || v_desfecho;

  -- ── RESTO: imutável sempre, inclusive coluna que ainda não existe ────────────────────
  IF (v_old - v_mutaveis) IS DISTINCT FROM (v_new - v_mutaveis) THEN
    RAISE EXCEPTION
      'repasse_precificacao_sugerida #%: o contexto do momento e imutavel — so o carimbo do aplicado (minimo_aplicado, compre_por_aplicado, aplicado_em), o desfecho (desfecho_*) e a perda do vinculo (repasse_id -> NULL) podem mudar. Grave uma linha NOVA.',
      OLD.id;
  END IF;

  -- ── GRUPO C: `repasse_id` de mão única, valor → NULL ────────────────────────────────
  -- Este ramo é o que deixa a acao `SET NULL` da FK passar DEPOIS do congelamento (§13.7).
  IF NEW.repasse_id IS DISTINCT FROM OLD.repasse_id
     AND NOT (OLD.repasse_id IS NOT NULL AND NEW.repasse_id IS NULL) THEN
    RAISE EXCEPTION
      'repasse_precificacao_sugerida #%: repasse_id so muda de valor para NULL (ciclo removido). Orfao nao se readota: reconectar (% -> %) inventaria um vinculo que nao existe.',
      OLD.id, OLD.repasse_id, NEW.repasse_id;
  END IF;

  -- ── GRUPO A: o carimbo do aplicado ──────────────────────────────────────────────────
  v_mudou_a := NEW.minimo_aplicado     IS DISTINCT FROM OLD.minimo_aplicado
            OR NEW.compre_por_aplicado IS DISTINCT FROM OLD.compre_por_aplicado
            OR NEW.aplicado_em         IS DISTINCT FROM OLD.aplicado_em;

  IF v_mudou_a THEN
    IF OLD.aplicado_em IS NOT NULL THEN
      RAISE EXCEPTION
        'repasse_precificacao_sugerida #%: snapshot ja carimbado como aplicado em % — o carimbo e de mao unica, grave uma linha NOVA.',
        OLD.id, OLD.aplicado_em;
    END IF;
    IF OLD.repasse_id IS NULL THEN
      RAISE EXCEPTION
        'repasse_precificacao_sugerida #%: linha orfa (ciclo de repasse removido em %) nao recebe mais carimbo de aplicado — a decisao nao aconteceu.',
        OLD.id, OLD.desfecho_congelado_em;
    END IF;
  END IF;

  -- ── GRUPO B: o desfecho ─────────────────────────────────────────────────────────────
  SELECT COALESCE(bool_or(v_old -> k IS DISTINCT FROM v_new -> k), FALSE)
    INTO v_mudou_b
    FROM unnest(v_desfecho) AS k;

  IF v_mudou_b AND OLD.desfecho_congelado_em IS NOT NULL THEN
    RAISE EXCEPTION
      'repasse_precificacao_sugerida #%: desfecho ja congelado em % — o congelamento e de mao unica e acontece uma vez so, no instante da perda.',
      OLD.id, OLD.desfecho_congelado_em;
  END IF;

  RETURN NEW;
END;
$$;

-- Recriado por higiene/idempotência. A função trocou de corpo, não de assinatura nem de
-- nome — o trigger da 030 continuaria válido, mas recriar deixa o arquivo autossuficiente
-- num banco onde só a 035 rode.
DROP TRIGGER IF EXISTS trg_rep_prec_append_only ON repasse_precificacao_sugerida;
CREATE TRIGGER trg_rep_prec_append_only
  BEFORE UPDATE ON repasse_precificacao_sugerida
  FOR EACH ROW EXECUTE FUNCTION repasse_precificacao_guarda_append_only();


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 6. O CONGELAMENTO — trigger `BEFORE DELETE` em `repasses`
-- =====================================================================================
-- `BEFORE` É OBRIGATÓRIO, não estilo: a ação `SET NULL` da FK roda DEPOIS do delete, e a
-- partir dali não há mais como achar as linhas (o `WHERE repasse_id = OLD.id` não casa mais).
-- `BEFORE DELETE` também é o que garante que `repasse_gastos` AINDA EXISTE quando somamos:
-- o CASCADE daquela FK (008:61) é ação RI pós-statement, igual à nossa.
--
-- ⚠️ §13.6, REGRA 2 — O TRIGGER TEM QUE SER TOTAL:
--   • sem `RAISE` de negócio, sem `STRICT`, sem depender de linha em outra tabela existir;
--   • zero snapshots pro repasse ⇒ zero linhas atualizadas ⇒ SUCESSO (é um UPDATE com WHERE,
--     não um SELECT INTO STRICT);
--   • `valor_compra_repasse` NULL ⇒ `desfecho_custo_real` NULL, propagado pela aritmética.
--     Isso é CORRETO e deliberado: "dados incompletos" é o contrato de `calcularCustoReal`
--     (`margem-repasse.ts:70-79`), que retorna null quando a compra é nula e NUNCA cai pra
--     `valor_aquisicao`. Chutar 0 aqui produziria um custo falso — e um custo falso não
--     recalibra régua, mente pra ela.
--
-- A CONTA É A REGRA DE OURO DO PROJETO, sem desvio (`margem-repasse.ts:5-9`):
--     custo_real = valor_compra_repasse + Σ repasse_gastos     — NUNCA `valor_aquisicao`.
-- Soma sobre TODOS os tipos de gasto (não só `auto_avaliar`), igual ao app. Aritmética
-- `numeric` é exata e as parcelas são (12,2): o total fecha centavo-perfect SEM tolerância,
-- e o `ROUND(...,2)` é redundância defensiva, não correção.
--
-- SECURITY DEFINER — e o motivo é a §13.6, não conveniência:
--   O UPDATE nos snapshots está sob RLS. Hoje as duas tabelas têm a MESMA policy
--   (`authenticated_all_access`, `auth.uid() IS NOT NULL`, 005/030:349), então quem pode
--   deletar o repasse pode atualizar o snapshot e um trigger INVOKER funcionaria.
--   O problema é o F7 (RLS multi-tenant, já previsto em 030:340-344): no dia em que os
--   snapshots forem escopados por `criado_por`, um DELETE feito por outro usuário faria o
--   UPDATE do congelamento casar ZERO LINHAS **em silêncio** (RLS filtra, não erra) — e aí a
--   ação `SET NULL` da FK, que é integridade referencial e **NÃO passa por RLS**, produziria
--   uma órfã sem desfecho e o CHECK da §4 abortaria o DELETE do usuário. Falha intermitente,
--   dependente de quem clica, exatamente a classe que a §13.6 proíbe. DEFINER imuniza isso
--   estruturalmente, hoje, por 15 caracteres.
--   Superfície de ataque: nenhuma. Função `RETURNS TRIGGER` não é chamável por RPC (o
--   PostgREST não as expõe) nem por SQL direto ("can only be called as a trigger"), e o
--   corpo só escreve colunas `desfecho_*` de linhas amarradas a `OLD.id`. `search_path`
--   fixo em `public, pg_temp` conforme a nota da 026 sobre funções DEFINER.
--
-- FUROS CONHECIDOS, REGISTRADOS E ACEITOS (escritos aqui pra não serem descobertos do jeito
-- que o bug do CASCADE foi):
--   1. `TRUNCATE repasses` não dispara trigger de linha. Ninguém trunca esta tabela e não há
--      caminho no app que o faça.
--   2. `desfecho_custo_real` é `numeric(12,2)`: overflow acima de R$ 9.999.999.999,99. Só
--      alcançável se a SOMA dos gastos estourar o domínio — a coluna de origem
--      (`repasses.valor_compra_repasse`) tem o mesmo teto e não caberia o valor. Preferi o
--      domínio da ADR a inventar largura; um CAP silencioso seria pior (valor falso).
-- ─────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION repasses_congela_desfecho_nos_snapshots()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_gastos NUMERIC;
  v_custo  NUMERIC;
BEGIN
  SELECT COALESCE(SUM(g.valor), 0) INTO v_gastos
    FROM repasse_gastos g
   WHERE g.repasse_id = OLD.id;

  -- NULL propaga de propósito: compra nula = "dados incompletos", nunca 0.
  v_custo := ROUND(OLD.valor_compra_repasse + v_gastos, 2);

  UPDATE repasse_precificacao_sugerida s
     SET desfecho_congelado_em  = NOW(),          -- instante técnico (028: timestamptz não converte)
         desfecho_status        = OLD.status,
         desfecho_valor_vendido = OLD.valor_vendido,
         desfecho_data_vendido  = OLD.data_vendido,  -- CÓPIA de um date já corrigido pela 028
         desfecho_custo_real    = v_custo,
         desfecho_valor_minimo  = OLD.valor_minimo
   WHERE s.repasse_id = OLD.id
     AND s.desfecho_congelado_em IS NULL;         -- de mão única, e coerente com o guard §5

  RETURN OLD;                                     -- BEFORE DELETE: deixa o DELETE seguir
END;
$$;

DROP TRIGGER IF EXISTS trg_repasses_congela_desfecho ON repasses;
CREATE TRIGGER trg_repasses_congela_desfecho
  BEFORE DELETE ON repasses
  FOR EACH ROW EXECUTE FUNCTION repasses_congela_desfecho_nos_snapshots();


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 7. COMMENTS — inclusive a CORREÇÃO do que a premissa errada contaminou
-- =====================================================================================
-- A §13.1 é explícita: o erro não ficou contido na ADR, ele VAZOU PRO SCHEMA APLICADO
-- (030:270-272). COMMENT errado é PIOR que COMMENT nenhum — quem lê confia e não tem como
-- saber. `COMMENT ON` é sempre sobrescrita: idempotente por construção.
-- (O bloco de comentário do ARQUIVO 030 não dá pra reescrever sem mexer numa migration
--  aplicada; foi acrescentado lá um BANNER apontando pra cá — comentário apenas, zero DDL.)
-- ─────────────────────────────────────────────────────────────────────────────────────

-- 7.1 — A TABELA.
COMMENT ON TABLE repasse_precificacao_sugerida IS
  'Snapshot append-only da sugestao de preco de repasse (aba /precificar), gravado no clique '
  'de "Aplicar". Preserva sugerido x aplicado x contexto do momento pra recalibrar a regua. '
  'NAO substitui repasses.valor_minimo/valor_compre_por, que seguem sendo o campo operacional '
  'governado pelo portal via import. ADR-003 §3. '
  'DESDE A 032: toda leitura de calibracao e POR MODO (coluna modo) — recuperar_tudo e '
  'girar_rapido tem BASES DIFERENTES (custo_real x valor_compra_repasse) e agregar os dois '
  'juntos mistura duas populacoes (§12.6). '
  'DESDE A 035: a linha SOBREVIVE a remocao do repasse. repasse_id vira NULL (ON DELETE SET '
  'NULL) e o desfecho fica congelado nas colunas desfecho_*, junto com a identidade do carro '
  '(placa/chassi/modelo_snapshot, congeladas no insert). Repasses SAO APAGADOS no fluxo '
  'normal — a frase em contrario na 030 estava errada (ADR-003 §13.0). Write-only exceto a '
  'leitura pontual do snapshot mais recente por repasse (C16, §12.8), que filtra por '
  'repasse_id e portanto NUNCA casa orfao — comportamento correto: carro removido nao tem tela.';

-- 7.2 — A COLUNA QUE MUDOU DE SEMÂNTICA.
COMMENT ON COLUMN repasse_precificacao_sugerida.repasse_id IS
  'Ciclo de repasse (repasses.id) — NAO placa/chassi: a mesma placa reaparece num segundo '
  'ciclo, e por isso ela e rotulo (placa_snapshot) e nunca chave. '
  'NULL tem UM significado, fechado: o ciclo foi REMOVIDO do sistema (ON DELETE SET NULL, '
  'migration 035) — nunca "ainda nao sei". Quando e NULL, o desfecho esta congelado nas '
  'colunas desfecho_* e o CHECK rep_prec_orfao_tem_desfecho_chk garante isso. De mao unica: '
  'so muda de valor para NULL; orfao nao se readota.';

COMMENT ON CONSTRAINT rep_prec_repasse_fk ON repasse_precificacao_sugerida IS
  'ON DELETE SET NULL (035). Substitui o ON DELETE CASCADE da 030, que destruia o historico '
  'de calibracao no fluxo de todo dia — com vies correlacionado ao desfecho (ADR-003 §13.2). '
  'RESTRICT foi rejeitado: travaria o fluxo e o contorno do usuario destruiria o dado por '
  'outro caminho.';

COMMENT ON CONSTRAINT rep_prec_orfao_tem_desfecho_chk ON repasse_precificacao_sugerida IS
  'Orfao SEM desfecho e impossivel — invariante de banco, nao convencao (ADR-003 §13.4 ponto 4). '
  'Nunca dispara num DELETE: o trigger BEFORE DELETE de repasses congela o desfecho antes de a '
  'acao SET NULL da FK tocar a linha.';

-- 7.3 — IDENTIDADE (congelada no insert).
COMMENT ON COLUMN repasse_precificacao_sugerida.placa_snapshot IS
  'ROTULO, NUNCA CHAVE. Placa como estava no repasse no instante do "Aplicar" (congelada no '
  'INSERT: protege de edicao posterior do repasse). NAO AGRUPE POR ELA — a mesma placa volta '
  'num segundo ciclo e agrupar misturaria ciclos (030:44-51, que segue valendo). A chave da '
  'recalibracao e repasse_id. Existe pra que a linha orfa ainda diga DE QUE CARRO se tratava. '
  'Pode ser string vazia: repasses.placa e NOT NULL mas aceita "" (carro sem placa legivel) e '
  'um CHECK aqui abortaria o "Aplicar" de um carro que o resto do sistema aceita.';
COMMENT ON COLUMN repasse_precificacao_sugerida.chassi_snapshot IS
  'ROTULO, NUNCA CHAVE — ver placa_snapshot. Chassi como estava no instante do "Aplicar". '
  'Pode ser string vazia (o painel de sumidos testa chassi !== "").';
COMMENT ON COLUMN repasse_precificacao_sugerida.modelo_snapshot IS
  'Modelo como estava no instante do "Aplicar". Mesmo padrao (e mesmo nome) de '
  'lead_interesses.modelo_snapshot (018:69 / migration 033): uma linha sem repasse_id ainda '
  'diz "era a Ranger 3.2 XLT" — degrada o VINCULO, nao o FATO.';

-- 7.4 — DESFECHO (congelado no delete).
COMMENT ON COLUMN repasse_precificacao_sugerida.desfecho_congelado_em IS
  'SINALIZADOR do congelamento: instante (timestamptz/now()) em que o repasse foi APAGADO e o '
  'desfecho foi copiado pra ca pelo trigger trg_repasses_congela_desfecho. NULL = o repasse '
  'ainda existe e o desfecho se le por JOIN (a desnormalizacao acontece SO nos orfaos). '
  'Instante tecnico, nao dia de calendario — a 028 nao converte timestamptz.';
COMMENT ON COLUMN repasse_precificacao_sugerida.desfecho_status IS
  'repasses.status no instante da perda (subido | vendido | nao_vendido | cancelado). '
  'SEM CHECK DE DOMINIO, de proposito (ADR-003 §13.6): validar aqui criaria uma forma de o '
  'DELETE do usuario falhar, e esta coluna guarda o que ERA, nao o que e valido hoje. '
  'E a perna "o que aconteceu" do trio da recalibracao quando o carro ja nao existe.';
COMMENT ON COLUMN repasse_precificacao_sugerida.desfecho_valor_vendido IS
  'repasses.valor_vendido no instante da perda. NULL = nao vendeu (ou nao foi preenchido) — '
  'e o negativo, "sugeriu, anunciou, nao vendeu", e justamente o sinal que diz que a regua '
  'esta alta e que nenhuma outra fonte tem (§13.2). Sem CHECK, por §13.6.';
COMMENT ON COLUMN repasse_precificacao_sugerida.desfecho_data_vendido IS
  '⚠️ EMENDA A §5 DA MIGRATION 030. Aquela secao afirma que esta tabela nao tem NENHUMA coluna '
  '`date`; desde a 035 tem esta, e so esta. A afirmacao vale como PRINCIPIO e o principio esta '
  'intacto: esta coluna e CÓPIA de repasses.data_vendido, um date JA CORRIGIDO pela 028 — '
  'transporta um valor pronto, NAO CALCULA data nenhuma. O contrato "JAMAIS current_date" '
  'continua valendo com forca total (o trigger usa OLD.data_vendido; now() so no '
  'desfecho_congelado_em, que e timestamptz). Se um dia precisar de data derivada no banco, a '
  'conta e public.hoje_brasilia() (helper da 027).';
COMMENT ON COLUMN repasse_precificacao_sugerida.desfecho_custo_real IS
  'valor_compra_repasse + SOMA(repasse_gastos) NO INSTANTE DA PERDA — regra de ouro do projeto '
  '(margem-repasse.ts), NUNCA valor_aquisicao, todos os tipos de gasto. Irrecuperavel de outra '
  'forma: repasse_gastos cascateia junto e some (008:61). Fecha a pergunta que gastos_qtde so '
  'LEVANTA — "o custo estava completo quando a regua rodou?" — comparando com custo_real, que e '
  'o custo da DECISAO. NULL = valor_compra_repasse era nulo: dados incompletos, nunca 0 (chutar '
  '0 produziria um custo falso, que nao recalibra regua, mente pra ela). Sem CHECK, por §13.6.';
COMMENT ON COLUMN repasse_precificacao_sugerida.desfecho_valor_minimo IS
  'repasses.valor_minimo FINAL, no instante da perda. Preserva post-mortem a classificacao da '
  'C16 (§12.8): comparado com minimo_aplicado, diz se o Marcos mudou o preco no portal DEPOIS '
  'de aplicar. Sem ela, some a capacidade de classificar origem em carro removido. '
  'Sem CHECK, por §13.6.';

-- 7.5 — A GUARDA, cujo contrato mudou.
COMMENT ON FUNCTION repasse_precificacao_guarda_append_only() IS
  'Guarda de append-only, REESCRITA pela 035 (ADR-003 §13.7). Tres carimbos independentes, '
  'cada um de mao unica: A) aplicado (so enquanto aplicado_em IS NULL E repasse_id IS NOT NULL); '
  'B) desfecho_* — descoberto por PREFIXO, nao por lista fixa — (so enquanto '
  'desfecho_congelado_em IS NULL); C) repasse_id (so de valor para NULL, SEMPRE — e este '
  'grupo separado e o que permite a acao SET NULL da FK rodar DEPOIS do congelamento sem '
  'abortar o DELETE do usuario). Todo o resto, inclusive coluna futura fora do prefixo '
  'desfecho_, nasce IMUTAVEL.';

COMMENT ON FUNCTION repasses_congela_desfecho_nos_snapshots() IS
  'BEFORE DELETE em repasses (035): copia status/valor_vendido/data_vendido/valor_minimo e o '
  'custo real (compra + SOMA gastos, antes do CASCADE de repasse_gastos) pros snapshots '
  'daquele repasse. BEFORE e obrigatorio — a acao SET NULL da FK roda depois e a partir dali '
  'nao ha como achar as linhas. TOTAL POR CONTRATO (ADR-003 §13.6): nao levanta excecao, nao '
  'depende de linha existir, zero snapshots = sucesso. SECURITY DEFINER pra que RLS (hoje '
  'simetrica, mas escopada por criado_por quando o F7 chegar) nao possa filtrar o congelamento '
  'em silencio e derrubar o DELETE no CHECK do orfao.';


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 8. O QUE FOI VERIFICADO E DELIBERADAMENTE **NÃO** MUDOU
-- =====================================================================================
-- Registrado aqui porque, sem registro, cada um destes vira um "conserto" numa sessão futura
-- — e todos seriam regressões.
--
-- 8.1 RLS: nada a fazer. `authenticated_all_access` (030:349) é FOR ALL sobre a TABELA e
--     cobre as nove colunas novas automaticamente. Recriar a policy aqui seria ruído, e um
--     DROP POLICY desnecessário é uma janela de segundos sem policy à toa. `relrowsecurity`
--     segue `true` (query 1 da §10). O trigger de congelamento é SECURITY DEFINER pelo motivo
--     da §6 — que é sobre o F7 futuro, não sobre a policy de hoje.
--
-- 8.2 ÍNDICE: nenhum novo, e `idx_rep_prec_repasse_recente` FICA. O argumento não-especulativo
--     da 030 §3 sobrevive intacto à troca de ação: com `SET NULL` o DELETE no pai vira um
--     UPDATE na filha (`WHERE repasse_id = $1`), e é a mesma coluna na mesma primeira posição.
--     Índice em `desfecho_congelado_em` ("listar órfãos") seria especulação: dezenas de linhas
--     por ano, seq scan de qualquer jeito. Quando houver volume, EXPLAIN ANALYZE sobre query
--     real — não antecipação.
--
-- 8.3 `rep_prec_carimbo_coerente_chk` (030:219-231) INTOCADO. Ele vale sobre o trio do
--     aplicado e continua correto: uma linha CONGELADA SEM CARIMBO (o carro cujo repasse
--     sumiu entre a sugestão e a aplicação) tem os três NULL e passa. Estado legítimo, mesma
--     família do "sugeriu e não aplicou" — sinal, não lixo (§13.7).
--
-- 8.4 `rep_prec_custo_decomposto_chk` (030:212) INTOCADO, e NÃO ganha irmão em
--     `desfecho_custo_real`. A decomposição do custo da DECISÃO é verificável porque as três
--     parcelas estão na mesma linha; o custo da PERDA chega como total único, no caminho do
--     DELETE, onde §13.6 proíbe constraint. São grandezas de instantes diferentes: comparar
--     `custo_real` com `desfecho_custo_real` é a LEITURA que interessa (query 6 da §10), não
--     uma invariante.
--
-- 8.5 A INVARIANTE DE ORDENAÇÃO (`compre_por >= minimo >= base`) continua FORA do banco
--     (030:147-154, 032 §3). Nada aqui a reintroduz.
--
-- 8.6 032 INTEIRA intocada: `modo`, `rep_prec_modo_chk`, `rep_prec_base_do_modo_positiva_chk`
--     e os COMMENTs de `bateu_piso`/razões efetivas seguem exatamente como estão. `modo` cai
--     no "resto" do guard reescrito e continua nascendo IMUTÁVEL, como a 032 §5.4 previu.
--
-- 8.7 `repasse_gastos`, `repasse_interessados`, `repasse_documentos`, `repasse_fotos` seguem
--     com `ON DELETE CASCADE` (008:61,75,91) e CONTINUAM MORRENDO no DELETE. Esta migration
--     NÃO os salva e não pretende: o que se preserva aqui é a decisão de preço e seu desfecho.
--     `lead_interesses` já foi tratado na 033. Esta é a SEGUNDA tabela filha a precisar de
--     tratamento especial — na TERCEIRA, o defeito deixa de ser da filha e passa a ser a
--     semântica de deleção de `repasses` (gatilho T7, §13.10).
-- ─────────────────────────────────────────────────────────────────────────────────────


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 9. CONTRATO PRO `@dex-dev` — o que muda no app (pequeno, e enumerado)
-- =====================================================================================
--   ⚠️ QUEBRA DE INSERT, e é a única: `placa_snapshot`, `chassi_snapshot` e `modelo_snapshot`
--      são NOT NULL SEM DEFAULT. Todo insert de snapshot passa a mandar os três, copiados do
--      repasse — os três já estão carregados na tela de precificar. Insert sem eles estoura
--      23502 (not-null). Como a tabela tem 0 linhas e a 3.1a não está em produção, o custo é
--      zero AGORA e cresce depois. Aplicar a 035 antes de o insert ser ajustado deixa o botão
--      "Aplicar" quebrado — coordenar as duas coisas.
--   • Copiar de `repasses` (a linha que originou a sugestão), NÃO de estado de UI montado à
--     parte. O banco fecha o NOT NULL, não a VERDADE — mesmo argumento da C19 da 032 §6.
--   • Nada mais muda na ORDEM DE ESCRITA da §3 (snapshot → UPDATE em repasses → carimbo).
--   • LEITORES NÃO MUDAM. `buscarSnapshotRecente` (`precificar-queries.ts:440-448`) filtra
--     `.eq("repasse_id", …)` e `buscarUltimosSnapshotsPrecificacao` (`:511-516`) filtra
--     `.in("repasse_id", …)`: órfão tem NULL e NUNCA casa — comportamento correto, carro
--     removido não tem tela nem alerta de abaixo-do-custo pra desambiguar. Consequência boa:
--     o teto `LIMITE_LINHAS_SNAPSHOT` (2.000) NÃO fica mais apertado por causa dos órfãos, e
--     o sensor de truncamento (`:536-540`) continua medindo o que se propôs a medir.
--   • TIPOS: `repasse_id` vira nullable nos tipos gerados. `SnapshotRow`
--     (`precificar-queries.ts:459-465`) já declara `repasse_id?: number` e já ignora linha
--     sem id (`:543`) — nada a fazer.
--   • `deleteRepasse` / `deleteRepasses` (`queries.ts:557,563`) NÃO MUDAM e NÃO PRECISAM de
--     tratamento de erro novo. O ponto todo da opção 3 é que a remoção continua não falhando.
--   • NENHUMA mudança em `sugerir-preco-repasse.ts`, `margem-repasse.ts`,
--     `origem-abaixo-do-custo.ts`, 028, 029, 032.
-- ─────────────────────────────────────────────────────────────────────────────────────


COMMIT;


-- =====================================================================================
-- 10. VERIFICAÇÃO PÓS-APLICAÇÃO (rodar à mão no SQL editor)
-- =====================================================================================
-- ⚠️ ESTA SUÍTE JÁ FOI RODADA CONTRA O PROJETO `mesa` EM 2026-08-12, ANTES DE APLICAR:
-- todos os statements desta migration foram executados numa transação terminada em ROLLBACK,
-- junto com os casos 5 a 8 abaixo. Resultado: 13 de 13 casos com o comportamento esperado
-- (o 14º, "carimbar 2× com NOW()", acusou falso-positivo e levou à nota da §5 sobre `NOW()`
-- ser constante na transação — a guarda estava certa, o teste é que estava errado).
-- Confirmado depois que o ROLLBACK não deixou rastro: 82 repasses, 0 snapshots, FK ainda
-- `CASCADE`, 0 colunas `desfecho_*`, 2 triggers em `repasses`. **O banco NÃO foi alterado.**
-- Rodar de novo depois de aplicar continua valendo: é o que prova que aplicou.
-- =====================================================================================
-- 1) A FK é SET NULL, `repasse_id` é nullable, e a RLS continua ligada:
--      SELECT conname, confdeltype, pg_get_constraintdef(oid)
--        FROM pg_constraint
--       WHERE conrelid = 'repasse_precificacao_sugerida'::REGCLASS AND contype = 'f';
--      -- esperado: 1 linha | rep_prec_repasse_fk | n | ... ON DELETE SET NULL
--      SELECT column_name, is_nullable FROM information_schema.columns
--       WHERE table_name = 'repasse_precificacao_sugerida' AND column_name = 'repasse_id';
--      -- esperado: repasse_id | YES
--      SELECT relrowsecurity FROM pg_class WHERE relname = 'repasse_precificacao_sugerida';
--      -- esperado: true
--
-- 2) As nove colunas novas, com a nulidade certa (identidade NOT NULL, desfecho tudo NULL-able):
--      SELECT column_name, data_type, is_nullable, column_default
--        FROM information_schema.columns
--       WHERE table_name = 'repasse_precificacao_sugerida'
--         AND (column_name LIKE '%\_snapshot' OR column_name LIKE 'desfecho\_%')
--       ORDER BY column_name;
--      -- esperado: 3x *_snapshot text NO NULL · 6x desfecho_* YES NULL
--      --           (desfecho_data_vendido = date, e é a UNICA date da tabela)
--
-- 3) NENHUMA constraint nas colunas de desfecho (ADR-003 §13.6) — esperado: só o CHECK do
--    órfão, e mais nenhum:
--      SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--       WHERE conrelid = 'repasse_precificacao_sugerida'::REGCLASS
--         AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%desfecho%';
--      -- esperado: 1 linha, rep_prec_orfao_tem_desfecho_chk
--
-- 4) IDEMPOTÊNCIA — rodar o arquivo inteiro 2× e conferir que nada duplicou:
--      SELECT count(*) FROM pg_index WHERE indrelid = 'repasse_precificacao_sugerida'::REGCLASS;
--      -- esperado: 2 (PK + idx_rep_prec_repasse_recente) — a 035 NÃO cria índice
--      SELECT count(*) FROM pg_constraint
--       WHERE conrelid = 'repasse_precificacao_sugerida'::REGCLASS AND contype = 'f';
--      -- esperado: 1
--      SELECT tgname FROM pg_trigger WHERE tgrelid = 'repasses'::REGCLASS AND NOT tgisinternal
--       ORDER BY tgname;
--      -- esperado: trg_repasses_atualizado_em, trg_repasses_congela_desfecho,
--      --           trg_repasses_preenche_data_subido
--
-- ─── 5) ⚠️ O CASO QUE MAIS IMPORTA — DELETAR UM REPASSE COM SNAPSHOT APLICADO TEM QUE
--        FUNCIONAR, deixando a linha órfã com desfecho preenchido.
--        Usa um repasse DESCARTÁVEL criado na hora (não toca dado real) e roda inteiro
--        dentro de BEGIN/ROLLBACK. Se qualquer statement estourar, a 035 está errada.
--
--      BEGIN;
--        -- (a) repasse de teste, com o desfecho JÁ preenchido (vendido) e um gasto
--        INSERT INTO repasses (chassi, placa, modelo, status, valor_compra_repasse,
--                              valor_minimo, valor_vendido, data_vendido)
--        VALUES ('CHASSI_TESTE_035', 'TST0350', 'RANGER 3.2 XLT TESTE', 'vendido',
--                80000.00, 85280.00, 88000.00, DATE '2026-08-10')
--        RETURNING id;   -- anote o id; abaixo usamos a busca por placa
--
--        INSERT INTO repasse_gastos (repasse_id, tipo, descricao, valor)
--        SELECT id, 'documentacao', 'Gasto de teste 035', 6850.00
--          FROM repasses WHERE placa = 'TST0350';
--
--        -- (b) snapshot APLICADO (é o caso que o guard antigo abortaria)
--        INSERT INTO repasse_precificacao_sugerida
--          (repasse_id, modo, versao_regua, parametros_regua, minimo_sugerido,
--           compre_por_sugerido, confianca, custo_real, valor_compra_repasse, gastos_total,
--           placa_snapshot, chassi_snapshot, modelo_snapshot,
--           minimo_aplicado, compre_por_aplicado, aplicado_em)
--        SELECT id, 'recuperar_tudo', 'teste_v0__recuperar_tudo',
--               '{"REGUA_MINIMO_PCT":1.066}'::jsonb, 92582.10, 97250.11, 'alta',
--               86850.00, 80000.00, 6850.00,
--               placa, chassi, modelo,
--               92582.10, 97250.11, NOW()
--          FROM repasses WHERE placa = 'TST0350';
--
--        -- (c) O DELETE. TEM QUE PASSAR. (Antes da 035: apagava o snapshot em silêncio.
--        --     Com a 035 sem a §5: abortaria com "snapshot ja carimbado".)
--        DELETE FROM repasses WHERE placa = 'TST0350';
--
--        -- (d) a linha órfã sobreviveu, com desfecho congelado:
--        SELECT repasse_id, placa_snapshot, modelo_snapshot,
--               custo_real, desfecho_custo_real, minimo_aplicado, desfecho_valor_minimo,
--               desfecho_status, desfecho_valor_vendido, desfecho_data_vendido,
--               desfecho_congelado_em IS NOT NULL AS congelou
--          FROM repasse_precificacao_sugerida
--         WHERE versao_regua = 'teste_v0__recuperar_tudo';
--        -- esperado: repasse_id NULL · TST0350 · RANGER 3.2 XLT TESTE
--        --           custo_real 86850.00 · desfecho_custo_real 86850.00  (80.000 + 6.850)
--        --           minimo_aplicado 92582.10 · desfecho_valor_minimo 85280.00
--        --             (diferem de propósito: é a C16 post-mortem — o preço mudou no portal)
--        --           desfecho_status 'vendido' · 88000.00 · 2026-08-10 · congelou = true
--        --           ⚠️ desfecho_data_vendido TEM que sair 2026-08-10, NAO 2026-08-11:
--        --              se sair um dia à frente, o bug de fuso da 028 vazou pro trigger.
--      ROLLBACK;
--
-- 6) O CHECK do órfão e as três mãos-únicas do guard reescrito (esperado: EXCEPTION nas 4):
--      BEGIN;
--        INSERT INTO repasses (chassi, placa, modelo, valor_compra_repasse)
--        VALUES ('CHASSI_TESTE_035B', 'TST0351', 'MODELO TESTE B', 80000.00);
--        INSERT INTO repasse_precificacao_sugerida
--          (repasse_id, modo, versao_regua, parametros_regua, minimo_sugerido,
--           compre_por_sugerido, confianca, custo_real, valor_compra_repasse, gastos_total,
--           placa_snapshot, chassi_snapshot, modelo_snapshot)
--        SELECT id, 'recuperar_tudo', 'teste_v0b', '{"x":1}'::jsonb, 85280.00, 89579.83,
--               'alta', 80000.00, 80000.00, 0, placa, chassi, modelo
--          FROM repasses WHERE placa = 'TST0351';
--
--        -- (a) zerar repasse_id À MÃO, sem congelar -> CHECK do órfão (23514)
--        UPDATE repasse_precificacao_sugerida SET repasse_id = NULL WHERE versao_regua = 'teste_v0b';
--        -- (b) reescrever o contexto -> guard, "contexto do momento e imutavel"
--        UPDATE repasse_precificacao_sugerida SET custo_real = 1 WHERE versao_regua = 'teste_v0b';
--        -- (c) mexer na identidade -> guard (identidade cai no "resto", é imutável)
--        UPDATE repasse_precificacao_sugerida SET placa_snapshot = 'XXX0000' WHERE versao_regua = 'teste_v0b';
--        -- (d) readotar um órfão: delete primeiro, depois tentar reconectar -> guard, grupo C
--        DELETE FROM repasses WHERE placa = 'TST0351';
--        UPDATE repasse_precificacao_sugerida
--           SET repasse_id = (SELECT id FROM repasses ORDER BY id LIMIT 1)
--         WHERE versao_regua = 'teste_v0b';
--        -- (e) carimbar "aplicado" numa órfã -> guard, grupo A
--        UPDATE repasse_precificacao_sugerida
--           SET minimo_aplicado = 1, compre_por_aplicado = 2, aplicado_em = NOW()
--         WHERE versao_regua = 'teste_v0b';
--        -- (f) reescrever o desfecho já congelado -> guard, grupo B
--        UPDATE repasse_precificacao_sugerida SET desfecho_status = 'vendido'
--         WHERE versao_regua = 'teste_v0b';
--
--        -- (g) CARIMBAR DUAS VEZES. ⚠️ USE TIMESTAMP LITERAL, NUNCA `NOW()` DUAS VEZES:
--        --     `NOW()` é CONSTANTE dentro da transação, então o 2º UPDATE viraria um no-op
--        --     e passaria sem erro — dando um falso "a guarda não funciona". Ver §5.
--        INSERT INTO repasses (chassi, placa, modelo, valor_compra_repasse)
--        VALUES ('CHASSI_TESTE_035E', 'TST0354', 'MODELO TESTE E', 80000.00);
--        INSERT INTO repasse_precificacao_sugerida
--          (repasse_id, modo, versao_regua, parametros_regua, minimo_sugerido,
--           compre_por_sugerido, confianca, custo_real, valor_compra_repasse, gastos_total,
--           placa_snapshot, chassi_snapshot, modelo_snapshot,
--           minimo_aplicado, compre_por_aplicado, aplicado_em)
--        SELECT id, 'recuperar_tudo', 'teste_v0e', '{"x":1}'::jsonb, 85280.00, 89579.83,
--               'alta', 80000.00, 80000.00, 0, placa, chassi, modelo,
--               85280.00, 89579.83, TIMESTAMPTZ '2026-08-12 10:00:00-03'
--          FROM repasses WHERE placa = 'TST0354';
--        UPDATE repasse_precificacao_sugerida
--           SET aplicado_em = TIMESTAMPTZ '2026-08-12 11:00:00-03' WHERE versao_regua = 'teste_v0e';
--        -- (h) reescrever o VALOR aplicado numa linha já carimbada -> guard, grupo A
--        UPDATE repasse_precificacao_sugerida SET minimo_aplicado = 999 WHERE versao_regua = 'teste_v0e';
--      ROLLBACK;
--
-- 7) O caminho "congelada sem nunca ter sido carimbada" é LEGÍTIMO e passa (§13.7 detalhe 3)
--    — é o carro cujo repasse sumiu ENTRE a sugestão e a aplicação:
--      BEGIN;
--        INSERT INTO repasses (chassi, placa, modelo, valor_compra_repasse, status)
--        VALUES ('CHASSI_TESTE_035C', 'TST0352', 'MODELO TESTE C', 80000.00, 'nao_vendido');
--        INSERT INTO repasse_precificacao_sugerida
--          (repasse_id, modo, versao_regua, parametros_regua, minimo_sugerido,
--           compre_por_sugerido, confianca, custo_real, valor_compra_repasse, gastos_total,
--           placa_snapshot, chassi_snapshot, modelo_snapshot)
--        SELECT id, 'recuperar_tudo', 'teste_v0c', '{"x":1}'::jsonb, 85280.00, 89579.83,
--               'alta', 80000.00, 80000.00, 0, placa, chassi, modelo
--          FROM repasses WHERE placa = 'TST0352';
--        DELETE FROM repasses WHERE placa = 'TST0352';   -- TEM que passar
--        SELECT repasse_id, aplicado_em, desfecho_status, desfecho_custo_real
--          FROM repasse_precificacao_sugerida WHERE versao_regua = 'teste_v0c';
--        -- esperado: NULL | NULL | nao_vendido | 80000.00  (sinal, não lixo)
--      ROLLBACK;
--
-- 8) DELETE de repasse SEM NENHUM snapshot continua funcionando (trigger total, §13.6 regra 2):
--      BEGIN;
--        INSERT INTO repasses (chassi, placa, modelo) VALUES ('CHASSI_TESTE_035D','TST0353','MODELO D');
--        DELETE FROM repasses WHERE placa = 'TST0353';   -- 0 linhas atualizadas = sucesso
--      ROLLBACK;
--
-- 9) A LEITURA que tudo isto existe pra permitir — o trio completo, vivos e órfãos juntos,
--    sem UNION e sem tabela-arquivo (que é o defeito da opção 4 que a §13.3 rejeitou):
--      SELECT s.modo,
--             count(*)                                              AS n,
--             count(*) FILTER (WHERE s.repasse_id IS NULL)           AS orfaos,
--             count(*) FILTER (WHERE COALESCE(r.valor_vendido, s.desfecho_valor_vendido)
--                                    IS NOT NULL)                    AS vendeu,
--             round(avg(COALESCE(r.valor_vendido, s.desfecho_valor_vendido)
--                       - COALESCE(s.desfecho_custo_real, s.custo_real)), 2) AS margem_media
--        FROM repasse_precificacao_sugerida s
--        LEFT JOIN repasses r ON r.id = s.repasse_id
--       WHERE s.aplicado_em IS NOT NULL
--       GROUP BY s.modo ORDER BY s.modo;
--      -- hoje: 0 linhas. A query existe pra provar que a forma dos dados FECHA — o desfecho
--      -- se lê por JOIN no vivo e por coluna no órfão, com o mesmo COALESCE.
--
-- 10) Sanidade: nenhuma linha órfã sem desfecho jamais (o CHECK garante, isto é o cinto):
--      SELECT count(*) FROM repasse_precificacao_sugerida
--       WHERE repasse_id IS NULL AND desfecho_congelado_em IS NULL;
--      -- esperado: 0, hoje e sempre
-- =====================================================================================
-- FIM
-- =====================================================================================
