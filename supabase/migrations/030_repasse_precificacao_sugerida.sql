-- =====================================================================================
-- ⚠️⚠️  ERRATA — LEIA ANTES DE CONFIAR NESTE ARQUIVO  ⚠️⚠️
-- =====================================================================================
-- O `ON DELETE CASCADE` da linha 61 e a justificativa dele nas linhas 270-272 ESTÃO
-- ERRADOS. A frase "`repasses` na prática muda de status em vez de ser apagada" era FALSA
-- JÁ QUANDO FOI ESCRITA: repasses são apagados por DELETE físico no fluxo de todo dia
-- (`queries.ts:557,563` ← `RepassesLista.tsx:440,464`, e o painel de sumidos do arquivo AA).
-- O CASCADE não protegia um cenário futuro — ele destruiria, todo dia, o único dado que
-- esta tabela existe pra guardar, e com viés correlacionado ao desfecho (ADR-003 §13.2).
--
-- CORRIGIDO PELA **MIGRATION 035** (`035_snapshot_sobrevive_remocao_repasse.sql`):
--   • a FK virou `ON DELETE SET NULL` (constraint `rep_prec_repasse_fk`);
--   • a tabela ganhou identidade do carro (`*_snapshot`) e desfecho congelado (`desfecho_*`);
--   • a guarda de append-only da §4 (linhas 278-306) FOI REESCRITA — a versão abaixo
--     abortaria o DELETE do usuário. NÃO a use como referência.
-- Onde este arquivo e a 035 discordarem, **A 035 VENCE**. Nada foi apagado daqui de
-- propósito: o erro fica visível porque a lição (ADR-003 §13.1 — COMMENT errado é pior que
-- COMMENT nenhum) é tão parte do registro quanto a correção.
-- =====================================================================================

