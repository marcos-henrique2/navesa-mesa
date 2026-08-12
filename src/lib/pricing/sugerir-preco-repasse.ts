/**
 * MOTOR DE SUGESTÃO DE PREÇO DE REPASSE — Story 3.1a + 3.1c, ADR-003 (§12).
 *
 * Produz os DOIS preços do anúncio do Auto Avaliar sobre a BASE DO MODO:
 *   - `minimoSugerido`    → piso do leilão de 24h;
 *   - `comprePorSugerido` → compra direta, que encerra o anúncio na hora.
 *
 * ┌─ DOIS MODOS, UMA CONSTANTE (story 3.1c, D1+D3 — Marcos, 2026-08-12) ────────┐
 * │ base(recuperar_tudo) = custo_real            (compra + gastos)              │
 * │ base(girar_rapido)   = valor_compra_repasse  (abre mão dos gastos)          │
 * │                                                                             │
 * │ `REGUA_MINIMO_PCT` é a MESMA nos dois — **`REGUA_GIRAR_PCT` não existe**.   │
 * │ A v1 da 3.1c propunha uma segunda constante (1,072 sobre a compra): era     │
 * │ defeito, porque em carro SEM GASTO as bases coincidem e o modo "girar"      │
 * │ exibiria o preço MAIOR — em 12 dos 16 vendidos. A diferença entre os modos  │
 * │ é inteiramente atribuível à BASE:                                           │
 * │     minimo_recuperar − minimo_girar = REGUA_MINIMO_PCT × Σ gastos           │
 * │ Zero SSE não há gasto. Há teste que afirma essa identidade justamente pra   │
 * │ barrar a reintrodução de uma segunda constante (inclusive por merge).       │
 * │                                                                             │
 * │ ⚠️ CONSEQUÊNCIA DESEJADA: no modo girar o mínimo fica ABAIXO do custo real  │
 * │ sempre que os gastos passarem de 6,6% da compra. Isso é DESENHO (ADR-003    │
 * │ §12.0/§12.2), não anomalia — `minimo ≥ custo_real` deixou de ser invariante.│
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ INVARIANTE CENTRAL (ADR-003 §5 — "Ref. AA informa; custo manda") ──────────┐
 * │ Os dois preços saem EXCLUSIVAMENTE de `base(modo) × régua`.                 │
 * │ `valor_auto_avaliar` (Ref. AA) e `valor_fipe` determinam APENAS o nível de  │
 * │ `confianca` e o alerta de teto — NUNCA o valor.                             │
 * │ Se a referência passar a ter efeito NUMÉRICO, o gatilho G1-b da ADR-002     │
 * │ dispara e a migration 031 (COALESCE nos writes da 028) vira BLOQUEANTE      │
 * │ retroativamente (ADR-003 §6 e §10-T3). Isso não é estilo: é contrato.       │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ REGRA DE OURO (herdada de `margem-repasse.ts`) ────────────────────────────┐
 * │ custo_real = valor_compra_repasse + Σ repasse_gastos.                       │
 * │ NUNCA cair pra `valor_aquisicao` — é custo de VAREJO; repasse é B2B, base   │
 * │ MENOR. Dados incompletos ⇒ nenhuma sugestão, nunca um número inventado.     │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * `@/lib/pricing/suggest.ts` é REFERÊNCIA DE ESTILO (constantes no topo, bandas,
 * justificativa, alertas) e não de implementação: ele mira VAREJO e só aceita
 * `VeiculoParsed` do NBS.
 *
 * Tudo puro: sem I/O, sem `Date.now()` (o ano de referência entra pela entrada).
 */

import { calcularCustoReal, somarCentavos } from "@/lib/repasses/margem-repasse";

// ═════════════════════════════════════════════════════════════════════════════
// PARÂMETROS DA RÉGUA — cada constante com A SUA PRÓPRIA âncora (AC10)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Nome da versão vigente da régua. String LIVRE (a migration 030 tirou de
 * propósito o CHECK `^diagnostico_v[0-9]+$` da 003, que é do motor de varejo).
 * Vai pro snapshot em `versao_regua` — máximo 60 caracteres.
 *
 * BUMPE ISTO ao mexer em qualquer constante abaixo. E mesmo se esquecer, o
 * snapshot ainda guarda os VALORES em `parametros_regua`: o nome pode mentir,
 * os números não (ADR-003 §11).
 */
export const VERSAO_REGUA = "repasse_regua_v1_n16_jun_ago_2026";

// ═════════════════════════════════════════════════════════════════════════════
// MODO — a BASE do preço (story 3.1c, ADR-003 §12)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Qual grandeza a régua multiplica. **Dois valores e só dois** — o mesmo domínio
 * fechado do `rep_prec_modo_chk` da migration 032. Um terceiro modo mudaria a
 * BASE do preço e volta como decisão (gatilho T6, ADR-003 §12.11), nunca como
 * slot vago.
 */
export type ModoPreco = "recuperar_tudo" | "girar_rapido";

/**
 * Default conservador (C15 da 3.1c): é o que a 3.1a já entregava e o que o
 * Marcos vem usando. Mudar o default em silêncio trocaria a régua de TODOS os
 * carros — exatamente o que esta fatia recusou fazer.
 */
export const MODO_PADRAO: ModoPreco = "recuperar_tudo";

/** Rótulos pt-BR do modo (UI). */
export const MODO_LABEL: Record<ModoPreco, string> = {
  recuperar_tudo: "Recuperar tudo",
  girar_rapido: "Girar rápido",
};

/**
 * Nome pt-BR da BASE de cada modo — usado nos alertas e na justificativa.
 *
 * Com o artigo junto de propósito: os textos montam `travou n${rotulo}`, e sob
 * `girar_rapido` dizer "travou no custo real" nomearia a base ERRADA. Foi por
 * isso que o alerta de `bateuPiso` entrou na lista dos sítios que trocam
 * (C5 da 3.1c / ADR-003 §12.4).
 */
export const MODO_BASE_LABEL: Record<ModoPreco, string> = {
  recuperar_tudo: "o custo real",
  girar_rapido: "o valor de compra do repasse",
};

/** Como o piso do modo se chama num texto curto ("bateu no …"). */
export const MODO_PISO_LABEL: Record<ModoPreco, string> = {
  recuperar_tudo: "piso de custo",
  girar_rapido: "piso da compra",
};

/**
 * `base(modo)` — a única fonte de qual número a régua multiplica.
 *
 * ⚠️ Exportada de propósito: os seis sítios do motor que trocaram de base
 * (ADR-003 §12.4) passam por aqui, e o teste da C18 afirma a implicação
 * `base(girar) ≤ base(recuperar) ⇒ preço_girar ≤ preço_recuperar` sobre ela.
 */
