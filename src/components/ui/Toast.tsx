"use client";

import { useEffect, useState, useCallback } from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastVariant = "success" | "error" | "info";

type Toast = {
  id: string;
  message: string;
  variant: ToastVariant;
};

// Store global simples em memória + observers — evita prop drilling e dependência de provider.
let toasts: Toast[] = [];
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

function pushToast(message: string, variant: ToastVariant) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  toasts = [...toasts, { id, message, variant }];
  notify();
  // auto-dismiss em 4s
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    notify();
  }, 4000);
}

export function showSuccessToast(message: string): void {
  pushToast(message, "success");
}

export function showErrorToast(message: string): void {
  pushToast(message, "error");
}

export function showInfoToast(message: string): void {
  pushToast(message, "info");
}

export function ToastContainer() {
  const [items, setItems] = useState<Toast[]>(toasts);

  useEffect(() => {
    const update = () => setItems([...toasts]);
    listeners.add(update);
    // Sincroniza com o estado atual caso algum toast tenha sido enfileirado antes do mount
    update();
    return () => {
      listeners.delete(update);
    };
  }, []);

  const dismiss = useCallback((id: string) => {
    toasts = toasts.filter((t) => t.id !== id);
    notify();
  }, []);

  if (items.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2"
      role="region"
      aria-live="polite"
      aria-label="Notificações"
    >
      {items.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cn(
            "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm shadow-md max-w-md",
            t.variant === "success" &&
              "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100",
            t.variant === "error" &&
              "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100",
            t.variant === "info" &&
              "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100",
          )}
        >
          {t.variant === "success" && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
          {t.variant === "error" && <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
          {t.variant === "info" && <Info className="mt-0.5 h-4 w-4 shrink-0" />}
          <span className="flex-1 break-words">{t.message}</span>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            className="rounded p-0.5 hover:bg-black/10 dark:hover:bg-white/10"
            aria-label="Fechar"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
