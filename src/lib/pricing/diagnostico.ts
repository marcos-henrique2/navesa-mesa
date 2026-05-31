/**
 * DIAGNÓSTICO DE COERÊNCIA — Fase A
 *
 * Compara o preço atual de cada veículo com um "preço esperado" calculado
 * a partir de: FIPE × ajuste por classe × ajustes (cautelar, dias pátio, km vs mediana).
 *
 * Saída: status enum (coerente / subprecificado / subprecificado_grave / acima_mercado
 *         / sem_dados / repasse) + desvio em R$ e % + lista de motivos.
 *
 * Princípio: o resultado tem que ser AUDITÁVEL. Cada ajuste é exposto, com label
 * pra UI mostrar pro avaliador EXATAMENTE por que sugerimos R$ X.
 *
 * Versionamento: a struct DIAGNOSTICO_PARAMS_V1 está congelada. Mudou parâmetro
 * → cria DIAGNOSTICO_PARAMS_V2, bump versao_formula. Sugestões antigas no DB
 * mantêm o snapshot da v1 e a versao_formula original.
 */

import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";
import type { Classe } from "@/lib/pricing/classificacao";
import type { StatusCautelar } from "@/lib/inventory/cautelar";

// ═══════════════════════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════════════════════

export type DiagnosticoStatus =
  | "coerente"
  | "subprecificado"
  | "subprecificado_grave"
  | "acima_mercado"
  | "sem_dados"
  | "repasse"; // classe E — não cabe diagnóstico padrão de showroom

export type AjusteDiagnostico = {
  /** Código estável (não muda em UI). Ex: 'base_classe', 'cautelar', 'dias_patio', 'km_vs_mediana'. */
  codigo: string;
  /** String human-readable pra UI (pt-BR). */
  label: string;
  /** Fração decimal: -0.03 = -3%. */
  pct: number;
};

export type DiagnosticoConfianca = {
  /** Veículo sem FIPE matched — usamos custo × 1.18 como proxy. */
  semFipe: boolean;
  /** Sem laudo cautelar registrado — assumimos neutro (0%) + flag. */
  semCautelar: boolean;
  /** Veículo sem km registrado — usamos heurística por idade pra mediana. */
  kmHeuristica: boolean;
  /** Veículo entrou há < 7 dias — suprime alerta de subprecificado (carro novo no estoque). */
  recemEntrado: boolean;
  /**
   * Veículo sem dias_patio registrado — não força recemEntrado=true (não suprime alertas)
   * e não aplica ajuste de tier de dias. Flag pra UI sinalizar baixa confiança.
   */
  semDiasPatio: boolean;
};

export type DiagnosticoResult = {
  status: DiagnosticoStatus;
  /** Preço calculado pela fórmula (R$). */
  precoEsperado: number;
  /** (precoAtual - precoEsperado) / precoEsperado. Negativo = abaixo do esperado. */
  desvioPct: number;
  /** desvioPct × precoEsperado (R$). */
  desvioReais: number;
  /** Base da classe aplicada (ex: -0.07 pra classe D). */
  baseClassePct: number;
  /** Lista de ajustes individuais aplicados (cautelar, dias, km). */
  ajustes: AjusteDiagnostico[];
  /** Soma de ajustes APÓS cap (ex: -0.10 mínimo, +0.02 máximo). */
  ajusteTotalPct: number;
  /** FIPE usada (ou null se não tinha). */
  precoFipe: number | null;
  /** Preço atual no estoque (ou null se faltava). */
  precoAtual: number | null;
  /** Copy livre pra UI mostrar contexto humanizado. */
  motivos: string[];
  /** Versão da fórmula usada (vai pro snapshot no DB). */
  versao: string;
  confianca: DiagnosticoConfianca;
};

// ═══════════════════════════════════════════════════════════════════════════
// PARÂMETROS — DIAGNOSTICO V1
// ═══════════════════════════════════════════════════════════════════════════

