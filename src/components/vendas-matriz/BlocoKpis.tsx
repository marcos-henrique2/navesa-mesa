import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { calcularDelta, type MetricasRecorte } from "@/lib/export/vendas-matriz/resumir-painel";
import { Tooltip } from "@/components/ui/Tooltip";
import { formatBRL, formatInt, cn } from "@/lib/utils";
import { DeltaMoM, fmtMargemPct, type ContextoComparacao } from "./formato";

export function InfoTooltip({ texto, rotulo }: { texto: string; rotulo: string }) {
  return (
    <Tooltip content={texto} ariaLabel={`Sobre ${rotulo}`} className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-700)]">
      <Info className="h-3.5 w-3.5 text-[var(--text-subtle)] opacity-70 hover:opacity-100" aria-hidden="true" />
    </Tooltip>
  );
}

function textoConsignadas(n: number): string {
  return `Vendas consignadas entram na contagem de vendas, mas ficam fora da margem e do ticket: o carro não era da Navesa, então não há lucro de estoque a medir. Neste mês: ${n} consignada${n === 1 ? "" : "s"}.`;
}

function KpiCard({
  rotulo,
  tooltip,
  valor,
  negativo = false,
  children,
}: {
  rotulo: string;
  tooltip: string;
  valor: string;
  negativo?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-4 shadow-[var(--shadow-sm)]">
      <div className="flex items-center gap-1.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{rotulo}</h3>
        <InfoTooltip texto={tooltip} rotulo={rotulo} />
      </div>
      <p className={cn("mt-1 text-xl font-bold tabular-nums sm:text-2xl", negativo ? "text-red-700 dark:text-red-400" : "text-[var(--text-strong)]")}>
        {valor}
      </p>
      {children}
    </div>
  );
}

function LinhaVs({ ctx, valor }: { ctx: ContextoComparacao; valor: string | null }) {
  if (valor == null || ctx.semBaseMes) return null;
  return (
    <p className="mt-0.5 text-[11px] tabular-nums text-[var(--text-muted)]">
      vs. {ctx.rotuloBase}: {valor}
    </p>
  );
}

function NotaConsignadas({ n }: { n: number }) {
  if (n < 1) return null;
  return (
    <p className="mt-1 text-[10px] text-[var(--text-muted)]">
      {n} consignada{n === 1 ? "" : "s"} fora da margem
    </p>
  );
}

const NOTA_SO_CONSIGNADAS = "Todas as vendas do mês são consignadas — sem margem a calcular";

/** Bloco 1 — 4 KPIs do mês (Vendas, Margem R$, Margem %, Ticket médio). */
export function BlocoKpis({
  atual,
  anterior,
  ctx,
}: {
  atual: MetricasRecorte;
  anterior: MetricasRecorte;
  ctx: ContextoComparacao;
}) {
  const motivo = `Não houve vendas em ${ctx.recorteAnterior}`;
  const motivoMargem = ctx.semBaseMes ? motivo : `Sem margem calculável em ${ctx.recorteAnterior}`;
  const ant = (v: number | null): number | null => (ctx.semBaseMes ? null : v);
  const soConsignadas = atual.qtd > 0 && atual.qtdComMargem === 0;
  const tooltipConsig = textoConsignadas(atual.qtdConsignadas);

  return (
    <section aria-label="Indicadores do mês" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KpiCard
        rotulo="Vendas"
        tooltip="Total de usados vendidos pela Ford Aeroporto no mês, incluindo consignados e Auto Avaliar."
        valor={formatInt(atual.qtd)}
      >
        <DeltaMoM delta={calcularDelta(atual.qtd, ant(anterior.qtd), "valor")} motivoSemBase={motivo} />
        <LinhaVs ctx={ctx} valor={formatInt(anterior.qtd)} />
      </KpiCard>

      <KpiCard rotulo="Margem" tooltip={tooltipConsig} valor={formatBRL(atual.margem)} negativo={(atual.margem ?? 0) < 0}>
        {soConsignadas ? (
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">{NOTA_SO_CONSIGNADAS}</p>
        ) : (
          <>
            <DeltaMoM delta={calcularDelta(atual.margem, ant(anterior.margem), "valor")} formato="money" motivoSemBase={motivoMargem} />
            <LinhaVs ctx={ctx} valor={anterior.margem == null ? null : formatBRL(anterior.margem)} />
            <NotaConsignadas n={atual.qtdConsignadas} />
          </>
        )}
      </KpiCard>

      <KpiCard rotulo="Margem %" tooltip={tooltipConsig} valor={fmtMargemPct(atual.margemPct)} negativo={(atual.margemPct ?? 0) < 0}>
        {soConsignadas ? (
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">{NOTA_SO_CONSIGNADAS}</p>
        ) : (
          <>
            <DeltaMoM delta={calcularDelta(atual.margemPct, ant(anterior.margemPct), "pontos")} motivoSemBase={motivoMargem} />
            <LinhaVs ctx={ctx} valor={anterior.margemPct == null ? null : fmtMargemPct(anterior.margemPct)} />
            <NotaConsignadas n={atual.qtdConsignadas} />
          </>
        )}
      </KpiCard>

      <KpiCard rotulo="Ticket médio" tooltip={tooltipConsig} valor={formatBRL(atual.ticket)}>
        {soConsignadas ? (
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">{NOTA_SO_CONSIGNADAS}</p>
        ) : (
          <>
            <DeltaMoM delta={calcularDelta(atual.ticket, ant(anterior.ticket), "valor")} formato="money" motivoSemBase={motivoMargem} />
            <LinhaVs ctx={ctx} valor={anterior.ticket == null ? null : formatBRL(anterior.ticket)} />
            <NotaConsignadas n={atual.qtdConsignadas} />
          </>
        )}
      </KpiCard>
    </section>
  );
}
