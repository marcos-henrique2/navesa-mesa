"use client";

import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

export type SegmentedOpcao<T extends string> = { valor: T; label: string };

/**
 * Toggle segmentado (radiogroup). Setas ←/→ trocam a opção e movem o foco; só a opção
 * marcada fica na ordem de Tab (roving tabindex).
 */
export function SegmentedToggle<T extends string>({
  opcoes,
  valor,
  onChange,
  ariaLabel,
  className,
}: {
  opcoes: readonly SegmentedOpcao<T>[];
  valor: T;
  onChange: (v: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const prox = (i + (e.key === "ArrowRight" ? 1 : -1) + opcoes.length) % opcoes.length;
    onChange(opcoes[prox].valor);
    refs.current[prox]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn("inline-flex rounded-lg border border-[var(--border-soft)] bg-[var(--bg-muted)] p-0.5", className)}
    >
      {opcoes.map((o, i) => {
        const ativo = o.valor === valor;
        return (
          <button
            key={o.valor}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={ativo}
            tabIndex={ativo ? 0 : -1}
            onClick={() => onChange(o.valor)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-700)]",
              ativo
                ? "bg-[var(--bg-surface)] text-[var(--text-strong)] shadow-sm"
                : "text-[var(--text-muted)] hover:text-[var(--text-body)]",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
