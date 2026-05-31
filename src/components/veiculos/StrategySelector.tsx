"use client";

/**
 * 3 chips horizontais clicáveis pra escolher a estratégia de preço:
 * Target / Giro rápido / Mínimo.
 *
 * Cada chip mostra ícone + label + valor R$ + margem % + badge de fonte.
 * Click muda a estratégia selecionada — o consumidor reage atualizando o CTA primário.
 */

import { formatBRL, cn } from "@/lib/utils";

export type EstrategiaId = "target" | "giro" | "minimo";
export type FonteEstrategia = "historico" | "fipe" | "custo";

export type EstrategiaItem = {
  id: EstrategiaId;
  icone: string;
  label: string;
  valor: number;
  margemPct: number;
  fonte: FonteEstrategia;
};

type Props = {
  estrategias: EstrategiaItem[];
  selecionadaId: EstrategiaId;
  onChange: (id: EstrategiaId) => void;
  /**
   * B.2b-F14: quando true, sinaliza visualmente que o usuário escolheu manualmente
   * (ring + microcopy mobile). Sem isso, o operador não percebe que a escolha
   * "fixa" pra esse veículo e some duvidando do estado.
   */
  userOverride?: boolean;
};

const FONTE_LABEL: Record<FonteEstrategia, string> = {
  historico: "📊 Histórico",
  fipe: "📋 FIPE",
  custo: "💰 Custo",
};

export function StrategySelector({
  estrategias,
  selecionadaId,
  onChange,
  userOverride = false,
}: Props) {
  if (estrategias.length === 0) return null;

  return (
    <div>
      <div
        role="radiogroup"
        aria-label="Escolha a estratégia de preço"
        className="grid grid-cols-1 gap-2 sm:grid-cols-3"
      >
      {estrategias.map((e) => {
        const ativo = e.id === selecionadaId;
        return (
          <button
            key={e.id}
            type="button"
            role="radio"
            aria-checked={ativo}
            onClick={() => onChange(e.id)}
            className={cn(
              "rounded-lg border-2 px-3 py-2.5 text-left transition",
              "focus:outline-none focus:ring-2 focus:ring-[var(--brand-400)]",
              ativo
                ? "border-[var(--brand-700)] bg-white shadow-[var(--shadow-md)]"
                : "border-current/15 bg-white/60 hover:border-current/30 hover:bg-white/90",
              // B.2b-F14: ring extra quando a escolha foi manual (sticky).
              ativo && userOverride && "ring-2 ring-emerald-400",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-700">
                <span aria-hidden="true">{e.icone}</span>
                <span>{e.label}</span>
              </span>
              {ativo && (
                <span
                  aria-hidden="true"
                  className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[var(--brand-700)] text-[10px] font-bold text-white"
                >
                  ✓
                </span>
              )}
            </div>
            <p
              className={cn(
                "mt-1.5 text-xl font-bold tabular-nums",
                ativo ? "text-[var(--brand-900)]" : "text-slate-900",
              )}
            >
              {formatBRL(e.valor)}
            </p>
            <div className="mt-0.5 flex flex-wrap items-center justify-between gap-1 text-[10px]">
              <span
                className={cn(
                  "tabular-nums",
                  e.margemPct < 0 ? "text-red-600" : "text-slate-500",
                )}
              >
                margem {e.margemPct.toFixed(1)}%
              </span>
              <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-600">
                {FONTE_LABEL[e.fonte]}
              </span>
            </div>
          </button>
        );
      })}
      </div>
      {/* B.2b-F14: microcopy só mobile, só quando o usuário escolheu manual. */}
      {userOverride && (
        <p className="mt-1.5 text-[11px] text-emerald-700 sm:hidden">
          ✓ Estratégia escolhida pra esse carro
        </p>
      )}
    </div>
  );
}