export function baseDoModo(custo: CustoDecomposto, modo: ModoPreco): number {
  return modo === "girar_rapido" ? custo.valorCompraRepasse : custo.custoReal;
}

/**
 * `versao_regua` com o sufixo do modo — **nos DOIS modos** (C12 da 3.1c).
 *
 * REDUNDÂNCIA LEGÍVEL, nunca a fonte: a fonte do modo é a coluna `modo` da 032.
 * Obrigatório nos dois porque a query 6 de verificação da 032 procura
 * inconsistência com `versao_regua NOT LIKE '%\_\_' || modo` e espera ZERO
 * linhas — sem o sufixo no `recuperar_tudo`, 100% das linhas desse modo
 * apareceriam como inconsistentes e o detector viraria ruído.
 *
 * Comprimento: 33 + 16 = 49 (recuperar) e 33 + 14 = 47 (girar), ambos sob o
 * limite de 60 do `rep_prec_versao_nao_vazia_chk`.
 */
export function versaoReguaComModo(modo: ModoPreco, versaoBase: string = VERSAO_REGUA): string {
  return `${versaoBase}__${modo}`;
}

/** Ajuste nomeado que mexeu na razão do mínimo (AC16). `pontos` em razão, não %. */
export type AjusteRegua = {
  codigo: "dias_parado" | "reanuncio";
  label: string;
  /** Negativo = puxou o preço pra baixo. 0.01 = 1 ponto percentual de razão. */
  pontos: number;
};

export type ReguaPrecoRepasse = {
  // ── As duas âncoras da régua ─────────────────────────────────────────────
  /**
   * MEDIANA DO MÍNIMO QUE EFETIVAMENTE VENDEU, sobre `custo_real`.
   * Âncora: n=16 repasses vendidos, jun–ago/2026.
   * RECALIBRAR: mediana de `minimo_anunciado ÷ custo_real` nos VENDIDOS.
   */
  REGUA_MINIMO_PCT: number;
  /**
   * MEDIANA DE `mínimo ÷ compre-por` NOS MESMOS VENDIDOS — distância DENTRO do
   * mesmo carro. Âncora própria e independente da de cima (ADR-003 §4).
   * RECALIBRAR: mediana de `minimo_anunciado ÷ compre_por_anunciado` nos VENDIDOS.
   *
   * ⚠️ É RAZÃO, não prêmio. O prêmio do compre-por sobre o mínimo é
   * `1/0,952 − 1 ≈ 5,0%`. A ADR-003 §8 registra que razão e prêmio já foram
   * trocados um pelo outro uma vez nesta story — o código parametriza a RAZÃO.
   *
   * ⚠️ NÃO escrever "compre-por = p75". A banda p25–p75 mede DISPERSÃO DO MÍNIMO
   * ENTRE CARROS; a razão mede distância DENTRO DO MESMO CARRO. São eixos
   * diferentes, e quem recalibrar lendo "p75" recomputa o percentil errado
   * (ADR-003 §4).
   *
   * Incerteza registrada: 95,2% é o HÁBITO do Marcos (decisão de 2026-08-12,
   * ADR-003 §7.1 opção B), não uma otimização. Vendidos 95,2% × encalhados 97,1%
   * = 1,9 ponto, alavanca fraca. Racional do Marcos: errar pra CIMA é o mais
   * barato dos dois erros — compre-por alto só deixa de fechar a compra direta
   * na hora, não derruba o leilão de 24h.
   */
  RAZAO_MINIMO_SOBRE_COMPRE_POR: number;

  // ── Piso de aceite ───────────────────────────────────────────────────────
  /**
   * Piso de aceite = 0% sobre o custo: NUNCA **sugerir** abaixo do `custo_real`
   * (decisão do Marcos, ADR-003 §7). Regra do MOTOR, não do que o Marcos pode
   * decidir: editar abaixo do custo antes de aplicar é permitido (AC19) e a
   * migration 030 deliberadamente não recusa.
   */
  PISO_PCT: number;

  // ── Teto de referência (SÓ ALERTA — nenhum efeito numérico) ──────────────
  /**
   * ⚠️ HEURÍSTICA **NÃO CALIBRADA** — mesmo tom de `DEPRECIACAO_MENSAL_PCT`.
   * Motivo: a razão `minimo_que_vendeu ÷ Ref.AA` só tem **n=4** (mediana 87,7%,
   * faixa 76,0–97,8%), porque os vendidos saem do relatório de ofertas.
   * O teto deveria ficar no p75–p90 dessa razão, pra disparar só na cauda.
   *
   * Aplica-se AO MÍNIMO, nunca ao compre-por (o compre-por DEVE ficar acima da
   * referência — é prêmio por encerrar o anúncio; alertar ali seria ruído
   * recorrente, e alerta que toca sempre é alerta que ninguém lê).
   * ALERTA, JAMAIS TRAVA: o Amarok com 249 mil km fechou a 76,0% da Ref. AA e a
   * régua sobre custo o teria precificado bem. Aceitável em produção sem
   * calibração **exatamente porque não tem efeito numérico** (mantém G1-b
   * desarmado — ADR-003 §9.4).
   */
  TETO_REF_AA_PCT: number;

  // ── Banda do MÍNIMO entre carros (AC11 — exibição, sem efeito numérico) ──
  /** p25 do MÍNIMO que vendeu (n=16). NÃO é o piso da faixa mínimo↔compre-por. */
  BANDA_MINIMO_P25_PCT: number;
  /** p75 do MÍNIMO que vendeu (n=16). NÃO é o valor do compre-por (ADR-003 §4). */
  BANDA_MINIMO_P75_PCT: number;

  // ── Ajustes por sinal do carro (AC16) — todos NÃO CALIBRADOS ─────────────
  //
  // ┌─ NÃO EXISTE AJUSTE DE KM AQUI, E ISSO É DECISÃO ─────────────────────────┐
  // │ Decisão do Marcos, 2026-08-12: a régua é PLANA em quilometragem.         │
  // │                                                                          │
  // │ O ajuste de km existiu e foi removido porque cobrava DUAS VEZES pelo     │
  // │ mesmo sinal: `REGUA_MINIMO_PCT` (106,6%) é a mediana do mínimo que       │
  // │ vendeu numa amostra que JÁ É desta frota de picape rodada. Descontar km  │
  // │ por cima dessa mediana subestima sistematicamente.                       │
  // │                                                                          │
  // │ Medido em 3 placas reais antes de remover (PRD2189, QEZ8J18, TIU1F38):   │
  // │ o ajuste mordia em todas e derrubava o mínimo pra ~103–105% do custo —   │
  // │ ABAIXO do que o Marcos tinha pedido nos três carros.                     │
  // │                                                                          │
  // │ ⚠️ REINTRODUZIR EXIGE RECALIBRAR A BASE JUNTO. Com n=16 não dá pra       │
  // │ separar o efeito do km do efeito geral. Ou a referência de km/ano vira a │
  // │ mediana observada da própria frota (e aí `REGUA_MINIMO_PCT` tem que ser  │
  // │ recomputado sobre o resíduo), ou o ajuste não entra. Uma coisa não vem   │
  // │ sem a outra. Isto NÃO foi esquecimento.                                  │
  // └──────────────────────────────────────────────────────────────────────────┘
  /** ⚠️ NÃO calibrada. Dias no repasse a partir dos quais o carro "pesa". */
  DIAS_PARADO_LIMIAR: number;
  /** ⚠️ NÃO calibrada. Cada ciclo de N dias além do limiar tira 1 ponto. */
  DIAS_PARADO_POR_PONTO: number;
  /** Teto do ajuste de dias parado, em pontos de razão. */
  AJUSTE_DIAS_MAX: number;
  /** ⚠️ NÃO calibrada. Pontos tirados por anúncio ALÉM do primeiro. */
  REANUNCIO_PONTOS_POR_EXTRA: number;
  /** Teto do ajuste de reanúncio, em pontos de razão. */
  AJUSTE_REANUNCIO_MAX: number;
  /** TETO EXPLÍCITO da soma de todos os ajustes, em pontos de razão (AC16). */
  AJUSTE_TOTAL_MAX: number;

  // ── FIPE ajustada por km (AC14) — SÓ referência de alerta ────────────────
  //
  // Estas quatro constantes são o ÚNICO lugar em que km aparece, e elas NÃO
  // tocam o preço: alimentam só a referência do alerta de teto quando não há
  // Ref. AA. O double-count que matou o ajuste de km não se aplica aqui —
  // a FIPE é externa e realmente ignora quilometragem.
  /** Km/ano "normal", pra medir excesso de rodagem CONTRA A FIPE. */
  KM_POR_ANO_REFERENCIA: number;
  /** A cada N km acima do esperado, desconta `FIPE_DESCONTO_POR_EXCESSO` da FIPE. */
  KM_EXCESSO_POR_PONTO: number;
  /**
   * ⚠️ NÃO calibrada. Desconto na FIPE por cada `KM_EXCESSO_POR_PONTO` acima do
   * esperado. A FIPE ignora quilometragem: o Amarok com 249 mil km fechou a
   * 58,8% dela. Serve SÓ pra referência do alerta de teto — não toca o preço.
   */
  FIPE_DESCONTO_POR_EXCESSO: number;
  /** Teto do desconto de km sobre a FIPE (0.40 ⇒ nunca abaixo de 60% da FIPE). */
  FIPE_DESCONTO_MAX: number;
};

