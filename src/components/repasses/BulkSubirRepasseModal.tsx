"use client";

/**
 * Modal sequencial pra subir vários carros pra repasse de uma vez.
 *
 * Reusa o SubirRepasseModal pra cada item da fila — sem duplicar lógica.
 * Fluxo:
 *   1. Recebe lista de elegíveis (já filtrada — quem tem repasse ativo foi
 *      ignorado antes de abrir o modal).
 *   2. Mostra o atual, com indicador "carro X de N".
 *   3. Submit → cria repasse → avança próximo.
 *   4. Pular → avança próximo sem criar.
 *   5. Cancelar → vai pra tela de resumo (sem fechar) preservando o que
 *      foi feito até aqui.
 *   6. Ao final → resumo com botão "Ver lista" → /repasses.
 *
 * Reporta ao caller (`onClose`) APENAS os chassis processados (subidos +
 * pulados) — quem chama usa pra preservar a marcação dos que sobraram.
 */

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, X } from "lucide-react";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";
import { SubirRepasseModal } from "./SubirRepasseModal";

export type BulkSubirRepasseModalProps = {
  /** Veículos elegíveis (sem repasse ativo). Quem chama filtrou antes. */
  veiculos: ReadonlyArray<VeiculoParsed>;
  open: boolean;
  /**
   * Fecha o modal. Recebe os chassis processados (subidos + pulados) pro
   * caller limpar SÓ esses da seleção, preservando os que ficaram pendentes
   * (cancelamento no meio da fila).
   */
  onClose: (processados: string[]) => void;
  /**
   * Callback executado após cada sucesso. Quem chama usa pra atualizar o map
   * de chassis em repasse no /estoque (evita re-fetch).
   */
  onRepasseCriado: (chassi: string, repasseId: number) => void;
};

export function BulkSubirRepasseModal({
  veiculos,
  open,
  onClose,
  onRepasseCriado,
}: BulkSubirRepasseModalProps) {
  const [indice, setIndice] = useState(0);
  const [criados, setCriados] = useState<number>(0);
  const [pulados, setPulados] = useState<number>(0);
  const [processados, setProcessados] = useState<string[]>([]);
  const [terminado, setTerminado] = useState(false);
  const [cancelado, setCancelado] = useState(false);

  if (!open) return null;

  const total = veiculos.length;
  const atual = veiculos[indice] ?? null;

  function avancar() {
    if (indice + 1 >= total) {
      setTerminado(true);
    } else {
      setIndice(indice + 1);
    }
  }

  function handleSuccess(chassi: string, repasseId: number) {
    onRepasseCriado(chassi, repasseId);
    setCriados((c) => c + 1);
    setProcessados((arr) => [...arr, chassi]);
    avancar();
  }

  function handlePular() {
    if (atual !== null) {
      setProcessados((arr) => [...arr, atual.chassi]);
    }
    setPulados((p) => p + 1);
    avancar();
  }

  function handleCancelar() {
    // Não chama onClose direto — vai pro resumo preservando feedback.
    setCancelado(true);
    setTerminado(true);
  }

  function fechar() {
    onClose(processados);
  }

  // Tela final: resumo (concluído OU cancelado)
  if (terminado || atual === null) {
    const tituloResumo = cancelado ? "Fila cancelada" : "Fila concluída";
    const subtitulo = cancelado
      ? `Fila cancelada após ${criados + pulados} de ${total} processados`
      : null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={fechar}>
        <div
          className="w-full max-w-md rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-6 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-bold text-[var(--text-strong)]">
                <CheckCircle2 className={cancelado ? "h-5 w-5 text-amber-600" : "h-5 w-5 text-emerald-600"} />
                {tituloResumo}
              </h2>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                {criados} carro{criados === 1 ? "" : "s"} subido{criados === 1 ? "" : "s"} pra repasse
                {pulados > 0 && ` · ${pulados} pulado${pulados === 1 ? "" : "s"}`}
              </p>
              {subtitulo && (
                <p className="mt-1 text-xs text-[var(--text-muted)]">{subtitulo}</p>
              )}
            </div>
            <button
              type="button"
              onClick={fechar}
              className="rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--bg-muted)]"
              aria-label="Fechar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={fechar}
              className="rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-4 py-2 text-sm text-[var(--text-body)] hover:bg-[var(--bg-muted)]"
            >
              Fechar
            </button>
            {criados > 0 && (
              <Link
                href="/repasses"
                onClick={fechar}
                className="inline-flex items-center gap-2 rounded-md bg-[var(--brand-700)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-800)]"
              >
                Ver lista
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Tela do item atual: delega pro SubirRepasseModal com topSlot de progresso
  const progresso = (
    <div className="flex items-center justify-between gap-2 rounded-md border border-[var(--border-soft)] bg-[var(--bg-muted)] px-3 py-2">
      <p className="text-xs font-medium text-[var(--text-body)]">
        Subindo carro <strong className="text-[var(--text-strong)]">{indice + 1}</strong> de{" "}
        <strong className="text-[var(--text-strong)]">{total}</strong>
        <span className="ml-1.5 text-[var(--text-muted)]">
          · <span className="font-mono">{atual.placa}</span> {atual.modelo}
        </span>
      </p>
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={handlePular}
          className="rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-body)] hover:bg-[var(--bg-muted)]"
        >
          Pular esse
        </button>
        <button
          type="button"
          onClick={handleCancelar}
          className="rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-body)] hover:bg-[var(--bg-muted)]"
        >
          Cancelar fila
        </button>
      </div>
    </div>
  );

  return (
    <SubirRepasseModal
      // Reset state interno do modal a cada veículo (input values do sugerido)
      key={atual.chassi}
      veiculo={atual}
      valorSubiuSugerido={atual.preco_venda}
      valorMinimoSugerido={atual.custo_total}
      open={true}
      onClose={handleCancelar}
      onSuccess={(repasseId) => handleSuccess(atual.chassi, repasseId)}
      labelSubmit={indice + 1 === total ? "Subir (último)" : "Subir e avançar"}
      topSlot={progresso}
    />
  );
}
