/**
 * Espelho declarativo do contrato de saída das RPCs de sync por ARQUIVO
 * (`sincronizar_repasse_arquivo_auto_avaliar_preview` e `..._auto_avaliar`),
 * migration 029 — Story 2.2 (Fatia 3a), §5 do desenho.
 *
 * ┌─ REGRA DESTE MÓDULO (AC13b) ───────────────────────────────────────────────┐
 * │ A CLASSIFICAÇÃO MORA NO BANCO. Aqui não se reagrupa, não se recalcula      │
 * │ `antes`/`depois`, não se infere `acao` e não se reordena por regra de       │
 * │ negócio própria. Este arquivo só TIPA o que a RPC devolve e traduz código   │
 * │ em rótulo pt-BR. Se preview e tela discordarem, a tela mente sobre o que    │
 * │ vai ser gravado — que é o pior defeito possível numa confirmação.           │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * `patch` NÃO existe nestes tipos DE PROPÓSITO. Ele vem no JSON (é o que a RPC
 * de aplicar consome internamente), mas é interno da RPC: o front renderiza a
 * partir de `campos`. Não tipar é a forma mais barata de garantir isso — não dá
 * pra renderizar o que o tipo não expõe.
 *
 * 100% PURO: sem I/O, sem rede, sem banco. A camada de I/O é
 * `sync-arquivo-auto-avaliar-queries.ts`.
 */

import { formatBRLCents, formatInt } from "@/lib/utils";

// ─── Contrato de saída (§5) ──────────────────────────────────────────────────

export type ModoSync = "preview" | "aplicado";

/** Whitelist de 8 colunas graváveis. `string & {}` mantém legível um código novo do servidor. */
export type CampoSync =
  | "valor_compra_repasse"
  | "valor_minimo"
  | "valor_compre_por"
  | "valor_fipe"
  | "valor_web"
  | "valor_auto_avaliar"
  | "valor_maior_oferta"
  | "qtde_anuncios"
  | (string & {});

/**
 * `preenche` = o campo estava vazio no banco (`antes: null`) e ganha valor.
 * `altera`   = havia um número gravado e ele TROCA. É o que merece atenção.
 */
export type AcaoCampo = "preenche" | "altera" | (string & {});

export type DiffCampo = {
  campo: CampoSync;
  /** null exatamente quando `acao === "preenche"`. */
  antes: number | null;
  depois: number | null;
  acao: AcaoCampo;
};

export type ItemComAlteracao = {
  linha: number;
  placa_norm: string | null;
  repasse_id: number | null;
  modelo: string | null;
  status: string | null;
  /** Só os campos que MUDAM. Campo não observado não aparece — a ausência é a semântica. */
  campos: DiffCampo[];
  /** "o arquivo confirmou estes, iguais ao que está no banco". */
  campos_observados_sem_mudanca: CampoSync[];
};

export type ItemSemAlteracao = {
  linha: number;
  placa_norm: string | null;
  repasse_id: number | null;
  modelo: string | null;
  campos_observados: number;
};

export type MotivoNaoEncontrada = "sem_repasse" | "repasse_inativo" | (string & {});

export type ItemNaoEncontrada = {
  linha: number;
  placa_norm: string | null;
  motivo: MotivoNaoEncontrada;
  /** Só em `repasse_inativo`: o status que travou o match. */
  status_atual: string | null;
};

export type MotivoIgnorada =
  | "placa_invalida"
  | "placa_duplicada_no_arquivo"
  | "valor_compra_zerado"
  | "nenhum_campo_observado"
  | "repasse_ambiguo"
  | (string & {});

export type ItemIgnorada = {
  linha: number;
  placa_norm: string | null;
  motivo: MotivoIgnorada;
  /** Só em `repasse_ambiguo`: os ids que o usuário precisa desempatar. */
  repasse_ids: number[] | null;
};

export type ResumoSync = {
  linhas_no_arquivo: number;
  sem_alteracao: number;
  com_alteracao: number;
  nao_encontradas: number;
  ignoradas: number;
  campos_a_alterar: number;
  /** 0 no preview; ROW_COUNT real no aplicado. */
  linhas_gravadas: number;
};

export type RelatorioSync = {
  versao: number;
  modo: ModoSync;
  /** Instante técnico de geração, já em -03:00 (não é data de calendário). */
  gerado_em: string | null;
  /** Arrays truncados acima de 500 linhas. `com_alteracao` NUNCA é truncado. */
  truncado: boolean;
  resumo: ResumoSync;
  com_alteracao: ItemComAlteracao[];
  sem_alteracao: ItemSemAlteracao[];
  nao_encontradas: ItemNaoEncontrada[];
  ignoradas: ItemIgnorada[];
};

