"use client";

/**
 * Modal pra ver/copiar a mensagem de WhatsApp do lead.
 *
 * Gera o texto com gerarMensagemLead(carro, lead, contexto) e mostra num
 * textarea editável — o Marcos pode ajustar antes de copiar. Botão "Abrir no
 * WhatsApp" usa o texto EDITADO e abre wa.me em nova aba (sem disparo automático).
 *
 * Genérico: recebe o carro (CarroOfertavel), o nome do lead, o whatsapp e o
 * contexto da copy. Serve tanto pra interessados (visualizou) quanto pra ofertas.
 *
 * Acessibilidade: fecha com ESC e clique fora; botão de fechar com aria-label.
 */

import { useEffect, useState } from "react";
import { Copy, MessageCircle, X } from "lucide-react";
import {
  gerarMensagemLead,
  type CarroOfertavel,
  type ContextoMensagem,
} from "@/lib/repasses/gerar-mensagem-lead";
import { showErrorToast, showInfoToast, showSuccessToast } from "@/components/ui/Toast";

export type MensagemLeadModalProps = {
  carro: CarroOfertavel;
  nome: string;
  telefoneWhatsapp: string | null;
  contexto: ContextoMensagem;
  titulo?: string;
  open: boolean;
  onClose: () => void;
};

export function MensagemLeadModal({
  carro,
  nome,
  telefoneWhatsapp,
  contexto,
  titulo,
  open,
  onClose,
}: MensagemLeadModalProps) {
  // Texto inicial derivado uma vez por montagem (pai remonta com key).
  const [texto, setTexto] = useState(() => gerarMensagemLead(carro, { nome }, contexto));

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const tituloFinal = titulo ?? `Mensagem — ${nome}`;

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      showSuccessToast("Mensagem copiada!");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showErrorToast(`Não consegui copiar: ${msg}`);
    }
  }

  function abrirWhatsapp() {
    if (!telefoneWhatsapp) {
      showInfoToast("Esse lead não tem celular pra WhatsApp.");
      return;
    }
    const url = `https://wa.me/${telefoneWhatsapp}?text=${encodeURIComponent(texto)}`;
    window.open(url, "_blank", "noopener");
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={tituloFinal}
    >
      <div
        className="flex w-full max-w-xl flex-col rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-[var(--text-strong)]">{tituloFinal}</h2>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              Edite se precisar, depois copie ou abra direto no WhatsApp.
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

        <textarea
          aria-label="Texto da mensagem"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          spellCheck={false}
          className="h-[40vh] w-full resize-none rounded-md border border-[var(--border-base)] bg-[var(--bg-muted)] p-3 text-sm leading-relaxed text-[var(--text-body)] focus:border-[var(--brand-500)] focus:outline-none"
        />

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-4 py-2 text-sm text-[var(--text-body)] hover:bg-[var(--bg-muted)]"
          >
            Fechar
          </button>
          <button
            type="button"
            onClick={copiar}
            className="inline-flex items-center gap-2 rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-4 py-2 text-sm text-[var(--text-body)] hover:bg-[var(--bg-muted)]"
          >
            <Copy className="h-4 w-4" /> Copiar
          </button>
          <button
            type="button"
            onClick={abrirWhatsapp}
            disabled={!telefoneWhatsapp}
            className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <MessageCircle className="h-4 w-4" /> Abrir no WhatsApp
          </button>
        </div>
      </div>
    </div>
  );
}
