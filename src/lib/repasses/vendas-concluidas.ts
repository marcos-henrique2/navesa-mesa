/**
 * Espelho declarativo do contrato de saída das RPCs de importação de VENDAS do
 * Auto Avaliar (`importar_vendas_concluidas_auto_avaliar_preview` e
 * `importar_vendas_concluidas_auto_avaliar`), migration 036.
 *
 * ┌─ REGRA DESTE MÓDULO ───────────────────────────────────────────────────────┐
 * │ A CLASSIFICAÇÃO MORA NO BANCO. Aqui não se reagrupa, não se recalcula       │
 * │ `antes`/`depois`, não se infere `acao` e não se reordena por regra de       │
 * │ negócio própria. Este arquivo só TIPA o que a RPC devolve e traduz código   │
 * │ em rótulo pt-BR. Se preview e tela discordarem, a tela mente sobre o que    │
 * │ vai ser gravado — que é o pior defeito possível numa confirmação.           │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * `patch` NÃO existe nestes tipos DE PROPÓSITO. Ele vem no JSON (é o que a RPC de
 * aplicar consome internamente), mas é interno da RPC: o front renderiza a partir
 * de `campos`. Não tipar é a forma mais barata de garantir isso.
 *
 * Diferença de contrato em relação ao sync de OFERTAS (029): lá `antes`/`depois`
 * são sempre número; aqui são heterogêneos — `status` é texto, `data_vendido` é
 * `YYYY-MM-DD`, o resto é dinheiro. Por isso `ValorCampo` e por isso a
 * formatação é decidida PELO NOME DO CAMPO, não pelo typeof.
 *
 * 100% PURO: sem I/O, sem rede, sem banco. A camada de I/O é
 * `vendas-concluidas-queries.ts`.
 */

import { formatBRLCents } from "@/lib/utils";
import { formatarDataBR } from "@/lib/utils/data-local";

// ─── Contrato de saída ───────────────────────────────────────────────────────

export type ModoVendas = "preview" | "aplicado";

/** Whitelist gravável. `string & {}` mantém legível um código novo do servidor. */
export type CampoVenda =
  | "status"
  | "data_vendido"
  | "valor_vendido"
  | "valor_compra_repasse"
  | "repasse_gastos"
  | (string & {});

/**
 * `preenche` = o campo estava vazio no banco (`antes: null`) e ganha valor.
 * `altera`   = havia algo gravado e ele TROCA. É o que merece atenção.
 */
export type AcaoCampoVenda = "preenche" | "altera" | (string & {});

/** Texto (`status`, data ISO) ou número (dinheiro). Nunca objeto. */
export type ValorCampo = string | number | null;

export type DiffCampoVenda = {
  campo: CampoVenda;
  antes: ValorCampo;
  depois: ValorCampo;
  acao: AcaoCampoVenda;
};

/** Como a RPC reencontrou o carro. `chassi` significa que a placa mudou. */
export type CasouPor = "placa" | "chassi" | (string & {});

export type ItemVendaAtualiza = {
  linha: number;
  placa_norm: string | null;
  repasse_id: number | null;
  modelo: string | null;
  /** Status ANTES da importação — é o que diz se o carro já estava vendido. */
  status: string | null;
  casou_por: CasouPor;
  /** Só os campos que MUDAM. Campo não observado não aparece. */
  campos: DiffCampoVenda[];
};

export type ItemVendaSemAlteracao = {
  linha: number;
  placa_norm: string | null;
  repasse_id: number | null;
  modelo: string | null;
};

/** Carro que não existe no sistema e VAI SER CRIADO já como vendido. */
export type ItemVendaCriar = {
  linha: number;
  placa_norm: string | null;
  chassi: string | null;
  modelo: string | null;
  data_subiu: string | null;
  data_vendido: string | null;
  valor_vendido: number | null;
  valor_compra_repasse: number | null;
  gastos: number | null;
};

export type MotivoIgnoradaVenda =
  | "linha_sem_identificacao"
  | "placa_duplicada_no_arquivo"
  | "chassi_duplicado_no_arquivo"
  | "repasse_ja_casado_no_arquivo"
  | "sem_data_venda"
  | "data_venda_futura"
  | "sem_valor_vendido"
  | "repasse_ambiguo"
  | "sem_chassi_para_criar"
  | "sem_placa_para_criar"
  | "sem_modelo_para_criar"
  | (string & {});

export type ItemVendaIgnorada = {
  linha: number;
  placa_norm: string | null;
  chassi: string | null;
  motivo: MotivoIgnoradaVenda;
  /** Só em `repasse_ambiguo`: os ids que o usuário precisa desempatar. */
  repasse_ids: number[] | null;
};

export type ResumoVendas = {
  linhas_no_arquivo: number;
  sem_alteracao: number;
  com_alteracao: number;
  a_criar: number;
  ignoradas: number;
  campos_a_alterar: number;
  gastos_a_lancar: number;
  /** 0 no preview; ROW_COUNT real no aplicado. */
  linhas_gravadas: number;
  repasses_criados: number;
  gastos_lancados: number;
};

