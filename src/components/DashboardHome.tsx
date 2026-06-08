"use client";

import Link from "next/link";
import { Upload, Car, Building2, TrendingUp, FileSpreadsheet, ArrowRight } from "lucide-react";
import { useInventory } from "@/lib/store/inventory";
import { agregarMargem } from "@/lib/analytics/margem";
import { classificarPatio, type StatusVeiculo } from "@/lib/inventory/status";
import { formatBRL, formatInt, cn } from "@/lib/utils";
import { PageHeader } from "./AppShell";
import { AlertasOperacionais } from "./AlertasOperacionais";
import { ComparativoMesAnterior } from "./ComparativoMesAnterior";
import { HeatmapLojas } from "./HeatmapLojas";
import { UltimosDiasCard } from "./UltimosDiasCard";

export function DashboardHome() {
  const { meta, veiculos, vendasMeta, vendas, custosPorPlaca, isHydrated } = useInventory();

  // Classifica todo veículo em uma de 5 categorias (preparação alinhada com NBS = 354)
  // valor = CUSTO DE FÁBRICA (capital travado, igual NBS "Custo fábrica sem FP")
  // venda = preço de venda pedido (mostrado como referência secundária)
  const status: Record<StatusVeiculo, { qt: number; valor: number; venda: number }> = {
    disponivel: { qt: 0, valor: 0, venda: 0 },
    transito: { qt: 0, valor: 0, venda: 0 },
    preparacao: { qt: 0, valor: 0, venda: 0 },
    bloqueado: { qt: 0, valor: 0, venda: 0 },
    oficina: { qt: 0, valor: 0, venda: 0 },
    documentacao: { qt: 0, valor: 0, venda: 0 },
    outro: { qt: 0, valor: 0, venda: 0 },
  };
  for (const v of veiculos) {
    const s = classificarPatio(v.patio);
    status[s].qt++;
    status[s].valor += v.valor_aquisicao ?? 0; // custo de fábrica
    status[s].venda += v.preco_venda ?? 0;
  }
  const totalQt = veiculos.length;
  const totalRs = veiculos.reduce((s, v) => s + (v.valor_aquisicao ?? 0), 0);
  const outrosQt = status.bloqueado.qt + status.oficina.qt + status.documentacao.qt + status.outro.qt;
  const outrosRs = status.bloqueado.valor + status.oficina.valor + status.documentacao.valor + status.outro.valor;

  // Margem agregada via lib/analytics/margem.ts (fonte única da verdade)
  const aggVendas = agregarMargem(vendas, custosPorPlaca);
  const vendasValor = aggVendas.valor;
  const vendasCusto = aggVendas.custo;
  const vendasMargem = aggVendas.margem;
  const vendasTemOficial = aggVendas.qtComCustoOficial > 0;

  const semDados = isHydrated && veiculos.length === 0 && vendas.length === 0;

  return (
    <>
      <PageHeader
        title="Visão geral"
        subtitle="Resumo do estoque, vendas e atalhos para análises detalhadas"
        action={
          <Link href="/upload" className="inline-flex items-center gap-2 rounded-lg bg-[var(--brand-700)] px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-[var(--brand-800)]">
            <Upload className="h-4 w-4" /> Novo upload
          </Link>
        }
      />

      <div className="mx-auto max-w-7xl px-6 py-8">
        {semDados ? (
          <EmptyState />
        ) : (
          <div className="space-y-6">
            {/* Alertas operacionais — no topo, sempre que houver algo */}
            <AlertasOperacionais />

            {/* Resumo dos últimos 7 dias */}
            <UltimosDiasCard dias={7} />

            {/* Hero KPIs — Estoque */}
            {isHydrated && veiculos.length > 0 && (
              <section>
                <SectionHeader title="Estoque atual (custo de fábrica)" link={{ href: "/veiculos", label: "Ver estoque completo" }} />
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  <BigKpi
                    accent="emerald"
                    label="Disponível pra venda"
                    value={formatBRL(status.disponivel.valor)}
                    sublabel={`${formatInt(status.disponivel.qt)} carros · venda ${formatBRL(status.disponivel.venda)}`}
                  />
                  <BigKpi
                    accent="amber"
                    label="Em preparação"
                    value={formatBRL(status.preparacao.valor)}
                    sublabel={`${formatInt(status.preparacao.qt)} carros · venda ${formatBRL(status.preparacao.venda)}`}
                  />
                  <BigKpi
                    accent="slate"
                    label="Em trânsito"
                    value={formatBRL(status.transito.valor)}
                    sublabel={`${formatInt(status.transito.qt)} carros · venda ${formatBRL(status.transito.venda)}`}
                  />
                  <BigKpi
                    accent="brand"
                    label="Total (custo travado)"
                    value={formatBRL(totalRs)}
                    sublabel={`${formatInt(totalQt)} carros em ${formatInt(meta?.total_lojas ?? 0)} lojas`}
                  />
                </div>
                {outrosQt > 0 && (
                  <p className="mt-3 text-xs text-[var(--text-muted)]">
                    {status.bloqueado.qt > 0 && <>+ {formatInt(status.bloqueado.qt)} bloqueado{status.bloqueado.qt === 1 ? "" : "s"} · </>}
                    {status.oficina.qt > 0 && <>{formatInt(status.oficina.qt)} em oficina externa · </>}
                    {status.documentacao.qt > 0 && <>{formatInt(status.documentacao.qt)} com pendência de documentação · </>}
                    {status.outro.qt > 0 && <>{formatInt(status.outro.qt)} sem classificação · </>}
                    {formatBRL(outrosRs)} parados
                  </p>
                )}
              </section>
            )}

            {/* Comparativo mês atual vs anterior — bate olho e vê se está melhorando */}
            {isHydrated && vendas.length > 0 && (
              <ComparativoMesAnterior />
            )}

            {/* Vendas */}
            {isHydrated && vendas.length > 0 && (
              <section>
                <SectionHeader title="Vendas no período" link={{ href: "/vendas", label: "Ver análise completa" }} />
                <div className="grid gap-4 md:grid-cols-3">
                  <BigKpi
                    accent="brand"
                    label="Faturamento"
                    value={formatBRL(vendasValor)}
                    sublabel={`${formatInt(vendas.length)} vendas registradas`}
                  />
                  <BigKpi
                    accent="slate"
                    label="Custo total"
                    value={formatBRL(vendasCusto)}
                    sublabel="aquisição + floor plan + despesas"
                  />
                  <BigKpi
                    accent={vendasMargem >= 0 ? "emerald" : "red"}
                    label={vendasTemOficial ? "Margem (oficial NBS)" : "Margem (estimada)"}
                    value={formatBRL(vendasMargem)}
                    sublabel={(() => {
                      const pct = vendasValor > 0 ? ((vendasMargem / vendasValor) * 100).toFixed(2) : "—";
                      const cobertura = aggVendas.cobertura;
                      // Só mostra cobertura quando há custos oficiais
                      if (!vendasTemOficial) return `${pct}% sobre faturamento`;
                      // Cobertura completa: omite (visualmente limpo)
                      if (cobertura >= 0.999) return `${pct}% sobre faturamento · cobertura 100%`;
                      return `${pct}% sobre faturamento · cobertura ${(cobertura * 100).toFixed(1)}%`;
                    })()}
                  />
                </div>
                {vendasMeta?.periodo_inicio && vendasMeta?.periodo_fim && (
                  <p className="mt-3 text-xs text-[var(--text-muted)]">
                    Período: <strong>{new Date(vendasMeta.periodo_inicio).toLocaleDateString("pt-BR")}</strong> → <strong>{new Date(vendasMeta.periodo_fim).toLocaleDateString("pt-BR")}</strong>
                  </p>
                )}
              </section>
            )}

            {/* Heatmap por loja — visão consolidada de saúde operacional */}
            {isHydrated && veiculos.length > 0 && (
              <section>
                <HeatmapLojas />
              </section>
            )}

            {/* Atalhos */}
            <section>
              <SectionHeader title="Atalhos" />
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <QuickCard href="/veiculos" icon={<Car className="h-5 w-5" />} title="Estoque" desc={veiculos.length > 0 ? `${formatInt(veiculos.length)} veículos no estoque` : "Listagem com filtros e KPIs"} />
                <QuickCard href="/vendas" icon={<TrendingUp className="h-5 w-5" />} title="Análise de Vendas" desc={vendas.length > 0 ? `${formatInt(vendas.length)} vendas analisáveis` : "Giro, margem, ranking"} />
                <QuickCard href="/upload" icon={<FileSpreadsheet className="h-5 w-5" />} title="Upload" desc="Subir XLSX do NBS (estoque e/ou vendas)" />
                <QuickCard href="/lojas" icon={<Building2 className="h-5 w-5" />} title="Lojas" desc="Cadastro e nomes das filiais" />
              </div>
            </section>
          </div>
        )}
      </div>
    </>
  );
}

