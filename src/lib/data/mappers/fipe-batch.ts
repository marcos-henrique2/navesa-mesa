/**
 * Mapper PURO de `fipe_batch` ↔ `BatchFipeItem` / `BatchResult`.
 * Sem "use client", sem Supabase: usado pelo client e pelo cérebro (Node).
 */
import {
  FIPE_SCORE_MIN,
  isFipeConfirmado,
  type BatchFipeError,
  type BatchFipeItem,
  type BatchResult,
} from "@/lib/fipe/batch-tipos";

export type FipeBatchRow = {
  chassi: string;
  preco_fipe: number;
  fipe_marca_cod: string | null;
  fipe_marca_nome: string | null;
  fipe_modelo_cod: number | null;
  fipe_modelo_nome: string | null;
  fipe_ano_cod: string | null;
  fipe_ano_nome: string | null;
  /** Score do match (migration 021). `null` em linhas gravadas antes dela. */
  score: number | null;
  /** Guard de plausibilidade rodou e aprovou (migration 021). `false` no legado. */
  plausibilidade_verificada: boolean | null;
  /** Tabela FIPE de origem do preço, ex. `"julho/2026"` (migration 022). `null` no legado. */
  fipe_referencia: string | null;
  /** Código numérico da referência, ex. `335` (migration 022). Reproduz a consulta. */
  fipe_referencia_cod: number | null;
  atualizado_em: string;
};

export function fipeBatchFromRow(r: FipeBatchRow): BatchFipeItem {
  return {
    chassi: r.chassi,
    precoFipe: Number(r.preco_fipe),
    match: {
      marcaCod: r.fipe_marca_cod ?? "",
      marcaNome: r.fipe_marca_nome ?? "",
      modeloCod: r.fipe_modelo_cod ?? 0,
      modeloNome: r.fipe_modelo_nome ?? "",
      anoCod: r.fipe_ano_cod ?? "",
      anoNome: r.fipe_ano_nome ?? "",
    },
    score: r.score == null ? null : Number(r.score),
    // `null` (coluna ausente / linha legada) é lido como NÃO verificado.
    plausibilidadeVerificada: r.plausibilidade_verificada === true,
    // String vazia é tratada como ausente: um rótulo em branco não identifica
    // tabela nenhuma e não pode passar por referência válida.
    fipeReferencia: r.fipe_referencia?.trim() ? r.fipe_referencia.trim() : null,
    fipeReferenciaCod: r.fipe_referencia_cod == null ? null : Number(r.fipe_referencia_cod),
  };
}

export function fipeBatchToRow(item: BatchFipeItem, timestamp: number): FipeBatchRow {
  return {
    chassi: item.chassi,
    preco_fipe: item.precoFipe,
    fipe_marca_cod: item.match.marcaCod,
    fipe_marca_nome: item.match.marcaNome,
    fipe_modelo_cod: item.match.modeloCod,
    fipe_modelo_nome: item.match.modeloNome,
    fipe_ano_cod: item.match.anoCod,
    fipe_ano_nome: item.match.anoNome,
    score: item.score,
    plausibilidade_verificada: item.plausibilidadeVerificada,
    fipe_referencia: item.fipeReferencia,
    fipe_referencia_cod: item.fipeReferenciaCod,
    atualizado_em: new Date(timestamp).toISOString(),
  };
}

/**
 * Traduz "por que essa linha não conta como confirmada" num motivo exibível.
 *
 * A ordem importa: o score é a falha mais grave (o carro pode estar casado com
 * outro modelo), a referência vem em seguida (o carro está certo, mas o preço
 * pode ser de qualquer mês), e a plausibilidade por último (preço nunca
 * confrontado com o custo).
 */
function motivoNaoConfirmado(item: BatchFipeItem): Pick<BatchFipeError, "motivo" | "detalhe"> {
  if (item.score == null) {
    return {
      motivo: "score-baixo",
      detalhe: "match sem score registrado (anterior à migration 021) — reveja ou rode o batch de novo",
    };
  }
  if (item.score < FIPE_SCORE_MIN) {
    return {
      motivo: "score-baixo",
      detalhe: `score ${item.score.toFixed(2)} abaixo do mínimo de confiança`,
    };
  }
  if (!item.fipeReferencia) {
    return {
      motivo: "sem-referencia-fipe",
      detalhe:
        "preço sem tabela FIPE registrada (anterior à migration 022) — pode ser de qualquer mês. Rode o batch de novo pra carimbar a referência.",
    };
  }
  return {
    motivo: "sem-custo-referencia",
    detalhe: "preço nunca confrontado com o custo do veículo (importado sem custo_total)",
  };
}

/**
 * Monta o BatchResult a partir das linhas de `fipe_batch`.
 *
 * Os erros da EXECUÇÃO não persistem, mas os erros de CONFIANÇA são recalculáveis
 * a partir das linhas — e precisam ser, senão o painel mente. Antes essa função
 * devolvia `erros: []` e `totalVeiculos: rows.length`, o que fazia a cobertura
 * dar 100% mesmo com metade das linhas sendo match não confirmado.
 */
export function montarBatchFipe(rows: FipeBatchRow[]): BatchResult | null {
  if (rows.length === 0) return null;

  const items: Record<string, BatchFipeItem> = {};
  const erros: BatchFipeError[] = [];
  let maxTs = 0;
  for (const r of rows) {
    const item = fipeBatchFromRow(r);
    items[r.chassi] = item;
    if (!isFipeConfirmado(item)) {
      // Os três motivos são reconstruídos: antes só `score-baixo` voltava, então
      // uma linha com score alto que NUNCA passou pelo guard de plausibilidade
      // reaparecia como totalmente confirmada depois de um F5.
      erros.push({
        chassi: r.chassi,
        modelo: r.fipe_modelo_nome ?? "—",
        ...motivoNaoConfirmado(item),
      });
    }
    const t = new Date(r.atualizado_em).getTime();
    if (t > maxTs) maxTs = t;
  }
  return {
    timestamp: maxTs,
    items,
    erros,
    totalGrupos: 0,
    totalVeiculos: rows.length,
    // Veio do banco: por definição está persistido.
    persistenciaErro: null,
  };
}