export type RelatorioVendas = {
  versao: number;
  modo: ModoVendas;
  /** Instante técnico de geração, já em -03:00 (não é data de calendário). */
  gerado_em: string | null;
  /** `com_alteracao` e `a_criar` NUNCA são truncados: carregam o patch. */
  truncado: boolean;
  resumo: ResumoVendas;
  com_alteracao: ItemVendaAtualiza[];
  sem_alteracao: ItemVendaSemAlteracao[];
  a_criar: ItemVendaCriar[];
  ignoradas: ItemVendaIgnorada[];
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

function listaIds(v: unknown): number[] | null {
  if (!Array.isArray(v)) return null;
  const ids = v.map(num).filter((n): n is number => n != null);
  return ids.length > 0 ? ids : null;
}

/**
 * `antes`/`depois` heterogêneos. Número fica número; string fica string (data
 * ISO ou status). NÃO converte string numérica em número: o PostgREST devolve
 * `numeric` como string, mas aqui isso é resolvido por campo em
 * `formatarValorVenda`, que sabe qual campo é dinheiro.
 */
function valorCampo(v: unknown): ValorCampo {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") return v === "" ? null : v;
  return null;
}

function lerDiff(raw: Record<string, unknown>): DiffCampoVenda {
  return {
    campo: codigo(raw.campo, "?"),
    antes: valorCampo(raw.antes),
    depois: valorCampo(raw.depois),
    acao: codigo(raw.acao, "altera"),
  };
}

function lerResumo(v: unknown): ResumoVendas {
  const r = isRecord(v) ? v : {};
  return {
    linhas_no_arquivo: int(r.linhas_no_arquivo),
    sem_alteracao: int(r.sem_alteracao),
    com_alteracao: int(r.com_alteracao),
    a_criar: int(r.a_criar),
    ignoradas: int(r.ignoradas),
    campos_a_alterar: int(r.campos_a_alterar),
    gastos_a_lancar: int(r.gastos_a_lancar),
    linhas_gravadas: int(r.linhas_gravadas),
    repasses_criados: int(r.repasses_criados),
    gastos_lancados: int(r.gastos_lancados),
  };
}

/**
 * JSONB cru da RPC → `RelatorioVendas`. Nunca lança: chave faltando vira default
 * neutro, porque uma tela de conferência que estoura no meio é pior que uma que
 * mostra zero. `patch` é descartado aqui, e é aqui que ele para de existir.
 */
export function lerRelatorioVendas(raw: unknown): RelatorioVendas {
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
      casou_por: codigo(e.casou_por, "placa"),
      campos: itens(e.campos).map(lerDiff),
    })),
    sem_alteracao: itens(r.sem_alteracao).map((e) => ({
      linha: int(e.linha),
      placa_norm: str(e.placa_norm),
      repasse_id: num(e.repasse_id),
      modelo: str(e.modelo),
    })),
    a_criar: itens(r.a_criar).map((e) => ({
      linha: int(e.linha),
      placa_norm: str(e.placa_norm),
      chassi: str(e.chassi),
      modelo: str(e.modelo),
      data_subiu: str(e.data_subiu),
      data_vendido: str(e.data_vendido),
      valor_vendido: num(e.valor_vendido),
      valor_compra_repasse: num(e.valor_compra_repasse),
      gastos: num(e.gastos),
    })),
    ignoradas: itens(r.ignoradas).map((e) => ({
      linha: int(e.linha),
      placa_norm: str(e.placa_norm),
      chassi: str(e.chassi),
      motivo: codigo(e.motivo, "linha_sem_identificacao"),
      repasse_ids: listaIds(e.repasse_ids),
    })),
  };
}

// ─── Rótulos pt-BR ───────────────────────────────────────────────────────────

export const ROTULO_CAMPO_VENDA: Record<string, string> = {
  status: "Situação",
  data_vendido: "Data da venda",
  valor_vendido: "Valor vendido",
  valor_compra_repasse: "Valor de compra",
  repasse_gastos: "Gastos Auto Avaliar",
};

export function rotuloCampoVenda(campo: CampoVenda): string {
  return ROTULO_CAMPO_VENDA[campo] ?? campo;
}

