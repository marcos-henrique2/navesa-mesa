"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

const FOCAVEIS = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Painel inferior modal (filtros no celular): `role="dialog"`, foco preso dentro, ESC e
 * toque no fundo fecham, foco volta pra quem abriu.
 */
export function BottomSheet({
  aberto,
  onFechar,
  titulo,
  children,
  rodape,
}: {
  aberto: boolean;
  onFechar: () => void;
  titulo: string;
  children: ReactNode;
  rodape?: ReactNode;
}) {
  const painelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!aberto) return;
    const anterior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Trava a rolagem da página atrás do painel enquanto ele está aberto.
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const painel = painelRef.current;
    painel?.querySelector<HTMLElement>(FOCAVEIS)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onFechar();
        return;
      }
      if (e.key !== "Tab" || !painel) return;
      const els = [...painel.querySelectorAll<HTMLElement>(FOCAVEIS)];
      if (els.length === 0) return;
      const primeiro = els[0];
      const ultimo = els[els.length - 1];
      if (e.shiftKey && document.activeElement === primeiro) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primeiro.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflowAnterior;
      anterior?.focus();
    };
  }, [aberto, onFechar]);

  if (!aberto) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={onFechar}>
      <div
        ref={painelRef}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full flex-col rounded-t-2xl border-t border-[var(--border-soft)] bg-[var(--bg-surface)] shadow-[var(--shadow-lg)]"
      >
        <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-4 py-3">
          <h2 className="text-sm font-semibold text-[var(--text-strong)]">{titulo}</h2>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar"
            className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-700)]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">{children}</div>
        {rodape && <div className="border-t border-[var(--border-soft)] px-4 py-3">{rodape}</div>}
      </div>
    </div>
  );
}