-- Navesa Mesa — Migration 030: snapshot da sugestão de preço de repasse
-- =====================================================================================
-- Implementa a §3 da ADR-003 (`docs/design/adr-003-persistencia-e-derivacao-da-sugestao-
-- de-preco.md`). Story 3.1 (aba `/precificar`).
--
-- O QUE ESTA TABELA É
--   Uma linha por CLIQUE EM "APLICAR" na aba `/precificar` — não por consulta de placa.
--   Ela guarda o trio que recalibra a régua: o que o sistema SUGERIU × o que o Marcos
--   APLICOU × (mais tarde, por join com `repasses`) o que VENDEU.
--
-- POR QUE ELA PRECISA EXISTIR (ADR-003 §2.3) — é o único motivo que justifica uma tabela
-- a mais num sistema de um usuário:
--   `custo_real` MUDA DEPOIS. Gastos entram tarde, e o import por texto faz DELETE
--   incondicional dos gastos `tipo='auto_avaliar'`. Seis meses depois não existe forma de
--   reconstruir qual era o custo no instante em que a régua foi aplicada — logo não existe
--   forma de responder "a sugestão acertou?". O dado é IRRECUPERÁVEL se não for capturado
--   aqui, na hora. É isso que separa esta tabela do `valor_web` (latente mas reimportável,
--   ADR-002 §2): latente e recuperável ≠ latente e perdido pra sempre.
--
-- O QUE ELA NÃO É
--   ❌ NÃO substitui `repasses.valor_minimo` / `repasses.valor_compre_por`. Esses continuam
--      sendo o CAMPO OPERACIONAL, governado pelo portal via import (025/028 texto, 029
--      arquivo). A ADR-002 §4.1 continua de pé na íntegra: o import escrever por cima é
--      CONVERGÊNCIA (substitui a intenção pelo fato), não perda. Esta migration NÃO TOCA
--      em nenhuma coluna, função, trigger ou policy existente.
--   ❌ NÃO tem leitor ainda. Nasce write-only, por decisão explícita da ADR-003 §3.4.
--      A tela de histórico é story futura, quando houver n suficiente pra recalibrar.
--   ❌ NÃO reusa `reprecificacao_sugerida` (003), apesar de herdar o estilo dela.
--      Três impedimentos concretos (ADR-003 §2.4): o CHECK `^diagnostico_v[0-9]+$` em
--      `versao_formula` (003:71); o índice único `uniq_reprec_pendente` por `chassi`
--      (003:103-105), que faria uma sugestão de repasse COLIDIR com uma de varejo do mesmo
--      carro; e `preco_sugerido` ser UM preço, quando aqui são DOIS.
--
-- IDEMPOTENTE: CREATE TABLE IF NOT EXISTS · constraints nomeadas em DO block ·
--   CREATE INDEX IF NOT EXISTS · CREATE OR REPLACE FUNCTION · DROP TRIGGER/POLICY
--   IF EXISTS. Roda 2× sem erro. Não dropa nada, não faz backfill (não há o que backfillar:
--   o passado desta tabela não existe e não pode ser inventado).
-- =====================================================================================


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 1. TABELA
-- =====================================================================================
-- CHAVE / VÍNCULO — `repasse_id`, NUNCA placa nem chassi
--   Repasse tem identidade POR CICLO: a mesma placa volta num segundo ciclo de repasse
--   (carro que não vendeu, saiu, voltou), e o índice `repasses_chassi_subido_uniq` (009) é
--   PARCIAL (`where status = 'subido'`) justamente pra permitir isso. Placa/chassi
--   identificam o CARRO; `repasses.id` identifica a DECISÃO DAQUELE CICLO — que é a
--   granularidade da recalibração ("essa sugestão, naquele anúncio, acertou?").
--   Denormalizar placa aqui seria convidar a agregação errada. `ON DELETE CASCADE`
--   conforme ADR-003 §3: sem repasse não há sugestão órfã pra interpretar.
--
-- SEM ÍNDICE ÚNICO. Múltiplos snapshots por repasse são o PONTO, não um defeito:
--   `qtde_anuncios > 1` (carro reanunciado) é exatamente o caso que mais ensina, e é o
--   caso que a opção 3 da ADR-003 §3 (colunas em `repasses`) perdia. É aqui que a
--   diferença pra 003 fica operacional — lá o único parcial impede 2 sugestões abertas;
--   aqui a segunda sugestão É o dado.
-- ─────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS repasse_precificacao_sugerida (
  id                       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  repasse_id               BIGINT NOT NULL REFERENCES repasses(id) ON DELETE CASCADE,

  -- ── Identidade do evento ──────────────────────────────────────────────────────────
  -- `criado_em` é INSTANTE TÉCNICO (timestamptz/now()), não dia de calendário. A
  -- migration 028 é explícita: `now()`/timestamptz NÃO se converte pro fuso de Brasília —
  -- converter seria o bug ao contrário. Ver §5 desta migration: esta tabela não tem
  -- NENHUMA coluna `date`, e isso é decisão, não esquecimento.
  criado_em                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Quem decidiu. NULL hoje sob `service_role` (sem sessão). Existe desde já por causa do
  -- F7 (RLS multi-tenant, backlog): adicionar autoria DEPOIS obrigaria a backfillar linhas
  -- cuja autoria já se perdeu — a mesma classe de dano irrecuperável que esta tabela existe
  -- pra evitar. Uma coluna nullable agora custa nada; um backfill impossível custa o dado.
  criado_por               UUID DEFAULT auth.uid(),

  -- ── A régua usada ─────────────────────────────────────────────────────────────────
  -- String LIVRE, deliberadamente sem o CHECK `^diagnostico_v[0-9]+$` da 003 (003:71):
  -- aquele formato é do motor de varejo e não descreve esta régua.
  versao_regua             TEXT NOT NULL,
  -- OS VALORES das constantes vigentes no instante da decisão — não só o nome da versão.
  -- Razão: a AC10 torna as constantes EDITÁVEIS À MÃO. Uma edição sem bump de
  -- `versao_regua` faz o nome mentir, e o nome é justamente o que a recalibração usaria pra
  -- agrupar. Os números não mentem. Esperado (contrato do app, não do banco):
  --   {"REGUA_MINIMO_PCT":1.066,"RAZAO_MINIMO_SOBRE_COMPRE_POR":0.952,
  --    "REGUA_COMPRE_POR_PCT":1.1197,"TETO_REF_AA_PCT":1.05,"PISO_PCT":1.0}
  parametros_regua         JSONB NOT NULL,

  -- ── O que o MOTOR sugeriu ─────────────────────────────────────────────────────────
  minimo_sugerido          NUMERIC(12,2) NOT NULL CHECK (minimo_sugerido     >= 0),
  compre_por_sugerido      NUMERIC(12,2) NOT NULL CHECK (compre_por_sugerido >= 0),
  -- RAZÃO sobre `custo_real`, já DEPOIS dos ajustes e DEPOIS do clamp do piso —
  -- 1.066000 = 106,60% do custo. É razão, NÃO prêmio, NÃO percentual inteiro.
  -- Nomeadas `_razao_` de propósito: a própria ADR-003 §8 registra que "razão 96,3%" e
  -- "prêmio 3,85%" já foram trocadas uma pela outra na story. Nome que diz qual é a
  -- grandeza custa 6 caracteres e mata a ambiguidade na origem.
  minimo_razao_efetiva     NUMERIC(9,6) CHECK (minimo_razao_efetiva     >= 0),
  compre_por_razao_efetiva NUMERIC(9,6) CHECK (compre_por_razao_efetiva >= 0),
  -- AC12: a sugestão travou no piso de custo (não havia espaço pra desconto).
  bateu_piso               BOOLEAN NOT NULL DEFAULT FALSE,
  -- AC13/14/15. 'media' é reservado e hoje NÃO é emitido pelo motor (três níveis apenas):
  -- está no CHECK porque um nível a mais aceito custa zero, e um nível a menos custa uma
  -- migration no meio de um clique de "Aplicar" que aborta (ADR-003 §3, falha parcial).
  confianca                TEXT NOT NULL,
  justificativa            TEXT,                                   -- AC17, pt-BR
  alertas                  JSONB NOT NULL DEFAULT '[]'::JSONB,     -- AC17, string[]

  -- ── O CONTEXTO DO MOMENTO — a razão de ser da tabela (ADR-003 §2.3) ───────────────
  -- `custo_real` é NOT NULL porque sem custo não há sugestão (AC28: custo nulo ⇒ o motor
  -- não sugere). Linha sem custo seria linha sem poder de calibrar — lixo com aparência
  -- de dado.
  custo_real               NUMERIC(12,2) NOT NULL CHECK (custo_real           >= 0),
  -- DECOMPOSTO, não só o total: gastos entram tarde e o import por texto DELETA os gastos
  -- `auto_avaliar`. Guardar as duas parcelas permite saber, depois, se o custo daquele
  -- instante estava completo ou ainda ia crescer.
  valor_compra_repasse     NUMERIC(12,2) NOT NULL CHECK (valor_compra_repasse >= 0),
  gastos_total             NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (gastos_total >= 0),
  -- Quantas LINHAS de gasto existiam. 0 gastos num carro que depois teve 3 é o sinal mais
  -- direto de "esse custo estava incompleto quando a régua rodou".
  gastos_qtde              INTEGER NOT NULL DEFAULT 0 CHECK (gastos_qtde >= 0),
  -- Referências COMO ESTAVAM. Nullable de propósito: ausência é dado (AC14/AC15 degradam
  -- a confiança e emitem alerta). Nunca chutar.
  valor_auto_avaliar       NUMERIC(12,2) CHECK (valor_auto_avaliar >= 0),
  valor_fipe               NUMERIC(12,2) CHECK (valor_fipe         >= 0),
  km                       INTEGER CHECK (km              >= 0),
  dias_no_repasse          INTEGER CHECK (dias_no_repasse >= 0),
  qtde_anuncios            INTEGER CHECK (qtde_anuncios   >= 0),

  -- ── O que foi de fato APLICADO ────────────────────────────────────────────────────
  -- Colunas SEPARADAS das sugeridas porque a sugestão É EDITÁVEL antes de aplicar
  -- (pendência ADR-003 §7.2, respondida pelo Marcos: é editável). A DIFERENÇA entre
  -- sugerido e aplicado é o rótulo mais valioso do conjunto — é ela que diz ONDE a régua
  -- erra, e ela só existe se as duas grandezas ocuparem colunas diferentes.
  -- NULL nos três = "sugeriu e não aplicou". Isso é SINAL, não lixo (ADR-003 §3).
  minimo_aplicado          NUMERIC(12,2) CHECK (minimo_aplicado     >= 0),
  compre_por_aplicado      NUMERIC(12,2) CHECK (compre_por_aplicado >= 0),
  aplicado_em              TIMESTAMPTZ
);


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 2. CONSTRAINTS NOMEADAS
-- =====================================================================================
-- Em DO block (padrão da 003:56-91): CHECK não tem `IF NOT EXISTS` antes do PG 17, e o
-- CREATE TABLE acima é pulado numa 2ª execução. Assim as regras convergem mesmo se a
-- tabela já existir de uma rodada anterior.
--
-- O QUE DELIBERADAMENTE **NÃO** VIRA CONSTRAINT — e por quê:
--   ❌ A invariante `compre_por >= minimo >= custo_real` (ADR-003 §4). A ADR pede
--      "guarda + teste, NÃO bloqueio de fluxo": ela pertence ao motor
--      (`sugerir-preco-repasse.ts`) e à suíte da AC28, não ao banco. Como CHECK ela viraria
--      bloqueio duplamente errado: (a) uma edição desatenta de constante abortaria o clique
--      de "Aplicar" inteiro (ADR-003 §3: snapshot falha ⇒ aborta tudo), e (b) o Marcos PODE
--      legitimamente aplicar um valor fora da ordem — e esse é precisamente o rótulo que a
--      tabela existe pra capturar. Banco que recusa a correção do usuário destrói o dado
--      mais caro do conjunto.
-- ─────────────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  -- 2.1 — Níveis de confiança (AC13/14/15 + 'media' reservado).
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rep_prec_confianca_chk'
      AND conrelid = 'repasse_precificacao_sugerida'::REGCLASS
  ) THEN
    ALTER TABLE repasse_precificacao_sugerida
      ADD CONSTRAINT rep_prec_confianca_chk
      CHECK (confianca IN ('alta','media','baixa','muito_baixa'));
  END IF;

  -- 2.2 — `versao_regua` livre, mas não vazia. Versão em branco não agrupa nada.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rep_prec_versao_nao_vazia_chk'
      AND conrelid = 'repasse_precificacao_sugerida'::REGCLASS
  ) THEN
    ALTER TABLE repasse_precificacao_sugerida
      ADD CONSTRAINT rep_prec_versao_nao_vazia_chk
      CHECK (length(btrim(versao_regua)) BETWEEN 1 AND 60);
  END IF;

  -- 2.3 — Formas dos jsonb. `alertas` é array (AC17: string[]); `parametros_regua` é objeto
  -- NÃO vazio — snapshot de régua sem nenhuma constante dentro é o mesmo que não ter
  -- snapshot, e falha silenciosa aqui só aparece na recalibração, tarde demais.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rep_prec_jsonb_forma_chk'
      AND conrelid = 'repasse_precificacao_sugerida'::REGCLASS
  ) THEN
    ALTER TABLE repasse_precificacao_sugerida
      ADD CONSTRAINT rep_prec_jsonb_forma_chk
      CHECK (
        jsonb_typeof(alertas) = 'array'
        AND jsonb_typeof(parametros_regua) = 'object'
        AND parametros_regua <> '{}'::JSONB
      );
  END IF;

  -- 2.4 — DECOMPOSIÇÃO DO CUSTO, centavo-perfect.
  -- `custo_real = valor_compra_repasse + gastos_total` (regra de ouro do projeto,
  -- `margem-repasse.ts:71-81` — NUNCA `valor_aquisicao`). Aritmética `numeric` é exata e as
  -- três colunas são (12,2), então a identidade fecha SEM tolerância. É proposital: a
  -- AGENTS.md §4 trata R$ 0,01 de divergência como bug CRÍTICO, e este CHECK é o lugar mais
  -- barato pra esse bug aparecer. Se ele disparar, o bug é o total enviado pelo app, não a
  -- constraint. Contrato pro `@dex-dev`: mandar `gastos_total = arredondar2(Σ gastos)` e
  -- `custo_real = arredondar2(compra + Σ gastos)` — os mesmos números, não dois cálculos.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rep_prec_custo_decomposto_chk'
      AND conrelid = 'repasse_precificacao_sugerida'::REGCLASS
  ) THEN
    ALTER TABLE repasse_precificacao_sugerida
      ADD CONSTRAINT rep_prec_custo_decomposto_chk
      CHECK (custo_real = valor_compra_repasse + gastos_total);
  END IF;

  -- 2.5 — COERÊNCIA DO CARIMBO: ou os três NULL ("sugeriu e não aplicou"), ou os três
  -- preenchidos. Meio-carimbo (`aplicado_em` sem valores, ou um preço sem o outro) seria
  -- indistinguível de sugestão não aplicada na hora de ler — e a leitura acontece meses
  -- depois, sem ninguém pra lembrar o que houve.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rep_prec_carimbo_coerente_chk'
      AND conrelid = 'repasse_precificacao_sugerida'::REGCLASS
  ) THEN
    ALTER TABLE repasse_precificacao_sugerida
      ADD CONSTRAINT rep_prec_carimbo_coerente_chk
      CHECK (
        (aplicado_em IS NULL     AND minimo_aplicado IS NULL     AND compre_por_aplicado IS NULL)
        OR
        (aplicado_em IS NOT NULL AND minimo_aplicado IS NOT NULL AND compre_por_aplicado IS NOT NULL)
      );
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 3. ÍNDICE — um só, e por escolha
-- =====================================================================================
-- `(repasse_id, criado_em DESC)` cobre os dois acessos que existem de verdade:
--   1. O `ON DELETE CASCADE`. FK sem índice na coluna filha faz o Postgres varrer a tabela
--      inteira a cada DELETE no pai. `repasse_id` na primeira posição resolve — é o motivo
--      NÃO-especulativo deste índice.
--   2. A leitura da story futura ("histórico daquele carro, mais recente primeiro") e o
--      join sugerido × aplicado × vendido contra `repasses`.
--
-- Nenhum outro índice, deliberadamente: a tabela cresce ~1 linha por clique em "Aplicar"
-- (ordem de dezenas por ano, com ~60 repasses ativos). Numa tabela de poucas páginas o
-- planner faz seq scan de qualquer jeito — índice extra ali é só custo de escrita e
-- manutenção fingindo ser performance. Quando a tela de leitura chegar e a tabela tiver
-- volume, os índices se decidem com `EXPLAIN ANALYZE` em cima de query real, não por
-- antecipação.
-- ─────────────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_rep_prec_repasse_recente
  ON repasse_precificacao_sugerida (repasse_id, criado_em DESC);


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 4. GUARDA DE APPEND-ONLY
-- =====================================================================================
-- A ADR-003 §3 define a ordem de escrita: snapshot (como sugestão) → UPDATE dos campos
-- operacionais em `repasses` → carimbo do aplicado NESTA linha. Ou seja: existe UM UPDATE
-- legítimo por linha, e ele só pode tocar o carimbo.
--
-- Sem guarda, a segunda escrita é uma porta aberta pra reescrever o contexto do momento —
-- que é justamente o que não pode ser reconstruído (§2.3). O trigger converte "append-only"
-- de convenção em invariante.
--
-- A comparação usa `to_jsonb(row) - colunas_mutáveis`: qualquer coluna que venha a ser
-- adicionada no futuro nasce IMUTÁVEL por padrão — que é o default certo pra um snapshot.
--
-- NÃO existe guarda de DELETE, de propósito: bloquear DELETE quebraria o
-- `ON DELETE CASCADE` do `repasse_id` que a própria ADR pediu. Repasse apagado leva seus
-- snapshots junto; `repasses` na prática muda de status em vez de ser apagada.
--   ⚠️ ERRATA — A FRASE ACIMA É FALSA. Ver o banner no topo deste arquivo e a migration 035.
--   Repasses SÃO apagados por DELETE físico no uso corrente; a FK virou `ON DELETE SET NULL`
--   e o desfecho passa a ser congelado por trigger `BEFORE DELETE` em `repasses`. E o trigger
--   logo abaixo FOI REESCRITO pela 035 — a versão deste arquivo abortaria o DELETE do usuário
--   em toda linha já carimbada (ADR-003 §13.7).
--
-- Não há `atualizado_em` nesta tabela (desvio consciente do padrão de 003/008/016/018):
-- aquela coluna serve a tabelas mutáveis. Aqui a única mutação permitida JÁ tem timestamp
-- próprio e semântico — `aplicado_em`. Uma segunda data seria ruído dizendo a mesma coisa.
-- ─────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION repasse_precificacao_guarda_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_mutaveis TEXT[] := ARRAY['minimo_aplicado','compre_por_aplicado','aplicado_em'];
BEGIN
  -- Carimbo é de mão única: NULL → valor, uma vez só.
  IF OLD.aplicado_em IS NOT NULL THEN
    RAISE EXCEPTION
      'repasse_precificacao_sugerida #%: snapshot já carimbado como aplicado em % — a tabela é append-only, grave uma linha NOVA',
      OLD.id, OLD.aplicado_em;
  END IF;

  IF (to_jsonb(OLD) - v_mutaveis) IS DISTINCT FROM (to_jsonb(NEW) - v_mutaveis) THEN
    RAISE EXCEPTION
      'repasse_precificacao_sugerida #%: só o carimbo do aplicado (minimo_aplicado, compre_por_aplicado, aplicado_em) pode ser alterado — o contexto do momento é imutável',
      OLD.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rep_prec_append_only ON repasse_precificacao_sugerida;