/**
 * Régua vigente. Objeto exportado, e a função aceita override
 * (`sugerirPrecoRepasse(entrada, params)`).
 *
 * Isso NÃO é conveniência de teste: a migration 030 exige `parametros_regua
 * JSONB NOT NULL`, ou seja, os valores vigentes precisam ser SERIALIZÁVEIS pra
 * ir no snapshot. O mesmo objeto serve de seam pros testes da invariante.
 *
 * `REGUA_COMPRE_POR_PCT` **não** está aqui de propósito: é DERIVADO
 * (`REGUA_MINIMO_PCT / RAZAO_MINIMO_SOBRE_COMPRE_POR`). Hard-codar 1.120
 * quebraria a derivação — o valor real é 1,1197478…
 */
export const REGUA_PADRAO: ReguaPrecoRepasse = {
  REGUA_MINIMO_PCT: 1.066,
  RAZAO_MINIMO_SOBRE_COMPRE_POR: 0.952,
  PISO_PCT: 1.0,
  TETO_REF_AA_PCT: 1.05,
  BANDA_MINIMO_P25_PCT: 1.042,
  BANDA_MINIMO_P75_PCT: 1.107,
  DIAS_PARADO_LIMIAR: 30,
  DIAS_PARADO_POR_PONTO: 30,
  AJUSTE_DIAS_MAX: 0.03,
  REANUNCIO_PONTOS_POR_EXTRA: 0.01,
  AJUSTE_REANUNCIO_MAX: 0.02,
  AJUSTE_TOTAL_MAX: 0.06,
  KM_POR_ANO_REFERENCIA: 15_000,
  KM_EXCESSO_POR_PONTO: 20_000,
  FIPE_DESCONTO_POR_EXCESSO: 0.02,
  FIPE_DESCONTO_MAX: 0.4,
};

/**
 * `REGUA_COMPRE_POR_PCT` DERIVADO das duas âncoras — nunca escrito à mão.
 * Com os valores vigentes dá **1,1197478991596638…**, não 1.120.
 */
export function reguaComprePorPct(params: ReguaPrecoRepasse = REGUA_PADRAO): number {
  return params.REGUA_MINIMO_PCT / params.RAZAO_MINIMO_SOBRE_COMPRE_POR;
}

/** Valor derivado com a régua padrão. Existe pra leitura/diagnóstico. */
export const REGUA_COMPRE_POR_PCT = reguaComprePorPct(REGUA_PADRAO);

// ═════════════════════════════════════════════════════════════════════════════
// TIPOS
// ═════════════════════════════════════════════════════════════════════════════

/** Níveis EMITIDOS pelo motor. O CHECK da 030 aceita 'media' como reservado. */
export type ConfiancaSugestao = "alta" | "baixa" | "muito_baixa";

/** De onde saiu a referência do ALERTA de teto (nunca do preço). */
export type FonteReferencia = "auto_avaliar" | "fipe_ajustada" | "nenhuma";

/**
 * `custo_real` decomposto — as TRÊS grandezas que a migration 030 exige que
 * fechem sem tolerância (`rep_prec_custo_decomposto_chk`).
 */
export type CustoDecomposto = {
  valorCompraRepasse: number;
  gastosTotal: number;
  /** Quantas LINHAS de gasto existiam no instante (AC22). */
  gastosQtde: number;
  custoReal: number;
};

/** Contexto do momento, ecoado pro snapshot exatamente como entrou (AC22). */
export type ContextoSugestao = {
  valorAutoAvaliar: number | null;
  valorFipe: number | null;
  km: number | null;
  diasNoRepasse: number | null;
  qtdeAnuncios: number | null;
};

