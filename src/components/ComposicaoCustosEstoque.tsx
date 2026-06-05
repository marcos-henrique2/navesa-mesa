"use client";

import { useState } from "react";
import { Receipt, ShoppingCart, Banknote, Wrench, UserSquare2, Landmark, Briefcase, FileText, Gift, Star, Package, Info, ChevronDown, ChevronUp } from "lucide-react";
import type { CustoEstoqueDetalhado } from "@/lib/parsers/nbs-custos-estoque-pdf";
import { formatBRL, cn } from "@/lib/utils";
import { Tooltip } from "./ui/Tooltip";

type LineItem = {
  label: string;
  icon: React.ReactNode;
  value: number;
  color: string;
  /** Se true, é descontado do custo (Ganhos Indiretos, Bônus, HoldBack). */
  redutor?: boolean;
  /** Texto exibido no tooltip (hover do mouse) explicando o que é a linha. */
  tooltip: string;
};

/**
 * Mostra o breakdown de custo do markup para um carro EM ESTOQUE.
 * Fonte: PDF "Custos de Veículos em Estoque" do NBS.
 *
 * Diferente de ComposicaoCustos (que cobre vendas), este componente é
 * single-veículo e mostra: Nota Fábrica, Revisões, Forplan, HoldBack,
 * Acessórios, ADM, Impostos, Comissões, Desp.Gerais, (-)Bônus,
 * (-)Ganhos Indiretos → Custo Total → Tabela (preço de venda) → Lucro Bruto.
 */
