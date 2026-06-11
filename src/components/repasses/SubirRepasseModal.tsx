"use client";

/**
 * Modal pra subir um veículo do estoque pra repasse.
 *
 * Reutilizável: usado em /veiculos/[chassi], no /estoque (botão por linha
 * + bulk) e no widget de repasses no dashboard. Quem chama passa o veículo
 * + valor sugerido inicial; após criar o repasse, navega pra /repasses/[id]
 * (ou delega o pós-sucesso via prop `onSuccess`).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, X } from "lucide-react";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";
import { createRepasse, snapshotFromVeiculo } from "@/lib/repasses/queries";
import { CANAIS_DISPONIVEIS } from "@/lib/repasses/types";
import { showErrorToast, showSuccessToast } from "@/components/ui/Toast";

export type SubirRepasseModalProps = {
  veiculo: VeiculoParsed;
  valorSubiuSugerido?: number | null;
  valorMinimoSugerido?: number | null;
  open: boolean;
  onClose: () => void;
  /**
   * Callback opcional executado após sucesso. Quando passado, o modal NÃO
   * navega pra /repasses/[id] — quem controla o pós-sucesso é o caller.
   *
   * Usado no fluxo bulk (avança fila) e onde o /estoque quer só atualizar
   * o map local + redirecionar via router próprio.
   */
  onSuccess?: (repasseId: number) => void;
  /** Texto do botão de submit. Default: "Subir pra repasse". */
  labelSubmit?: string;
  /** Conteúdo extra opcional renderizado no topo do modal (ex.: progresso da fila). */
  topSlot?: React.ReactNode;
};

export function SubirRepasseModal({
  veiculo,
  valorSubiuSugerido,
  valorMinimoSugerido,
  open,
  onClose,
  onSuccess,
  labelSubmit,
  topSlot,
}: SubirRepasseModalProps) {
  const router = useRouter();
  const [valorSubiu, setValorSubiu] = useState<string>(
    valorSubiuSugerido != null ? String(valorSubiuSugerido) : "",
  );
  const [valorMinimo, setValorMinimo] = useState<string>(
    valorMinimoSugerido != null ? String(valorMinimoSugerido) : "",
  );
  const [canal, setCanal] = useState<string>("auto_avaliar");
  const [salvando, setSalvando] = useState(false);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (salvando) return;
    setSalvando(true);
    try {
      const input = snapshotFromVeiculo(veiculo, {
        valor_subiu: parseValor(valorSubiu),
        valor_minimo: parseValor(valorMinimo),
        canal,
      });
      const repasse = await createRepasse(input);
      showSuccessToast(`Repasse #${repasse.id} criado.`);
      if (onSuccess) {
        onSuccess(repasse.id);
      } else {
        onClose();
        router.push(`/repasses/${repasse.id}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showErrorToast(msg);
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {topSlot && <div className="mb-3">{topSlot}</div>}
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-[var(--text-strong)]">Subir pra repasse</h2>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              {veiculo.modelo} · <span className="font-mono">{veiculo.placa}</span>
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

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Canal">
            <select
              value={canal}
              onChange={(e) => setCanal(e.target.value)}
              className="w-full rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--brand-600)]"
            >
              {CANAIS_DISPONIVEIS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Valor que subiu (R$)" hint="Quanto você está pedindo no anúncio">
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={valorSubiu}
              onChange={(e) => setValorSubiu(e.target.value)}
              placeholder="0,00"
              className="w-full rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-[var(--brand-600)]"
            />
          </Field>

          <Field label="Valor mínimo (R$)" hint="Piso de negociação — não compartilhado com comprador">
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={valorMinimo}
              onChange={(e) => setValorMinimo(e.target.value)}
              placeholder="0,00"
              className="w-full rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-[var(--brand-600)]"
            />
          </Field>

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
              className="inline-flex items-center gap-2 rounded-md bg-[var(--brand-700)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-800)] disabled:opacity-50"
            >
              {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
              {labelSubmit ?? "Subir pra repasse"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">{label}</span>
      {hint && <span className="ml-1 text-[10px] text-[var(--text-subtle)]">— {hint}</span>}
      <div className="mt-1">{children}</div>
    </label>
  );
}

function parseValor(s: string): number | null {
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
}
