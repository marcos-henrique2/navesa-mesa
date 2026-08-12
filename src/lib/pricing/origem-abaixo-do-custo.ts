/**
 * C16 — as TRÊS ORIGENS de `valor_minimo < custo_real` (ADR-003 §12.8).
 *
 * ┌─ O PROBLEMA QUE ISTO RESOLVE ───────────────────────────────────────────────┐
 * │ O sistema tem UM predicado — `valor_minimo < custo_real` — atendendo TRÊS    │
 * │ situações que pedem reações opostas. Depois da 3.1c, "abaixo do custo" deixa │
 * │ de ser anomalia e vira ROTINA: acima de 6,6% de gastos, todo carro girado    │
 * │ satisfaz o predicado por desenho.                                           │
 * │                                                                             │
 * │ Sem esta desambiguação, o alerta vermelho de `/precificar` acende TODA VEZ   │
 * │ que o Marcos reabrir um carro girado, PARA SEMPRE, dizendo "vender no mínimo │
 * │ anunciado hoje dá prejuízo" — descrevendo uma decisão consciente dele como   │
 * │ falha. Alerta que toca sempre é alerta que ninguém lê (a mesma razão que     │
 * │ matou o alerta de piso na ADR-003 §5).                                      │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ **Tudo aqui é DERIVADO.** Nenhuma coluna de procedência é criada: a ADR-003
 * §3 recusou a opção 6 e a ADR-002 §4.5 recusou procedência por campo, e a
 * emenda não reabre nenhuma das duas. A origem sai da comparação entre o
 * snapshot mais recente do repasse e o estado de hoje.
 *
 * Função PURA — o I/O mora em `@/lib/repasses/precificar-queries.ts`.
 */

import type { ModoPreco } from "@/lib/pricing/sugerir-preco-repasse";

/**
 * O snapshot mais recente do repasse, reduzido ao que a classificação precisa.
 *
 * `minimoAplicado`/`aplicadoEmData` são `null` numa linha "sugeriu e não
 * aplicou" — estado legítimo (falha no passo 2 da ordem de escrita), e que cai
 * em `fora_do_sistema` porque não há decisão aplicada que explique o preço.
 */
export type SnapshotRecente = {
  modo: ModoPreco;
  minimoAplicado: number | null;
  /**
   * `custo_real` CONGELADO no instante da decisão — é o que revela a deriva.
   * Consumido no passo 2 de `classificarOrigemAbaixoDoCusto`: comparado com o
   * custo de HOJE, é a única coisa que distingue "ele escolheu isso" de "o custo
   * subiu depois que ele escolheu".
   */
  custoReal: number;
  /** Dia do calendário de Brasília (YYYY-MM-DD), já convertido do timestamptz. */
  aplicadoEmData: string | null;
};

export type OrigemAbaixoDoCusto =
  /** Girado deliberadamente. **Nota neutra** — foi decisão, não erro. */
  | "decisao"
  /** O custo subiu depois, por gasto tardio. **O vermelho original, intacto.** */
  | "deriva"
  /** Veio do import ou de edição inline. **Vermelho, e o mais informativo dos três.** */
  | "fora_do_sistema";

/** Centavo-perfect, mesmo critério de `margem-repasse.ts`. */
function cent(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/**
 * Classifica a origem do "abaixo do custo".
 *
 * **Só faz sentido chamar quando o predicado já é verdadeiro** — esta função não
 * decide SE alerta, decide QUAL alerta.
 *
 * A ordem dos testes é a da tabela da §12.8, e ela importa:
 *
 * 1. **Sem snapshot, ou o aplicado não bate com o preço de hoje** ⇒
 *    `fora_do_sistema`. O preço que está no ar não veio desta aba, então nenhuma
 *    decisão registrada o explica.
 * 2. **O custo de hoje é MAIOR que o congelado no snapshot** ⇒ `deriva`.
 *    ⚠️ **Este teste vem ANTES do modo, e é a razão de `custoReal` existir neste
 *    tipo.** Um carro girado que recebe gasto TARDIO não pode ser rotulado
 *    "decisão": a nota neutra diria "R$ X de gastos não são recuperados — foi
 *    uma decisão" com um X que **inclui o gasto que ele não decidiu**. O custo
 *    subiu depois da escolha, e isso é exatamente a deriva do Risk #8 da 3.1 —
 *    o vermelho original, intacto.
 * 3. **Snapshot bate, custo não mexeu, e o modo é `girar_rapido`** ⇒ `decisao`.
 *    É o caso que a fatia inteira existe pra tornar legível.
 * 4. **Resto** ⇒ `deriva`.
 *
 * ⚠️ **Imprecisão conhecida no caso 4, declarada de propósito.** Aplicar à mão
 * abaixo do custo no modo `recuperar_tudo` (permitido pela AC19 da 3.1) cai
 * aqui: existe decisão registrada, o custo não mexeu, e mesmo assim o preço está
 * abaixo. A §12.8 **não enumera** esse caso. A REAÇÃO está certa — é o vermelho
 * original, que é o que se quer mostrar —, mas o rótulo interno diz "deriva"
 * quando não houve deriva nenhuma. Não inventei uma quarta origem porque isso
 * exigiria texto novo (da `@uma-ux`) e emenda de ADR (da `@aria-architect`).
 * Se um dia essa distinção precisar aparecer na tela, é aqui que ela entra.
 */
export function classificarOrigemAbaixoDoCusto(
  snapshot: SnapshotRecente | null,
  valorMinimoAtual: number,
  custoRealAtual: number,
): OrigemAbaixoDoCusto {
  if (snapshot == null) return "fora_do_sistema";
  if (snapshot.minimoAplicado == null) return "fora_do_sistema";
  if (cent(snapshot.minimoAplicado) !== cent(valorMinimoAtual)) return "fora_do_sistema";
  if (cent(snapshot.custoReal) < cent(custoRealAtual)) return "deriva";
  if (snapshot.modo === "girar_rapido") return "decisao";
  return "deriva";
}
