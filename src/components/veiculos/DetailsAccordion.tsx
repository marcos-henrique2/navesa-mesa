"use client";

/**
 * Wrapper colapsável genérico pro `PrecificacaoBlock`.
 *
 * Comporta-se como `<details>` mas com transição CSS suave e header customizável.
 * Quando colapsado, mostra `summary` (resumo curto, ex: "FIPE 008327 · 3 avisos").
 * Quando expandido, mostra `children`.
 */

import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  label: string;
  /** Resumo curto exibido ao lado do label quando colapsado. */
  summary?: ReactNode;
  /** Conteúdo expandido. */
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
};

export function DetailsAccordion({
  label,
  summary,
  children,
  defaultOpen = false,
  className,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <div className={cn("border-t border-current/10 pt-3", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className={cn(
          "flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-xs font-medium",
          "hover:bg-white/40 focus:outline-none focus:ring-2 focus:ring-current/20",
        )}
      >
        <span className="flex items-center gap-2">
          <ChevronDown
            aria-hidden="true"
            className={cn("h-4 w-4 transition-transform", open && "rotate-180")}
          />
          <span>{label}</span>
        </span>
        {summary && !open && (
          <span className="text-[11px] font-normal opacity-70">{summary}</span>
        )}
      </button>
      {open && (
        <div id={panelId} className="mt-2 space-y-4 px-2 pb-1">
          {children}
        </div>
      )}
    </div>
  );
}