export const DIAGNOSTICO_PARAMS_V1 = {
  versao: "diagnostico_v1" as const,

  /** Base por classe (multiplicador sobre FIPE). Classe E também tem base, mas vira status 'repasse'. */
  baseClasse: { A: 0.02, B: 0, C: -0.03, D: -0.07, E: -0.12 } as Record<Classe, number>,

  /**
   * Ajuste por cautelar:
   * - aprovado: neutro
   * - com_restricao: -3%
   * - reprovado: ZERADO (classificacao.ts já força classe E → baseClasse cobre)
   * - sem_cautelar (null): neutro + flag confianca.semCautelar
   */
  ajusteCautelar: {
    aprovado: 0,
    com_restricao: -0.03,
    reprovado: 0,
    null_: 0,
  } as const,

  /** Ajuste por dias parado no pátio (tier). */
  ajusteDiasPatio: [
    { ate: 30, pct: 0 },
    { ate: 60, pct: -0.01 },
    { ate: 90, pct: -0.03 },
    { ate: Number.POSITIVE_INFINITY, pct: -0.05 },
  ] as const,

  /**
   * Ajuste por KM vs mediana do modelo/ano.
   * desvio = (km_carro - mediana) / mediana.
   */
  ajusteKmVsMediana: {
    desvio40Acima: -0.04,
    desvio20Acima: -0.02,
    desvio20Abaixo: 0.01,
  } as const,

  /** Cap aplicado na soma de ajustes (não na base por classe). */
  capAjustes: { min: -0.1, max: 0.02 } as const,

  /** Thresholds pra decidir status final a partir de desvioPct. */
  thresholds: {
    coerentePct: 0.03,
    subprecificadoPct: -0.03,
    subprecificadoGravePct: -0.07,
    acimaMercadoPct: 0.05,
  } as const,
} as const;

export type DiagnosticoParams = typeof DIAGNOSTICO_PARAMS_V1;

export type CalcularDiagnosticoInput = {
  veiculo: VeiculoParsed;
  classe: Classe;
  precoFipe: number | null;
  cautelar: StatusCautelar | null;
  /** Mediana de km do (marca, modelo, ano) ou fallback. null = sem dados confiáveis. */
  medianaKmModeloAno: number | null;
  /**
   * Flag opcional: a mediana veio de heurística (km/ano × idade), não de amostras reais.
   * Quando true, `confianca.kmHeuristica` é setado pra UI sinalizar baixa confiança.
   * Default: false.
   */
  medianaPorHeuristica?: boolean;
  params?: DiagnosticoParams;
};

// ═══════════════════════════════════════════════════════════════════════════
// CÁLCULO INDIVIDUAL
// ═══════════════════════════════════════════════════════════════════════════

/** Proxy quando não tem FIPE: custo × markup. */
const PROXY_CUSTO_MARKUP = 1.18;
/** Janela "recém-entrado" — suprime alerta de subprecificado pra carro novo. */
const RECEM_ENTRADO_DIAS = 7;

