"use client";

/**
 * Modal de confirmação pra registrar o desfecho "não vendido" de um repasse.
 *
 * Confirmação simples + motivo opcional (textarea). O motivo, se preenchido,
 * é anexado às observações do repasse pelo caller.
 */

import { useState } from "react";
import { Loader2, X } from "lucide-react";
import type { Repasse } from "@/lib/repasses/types";

export type MarcarNaoVendidoModalProps = {
  repasse: Repasse;
  open: boolean;
  onClose: () => void;
  onConfirm: (input: { motivo: string | null }) => void | Promise<void>;
};

export function MarcarNaoVendidoModal({
  repasse,
  open,
  onClose,
  onConfirm,
}: MarcarNaoVendidoModalProps) {
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);

  if (!open) return null;

  async function handleConfirmar() {
    if (salvando) return;
    setSalvando(true);
    try {
      await onConfirm({ motivo: motivo.trim() || null });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-[var(--text-strong)]">Marcar como não vendido?</h2>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              {repasse.modelo} · <span className="font-mono">{repasse.placa}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--bg-muted)]"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <label className="block">
          <span className="text-xs font-medium text-[var(--text-muted)]">Motivo (opcional)</span>
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={3}
            placeholder="Ex.: sem propostas, valor abaixo do esperado..."
            aria-label="Motivo"
            className="mt-1 w-full resize-none rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-sm focus:border-[var(--brand-500)] focus:outline-none"
          />
        </label>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={salvando}
            className="rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-4 py-2 text-sm text-[var(--text-body)] hover:bg-[var(--bg-muted)] disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirmar}
            disabled={salvando}
            className="inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}