export type EntradaSugestaoRepasse = {
  valorCompraRepasse: number | null | undefined;
  /** Valores de `repasse_gastos`. Nulos/inválidos são ignorados. */
  gastos: ReadonlyArray<number | null | undefined>;
  /** Ref. AutoAvaliar. SÓ confiança e alerta — nunca preço. */
  valorAutoAvaliar: number | null | undefined;
  /** FIPE. Fallback de referência do alerta — nunca preço. */
  valorFipe: number | null | undefined;
  km: number | null | undefined;
  anoModelo: number | null | undefined;
  /** Ano corrente, injetado pra manter a função pura. */
  anoReferencia: number;
  diasNoRepasse: number | null | undefined;
  /**
   * `repasses.data_subido_aproximada` — true quando `data_subido` foi INFERIDA
   * no backfill da migration 027 e pode variar alguns dias.
   *
   * Importa porque `dias_no_repasse` é hoje o único ajuste que mexe em DINHEIRO
   * (até −3 pt): a justificativa marca a incerteza em vez de apresentar um
   * desconto derivado de data inferida como se fosse medida.
   */
  diasAproximados?: boolean;
  qtdeAnuncios: number | null | undefined;
};

export type SugestaoPrecoRepasse = {
  ok: true;
  /**
   * QUAL RÉGUA PRODUZIU ESTES NÚMEROS (C19 da 3.1c).
   *
   * ⚠️ É daqui — e só daqui — que sai o `modo` gravado no snapshot. Nunca do
   * estado do seletor da UI, nunca de um parâmetro à parte de
   * `montarSnapshotPrecificacao`. "Girar com modo recuperar" não pode ser um
   * estado representável: é a ÚNICA corrupção da tabela 030 que o banco não
   * detecta (todos os 7 CHECKs passam numa linha que mente sobre a própria
   * população, e a recalibração é envenenada em silêncio).
   */
  modo: ModoPreco;
  custo: CustoDecomposto;
  contexto: ContextoSugestao;
  /**
   * Saída crua da régua, centavo-perfect (numeric(12,2)). É o que vai pro
   * snapshot em `minimo_sugerido` / `compre_por_sugerido` — o que o MOTOR
   * sugeriu, não necessariamente o que foi aplicado.
   */
  minimoSugerido: number;
  comprePorSugerido: number;
  /**
   * Múltiplo de R$ 100 (AC18). É o valor EXIBIDO **e** o que preenche os campos
   * de aplicar — decisão do Marcos, 2026-08-12: é o número que ele digita no
   * portal de qualquer forma, então é ele que deve virar `minimo_aplicado`.
   * Gravar o centavo exato registraria um preço que nunca foi ao ar, poluindo
   * justamente o rótulo de calibração que a tabela 030 existe pra capturar.
   *
   * ⚠️ Respeita o piso: se arredondar pra baixo cruzasse o `custo_real` (ou
   * invertesse o par), cai de volta pro valor exato e um alerta é emitido.
   */
  minimoArredondado: number;
  comprePorArredondado: number;
  /** Razão sobre `custo_real` DEPOIS dos ajustes e DEPOIS do piso (numeric(9,6)). */
  minimoRazaoEfetiva: number;
  comprePorRazaoEfetiva: number;
  bateuPiso: boolean;
  confianca: ConfiancaSugestao;
  fonteReferencia: FonteReferencia;
  /** Valor da referência usada no alerta de teto (null = não há referência). */
  referenciaTeto: number | null;
  ajustes: AjusteRegua[];
  /**
   * Banda do MÍNIMO entre os carros que venderam — NÃO é a faixa mín↔compre-por.
   *
   * ⚠️ `null` no modo `girar_rapido` (C7 da 3.1c). A supressão é do MOTOR, não da
   * UI: a banda é dispersão do mínimo SOBRE O CUSTO entre 16 carros, e reaplicá-la
   * sobre a compra seria o erro de eixo que a ADR-003 §4 registrou no
   * "compre-por = p75", repetido. Não existe banda calibrada sobre a compra e
   * inventar uma seria fabricar rigor. Sendo do motor, a regra é testável sobre
   * função pura e nenhuma tela futura pode exibi-la por engano.
   */
  bandaMinimo: { p25: number; p75: number } | null;
  justificativa: string;
  alertas: string[];
  parametros: ReguaPrecoRepasse;
  /** `VERSAO_REGUA` COM o sufixo do modo (`…__recuperar_tudo` / `…__girar_rapido`). */
  versaoRegua: string;
};

export type SemSugestao = {
  ok: false;
  /** Mensagem pt-BR pra UI. Cor `neutro`, nunca um número inventado. */
  motivo: string;
  custo: CustoDecomposto | null;
};

export type ResultadoSugestao = SugestaoPrecoRepasse | SemSugestao;

// ═════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═════════════════════════════════════════════════════════════════════════════

