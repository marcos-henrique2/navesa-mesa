"use client";

/**
 * BANNER DE PRIORIDADE FORD — Fase C
 *
 * Destaca no topo de /veiculos os carros subprecificados das 2 lojas Ford
 * que concentram a maior perda histórica (CIAASA FORD + NAVESA FORD AEROPORTO,
 * ~70% da perda detectada pelo Alex).
 *
 * Lógica:
 *   - Roda diagnóstico em lote nos veículos das lojas-alvo
 *   - Conta carros com status subprecificado / subprecificado_grave / negativo
 *   - Soma R$ "na mesa" = Σ (precoEsperado - precoAtual) dos subprec
 *   - Some quando totalCarros === 0 OU usuário dispensa por sessão
 *
 * Não exibe nada se as lojas Ford não estiverem presentes no inventário.
 */

import { useMemo, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useInventory } from "@/lib/store/inventory";
import { useFipeBatch } from "@/lib/fipe/useFipeBatch";
import { useCautelares } from "@/lib/inventory/cautelar";
import {
  classificarVeiculo,
  contarPorModelo,
  type Classe,
} from "@/lib/pricing/classificacao";
import {
  computarDiagnosticoLista,
  type DiagnosticoStatus,
} from "@/lib/pricing/diagnostico";
import { calcularMedianasKm } from "@/lib/pricing/medianas";
import { cn, formatBRL, formatInt } from "@/lib/utils";

/** Cod_empresa das lojas Ford prioritárias (concentram ~70% da perda). */
export const LOJAS_FORD_PRIORITARIAS = [2, 31] as const;

/** Status considerados "atenção necessária" pro banner. */
const STATUS_ATENCAO: ReadonlySet<DiagnosticoStatus> = new Set([
  "subprecificado",
  "subprecificado_grave",
  "negativo",
]);

const SESSION_KEY = "navesa-mesa:banner-ford-dispensado";

type DadosLoja = {
  cod: number;
  nome: string;
  qtCarros: number;
  qtGraves: number;
  rsNaMesa: number;
};

export type PrioridadeFordResumo = {
  totalCarros: number;
  totalRSNaMesa: number;
  lojas: DadosLoja[];
};

// ═══════════════════════════════════════════════════════════════════════════
// HOOK
// ═══════════════════════════════════════════════════════════════════════════