export function ComposicaoCustosEstoque({ custo }: { custo: CustoEstoqueDetalhado }) {
  const [mostrarZerados, setMostrarZerados] = useState(false);

  const itens: LineItem[] = [
    {
      label: "Aquisição (Nota Fábrica)",
      icon: <ShoppingCart className="h-3.5 w-3.5" />, value: custo.nota_fabrica, color: "bg-blue-500",
      tooltip: "Valor pago à fábrica pela aquisição do veículo — base do custo (nota fiscal de compra).",
    },
    {
      label: "Revisões",
      icon: <Wrench className="h-3.5 w-3.5" />, value: custo.revisoes, color: "bg-slate-400",
      tooltip: "Custos de revisão, retífica e recondicionamento aplicados ao veículo antes de entrar no estoque.",
    },
    {
      label: "Floor Plan (sem HB)",
      icon: <Banknote className="h-3.5 w-3.5" />, value: custo.forplan, color: "bg-purple-500",
      tooltip: "Custo financeiro do financiamento de estoque (juros pagos ao banco/financeira por manter o carro no pátio). Já líquido do HoldBack.",
    },
    {
      label: "(−) HoldBack",
      icon: <Gift className="h-3.5 w-3.5" />, value: custo.holdback, color: "bg-emerald-500", redutor: true,
      tooltip: "ABATIMENTO. Reserva que a fábrica devolve ao concessionário após determinado prazo ou venda. Reduz o custo final do veículo.",
    },
    {
      label: "Acessórios",
      icon: <Package className="h-3.5 w-3.5" />, value: custo.acessorios, color: "bg-indigo-500",
      tooltip: "Itens opcionais instalados no veículo após a chegada (multimídia, película, engate, alarme, etc.).",
    },
    {
      label: "ADM",
      icon: <Briefcase className="h-3.5 w-3.5" />, value: custo.adm, color: "bg-slate-600",
      tooltip: "Despesas administrativas rateadas ao veículo (estrutura, sistemas, RH, escritório).",
    },
    {
      label: "Impostos",
      icon: <Landmark className="h-3.5 w-3.5" />, value: custo.impostos, color: "bg-rose-500",
      tooltip: "Impostos diretos incidentes sobre o veículo (PIS/COFINS, ICMS Substituição Tributária, etc.).",
    },
    {
      label: "Comissões",
      icon: <UserSquare2 className="h-3.5 w-3.5" />, value: custo.comissoes, color: "bg-teal-500",
      tooltip: "Comissões pagas a vendedor e gerente pela venda do veículo.",
    },
    {
      label: "Despesas Gerais",
      icon: <FileText className="h-3.5 w-3.5" />, value: custo.desp_gerais, color: "bg-amber-500",
      tooltip: "Demais despesas operacionais alocadas ao veículo (limpeza, transporte interno, despachante, etc.).",
    },
    {
      label: "(−) Bônus de Fábrica",
      icon: <Star className="h-3.5 w-3.5" />, value: custo.bonus, color: "bg-emerald-500", redutor: true,
      tooltip: "ABATIMENTO. Bonificação especial da fábrica (campanha, meta atingida, prêmio de mix). Reduz o custo final.",
    },
    {
      label: "(−) Ganhos Indiretos",
      icon: <Gift className="h-3.5 w-3.5" />, value: custo.ganhos_indiretos, color: "bg-emerald-500", redutor: true,
      tooltip: "ABATIMENTO. Ganhos auxiliares vinculados ao veículo (verba de marketing, comissão de financeira parceira, prêmio de seguradora, recuperação tributária). Reduz o custo final.",
    },
  ];

  // Soma dos itens não-redutores (denominador da barra) — sempre considera TODOS,
  // mesmo zerados, pra manter o percentual fiel ao total.
  const somaAbsoluta = itens.reduce((s, i) => s + (i.redutor ? 0 : i.value), 0) || 1;

  // Separa itens em "com valor" vs "zerados". Por padrão escondemos os zerados
  // pra reduzir poluição visual (carros tipicamente têm 5+ campos em R$ 0).
  const itensComValor = itens.filter((i) => i.value !== 0);
  const itensZerados = itens.filter((i) => i.value === 0);
  const itensVisiveis = mostrarZerados ? itens : itensComValor;

  const positivaMargem = custo.lucro_bruto > 0;
  const margemPct = custo.tabela > 0 ? (custo.lucro_bruto / custo.tabela) * 100 : 0;

  return (
    <section className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] shadow-[var(--shadow-sm)]">
      <header className="flex items-center gap-2 border-b border-[var(--border-soft)] px-5 py-3">
        <Receipt className="h-4 w-4 text-[var(--text-muted)]" />
        <h3 className="text-sm font-semibold text-[var(--text-strong)]">Composição de custos (markup)</h3>
        <span className="text-xs text-[var(--text-muted)]">— carro em estoque</span>
        <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
          ✓ Relatório NBS &quot;Custos de Veículos em Estoque&quot;
        </span>
      </header>

      <div className="grid gap-6 p-5 lg:grid-cols-[1fr,280px]">
        {/* Coluna 1: Itens de custo */}
        <div className="space-y-3">
          {itensVisiveis.map((item) => {
            const pctBar = item.redutor
              ? Math.min(100, (item.value / somaAbsoluta) * 100)
              : (item.value / somaAbsoluta) * 100;
            return (
              <div
                key={item.label}
                className="rounded px-1 -mx-1 py-0.5 transition hover:bg-[var(--bg-muted)]/60"
              >
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className={cn("inline-flex items-center gap-2", item.redutor ? "text-emerald-700 dark:text-emerald-400 font-medium" : "text-[var(--text-body)]")}>
                    {item.icon} {item.label}
                    <Tooltip content={item.tooltip} side="top" className="ml-0.5">
                      <Info className="h-3 w-3 text-[var(--text-subtle)] opacity-60 hover:opacity-100" aria-label={`Sobre ${item.label}`} />
                    </Tooltip>
                  </span>
                  <span className={cn("tabular-nums font-semibold", item.redutor && "text-emerald-700 dark:text-emerald-400")}>
                    {item.redutor && item.value > 0 ? "−" : ""}{formatBRL(item.value)}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded bg-[var(--bg-muted)]">
                    <div className={cn("h-full", item.color)} style={{ width: `${Math.min(100, pctBar)}%` }} />
                  </div>
                  <span className="text-xs tabular-nums text-[var(--text-muted)]" style={{ width: 48 }}>{pctBar.toFixed(1)}%</span>
                </div>
              </div>
            );
          })}

          {/* Toggle pra mostrar/esconder itens R$ 0 */}
          {itensZerados.length > 0 && (
            <button
              type="button"
              onClick={() => setMostrarZerados((v) => !v)}
              className="inline-flex items-center gap-1 rounded-md border border-dashed border-[var(--border-soft)] bg-[var(--bg-app)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-muted)] transition hover:border-[var(--border-base)] hover:bg-[var(--bg-muted)] hover:text-[var(--text-body)]"
            >
              {mostrarZerados ? (
                <>
                  <ChevronUp className="h-3 w-3" /> Ocultar {itensZerados.length} {itensZerados.length === 1 ? "item zerado" : "itens zerados"}
                </>
              ) : (
                <>
                  <ChevronDown className="h-3 w-3" /> Ver {itensZerados.length} {itensZerados.length === 1 ? "item zerado" : "itens zerados"}
                </>
              )}
            </button>
          )}

          <div className="rounded border-t border-[var(--border-soft)] pt-3 transition hover:bg-[var(--bg-muted)]/40">
            <div className="flex items-center justify-between text-sm">
              <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--text-strong)]">
                Custo total NBS
                <Tooltip
                  content="Custo final do veículo conforme calculado pelo NBS DMS. Fórmula: soma dos custos (Nota Fábrica + Revisões + Floor Plan + Acessórios + ADM + Impostos + Comissões + Despesas Gerais) menos os abatimentos (HoldBack + Bônus de Fábrica + Ganhos Indiretos)."
                  side="top"
                >
                  <Info className="h-3 w-3 text-[var(--text-subtle)] opacity-60 hover:opacity-100" aria-label="Sobre custo total NBS" />
                </Tooltip>
              </span>
              <span className="tabular-nums font-bold text-[var(--text-strong)]">{formatBRL(custo.custo_total)}</span>
            </div>
            <p className="mt-1 text-[10px] text-[var(--text-muted)]">
              = Σ(componentes) − HoldBack − Bônus − Ganhos Indiretos
            </p>
          </div>
        </div>

        {/* Coluna 2: Resumo financeiro */}
        <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-muted)] p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Preço Tabela</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-[var(--text-strong)]">{formatBRL(custo.tabela)}</p>

          <p className="mt-4 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">(−) Custo Total NBS</p>
          <p className="mt-1 text-base font-semibold tabular-nums text-[var(--text-body)]">{formatBRL(custo.custo_total)}</p>

          <div className="my-3 border-t border-[var(--border-base)]" />

          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Lucro Bruto Projetado</p>
          <p className={cn("mt-1 text-2xl font-bold tabular-nums", positivaMargem ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400")}>
            {formatBRL(custo.lucro_bruto)}
          </p>
          <p className={cn("text-xs tabular-nums", positivaMargem ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400")}>
            {margemPct.toFixed(2)}% sobre tabela
          </p>

          {custo.dias_patio > 0 && (
            <>
              <div className="my-3 border-t border-[var(--border-base)]" />
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Dias em estoque</p>
              <p className="mt-1 text-sm font-semibold tabular-nums text-[var(--text-body)]">{custo.dias_patio} dias</p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
