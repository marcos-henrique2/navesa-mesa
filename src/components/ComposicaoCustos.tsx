"use client";

import { useMemo } from "react";
import { Receipt, ShoppingCart, Banknote, Wrench, UserSquare2, Truck, Landmark, Briefcase, FileText, Gift, Info } from "lucide-react";
import type { VendaParsed } from "@/lib/parsers/nbs-vendas-xlsx";
import { agregarMargem } from "@/lib/analytics/margem";
import { useInventory } from "@/lib/store/inventory";
import { formatBRL, cn } from "@/lib/utils";

type LineItem = {
  label: string;
  icon: React.ReactNode;
  value: number;
  color: string;
  /** Se true, é descontado do custo (Ganhos Indiretos). */
  redutor?: boolean;
};

export function ComposicaoCustos({ vendas }: { vendas: VendaParsed[] }) {
  const { custosPorPlaca } = useInventory();

  const agg = useMemo(() => agregarMargem(vendas, custosPorPlaca), [vendas, custosPorPlaca]);

  if (vendas.length === 0) return null;
  const positivaMargem = agg.margem > 0;
  const temCustosOficiais = agg.qtComCustoOficial > 0;

  // Itens da composição. Se temos custos oficiais: 9 linhas. Senão: fallback com aviso.
  const itens: LineItem[] = temCustosOficiais ? [
    { label: "Aquisição (Nota Fábrica)", icon: <ShoppingCart className="h-3.5 w-3.5" />, value: agg.componentes.nota_fabrica, color: "bg-blue-500" },
    { label: "Despesas Oficina", icon: <Wrench className="h-3.5 w-3.5" />, value: agg.componentes.despesas_oficina, color: "bg-slate-400" },
    { label: "Frete + ICMS Frete", icon: <Truck className="h-3.5 w-3.5" />, value: agg.componentes.frete, color: "bg-slate-500" },
    { label: "Floor Plan", icon: <Banknote className="h-3.5 w-3.5" />, value: agg.componentes.forplan, color: "bg-purple-500" },
    { label: "Impostos (PIS+COFINS+ICMS)", icon: <Landmark className="h-3.5 w-3.5" />, value: agg.componentes.impostos, color: "bg-rose-500" },
    { label: "Comissões", icon: <UserSquare2 className="h-3.5 w-3.5" />, value: agg.componentes.comissoes, color: "bg-teal-500" },
    { label: "ADM", icon: <Briefcase className="h-3.5 w-3.5" />, value: agg.componentes.adm, color: "bg-slate-600" },
    { label: "Despesas Gerais", icon: <FileText className="h-3.5 w-3.5" />, value: agg.componentes.despesas_gerais, color: "bg-amber-500" },
    { label: "(−) Ganhos Indiretos (Bônus + Valorização)", icon: <Gift className="h-3.5 w-3.5" />, value: agg.componentes.ganhos_indiretos, color: "bg-emerald-500", redutor: true },
  ] : [];

  // Soma absoluta dos itens (custos somam, redutor não conta no denominador da barra)
  const somaAbsoluta = itens.reduce((s, i) => s + (i.redutor ? 0 : i.value), 0) || 1;

  return (
    <section className="rounded-xl border border-[var(--border-soft)] bg-white shadow-[var(--shadow-sm)]">
      <header className="flex items-center gap-2 border-b border-[var(--border-soft)] px-5 py-3">
        <Receipt className="h-4 w-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-900">Composição de custos</h3>
        <span className="text-xs text-slate-500">— {agg.qt} venda{agg.qt === 1 ? "" : "s"} no filtro atual</span>
        {temCustosOficiais ? (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
            ✓ Fórmula oficial NBS · cobertura {(agg.cobertura * 100).toFixed(0)}%
          </span>
        ) : (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
            <Info className="h-3 w-3" /> Sem relatório de custos · usando estimativa
          </span>
        )}
      </header>

      {!temCustosOficiais ? (
        <div className="space-y-3 p-5">
          <p className="text-sm text-slate-700">
            A margem mostrada usa o campo <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">custo_total_final</code> do relatório de vendas como aproximação.
          </p>
          <p className="text-sm text-slate-700">
            Pra ter os 9 componentes detalhados e a margem oficial NBS centavo-a-centavo, faça upload do <strong>Relatório de Custos</strong> em <a href="/upload" className="text-[var(--brand-700)] underline">/upload</a>.
          </p>
          <div className="mt-4 rounded-lg border border-[var(--border-soft)] bg-slate-50 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Margem estimada</p>
            <p className={cn("mt-1 text-2xl font-bold tabular-nums", positivaMargem ? "text-emerald-700" : "text-red-700")}>{formatBRL(agg.margem)}</p>
            <p className="text-xs text-slate-500">{agg.margemPct.toFixed(2)}% sobre faturamento ({formatBRL(agg.valor)})</p>
          </div>
        </div>
      ) : (
        <div className="grid gap-6 p-5 lg:grid-cols-[1fr,280px]">
          {/* Coluna 1: Itens de custo */}
          <div className="space-y-3">
            {itens.map((item) => {
              const pctBar = item.redutor
                ? Math.min(100, (item.value / somaAbsoluta) * 100)
                : (item.value / somaAbsoluta) * 100;
              return (
                <div key={item.label}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className={cn("inline-flex items-center gap-2", item.redutor ? "text-emerald-700 font-medium" : "text-slate-700")}>
                      {item.icon} {item.label}
                    </span>
                    <span className={cn("tabular-nums font-semibold", item.redutor && "text-emerald-700")}>
                      {item.redutor ? "−" : ""}{formatBRL(item.value)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded bg-slate-200">
                      <div className={cn("h-full", item.color)} style={{ width: `${Math.min(100, pctBar)}%` }} />
                    </div>
                    <span className="text-xs tabular-nums text-slate-500" style={{ width: 48 }}>{pctBar.toFixed(1)}%</span>
                  </div>
                </div>
              );
            })}

            <div className="border-t border-[var(--border-soft)] pt-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold text-slate-900">Custo total NBS</span>
                <span className="tabular-nums font-bold text-slate-900">{formatBRL(agg.custo)}</span>
              </div>
              <p className="mt-1 text-[10px] text-slate-500">
                = Σ(componentes) − Ganhos Indiretos
              </p>
            </div>
          </div>

          {/* Coluna 2: Resumo financeiro */}
          <div className="rounded-lg border border-[var(--border-soft)] bg-slate-50 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Faturamento</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-slate-900">{formatBRL(agg.valor)}</p>

            <p className="mt-4 text-[10px] font-semibold uppercase tracking-wider text-slate-500">(−) Custo Total NBS</p>
            <p className="mt-1 text-base font-semibold tabular-nums text-slate-600">{formatBRL(agg.custo)}</p>

            <div className="my-3 border-t border-slate-300" />

            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Margem Real</p>
            <p className={cn("mt-1 text-2xl font-bold tabular-nums", positivaMargem ? "text-emerald-700" : "text-red-700")}>
              {formatBRL(agg.margem)}
            </p>
            <p className={cn("text-xs tabular-nums", positivaMargem ? "text-emerald-700" : "text-red-700")}>
              {agg.margemPct.toFixed(2)}% sobre faturamento
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