function isNumFinito(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Arredondamento centavo-perfect. MESMO critério de `margem-repasse.ts`
 * (`Math.round((v + EPSILON) * 100) / 100`) — divergência de R$ 0,01 é bug
 * crítico no projeto, e o CHECK `rep_prec_custo_decomposto_chk` não tem
 * tolerância nenhuma.
 */
function arredondarCentavos(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/** Arredonda a razão pra numeric(9,6) do snapshot. */
function arredondarRazao(v: number): number {
  return Math.round((v + Number.EPSILON) * 1e6) / 1e6;
}

/** Múltiplo de R$ 100 (AC18). */
export function arredondarParaCentena(v: number): number {
  return Math.round(v / 100) * 100;
}

/**
 * Arredonda pra centena **sem furar o piso**: se a centena de baixo cruzasse o
 * limite (`custo_real` no caso do mínimo; o próprio mínimo no caso do compre
 * por), devolve o valor exato. Vale a pena arredondar pra facilitar a digitação
 * no portal — não vale a pena arredondar pra baixo do custo.
 */
function arredondarRespeitandoPiso(exato: number, piso: number): number {
  const centena = arredondarParaCentena(exato);
  return centena < piso ? exato : centena;
}

function formatBRL(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatPct(razao: number): string {
  return `${(razao * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function formatPontos(pontos: number): string {
  const sinal = pontos < 0 ? "−" : "+";
  return `${sinal}${(Math.abs(pontos) * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} pt`;
}

/**
 * Decompõe o custo em UM único cálculo — as três grandezas saem daqui e vão
 * juntas pro snapshot.
 *
 * CONTRATO CENTAVO-PERFECT da migration 030 §2.4: o app manda
 * `gastos_total = arredondar2(Σ gastos)` e `custo_real = arredondar2(compra +
 * gastos_total)` — **os mesmos números, não dois cálculos independentes**.
 * R$ 0,01 de divergência não gera aviso: IMPEDE APLICAR O PREÇO.
 *
 * Retorna `null` quando não há custo (AC6): `valor_compra_repasse` nulo ou
 * negativo. NUNCA cai pra `valor_aquisicao`.
 */
export function decomporCusto(
  valorCompraRepasse: number | null | undefined,
  gastos: ReadonlyArray<number | null | undefined>,
): CustoDecomposto | null {
  if (!isNumFinito(valorCompraRepasse)) return null;
  // Negativo é dado ERRADO, não dado ausente. Os dois casos devolvem `null`
  // aqui, mas `sugerirPrecoRepasse` os separa na MENSAGEM — mandar o Marcos
  // preencher um campo que já está preenchido (com lixo) o faz procurar a coisa
  // errada. O CHECK `valor_compra_repasse >= 0` da 030 recusaria de todo jeito.
  if (valorCompraRepasse < 0) return null;

  const validos = gastos.filter(isNumFinito);
  const gastosTotal = somarCentavos(validos);
  // `calcularCustoReal` é a função canônica da REGRA DE OURO (AC5). Recebe o
  // total JÁ arredondado pra garantir custo_real === compra + gastos_total.
  const custoReal = calcularCustoReal(valorCompraRepasse, [gastosTotal]);
  if (custoReal == null) return null;

  return {
    valorCompraRepasse: arredondarCentavos(valorCompraRepasse),
    gastosTotal,
    gastosQtde: validos.length,
    custoReal,
  };
}

/** Idade do carro em anos, pela referência de ano informada. Nunca negativa. */
function idadeAnos(anoModelo: number | null | undefined, anoReferencia: number): number | null {
  if (!isNumFinito(anoModelo) || !isNumFinito(anoReferencia)) return null;
  const idade = anoReferencia - anoModelo;
  return idade < 0 ? 0 : idade;
}

/**
 * FIPE ajustada por km — SÓ referência do alerta de teto (AC14).
 * Não entra em nenhum preço. Retorna a própria FIPE quando não dá pra ajustar.
 */
function fipeAjustadaPorKm(
  fipe: number,
  km: number | null | undefined,
  anoModelo: number | null | undefined,
  anoReferencia: number,
  params: ReguaPrecoRepasse,
): number {
  const idade = idadeAnos(anoModelo, anoReferencia);
  if (idade == null || !isNumFinito(km)) return fipe;
  const esperado = idade * params.KM_POR_ANO_REFERENCIA;
  const excesso = km - esperado;
  if (excesso <= 0) return fipe;
  const desconto = Math.min(
    (excesso / params.KM_EXCESSO_POR_PONTO) * params.FIPE_DESCONTO_POR_EXCESSO,
    params.FIPE_DESCONTO_MAX,
  );
  return arredondarCentavos(fipe * (1 - desconto));
}

/**
 * D2 (C11 da 3.1c) — **chave liga/desliga**, não constante de régua.
 *
 * Fica FORA de `ReguaPrecoRepasse` de propósito: a C2 proíbe chave nova em
 * `REGUA_PADRAO`/`parametros_regua`, e isto não é um parâmetro numérico da
 * régua — é a resposta binária de uma decisão em aberto. Ver o bloco de
 * ambiguidade em `calcularAjustes`.
 */
export const AJUSTES_APLICAM_NO_MODO_GIRAR = true;

/** Clamp de um ajuste negativo por um teto positivo. */
function limitarAjuste(pontos: number, teto: number): number {
  if (pontos >= 0) return 0;
  return Math.max(pontos, -teto);
}

/**
 * Ajustes do AC16 — cada um limitado por constante nomeada, e a soma limitada
 * pelo teto explícito `AJUSTE_TOTAL_MAX`. Ambos puxam PRA BAIXO: carro parado e
 * carro reanunciado são sinais de que o preço atual não está fechando.
 *
 * ⚠️ NÃO existe ajuste de km (decisão do Marcos, 2026-08-12) — ver o bloco em
 * `ReguaPrecoRepasse`. A régua é PLANA em quilometragem.
 *
 * A diferença que sustenta manter estes dois: km é CARACTERÍSTICA do carro, e a
 * mediana da amostra já a absorveu; dias parados e reanúncio são ESTADO.
 * Isso é argumento, não medição — os dois seguem NÃO CALIBRADOS.
 *
 * ┌─ ⚠️ SEMÂNTICA DE `qtde_anuncios` EM ABERTO — não mexer até a resposta ─────┐
 * │ O racional deste ajuste ("esse carro já voltou N vezes, o preço está alto")│
 * │ pressupõe REANÚNCIO AO LONGO DO TEMPO. Mas o COMMENT da migration 029 diz  │
 * │ "quantidade de anúncios ATIVOS" — e três anúncios SIMULTÂNEOS não são a    │
 * │ mesma coisa que um carro reanunciado três vezes. Se for simultaneidade, o  │
 * │ sinal pode ser o oposto (mais exposição, não mais dificuldade).            │
 * │                                                                            │
 * │ O Marcos vai confirmar no portal o que a coluna conta. Até lá o            │
 * │ comportamento fica COMO ESTÁ, e o custo de errar é zero na prática: os     │
 * │ 59/59 carros ativos têm o campo NULL (medido em 2026-08-12), então o       │
 * │ ajuste NUNCA dispara hoje. Ele só ganha efeito quando o import de arquivo  │
 * │ (029) começar a popular a coluna — e é aí que a resposta precisa ter       │
 * │ chegado.                                                                   │
 * └────────────────────────────────────────────────────────────────────────────┘
 */
function calcularAjustes(
  entrada: EntradaSugestaoRepasse,
  params: ReguaPrecoRepasse,
  modo: ModoPreco,
): AjusteRegua[] {
  // ┌─ ⚠️ D2 EM ABERTO — chave LIGA/DESLIGA, jamais uma segunda fórmula ────────┐
  // │ Pergunta (C11 da 3.1c): o ajuste de DIAS PARADOS deve aplicar no modo     │
  // │ girar? O Risco #3 é o mesmo double-count que matou o ajuste de km — o     │
  // │ modo girar JÁ É a resposta pra carro parado ("precisamos vender esse      │
  // │ carro rápido, porque está parado há muito tempo" — palavras do Marcos), e │
  // │ o ajuste desconta DE NOVO pelo mesmo motivo.                              │
  // │                                                                           │
  // │ NÃO DECIDIDO. É do Marcos, com a medição do @alex-analyst: mediana de     │
  // │ `minimo_que_vendeu ÷ valor_compra_repasse` quebrada por dias parados      │
  // │ (≤30 × >30). Se os 2,0 pontos do Risk #14 da 3.1 encolherem ao trocar o   │
  // │ denominador pra COMPRA, "pedir sobre a compra" já É o desconto de carro   │
  // │ parado e aplicar o ajuste por cima é double-count.                        │
  // │                                                                           │
  // │ Até lá o comportamento fica COMO ESTÁ (ajustes aplicam nos dois modos) —  │
  // │ mesmo molde do bloco de `qtde_anuncios` abaixo. A ADR-003 §12.10 IMPÕE,   │
  // │ qualquer que seja a resposta: o ajuste opera em ESPAÇO DE RAZÃO e é       │
  // │ base-agnóstico por construção. Esta constante é chave liga/desliga —      │
  // │ quem transformar isto numa segunda fórmula viola a §12.10.                │
  // └───────────────────────────────────────────────────────────────────────────┘
  if (modo === "girar_rapido" && !AJUSTES_APLICAM_NO_MODO_GIRAR) return [];

  const ajustes: AjusteRegua[] = [];

  // 1) Parado há muitos dias
  if (
    isNumFinito(entrada.diasNoRepasse) &&
    entrada.diasNoRepasse > params.DIAS_PARADO_LIMIAR &&
    params.DIAS_PARADO_POR_PONTO > 0
  ) {
    const excedente = entrada.diasNoRepasse - params.DIAS_PARADO_LIMIAR;
    const bruto = -(excedente / params.DIAS_PARADO_POR_PONTO) * 0.01;
    const pontos = limitarAjuste(bruto, params.AJUSTE_DIAS_MAX);
    if (pontos < 0) {
      ajustes.push({
        codigo: "dias_parado",
        label:
          `${entrada.diasNoRepasse} dias em repasse (limiar ${params.DIAS_PARADO_LIMIAR})` +
          (entrada.diasAproximados === true
            ? " — data de subida INFERIDA no backfill da 027, pode variar alguns dias"
            : ""),
        pontos,
      });
    }
  }

  // 2) Reanúncio (pressão competitiva do próprio carro)
  if (isNumFinito(entrada.qtdeAnuncios) && entrada.qtdeAnuncios > 1) {
    const extras = entrada.qtdeAnuncios - 1;
    const bruto = -extras * params.REANUNCIO_PONTOS_POR_EXTRA;
    const pontos = limitarAjuste(bruto, params.AJUSTE_REANUNCIO_MAX);
    if (pontos < 0) {
      ajustes.push({
        codigo: "reanuncio",
        label: `${entrada.qtdeAnuncios} anúncios ativos do mesmo carro`,
        pontos,
      });
    }
  }

  return ajustes;
}

// ═════════════════════════════════════════════════════════════════════════════
// MOTOR
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Sugere `mínimo` e `compre por` sobre a **base do modo**.
 *
 * `params` é override opcional da régua vigente (AC10) — seam de teste E fonte
 * do `parametros_regua` do snapshot.
 *
 * `modo` decide QUAL grandeza a régua multiplica (3.1c). Default
 * `recuperar_tudo` = comportamento idêntico ao da 3.1a (C1), exceto o campo novo
 * `modo` e o sufixo de `versaoRegua` — as duas únicas diferenças declaradas.
 */
export function sugerirPrecoRepasse(
  entrada: EntradaSugestaoRepasse,
  params: ReguaPrecoRepasse = REGUA_PADRAO,
  modo: ModoPreco = MODO_PADRAO,
): ResultadoSugestao {
  const contexto: ContextoSugestao = {
    valorAutoAvaliar: isNumFinito(entrada.valorAutoAvaliar) ? entrada.valorAutoAvaliar : null,
    valorFipe: isNumFinito(entrada.valorFipe) ? entrada.valorFipe : null,
    km: isNumFinito(entrada.km) ? Math.trunc(entrada.km) : null,
    diasNoRepasse: isNumFinito(entrada.diasNoRepasse) ? Math.trunc(entrada.diasNoRepasse) : null,
    qtdeAnuncios: isNumFinito(entrada.qtdeAnuncios) ? Math.trunc(entrada.qtdeAnuncios) : null,
  };

  const custo = decomporCusto(entrada.valorCompraRepasse, entrada.gastos);

  // AC6 — sem `valor_compra_repasse` não há sugestão. Sem fallback, em hipótese
  // nenhuma, pra `valor_aquisicao` (custo de VAREJO).
  if (custo == null) {
    // Dado ERRADO e dado AUSENTE pedem ações diferentes do Marcos: um é conferir
    // o lançamento, o outro é preencher o campo.
    const negativa = isNumFinito(entrada.valorCompraRepasse) && entrada.valorCompraRepasse < 0;
    return {
      ok: false,
      motivo: negativa
        ? "R$ Compra do repasse está NEGATIVO — confira o lançamento. Não é campo em branco: é valor inválido, e o banco recusaria."
        : "Dados incompletos — falta o R$ Compra do Auto Avaliar (valor de compra do repasse). Sem ele não há custo real, e sem custo real não há sugestão.",
      custo: null,
    };
  }

  // ── I0: base(modo) > 0 — pré-condição, CONDICIONAL AO MODO (C6 da 3.1c) ──
  //
  // ⚠️ NÃO transformar isto num `valor_compra_repasse > 0` global: compra 0 com
  // gastos lançados é caso LEGÍTIMO no modo recuperar (base = custo_real > 0, e
  // o `rep_prec_base_do_modo_positiva_chk` da 032 aceita). Uma guarda global
  // barraria a sugestão certa. A guarda segue a GRANDEZA, não a coluna.
  //
  // Bug real da 3.1a que isto fecha: `decomporCusto` aceita compra = 0 (só
  // recusa negativo), então com compra 0 e gastos > 0 o `custo_real > 0`
  // atravessava a guarda antiga e o modo girar devolvia mínimo R$ 0,00.
  //
  // O CHECK da 032 é o ÚLTIMO ANTEPARO, não a proteção: se ele disparar em
  // produção o bug é DAQUI. O Marcos nunca deve ver R$ 0,00 na tela.
  const base = baseDoModo(custo, modo);
  if (base <= 0) {
    return {
      ok: false,
      motivo:
        modo === "girar_rapido"
          ? "Girar rápido: o R$ Compra do repasse está zerado, e a base deste modo é a COMPRA (não o custo). A régua sobre uma compra zerada devolveria R$ 0,00 — confira o lançamento da compra. Os gastos sozinhos não formam a base deste modo."
          : "Custo real igual a zero — confira o R$ Compra do repasse. A régua sobre um custo zerado devolveria R$ 0,00.",
      custo,
    };
  }

  const rotuloBase = MODO_BASE_LABEL[modo];

  // ── Régua + ajustes ──────────────────────────────────────────────────────
  const ajustes = calcularAjustes(entrada, params, modo);
  const ajusteBruto = ajustes.reduce((soma, a) => soma + a.pontos, 0);
  const ajusteTotal = limitarAjuste(ajusteBruto, params.AJUSTE_TOTAL_MAX);

  const alertas: string[] = [];

  let razaoMinimo = params.REGUA_MINIMO_PCT + ajusteTotal;

  // AC12 (revogada em parte pela C5 da 3.1c) — piso de aceite: nunca SUGERIR
  // abaixo da BASE DO MODO.
  //
  // ⚠️ ESTE CLAMP **NÃO** TROCA DE BASE, e parecer que troca é o caminho pra
  // estragá-lo (ADR-003 §12.4). Ele vive em ESPAÇO DE RAZÃO, que é adimensional
  // em relação à base: `PISO_PCT = 1,0` significa "nunca abaixo de 100% da
  // base", qualquer que ela seja. Com a constante ÚNICA da D3, `razaoMinimo`
  // parte do mesmo número nos dois modos. Convertê-lo pra dinheiro é regressão.
  const bateuPiso = razaoMinimo < params.PISO_PCT;
  if (bateuPiso) {
    razaoMinimo = params.PISO_PCT;
    // O TEXTO, sim, troca — sob girar "travou no custo real" nomearia a base
    // errada. Que a flag seja inalcançável com `REGUA_PADRAO` (teto efetivo dos
    // ajustes = 5 pt contra 6,6 pt de folga) NÃO dispensa: o AC10 permite editar
    // constante à mão, e é pro dia em que alguém editar que isto existe.
    alertas.push(
      `Sugestão bateu no ${MODO_PISO_LABEL[modo]} — não há espaço pra desconto. O mínimo travou n${rotuloBase}.`,
    );
  }

  let razaoComprePor = razaoMinimo / params.RAZAO_MINIMO_SOBRE_COMPRE_POR;

  // AC12 — pós-condição AVALIADA DEPOIS DO CLAMP: compre_por ≥ mínimo ≥ custo.
  // As constantes são editáveis à mão e uma edição desatenta de
  // RAZAO_MINIMO_SOBRE_COMPRE_POR (> 1) produziria um par INVERTIDO que a UI
  // mostraria sem reclamar. Guarda + teste, não bloqueio de fluxo.
  //
  // ⚠️ A invariante vale sobre o par SUGERIDO (saída determinística do motor) e
  // NUNCA sobre o par APLICADO (decisão do Marcos) — ADR-003 §11.
  if (!Number.isFinite(razaoComprePor) || razaoComprePor < razaoMinimo) {
    razaoComprePor = razaoMinimo;
    alertas.push(
      "Régua inconsistente: a razão mínimo÷compre-por produziria um compre por ABAIXO do mínimo. O compre por foi travado no mínimo — revise RAZAO_MINIMO_SOBRE_COMPRE_POR.",
    );
  }

  // ── Preços centavo-perfect — SOBRE `base(modo)` (sítios 1–4 da §12.4) ────
  // I1: minimo_sugerido ≥ base(modo) × PISO_PCT.
  let minimoSugerido = arredondarCentavos(base * razaoMinimo);
  if (minimoSugerido < base) minimoSugerido = base;
  let comprePorSugerido = arredondarCentavos(base * razaoComprePor);
  // I2: compre_por ≥ mínimo, incondicional nos dois modos.
  if (comprePorSugerido < minimoSugerido) comprePorSugerido = minimoSugerido;

  // ── Par ARREDONDADO — é o que preenche os campos de aplicar (AC18) ───────
  const minimoArredondado = arredondarRespeitandoPiso(minimoSugerido, base);
  const comprePorArredondado = arredondarRespeitandoPiso(comprePorSugerido, minimoArredondado);
  if (minimoArredondado !== arredondarParaCentena(minimoSugerido)) {
    // Sítio 5: o TEXTO também troca — número errado na tela não é cosmético.
    alertas.push(
      `Mínimo sugerido não foi arredondado pra centena: R$ 100 pra baixo cruzaria ${rotuloBase} (${formatBRL(base)}). Vale o valor exato.`,
    );
  }

  // ── Razões EFETIVAS: SOBRE `custo_real` NOS DOIS MODOS (ADR-003 §12.5) ───
  //
  // ⚠️ NÃO trocam de base, e o motivo é mais forte que "senão o COMMENT mente":
  // a coluna existe pra que `razão × custo_real` reproduza o preço gravado, e
  // essa identidade só sobrevive com DENOMINADOR UNIFORME entre modos.
  // `custo_real` é o único candidato uniforme (NOT NULL, verificado pelo
  // `rep_prec_custo_decomposto_chk`). Se o denominador variasse com o modo,
  // toda leitura futura precisaria saber o modo ANTES de saber o que a razão
  // significa.
  //
  // ⚠️ O round-trip fecha a ±R$ 0,01, NÃO exatamente, e isso é por construção:
  // `numeric(9,6)` não guarda o resto de 0,9819228… (PRD2189/girar: a volta dá
  // R$ 85.280,01 contra 85.280,00 gravados). O valor autoritativo é SEMPRE
  // `minimoSugerido`. NÃO é o bug crítico de centavo da AGENTS.md §4 — aqui o
  // centavo não é dinheiro, é arredondamento de grandeza derivada. A assimetria
  // entre modos é esperada: no recuperar a razão é a própria constante e o
  // round-trip fecha exato; só o girar produz razão não-terminante.
  const minimoRazaoEfetiva = arredondarRazao(minimoSugerido / custo.custoReal);
  const comprePorRazaoEfetiva = arredondarRazao(comprePorSugerido / custo.custoReal);

  // ── Confiança e referência do alerta (NUNCA o preço) ─────────────────────
  let confianca: ConfiancaSugestao;
  let fonteReferencia: FonteReferencia;
  let referenciaTeto: number | null;
  let rotuloReferencia: string;

  if (contexto.valorAutoAvaliar != null && contexto.valorAutoAvaliar > 0) {
    // AC13
    confianca = "alta";
    fonteReferencia = "auto_avaliar";
    referenciaTeto = contexto.valorAutoAvaliar;
    rotuloReferencia = "Ref. Auto Avaliar";
  } else if (contexto.valorFipe != null && contexto.valorFipe > 0) {
    // AC14 — os dois preços continuam saindo de custo × régua, INALTERADOS.
    confianca = "baixa";
    fonteReferencia = "fipe_ajustada";
    referenciaTeto = fipeAjustadaPorKm(
      contexto.valorFipe,
      contexto.km,
      entrada.anoModelo,
      entrada.anoReferencia,
      params,
    );
    rotuloReferencia = "FIPE ajustada por km";
    alertas.push(
      `Sem Ref. Auto Avaliar — usando a FIPE (${formatBRL(contexto.valorFipe)}) ajustada por km (${formatBRL(referenciaTeto)}) só como referência do alerta. A FIPE IGNORA quilometragem: o Amarok com 249 mil km fechou a 58,8% dela. O preço sugerido não muda por isso.`,
    );
  } else {
    // AC15 — sem referência: nenhum alerta de teto, mesma régua sobre o custo.
    confianca = "muito_baixa";
    fonteReferencia = "nenhuma";
    referenciaTeto = null;
    rotuloReferencia = "sem referência";
    alertas.push(
      "Sem Ref. Auto Avaliar e sem FIPE — não há referência de mercado pra checar a sugestão. A régua sobre o custo é a mesma; o que cai é a confiança.",
    );
  }

  // AC13 — teto SOBRE O MÍNIMO, jamais sobre o compre-por, e jamais trava.
  // Não existe alerta de piso ("muito abaixo da referência"): o Amarok é
  // justamente o caso em que ficar bem abaixo estava certo.
  if (referenciaTeto != null && referenciaTeto > 0) {
    const teto = referenciaTeto * params.TETO_REF_AA_PCT;
    if (minimoSugerido > teto) {
      alertas.push(
        `Mínimo sugerido (${formatBRL(minimoSugerido)}) passa de ${formatPct(params.TETO_REF_AA_PCT)} da ${rotuloReferencia} (${formatBRL(referenciaTeto)}). É só alerta — a referência informa, o custo manda. Heurística NÃO calibrada (n=4).`,
      );
    }
  }

  // ── Justificativa (AC17) — é o que faz a aba ser usada, não é enfeite ────
  //
  // A decomposição do custo PERMANECE sobre `custo_real` nos dois modos, e não
  // está em nenhuma das duas listas da §12.4: ela é `custo_real` porque *é* o
  // custo real — o custo do carro não muda com o modo de precificar. Sob girar,
  // é justamente ele que o Marcos está abrindo mão de recuperar.
  const partes: string[] = [
    `Custo real ${formatBRL(custo.custoReal)} = compra ${formatBRL(custo.valorCompraRepasse)} + ${custo.gastosQtde === 0 ? "sem gastos lançados" : `${custo.gastosQtde} gasto${custo.gastosQtde > 1 ? "s" : ""} ${formatBRL(custo.gastosTotal)}`}.`,
  ];
  if (modo === "girar_rapido") {
    // A régua é a MESMA — o que muda é sobre o que ela incide. Dizer "a mesma
    // mediana" é o ponto: não há constante própria do girar (D3).
    partes.push(
      `Mínimo ${formatPct(arredondarRazao(minimoSugerido / base))} da compra ${formatBRL(custo.valorCompraRepasse)} — a MESMA base de ${formatPct(params.REGUA_MINIMO_PCT)} (mediana do mínimo que vendeu em 16 repasses de jun–ago/2026), aplicada sobre a compra em vez do custo. Sobre o custo real isso dá ${formatPct(minimoRazaoEfetiva)}.`,
      `Compre por ${formatPct(arredondarRazao(comprePorSugerido / base))} da compra, derivado da razão mínimo÷compre-por de ${formatPct(params.RAZAO_MINIMO_SOBRE_COMPRE_POR)} observada nos mesmos vendidos.`,
    );
  } else {
    partes.push(
      `Mínimo ${formatPct(minimoRazaoEfetiva)} do custo (base ${formatPct(params.REGUA_MINIMO_PCT)} — mediana do mínimo que vendeu em 16 repasses de jun–ago/2026).`,
      `Compre por ${formatPct(comprePorRazaoEfetiva)}, derivado da razão mínimo÷compre-por de ${formatPct(params.RAZAO_MINIMO_SOBRE_COMPRE_POR)} observada nos mesmos vendidos.`,
    );
  }
  for (const a of ajustes) {
    partes.push(`Ajuste ${formatPontos(a.pontos)}: ${a.label}.`);
  }
  if (bateuPiso) {
    partes.push(
      `Os ajustes derrubariam o mínimo abaixo d${modo === "girar_rapido" ? "a compra" : "o custo"} — travou em ${formatPct(params.PISO_PCT)}.`,
    );
  }

  return {
    ok: true,
    modo,
    custo,
    contexto,
    minimoSugerido,
    comprePorSugerido,
    minimoArredondado,
    comprePorArredondado,
    minimoRazaoEfetiva,
    comprePorRazaoEfetiva,
    bateuPiso,
    confianca,
    fonteReferencia,
    referenciaTeto,
    ajustes,
    // C7 — quando existe, a banda é sobre `custo_real` (não trocou de base). O
    // que o girar faz é NÃO CALCULAR, não calcular sobre outra base.
    bandaMinimo:
      modo === "girar_rapido"
        ? null
        : {
            p25: arredondarCentavos(custo.custoReal * params.BANDA_MINIMO_P25_PCT),
            p75: arredondarCentavos(custo.custoReal * params.BANDA_MINIMO_P75_PCT),
          },
    justificativa: partes.join(" "),
    alertas,
    parametros: params,
    versaoRegua: versaoReguaComModo(modo),
  };
}

/**
 * Serialização dos parâmetros vigentes pro `parametros_regua JSONB NOT NULL` da
 * migration 030 — inclui o `REGUA_COMPRE_POR_PCT` DERIVADO, porque quem
 * recalibrar vai querer o número que de fato rodou, não só as âncoras.
 */
export function serializarParametrosRegua(
  params: ReguaPrecoRepasse = REGUA_PADRAO,
): Record<string, number> {
  return {
    ...params,
    REGUA_COMPRE_POR_PCT: reguaComprePorPct(params),
  };
}

/** Rótulos pt-BR dos níveis de confiança (UI). */
export const CONFIANCA_LABEL: Record<ConfiancaSugestao, string> = {
  alta: "Confiança alta",
  baixa: "Confiança baixa",
  muito_baixa: "Confiança muito baixa",
};

/** Explicação pt-BR do porquê da confiança (UI). */
export const CONFIANCA_MOTIVO: Record<ConfiancaSugestao, string> = {
  alta: "Ref. Auto Avaliar disponível pra checar a sugestão.",
  baixa: "Sem Ref. Auto Avaliar — checagem pela FIPE, que ignora km.",
  muito_baixa: "Sem nenhuma referência de mercado pra checar a sugestão.",
};
