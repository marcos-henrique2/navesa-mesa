"use client";

/**
 * Chip de confiança do diagnóstico.
 *
 * Aparece ao lado do badge principal pra sinalizar que o cálculo tem ressalvas
 * (sem FIPE, sem cautelar, km por heurística, etc.). NÃO muda o status — só
 * adiciona contexto pro avaliador.
 */

import { cn } from "@/lib/utils";

export type ConfidenceChipType =
  | "no-fipe"
  | "no-cautelar"
  | "km-heuristic"
  | "no-dias-patio"
  | "fresh";

type Props = {
  type: ConfidenceChipType;
  diasPatio?: number | null;
};

const CONFIG: Record<
  ConfidenceChipType,
  { label: (diasPatio?: number | null) => string; tooltip: string; tone: "amber" | "blue" }
> = {
  "no-fipe": {
    label: () => "Confiança média",
    tooltip: "FIPE indisponível — diagnóstico baseado em custo + classe",
    tone: "amber",
  },
  "no-cautelar": {
    label: () => "Cautelar pendente",
    tooltip: "Pode mudar diagnóstico — registre cautelar",
    tone: "amber",
  },
  "km-heuristic": {
    label: () => "KM por heurística",
    tooltip: "Poucos comparáveis no estoque — KM estimado por idade",
    tone: "amber",
  },
  "no-dias-patio": {
    label: () => "Sem dias pátio",
    tooltip: "Permanência não considerada no cálculo",
    tone: "amber",
  },
  fresh: {
    label: (d) => `Recém-chegado · ${d ?? "?"} dia${d === 1 ? "" : "s"}`,
    tooltip: "Aguardando 7 dias pra avaliar tendência de preço",
    tone: "blue",
  },
};

export function ConfidenceChip({ type, diasPatio }: Props) {
  const cfg = CONFIG[type];
  return (
    <span
      title={cfg.tooltip}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
        cfg.tone === "amber" && "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
        cfg.tone === "blue" && "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
      )}
    >
      {cfg.label(diasPatio)}
    </span>
  );
}
