"use client";

/**
 * Dashboard de Análise — junta as 3 análises avançadas:
 *   1. Sazonalidade (heatmap mês × modelo + curva geral)
 *   2. Forecast (projeção do mês corrente vs realizado)
 *   3. Anomalias (carros fora do padrão estatístico do modelo)
 */

import { useMemo } from "react";
import Link from "next/link";
import { Calendar, TrendingUp, AlertCircle, Sparkles, Printer } from "lucide-react";
import { useInventory } from "@/lib/store/inventory";
import { SazonalidadeSection } from "./analise/SazonalidadeSection";
import { ForecastSection } from "./analise/ForecastSection";
import { AnomaliasSection } from "./analise/AnomaliasSection";

export function AnaliseDashboard() {
  const { vendas, veiculos, isHydrated } = useInventory();

  const datasetInfo = useMemo(() => {
    if (vendas.length === 0) return null;
    let min: Date | null = null;
    let max: Date | null = null;
    for (const v of vendas) {
      if (!v.data_venda) continue;
      if (!min || v.data_venda < min) min = v.data_venda;
      if (!max || v.data_venda > max) max = v.data_venda;
    }
    if (!min || !max) return null;
    const meses = (max.getFullYear() - min.getFullYear()) * 12 + (max.getMonth() - min.getMonth()) + 1;
    return { total: vendas.length, meses, min, max };
  }, [vendas]);

  if (!isHydrated) {
    return <div className="p-6 text-sm text-[var(--text-muted)]">Carregando…</div>;
  }

  if (vendas.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--border-base)] bg-[var(--bg-surface)] p-12 text-center">
        <Sparkles className="mx-auto h-8 w-8 text-[var(--text-subtle)]" />
        <h2 className="mt-3 text-xl font-bold text-[var(--text-strong)]">Sem dados de vendas</h2>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          Importe o relatório de vendas em{" "}
          <Link href="/upload" className="text-[var(--brand-700)] underline">
            /upload
          </Link>{" "}
          pra desbloquear as análises (sazonalidade, forecast, anomalias).
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Toolbar — escopo + ações (esconde no print) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {datasetInfo && (
          <div className="flex-1 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] px-4 py-3 text-xs text-[var(--text-muted)]">
            📊 Analisando <strong className="text-[var(--text-strong)]">{datasetInfo.total.toLocaleString("pt-BR")} vendas</strong>{" "}
            em <strong className="text-[var(--text-strong)]">{datasetInfo.meses} meses</strong> de histórico
            ({datasetInfo.min.toLocaleDateString("pt-BR")} → {datasetInfo.max.toLocaleDateString("pt-BR")})
          </div>
        )}
        <button
          type="button"
          onClick={() => window.print()}
          className="print-hide inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] px-3 py-2 text-xs font-medium text-[var(--text-body)] shadow-sm transition hover:bg-[var(--bg-muted)]"
          title="Imprimir ou salvar como PDF (Ctrl+P)"
        >
          <Printer className="h-3.5 w-3.5" />
          Imprimir / PDF
        </button>
      </div>

      {/* 1. Forecast — primeiro porque é o que tá ACONTECENDO AGORA */}
      <Section
        icon={<TrendingUp className="h-5 w-5 text-[var(--brand-700)] dark:text-[var(--brand-300)]" />}
        titulo="Forecast do mês corrente"
        subtitulo="Projeção combinando moving average dos últimos meses + sazonalidade"
      >
        <ForecastSection />
      </Section>

      {/* 2. Sazonalidade — o "porquê" do forecast */}
      <Section
        icon={<Calendar className="h-5 w-5 text-[var(--brand-700)] dark:text-[var(--brand-300)]" />}
        titulo="Sazonalidade"
        subtitulo="Quais meses puxam e quais drenam as vendas, geral e por modelo"
      >
        <SazonalidadeSection />
      </Section>

      {/* 3. Anomalias — o que está fora do padrão */}
      <Section
        icon={<AlertCircle className="h-5 w-5 text-[var(--brand-700)] dark:text-[var(--brand-300)]" />}
        titulo="Anomalias no estoque"
        subtitulo="Carros fora do padrão estatístico do modelo (preço, custo, dias parados)"
      >
        <AnomaliasSection />
      </Section>

      {veiculos.length === 0 && (
        <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-4 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
          ℹ️ Pra ver anomalias no estoque, importe também o XLSX de estoque atual.
        </div>
      )}
    </div>
  );
}

function Section({
  icon,
  titulo,
  subtitulo,
  children,
}: {
  icon: React.ReactNode;
  titulo: string;
  subtitulo: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-start gap-2">
        {icon}
        <div>
          <h2 className="text-base font-semibold text-[var(--text-strong)]">{titulo}</h2>
          <p className="text-xs text-[var(--text-muted)]">{subtitulo}</p>
        </div>
      </div>
      {children}
    </section>
  );
}
