/**
 * Núcleo de inteligência de margem do repasse.
 * Épico "Inteligência de Repasse" — Stories 1.2 (relatório) e 1.3 (semáforo/simulador/alertas).
 *
 * ┌─ REGRA DE OURO ────────────────────────────────────────────────────────────┐
 * │ custo_real = valor_compra_repasse + Σ repasse_gastos.                       │
 * │ NUNCA usar valor_aquisicao — ele é custo de VAREJO (venda ao consumidor);   │
 * │ repasse é B2B, base de custo MENOR. Cair pra valor_aquisicao acende carros  │
 * │ vermelhos falsos.                                                            │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * "Dados incompletos": se valor_compra_repasse, valor_minimo OU valor_compre_por
 * for nulo → NUNCA calcular margem/cor, NUNCA cair pra valor_aquisicao. Cor neutra.
 *
 * Tudo puro (sem side-effects) e centavo-perfect (numeric(12,2) do banco).
 * `classificarMargem` é a ÚNICA função canônica de cor — badge e simulador a usam.
 */

// ─── Cor do semáforo ─────────────────────────────────────────────────────────

export type CorMargem = "verde" | "amarelo" | "laranja" | "vermelho" | "neutro";

export const COR_MARGEM_LABEL: Record<CorMargem, string> = {
  verde: "No compre-por ou acima",
  amarelo: "Entre mínimo e compre-por",
  laranja: "Abaixo do mínimo (acima do custo)",
  vermelho: "Abaixo do custo (prejuízo)",
  neutro: "Dados incompletos",
};

export const COR_MARGEM_EMOJI: Record<CorMargem, string> = {
  verde: "🟢",
  amarelo: "🟡",
  laranja: "🟠",
  vermelho: "🔴",
  neutro: "⚪",
};

// ─── Guards / arredondamento centavo-perfect ─────────────────────────────────