export const ROTULO_MOTIVO_IGNORADA_VENDA: Record<string, string> = {
  linha_sem_identificacao: "Linha sem placa e sem chassi — não descreve carro nenhum.",
  placa_duplicada_no_arquivo: "Placa repetida no mesmo arquivo — vale a primeira ocorrência.",
  chassi_duplicado_no_arquivo: "Chassi repetido no mesmo arquivo — vale a primeira ocorrência.",
  repasse_ja_casado_no_arquivo:
    "Outra linha deste mesmo arquivo já casou com este repasse (uma pela placa, outra pelo chassi) — vale a primeira. Confira se são mesmo o mesmo carro.",
  sem_data_venda:
    "Sem data de venda. A data é o fato da venda: sem ela, carimbar hoje transformaria uma venda antiga numa venda de hoje.",
  data_venda_futura: "A data de venda está no futuro — confira o arquivo antes de importar.",
  sem_valor_vendido:
    "Sem valor vendido. Marcar vendido sem valor envenena todo cálculo de margem, então a linha ficou de fora.",
  repasse_ambiguo:
    "Mais de um repasse casa com essa placa/chassi — desempate manualmente antes de importar.",
  sem_chassi_para_criar:
    "Esse carro não existe no sistema e a linha veio sem chassi — não dá pra criar sem ele.",
  sem_placa_para_criar:
    "Esse carro não existe no sistema e a linha veio sem placa — não dá pra criar sem ela.",
  sem_modelo_para_criar:
    "Esse carro não existe no sistema e a linha veio sem modelo — não dá pra criar sem ele.",
};

export function rotuloMotivoIgnoradaVenda(motivo: MotivoIgnoradaVenda): string {
  return ROTULO_MOTIVO_IGNORADA_VENDA[motivo] ?? motivo;
}

/** Rótulo de situação do repasse, para o diff de `status` ficar legível. */
export const ROTULO_STATUS_REPASSE: Record<string, string> = {
  marcado: "Marcado pra subir",
  subido: "No ar",
  vendido: "Vendido",
  nao_vendido: "Não vendido",
  cancelado: "Cancelado",
};

/**
 * Valor de um campo do diff, formatado pt-BR. A escolha é PELO CAMPO, nunca pelo
 * typeof: o PostgREST devolve `numeric` como string, e decidir por typeof faria
 * "R$ 98.000,00" virar o texto cru `98000.00` sem nenhum sintoma na tela.
 *
 * `null` vira "vazio" — nunca "R$ 0,00", que seria uma afirmação falsa sobre o
 * estado anterior.
 */
export function formatarValorVenda(campo: CampoVenda, valor: ValorCampo): string {
  if (valor == null) return "vazio";
  if (campo === "status") {
    const s = String(valor);
    return ROTULO_STATUS_REPASSE[s] ?? s;
  }
  if (campo === "data_vendido") return formatarDataBR(String(valor));
  const n = typeof valor === "number" ? valor : Number(valor);
  return Number.isFinite(n) ? formatBRLCents(n) : String(valor);
}

// ─── Leituras derivadas (puras) ──────────────────────────────────────────────

export type ContagemAcoesVenda = { preenche: number; altera: number };

/**
 * Quantos campos apenas PREENCHEM buraco e quantos TROCAM algo que já existia.
 * É a leitura que impede o susto da primeira importação: 40 campos a mudar, dos
 * quais 38 são buraco sendo preenchido, não é o mesmo evento que 40 valores
 * sendo sobrescritos.
 */
export function contarAcoesVenda(rel: RelatorioVendas): ContagemAcoesVenda {
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
export function temValorTrocadoVenda(item: ItemVendaAtualiza): boolean {
  return item.campos.some((c) => c.acao === "altera");
}

/**
 * Ordena os carros que vão mudar pondo na frente os que trocam valor existente.
 * Ordem de LEITURA, não regra de negócio: o conteúdo é o que a RPC mandou,
 * intacto. Dentro de cada grupo preserva a ordem do arquivo.
 */
export function ordenarPorAtencaoVenda(
  itens: ReadonlyArray<ItemVendaAtualiza>,
): ItemVendaAtualiza[] {
  return [...itens].sort((a, b) => {
    const pa = temValorTrocadoVenda(a) ? 0 : 1;
    const pb = temValorTrocadoVenda(b) ? 0 : 1;
    return pa !== pb ? pa - pb : a.linha - b.linha;
  });
}

/**
 * Invariante de 4 baldes do lado da RPC: nenhuma linha do payload some.
 * Igualdade de soma, nunca número fixo.
 */
export function baldesFechamVenda(rel: RelatorioVendas): boolean {
  const r = rel.resumo;
  return r.sem_alteracao + r.com_alteracao + r.a_criar + r.ignoradas === r.linhas_no_arquivo;
}

/**
 * Sintoma de sessão expirada: com o RLS zerando a visibilidade, o preview não
 * enxerga repasse nenhum e TODAS as linhas caem em `a_criar`. Sem este aviso o
 * usuário lê "17 carros novos" e cria 17 duplicatas do próprio estoque.
 */
export function pareceSessaoExpiradaVenda(rel: RelatorioVendas): boolean {
  const { linhas_no_arquivo, a_criar } = rel.resumo;
  return linhas_no_arquivo > 1 && a_criar === linhas_no_arquivo;
}

/** Nada a gravar: nem alteração, nem criação. */
export function nadaPraGravarVenda(rel: RelatorioVendas): boolean {
  return rel.resumo.com_alteracao === 0 && rel.resumo.a_criar === 0;
}
