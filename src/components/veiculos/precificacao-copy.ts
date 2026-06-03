/**
 * Tabela de aparência + copy contextual por status do diagnóstico.
 *
 * Extraída do PrecificacaoBlock pra manter o componente principal abaixo do
 * limite de 600 linhas. Sem JSX — só constantes + funções puras.
 */

import {
  AlertOctagon,
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle,
  Clock,
  HelpCircle,
  TrendingDown,
} from "lucide-react";
import type { DiagnosticoResult, DiagnosticoStatus } from "@/lib/pricing/diagnostico";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";
import type { EstrategiaId } from "./StrategySelector";
import { formatBRL, cn } from "@/lib/utils";

export type Aparencia = {
  bg: string;
  text: string;
  border: string;
  borderWidth: string;
  badgeBg: string;
  badgeText: string;
  ctaBg: string;
  ctaText: string;
  ctaHover: string;
  Icon: typeof CheckCircle;
  badgeLabel: string;
};

export const APARENCIA: Record<DiagnosticoStatus, Aparencia> = {
  coerente: {
    bg: "bg-emerald-50 dark:bg-emerald-950/30",
    text: "text-emerald-900 dark:text-emerald-200",
    border: "border-emerald-200 dark:border-emerald-900",
    borderWidth: "border",
    badgeBg: "bg-emerald-100 dark:bg-emerald-900/40",
    badgeText: "text-emerald-800 dark:text-emerald-200",
    ctaBg: "bg-emerald-700",
    ctaText: "text-white",
    ctaHover: "hover:bg-emerald-800",
    Icon: CheckCircle,
    badgeLabel: "COERENTE",
  },
  subprecificado: {
    bg: "bg-amber-50 dark:bg-amber-950/30",
    text: "text-amber-900 dark:text-amber-200",
    border: "border-amber-300 dark:border-amber-900",
    borderWidth: "border",
    badgeBg: "bg-amber-100 dark:bg-amber-900/40",
    badgeText: "text-amber-800 dark:text-amber-200",
    ctaBg: "bg-amber-600",
    ctaText: "text-white",
    ctaHover: "hover:bg-amber-700",
    Icon: AlertTriangle,
    badgeLabel: "SUBPRECIFICADO",
  },
  subprecificado_grave: {
    bg: "bg-red-50 dark:bg-red-950/30",
    text: "text-red-900 dark:text-red-200",
    border: "border-red-300 dark:border-red-900",
    borderWidth: "border-2",
    badgeBg: "bg-red-100 dark:bg-red-900/40",
    badgeText: "text-red-800 dark:text-red-200",
    ctaBg: "bg-red-600",
    ctaText: "text-white",
    ctaHover: "hover:bg-red-700",
    Icon: AlertOctagon,
    badgeLabel: "SUBPRECIFICADO",
  },
  acima_mercado: {
    bg: "bg-[var(--bg-muted)]",
    text: "text-[var(--text-strong)]",
    border: "border-[var(--border-base)]",
    borderWidth: "border",
    badgeBg: "bg-[var(--border-soft)]",
    badgeText: "text-[var(--text-body)]",
    ctaBg: "bg-slate-700",
    ctaText: "text-white",
    ctaHover: "hover:bg-slate-800",
    Icon: TrendingDown,
    badgeLabel: "ACIMA DO MERCADO",
  },
  repasse: {
    bg: "bg-blue-50 dark:bg-blue-950/30",
    text: "text-blue-900 dark:text-blue-200",
    border: "border-blue-300 dark:border-blue-900",
    borderWidth: "border",
    badgeBg: "bg-blue-100 dark:bg-blue-900/40",
    badgeText: "text-blue-800 dark:text-blue-200",
    ctaBg: "bg-blue-600",
    ctaText: "text-white",
    ctaHover: "hover:bg-blue-700",
    Icon: ArrowRightLeft,
    badgeLabel: "CLASSIFICADO PRA REPASSE",
  },
  sem_dados: {
    bg: "bg-[var(--bg-muted)]",
    text: "text-[var(--text-body)]",
    border: "border-[var(--border-soft)]",
    borderWidth: "border",
    badgeBg: "bg-[var(--border-soft)]",
    badgeText: "text-[var(--text-body)]",
    ctaBg: "bg-zinc-400",
    ctaText: "text-white",
    ctaHover: "hover:bg-zinc-500",
    Icon: HelpCircle,
    badgeLabel: "SEM DADOS",
  },
  parado: {
    bg: "bg-amber-50 dark:bg-amber-950/30",
    text: "text-amber-900 dark:text-amber-200",
    border: "border-amber-300 dark:border-amber-900",
    borderWidth: "border",
    badgeBg: "bg-amber-100 dark:bg-amber-900/40",
    badgeText: "text-amber-800 dark:text-amber-200",
    ctaBg: "bg-amber-600",
    ctaText: "text-white",
    ctaHover: "hover:bg-amber-700",
    Icon: Clock,
    badgeLabel: "PARADO",
  },
  negativo: {
    bg: "bg-red-50 dark:bg-red-950/30",
    text: "text-red-800 dark:text-red-200",
    border: "border-red-300 dark:border-red-900",
    borderWidth: "border",
    badgeBg: "bg-red-100 dark:bg-red-900/40",
    badgeText: "text-red-800 dark:text-red-200",
    ctaBg: "bg-red-700",
    ctaText: "text-white",
    ctaHover: "hover:bg-red-800",
    Icon: TrendingDown,
    badgeLabel: "PREÇO ABAIXO DO CUSTO",
  },
};