CREATE TRIGGER trg_rep_prec_append_only
  BEFORE UPDATE ON repasse_precificacao_sugerida
  FOR EACH ROW EXECUTE FUNCTION repasse_precificacao_guarda_append_only();


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 5. FUSO DE BRASÍLIA — o que esta migration faz a respeito
-- =====================================================================================
-- A migration 028 corrigiu o UTC-shift do projeto inteiro: `SHOW TimeZone` devolve `UTC`,
-- então entre 21h e a meia-noite de Brasília o `current_date` do banco JÁ É AMANHÃ, e toda
-- coluna `date` gravada com ele nasce um dia à frente.
--
-- ESTA TABELA NÃO TEM NENHUMA COLUNA `date`. Isso é decisão de desenho, não omissão:
--   • `criado_em` / `aplicado_em` são INSTANTES técnicos (timestamptz + now()). A 028 §escopo
--     lista `now()`/timestamptz explicitamente entre o que NÃO se converte — o ponto absoluto
--     no tempo é exatamente o que se quer aqui. Converter seria reintroduzir o bug ao contrário.
--   • `dias_no_repasse` entra como INTEIRO JÁ CALCULADO pelo app, e não como data a ser
--     subtraída depois. Sem data de calendário nesta tabela, não há como o bug de fuso
--     nascer aqui.
--
-- CONTRATO PRO `@dex-dev`: se algum dia `dias_no_repasse` passar a ser derivado NO BANCO, a
-- conta é `public.hoje_brasilia() - r.data_subido` (helper da 027) — JAMAIS `current_date`.
-- ─────────────────────────────────────────────────────────────────────────────────────


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 6. RLS — padrão vivo do projeto (008/016/018)
-- =====================================================================================
-- Uma policy `authenticated_all_access` FOR ALL TO authenticated. Single-user no MVP, sem
-- segregação. `anon` (a chave pública embarcada no bundle do navegador) fica de fora por
-- construção: com RLS ligada e NENHUMA policy aplicável ao role `anon`, todo acesso dele é
-- negado — não é preciso REVOKE.
--
-- NÃO adotada a policy `mvp_all_access` `using (true)` da 003:129-131: aquela é a geração
-- antiga e passa por cima do role. As 4 tabelas mais recentes usam a forma abaixo.
--
-- QUANDO O F7 (RLS multi-tenant) CHEGAR — o caminho já está preparado:
--   A coluna `criado_por` (§1) existe desde agora com `DEFAULT auth.uid()`. A policy troca
--   por escopo de dono/equipe sobre ela, SEM backfill de autoria (que seria impossível: não
--   há como descobrir depois quem clicou). Fazer a coluna nascer junto com a tabela é o que
--   torna essa migration futura barata.
-- ─────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE repasse_precificacao_sugerida ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all_access" ON repasse_precificacao_sugerida;
CREATE POLICY "authenticated_all_access" ON repasse_precificacao_sugerida
  FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);


