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
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Cell,
} from "recharts";
import {
  calcularSazonalidadeGeral,
  calcularSazonalidadeTopModelos,
} from "@/lib/analytics/sazonalidade";
import { cn, formatInt } from "@/lib/utils";

export function SazonalidadeSection() {
  const { vendas } = useInventory();

  const geral = useMemo(() => calcularSazonalidadeGeral(vendas), [vendas]);
  const porModelo = useMemo(
    () => calcularSazonalidadeTopModelos(vendas, { topN: 8, minVendas: 12 }),
    [vendas],
  );

  if (!geral || geral.totalVendasModelo === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--border-base)] bg-[var(--bg-surface)] p-6 text-center text-sm text-[var(--text-muted)]">
        Sem vendas suficientes pra calcular sazonalidade.
      </div>
    );
  }

  // Dados pro gráfico: índice sazonal por mês (geral)
  const dadosBarras = geral.meses.map((m) => ({
    mes: m.rotulo,
    indice: m.indice,
    media: m.mediaPorAno,
    total: m.totalVendas,
  }));

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

      {/* Gráfico de barras geral */}
      <div>
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Índice sazonal por mês — geral (todos os modelos)
        </h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dadosBarras} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" />
              <XAxis dataKey="mes" tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
              <YAxis tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--bg-surface)",
                  border: "1px solid var(--border-base)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelStyle={{ color: "var(--text-strong)", fontWeight: 600 }}
                formatter={(value, name) => {
                  const v = typeof value === "number" ? value : Number(value);
                  if (name === "indice" && Number.isFinite(v)) {
                    return [v.toFixed(2) + "×", "Índice sazonal"];
                  }
                  return [String(value ?? ""), String(name ?? "")];
                }}
              />
              <ReferenceLine y={1} stroke="#94a3b8" strokeDasharray="2 2" label={{ value: "Média", fontSize: 10, fill: "#94a3b8" }} />
              <Bar dataKey="indice" name="Índice sazonal">
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
            </BarChart>
          </ResponsiveContainer>
        </div>
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
