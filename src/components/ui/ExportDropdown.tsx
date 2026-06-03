"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * EXPORT DROPDOWN — botão principal com seta que abre menu de opções.
 * Usado pra agrupar "Exportar XLSX" + "Exportar PDF" sob um único botão por relatório.
 *
 * Comportamento:
 * - Click no botão → toggle do menu
 * - Click fora ou ESC → fecha
 * - Cada item executa `onSelect` e fecha o menu
 * - `disabled` propaga pro botão principal e desabilita o toggle
 */

export type ExportDropdownItem = {
  label: string;
  description?: string;
  icon?: ReactNode;
  onSelect: () => void | Promise<void>;
  disabled?: boolean;
};

export type ExportDropdownProps = {
  /** Conteúdo do botão principal (ícone + texto). */
  trigger: ReactNode;
  items: ExportDropdownItem[];
  /** Desabilita botão + menu. */
  disabled?: boolean;
  /** Classes Tailwind aplicadas no botão. */
  buttonClassName?: string;
  /** Texto de title= no botão (tooltip). */
  title?: string;
  /** Alinhamento horizontal do menu. */
  align?: "left" | "right";
};

export function ExportDropdown({
  trigger,
  items,
  disabled = false,
  buttonClassName,
  title,
  align = "right",
}: ExportDropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (ev: MouseEvent) => {
      if (!rootRef.current) return;
      if (rootRef.current.contains(ev.target as Node)) return;
      setOpen(false);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50",
          buttonClassName,
        )}
      >
        {trigger}
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div
          role="menu"
          className={cn(
            "absolute top-full mt-1 z-30 w-60 rounded-md border border-[var(--border-soft)] bg-[var(--bg-surface)] shadow-lg",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {items.map((item, idx) => (
            <button
              key={idx}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={async () => {
                if (item.disabled) return;
                setOpen(false);
                await item.onSelect();
              }}
              className={cn(
                "flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--bg-muted)] disabled:cursor-not-allowed disabled:opacity-50",
                idx === 0 && "rounded-t-md",
                idx === items.length - 1 && "rounded-b-md",
              )}
            >
              {item.icon && <span className="mt-0.5 shrink-0">{item.icon}</span>}
              <span className="flex-1">
                <span className="block font-medium text-[var(--text-strong)]">{item.label}</span>
                {item.description && (
                  <span className="mt-0.5 block text-xs text-[var(--text-muted)]">
                    {item.description}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