-- ─────────────────────────────────────────────────────────────────────────────────────
-- 7. COMMENTS — a documentação que viaja junto do schema
-- =====================================================================================
COMMENT ON TABLE repasse_precificacao_sugerida IS
  'Snapshot append-only da sugestão de preço de repasse (aba /precificar), gravado no clique '
  'de "Aplicar". Preserva sugerido x aplicado x contexto do momento pra recalibrar a régua '
  '(hoje n=16). NAO substitui repasses.valor_minimo/valor_compre_por, que seguem sendo o '
  'campo operacional governado pelo portal via import. Write-only nesta entrega. ADR-003 §3.';

COMMENT ON COLUMN repasse_precificacao_sugerida.repasse_id IS
  'Ciclo de repasse (repasses.id) — NAO placa/chassi: a mesma placa reaparece num segundo ciclo.';
COMMENT ON COLUMN repasse_precificacao_sugerida.criado_por IS
  'auth.uid() de quem aplicou. NULL sob service_role. Existe desde já pro F7 (RLS multi-tenant): autoria nao e backfillavel.';
COMMENT ON COLUMN repasse_precificacao_sugerida.versao_regua IS
  'Nome livre da versao da regua. Sem o CHECK ^diagnostico_v[0-9]+$ da 003 (aquele e do motor de varejo).';
