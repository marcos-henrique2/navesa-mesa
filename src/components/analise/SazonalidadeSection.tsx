"use client";

/**
 * Sazonalidade — heatmap mês × top modelos + curva geral.
 *
 * O índice sazonal mostra quanto cada mês desvia do "normal":
 *   • 1.0 = típico
 *   • >1.2 = mês forte (puxa)
 *   • <0.8 = mês fraco (drena)
 */

import { useMemo } from "react";
import { useInventory } from "@/lib/store/inventory";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Cell,
  Legend,
} from "recharts";
import {
  calcularSazonalidadeGeral,
  calcularSazonalidadeTopModelos,
} from "@/lib/analytics/sazonalidade";
import { cn, formatInt } from "@/lib/utils";

export function SazonalidadeSection() {
  const { vendas, custosPorPlaca } = useInventory();

  const geral = useMemo(() => calcularSazonalidadeGeral(vendas, custosPorPlaca), [vendas, custosPorPlaca]);
  const porModelo = useMemo(
    () => calcularSazonalidadeTopModelos(vendas, custosPorPlaca, { topN: 8, minVendas: 12 }),
    [vendas, custosPorPlaca],
  );

  if (!geral || geral.totalVendasModelo === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--border-base)] bg-[var(--bg-surface)] p-6 text-center text-sm text-[var(--text-muted)]">
        Sem vendas suficientes pra calcular sazonalidade.
      </div>
    );
  }

  // Dados pro gráfico: índice sazonal por mês (geral) + margem média
  const dadosBarras = geral.meses.map((m) => ({
    mes: m.rotulo,
    indice: m.indice,
    media: m.mediaPorAno,
    total: m.totalVendas,
    margemPct: m.margemMediaPct,
  }));
  const temMargem = dadosBarras.some((d) => d.margemPct != null);

  return (
    <div className="space-y-5 rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-5 shadow-[var(--shadow-sm)]">
      {/* Highlight de pico e vale */}
      {(geral.mesPico || geral.mesVale) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {geral.mesPico && (
            <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-900/60 dark:bg-emerald-950/30">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                🟢 Mês mais forte
              </p>
              <p className="mt-0.5 text-lg font-bold tabular-nums text-emerald-900 dark:text-emerald-200">
                {geral.mesPico.rotulo} ({geral.mesPico.indice.toFixed(2)}× média)
              </p>
              <p className="text-xs text-emerald-700 dark:text-emerald-400">
                {Math.round(geral.mesPico.mediaPorAno)} vendas/ano em média · {geral.mesPico.totalVendas} no histórico
              </p>
            </div>
          )}
          {geral.mesVale && (
            <div className="rounded-lg border border-red-300 bg-red-50 p-3 dark:border-red-900/60 dark:bg-red-950/30">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-red-700 dark:text-red-300">
                🔴 Mês mais fraco
              </p>
              <p className="mt-0.5 text-lg font-bold tabular-nums text-red-900 dark:text-red-200">
                {geral.mesVale.rotulo} ({geral.mesVale.indice.toFixed(2)}× média)
              </p>
              <p className="text-xs text-red-700 dark:text-red-400">
                {Math.round(geral.mesVale.mediaPorAno)} vendas/ano em média · ajuste planos de compra
              </p>
            </div>
          )}
        </div>
      )}

      {/* Gráfico geral — índice sazonal (barras) + margem média (linha) */}
      <div>
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Volume × Margem por mês — geral (todos os modelos)
        </h3>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={dadosBarras} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" />
              <XAxis dataKey="mes" tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
              <YAxis
                yAxisId="left"
                tick={{ fontSize: 11, fill: "var(--text-muted)" }}
                label={{
                  value: "Índice sazonal",
                  angle: -90,
                  position: "insideLeft",
                  fontSize: 10,
                  fill: "var(--text-muted)",
                }}
              />
              {temMargem && (
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 11, fill: "#8b5cf6" }}
                  label={{
                    value: "Margem %",
                    angle: 90,
                    position: "insideRight",
                    fontSize: 10,
                    fill: "#8b5cf6",
                  }}
                  tickFormatter={(v: number) => `${v.toFixed(1)}%`}
                />
              )}
              <Tooltip
                cursor={{ fill: "rgba(148, 163, 184, 0.12)" }}
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
                  const v = typeof value === "number" ? value : Number(value);
                  if (name === "indice" && Number.isFinite(v)) {
                    const intensidade =
                      v >= 1.2 ? " (forte)" : v >= 0.8 ? " (típico)" : " (fraco)";
                    return [v.toFixed(2).replace(".", ",") + "×" + intensidade, "Índice sazonal"];
                  }
                  if (name === "margemPct" && Number.isFinite(v)) {
                    const qualidade =
                      v >= 5 ? " (saudável)" : v >= 0 ? " (apertada)" : " (prejuízo)";
                    return [v.toFixed(2).replace(".", ",") + "%" + qualidade, "Margem média"];
                  }
                  return [String(value ?? ""), String(name ?? "")];
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                formatter={(value) =>
                  value === "indice" ? "Volume (índice sazonal)" : "Margem média (%)"
                }
              />
              <ReferenceLine
                yAxisId="left"
                y={1}
                stroke="#94a3b8"
                strokeDasharray="2 2"
                label={{ value: "Média", fontSize: 10, fill: "#94a3b8" }}
              />
              <Bar yAxisId="left" dataKey="indice" name="indice">
                {dadosBarras.map((d) => (
                  <Cell
                    key={d.mes}
                    fill={
                      d.indice >= 1.2
                        ? "#10b981"
                        : d.indice >= 0.8
                          ? "#94a3b8"
                          : d.indice > 0
                            ? "#ef4444"
                            : "#cbd5e1"
                    }
                  />
                ))}
              </Bar>
              {temMargem && (
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="margemPct"
                  name="margemPct"
                  stroke="#8b5cf6"
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: "#8b5cf6" }}
                  connectNulls
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        {!temMargem && (
          <p className="mt-1 text-[10px] italic text-[var(--text-muted)]">
            Importe o XLSX de custos pra cruzar volume × margem.
          </p>
        )}
      </div>

      {/* Heatmap por modelo */}
      {porModelo.length > 0 && (
        <div>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Top {porModelo.length} modelos × meses
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--border-soft)] text-left text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                  <th className="py-2 pr-2">Modelo</th>
                  <th className="py-2 pr-2 text-right">Total</th>
                  {geral.meses.map((m) => (
                    <th key={m.mes} className="px-1 py-2 text-center">
                      {m.rotulo}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {porModelo.map((mod) => (
                  <tr key={mod.modelo} className="border-b border-[var(--border-soft)]">
                    <td className="py-1.5 pr-2 text-[var(--text-body)]">
                      <span title={mod.modelo} className="line-clamp-1 max-w-[200px]">
                        {mod.modelo}
                      </span>
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums text-[var(--text-muted)]">
                      {formatInt(mod.totalVendasModelo)}
                    </td>
                    {mod.meses.map((m) => (
                      <td key={m.mes} className="px-1 py-1.5 text-center">
                        <span
                          className={cn(
                            "inline-block w-8 rounded px-1 text-[10px] font-semibold tabular-nums",
                            indiceToClass(m.indice),
                          )}
                          title={`${m.rotulo}: ${m.totalVendas} vendas, índice ${m.indice.toFixed(2)}`}
                        >
                          {m.indice > 0 ? m.indice.toFixed(1) : "—"}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[10px] text-[var(--text-muted)]">
            Cor: <span className="rounded bg-emerald-200 px-1 dark:bg-emerald-900/50">verde</span> = mês forte (≥1.2×){" "}
            <span className="rounded bg-red-200 px-1 dark:bg-red-900/50">vermelho</span> = mês fraco (&lt;0.8×){" "}
            <span className="rounded bg-slate-200 px-1 dark:bg-slate-700">cinza</span> = típico
          </p>
        </div>
      )}
    </div>
  );
}

function indiceToClass(idx: number): string {
  if (idx >= 1.5)
    return "bg-emerald-300 text-emerald-900 dark:bg-emerald-700 dark:text-emerald-100";
  if (idx >= 1.2)
    return "bg-emerald-200 text-emerald-900 dark:bg-emerald-900/60 dark:text-emerald-200";
  if (idx >= 0.8 && idx > 0)
    return "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200";
  if (idx > 0)
    return "bg-red-200 text-red-900 dark:bg-red-900/60 dark:text-red-200";
  return "bg-[var(--bg-muted)] text-[var(--text-subtle)]";
}
