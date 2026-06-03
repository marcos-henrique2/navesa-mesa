"use client";

import { useMemo } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { useInventory } from "@/lib/store/inventory";
import { agregarMargem } from "@/lib/analytics/margem";
import { formatBRL, formatInt, cn } from "@/lib/utils";

type CardFormat = "money" | "int" | "pct";
type DirecaoUp = "good" | "bad";

type Comparacao = {
  label: string;
  atual: number;
  anterior: number;
  delta: number;
  deltaPct: number;
  format: CardFormat;
  // "good" = subida boa (vendas, margem); "bad" = subida ruim (capital travado, dias)
  direcaoUp: DirecaoUp;
};

function periodoMes(d: Date): { ini: Date; fim: Date } {
  const ini = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
  const fim = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
  return { ini, fim };
}

function nomeMes(d: Date): string {
  return d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

export function ComparativoMesAnterior() {
  const { vendas, custosPorPlaca, isHydrated } = useInventory();

  const dados = useMemo(() => {
    if (vendas.length === 0) return null;

    // Mês mais recente com vendas vira "atual"
    const datas = vendas
      .map((v) => v.data_venda)
      .filter((d): d is Date => d != null);
    if (datas.length === 0) return null;
    const maisRecente = new Date(Math.max(...datas.map((d) => d.getTime())));

    const atual = periodoMes(maisRecente);
    const anteriorRef = new Date(maisRecente.getFullYear(), maisRecente.getMonth() - 1, 15);
    const anterior = periodoMes(anteriorRef);

    const vendasAtual = vendas.filter(
      (v) => v.data_venda && v.data_venda >= atual.ini && v.data_venda <= atual.fim,
    );
    const vendasAnterior = vendas.filter(
      (v) => v.data_venda && v.data_venda >= anterior.ini && v.data_venda <= anterior.fim,
    );

    if (vendasAnterior.length === 0) return null; // sem base de comparação

    const aggAtual = agregarMargem(vendasAtual, custosPorPlaca);
    const aggAnterior = agregarMargem(vendasAnterior, custosPorPlaca);

    function build(
      label: string,
      atualVal: number,
      anteriorVal: number,
      format: CardFormat,
      direcaoUp: DirecaoUp,
    ): Comparacao {
      const delta = atualVal - anteriorVal;
      const deltaPct = anteriorVal !== 0 ? (delta / Math.abs(anteriorVal)) * 100 : 0;
      return { label, atual: atualVal, anterior: anteriorVal, delta, deltaPct, format, direcaoUp };
    }

    const ticketAtual = vendasAtual.length > 0 ? aggAtual.valor / vendasAtual.length : 0;
    const ticketAnterior = vendasAnterior.length > 0 ? aggAnterior.valor / vendasAnterior.length : 0;

    return {
      labelAtual: nomeMes(maisRecente),
      labelAnterior: nomeMes(anteriorRef),
      qtAtual: vendasAtual.length,
      qtAnterior: vendasAnterior.length,
      cards: [
        build("Vendas", vendasAtual.length, vendasAnterior.length, "int", "good"),
        build("Faturamento", aggAtual.valor, aggAnterior.valor, "money", "good"),
        build("Margem", aggAtual.margem, aggAnterior.margem, "money", "good"),
        build("Ticket médio", ticketAtual, ticketAnterior, "money", "good"),
      ],
    };
  }, [vendas, custosPorPlaca]);

  if (!isHydrated || !dados) return null;

  return (
    <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-5">
      <div className="flex items-baseline justify-between">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-strong)]">Comparativo mensal</h3>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            <span className="capitalize">{dados.labelAtual}</span> ({formatInt(dados.qtAtual)} vendas) vs{" "}
            <span className="capitalize">{dados.labelAnterior}</span> ({formatInt(dados.qtAnterior)} vendas)
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        {dados.cards.map((c) => (
          <CardComparativo key={c.label} c={c} />
        ))}
      </div>
    </div>
  );
}

function CardComparativo({ c }: { c: Comparacao }) {
  const subiu = c.delta > 0;
  const sem = c.delta === 0;

  // Cor da variação:
  // direcaoUp "good" (vendas/margem): subiu = verde, desceu = vermelho
  // direcaoUp "bad" (capital/dias): subiu = vermelho, desceu = verde
  const cor: "good" | "bad" | "neutral" = sem
    ? "neutral"
    : c.direcaoUp === "good"
      ? subiu
        ? "good"
        : "bad"
      : subiu
        ? "bad"
        : "good";

  const Icon = sem ? Minus : subiu ? TrendingUp : TrendingDown;

  function fmt(v: number): string {
    if (c.format === "money") return formatBRL(v);
    if (c.format === "pct") return `${v.toFixed(1)}%`;
    return formatInt(v);
  }

  return (
    <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-muted)] p-3">
      <div className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">{c.label}</div>
      <div className="mt-1 text-lg font-bold text-[var(--text-strong)]">{fmt(c.atual)}</div>
      <div
        className={cn(
          "mt-1 flex items-center gap-1 text-xs font-medium",
          cor === "good" && "text-emerald-700 dark:text-emerald-400",
          cor === "bad" && "text-red-700 dark:text-red-400",
          cor === "neutral" && "text-[var(--text-muted)]",
        )}
      >
        <Icon className="h-3.5 w-3.5" />
        <span>
          {subiu && "+"}
          {c.deltaPct.toFixed(1)}%
        </span>
        <span className="text-[var(--text-subtle)]">
          ({c.delta > 0 ? "+" : ""}
          {fmt(c.delta)})
        </span>
      </div>
    </div>
  );
}