function SectionHeader({ title, link }: { title: string; link?: { href: string; label: string } }) {
  return (
    <div className="mb-3 flex items-end justify-between">
      <h2 className="text-base font-semibold text-[var(--text-strong)]">{title}</h2>
      {link && (
        <Link href={link.href} className="inline-flex items-center gap-1 text-xs font-medium text-[var(--brand-700)] hover:text-[var(--brand-900)] dark:text-[var(--brand-300)] dark:hover:text-[var(--brand-100)]">
          {link.label} <ArrowRight className="h-3 w-3" />
        </Link>
      )}
    </div>
  );
}

type Accent = "brand" | "emerald" | "amber" | "red" | "slate";

// Gradiente termina em bg-surface (em light = branco; em dark = surface escuro).
// Cores semânticas (emerald/amber/red) mantêm os tons -50 do Tailwind como overlay
// — chama atenção em light, e em dark fica como um tint sutil no surface.
const ACCENT_STYLES: Record<Accent, { ring: string; valueText: string; label: string }> = {
  brand:   { ring: "from-[var(--brand-50)] to-[var(--bg-surface)] dark:from-[var(--brand-900)]/40", valueText: "text-[var(--text-strong)]", label: "text-[var(--brand-700)] dark:text-[var(--brand-300)]" },
  emerald: { ring: "from-emerald-50 to-[var(--bg-surface)] dark:from-emerald-950/40",                valueText: "text-emerald-700 dark:text-emerald-400", label: "text-emerald-700 dark:text-emerald-400" },
  amber:   { ring: "from-amber-50 to-[var(--bg-surface)] dark:from-amber-950/40",                    valueText: "text-amber-700 dark:text-amber-400", label: "text-amber-700 dark:text-amber-400" },
  red:     { ring: "from-red-50 to-[var(--bg-surface)] dark:from-red-950/40",                        valueText: "text-red-700 dark:text-red-400", label: "text-red-700 dark:text-red-400" },
  slate:   { ring: "from-slate-100 to-[var(--bg-surface)] dark:from-slate-800/40",                   valueText: "text-[var(--text-strong)]", label: "text-[var(--text-body)]" },
};