export const TITULO_POR_STATUS: Record<DiagnosticoStatus, string> = {
  coerente: "Por que esse preço faz sentido",
  subprecificado: "Esse desconto NÃO faz sentido",
  subprecificado_grave: "Carro precificado MUITO ABAIXO do mercado",
  acima_mercado: "Preço pode estar travando o giro",
  repasse: "Por que classe E → repasse",
  sem_dados: "Não dá pra avaliar preço",
  parado: "Preço pode estar OK, mas o tempo de venda passou da meta",
  negativo: "Vender por esse valor dá prejuízo — repasse é a saída",
};

export const PRESELECAO_POR_STATUS: Record<DiagnosticoStatus, EstrategiaId | null> = {
  coerente: "target",
  subprecificado: "target",
  subprecificado_grave: "target",
  acima_mercado: "giro",
  repasse: "minimo",
  sem_dados: null,
  parado: "giro",
  negativo: "minimo",
};

// ─── Funções de copy contextual ─────────────────────────────────────────────

export function renderMetricaLateral(
  d: DiagnosticoResult,
  v: VeiculoParsed,
): { texto: string; classe: string } | null {
  const classeBase = "font-semibold";
  switch (d.status) {
    case "coerente": {
      const partes: string[] = [];
      const classe = inferirClasse(d.baseClassePct);
      if (classe) partes.push(`Classe ${classe}`);
      if (v.dias_patio != null) partes.push(`${v.dias_patio} dias`);
      if (partes.length === 0) return null;
      return { texto: partes.join(" · "), classe: "text-xs opacity-80" };
    }
    case "subprecificado": {
      const margem = d.desvioReais;
      return {
        texto: `Margem na mesa: ${formatBRL(Math.abs(margem))}`,
        classe: classeBase,
      };
    }
    case "subprecificado_grave": {
      const margem = d.desvioReais;
      return {
        texto: `Margem: ${formatBRL(Math.abs(margem))}`,
        classe: cn(classeBase, "text-red-700"),
      };
    }
    case "acima_mercado": {
      if (v.dias_patio == null) return null;
      return {
        texto: `Giro: ${v.dias_patio} dias parado`,
        classe: classeBase,
      };
    }
    case "repasse":
      return {
        texto: "Classe E · Não otimizar pra show room",
        classe: "text-xs opacity-80",
      };
    case "parado": {
      // Sempre tem dias_patio (o status só dispara com dias_patio > limite),
      // mas guarda redundante por segurança.
      if (v.dias_patio == null) return null;
      return {
        texto: `${v.dias_patio} dias no pátio · meta 60`,
        classe: classeBase,
      };
    }
    case "negativo": {
      // d.precoAtual e v.custo_total garantidos pelo decisor (status só dispara com ambos).
      if (v.custo_total == null || d.precoAtual == null) return null;
      const prejuizo = v.custo_total - d.precoAtual;
      return {
        texto: `Prejuízo: -${formatBRL(prejuizo)}`,
        classe: cn(classeBase, "text-red-700"),
      };
    }
    case "sem_dados":
      return null;
    default:
      return null;
  }
}

export function renderFechamento(d: DiagnosticoResult): string | null {
  switch (d.status) {
    case "coerente":
      return "O preço atual está dentro da janela esperada pelos critérios do mesa.";
    case "subprecificado":
      return "Subir o preço pode capturar a margem deixada na mesa sem comprometer o giro.";
    case "subprecificado_grave":
      return "Diferença significativa entre preço atual e o esperado — revisar com urgência.";
    case "acima_mercado":
      return "Preço acima do esperado pode estar segurando o carro no pátio. Considere baixar.";
    case "repasse":
      return "Veículos classe E (fora do perfil show room) não devem entrar no fluxo de otimização de preço — encaminhar pra repasse.";
    case "parado":
      return "Diagnóstico técnico está OK, mas o carro travou no pátio. Problema é canal/exposição — considere giro rápido.";
    case "negativo":
      return "Preço atual está abaixo do custo total. Vender assim dá prejuízo — encaminhar pra repasse.";
    case "sem_dados":
      return d.motivos[0] ?? null;
    default:
      return null;
  }
}

/**
 * Remove alertas operacionais que seriam redundantes com os chips de confiança.
 * Ex: chip "recém-chegado" suprime alerta "Parado há X dias" (carro fresco).
 */
export function deduplicarAvisos(
  alertas: string[],
  confianca: DiagnosticoResult["confianca"],
  diasPatio: number | null,
): string[] {
  return alertas.filter((a) => {
    const lower = a.toLowerCase();
    if (confianca.recemEntrado && /parado/.test(lower)) return false;
    if (diasPatio == null && /parado/.test(lower)) return false;
    return true;
  });
}

function inferirClasse(baseClassePct: number): string | null {
  const TABELA: Array<[number, string]> = [
    [0.02, "A"],
    [0, "B"],
    [-0.03, "C"],
    [-0.07, "D"],
    [-0.12, "E"],
  ];
  for (const [pct, classe] of TABELA) {
    if (Math.abs(baseClassePct - pct) < 1e-9) return classe;
  }
  return null;
}
