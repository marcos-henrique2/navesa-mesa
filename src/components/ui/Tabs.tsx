"use client";

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type TabItem<T extends string> = { id: T; rotulo: string; contador?: ReactNode };

/**
 * Tablist ARIA (padrão de ImportarAutoAvaliar): roving tabindex, ←/→ circulam, Home/End vão
 * às pontas. Só o painel ATIVO existe no DOM — `aria-controls` aponta só pra ele.
 * Rolagem horizontal no celular (sem barra visível) com a aba ativa centralizada.
 * `onChange(id, viaTeclado)` — quem usa decide se foca o painel (só ao trocar por teclado).
 */
export function Tabs<T extends string>({
  itens,
  ativa,
  onChange,
  ariaLabel,
  idBase,
  className,
}: {
  itens: readonly TabItem<T>[];
  ativa: T;
  onChange: (id: T, viaTeclado: boolean) => void;
  ariaLabel: string;
  idBase: string;
  className?: string;
}) {
  const refs = useRef<Map<T, HTMLButtonElement>>(new Map());

  useEffect(() => {
    refs.current.get(ativa)?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [ativa]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const i = itens.findIndex((t) => t.id === ativa);
    const n = itens.length;
    const destino =
      e.key === "ArrowRight" ? itens[(i + 1) % n]
      : e.key === "ArrowLeft" ? itens[(i - 1 + n) % n]
      : e.key === "Home" ? itens[0]
      : e.key === "End" ? itens[n - 1]
      : undefined;
    if (!destino) return;
    e.preventDefault();
    onChange(destino.id, true);
    refs.current.get(destino.id)?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cn("flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", className)}
    >
      {itens.map((t) => {
        const sel = t.id === ativa;
        return (
          <button
            key={t.id}
            ref={(el) => {
              if (el) refs.current.set(t.id, el);
              else refs.current.delete(t.id);
            }}
            type="button"
            role="tab"
            id={`${idBase}-tab-${t.id}`}
            aria-selected={sel}
            aria-controls={sel ? `${idBase}-painel-${t.id}` : undefined}
            tabIndex={sel ? 0 : -1}
            onClick={() => onChange(t.id, false)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--brand-700)]",
              sel
                ? "border-[var(--brand-700)] text-[var(--brand-700)] dark:border-[var(--brand-400)] dark:text-[var(--brand-300)]"
                : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-body)]",
            )}
          >
            {t.rotulo}
            {t.contador != null && (
              <span className="rounded-full bg-[var(--bg-muted)] px-1.5 py-0.5 text-[11px] tabular-nums text-[var(--text-body)]">{t.contador}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
