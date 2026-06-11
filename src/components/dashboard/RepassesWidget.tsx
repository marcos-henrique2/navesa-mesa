"use client";

/**
 * Widget compacto pro dashboard com top 5 carros pra repasse + KPI.
 *
 * Substitui o antigo `CardRepasseDashboard` — agora com:
 *   - KPI no topo: "X carros pra repasse — R$ Y travados" + chip "Z críticos"
 *   - Top 5 carros (score desc) com botão "Subir agora" por linha
 *   - Link no rodapé: "Ver todos no estoque" → /estoque com filtro "pra repasse"
 *
 * O filtro do estoque é persistido em localStorage via `usePersistedState` —
 * setamos `veiculos:filtroRepasse` = "sim" antes de navegar.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, ChevronRight, ArrowRight, Repeat } from "lucide-react";
import { useInventory } from "@/lib/store/inventory";
import { useFipeBatch } from "@/lib/fipe/useFipeBatch";
import { useCautelares } from "@/lib/inventory/cautelar";
import {
  calcularCarrosPraRepassar,
  resumirRepasse,
  type MotivoRepasse,
} from "@/lib/analytics/carros-pra-repassar";
import { cn, formatBRL } from "@/lib/utils";
import { SubirRepasseModal } from "../repasses/SubirRepasseModal";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";

// Sincroniza com `usePersistedState`: prefixo "navesa-mesa:filtros:" + sessionStorage
const FILTRO_REPASSE_KEY = "navesa-mesa:filtros:veiculos:filtroRepasse";

export function RepassesWidget() {
  const { veiculos } = useInventory();
  const fipeBatch = useFipeBatch();
  const cautelares = useCautelares();
  const router = useRouter();
  const [veiculoSubindo, setVeiculoSubindo] = useState<VeiculoParsed | null>(null);

  const veiculosPorChassi = useMemo(() => {
    const map = new Map<string, VeiculoParsed>();
    for (const v of veiculos) map.set(v.chassi, v);
    return map;
  }, [veiculos]);

  const resumo = useMemo(() => {
    const carros = calcularCarrosPraRepassar(veiculos, fipeBatch, cautelares);
    return resumirRepasse(carros, 5);
  }, [veiculos, fipeBatch, cautelares]);

  if (resumo.total === 0) return null;

  function navegarParaEstoqueFiltrado() {
    try {
      // Mesmo formato do usePersistedState: sessionStorage + JSON.stringify(value).
      // O hook lê no próximo getSnapshot na página /veiculos.
      const raw = JSON.stringify("sim");
      window.sessionStorage.setItem(FILTRO_REPASSE_KEY, raw);
      window.dispatchEvent(new StorageEvent("storage", { key: FILTRO_REPASSE_KEY, newValue: raw }));
    } catch {
      // sessionStorage indisponível — usuário aplica filtro manualmente após chegar
    }
    router.push("/veiculos");
  }

  return (
    <section className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] shadow-[var(--shadow-sm)]">
      <header className="flex flex-wrap items-center gap-2 border-b border-[var(--border-soft)] px-5 py-3">
        <ArrowRightLeft className="h-4 w-4 text-[var(--text-muted)]" />
        <h3 className="text-sm font-semibold text-[var(--text-strong)]">
          Carros pra repasse
        </h3>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          {resumo.total}
        </span>
        {resumo.criticos > 0 && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-800 dark:bg-red-950/40 dark:text-red-300">
            {resumo.criticos} crítico{resumo.criticos === 1 ? "" : "s"} (bate 3)
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
              <div className="flex items-center gap-3 px-5 py-3 transition hover:bg-[var(--bg-muted)]">
                <button
                  type="button"
                  onClick={() => router.push(`/veiculos/${c.chassi}`)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  title="Ver detalhe do veículo"
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
                      {top2Motivos.map((m, i) => (
                        <span key={i}>
                          {labelMotivo(m)}
                          {i < top2Motivos.length - 1 ? " · " : ""}
                        </span>
                      ))}
                    </p>
                  </div>
                  <span className="hidden text-right text-xs tabular-nums text-[var(--text-muted)] sm:block">
                    {formatBRL(c.capitalTravado)}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    const v = veiculosPorChassi.get(c.chassi);
                    if (v) setVeiculoSubindo(v);
                  }}
                  className="inline-flex items-center gap-1 rounded-md bg-[var(--brand-700)] px-2 py-1 text-[11px] font-medium text-white hover:bg-[var(--brand-800)]"
                  title="Subir pra repasse"
                >
                  <Repeat className="h-3 w-3" /> Subir agora
                </button>
                <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-subtle)]" />
              </div>
            </li>
          );
        })}
      </ul>

      <footer className="border-t border-[var(--border-soft)] px-5 py-2.5">
        <button
          type="button"
          onClick={navegarParaEstoqueFiltrado}
          className="inline-flex items-center gap-1 text-xs font-medium text-[var(--brand-700)] hover:text-[var(--brand-900)] dark:text-[var(--brand-300)] dark:hover:text-[var(--brand-100)]"
        >
          Ver todos no estoque <ArrowRight className="h-3 w-3" />
        </button>
      </footer>

      {veiculoSubindo && (
        <SubirRepasseModal
          veiculo={veiculoSubindo}
          valorSubiuSugerido={veiculoSubindo.preco_venda}
          valorMinimoSugerido={veiculoSubindo.custo_total}
          open={true}
          onClose={() => setVeiculoSubindo(null)}
        />
      )}
    </section>
  );
}

function labelMotivo(m: MotivoRepasse): string {
  switch (m.tipo) {
    case "idade":
      return `${m.anos} anos`;
    case "km":
      return `${m.km.toLocaleString("pt-BR")} km`;
    case "parado":
      return `${m.dias}d parado`;
  }
}
