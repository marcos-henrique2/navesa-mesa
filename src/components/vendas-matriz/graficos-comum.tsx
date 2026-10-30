"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import type { CompradorChave } from "@/lib/export/vendas-matriz/resumir-painel";
import type { OrigemChave } from "@/lib/export/vendas-matriz/tipos";

/**
 * Padrão visual de gráfico do painel (spec Fase 2 §3.4): grid `--border-soft` tracejado só
 * horizontal, ticks 11px `--text-muted`, tooltip com tokens do tema (nunca cor fixa),
 * legenda em texto, `prefers-reduced-motion` desliga animação.
 *
 * Cores das séries = as da Fase 1 (origem/comprador), como variáveis CSS locais com passo
 * próprio no tema escuro — o SVG do Recharts lê `var(--c-*)`.
 */
export const CLASSE_VARS_GRAFICO = [
  "[--c-brand:var(--brand-700)] dark:[--c-brand:var(--brand-400)]",
  "[--c-proprio:#059669] dark:[--c-proprio:#10b981]",
  // amber-600 no claro (≥ 3:1 sobre branco); amber-500 no escuro. Só nos gráficos — o Resumo (CSS) não muda.
  "[--c-outras:#d97706] dark:[--c-outras:#f59e0b]",
  "[--c-naoIdentificada:#94a3b8]",
  "[--c-pf:#3b82f6]",
  "[--c-pj:#a855f7]",
  "[--c-autoAvaliar:#64748b]",
  "[--c-naoInformado:#cbd5e1] dark:[--c-naoInformado:#475569]",
  "[--c-anterior:#94a3b8]",
  "[--c-desconto:#94a3b8]",
  "[--c-resultado:#059669] dark:[--c-resultado:#10b981]",
].join(" ");

export const COR_ORIGEM_GRAFICO: Record<OrigemChave, string> = {
  proprio: "var(--c-proprio)",
  outras: "var(--c-outras)",
  naoIdentificada: "var(--c-naoIdentificada)",
};

export const COR_COMPRADOR_GRAFICO: Record<CompradorChave, string> = {
  pf: "var(--c-pf)",
  pj: "var(--c-pj)",
  autoAvaliar: "var(--c-autoAvaliar)",
  naoInformado: "var(--c-naoInformado)",
};

export const ROTULO_COMPRADOR_GRAFICO: Record<CompradorChave, string> = {
  pf: "Pessoa física",
  pj: "Pessoa jurídica",
  autoAvaliar: "Auto Avaliar",
  naoInformado: "Não informado",
};

export const TICK = { fontSize: 11, fill: "var(--text-muted)" } as const;
export const GRID = { stroke: "var(--border-soft)", strokeDasharray: "3 3", vertical: false } as const;

function assinarMovimento(cb: () => void): () => void {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/** `true` quando o sistema pede menos movimento → `isAnimationActive={false}`. */
export function useMenosMovimento(): boolean {
  return useSyncExternalStore(
    assinarMovimento,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => true,
  );
}

/** Caixa do tooltip com tokens do tema (claro/escuro). */
export function ChartTooltip({ titulo, children }: { titulo?: ReactNode; children: ReactNode }) {
  return (
    <div className="max-w-[18rem] rounded-lg border border-[var(--border-base)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-strong)] shadow-[var(--shadow-md)]">
      {titulo && <p className="mb-1 font-semibold">{titulo}</p>}
      <div className="space-y-0.5 tabular-nums text-[var(--text-body)]">{children}</div>
    </div>
  );
}

/** Legenda em texto (identidade nunca só pela cor). `tracejada` = série de comparação. */
export function Legenda({ itens }: { itens: { rotulo: string; cor: string; forma?: "barra" | "linha" | "tracejada" | "hachura" }[] }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--text-muted)]">
      {itens.map((i) => (
        <li key={i.rotulo} className="inline-flex items-center gap-1.5">
          {i.forma === "linha" || i.forma === "tracejada" ? (
            <svg width="18" height="6" aria-hidden="true">
              <line x1="0" y1="3" x2="18" y2="3" stroke={i.cor} strokeWidth="2" strokeDasharray={i.forma === "tracejada" ? "4 3" : undefined} />
            </svg>
          ) : i.forma === "hachura" ? (
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ background: `repeating-linear-gradient(45deg, ${i.cor} 0 2px, var(--bg-surface) 2px 3px)` }}
              aria-hidden="true"
            />
          ) : (
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: i.cor }} aria-hidden="true" />
          )}
          {i.rotulo}
        </li>
      ))}
    </ul>
  );
}
