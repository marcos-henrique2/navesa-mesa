"use client";

/**
 * Forecast Section — gráfico de linhas histórico + projeção do mês corrente
 * + cards de comparativo + lista de top modelos com variação esperada.
 */

import { useMemo } from "react";
import { useInventory } from "@/lib/store/inventory";
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { calcularForecastGeral, calcularForecastPorModelo } from "@/lib/analytics/forecast";
import { cn, formatInt } from "@/lib/utils";

const CONF_LABEL = { alta: "Alta", media: "Média", baixa: "Baixa" } as const;
const CONF_COR = {
  alta: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  media: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  baixa: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
} as const;

export function ForecastSection() {
  const { vendas } = useInventory();

  const forecast = useMemo(() => calcularForecastGeral(vendas), [vendas]);
  const porModelo = useMemo(() => calcularForecastPorModelo(vendas, { topN: 8 }), [vendas]);

  if (!forecast) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--border-base)] bg-[var(--bg-surface)] p-6 text-center text-sm text-[var(--text-muted)]">
        Precisamos de pelo menos 2 meses de vendas no dataset pra projetar.
      </div>
    );
  }

  const dadosGrafico = [
    ...forecast.historico.map((m) => ({
      mes: m.rotulo,
      realizado: m.realizadas,
      projecao: null as number | null,
      intervaloMin: null as number | null,
      intervaloMax: null as number | null,
    })),
    {
      mes: forecast.mesCorrente.rotulo,
      realizado: forecast.mesCorrente.realizadas,
      projecao: forecast.mesCorrente.projecaoTotal,
      intervaloMin: forecast.mesCorrente.intervaloMin,
      intervaloMax: forecast.mesCorrente.intervaloMax,
    },
  ];

  const completude =
    forecast.mesCorrente.projecaoTotal > 0
      ? (forecast.mesCorrente.realizadas / forecast.mesCorrente.projecaoTotal) * 100
      : 0;

  return (
    <div className="space-y-5 rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-5 shadow-[var(--shadow-sm)]">
      {/* Cards do mês corrente */}
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard
          label={`${forecast.mesCorrente.rotulo} — realizado`}
          valor={formatInt(forecast.mesCorrente.realizadas)}
          sublabel={`${completude.toFixed(0)}% da projeção`}
          tom="info"
        />
        <KpiCard
          label="Projeção total"
          valor={formatInt(forecast.mesCorrente.projecaoTotal)}
          sublabel={`Intervalo: ${formatInt(forecast.mesCorrente.intervaloMin)}–${formatInt(forecast.mesCorrente.intervaloMax)}`}
          tom={
            forecast.mesCorrente.realizadas >= forecast.mesCorrente.projecaoTotal
              ? "good"
              : "warn"
          }
        />
        <KpiCard
          label="Confiança"
          valor={CONF_LABEL[forecast.confianca]}
          sublabel={`Histórico: ${forecast.historico.length} meses · sazonal × ${forecast.indiceSazonal.toFixed(2)}`}
          confianca={forecast.confianca}
        />
      </div>

      {/* Gráfico de linhas */}
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={dadosGrafico} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" />
            <XAxis dataKey="mes" tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
            <YAxis tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
            <Tooltip
              cursor={{ stroke: "#94a3b8", strokeWidth: 1, strokeDasharray: "3 3" }}
              contentStyle={{
                backgroundColor: "#0f172a",
                border: "1px solid #334155",
                borderRadius: 8,
                fontSize: 12,
                color: "#f1f5f9",
              }}
              labelStyle={{ color: "#f1f5f9", fontWeight: 700, marginBottom: 4 }}
              itemStyle={{ color: "#e2e8f0" }}
              formatter={(value, name) => {
                if (value == null || (typeof value === "string" && !value)) return ["—", String(name ?? "")];
                const num = typeof value === "number" ? value : Number(value);
                if (Number.isFinite(num)) return [String(num), String(name ?? "")];
                return [String(value), String(name ?? "")];
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
            <Area
              type="monotone"
              dataKey="intervaloMax"
              stroke="none"
              fill="#3b82f6"
              fillOpacity={0.1}
              name="Intervalo confiança"
            />
            <Area
              type="monotone"
              dataKey="intervaloMin"
              stroke="none"
              fill="var(--bg-surface)"
              fillOpacity={1}
              name="(piso)"
              legendType="none"
            />
            <Line
              type="monotone"
              dataKey="realizado"
              stroke="#10b981"
              strokeWidth={2.5}
              name="Realizado"
              dot={{ r: 3, fill: "#10b981" }}
            />
            <Line
              type="monotone"
              dataKey="projecao"
              stroke="#3b82f6"
              strokeWidth={2.5}
              strokeDasharray="5 3"
              name="Projeção"
              dot={{ r: 4, fill: "#3b82f6" }}
            />
            <ReferenceLine x={forecast.mesCorrente.rotulo} stroke="#3b82f6" strokeDasharray="2 2" opacity={0.4} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Lista por modelo */}
      {porModelo.length > 0 && (
        <div>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Projeção pra esse mês — top {porModelo.length} modelos
          </h3>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {porModelo.map((p) => (
              <div
                key={p.modelo}
                className="flex items-center justify-between gap-3 rounded-md border border-[var(--border-soft)] bg-[var(--bg-app)] px-3 py-2 text-xs"
              >
                <span className="truncate font-medium text-[var(--text-body)]" title={p.modelo}>
                  {p.modelo}
                </span>
                <span className="shrink-0 tabular-nums">
                  <span className="text-[var(--text-muted)]">esperadas:</span>{" "}
                  <strong className="text-[var(--text-strong)]">{formatInt(p.projecaoEsteMes)}</strong>
                  {p.variacao !== 0 && (
                    <span
                      className={cn(
                        "ml-1 text-[10px]",
                        p.variacao > 0
                          ? "text-amber-700 dark:text-amber-400"
                          : "text-emerald-700 dark:text-emerald-400",
                      )}
                    >
                      ({p.variacao > 0 ? "faltam " : "+"}{Math.abs(p.variacao)})
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function KpiCard({
  label,
  valor,
  sublabel,
  tom = "info",
  confianca,
}: {
  label: string;
  valor: string;
  sublabel: string;
  tom?: "good" | "warn" | "info";
  confianca?: "alta" | "media" | "baixa";
}) {
  const toneClass =
    tom === "good"
      ? "border-emerald-300 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/30"
      : tom === "warn"
        ? "border-amber-300 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/30"
        : "border-[var(--border-soft)] bg-[var(--bg-app)]";

  return (
    <div className={cn("rounded-lg border p-3", toneClass)}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{label}</p>
      <p className="mt-0.5 text-xl font-bold tabular-nums text-[var(--text-strong)]">{valor}</p>
      <div className="mt-1 flex items-center justify-between">
        <p className="text-[10px] text-[var(--text-muted)]">{sublabel}</p>
        {confianca && (
          <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-semibold", CONF_COR[confianca])}>
            {CONF_LABEL[confianca]}
          </span>
        )}
      </div>
    </div>
  );
}