export function usePrioridadeFord(): PrioridadeFordResumo {
  const { veiculos, vendas, lojas } = useInventory();
  const fipeBatch = useFipeBatch();
  const cautelares = useCautelares();

  const medianas = useMemo(
    () => calcularMedianasKm(veiculos, vendas),
    [veiculos, vendas],
  );

  return useMemo<PrioridadeFordResumo>(() => {
    // Filtra só veículos das lojas Ford prioritárias (early-out se nenhuma)
    const lojasAlvo = new Set<number>(LOJAS_FORD_PRIORITARIAS);
    const veiculosFord = veiculos.filter((v) => lojasAlvo.has(v.cod_empresa));
    if (veiculosFord.length === 0) {
      return { totalCarros: 0, totalRSNaMesa: 0, lojas: [] };
    }

    // Classificação por chassi (precisa do contexto global pra contar modelos)
    const contagemModelos = contarPorModelo(veiculos);
    const classesPorChassi = new Map<string, Classe>();
    for (const v of veiculosFord) {
      const { classe } = classificarVeiculo(v, {
        contagemPorModelo: contagemModelos,
        cautelar: cautelares[v.chassi] ?? null,
      });
      classesPorChassi.set(v.chassi, classe);
    }

    // FIPE batch: chassi → precoFipe
    const fipeMap: Record<string, number> = {};
    if (fipeBatch?.items) {
      for (const [chassi, item] of Object.entries(fipeBatch.items)) {
        if (item.precoFipe != null) fipeMap[chassi] = item.precoFipe;
      }
    }

    const diagnosticos = computarDiagnosticoLista({
      veiculos: veiculosFord,
      classesPorChassi,
      fipeBatch: fipeMap,
      cautelaresPorChassi: cautelares,
      medianasKmPorChave: medianas,
    });

    // Agrega por loja
    const porLoja = new Map<number, DadosLoja>();
    for (const cod of LOJAS_FORD_PRIORITARIAS) {
      porLoja.set(cod, {
        cod,
        nome: lojas[cod]?.nome?.trim() || `Loja ${cod}`,
        qtCarros: 0,
        qtGraves: 0,
        rsNaMesa: 0,
      });
    }

    let totalCarros = 0;
    let totalRSNaMesa = 0;

    for (const v of veiculosFord) {
      const diag = diagnosticos.get(v.chassi);
      if (!diag || !STATUS_ATENCAO.has(diag.status)) continue;

      const agg = porLoja.get(v.cod_empresa);
      if (!agg) continue;

      agg.qtCarros++;
      totalCarros++;

      if (diag.status === "subprecificado_grave" || diag.status === "negativo") {
        agg.qtGraves++;
      }

      // "Na mesa" = quanto o preço atual está abaixo do esperado (em R$).
      // desvioReais é negativo quando subprec → usamos abs.
      const naMesa = Math.max(0, -diag.desvioReais);
      agg.rsNaMesa += naMesa;
      totalRSNaMesa += naMesa;
    }

    // Só lojas com algo a mostrar, ordenadas por R$ na mesa
    const lojasOrdenadas = [...porLoja.values()]
      .filter((l) => l.qtCarros > 0)
      .sort((a, b) => b.rsNaMesa - a.rsNaMesa);

    return {
      totalCarros,
      totalRSNaMesa,
      lojas: lojasOrdenadas,
    };
  }, [veiculos, lojas, fipeBatch, cautelares, medianas]);
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENTE
// ═══════════════════════════════════════════════════════════════════════════

export type PrioridadeFordBannerProps = {
  /** Callback quando user clica em "Ver lista filtrada". Recebe os cods das lojas. */
  onAtivarFiltro?: (codsLoja: number[]) => void;
};

export function PrioridadeFordBanner({ onAtivarFiltro }: PrioridadeFordBannerProps) {
  const { isHydrated } = useInventory();
  const resumo = usePrioridadeFord();

  // Dispensa por sessão. Lazy initializer evita useEffect + setState (que dispararia
  // re-render extra). Em SSR (window indefinido) começa como false e o cliente
  // re-renderiza com o valor real do sessionStorage no primeiro mount.
  const [dispensado, setDispensado] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return sessionStorage.getItem(SESSION_KEY) === "1";
    } catch {
      return false;
    }
  });

  if (!isHydrated) return null;
  if (dispensado) return null;
  if (resumo.totalCarros === 0) return null;

  const handleDispensar = () => {
    try {
      sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      /* ignore */
    }
    setDispensado(true);
  };

  const handleVerFiltrado = () => {
    onAtivarFiltro?.(resumo.lojas.map((l) => l.cod));
  };

  return (
    <section
      role="region"
      aria-label="Banner de prioridade Ford"
      className="overflow-hidden rounded-xl border-2 border-red-200 bg-gradient-to-br from-red-50 to-white shadow-sm dark:border-red-900/50 dark:from-red-950/20 dark:to-zinc-900"
    >
      <div className="flex items-start justify-between gap-3 border-b border-red-200/60 px-4 py-3 dark:border-red-900/40">
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
          <div>
            <h2 className="text-sm font-semibold text-red-900 dark:text-red-200">
              Prioridade Ford · {formatInt(resumo.totalCarros)} carro{resumo.totalCarros === 1 ? "" : "s"} subprecificado{resumo.totalCarros === 1 ? "" : "s"}
            </h2>
            <p className="mt-0.5 text-xs text-red-800/80 dark:text-red-300/80">
              <strong className="tabular-nums">{formatBRL(resumo.totalRSNaMesa)}</strong> deixados na mesa nas lojas que concentram a maior perda
            </p>
          </div>
        </div>
        <button
          onClick={handleDispensar}
          className="rounded-md p-1 text-red-700 hover:bg-red-100 dark:text-red-300 dark:hover:bg-red-900/30"
          aria-label="Esconder banner por essa sessão"
          title="Esconder banner por essa sessão"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid gap-3 px-4 py-3 sm:grid-cols-2">
        {resumo.lojas.map((loja) => (
          <CardLoja key={loja.cod} loja={loja} />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-red-200/60 bg-red-50/40 px-4 py-2.5 dark:border-red-900/40 dark:bg-red-950/20">
        <button
          onClick={handleVerFiltrado}
          className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1"
        >
          Ver lista filtrada
        </button>
        <button
          onClick={handleDispensar}
          className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-50 dark:border-red-900/60 dark:bg-zinc-900 dark:text-red-200 dark:hover:bg-red-950/30"
        >
          Esconder banner
        </button>
      </div>
    </section>
  );
}

function CardLoja({ loja }: { loja: DadosLoja }) {
  return (
    <div className={cn(
      "flex items-start justify-between gap-3 rounded-lg border border-red-200/70 bg-white p-3 dark:border-red-900/40 dark:bg-zinc-900",
    )}>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100" title={loja.nome}>
          {loja.nome}
        </p>
        <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
          {formatInt(loja.qtCarros)} carro{loja.qtCarros === 1 ? "" : "s"}
          {loja.qtGraves > 0 && (
            <>
              {" · "}
              <span className="font-medium text-red-700 dark:text-red-300">
                {formatInt(loja.qtGraves)} GRAVE{loja.qtGraves === 1 ? "" : "S"}
              </span>
            </>
          )}
        </p>
      </div>
      <p className="shrink-0 text-sm font-bold tabular-nums text-red-700 dark:text-red-300">
        {formatBRL(loja.rsNaMesa)}
      </p>
    </div>
  );
}
