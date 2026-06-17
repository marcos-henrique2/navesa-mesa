"use client";

/**
 * Modal do gerador de anúncio de repasse.
 *
 * Gera o texto on-the-fly com `gerarAnuncioRepasse(repasse)` e mostra num
 * textarea editável — o Marcos pode ajustar antes de copiar/baixar. Copiar e
 * baixar usam o conteúdo EDITADO (estado local), não o original.
 *
 * Acessibilidade: fecha com ESC e clique fora; botão de fechar com aria-label.
 */

import { useEffect, useState } from "react";
import { Copy, Download, X } from "lucide-react";
import type { Repasse } from "@/lib/repasses/types";
import { gerarAnuncioRepasse } from "@/lib/repasses/gerar-anuncio";
import { showErrorToast, showSuccessToast } from "@/components/ui/Toast";

export type AnuncioModalProps = {
  repasse: Repasse;
  open: boolean;
  onClose: () => void;
};

/** Nome de arquivo seguro: placa (se houver) ou modelo, sem caracteres ruins. */
function nomeArquivo(repasse: Repasse): string {
  const base = repasse.placa?.trim() || repasse.modelo?.trim() || "repasse";
  const slug = base.replace(/[^a-zA-Z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return `Anuncio-${slug || "repasse"}.txt`;
}

export function AnuncioModal({ repasse, open, onClose }: AnuncioModalProps) {
  // Texto inicial derivado uma vez por montagem. O pai remonta o modal com
  // `key={repasse.id}`, então trocar de carro reinicia o draft sem effect.
  const [texto, setTexto] = useState(() => gerarAnuncioRepasse(repasse));

  // Fecha com ESC.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const ano = repasse.ano_modelo ?? repasse.ano_fabricacao ?? "";
  const titulo = `Anúncio — ${repasse.modelo}${ano ? ` ${ano}` : ""}`;

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      showSuccessToast("Anúncio copiado!");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showErrorToast(`Não consegui copiar: ${msg}`);
    }
  }

  function baixar() {
    const blob = new Blob([texto], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nomeArquivo(repasse);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
    >
      <div
        className="flex w-full max-w-2xl flex-col rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-[var(--text-strong)]">{titulo}</h2>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              Edite se precisar, depois copie e cole no campo de observação do Auto Avaliar.
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
          aria-label="Texto do anúncio"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          spellCheck={false}
          className="h-[55vh] w-full resize-none rounded-md border border-[var(--border-base)] bg-[var(--bg-muted)] p-3 font-mono text-xs leading-relaxed text-[var(--text-body)] focus:border-[var(--brand-500)] focus:outline-none"
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
            onClick={baixar}
            className="inline-flex items-center gap-2 rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-4 py-2 text-sm text-[var(--text-body)] hover:bg-[var(--bg-muted)]"
          >
            <Download className="h-4 w-4" /> Baixar .txt
          </button>
          <button
            type="button"
            onClick={copiar}
            className="inline-flex items-center gap-2 rounded-md bg-[var(--brand-700)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-800)]"
          >
            <Copy className="h-4 w-4" /> Copiar
          </button>
        </div>
      </div>
    </div>
  );
}