COMMENT ON COLUMN repasse_precificacao_sugerida.parametros_regua IS
  'VALORES das constantes vigentes no instante (REGUA_MINIMO_PCT, RAZAO_MINIMO_SOBRE_COMPRE_POR, REGUA_COMPRE_POR_PCT, TETO_REF_AA_PCT, PISO_PCT). As constantes sao editaveis a mao (AC10): o nome da versao pode mentir, os numeros nao.';
COMMENT ON COLUMN repasse_precificacao_sugerida.minimo_razao_efetiva IS
  'RAZAO sobre custo_real apos ajustes e apos o clamp do piso: 1.066000 = 106,60%. Nao e premio nem percentual inteiro.';
COMMENT ON COLUMN repasse_precificacao_sugerida.compre_por_razao_efetiva IS
  'RAZAO sobre custo_real apos ajustes e apos o clamp do piso: 1.119700 = 111,97%. Nao e premio nem percentual inteiro.';
COMMENT ON COLUMN repasse_precificacao_sugerida.bateu_piso IS
  'true = a sugestao travou no piso de custo (AC12): nao havia espaco pra desconto.';
COMMENT ON COLUMN repasse_precificacao_sugerida.custo_real IS
  'custo_real = valor_compra_repasse + gastos_total NO INSTANTE DA DECISAO. numeric(12,2) centavo-perfect. NUNCA valor_aquisicao. Congelado aqui porque muda depois (gastos tardios + DELETE dos gastos auto_avaliar pelo import de texto) — ADR-003 §2.3.';
