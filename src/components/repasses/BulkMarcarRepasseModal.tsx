"use client";

/**
 * Batch silencioso pra marcar vários carros pra subir pra repasse.
 *
 * Confirmação simples → loop sequencial criando 1 repasse por veículo.
 * Se algum falhar (ex.: já estava marcado — 23505), pula e reporta no fim.
 *
 * Reporta ao caller os chassis processados (sucesso + já em repasse) pra
 * limpar a seleção. Falhas inesperadas voltam pra seleção pra usuário tentar
 * de novo.
 */

import { useState } from "react";
import { Loader2, X } from "lucide-react";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";
import { createRepasse, snapshotFromVeiculo } from "@/lib/repasses/queries";
import { RepasseDuplicadoError } from "@/lib/repasses/erros";
import { showErrorToast, showInfoToast, showSuccessToast } from "@/components/ui/Toast";

export type BulkMarcarRepasseModalProps = {
  /** Veículos elegíveis (não têm repasse ativo). Quem chama filtrou antes. */
  veiculos: ReadonlyArray<VeiculoParsed>;
  open: boolean;
  /**
   * Fecha o modal. Recebe os chassis processados (sucesso + 23505) pro caller
   * limpar SÓ esses da seleção, preservando falhas inesperadas pra retry.
   */
  onClose: (processados: string[]) => void;
  /**
   * Callback executado após cada sucesso. Quem chama usa pra atualizar o map
   * de chassis em repasse no /estoque (evita re-fetch).
   */
  onRepasseCriado: (chassi: string, repasseId: number) => void;
};

export function BulkMarcarRepasseModal({
  veiculos,
  open,
  onClose,
  onRepasseCriado,
}: BulkMarcarRepasseModalProps) {
  const [salvando, setSalvando] = useState(false);

  if (!open) return null;

  const total = veiculos.length;

  async function handleConfirmar() {
    if (salvando) return;
    setSalvando(true);

    const sucesso: string[] = [];
    const jaMarcado: string[] = [];
    const falha: string[] = [];

    for (const v of veiculos) {
      try {
        const repasse = await createRepasse(snapshotFromVeiculo(v));
        sucesso.push(v.chassi);
        onRepasseCriado(v.chassi, repasse.id);
      } catch (err) {
        // Duplicata (carro já marcado/subido) é tratada como "pulado", não
        // "falha real". Checagem via instanceof — sem substring matching.
        if (err instanceof RepasseDuplicadoError) {
          jaMarcado.push(v.chassi);
        } else {
          falha.push(v.chassi);
        }
      }
    }

    const processados = [...sucesso, ...jaMarcado];

    // Toast resumo
    if (falha.length === 0 && jaMarcado.length === 0) {
      showSuccessToast(`${sucesso.length} carro${sucesso.length === 1 ? "" : "s"} marcado${sucesso.length === 1 ? "" : "s"} pra subir.`);
    } else if (falha.length === 0) {
      showInfoToast(
        `${sucesso.length} marcado${sucesso.length === 1 ? "" : "s"}, ${jaMarcado.length} já estava${jaMarcado.length === 1 ? "" : "m"} marcado${jaMarcado.length === 1 ? "" : "s"}.`,
      );
    } else {
      showErrorToast(
        `${sucesso.length} marcado${sucesso.length === 1 ? "" : "s"}, ${falha.length} falhou${falha.length === 1 ? "" : "ram"}.`,
      );
    }

    setSalvando(false);
    onClose(processados);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={() => !salvando && onClose([])}
    >
      <div
        className="w-full max-w-md rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-lg font-bold text-[var(--text-strong)]">
            Marcar {total} carro{total === 1 ? "" : "s"} pra subir?
          </h2>
          {!salvando && (
            <button
              type="button"
              onClick={() => onClose([])}
              className="rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--bg-muted)]"
              aria-label="Fechar"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <p className="text-sm text-[var(--text-muted)]">
          Os carros vão entrar na lista de /repasses pra você exportar e subir pra Auto Avaliar.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onClose([])}
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
            {salvando ? `Marcando ${total}...` : `Marcar ${total}`}
          </button>
        </div>
      </div>
    </div>
  );
}