export function calcularDiagnostico(input: CalcularDiagnosticoInput): DiagnosticoResult {
  const params = input.params ?? DIAGNOSTICO_PARAMS_V1;
  const { veiculo, classe, precoFipe, cautelar, medianaKmModeloAno } = input;

  const precoAtual = veiculo.preco_venda;
  // FIX 2: mantém dias_patio como number | null. Sem dias_patio ≠ "carro recém-entrado".
  const diasPatio: number | null = veiculo.dias_patio ?? null;
  const semDiasPatio = diasPatio == null;
  const recemEntrado = diasPatio != null && diasPatio < RECEM_ENTRADO_DIAS;

  const confianca: DiagnosticoConfianca = {
    semFipe: precoFipe == null,
    semCautelar: cautelar == null,
    kmHeuristica: input.medianaPorHeuristica === true,
    recemEntrado,
    semDiasPatio,
  };

  // FIX 3: valida classe ANTES de qualquer aritmética. Classe fora de A-E vira sem_dados
  // com motivo explícito (em vez de NaN silencioso).
  if (!(classe in params.baseClasse)) {
    return {
      status: "sem_dados",
      precoEsperado: 0,
      desvioPct: 0,
      desvioReais: 0,
      baseClassePct: 0,
      ajustes: [],
      ajusteTotalPct: 0,
      precoFipe,
      precoAtual,
      motivos: [`Classe inválida: ${String(classe)} (esperado A/B/C/D/E)`],
      versao: params.versao,
      confianca,
    };
  }

  // ── BASE: preço de referência ──
  // FIPE direta OU proxy via custo de aquisição × 1.18
  const baseRef =
    precoFipe != null
      ? precoFipe
      : veiculo.valor_aquisicao != null
        ? veiculo.valor_aquisicao * PROXY_CUSTO_MARKUP
        : null;

  // ── SEM DADOS: nem FIPE, nem custo (ou custo zero/negativo) → não dá pra calcular ──
  // FIX 1: `baseRef == null` não capturava `valor_aquisicao=0` (vira 0, não null).
  // Agora também rejeita 0 e negativos pra evitar "coerente" falso com preço esperado 0.
  if (baseRef == null || baseRef <= 0) {
    return {
      status: "sem_dados",
      precoEsperado: 0,
      desvioPct: 0,
      desvioReais: 0,
      baseClassePct: 0,
      ajustes: [],
      ajusteTotalPct: 0,
      precoFipe,
      precoAtual,
      motivos: ["Sem FIPE matched e sem custo de aquisição — diagnóstico indisponível."],
      versao: params.versao,
      confianca,
    };
  }

  // ── BASE POR CLASSE ──
  const baseClassePct = params.baseClasse[classe];

  // ── AJUSTES INDIVIDUAIS ──
  const ajustes: AjusteDiagnostico[] = [];

  // 1) Cautelar
  const cautelarKey: "aprovado" | "com_restricao" | "reprovado" | "null_" =
    cautelar ?? "null_";
  const cautelarPct = params.ajusteCautelar[cautelarKey];
  if (cautelarPct !== 0) {
    ajustes.push({
      codigo: "cautelar",
      label:
        cautelar === "com_restricao"
          ? "Cautelar com restrição (-3%)"
          : `Cautelar ${cautelar} (${formatPct(cautelarPct)})`,
      pct: cautelarPct,
    });
  }

  // 2) Dias pátio — FIX 2: só aplica tier se dias_patio conhecido.
  // Quando null, ajuste fica 0 e a flag confianca.semDiasPatio sinaliza pra UI.
  if (diasPatio != null) {
    const tier = params.ajusteDiasPatio.find((t) => diasPatio <= t.ate);
    if (tier && tier.pct !== 0) {
      ajustes.push({
        codigo: "dias_patio",
        label: `${diasPatio} dias parado (${formatPct(tier.pct)})`,
        pct: tier.pct,
      });
    }
  }

  // 3) KM vs mediana
  if (medianaKmModeloAno != null && veiculo.km != null && medianaKmModeloAno > 0) {
    const desvio = (veiculo.km - medianaKmModeloAno) / medianaKmModeloAno;
    let kmPct = 0;
    let label = "";
    if (desvio >= 0.4) {
      kmPct = params.ajusteKmVsMediana.desvio40Acima;
      label = `KM ${formatPct(desvio)} acima da mediana (${formatPct(kmPct)})`;
    } else if (desvio >= 0.2) {
      kmPct = params.ajusteKmVsMediana.desvio20Acima;
      label = `KM ${formatPct(desvio)} acima da mediana (${formatPct(kmPct)})`;
    } else if (desvio <= -0.2) {
      kmPct = params.ajusteKmVsMediana.desvio20Abaixo;
      label = `KM ${formatPct(Math.abs(desvio))} abaixo da mediana (+${formatPct(kmPct).replace("+", "")})`;
    }
    if (kmPct !== 0) {
      ajustes.push({ codigo: "km_vs_mediana", label, pct: kmPct });
    }
  }

  // ── CAP NO SOMATÓRIO DE AJUSTES ──
  const somaAjustes = ajustes.reduce((acc, a) => acc + a.pct, 0);
  const ajusteTotalPct = Math.max(
    params.capAjustes.min,
    Math.min(params.capAjustes.max, somaAjustes),
  );

  // ── PREÇO ESPERADO ──
  const precoEsperado = baseRef * (1 + baseClassePct + ajusteTotalPct);

  // ── DESVIO ──
  const desvioPct =
    precoAtual != null && precoEsperado > 0 ? (precoAtual - precoEsperado) / precoEsperado : 0;
  const desvioReais = precoAtual != null ? precoAtual - precoEsperado : 0;

  // ── COPY DE MOTIVOS (humanizado pra UI) ──
  const motivos: string[] = [];
  motivos.push(`Classe ${classe} → base ${formatPct(baseClassePct)}`);
  if (confianca.semFipe) motivos.push("Sem FIPE matched — usando custo × 1.18 como proxy");
  if (confianca.semCautelar) motivos.push("Laudo cautelar não informado");
  if (confianca.kmHeuristica) motivos.push("Mediana de km estimada por heurística (poucas amostras)");
  if (confianca.recemEntrado) motivos.push(`Carro recém-entrado (${diasPatio} dias) — alerta de subprecificado suprimido`);
  if (confianca.semDiasPatio) motivos.push("Dias de pátio não informados — ajuste de permanência não aplicado");

  // ── STATUS ──
  let status: DiagnosticoStatus;
  if (classe === "E") {
    status = "repasse";
  } else if (precoAtual == null) {
    status = "sem_dados";
  } else {
    const t = params.thresholds;
    if (desvioPct >= t.acimaMercadoPct) {
      status = "acima_mercado";
    } else if (desvioPct <= t.subprecificadoGravePct) {
      status = recemEntrado ? "coerente" : "subprecificado_grave";
    } else if (desvioPct <= t.subprecificadoPct) {
      status = recemEntrado ? "coerente" : "subprecificado";
    } else {
      // dentro de ±coerentePct OU entre coerente e acimaMercado → coerente
      status = "coerente";
    }
  }

  return {
    status,
    precoEsperado: round2(precoEsperado),
    desvioPct: round4(desvioPct),
    desvioReais: round2(desvioReais),
    baseClassePct,
    ajustes,
    ajusteTotalPct: round4(ajusteTotalPct),
    precoFipe,
    precoAtual,
    motivos,
    versao: params.versao,
    confianca,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CÁLCULO EM LOTE (eficiente pra dashboards)
// ═══════════════════════════════════════════════════════════════════════════

export function computarDiagnosticoLista(args: {
  veiculos: VeiculoParsed[];
  classesPorChassi: Map<string, Classe>;
  fipeBatch: Record<string, number> | null;
  cautelaresPorChassi: Record<string, StatusCautelar>;
  /** Chave: `${marca}|${modelo}|${ano_modelo}` normalizado. */
  medianasKmPorChave: Map<string, number>;
  params?: DiagnosticoParams;
}): Map<string, DiagnosticoResult> {
  const out = new Map<string, DiagnosticoResult>();
  for (const v of args.veiculos) {
    const classe = args.classesPorChassi.get(v.chassi);
    if (!classe) continue; // sem classe → pula
    const precoFipe = args.fipeBatch?.[v.chassi] ?? null;
    const cautelar = args.cautelaresPorChassi[v.chassi] ?? null;
    const chaveMediana = chaveMedianaDe(v);
    const medianaKm = chaveMediana ? (args.medianasKmPorChave.get(chaveMediana) ?? null) : null;

    const r = calcularDiagnostico({
      veiculo: v,
      classe,
      precoFipe,
      cautelar,
      medianaKmModeloAno: medianaKm,
      params: args.params,
    });
    out.set(v.chassi, r);
  }
  return out;
}

function chaveMedianaDe(v: VeiculoParsed): string | null {
  const marca = (v.marca ?? "").trim().toUpperCase();
  const modelo = (v.modelo ?? "").trim().toUpperCase();
  const ano = v.ano_modelo ?? v.ano_fabricacao;
  if (!modelo || ano == null) return null;
  return `${marca}|${modelo}|${ano}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function formatPct(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(1)}%`;
}

// ═══════════════════════════════════════════════════════════════════════════
// LABELS PRA UI
// ═══════════════════════════════════════════════════════════════════════════

export const DIAGNOSTICO_LABEL: Record<DiagnosticoStatus, string> = {
  coerente: "Coerente",
  subprecificado: "Subprecificado",
  subprecificado_grave: "Subprecificado grave",
  acima_mercado: "Acima do mercado",
  sem_dados: "Sem dados",
  repasse: "Repasse (Classe E)",
};

export const DIAGNOSTICO_COR: Record<
  DiagnosticoStatus,
  { bg: string; text: string; border: string }
> = {
  coerente: { bg: "bg-emerald-100", text: "text-emerald-800", border: "border-emerald-300" },
  subprecificado: { bg: "bg-amber-100", text: "text-amber-800", border: "border-amber-300" },
  subprecificado_grave: { bg: "bg-orange-100", text: "text-orange-800", border: "border-orange-300" },
  acima_mercado: { bg: "bg-red-100", text: "text-red-800", border: "border-red-300" },
  sem_dados: { bg: "bg-slate-100", text: "text-slate-700", border: "border-slate-300" },
  repasse: { bg: "bg-purple-100", text: "text-purple-800", border: "border-purple-300" },
};
