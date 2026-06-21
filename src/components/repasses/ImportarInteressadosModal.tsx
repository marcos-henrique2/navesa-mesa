"use client";

/**
 * Modal de importação de interessados do Auto Avaliar.
 *
 * O Marcos cola a tabela (TAB-separated) que copiou da tela do Auto Avaliar.
 * Mostramos um preview do que será importado (parseInteressados) antes de
 * confirmar. Ao confirmar, o pai chama criarInteressados e damos feedback de
 * quantos entraram / quantos foram ignorados (duplicados).
 *
 * Acessibilidade: fecha com ESC e clique fora; botão de fechar com aria-label.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { X, Users } from "lucide-react";
import { parseInteressados } from "@/lib/repasses/parse-interessados";

export type ImportarInteressadosModalProps = {
  open: boolean;
  onClose: () => void;
  /** Chamado com o texto colado quando o Marcos confirma. */
  onConfirmar: (textoColado: string) => Promise<void>;
  /** Spinner no botão de confirmar enquanto o insert roda. */
  importando: boolean;
};

export function ImportarInteressadosModal({
  open,
  onClose,
  onConfirmar,
  importando,
}: ImportarInteressadosModalProps) {
  const [texto, setTexto] = useState("");

  // Preview do que será importado — recalcula a cada edição.
  const preview = useMemo(() => parseInteressados(texto), [texto]);

  // Fecha + limpa o rascunho. O pai já desmonta via `if (!open)`; limpar aqui
  // garante textarea vazio na próxima abertura sem precisar de effect.
  const fecharELimpar = useCallback(() => {
    setTexto("");
    onClose();
  }, [onClose]);

  // Confirma o import e limpa o rascunho ao concluir (o pai fecha o modal).
  const confirmar = useCallback(async () => {
    await onConfirmar(texto);
    setTexto("");
  }, [onConfirmar, texto]);

  // Fecha com ESC.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") fecharELimpar();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, fecharELimpar]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={fecharELimpar}
      role="dialog"
      aria-modal="true"
      aria-label="Importar interessados do Auto Avaliar"
    >
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="inline-flex items-center gap-2 text-lg font-bold text-[var(--text-strong)]">
              <Users className="h-5 w-5" /> Importar do Auto Avaliar
            </h2>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              Selecione a tabela de quem visualizou o anúncio, copie e cole aqui. Reimportar o
              mesmo lote não duplica (deduplicado por e-mail).
            </p>
          </div>
          <button
            type="button"
            onClick={fecharELimpar}
            className="rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--bg-muted)]"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <textarea
          aria-label="Cole aqui a tabela do Auto Avaliar"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          spellCheck={false}
          placeholder={"Cole aqui a lista (nome, cidade/UF, telefones, e-mail, data, visualizações)…"}
          className="h-[30vh] w-full resize-none rounded-md border border-[var(--border-base)] bg-[var(--bg-muted)] p-3 font-mono text-xs leading-relaxed text-[var(--text-body)] focus:border-[var(--brand-500)] focus:outline-none"
        />

        {/* Preview */}
        <div className="mt-4 flex-1 overflow-auto rounded-md border border-[var(--border-soft)]">
          {preview.length === 0 ? (
            <p className="p-4 text-center text-xs text-[var(--text-muted)]">
              {texto.trim()
                ? "Nenhuma linha válida reconhecida ainda."
                : "O preview do que será importado aparece aqui."}
            </p>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-[var(--bg-muted)] text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                <tr>
                  <th className="px-3 py-2">Nome</th>
                  <th className="px-3 py-2">Cidade/UF</th>
                  <th className="px-3 py-2">WhatsApp</th>
                  <th className="px-3 py-2">E-mail</th>
                  <th className="px-3 py-2 text-right">Views</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((p, idx) => (
                  <tr key={idx} className="border-t border-[var(--border-soft)]">
                    <td className="px-3 py-1.5 font-medium text-[var(--text-strong)]">{p.nome}</td>
                    <td className="px-3 py-1.5 text-[var(--text-muted)]">{p.cidade_uf ?? "—"}</td>
                    <td className="px-3 py-1.5 font-mono">
                      {p.telefone_whatsapp ?? (
                        <span className="text-amber-700 dark:text-amber-400">sem celular</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-[var(--text-muted)]">{p.email ?? "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{p.qtd_visualizacoes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-[var(--text-muted)]">
            {preview.length > 0 ? `${preview.length} interessado(s) reconhecido(s)` : ""}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={fecharELimpar}
              className="rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-4 py-2 text-sm text-[var(--text-body)] hover:bg-[var(--bg-muted)]"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void confirmar()}
              disabled={importando || preview.length === 0}
              className="inline-flex items-center gap-2 rounded-md bg-[var(--brand-700)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-800)] disabled:opacity-50"
            >
              {importando ? "Importando…" : `Importar ${preview.length || ""}`.trim()}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
