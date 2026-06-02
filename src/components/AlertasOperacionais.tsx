"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronRight, ChevronDown, ChevronUp } from "lucide-react";
import { useInventory } from "@/lib/store/inventory";
import { useFipeBatch } from "@/lib/fipe/useFipeBatch";
import { useCautelares } from "@/lib/inventory/cautelar";
import { gerarAlertas, type Alerta, type SeveridadeAlerta } from "@/lib/analytics/insights";
import { aplicarFiltrosDrillDown } from "@/lib/navigation/drill-down";
import { cn } from "@/lib/utils";

const COLLAPSE_LIMIT = 3;

export function AlertasOperacionais() {
  const { vendas, custosPorPlaca, veiculos, isHydrated } = useInventory();
  const fipeBatch = useFipeBatch();
  const cautelares = useCautelares();
  const [expandido, setExpandido] = useState(false);

  const alertas = useMemo(() => {
    if (!isHydrated) return [];
    return gerarAlertas(vendas, custosPorPlaca, veiculos, fipeBatch, cautelares);
  }, [vendas, custosPorPlaca, veiculos, fipeBatch, cautelares, isHydrated]);

  if (!isHydrated || alertas.length === 0) return null;

  const criticos = alertas.filter((a) => a.severidade === "critico");
  const restante = alertas.filter((a) => a.severidade !== "critico");

  // Sempre mostra os críticos. Os outros entram em "ver mais" se passar do limite.
  const visiveis = expandido
    ? alertas
    : [...criticos, ...restante.slice(0, Math.max(0, COLLAPSE_LIMIT - criticos.length))];
  const ocultos = alertas.length - visiveis.length;

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          Alertas operacionais
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
            {alertas.length}
          </span>
        </h2>
        {criticos.length > 0 && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">
            {criticos.length} crítico{criticos.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        {visiveis.map((a) => (
          <AlertaCard key={a.id} alerta={a} />
        ))}
      </div>

      {ocultos > 0 && (
        <button
          onClick={() => setExpandido(true)}
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[var(--brand-700)] hover:text-[var(--brand-900)]"
        >
          <ChevronDown className="h-3 w-3" /> Ver mais {ocultos} alerta{ocultos === 1 ? "" : "s"}
        </button>
      )}
      {expandido && alertas.length > COLLAPSE_LIMIT && (
        <button
          onClick={() => setExpandido(false)}
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700"
        >
          <ChevronUp className="h-3 w-3" /> Recolher
        </button>
      )}
    </section>
  );
}

const TONE_BY_SEV: Record<SeveridadeAlerta, { bg: string; border: string; text: string; chip: string }> = {
  critico: {
    bg: "bg-red-50",
    border: "border-red-300",
    text: "text-red-900",
    chip: "bg-red-200 text-red-800",
  },
  atencao: {
    bg: "bg-amber-50",
    border: "border-amber-300",
    text: "text-amber-900",
    chip: "bg-amber-200 text-amber-800",
  },
  info: {
    bg: "bg-slate-50",
    border: "border-slate-200",
    text: "text-slate-800",
    chip: "bg-slate-200 text-slate-700",
  },
};

function AlertaCard({ alerta }: { alerta: Alerta }) {
  const router = useRouter();
  const tone = TONE_BY_SEV[alerta.severidade];
  const clicavel = !!alerta.acao;

  const conteudo = (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 text-lg leading-none">{alerta.icone}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className={cn("text-sm font-semibold leading-snug text-left", tone.text)}>{alerta.titulo}</h3>
          <span className={cn(
            "shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider",
            tone.chip,
          )}>
            {alerta.severidade}
          </span>
        </div>
        <p className="mt-1 text-left text-xs text-slate-600">{alerta.detalhe}</p>
        {alerta.acao && (
          <p className="mt-1.5 inline-flex items-center gap-0.5 text-[11px] font-medium text-[var(--brand-700)] opacity-60 transition group-hover:opacity-100 group-focus-visible:opacity-100">
            {alerta.acao.label ?? "Ver detalhes"} <ChevronRight className="h-3 w-3" />
          </p>
        )}
      </div>
    </div>
  );

  const baseClass = cn(
    "group block w-full rounded-xl border p-3 text-left shadow-[var(--shadow-sm)] transition",
    tone.bg,
    tone.border,
  );

  if (!clicavel || !alerta.acao) {
    return <div className={baseClass}>{conteudo}</div>;
  }

  const acao = alerta.acao;
  return (
    <button
      type="button"
      onClick={() => {
        const rota = aplicarFiltrosDrillDown(acao.rota, acao.filtros);
        router.push(rota);
      }}
      aria-label={`${acao.label ?? "Ver detalhes"} — ${alerta.titulo}`}
      className={cn(
        baseClass,
        "cursor-pointer hover:shadow-[var(--shadow-md)] hover:-translate-y-px",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-700)] focus-visible:ring-offset-2",
      )}
    >
      {conteudo}
    </button>
  );
}
