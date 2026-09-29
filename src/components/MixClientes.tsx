"use client";

import { useMemo } from "react";
import { Users } from "lucide-react";
import type { VendaParsed } from "@/lib/parsers/nbs-vendas-xlsx";
import type { ClienteAgregado } from "@/lib/analytics/clientes";
import { calcularMixClientes } from "@/lib/analytics/mix-clientes";
import { formatInt } from "@/lib/utils";

/** Bloco visual PF × Lojista (Story 2 — Análise de Vendas). Ver lib/analytics/mix-clientes.ts. */
export function MixClientes({
  vendas,
  clientesIndex,
}: {
  /** Vendas já filtradas pela tela — viram o denominador do bloco. */
  vendas: VendaParsed[];
  /** Índice de clientes sobre o dataset completo (não o filtrado). */
  clientesIndex: Map<string, ClienteAgregado>;
}) {
  const mix = useMemo(() => calcularMixClientes(vendas, clientesIndex), [vendas, clientesIndex]);

  if (vendas.length === 0) return null;

  return (
    <section className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-5 shadow-[var(--shadow-sm)]">
      <header className="flex items-center gap-2">
        <Users className="h-4 w-4 text-[var(--text-muted)]" />
        <h3 className="text-sm font-semibold text-[var(--text-strong)]">Lojista × Consumidor final</h3>
        <span className="text-xs text-[var(--text-muted)]">— {formatInt(mix.total)} venda{mix.total === 1 ? "" : "s"} no filtro atual</span>
      </header>

      <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-[var(--bg-muted)]">
        {mix.lojista > 0 && (
          <div className="h-full bg-purple-500" style={{ width: `${mix.pctLojista}%` }} title={`Lojista: ${mix.lojista}`} />
        )}
        {mix.consumidorFinal > 0 && (
          <div className="h-full bg-blue-500" style={{ width: `${mix.pctConsumidorFinal}%` }} title={`Consumidor final: ${mix.consumidorFinal}`} />
        )}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="flex items-center justify-between rounded-lg border border-[var(--border-soft)] bg-[var(--bg-muted)] px-3 py-2">
          <span className="inline-flex items-center gap-1.5 text-sm text-[var(--text-body)]">
            <span className="h-2.5 w-2.5 rounded-full bg-purple-500" /> Lojista
          </span>
          <span className="tabular-nums text-sm font-semibold text-[var(--text-strong)]">
            {formatInt(mix.lojista)} <span className="text-xs font-normal text-[var(--text-muted)]">({mix.pctLojista.toFixed(1)}%)</span>
          </span>
        </div>
        <div className="flex items-center justify-between rounded-lg border border-[var(--border-soft)] bg-[var(--bg-muted)] px-3 py-2">
          <span className="inline-flex items-center gap-1.5 text-sm text-[var(--text-body)]">
            <span className="h-2.5 w-2.5 rounded-full bg-blue-500" /> Consumidor final
          </span>
          <span className="tabular-nums text-sm font-semibold text-[var(--text-strong)]">
            {formatInt(mix.consumidorFinal)} <span className="text-xs font-normal text-[var(--text-muted)]">({mix.pctConsumidorFinal.toFixed(1)}%)</span>
          </span>
        </div>
      </div>
    </section>
  );
}
