"use client";

import Link from "next/link";
import { Upload, Car, Building2, TrendingUp, FileSpreadsheet, ArrowRight } from "lucide-react";
import { useInventory } from "@/lib/store/inventory";
import { agregarMargem } from "@/lib/analytics/margem";
import { classificarPatio, type StatusVeiculo } from "@/lib/inventory/status";
import { formatBRL, formatInt, cn } from "@/lib/utils";
import { PageHeader } from "./AppShell";

export function DashboardHome() {
  const { meta, veiculos, vendasMeta, vendas, custosPorPlaca, isHydrated } = useInventory();

  // Classifica todo veículo em uma de 5 categorias (preparação alinhada com NBS = 354)
  const status: Record<StatusVeiculo, { qt: number; valor: number }> = {
    disponivel: { qt: 0, valor: 0 },
    transito: { qt: 0, valor: 0 },
    preparacao: { qt: 0, valor: 0 },
    bloqueado: { qt: 0, valor: 0 },
    oficina: { qt: 0, valor: 0 },
    documentacao: { qt: 0, valor: 0 },
    outro: { qt: 0, valor: 0 },
  };
  for (const v of veiculos) {
    const s = classificarPatio(v.patio);
    status[s].qt++;
    status[s].valor += v.preco_venda ?? 0;
  }
  const totalQt = veiculos.length;
  const totalRs = veiculos.reduce((s, v) => s + (v.preco_venda ?? 0), 0);
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
            {/* Hero KPIs — Estoque */}
            {isHydrated && veiculos.length > 0 && (
              <section>
                <SectionHeader title="Estoque atual" link={{ href: "/veiculos", label: "Ver estoque completo" }} />
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  <BigKpi
                    accent="emerald"
                    label="Disponível pra venda"
                    value={formatBRL(status.disponivel.valor)}
                    sublabel={`${formatInt(status.disponivel.qt)} em pátio comercial`}
                  />
                  <BigKpi
                    accent="amber"
                    label="Em preparação"
                    value={formatBRL(status.preparacao.valor)}
                    sublabel={`${formatInt(status.preparacao.qt)} carros (alinhado NBS)`}
                  />
                  <BigKpi
                    accent="slate"
                    label="Em trânsito"
                    value={formatBRL(status.transito.valor)}
                    sublabel={`${formatInt(status.transito.qt)} a caminho do pátio`}
                  />
                  <BigKpi
                    accent="brand"
                    label="Total geral"
                    value={formatBRL(totalRs)}
                    sublabel={`${formatInt(totalQt)} em ${formatInt(meta?.total_lojas ?? 0)} lojas`}
                  />
                </div>
                {outrosQt > 0 && (
                  <p className="mt-3 text-xs text-slate-500">
                    {status.bloqueado.qt > 0 && <>+ {formatInt(status.bloqueado.qt)} bloqueado{status.bloqueado.qt === 1 ? "" : "s"} · </>}
                    {status.oficina.qt > 0 && <>{formatInt(status.oficina.qt)} em oficina externa · </>}
                    {status.documentacao.qt > 0 && <>{formatInt(status.documentacao.qt)} com pendência de documentação · </>}
                    {status.outro.qt > 0 && <>{formatInt(status.outro.qt)} sem classificação · </>}
                    {formatBRL(outrosRs)} parados
                  </p>
                )}
              </section>
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
                  <p className="mt-3 text-xs text-slate-500">
                    Período: <strong>{new Date(vendasMeta.periodo_inicio).toLocaleDateString("pt-BR")}</strong> → <strong>{new Date(vendasMeta.periodo_fim).toLocaleDateString("pt-BR")}</strong>
                  </p>
                )}
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
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      {link && (
        <Link href={link.href} className="inline-flex items-center gap-1 text-xs font-medium text-[var(--brand-700)] hover:text-[var(--brand-900)]">
          {link.label} <ArrowRight className="h-3 w-3" />
        </Link>
      )}
    </div>
  );
}

type Accent = "brand" | "emerald" | "amber" | "red" | "slate";

const ACCENT_STYLES: Record<Accent, { ring: string; valueText: string; label: string }> = {
  brand:   { ring: "from-[var(--brand-50)] to-white", valueText: "text-slate-900", label: "text-[var(--brand-700)]" },
  emerald: { ring: "from-emerald-50 to-white",        valueText: "text-emerald-700", label: "text-emerald-700" },
  amber:   { ring: "from-amber-50 to-white",          valueText: "text-amber-700", label: "text-amber-700" },
  red:     { ring: "from-red-50 to-white",            valueText: "text-red-700", label: "text-red-700" },
  slate:   { ring: "from-slate-100 to-white",         valueText: "text-slate-900", label: "text-slate-600" },
};

function BigKpi({ label, value, sublabel, accent }: { label: string; value: string; sublabel: string; accent: Accent }) {
  const a = ACCENT_STYLES[accent];
  return (
    <div className={cn("relative overflow-hidden rounded-xl border border-[var(--border-soft)] bg-gradient-to-br p-5 shadow-[var(--shadow-sm)]", a.ring)}>
      <p className={cn("text-[10px] font-semibold uppercase tracking-wider", a.label)}>{label}</p>
      <p className={cn("mt-2 text-3xl font-bold tabular-nums tracking-tight", a.valueText)}>{value}</p>
      <p className="mt-1 text-xs text-slate-500">{sublabel}</p>
    </div>
  );
}

function QuickCard({ href, icon, title, desc }: { href: string; icon: React.ReactNode; title: string; desc: string }) {
  return (
    <Link
      href={href}
      className="group flex flex-col rounded-xl border border-[var(--border-soft)] bg-white p-5 shadow-[var(--shadow-sm)] transition hover:border-[var(--brand-300)] hover:shadow-[var(--shadow-md)]"
    >
      <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--brand-50)] text-[var(--brand-700)] group-hover:bg-[var(--brand-100)]">
        {icon}
      </div>
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 text-xs text-slate-500">{desc}</p>
      <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-[var(--brand-700)] opacity-0 transition group-hover:opacity-100">
        Abrir <ArrowRight className="h-3 w-3" />
      </span>
    </Link>
  );
}

function EmptyState() {
  return (
    <div className="mx-auto max-w-2xl rounded-2xl border border-dashed border-[var(--border-base)] bg-white p-12 text-center shadow-[var(--shadow-sm)]">
      <div className="mx-auto mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--brand-100)] to-[var(--brand-50)] text-[var(--brand-700)]">
        <Upload className="h-6 w-6" />
      </div>
      <h2 className="text-xl font-bold text-slate-900">Comece pelo upload</h2>
      <p className="mt-2 text-sm text-slate-500">
        Exporte os relatórios do NBS (Veículos em Estoque e Veículos Vendidos) e suba aqui.
        Tudo é processado no seu navegador — nenhum dado vai pra cloud sem você configurar.
      </p>
      <Link href="/upload" className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[var(--brand-700)] px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-[var(--brand-800)]">
        <Upload className="h-4 w-4" /> Ir para upload
      </Link>
    </div>
  );
}