function isNumFinito(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Arredonda pra 2 casas (centavo-perfect). Soma/subtração em ponto flutuante
 * pode driftar (ex.: 100.10 + 200.20 = 300.29999…); aqui garantimos o centavo.
 */
function arredondar2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/**
 * Soma centavo-perfect de valores já arredondados. Acumular em ponto flutuante
 * drifta (0.1 + 0.2 = 0.30000000000000004); o arredondamento final garante o
 * centavo em totais de KPI.
 */
export function somarCentavos(valores: ReadonlyArray<number>): number {
  let soma = 0;
  for (const v of valores) soma += v;
  return arredondar2(soma);
}

// ─── custo_real ──────────────────────────────────────────────────────────────

/**
 * custo_real = valor_compra_repasse + Σ gastos.
 * Retorna null ("dados incompletos") se valor_compra_repasse for nulo/ inválido.
 * Gastos nulos/ inválidos são ignorados (contam como 0). NUNCA usa valor_aquisicao.
 */
export function calcularCustoReal(
  valorCompraRepasse: number | null | undefined,
  gastos: ReadonlyArray<number | null | undefined> = [],
): number | null {
  if (!isNumFinito(valorCompraRepasse)) return null;
  let soma = valorCompraRepasse;
  for (const g of gastos) {
    if (isNumFinito(g)) soma += g;
  }
  return arredondar2(soma);
}

// ─── Margem (R$ e %) ─────────────────────────────────────────────────────────

/** Margem em R$ = oferta − custo_real. null se algum for inválido. Centavo-perfect. */
export function calcularMargemValor(
  oferta: number | null | undefined,
  custoReal: number | null | undefined,
): number | null {
  if (!isNumFinito(oferta) || !isNumFinito(custoReal)) return null;
  return arredondar2(oferta - custoReal);
}

/**
 * Margem em % SEMPRE sobre custo_real = (oferta − custo_real) / custo_real × 100.
 * null se algum for inválido OU se custo_real == 0 (guarda de divisão por zero).
 */
export function calcularMargemPct(
  oferta: number | null | undefined,
  custoReal: number | null | undefined,
): number | null {
  if (!isNumFinito(oferta) || !isNumFinito(custoReal)) return null;
  if (custoReal === 0) return null; // guarda div/0
  return ((oferta - custoReal) / custoReal) * 100;
}

// ─── Classificação canônica (semáforo) ───────────────────────────────────────

export type ClassificacaoMargem = {
  cor: CorMargem;
  /** true quando os 3 valores do carro (custo/mínimo/compre-por) e a oferta são válidos. */
  completo: boolean;
};

/**
 * FUNÇÃO CANÔNICA ÚNICA de cor. Badge e simulador usam ESTA função.
 *
 * Ordem de avaliação (NÃO trocar — a ordem é a regra):
 *   1. oferta <  custo_real   → 🔴 vermelho (prejuízo)
 *   2. oferta >= compre_por    → 🟢 verde
 *   3. oferta >= minimo        → 🟡 amarelo
 *   4. senão                   → 🟠 laranja
 *
 * Qualquer valor nulo/ inválido (custo_real, minimo, compre_por ou oferta) →
 * neutro "dados incompletos". A regra 1 vir antes da 3 garante que um carro com
 * minimo < custo_real produz 🔴 (nunca 🟠) nas ofertas abaixo do custo.
 */
export function classificarMargem(
  oferta: number | null | undefined,
  custoReal: number | null | undefined,
  minimo: number | null | undefined,
  comprePor: number | null | undefined,
): ClassificacaoMargem {
  if (
    !isNumFinito(oferta) ||
    !isNumFinito(custoReal) ||
    !isNumFinito(minimo) ||
    !isNumFinito(comprePor)
  ) {
    return { cor: "neutro", completo: false };
  }
  if (oferta < custoReal) return { cor: "vermelho", completo: true };
  if (oferta >= comprePor) return { cor: "verde", completo: true };
  if (oferta >= minimo) return { cor: "amarelo", completo: true };
  return { cor: "laranja", completo: true };
}

/**
 * Cor do BADGE na listagem (sem oferta digitada): avalia a função canônica em
 * oferta = valor_compre_por (o preço do anúncio). Fica 🟢 no normal e 🔴 nos
 * carros anunciados abaixo do custo.
 */
export function classificarBadge(
  custoReal: number | null | undefined,
  minimo: number | null | undefined,
  comprePor: number | null | undefined,
): ClassificacaoMargem {
  return classificarMargem(comprePor, custoReal, minimo, comprePor);
}

// ─── Simulador de lance ──────────────────────────────────────────────────────

export type SimulacaoLance = {
  /** false só quando a oferta digitada é inválida (0, negativa ou não-numérica). */
  valido: boolean;
  /** true quando há margem/cor calculada (oferta válida E dados completos). */
  completo: boolean;
  /** Mensagem pro usuário quando não há cálculo (input inválido ou dados incompletos). */
  motivo: string | null;
  cor: CorMargem;
  margemValor: number | null;
  margemPct: number | null;
  abaixoDoMinimo: boolean;
  /** oferta < custo_real — PREJUÍZO. */
  abaixoDoCusto: boolean;
};

export type DadosCarroSimulacao = {
  custoReal: number | null;
  minimo: number | null;
  comprePor: number | null;
};

/**
 * Simula um lance do cliente. Output imediato: margem R$ (oferta − custo_real),
 * margem % (sobre custo_real), cor canônica e flags "abaixo do mínimo" / "abaixo
 * do custo (prejuízo)".
 *
 * Guardas:
 *   - oferta 0 / negativa / não-numérica → não calcula (valido = false).
 *   - dados incompletos (custo/mínimo/compre-por nulos) → sem cálculo, cor neutra.
 *   - custo_real == 0 → margem % fica null (div/0), margem R$ ainda calcula.
 */
export function simularLance(
  oferta: number | null | undefined,
  dados: DadosCarroSimulacao,
): SimulacaoLance {
  const vazio: SimulacaoLance = {
    valido: false,
    completo: false,
    motivo: null,
    cor: "neutro",
    margemValor: null,
    margemPct: null,
    abaixoDoMinimo: false,
    abaixoDoCusto: false,
  };

  // Guarda de input: oferta precisa ser number finito e > 0.
  if (!isNumFinito(oferta) || oferta <= 0) {
    return { ...vazio, motivo: "Informe uma oferta válida (maior que zero)." };
  }

  const { custoReal, minimo, comprePor } = dados;
  if (!isNumFinito(custoReal) || !isNumFinito(minimo) || !isNumFinito(comprePor)) {
    // Input válido, mas o carro está com dados incompletos → sem margem/cor.
    return { ...vazio, valido: true, motivo: "Dados incompletos — margem indisponível." };
  }

  return {
    valido: true,
    completo: true,
    motivo: null,
    cor: classificarMargem(oferta, custoReal, minimo, comprePor).cor,
    margemValor: calcularMargemValor(oferta, custoReal),
    margemPct: calcularMargemPct(oferta, custoReal),
    abaixoDoMinimo: oferta < minimo,
    abaixoDoCusto: oferta < custoReal,
  };
}

// ─── Dias no repasse ─────────────────────────────────────────────────────────

/** Parseia YYYY-MM-DD (date do Postgres) pra epoch UTC. null se formato inválido. */
function parseDataUTC(s: string | null | undefined): number | null {
  if (typeof s !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * dias_no_repasse, a partir da data em que o carro entrou NO AR:
 *   - parado (não vendido): hoje − dataInicio
 *   - vendido:              data_vendido − dataInicio
 *   - dataInicio nula:      null (UI mostra "—")
 *
 * `dataInicio` é `data_subido` (ver `montarItemAnuncio`, único chamador) — NÃO
 * `data_subiu`, que é a data de MARCAÇÃO e infla a contagem nos carros que
 * ficaram parados entre marcar e subir.
 *
 * `hoje` em YYYY-MM-DD. Retorna dias inteiros ≥ 0.
 */
export function calcularDiasNoRepasse(
  dataInicio: string | null | undefined,
  dataVendido: string | null | undefined,
  hoje: string,
): number | null {
  const ini = parseDataUTC(dataInicio);
  if (ini == null) return null;
  const fim = parseDataUTC(dataVendido ?? hoje);
  if (fim == null) return null;
  const dias = Math.floor((fim - ini) / 86_400_000);
  return dias < 0 ? 0 : dias;
}
