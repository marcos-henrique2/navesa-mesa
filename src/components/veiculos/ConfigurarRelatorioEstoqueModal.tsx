"use client";

/**
 * Modal de configuração do Relatório de Estoque Customizável.
 *
 * O Marcos marca QUAIS colunas quer exportar (do catálogo `colunas-estoque`) e
 * se quer uma coluna "Observações" em branco. A seleção é lembrada entre exports
 * via `usePersistedState` (sessionStorage). Ao exportar, gera o XLSX e baixa.
 *
 * Acessibilidade: fecha com ESC e clique fora; botão de fechar com aria-label.
 */

import { useEffect, useState } from "react";
import { FileSpreadsheet, X } from "lucide-react";
import {
  COLUNAS_ESTOQUE,
  COLUNAS_DEFAULT,
  type ColunaKey,
} from "@/lib/export/colunas-estoque";
import { baixarRelatorioEstoqueCustomizado } from "@/lib/export/relatorio-estoque-customizado";
import type { VeiculoExportavel } from "@/lib/export/colunas-estoque";
import { usePersistedState } from "@/lib/hooks/usePersistedState";
import { showErrorToast, showSuccessToast } from "@/components/ui/Toast";

export type ConfigurarRelatorioEstoqueModalProps = {
  open: boolean;
  onClose: () => void;
  /** Veículos já filtrados + enriquecidos com empresa_nome. */
  veiculos: VeiculoExportavel[];
  /** Nome da loja filtrada (ou "TODAS"). */
  filtroLoja: string;
};

function todayISOLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function ConfigurarRelatorioEstoqueModal({
  open,
  onClose,
  veiculos,
  filtroLoja,
}: ConfigurarRelatorioEstoqueModalProps) {
  // Seleção persistida entre exports (sessionStorage, prefixo do projeto).
  const [colunasSel, setColunasSel] = usePersistedState<ColunaKey[]>(
    "estoque:relatorioCustom:colunas",
    [...COLUNAS_DEFAULT],
  );
  const [incluirObs, setIncluirObs] = usePersistedState<boolean>(
    "estoque:relatorioCustom:observacoes",
    true,
  );
  const [incluirAnotacoes, setIncluirAnotacoes] = usePersistedState<boolean>(
    "estoque:relatorioCustom:anotacoes",
    false,
  );
  const [exportando, setExportando] = useState(false);

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

  const selecionadas = new Set(colunasSel);
  const nenhumaColuna = selecionadas.size === 0 && !incluirObs && !incluirAnotacoes;

  function toggleColuna(key: ColunaKey) {
    setColunasSel((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }

  async function exportar() {
    if (exportando || nenhumaColuna) return;
    setExportando(true);
    try {
      await baixarRelatorioEstoqueCustomizado(veiculos, {
        colunas: colunasSel,
        incluirObservacoes: incluirObs,
        incluirAnotacoes,
        filtroLoja,
      });
      showSuccessToast(`relatorio-estoque-customizado-${todayISOLocal()}.xlsx baixado`);
      onClose();
    } catch (err) {
      console.error("Falha ao gerar relatório customizado:", err);
      showErrorToast("Erro ao gerar relatório customizado. Tente novamente.");
    } finally {
      setExportando(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Configurar relatório de estoque customizado"
    >
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-[var(--text-strong)]">
              Relatório de estoque customizado
            </h2>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              Escolha as colunas. O arquivo já vem com filtro em todas as colunas. Exporta os{" "}
              {veiculos.length} veículo{veiculos.length === 1 ? "" : "s"} filtrado
              {veiculos.length === 1 ? "" : "s"}.
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

        <div className="grid grid-cols-1 gap-x-4 gap-y-1 overflow-y-auto pr-1 sm:grid-cols-2">
          {COLUNAS_ESTOQUE.map((c) => (
            <label
              key={c.key}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-[var(--text-body)] hover:bg-[var(--bg-muted)]"
            >
              <input
                type="checkbox"
                checked={selecionadas.has(c.key)}
                onChange={() => toggleColuna(c.key)}
                className="h-4 w-4 accent-[var(--brand-700)]"
              />
              {c.label}
            </label>
          ))}
        </div>

        <label className="mt-3 flex cursor-pointer items-center gap-2 rounded-md border border-[var(--border-base)] bg-[var(--bg-muted)] px-3 py-2 text-sm text-[var(--text-body)]">
          <input
            type="checkbox"
            checked={incluirObs}
            onChange={(e) => setIncluirObs(e.target.checked)}
            className="h-4 w-4 accent-[var(--brand-700)]"
          />
          Incluir coluna de Observações (em branco) para anotar no Excel
        </label>

        <label className="mt-2 flex cursor-pointer items-center gap-2 rounded-md border border-[var(--border-base)] bg-[var(--bg-muted)] px-3 py-2 text-sm text-[var(--text-body)]">
          <input
            type="checkbox"
            checked={incluirAnotacoes}
            onChange={(e) => setIncluirAnotacoes(e.target.checked)}
            className="h-4 w-4 accent-[var(--brand-700)]"
          />
          Incluir coluna de Anotações (em branco) para anotar no Excel
        </label>

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          {nenhumaColuna && (
            <span className="mr-auto text-xs text-[var(--text-muted)]">
              Marque pelo menos uma coluna.
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-4 py-2 text-sm text-[var(--text-body)] hover:bg-[var(--bg-muted)]"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={exportar}
            disabled={exportando || nenhumaColuna}
            className="inline-flex items-center gap-2 rounded-md bg-[var(--brand-700)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-800)] disabled:opacity-50"
          >
            <FileSpreadsheet className="h-4 w-4" />
            {exportando ? "Gerando…" : "Exportar"}
          </button>
        </div>
      </div>
    </div>
  );
}
