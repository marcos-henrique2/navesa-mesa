"use client";

import type { ReactNode } from "react";
import { ArrowRight, CalendarX2, AlertCircle, RefreshCw } from "lucide-react";
import type { FiltrosVendas } from "@/lib/export/vendas-matriz/filtrar-vendas";
import { cn, formatInt } from "@/lib/utils";

/** Callback do cross-filter: abre a aba Vendas com este filtro (substitui os anteriores). */
export type AoFiltrarVendas = (filtro: Partial<FiltrosVendas>) => void;

/**
 * "Ver N vendas →" — link explícito (não cartão clicável: os cartões têm tooltips e botão
 * dentro de botão é inválido). `qtd` é SEMPRE o número do cartão; o filtro aplicado devolve
 * essa mesma quantidade (testado em vendas-matriz-painel-fase2.test.ts).
 */
export function LinkVerVendas({
  qtd,
  descricao,
  filtro,
  onFiltrar,
  rotulo,
  className,
}: {
  qtd: number;
  /** "para pessoa jurídica" → aria-label "Ver as 20 vendas para pessoa jurídica". */
  descricao: string;
  filtro: Partial<FiltrosVendas>;
  onFiltrar?: AoFiltrarVendas;
  rotulo?: string;
  className?: string;
}) {
  if (!onFiltrar || qtd === 0) return null;
  const texto = rotulo ?? `Ver ${formatInt(qtd)} venda${qtd === 1 ? "" : "s"}`;
  return (
    <button
      type="button"
      onClick={() => onFiltrar(filtro)}
      aria-label={`Ver ${qtd === 1 ? "a venda" : `as ${formatInt(qtd)} vendas`} ${descricao}`}
      className={cn(
        "inline-flex items-center gap-1 rounded text-xs font-medium text-[var(--brand-700)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-700)] dark:text-[var(--brand-300)]",
        className,
      )}
    >
      {texto}
      <ArrowRight className="h-3 w-3" aria-hidden="true" />
    </button>
  );
}

export function Cartao({
  titulo,
  idTitulo,
  acoes,
  children,
  className,
}: {
  titulo: ReactNode;
  idTitulo: string;
  acoes?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-labelledby={idTitulo}
      className={cn("rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-4 shadow-[var(--shadow-sm)] sm:p-5", className)}
    >
      <header className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <h2 id={idTitulo} className="flex items-center gap-1.5 text-sm font-semibold text-[var(--text-strong)]">
          {titulo}
        </h2>
        {acoes && <div className="flex flex-wrap items-center gap-2">{acoes}</div>}
      </header>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function EstadoVazioMes({
  nomeMes,
  nomeMesAnterior,
  onVerAnterior,
}: {
  nomeMes: string;
  nomeMesAnterior: string;
  onVerAnterior: () => void;
}) {
  return (
    <div className="mx-auto max-w-lg rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-8 text-center shadow-[var(--shadow-sm)]">
      <CalendarX2 className="mx-auto h-10 w-10 text-[var(--text-subtle)]" aria-hidden="true" />
      <h3 className="mt-3 text-base font-semibold text-[var(--text-strong)]">Nenhuma venda de usado em {nomeMes}</h3>
      <p className="mt-1 text-sm text-[var(--text-muted)]">Se você esperava ver vendas aqui, confira o horário da última atualização acima.</p>
      <button
        type="button"
        onClick={onVerAnterior}
        className="mt-5 inline-flex items-center gap-2 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] px-4 py-2 text-sm font-medium text-[var(--text-body)] transition hover:bg-[var(--bg-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-700)]"
      >
        Ver {nomeMesAnterior}
      </button>
    </div>
  );
}

/** Erro só no cartão que depende dos dados do ano (o resto da aba continua). */
export function ErroNoCartao({ mensagem, detalhe, onRetry }: { mensagem: string; detalhe: string; onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm dark:border-red-900 dark:bg-red-950/30">
      <p className="flex items-center gap-2 font-medium text-red-900 dark:text-red-200">
        <AlertCircle className="h-4 w-4" aria-hidden="true" /> {mensagem}
      </p>
      <details className="mt-1 text-xs text-red-700 dark:text-red-300">
        <summary className="cursor-pointer">Detalhes técnicos</summary>
        <p className="mt-1 font-mono">{detalhe}</p>
      </details>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700"
      >
        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Tentar de novo
      </button>
    </div>
  );
}

/** Fração → "12,3%" com sinal "−" tipográfico; `null` → "—". */
const NF_PCT = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export function fmtFrac(frac: number | null | undefined): string {
  if (frac == null || !Number.isFinite(frac)) return "—";
  const v = frac * 100;
  return `${v < 0 ? "−" : ""}${NF_PCT.format(Math.abs(v))}%`;
}

/** "R$ 300 mil" / "R$ 1,2 mi" — eixo de gráfico (o tooltip mostra o valor cheio). */
const NF_ABREV = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
export function fmtBRLAbrev(v: number): string {
  const a = Math.abs(v);
  const s = v < 0 ? "−" : "";
  if (a >= 1_000_000) return `${s}R$ ${NF_ABREV.format(a / 1_000_000)} mi`;
  if (a >= 1_000) return `${s}R$ ${NF_ABREV.format(a / 1_000)} mil`;
  return `${s}R$ ${NF_ABREV.format(a)}`;
}

/** Classe de valor negativo (sempre acompanhada do sinal "−" no texto). */
export const CLASSE_NEGATIVO = "text-red-700 dark:text-red-400";
