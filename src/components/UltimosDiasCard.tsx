"use client";

/**
 * Card "Últimos N dias" — mostra resumo das vendas recentes do dataset.
 *
 * Usado no dashboard pra dar a leitura rápida de "como tá a operação
 * nessa semana". Compara com a semana imediatamente anterior.
 */

import { useMemo } from "react";
import { Calendar, ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { useInventory } from "@/lib/store/inventory";
import { resumoUltimosDias } from "@/lib/analytics/ultimos-dias";
import { formatBRL, formatInt, cn } from "@/lib/utils";

const MESES_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function fmtDataCurta(d: Date): string {
  return `${d.getDate()}/${MESES_PT[d.getMonth()]}`;
}

export function UltimosDiasCard({ dias = 7 }: { dias?: number }) {
  const { vendas, custosPorPlaca } = useInventory();
  const resumo = useMemo(
    () => resumoUltimosDias(vendas, custosPorPlaca, dias),
    [vendas, custosPorPlaca, dias],
  );

  // Sem vendas no dataset → não renderiza
  if (!resumo) return null;

  return (
    <section className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] shadow-[var(--shadow-sm)]">
      <header className="flex flex-wrap items-center gap-2 border-b border-[var(--border-soft)] px-5 py-3">
        <Calendar className="h-4 w-4 text-[var(--text-muted)]" />
        <h3 className="text-sm font-semibold text-[var(--text-strong)]">Últimos {dias} dias</h3>
        <span className="text-xs text-[var(--text-muted)]">
          — {fmtDataCurta(resumo.inicio)} a {fmtDataCurta(resumo.fim)}
        </span>
        {resumo.vsAnterior && (
          <span className="ml-auto text-[10px] text-[var(--text-muted)]">vs. {dias} dias anteriores</span>
        )}
      </header>

      <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label="Vendas"
          valor={formatInt(resumo.qt)}
          deltaAbs={resumo.vsAnterior?.qt.abs ?? null}
          deltaPct={resumo.vsAnterior?.qt.pct ?? null}
          formatDelta={(v) => `${v >= 0 ? "+" : ""}${v}`}
        />
        <Kpi
          label="Faturamento"
          valor={formatBRL(resumo.faturamento)}
          deltaAbs={resumo.vsAnterior?.faturamento.abs ?? null}
          deltaPct={resumo.vsAnterior?.faturamento.pct ?? null}
          formatDelta={(v) => `${v >= 0 ? "+" : ""}${formatBRL(v)}`}
        />
        <Kpi
          label="Margem real"
          valor={formatBRL(resumo.margem)}
          deltaAbs={resumo.vsAnterior?.margem.abs ?? null}
          deltaPct={resumo.vsAnterior?.margem.pct ?? null}
          formatDelta={(v) => `${v >= 0 ? "+" : ""}${formatBRL(v)}`}
        />
        <Kpi
          label="Ticket médio"
          valor={formatBRL(resumo.ticketMedio)}
          sub={`Margem ${resumo.margemPct.toFixed(2)}%`}
          deltaAbs={null}
          deltaPct={null}
          formatDelta={() => ""}
        />
      </div>
    </section>
  );
}

function Kpi({
  label,
  valor,
  sub,
  deltaAbs,
  deltaPct,
  formatDelta,
}: {
  label: string;
  valor: string;
  sub?: string;
  deltaAbs: number | null;
  deltaPct: number | null;
  formatDelta: (v: number) => string;
}) {
  const ehZero = deltaAbs != null && Math.abs(deltaAbs) < 0.005;
  const ehBom = deltaAbs != null && !ehZero && deltaAbs > 0;
  const tom = deltaAbs == null
    ? "text-[var(--text-subtle)]"
    : ehZero
      ? "text-[var(--text-subtle)]"
      : ehBom
        ? "text-emerald-700 dark:text-emerald-400"
        : "text-red-700 dark:text-red-400";
  const Icon = deltaAbs == null || ehZero ? Minus : ehBom ? ArrowUpRight : ArrowDownRight;

  return (
    <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-app)] p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{label}</p>
      <p className="mt-0.5 text-base font-bold tabular-nums text-[var(--text-strong)]">{valor}</p>
      {sub && <p className="text-[10px] tabular-nums text-[var(--text-muted)]">{sub}</p>}
      {deltaAbs != null && !ehZero && (
        <p className={cn("mt-1 inline-flex items-center gap-1 text-xs tabular-nums font-medium", tom)}>
          <Icon className="h-3 w-3" />
          {formatDelta(deltaAbs)}
          {deltaPct != null && Math.abs(deltaPct) >= 0.1 && (
            <span className="text-[10px] opacity-70">({deltaPct >= 0 ? "+" : ""}{deltaPct.toFixed(1)}%)</span>
          )}
        </p>
      )}
    </div>
  );
}
