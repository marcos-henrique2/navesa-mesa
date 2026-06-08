"use client";

/**
 * Painel "Mês a mês" — análise comparativa automática.
 *
 * Aparece no topo do /insights. Mostra:
 *   1. Cards de delta (qt, faturamento, margem%, ticket médio)
 *   2. Bullets explicativos do "porquê" dos números mudarem
 *   3. Drivers (modelos e lojas que mais subiram/caíram)
 *
 * Esconde silenciosamente se não tem 2 meses pra comparar.
 */

import { useMemo } from "react";
import { Calendar, ArrowUpRight, ArrowDownRight, Minus, TrendingUp, TrendingDown } from "lucide-react";
import { useInventory } from "@/lib/store/inventory";
import { calcularComparativoMensal, type DriverItem } from "@/lib/analytics/comparativo-mensal";
import { formatBRL, formatInt, cn } from "@/lib/utils";

export function ComparativoMensal() {
  const { vendas, custosPorPlaca } = useInventory();
  const comp = useMemo(() => calcularComparativoMensal(vendas, custosPorPlaca), [vendas, custosPorPlaca]);

  // Sem 2 meses pra comparar → não renderiza (sem placeholder pra não poluir)
  if (!comp) return null;

  return (
    <section className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] shadow-[var(--shadow-sm)]">
      <header className="flex flex-wrap items-center gap-2 border-b border-[var(--border-soft)] px-5 py-3">
        <Calendar className="h-4 w-4 text-[var(--text-muted)]" />
        <h3 className="text-sm font-semibold text-[var(--text-strong)]">Mês a mês</h3>
        <span className="text-xs text-[var(--text-muted)]">
          — {comp.ultimoMes.rotulo} comparado com {comp.penultimoMes.rotulo}
        </span>
      </header>

      <div className="space-y-5 p-5">
        {/* Cards de delta */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <DeltaCard
            label="Vendas"
            atual={formatInt(comp.ultimoMes.qt)}
            anterior={formatInt(comp.penultimoMes.qt)}
            deltaAbs={comp.deltas.qt.abs}
            deltaPct={comp.deltas.qt.pct}
            formatDelta={(v) => `${v >= 0 ? "+" : ""}${v}`}
            invertido={false}
          />
          <DeltaCard
            label="Faturamento"
            atual={formatBRL(comp.ultimoMes.faturamento)}
            anterior={formatBRL(comp.penultimoMes.faturamento)}
            deltaAbs={comp.deltas.faturamento.abs}
            deltaPct={comp.deltas.faturamento.pct}
            formatDelta={(v) => `${v >= 0 ? "+" : ""}${formatBRL(v)}`}
            invertido={false}
          />
          <DeltaCard
            label="Margem real"
            atual={formatBRL(comp.ultimoMes.margem)}
            anterior={formatBRL(comp.penultimoMes.margem)}
            deltaAbs={comp.deltas.margem.abs}
            deltaPct={comp.deltas.margem.pct}
            formatDelta={(v) => `${v >= 0 ? "+" : ""}${formatBRL(v)}`}
            invertido={false}
          />
          <DeltaCard
            label="Margem %"
            atual={`${comp.ultimoMes.margemPct.toFixed(2)}%`}
            anterior={`${comp.penultimoMes.margemPct.toFixed(2)}%`}
            deltaAbs={comp.deltas.margemPct.pp}
            deltaPct={comp.deltas.margemPct.pp}
            formatDelta={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}pp`}
            invertido={false}
            comparacaoEhPP
          />
        </div>

        {/* Narrativa explicativa */}
        {comp.narrativa.length > 0 && (
          <div className="space-y-2 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-app)] p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              O que aconteceu
            </p>
            <ul className="space-y-1.5 text-sm text-[var(--text-body)]">
              {comp.narrativa.map((linha, i) => (
                <li key={i} dangerouslySetInnerHTML={{ __html: marcarNegrito(linha) }} />
              ))}
            </ul>
          </div>
        )}

        {/* Drivers detalhados */}
        <div className="grid gap-3 md:grid-cols-2">
          <DriverList
            titulo="Modelos que cresceram"
            icone={<TrendingUp className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />}
            tone="positivo"
            items={comp.drivers.modelosSubiram}
          />
          <DriverList
            titulo="Modelos que caíram"
            icone={<TrendingDown className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />}
            tone="negativo"
            items={comp.drivers.modelosCairam}
          />
        </div>
      </div>
    </section>
  );
}

/** Converte **bold** em <strong>bold</strong>. Texto controlado, não vem do usuário. */
function marcarNegrito(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function DeltaCard({
  label,
  atual,
  anterior,
  deltaAbs,
  deltaPct,
  formatDelta,
  invertido,
  comparacaoEhPP,
}: {
  label: string;
  atual: string;
  anterior: string;
  deltaAbs: number;
  deltaPct: number;
  formatDelta: (v: number) => string;
  invertido: boolean;
  comparacaoEhPP?: boolean;
}) {
  // bom = subir é bom (default); invertido = subir é ruim (custo, parado)
  const ehBom = invertido ? deltaAbs < 0 : deltaAbs > 0;
  const ehZero = Math.abs(deltaAbs) < 0.005;

  const tom = ehZero
    ? "text-[var(--text-subtle)]"
    : ehBom
      ? "text-emerald-700 dark:text-emerald-400"
      : "text-red-700 dark:text-red-400";

  const Icon = ehZero ? Minus : ehBom ? ArrowUpRight : ArrowDownRight;

  return (
    <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-app)] p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        {label}
      </p>
      <p className="mt-0.5 text-base font-bold tabular-nums text-[var(--text-strong)]">{atual}</p>
      <p className="text-[10px] tabular-nums text-[var(--text-muted)]">vs {anterior}</p>
      {!ehZero && (
        <p className={cn("mt-1 inline-flex items-center gap-1 text-xs tabular-nums font-medium", tom)}>
          <Icon className="h-3 w-3" />
          {formatDelta(deltaAbs)}
          {!comparacaoEhPP && Math.abs(deltaPct) >= 0.1 && (
            <span className="text-[10px] opacity-70">({deltaPct >= 0 ? "+" : ""}{deltaPct.toFixed(1)}%)</span>
          )}
        </p>
      )}
    </div>
  );
}

function DriverList({
  titulo,
  icone,
  tone,
  items,
}: {
  titulo: string;
  icone: React.ReactNode;
  tone: "positivo" | "negativo";
  items: DriverItem[];
}) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-app)] p-3">
      <p className="mb-2 inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        {icone} {titulo}
      </p>
      <ul className="space-y-1">
        {items.map((it) => (
          <li key={it.chave} className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-[var(--text-body)]" title={it.chave}>
              {it.chave}
            </span>
            <span className="tabular-nums text-[var(--text-muted)]">
              {it.qtAnterior} →{" "}
              <span className={cn("font-semibold", tone === "positivo" ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400")}>
                {it.qtAtual}
              </span>
              <span className={cn("ml-1 text-[10px]", tone === "positivo" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
                ({it.deltaQt > 0 ? "+" : ""}{it.deltaQt})
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
