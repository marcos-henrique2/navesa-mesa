"use client";

/**
 * Card resumido "Top 5 carros pra repassar" no dashboard.
 * Cada item lista placa, modelo, score e os 2 motivos principais.
 * Tap em qualquer item → /veiculos/[chassi].
 * Footer com link pra página completa /repassar.
 */

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, ChevronRight, ArrowRight } from "lucide-react";
import { useInventory } from "@/lib/store/inventory";
import { useFipeBatch } from "@/lib/fipe/useFipeBatch";
import { useCautelares } from "@/lib/inventory/cautelar";
import {
  calcularCarrosPraRepassar,
  resumirRepasse,
} from "@/lib/analytics/carros-pra-repassar";
import { cn, formatBRL } from "@/lib/utils";

export function CardRepasseDashboard() {
  const { veiculos } = useInventory();
  const fipeBatch = useFipeBatch();
  const cautelares = useCautelares();
  const router = useRouter();

  const resumo = useMemo(() => {
    const carros = calcularCarrosPraRepassar(veiculos, fipeBatch, cautelares);
    return resumirRepasse(carros, 5);
  }, [veiculos, fipeBatch, cautelares]);

  // Sem carros priorizados → não renderiza
  if (resumo.total === 0) return null;

  return (
    <section className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] shadow-[var(--shadow-sm)]">
      <header className="flex flex-wrap items-center gap-2 border-b border-[var(--border-soft)] px-5 py-3">
        <ArrowRightLeft className="h-4 w-4 text-[var(--text-muted)]" />
        <h3 className="text-sm font-semibold text-[var(--text-strong)]">
          Top {resumo.topN.length} carros pra repassar
        </h3>
        <span className="text-xs text-[var(--text-muted)]">
          — de {resumo.total} priorizado{resumo.total === 1 ? "" : "s"}
        </span>
        {resumo.criticos > 0 && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-800 dark:bg-red-950/40 dark:text-red-300">
            {resumo.criticos} crítico{resumo.criticos === 1 ? "" : "s"}
          </span>
        )}
        <span className="ml-auto text-[10px] tabular-nums text-[var(--text-muted)]">
          Capital travado: <span className="font-semibold text-[var(--text-strong)]">{formatBRL(resumo.capitalTotal)}</span>
        </span>
      </header>

      <ul className="divide-y divide-[var(--border-soft)]">
        {resumo.topN.map((c) => {
          const cor = c.score >= 85
            ? "bg-red-200 text-red-900 dark:bg-red-950/60 dark:text-red-200"
            : c.score >= 75
              ? "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300"
              : "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300";
          const top2Motivos = c.motivos.slice(0, 2);
          return (
            <li key={c.chassi}>
              <button
                type="button"
                onClick={() => router.push(`/veiculos/${c.chassi}`)}
                className="flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-[var(--bg-muted)]"
              >
                <span className={cn("inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-sm font-bold tabular-nums", cor)}>
                  {c.score}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[var(--text-strong)]">
                    {c.marca && <span className="text-[var(--text-muted)]">{c.marca}</span>} {c.modelo}{" "}
                    <span className="font-mono text-xs text-[var(--text-muted)]">· {c.placa}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                    {top2Motivos.map((m, i) => {
                      let label = "";
                      switch (m.tipo) {
                        case "parado":
                          label = `${m.dias}d parado`;
                          break;
                        case "margem-fraca":
                          label = `Margem ${m.pct >= 0 ? "+" : ""}${m.pct.toFixed(1)}%`;
                          break;
                        case "acima-fipe":
                          label = `+${m.pct.toFixed(1)}% FIPE`;
                          break;
                        case "cautelar-restricao":
                          label = "Cautelar restrição";
                          break;
                        default:
                          label = "";
                      }
                      return (
                        <span key={i}>
                          {label}
                          {i < top2Motivos.length - 1 ? " · " : ""}
                        </span>
                      );
                    })}
                  </p>
                </div>
                <span className="hidden text-right text-xs tabular-nums text-[var(--text-muted)] sm:block">
                  {formatBRL(c.capitalTravado)}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-subtle)]" />
              </button>
            </li>
          );
        })}
      </ul>

      <footer className="border-t border-[var(--border-soft)] px-5 py-2.5">
        <Link
          href="/repassar"
          className="inline-flex items-center gap-1 text-xs font-medium text-[var(--brand-700)] hover:text-[var(--brand-900)] dark:text-[var(--brand-300)] dark:hover:text-[var(--brand-100)]"
        >
          Ver todos os {resumo.total} <ArrowRight className="h-3 w-3" />
        </Link>
      </footer>
    </section>
  );
}
