/**
 * MONTAGEM DO SNAPSHOT DA SUGESTÃO — função PURA, testável sem banco (AC21/AC22).
 *
 * Alvo: `repasse_precificacao_sugerida` (migration 030, append-only).
 * O I/O mora em `@/lib/repasses/precificar-queries.ts`; aqui só se monta o objeto.
 *
 * ┌─ POR QUE ESTE OBJETO EXISTE ────────────────────────────────────────────────┐
 * │ `custo_real` MUDA DEPOIS: gastos entram tarde (AC9) e o import por texto faz │
 * │ DELETE incondicional dos gastos `tipo='auto_avaliar'`. Seis meses depois não │
 * │ existe como reconstruir o custo do instante em que a régua rodou — logo não  │
 * │ existe como responder "a sugestão acertou?". ADR-003 §2.3.                   │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ CONTRATO CENTAVO-PERFECT (migration 030 §2.4) ─────────────────────────────┐
 * │ `rep_prec_custo_decomposto_chk` exige                                        │
 * │ `custo_real = valor_compra_repasse + gastos_total` SEM TOLERÂNCIA.           │
 * │ Combinado com a ordem de escrita (snapshot ANTES do UPDATE), R$ 0,01 de      │
 * │ divergência NÃO gera aviso: IMPEDE APLICAR O PREÇO.                          │
 * │ Por isso os três números vêm do MESMO `CustoDecomposto` produzido uma vez    │
 * │ por `decomporCusto()` — os mesmos números, não dois cálculos.                │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ O QUE NÃO SE TESTA AQUI ───────────────────────────────────────────────────┐
 * │ A invariante `compre_por ≥ mínimo ≥ custo_real` vale sobre o par SUGERIDO,   │
 * │ NUNCA sobre o par APLICADO (ADR-003 §11). O Marcos pode legitimamente        │
 * │ aplicar fora da ordem — inclusive abaixo do custo — e essa correção é        │
 * │ exatamente o rótulo que esta tabela existe pra capturar. O banco             │
 * │ deliberadamente não recusa; a UI avisa em vermelho e grava sem reclamar.     │
 * └─────────────────────────────────────────────────────────────────────────────┘
 */

import {
  serializarParametrosRegua,
  type ConfiancaSugestao,
  type SugestaoPrecoRepasse,
} from "@/lib/pricing/sugerir-preco-repasse";

/**
 * Linha a inserir em `repasse_precificacao_sugerida`. Nomes em snake_case
 * porque é payload de banco, não tipo de domínio.
 *
 * Os três campos do carimbo (`minimo_aplicado`, `compre_por_aplicado`,
 * `aplicado_em`) nascem NULL de propósito: a constraint
 * `rep_prec_carimbo_coerente_chk` lê os três NULL como "sugeriu e não aplicou",
 * e é isso que a linha significa entre o INSERT e o carimbo.
 */
export type SnapshotPrecificacaoInsert = {
  repasse_id: number;
  versao_regua: string;
  parametros_regua: Record<string, number>;
  minimo_sugerido: number;
  compre_por_sugerido: number;
  minimo_razao_efetiva: number;
  compre_por_razao_efetiva: number;
  bateu_piso: boolean;
  confianca: ConfiancaSugestao;
  justificativa: string;
  alertas: string[];
  custo_real: number;
  valor_compra_repasse: number;
  gastos_total: number;
  gastos_qtde: number;
  valor_auto_avaliar: number | null;
  valor_fipe: number | null;
  km: number | null;
  dias_no_repasse: number | null;
  qtde_anuncios: number | null;
};

/** 3º passo da ordem de escrita (ADR-003 §3): o carimbo do que foi aplicado. */
export type CarimboAplicado = {
  minimo_aplicado: number;
  compre_por_aplicado: number;
  /** Instante TÉCNICO (timestamptz). ISO — nunca data de calendário. */
  aplicado_em: string;
};

export type SnapshotPrecificacaoMontado = {
  insert: SnapshotPrecificacaoInsert;
  carimbo: CarimboAplicado;
  /** true = o Marcos editou pelo menos um dos dois preços antes de aplicar. */
  houveEdicao: boolean;
};

export type MontarSnapshotArgs = {
  repasseId: number;
  sugestao: SugestaoPrecoRepasse;
  /** O par que o Marcos de fato vai aplicar. Pode diferir do sugerido (AC19/AC21). */
  aplicado: { minimo: number; comprePor: number };
  /** Instante do carimbo. Injetado pra manter a função pura. */
  agora?: Date;
};

/** Centavo-perfect, mesmo critério de `margem-repasse.ts`. */
function arredondarCentavos(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

function exigirNumero(v: unknown, campo: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new Error(`montarSnapshotPrecificacao: ${campo} inválido`);
  }
  return v;
}

/**
 * Monta o INSERT do snapshot e o carimbo do aplicado, a partir da sugestão que
 * o motor produziu e do par que o Marcos vai aplicar.
 *
 * Aplicar SEM editar grava `sugerido == aplicado` — que também é informação:
 * a régua foi aceita como veio (AC21).
 */
export function montarSnapshotPrecificacao(
  args: MontarSnapshotArgs,
): SnapshotPrecificacaoMontado {
  const { repasseId, sugestao } = args;
  const { custo, contexto } = sugestao;

  const minimoAplicado = arredondarCentavos(exigirNumero(args.aplicado.minimo, "minimo aplicado"));
  const comprePorAplicado = arredondarCentavos(
    exigirNumero(args.aplicado.comprePor, "compre por aplicado"),
  );

  const insert: SnapshotPrecificacaoInsert = {
    repasse_id: repasseId,
    versao_regua: sugestao.versaoRegua,
    // Os VALORES das constantes vigentes, não só o nome da versão: as constantes
    // são editáveis à mão, então o nome pode mentir — os números não.
    parametros_regua: serializarParametrosRegua(sugestao.parametros),

    minimo_sugerido: sugestao.minimoSugerido,
    compre_por_sugerido: sugestao.comprePorSugerido,
    minimo_razao_efetiva: sugestao.minimoRazaoEfetiva,
    compre_por_razao_efetiva: sugestao.comprePorRazaoEfetiva,
    bateu_piso: sugestao.bateuPiso,
    confianca: sugestao.confianca,
    justificativa: sugestao.justificativa,
    alertas: sugestao.alertas,

    // Os TRÊS do contrato centavo-perfect, do mesmo `CustoDecomposto`.
    custo_real: custo.custoReal,
    valor_compra_repasse: custo.valorCompraRepasse,
    gastos_total: custo.gastosTotal,
    gastos_qtde: custo.gastosQtde,

    // Contexto do momento — irrecuperável depois (ADR-003 §2.3).
    valor_auto_avaliar: contexto.valorAutoAvaliar,
    valor_fipe: contexto.valorFipe,
    km: contexto.km,
    dias_no_repasse: contexto.diasNoRepasse,
    qtde_anuncios: contexto.qtdeAnuncios,
  };

  const carimbo: CarimboAplicado = {
    minimo_aplicado: minimoAplicado,
    compre_por_aplicado: comprePorAplicado,
    aplicado_em: (args.agora ?? new Date()).toISOString(),
  };

  return {
    insert,
    carimbo,
    houveEdicao:
      minimoAplicado !== sugestao.minimoSugerido ||
      comprePorAplicado !== sugestao.comprePorSugerido,
  };
}
