/**
 * Tipos e regra de confiança do batch FIPE — módulo PURO (sem browser, sem
 * Supabase, sem React). Extraído de `batch.ts` pra ser reutilizável pelos
 * mappers de linha (`@/lib/data/mappers/fipe-batch`) e, futuramente, pelo
 * serviço Node do cérebro. `batch.ts` re-exporta tudo daqui.
 */
import type { FipeMatch } from "@/lib/fipe/types";

export type BatchFipeItem = {
  chassi: string;
  precoFipe: number;
  match: FipeMatch;
  /**
   * Score do match de modelo que originou esse preço (`findModelos`).
   *
   * `null` = procedência desconhecida (linha gravada antes da coluna `score` existir).
   * Tratamos `null` como NÃO confirmado — as linhas legadas são justamente as que
   * podem carregar o preço contaminado. Overrides manuais do `FipeReviewDrawer`
   * gravam `SCORE_MANUAL` (1) porque foram escolhidos por um humano.
   */
  score: number | null;
  /**
   * `true` só quando o guard `validarPlausibilidadeFipe` RODOU e aprovou.
   *
   * Score alto prova que o nome do modelo casou; não prova que o preço faz
   * sentido pro carro. Sem `custo_total` o guard não roda — e um item nunca
   * verificado precisa ser distinguível de um verificado e aprovado, inclusive
   * depois de um reload. Por isso o sinal é persistido, não só reportado.
   */
  plausibilidadeVerificada: boolean;
  /**
   * Rótulo da tabela FIPE de onde o preço veio (`"julho/2026"`).
   *
   * `null` = linha gravada antes da migration 022, quando a referência não era
   * registrada. Essas são justamente as linhas do bug de defasagem: o cache
   * antigo tinha TTL de 30 dias e chave SEM referência, então `fipe_batch`
   * chegou a ter preços de tabelas diferentes convivendo (medido: R$ 5.841 de
   * diferença no mesmo carro entre junho e julho/2026). Sem saber de qual mês
   * cada número veio, nenhum deles é auditável — por isso `isFipeConfirmado`
   * trata `null` como não confirmado.
   */
  fipeReferencia: string | null;
  /** Código numérico da referência (`335`) — é o que reproduz a consulta na API. */
  fipeReferenciaCod: number | null;
};

export type BatchFipeError = {
  chassi: string;
  modelo: string;
  motivo:
    | "marca-nao-encontrada"
    | "modelo-nao-encontrado"
    | "ano-nao-encontrado"
    | "erro-api"
    | "preco-implausivel"
    | "score-baixo"
    /** Match aceito, mas sem `custo_total` — o guard de plausibilidade não pôde rodar. */
    | "sem-custo-referencia"
    /** Preço sem tabela FIPE registrada — não é auditável nem reproduzível. */
    | "sem-referencia-fipe"
    /** FIPE muito acima do custo: pode ser compra bem-feita OU match errado. Humano decide. */
    | "revisao-recomendada";
  detalhe?: string;
};

export type BatchResult = {
  timestamp: number;
  items: Record<string, BatchFipeItem>; // chassi → resultado
  erros: BatchFipeError[];
  totalGrupos: number;
  totalVeiculos: number;
  /**
   * Mensagem de falha ao gravar o batch no Supabase, ou `null` se persistiu.
   *
   * Antes essa falha era engolida por um `console.warn` e a UI seguia exibindo
   * "Pronto: N carros com FIPE" com ZERO linha gravada. Dado financeiro não
   * pode falhar em silêncio — o caller é obrigado a olhar esse campo.
   */
  persistenciaErro: string | null;
};

/** Score mínimo de `findModelos` pra exibir/usar o preço FIPE como referência. */
export const FIPE_SCORE_MIN = 0.6;

/**
 * `true` só quando as TRÊS provas existem: o nome do modelo casou bem (score),
 * o preço foi confrontado com o custo do carro (plausibilidade verificada) e
 * sabemos de QUAL tabela FIPE o número veio (referência).
 *
 * As duas primeiras impedem que o caminho de vendas — que rodava sem
 * `custo_total` — produza linhas que parecem confirmadas mas nunca passaram por
 * checagem de valor.
 *
 * A terceira é a que fecha a defasagem: um preço sem referência pode ser de
 * qualquer mês, e meses vizinhos diferem em milhares de reais no mesmo carro.
 * "Está certo" e "está desatualizado" são indistinguíveis sem ela, então o
 * número não pode alimentar precificação — cai no proxy de custo até o batch
 * rodar de novo e carimbar a tabela.
 */
export function isFipeConfirmado(item: BatchFipeItem | null | undefined): boolean {
  if (!item) return false;
  if (item.score == null) return false;
  if (!item.plausibilidadeVerificada) return false;
  if (!item.fipeReferencia) return false;
  return item.score >= FIPE_SCORE_MIN && item.precoFipe > 0;
}
