"use client";

/**
 * Anomalias — lista carros do estoque cujo preço/custo/dias estão fora do
 * padrão estatístico do modelo (z-score >= 1.5).
 *
 * Mostra:
 *   - Resumo agregado (total, severidade, por tipo)
 *   - Lista detalhada com motivo explicado
 *   - Tap no carro → /veiculos/[chassi]
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, TrendingUp, TrendingDown, Banknote, Clock } from "lucide-react";
import { useInventory } from "@/lib/store/inventory";
import {
  detectarAnomalias,
  resumirAnomalias,
  type Anomalia,
  type TipoAnomalia,
} from "@/lib/analytics/anomalias";
import { cn, formatBRL } from "@/lib/utils";

const TIPO_LABEL: Record<TipoAnomalia, string> = {
  preco_alto: "Preço acima do padrão",
  preco_baixo: "Preço abaixo do padrão",
  custo_alto: "Custo acima do padrão",
  dias_parado: "Parado tempo demais",
};

const TIPO_ICON: Record<TipoAnomalia, React.ComponentType<{ className?: string }>> = {
  preco_alto: TrendingUp,
  preco_baixo: TrendingDown,
  custo_alto: Banknote,
  dias_parado: Clock,
};

export function AnomaliasSection() {
  const { vendas, veiculos, lojas } = useInventory();
  const router = useRouter();
  const [filtroTipo, setFiltroTipo] = useState<"all" | TipoAnomalia>("all");

  const anomalias = useMemo(
    () => detectarAnomalias(veiculos, vendas),
    [veiculos, vendas],
  );
  const resumo = useMemo(() => resumirAnomalias(anomalias), [anomalias]);

  const filtradas = useMemo(() => {
    if (filtroTipo === "all") return anomalias;
    return anomalias.filter((a) => a.tipo === filtroTipo);
  }, [anomalias, filtroTipo]);

  if (veiculos.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--border-base)] bg-[var(--bg-surface)] p-6 text-center text-sm text-[var(--text-muted)]">
        Importe o relatório de estoque pra detectar anomalias.
      </div>
    );
  }

  if (vendas.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--border-base)] bg-[var(--bg-surface)] p-6 text-center text-sm text-[var(--text-muted)]">
        Precisamos do histórico de vendas pra comparar — importe o XLSX de vendas.
      </div>
    );
  }

  if (anomalias.length === 0) {
    return (
      <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-6 text-center dark:border-emerald-900/60 dark:bg-emerald-950/30">
        <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
          ✅ Nenhuma anomalia detectada — todo o estoque está dentro do padrão estatístico dos modelos.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-5 shadow-[var(--shadow-sm)]">
      {/* Resumo */}
      <div className="grid gap-3 sm:grid-cols-4">
        <ResumoCard
          ativo={filtroTipo === "all"}
          onClick={() => setFiltroTipo("all")}
          label="Total"
          valor={resumo.total}
          extra={`${resumo.extrema} extrema · ${resumo.alta} alta · ${resumo.moderada} moderada`}
        />
        <ResumoCard
          ativo={filtroTipo === "preco_alto"}
          onClick={() => setFiltroTipo("preco_alto")}
          label="Preço alto"
          valor={resumo.porTipo.preco_alto}
        />
        <ResumoCard
          ativo={filtroTipo === "custo_alto"}
          onClick={() => setFiltroTipo("custo_alto")}
          label="Custo alto"
          valor={resumo.porTipo.custo_alto}
        />
        <ResumoCard
          ativo={filtroTipo === "dias_parado"}
          onClick={() => setFiltroTipo("dias_parado")}
          label="Parado demais"
          valor={resumo.porTipo.dias_parado}
        />
      </div>

      {/* Lista */}
      <div className="space-y-2">
        {filtradas.slice(0, 20).map((a) => {
          const Icon = TIPO_ICON[a.tipo];
          const nomeLoja = lojas[a.loja]?.nome?.trim() ?? `Loja ${a.loja}`;
          return (
            <button
              key={`${a.chassi}-${a.tipo}`}
              type="button"
              onClick={() => router.push(`/veiculos/${a.chassi}`)}
              className="group flex w-full items-start gap-3 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-app)] p-3 text-left transition hover:border-[var(--border-base)] hover:bg-[var(--bg-muted)]"
            >
              <SeverityChip severidade={a.severidade} z={a.zScore} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Icon className="h-3.5 w-3.5 text-[var(--text-subtle)]" />
                  <p className="text-xs font-semibold text-[var(--text-strong)]">
                    {TIPO_LABEL[a.tipo]}
                  </p>
                </div>
                <p className="mt-0.5 truncate text-xs text-[var(--text-body)]">
                  {a.marca && <span className="text-[var(--text-muted)]">{a.marca}</span>} {a.modelo}{" "}
                  <span className="font-mono text-[10px] text-[var(--text-muted)]">· {a.placa} · {nomeLoja}</span>
                </p>
                <p className="mt-1 text-[11px] text-[var(--text-muted)]">{a.mensagem}</p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-subtle)] transition group-hover:translate-x-0.5 group-hover:text-[var(--brand-700)]" />
            </button>
          );
        })}
      </div>

      {filtradas.length > 20 && (
        <p className="text-center text-[10px] text-[var(--text-muted)]">
          Mostrando 20 de {filtradas.length} anomalias (mais severas primeiro)
        </p>
      )}
    </div>
  );
}

function ResumoCard({
  ativo,
  onClick,
  label,
  valor,
  extra,
}: {
  ativo: boolean;
  onClick: () => void;
  label: string;
  valor: number;
  extra?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg border p-3 text-left transition",
        ativo
          ? "border-[var(--brand-500)] bg-[var(--brand-50)] dark:border-[var(--brand-600)] dark:bg-[var(--brand-900)]/30"
          : "border-[var(--border-soft)] bg-[var(--bg-app)] hover:bg-[var(--bg-muted)]",
      )}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{label}</p>
      <p className="mt-0.5 text-xl font-bold tabular-nums text-[var(--text-strong)]">{valor}</p>
      {extra && <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">{extra}</p>}
    </button>
  );
}

function SeverityChip({ severidade, z }: { severidade: Anomalia["severidade"]; z: number }) {
  const conf =
    severidade === "extrema"
      ? { bg: "bg-red-100 dark:bg-red-950/40", text: "text-red-800 dark:text-red-300" }
      : severidade === "alta"
        ? { bg: "bg-amber-100 dark:bg-amber-950/40", text: "text-amber-800 dark:text-amber-300" }
        : { bg: "bg-[var(--bg-muted)]", text: "text-[var(--text-body)]" };
  return (
    <span
      className={cn(
        "flex h-10 w-12 shrink-0 flex-col items-center justify-center rounded font-bold tabular-nums",
        conf.bg,
        conf.text,
      )}
      title={`${severidade} · z=${z.toFixed(2)}`}
    >
      <span className="text-base leading-none">{Math.abs(z).toFixed(1)}σ</span>
      <span className="mt-0.5 text-[8px] uppercase opacity-70">{severidade.slice(0, 3)}</span>
    </span>
  );
}

// formatBRL importado mas pode ser útil futuramente; suprime warning de unused.
void formatBRL;
