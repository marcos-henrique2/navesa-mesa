"use client";

/**
 * Modal pra marcar UM veículo do estoque pra subir pra repasse.
 *
 * Modal mínimo: mostra dados read-only do carro + botão "Marcar pra subir".
 * Não pede nenhum valor — gestão de preço/margem/venda é responsabilidade
 * do Auto Avaliar, fora desse sistema.
 *
 * Status inicial = "marcado". Marcos abre depois /repasses, exporta XLSX
 * pra preencher IPVA/Doc/Cautelar/Observação no Excel, sobe no Auto Avaliar
 * e volta marcando como "subido".
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, X } from "lucide-react";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";
import { createRepasse, snapshotFromVeiculo } from "@/lib/repasses/queries";
import { showErrorToast, showSuccessToast } from "@/components/ui/Toast";
import { formatBRL, formatInt } from "@/lib/utils";

export type MarcarRepasseModalProps = {
  veiculo: VeiculoParsed;
  open: boolean;
  onClose: () => void;
  /**
   * Callback opcional executado após sucesso. Quando passado, o modal NÃO
   * navega pra /repasses — quem controla o pós-sucesso é o caller (usado
   * no /estoque pra atualizar map local).
   */
  onSuccess?: (repasseId: number) => void;
};

export function MarcarRepasseModal({
  veiculo,
  open,
  onClose,
  onSuccess,
}: MarcarRepasseModalProps) {
  const router = useRouter();
  const [salvando, setSalvando] = useState(false);

  if (!open) return null;

  async function handleConfirmar() {
    if (salvando) return;
    setSalvando(true);
    try {
      const input = snapshotFromVeiculo(veiculo);
      const repasse = await createRepasse(input);
      showSuccessToast("Carro marcado pra subir.");
      if (onSuccess) {
        onSuccess(repasse.id);
      } else {
        onClose();
        router.push("/repasses");
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
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-[var(--text-strong)]">Marcar pra subir</h2>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              Esse carro entra na lista de /repasses pra exportar pra Auto Avaliar.
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

        <div className="space-y-2 rounded-md border border-[var(--border-soft)] bg-[var(--bg-muted)] p-3 text-sm">
          <Row label="Modelo" value={veiculo.modelo} />
          <Row label="Placa" value={<span className="font-mono">{veiculo.placa}</span>} />
          {veiculo.marca && <Row label="Marca" value={veiculo.marca} />}
          {veiculo.ano_modelo && <Row label="Ano modelo" value={String(veiculo.ano_modelo)} />}
          {veiculo.km != null && <Row label="KM" value={formatInt(veiculo.km)} />}
          {veiculo.cor_externa && <Row label="Cor" value={veiculo.cor_externa} />}
          {veiculo.preco_venda != null && (
            <Row label="Preço atual" value={formatBRL(veiculo.preco_venda)} />
          )}
        </div>

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
            className="inline-flex items-center gap-2 rounded-md bg-[var(--brand-700)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-800)] disabled:opacity-50"
          >
            {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
            Marcar pra subir
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-[var(--text-muted)]">{label}</span>
      <span className="font-medium text-[var(--text-strong)]">{value}</span>
    </div>
  );
}
