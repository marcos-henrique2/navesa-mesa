"use client";

import { useMemo } from "react";
import { useInventory } from "@/lib/store/inventory";
import { calcularParticipacaoLojas } from "@/lib/analytics/participacao-lojas";
import { cn, formatInt } from "@/lib/utils";

export function ParticipacaoLojas() {
  const { vendas, lojas } = useInventory();

  const participacao = useMemo(() => calcularParticipacaoLojas(vendas, lojas), [vendas, lojas]);

  if (participacao.length === 0) return null;

  return (
    <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-5">
      <h3 className="text-sm font-semibold text-[var(--text-strong)]">Participação de vendas por loja</h3>
      <p className="mt-0.5 text-xs text-[var(--text-muted)]">% sobre o total de vendas do período</p>

      <div className="mt-4 space-y-3">
        {participacao.map((p) => (
          <div key={p.cod ?? "nao-identificado"}>
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-[var(--text-strong)]">{p.loja}</span>
              <span className="text-[var(--text-muted)]">
                {formatInt(p.qt)} venda{p.qt === 1 ? "" : "s"} · <span className="font-medium text-[var(--text-strong)]">{p.pct.toFixed(1)}%</span>
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-muted)]">
              <div
                className={cn(
                  "h-full rounded-full",
                  p.cod === null ? "bg-[var(--text-subtle)]" : "bg-[var(--brand-600)]",
                )}
                style={{ width: `${Math.min(p.pct, 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
