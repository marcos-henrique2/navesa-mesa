"use client";

/**
 * Modal pra escolher um veículo do estoque atual e subir pra repasse.
 *
 * Lê do store `useInventory` (já hidratado pelo DataGate global). Busca por
 * placa / chassi / modelo. Mostra até 50 resultados — Marcos sabe o que quer.
 */

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { useInventory } from "@/lib/store/inventory";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";
import { cn, formatBRL, formatInt } from "@/lib/utils";

export function EscolherVeiculoModal({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (v: VeiculoParsed) => void;
}) {
  const { veiculos, isHydrated } = useInventory();
  const [q, setQ] = useState("");

  const filtrados = useMemo(() => {
    if (!q.trim()) return veiculos.slice(0, 50);
    const termo = q.trim().toLowerCase();
    return veiculos
      .filter(
        (v) =>
          v.placa.toLowerCase().includes(termo) ||
          v.chassi.toLowerCase().includes(termo) ||
          v.modelo.toLowerCase().includes(termo) ||
          (v.marca?.toLowerCase().includes(termo) ?? false),
      )
      .slice(0, 50);
  }, [veiculos, q]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-20" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-soft)] p-4">
          <h2 className="text-lg font-bold text-[var(--text-strong)]">Escolher veículo do estoque</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--bg-muted)]"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-subtle)]" />
            <input
              autoFocus
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por placa, chassi, modelo..."
              className="w-full rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--brand-600)]"
            />
          </div>
        </div>

        <div className="max-h-[60vh] overflow-y-auto border-t border-[var(--border-soft)]">
          {!isHydrated ? (
            <p className="p-8 text-center text-sm text-[var(--text-muted)]">Carregando estoque…</p>
          ) : filtrados.length === 0 ? (
            <p className="p-8 text-center text-sm text-[var(--text-muted)]">
              {veiculos.length === 0 ? "Nenhum veículo no estoque." : "Nenhum veículo encontrado."}
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border-soft)]">
              {filtrados.map((v) => (
                <li key={v.chassi}>
                  <button
                    type="button"
                    onClick={() => onSelect(v)}
                    className={cn(
                      "block w-full px-4 py-3 text-left transition hover:bg-[var(--bg-muted)]",
                    )}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-[var(--text-strong)]">
                          {v.modelo}
                        </p>
                        <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                          <span className="font-mono">{v.placa}</span>
                          {v.ano_modelo && ` · ${v.ano_modelo}`}
                          {v.km != null && ` · ${formatInt(v.km)} km`}
                          {v.cor_externa && ` · ${v.cor_externa}`}
                        </p>
                      </div>
                      <p className="shrink-0 text-xs tabular-nums text-[var(--text-muted)]">
                        {formatBRL(v.valor_aquisicao)}
                      </p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
