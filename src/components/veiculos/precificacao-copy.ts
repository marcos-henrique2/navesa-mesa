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
    bg: "bg-emerald-50",
    text: "text-emerald-900",
    border: "border-emerald-200",
    borderWidth: "border",
    badgeBg: "bg-emerald-100",
    badgeText: "text-emerald-800",
    ctaBg: "bg-emerald-700",
    ctaText: "text-white",
    ctaHover: "hover:bg-emerald-800",
    Icon: CheckCircle,
    badgeLabel: "COERENTE",
  },
  subprecificado: {
    bg: "bg-amber-50",
    text: "text-amber-900",
    border: "border-amber-300",
    borderWidth: "border",
    badgeBg: "bg-amber-100",
    badgeText: "text-amber-800",
    ctaBg: "bg-amber-600",
    ctaText: "text-white",
    ctaHover: "hover:bg-amber-700",
    Icon: AlertTriangle,
    badgeLabel: "SUBPRECIFICADO",
  },
  subprecificado_grave: {
    bg: "bg-red-50",
    text: "text-red-900",
    border: "border-red-300",
    borderWidth: "border-2",
    badgeBg: "bg-red-100",
    badgeText: "text-red-800",
    ctaBg: "bg-red-600",
    ctaText: "text-white",
    ctaHover: "hover:bg-red-700",
    Icon: AlertOctagon,
    badgeLabel: "SUBPRECIFICADO",
  },
  acima_mercado: {
    bg: "bg-slate-100",
    text: "text-slate-900",
    border: "border-slate-300",
    borderWidth: "border",
    badgeBg: "bg-slate-200",
    badgeText: "text-slate-700",
    ctaBg: "bg-slate-700",
    ctaText: "text-white",
    ctaHover: "hover:bg-slate-800",
    Icon: TrendingDown,
    badgeLabel: "ACIMA DO MERCADO",
  },
  repasse: {
    bg: "bg-blue-50",
    text: "text-blue-900",
    border: "border-blue-300",
    borderWidth: "border",
    badgeBg: "bg-blue-100",
    badgeText: "text-blue-800",
    ctaBg: "bg-blue-600",
    ctaText: "text-white",
    ctaHover: "hover:bg-blue-700",
    Icon: ArrowRightLeft,
    badgeLabel: "CLASSIFICADO PRA REPASSE",
  },
  sem_dados: {
    bg: "bg-zinc-50",
    text: "text-zinc-700",
    border: "border-zinc-200",
    borderWidth: "border",
    badgeBg: "bg-zinc-200",
    badgeText: "text-zinc-700",
    ctaBg: "bg-zinc-400",
    ctaText: "text-white",
    ctaHover: "hover:bg-zinc-500",
    Icon: HelpCircle,
    badgeLabel: "SEM DADOS",
  },
};

export const TITULO_POR_STATUS: Record<DiagnosticoStatus, string> = {
  coerente: "Por que esse preço faz sentido",
  subprecificado: "Esse desconto NÃO faz sentido",
  subprecificado_grave: "Carro precificado MUITO ABAIXO do mercado",
  acima_mercado: "Preço pode estar travando o giro",
  repasse: "Por que classe E → repasse",
  sem_dados: "Não dá pra avaliar preço",
};

export const PRESELECAO_POR_STATUS: Record<DiagnosticoStatus, EstrategiaId | null> = {
  coerente: "target",
  subprecificado: "target",
  subprecificado_grave: "target",
  acima_mercado: "giro",
  repasse: "minimo",
  sem_dados: null,
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
