import type { ReactNode } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export type DirecaoUp = "good" | "bad";

/**
 * Linha de variação de um KPI (ícone + texto colorido). Sempre ícone + sinal, nunca só cor.
 * - direcaoUp "good" (vendas/margem): subiu = verde, caiu = vermelho
 * - direcaoUp "bad" (capital/dias): subiu = vermelho, caiu = verde
 * - `delta === 0`: neutro (muted + Minus)
 */
export function KpiDelta({
  delta,
  direcaoUp = "good",
  className,
  children,
}: {
  delta: number;
  direcaoUp?: DirecaoUp;
  className?: string;
  children: ReactNode;
}) {
  const subiu = delta > 0;
  const sem = delta === 0;
  const cor: "good" | "bad" | "neutral" = sem ? "neutral" : (direcaoUp === "good") === subiu ? "good" : "bad";
  const Icon = sem ? Minus : subiu ? TrendingUp : TrendingDown;

  return (
    <div
      className={cn(
        "mt-1 flex items-center gap-1 text-xs font-medium",
        cor === "good" && "text-emerald-700 dark:text-emerald-400",
        cor === "bad" && "text-red-700 dark:text-red-400",
        cor === "neutral" && "text-[var(--text-muted)]",
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {children}
    </div>
  );
}
