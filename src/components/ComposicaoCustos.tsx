"use client";

import { useMemo } from "react";
import { Receipt, ShoppingCart, Banknote, Wrench, UserSquare2 } from "lucide-react";
import type { VendaParsed } from "@/lib/parsers/nbs-vendas-xlsx";
import { formatBRL, cn } from "@/lib/utils";

type LineItem = {
  label: string;
  icon: React.ReactNode;
  value: number;
  count: number; // quantas vendas têm esse custo > 0
  tone?: string;
};

export function ComposicaoCustos({ vendas }: { vendas: VendaParsed[] }) {
  const stats = useMemo(() => {
    let aquisicao = 0, qtAq = 0;
    let floorPlan = 0, qtFp = 0;
    let despesas = 0, qtDesp = 0;
    let comissao = 0, qtCom = 0;
    let valorVenda = 0;

    for (const v of vendas) {
      if (v.total_nota_fabrica) { aquisicao += v.total_nota_fabrica; qtAq++; }
      if (v.custo_floor_plan) { floorPlan += v.custo_floor_plan; qtFp++; }
      if (v.despesas_gerais) { despesas += v.despesas_gerais; qtDesp++; }
      if (v.comissao_vendedor) { comissao += v.comissao_vendedor; qtCom++; }
      if (v.valor_venda) valorVenda += v.valor_venda;
    }

    const custoTotal = aquisicao + floorPlan + despesas + comissao;
    const margem = valorVenda - custoTotal;
    const margemPct = custoTotal > 0 ? (margem / custoTotal) * 100 : 0;

    return {
      qt: vendas.length,
      valorVenda,
      custoTotal,
      margem,
      margemPct,
      items: [
        { label: "Aquisição", icon: <ShoppingCart className="h-3.5 w-3.5" />, value: aquisicao, count: qtAq },
        { label: "Floor Plan", icon: <Banknote className="h-3.5 w-3.5" />, value: floorPlan, count: qtFp },
        { label: "Despesas gerais", icon: <Wrench className="h-3.5 w-3.5" />, value: despesas, count: qtDesp },
        { label: "Comissão vendedor", icon: <UserSquare2 className="h-3.5 w-3.5" />, value: comissao, count: qtCom },
      ] as LineItem[],
    };
  }, [vendas]);

  if (vendas.length === 0) return null;
  const positivaMargem = stats.margem > 0;

  return (
    <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <header className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <Receipt className="h-4 w-4 text-zinc-500" />
        <h3 className="font-semibold text-sm">Composição de custos</h3>
        <span className="text-xs text-zinc-500">— {stats.qt} venda{stats.qt === 1 ? "" : "s"} no filtro atual</span>
      </header>

      <div className="grid gap-6 p-5 lg:grid-cols-[1fr,260px]">
        {/* Coluna 1: Itens de custo com barras */}
        <div className="space-y-3">
          {stats.items.map((item) => {
            const pct = stats.custoTotal > 0 ? (item.value / stats.custoTotal) * 100 : 0;
            return (
              <div key={item.label}>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="inline-flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
                    {item.icon} {item.label}
                    {item.count < stats.qt && <span className="text-[10px] text-zinc-400">({item.count}/{stats.qt})</span>}
                  </span>
                  <span className="tabular-nums font-semibold">{formatBRL(item.value)}</span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-800">
                    <div className={cn("h-full", barColorFor(item.label))} style={{ width: `${Math.min(100, pct)}%` }} />
                  </div>
                  <span className="text-xs tabular-nums text-zinc-500" style={{ width: 48 }}>{pct.toFixed(1)}%</span>
                </div>
              </div>
            );
          })}

          <div className="border-t border-zinc-200 pt-3 dark:border-zinc-800">
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold">Custo total</span>
              <span className="tabular-nums font-bold">{formatBRL(stats.custoTotal)}</span>
            </div>
          </div>
        </div>

        {/* Coluna 2: Resumo financeiro */}
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">Faturamento</p>
          <p className="mt-1 text-xl font-bold tabular-nums">{formatBRL(stats.valorVenda)}</p>

          <p className="mt-4 text-[10px] font-medium uppercase tracking-wide text-zinc-500">(−) Custo total</p>
          <p className="mt-1 text-base font-semibold tabular-nums text-zinc-600 dark:text-zinc-400">{formatBRL(stats.custoTotal)}</p>

          <div className="my-3 border-t border-zinc-300 dark:border-zinc-700" />

          <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">Margem líquida</p>
          <p className={cn("mt-1 text-2xl font-bold tabular-nums", positivaMargem ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400")}>
            {formatBRL(stats.margem)}
          </p>
          <p className={cn("text-xs tabular-nums", positivaMargem ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400")}>
            {stats.margemPct.toFixed(1)}% sobre o custo
          </p>
        </div>
      </div>
    </section>
  );
}

function barColorFor(label: string): string {
  switch (label) {
    case "Aquisição": return "bg-blue-500";
    case "Floor Plan": return "bg-purple-500";
    case "Despesas gerais": return "bg-amber-500";
    case "Comissão vendedor": return "bg-teal-500";
    default: return "bg-zinc-500";
  }
}
