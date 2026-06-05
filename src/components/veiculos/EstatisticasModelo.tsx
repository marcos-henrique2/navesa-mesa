"use client";

/**
 * Bloco "Esse modelo no histórico" — benchmarking de vendas passadas.
 *
 * Mostra ao gerente como o modelo do veículo atual se comportou no histórico:
 * margem média, tempo de pátio, qtd vendida no mês etc. Útil pra responder
 * "esse carro está caro ou barato vs os que eu já vendi?".
 *
 * Match por nome do modelo (uppercase + trim). Se zero vendas: placeholder.
 */

import { useMemo } from "react";
import { BarChart3, TrendingUp, Calendar, Clock, Banknote, ShoppingCart } from "lucide-react";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";
import { useInventory } from "@/lib/store/inventory";
import { calcularEstatisticasModelo } from "@/lib/pricing/estatisticas-modelo";
import { formatBRL, formatBRLCents, formatInt, cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/Tooltip";

export function EstatisticasModelo({ veiculo }: { veiculo: VeiculoParsed }) {
  const { vendas, custosPorPlaca } = useInventory();

  const stats = useMemo(
    () => calcularEstatisticasModelo(veiculo, vendas, custosPorPlaca),
    [veiculo, vendas, custosPorPlaca],
  );

  // Sem histórico: placeholder didático em vez de sumir.
  if (stats.qtVendidasTotal === 0) {
    return (
      <section className="rounded-xl border border-dashed border-[var(--border-base)] bg-[var(--bg-surface)] px-5 py-4 text-sm text-[var(--text-muted)]">
        <div className="flex items-start gap-2">
          <BarChart3 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-subtle)]" />
          <p>
            <span className="font-semibold text-[var(--text-body)]">Sem histórico desse modelo.</span>{" "}
            Quando vendas do modelo <em className="font-medium text-[var(--text-body)]">{veiculo.modelo}</em> forem importadas, aparecerá margem média, tempo de pátio, preço médio etc.
          </p>
        </div>
      </section>
    );
  }

  const subtitle =
    stats.qtVendidasTotal === 1
      ? "benchmark de 1 venda histórica"
      : `benchmark de ${formatInt(stats.qtVendidasTotal)} vendas históricas`;

  return (
    <section className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] shadow-[var(--shadow-sm)]">
      <header className="flex flex-wrap items-center gap-2 border-b border-[var(--border-soft)] px-5 py-3">
        <BarChart3 className="h-4 w-4 text-[var(--text-muted)]" />
        <h3 className="text-sm font-semibold text-[var(--text-strong)]">Esse modelo no histórico</h3>
        <span className="text-xs text-[var(--text-muted)]">— {subtitle}</span>
      </header>

      <div className="grid grid-cols-2 gap-3 p-5 md:grid-cols-3">
        <StatCard
          label={`Vendas em ${stats.mesReferenciaLabel}`}
          value={formatInt(stats.qtVendidasMesAtual)}
          icon={<Calendar className="h-4 w-4" />}
          tooltip={`Quantidade desse modelo vendida em ${stats.mesReferenciaLabel} (último mês com vendas no dataset). Indica ritmo de giro.`}
        />
        <StatCard
          label="Total já vendido"
          value={formatInt(stats.qtVendidasTotal)}
          icon={<ShoppingCart className="h-4 w-4" />}
          tooltip="Vendas históricas desse modelo na base que você importou."
        />
        <StatCard
          label="Margem média vendida"
          value={stats.margemMediaPct != null ? `${stats.margemMediaPct.toFixed(1)}%` : "—"}
          icon={<TrendingUp className="h-4 w-4" />}
          tone={
            stats.margemMediaPct == null ? "neutral"
              : stats.margemMediaPct >= 5 ? "good"
                : stats.margemMediaPct >= 0 ? "warn"
                  : "bad"
          }
          tooltip="Média de margem (preço − custo) ÷ preço de cada venda passada desse modelo. Use como referência pra precificar agora."
        />
        <StatCard
          label="Preço médio"
          value={stats.precoMedioVenda != null ? formatBRL(stats.precoMedioVenda) : "—"}
          icon={<Banknote className="h-4 w-4" />}
          tooltip="Preço médio efetivamente fechado nas vendas desse modelo (não preço de tabela)."
        />
        <StatCard
          label="Pátio médio"
          value={stats.diasEstoqueMedio != null ? `${stats.diasEstoqueMedio} dias` : "—"}
          icon={<Clock className="h-4 w-4" />}
          tone={
            stats.diasEstoqueMedio == null ? "neutral"
              : stats.diasEstoqueMedio <= 30 ? "good"
                : stats.diasEstoqueMedio <= 60 ? "warn"
                  : "bad"
          }
          tooltip="Dias médios entre a entrada do veículo no estoque e a venda. Quanto menor, mais rápido o modelo gira."
        />
        <StatCard
          label="Floor Plan médio"
          value={stats.floorPlanMedio != null ? formatBRLCents(stats.floorPlanMedio) : "—"}
          icon={<Banknote className="h-4 w-4" />}
          tooltip="Custo médio de Floor Plan (juros do financiamento de estoque) pago por unidade vendida desse modelo."
        />
      </div>
    </section>
  );
}

type StatTone = "good" | "warn" | "bad" | "neutral";

function StatCard({
  label,
  value,
  icon,
  tone = "neutral",
  tooltip,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone?: StatTone;
  tooltip: string;
}) {
  const toneClass =
    tone === "good"
      ? "text-emerald-700 dark:text-emerald-400"
      : tone === "warn"
        ? "text-amber-700 dark:text-amber-400"
        : tone === "bad"
          ? "text-red-700 dark:text-red-400"
          : "text-[var(--text-strong)]";

  return (
    <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-app)] p-3">
      <div className="flex items-center gap-1.5 text-[var(--text-subtle)]">
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{label}</span>
        <Tooltip content={tooltip} side="top">
          <span className="text-[var(--text-subtle)] opacity-60 hover:opacity-100" aria-label={`Sobre ${label}`}>ⓘ</span>
        </Tooltip>
      </div>
      <p className={cn("mt-1 text-lg font-bold tabular-nums", toneClass)}>{value}</p>
    </div>
  );
}
