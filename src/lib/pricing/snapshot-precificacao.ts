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
 * ┌─ C19 — "GIRAR COM MODO RECUPERAR" É INEXPRIMÍVEL AQUI ──────────────────────┐
 * │ `modo` e `versao_regua` são DERIVADOS de `args.sugestao` — do objeto que o   │
 * │ motor devolveu. Esta função NÃO aceita `modo` como parâmetro separado e NÃO  │
 * │ lê o estado do seletor da UI. Se a assinatura permitir passar os dois        │
 * │ independentemente, a C19 está violada mesmo com todos os testes verdes.      │
 * │                                                                             │
 * │ O modo de falha que isto fecha: o seletor guarda o modo em estado de UI, o   │
 * │ motor devolve os preços, e os dois chegam aqui por caminhos separados.       │
 * │ Trocar de modo depois do cálculo gravaria uma linha que NENHUM dos 7 CHECKs  │
 * │ da 030+032 pega — ela é coerente por fora e só mente sobre a própria         │
 * │ população, envenenando em silêncio a recalibração, que é a única coisa que a │
 * │ tabela existe pra permitir. É a ÚNICA corrupção que o banco não detecta      │
 * │ (migration 032 §6), e por isso o fix é de TIPO, não de teste.                │
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
  type ModoPreco,
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
  /**
   * IDENTIDADE DO CARRO, congelada no INSERT (migration 035, ADR-003 §13).
   *
   * ⚠️ **RÓTULO, NUNCA CHAVE.** O sufixo `_snapshot` está no nome de propósito:
   * a chave do ciclo continua sendo `repasse_id`, e agrupar por `placa_snapshot`
   * **misturaria ciclos** — a mesma placa volta num segundo repasse. Isto NÃO
   * revoga o `030:44-51`, que recusou placa como chave e segue certo.
   *
   * Existem porque a 030 pôs `ON DELETE CASCADE` sobre uma premissa falsa
   * ("repasses muda de status em vez de ser apagada"): repasses **são** apagados
   * no fluxo de todo dia. Com `SET NULL`, a linha órfã ainda diz DE QUE CARRO se
   * tratava — degrada o VÍNCULO, não o FATO. Congelar no insert (e não na
   * deleção) também protege de edição posterior do repasse.
   *
   * Podem ser string vazia: `repasses.placa`/`chassi` são NOT NULL mas aceitam
   * `""` no uso real (carro sem placa legível), e recusar aqui abortaria o
   * "Aplicar" de um carro que o resto do sistema aceita.
   */
  placa_snapshot: string;
  chassi_snapshot: string;
  modelo_snapshot: string;
  /**
   * DISCRIMINADOR DE POPULAÇÃO (migration 032, `rep_prec_modo_chk`).
   * `TEXT NOT NULL` sem DEFAULT: um insert sem esta coluna estoura 23502.
   *
   * Sob D3 (régua única) `parametros_regua` fica BYTE A BYTE IDÊNTICO nos dois
   * modos — derivar o modo do conteúdo da linha deixou de ser inferência fraca e
   * passou a ser IMPOSSÍVEL. Esta coluna é a ÚNICA fonte do modo.
   */
  modo: ModoPreco;
  /** Com o sufixo do modo nos DOIS modos (C12) — redundância legível, não fonte. */
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
  /**
   * true = o par aplicado difere do par que o motor sugeriu.
   *
   * ⚠️ Desde a decisão do Marcos de 2026-08-12, a UI preenche os campos com o
   * par ARREDONDADO pra centena, então este booleano é `true` na maioria das
   * aplicações mesmo sem o Marcos ter digitado nada. Quem for recalibrar deve
   * olhar a MAGNITUDE da diferença, não a flag: diferença abaixo de R$ 100 é
   * arredondamento; acima disso é correção de verdade.
   */
  houveEdicao: boolean;
};

/**
 * A identidade do ciclo, em UM objeto só.
 *
 * ⚠️ **Não é conveniência — é o mesmo argumento da C19 aplicado à identidade.**
 * Se `repasseId`, `placa`, `chassi` e `modelo` chegassem como quatro parâmetros
 * independentes, "id de um carro com a placa de outro" seria um estado
 * representável, e o banco **não pegaria**: os três `_snapshot` são NOT NULL,
 * não são verificados contra `repasses`, e a linha resultante passaria em todos
 * os CHECKs mentindo sobre qual carro produziu a decisão. O banco fecha o
 * NOT NULL, não a VERDADE (migration 035 §9).
 *
 * Estruturalmente compatível com `CarroPrecificar`, de propósito: a tela passa
 * **o próprio objeto do carro** que alimentou o motor, e não uma cópia montada
 * à parte.
 */
export type IdentidadeRepasse = {
  repasseId: number;
  placa: string;
  chassi: string;
  modelo: string;
};

export type MontarSnapshotArgs = {
  /** O carro que produziu a sugestão — fonte única de id E rótulos. */
  carro: IdentidadeRepasse;
  /**
   * A sugestão que produziu os números. **Fonte única do `modo`** — ver o bloco
   * C19 no topo do arquivo.
   *
   * ⚠️ NÃO acrescentar um campo `modo` aqui. Se este tipo aceitar `modo` ao lado
   * de `sugestao`, "girar com modo recuperar" volta a ser um estado
   * representável e a C19 está violada, com todos os testes verdes.
   */
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
  const { carro, sugestao } = args;
  const { custo, contexto } = sugestao;

  const minimoAplicado = arredondarCentavos(exigirNumero(args.aplicado.minimo, "minimo aplicado"));
  const comprePorAplicado = arredondarCentavos(
    exigirNumero(args.aplicado.comprePor, "compre por aplicado"),
  );

  const insert: SnapshotPrecificacaoInsert = {
    // Os quatro saem do MESMO objeto: o id e os três rótulos não podem divergir.
    repasse_id: carro.repasseId,
    placa_snapshot: carro.placa,
    chassi_snapshot: carro.chassi,
    modelo_snapshot: carro.modelo,
    // C19 — os dois saem do MESMO objeto que produziu os preços. `versaoRegua`
    // já vem do motor com o sufixo do modo: não se monta o sufixo aqui, senão
    // haveria duas fontes pra mesma verdade.
    modo: sugestao.modo,
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
