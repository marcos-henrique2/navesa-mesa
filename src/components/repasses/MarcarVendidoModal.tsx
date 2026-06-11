"use client";

import { useState } from "react";
import { Loader2, X } from "lucide-react";
import type { Repasse } from "@/lib/repasses/types";
import { showErrorToast } from "@/components/ui/Toast";

export function MarcarVendidoModal({
  repasse,
  onClose,
  onConfirm,
}: {
  repasse: Repasse;
  onClose: () => void;
  onConfirm: (payload: { valor_vendido: number; data_vendido: string; comprador: string | null }) => Promise<void>;
}) {
  const [valor, setValor] = useState<string>(
    repasse.valor_subiu != null ? String(repasse.valor_subiu) : "",
  );
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10));
  const [comprador, setComprador] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (salvando) return;
    const v = Number(valor.replace(",", "."));
    if (!Number.isFinite(v) || v <= 0) {
      showErrorToast("Informe um valor válido (> 0).");
      return;
    }
    setSalvando(true);
    await onConfirm({
      valor_vendido: v,
      data_vendido: data,
      comprador: comprador.trim() || null,
    });
    setSalvando(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-lg font-bold text-[var(--text-strong)]">Marcar como vendido</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--bg-muted)]"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Valor vendido (R$)
            </span>
            <input
              autoFocus
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              required
              className="mt-1 w-full rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-[var(--brand-600)]"
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Data da venda
            </span>
            <input
              type="date"
              value={data}
              onChange={(e) => setData(e.target.value)}
              required
              className="mt-1 w-full rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--brand-600)]"
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Comprador (opcional)
            </span>
            <input
              type="text"
              value={comprador}
              onChange={(e) => setComprador(e.target.value)}
              placeholder="Nome ou CNPJ do comprador"
              className="mt-1 w-full rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--brand-600)]"
            />
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={salvando}
              className="rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-4 py-2 text-sm text-[var(--text-body)] hover:bg-[var(--bg-muted)] disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={salvando}
              className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirmar venda
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