COMMENT ON COLUMN repasse_precificacao_sugerida.gastos_qtde IS
  'Quantas linhas de repasse_gastos existiam no instante. 0 aqui e 3 depois = o custo estava incompleto quando a regua rodou.';
COMMENT ON COLUMN repasse_precificacao_sugerida.minimo_aplicado IS
  'Valor que o Marcos de fato aplicou — pode DIFERIR do sugerido (a sugestao e editavel, ADR-003 §7.2). A diferenca sugerido-aplicado e o rotulo mais valioso da recalibracao. NULL = sugeriu e nao aplicou (sinal, nao lixo).';
COMMENT ON COLUMN repasse_precificacao_sugerida.aplicado_em IS
  'Instante do carimbo (3o passo da ordem de escrita da ADR-003 §3). De mao unica: NULL -> valor, uma vez so (trigger trg_rep_prec_append_only).';


-- =====================================================================================
-- 8. VERIFICAÇÃO PÓS-APLICAÇÃO (rodar à mão no SQL editor)
-- =====================================================================================
-- 1) A tabela existe com RLS ligada e exatamente 1 policy:
--      SELECT relrowsecurity FROM pg_class WHERE relname = 'repasse_precificacao_sugerida';
--      -- esperado: true
--      SELECT policyname, roles, cmd FROM pg_policies
--       WHERE tablename = 'repasse_precificacao_sugerida';
--      -- esperado: 1 linha, authenticated_all_access, {authenticated}, ALL
--
-- 2) As 5 constraints nomeadas existem:
--      SELECT conname FROM pg_constraint
--       WHERE conrelid = 'repasse_precificacao_sugerida'::REGCLASS AND contype = 'c'
--       ORDER BY conname;
--      -- esperado incluir: rep_prec_carimbo_coerente_chk, rep_prec_confianca_chk,
--      --                   rep_prec_custo_decomposto_chk, rep_prec_jsonb_forma_chk,
--      --                   rep_prec_versao_nao_vazia_chk
--
-- 3) IDEMPOTÊNCIA — rodar o arquivo inteiro 2× e conferir que nada duplicou:
--      SELECT count(*) FROM pg_index  WHERE indrelid = 'repasse_precificacao_sugerida'::REGCLASS;
--      -- esperado: 2 (PK + idx_rep_prec_repasse_recente)
--
-- 4) A guarda de append-only barra reescrita de contexto (esperado: EXCEPTION nas duas):
--      BEGIN;
--        INSERT INTO repasse_precificacao_sugerida
--          (repasse_id, versao_regua, parametros_regua, minimo_sugerido, compre_por_sugerido,
--           confianca, custo_real, valor_compra_repasse, gastos_total)
--        SELECT id, 'teste_v0', '{"REGUA_MINIMO_PCT":1.066}'::jsonb, 106600.00, 111970.00,
--               'alta', 100000.00, 100000.00, 0
--          FROM repasses ORDER BY id LIMIT 1
--        RETURNING id;
--        -- (a) mexer no contexto  -> deve estourar
--        UPDATE repasse_precificacao_sugerida SET custo_real = 1 WHERE versao_regua = 'teste_v0';
--        -- (b) carimbar 2x        -> o 1o passa, o 2o deve estourar
--        UPDATE repasse_precificacao_sugerida
--           SET minimo_aplicado = 106600.00, compre_por_aplicado = 111970.00, aplicado_em = NOW()
--         WHERE versao_regua = 'teste_v0';
--        UPDATE repasse_precificacao_sugerida SET aplicado_em = NOW() WHERE versao_regua = 'teste_v0';
--      ROLLBACK;
--
-- 5) A decomposição do custo é obrigatória (esperado: EXCEPTION 23514):
--      BEGIN;
--        INSERT INTO repasse_precificacao_sugerida
--          (repasse_id, versao_regua, parametros_regua, minimo_sugerido, compre_por_sugerido,
--           confianca, custo_real, valor_compra_repasse, gastos_total)
--        SELECT id, 'teste_v0', '{"x":1}'::jsonb, 1, 1, 'alta', 100000.01, 100000.00, 0
--          FROM repasses ORDER BY id LIMIT 1;
--      ROLLBACK;
--
-- 6) Nada foi tocado fora desta tabela (esperado: 0 linhas):
--      SELECT 1 FROM information_schema.columns
--       WHERE table_name = 'repasses' AND column_name LIKE '%sugerid%';
-- =====================================================================================
-- FIM
-- =====================================================================================