// ─── Leitura defensiva do JSONB (sem `any`) ──────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** JSON number | numeric-como-string do PostgREST → number finito | null. */
function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function int(v: unknown): number {
  const n = num(v);
  return n == null ? 0 : Math.trunc(n);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function itens(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter(isRecord) : [];
}

function codigo(v: unknown, fallback: string): string {
  return typeof v === "string" && v !== "" ? v : fallback;
}

function listaCampos(v: unknown): CampoSync[] {
  return Array.isArray(v) ? v.filter((c): c is string => typeof c === "string") : [];
}

function listaIds(v: unknown): number[] | null {
  if (!Array.isArray(v)) return null;
  const ids = v.map(num).filter((n): n is number => n != null);
  return ids.length > 0 ? ids : null;
}

function lerDiff(raw: Record<string, unknown>): DiffCampo {
  return {
    campo: codigo(raw.campo, "?"),
    antes: num(raw.antes),
    depois: num(raw.depois),
    acao: codigo(raw.acao, "altera"),
  };
}

function lerResumo(v: unknown): ResumoSync {
  const r = isRecord(v) ? v : {};
  return {
    linhas_no_arquivo: int(r.linhas_no_arquivo),
    sem_alteracao: int(r.sem_alteracao),
    com_alteracao: int(r.com_alteracao),
    nao_encontradas: int(r.nao_encontradas),
    ignoradas: int(r.ignoradas),
    campos_a_alterar: int(r.campos_a_alterar),
    linhas_gravadas: int(r.linhas_gravadas),
  };
}

/**
 * JSONB cru da RPC → `RelatorioSync`. Nunca lança: chave faltando vira default
 * neutro, porque uma tela de conferência que estoura no meio é pior que uma que
 * mostra zero. `patch` é descartado aqui, e é aqui que ele para de existir.
 */
export function lerRelatorioSync(raw: unknown): RelatorioSync {
  const r = isRecord(raw) ? raw : {};
  return {
    versao: int(r.versao),
    modo: r.modo === "aplicado" ? "aplicado" : "preview",
    gerado_em: str(r.gerado_em),
    truncado: r.truncado === true,
    resumo: lerResumo(r.resumo),
    com_alteracao: itens(r.com_alteracao).map((e) => ({
      linha: int(e.linha),
      placa_norm: str(e.placa_norm),
      repasse_id: num(e.repasse_id),
      modelo: str(e.modelo),
      status: str(e.status),
      campos: itens(e.campos).map(lerDiff),
      campos_observados_sem_mudanca: listaCampos(e.campos_observados_sem_mudanca),
    })),
    sem_alteracao: itens(r.sem_alteracao).map((e) => ({
      linha: int(e.linha),
      placa_norm: str(e.placa_norm),
      repasse_id: num(e.repasse_id),
      modelo: str(e.modelo),
      campos_observados: int(e.campos_observados),
    })),
    nao_encontradas: itens(r.nao_encontradas).map((e) => ({
      linha: int(e.linha),
      placa_norm: str(e.placa_norm),
      motivo: codigo(e.motivo, "sem_repasse"),
      status_atual: str(e.status_atual),
    })),
    ignoradas: itens(r.ignoradas).map((e) => ({
      linha: int(e.linha),
      placa_norm: str(e.placa_norm),
      motivo: codigo(e.motivo, "nenhum_campo_observado"),
      repasse_ids: listaIds(e.repasse_ids),
    })),
  };
}

// ─── Rótulos pt-BR ───────────────────────────────────────────────────────────

export const ROTULO_CAMPO_SYNC: Record<string, string> = {
  valor_compra_repasse: "Valor de compra",
  valor_minimo: "Valor mínimo",
  valor_compre_por: "Compre por",
  valor_fipe: "Ref. FIPE",
  valor_web: "Ref. Web",
  valor_auto_avaliar: "Ref. Auto Avaliar",
  valor_maior_oferta: "Maior oferta",
  qtde_anuncios: "Qtde de anúncios",
};

export function rotuloCampo(campo: CampoSync): string {
  return ROTULO_CAMPO_SYNC[campo] ?? campo;
}

export const ROTULO_MOTIVO_NAO_ENCONTRADA: Record<string, string> = {
  sem_repasse: "Não existe repasse pra essa placa — pra criar o carro, use a importação por texto do Auto Avaliar.",
  repasse_inativo: "O carro já saiu do ciclo de repasse — carro fora de oferta não recebe preço de oferta.",
};

export const ROTULO_MOTIVO_IGNORADA: Record<string, string> = {
  placa_invalida: "Placa ilegível ou vazia na linha do arquivo.",
  placa_duplicada_no_arquivo: "Placa repetida no mesmo arquivo — vale a primeira ocorrência.",
  valor_compra_zerado: "Valor de compra veio 0,00. O custo-base é a raiz da margem, então o carro ficou de fora do sync inteiro.",
  nenhum_campo_observado: "A linha não trouxe nenhum valor aproveitável.",
  repasse_ambiguo: "Mais de um repasse ativo com essa placa — desempate manualmente antes de sincronizar.",
};

export function rotuloMotivoNaoEncontrada(motivo: MotivoNaoEncontrada): string {
  return ROTULO_MOTIVO_NAO_ENCONTRADA[motivo] ?? motivo;
}

export function rotuloMotivoIgnorada(motivo: MotivoIgnorada): string {
  return ROTULO_MOTIVO_IGNORADA[motivo] ?? motivo;
}

/**
 * Valor de um campo do diff, formatado pt-BR. `qtde_anuncios` é contagem
 * (inteiro); o resto é dinheiro centavo-perfect. `null` vira "vazio", que é o
 * que `antes: null` significa — e nunca "R$ 0,00", que seria uma afirmação
 * falsa sobre o estado anterior.
 */
export function formatarValorCampo(campo: CampoSync, valor: number | null): string {
  if (valor == null) return "vazio";
  return campo === "qtde_anuncios" ? formatInt(valor) : formatBRLCents(valor);
}

// ─── Leituras derivadas (puras) ──────────────────────────────────────────────

export type ContagemAcoes = { preenche: number; altera: number };

/**
 * Quantos campos apenas PREENCHEM buraco e quantos TROCAM um número que já
 * existia. É a leitura que impede o susto da primeira importação: 104 campos a
 * mudar, dos quais 102 são buraco sendo preenchido, não é o mesmo evento que
 * 104 valores sendo sobrescritos.
 */
export function contarAcoes(rel: RelatorioSync): ContagemAcoes {
  let preenche = 0;
  let altera = 0;
  for (const item of rel.com_alteracao) {
    for (const c of item.campos) {
      if (c.acao === "preenche") preenche++;
      else altera++;
    }
  }
  return { preenche, altera };
}

/** true quando o carro tem pelo menos um valor SENDO TROCADO (não só preenchido). */
export function temValorTrocado(item: ItemComAlteracao): boolean {
  return item.campos.some((c) => c.acao === "altera");
}

/**
 * Ordena os carros que vão mudar pondo na frente os que trocam valor existente.
 * Isto é ordem de LEITURA, não regra de negócio: o conteúdo é o que a RPC
 * mandou, intacto. Dentro de cada grupo preserva a ordem do arquivo.
 */
export function ordenarPorAtencao(itens: ReadonlyArray<ItemComAlteracao>): ItemComAlteracao[] {
  return [...itens].sort((a, b) => {
    const pa = temValorTrocado(a) ? 0 : 1;
    const pb = temValorTrocado(b) ? 0 : 1;
    return pa !== pb ? pa - pb : a.linha - b.linha;
  });
}

/**
 * Sintoma de sessão expirada (§9, caso 15): com o RLS zerando a visibilidade, o
 * preview devolve TODAS as linhas em `nao_encontradas`. Sem este aviso o usuário
 * lê "nenhum carro encontrado" e conclui que perdeu o estoque.
 */
export function pareceSessaoExpirada(rel: RelatorioSync): boolean {
  const { linhas_no_arquivo, nao_encontradas } = rel.resumo;
  return linhas_no_arquivo > 0 && nao_encontradas === linhas_no_arquivo;
}

/**
 * Invariante de 4 baldes do lado da RPC (AC5): nenhuma linha do payload some.
 * Igualdade de soma, nunca número fixo.
 */
export function baldesFecham(rel: RelatorioSync): boolean {
  const r = rel.resumo;
  return (
    r.sem_alteracao + r.com_alteracao + r.nao_encontradas + r.ignoradas === r.linhas_no_arquivo
  );
}
