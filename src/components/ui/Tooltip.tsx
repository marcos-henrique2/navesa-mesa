"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type Side = "right" | "top" | "bottom" | "left";

/**
 * Tooltip que funciona em hover (desktop) E tap (mobile/touch).
 *
 * - Desktop: hover/focus mostra com delay curto; click também abre ("fixa").
 * - Mobile: tap toggleia. Tap fora ou ESC fecha. Sem delay.
 * - Texto pode ser multi-linha (até max-w-xs); permite quebra.
 * - Posição padrão "top" cabe melhor em listas.
 */
export function Tooltip({
  content,
  children,
  side = "top",
  className,
  ariaLabel,
  focavel = true,
}: {
  content: ReactNode;
  children: ReactNode;
  side?: Side;
  className?: string;
  /** aria-label do gatilho (span focável). Útil quando `children` é só um ícone decorativo. */
  ariaLabel?: string;
  /**
   * `false` = o wrapper NÃO vira ponto de foco nem botão (use quando `children` já é
   * focável, ex. um <button>, ou quando o conteúdo já está acessível em texto). Abre no
   * hover e no foco do filho (onFocus/onBlur borbulham). Descreva o filho com
   * aria-describedby se o conteúdo do tooltip for importante.
   */
  focavel?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);

  // Fecha ao clicar fora (necessário pra fluxo touch — depois do tap, sai daí).
  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pos =
    side === "right"
      ? "left-full ml-2 top-1/2 -translate-y-1/2"
      : side === "left"
        ? "right-full mr-2 top-1/2 -translate-y-1/2"
        : side === "top"
          ? "bottom-full mb-2 left-1/2 -translate-x-1/2"
          : "top-full mt-2 left-1/2 -translate-x-1/2";

  return (
    <span
      ref={wrapRef}
      className={cn("relative inline-flex cursor-help", className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onClick={(e) => {
        // Em mobile (sem hover real), o tap dispara click. Toggle aqui resolve.
        // Em desktop o hover já abriu, então toggle apenas serve pra "fixar/fechar".
        e.stopPropagation();
        setOpen((v) => !v);
      }}
      tabIndex={focavel ? 0 : undefined}
      role={focavel ? "button" : undefined}
      aria-expanded={focavel ? open : undefined}
      aria-label={focavel ? ariaLabel : undefined}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          aria-hidden={focavel ? undefined : true}
          className={cn(
            "absolute z-50 max-w-[280px] whitespace-normal rounded-md border border-[var(--border-soft)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs leading-snug text-[var(--text-strong)] shadow-lg dark:bg-zinc-800 dark:text-white",
            pos,
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
}