function BigKpi({ label, value, sublabel, accent }: { label: string; value: string; sublabel: string; accent: Accent }) {
  const a = ACCENT_STYLES[accent];
  return (
    <div className={cn("relative overflow-hidden rounded-xl border border-[var(--border-soft)] bg-gradient-to-br p-5 shadow-[var(--shadow-sm)]", a.ring)}>
      <p className={cn("text-[10px] font-semibold uppercase tracking-wider", a.label)}>{label}</p>
      <p className={cn("mt-2 text-3xl font-bold tabular-nums tracking-tight", a.valueText)}>{value}</p>
      <p className="mt-1 text-xs text-[var(--text-muted)]">{sublabel}</p>
    </div>
  );
}

function QuickCard({ href, icon, title, desc }: { href: string; icon: React.ReactNode; title: string; desc: string }) {
  return (
    <Link
      href={href}
      className="group flex flex-col rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-5 shadow-[var(--shadow-sm)] transition hover:border-[var(--brand-300)] hover:shadow-[var(--shadow-md)]"
    >
      <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--brand-50)] text-[var(--brand-700)] group-hover:bg-[var(--brand-100)] dark:bg-[var(--brand-900)]/40 dark:text-[var(--brand-300)] dark:group-hover:bg-[var(--brand-900)]/60">
        {icon}
      </div>
      <h3 className="text-sm font-semibold text-[var(--text-strong)]">{title}</h3>
      <p className="mt-1 text-xs text-[var(--text-muted)]">{desc}</p>
      <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-[var(--brand-700)] opacity-0 transition group-hover:opacity-100 dark:text-[var(--brand-300)]">
        Abrir <ArrowRight className="h-3 w-3" />
      </span>
    </Link>
  );
}

function EmptyState() {
  return (
    <div className="mx-auto max-w-2xl rounded-2xl border border-dashed border-[var(--border-base)] bg-[var(--bg-surface)] p-12 text-center shadow-[var(--shadow-sm)]">
      <div className="mx-auto mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--brand-100)] to-[var(--brand-50)] text-[var(--brand-700)] dark:from-[var(--brand-800)]/60 dark:to-[var(--brand-900)]/40 dark:text-[var(--brand-300)]">
        <Upload className="h-6 w-6" />
      </div>
      <h2 className="text-xl font-bold text-[var(--text-strong)]">Comece pelo upload</h2>
      <p className="mt-2 text-sm text-[var(--text-muted)]">
        Exporte os relatórios do NBS (Veículos em Estoque e Veículos Vendidos) e suba aqui.
        Tudo é processado no seu navegador — nenhum dado vai pra cloud sem você configurar.
      </p>
      <Link href="/upload" className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[var(--brand-700)] px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-[var(--brand-800)]">
        <Upload className="h-4 w-4" /> Ir para upload
      </Link>
    </div>
  );
}
