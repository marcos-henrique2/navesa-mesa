"use client";

import { AlertCircle, RefreshCw, Cloud, Loader2 } from "lucide-react";
import { useInventory } from "@/lib/store/inventory";
import { cn } from "@/lib/utils";

/**
 * "Portal" entre o usuário e os dados.
 *  - Enquanto carrega: skeleton elaborado com 3 KPIs + cards animados
 *  - Em caso de erro: mensagem clara + botão "Tentar de novo"
 *  - Quando pronto: renderiza children normalmente
 */
export function DataGate({ children }: { children: React.ReactNode }) {
  const { loadingState, loadError, retry } = useInventory();

  if (loadingState === "loading") return <CarregandoSkeleton />;
  if (loadingState === "error") return <ErroDeCarregamento mensagem={loadError ?? "?"} onRetry={retry} />;
  return <>{children}</>;
}

function CarregandoSkeleton() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      {/* Header */}
      <div className="mb-2 flex items-center gap-3">
        <Cloud className="h-5 w-5 animate-pulse text-[var(--brand-700)] dark:text-[var(--brand-300)]" />
        <h2 className="text-base font-semibold text-[var(--text-strong)]">Carregando dados da nuvem...</h2>
      </div>
      <p className="mb-6 inline-flex items-center gap-2 text-sm text-[var(--text-muted)]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Buscando estoque, vendas e custos no Supabase
      </p>

      {/* KPIs grandes */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <SkeletonCard key={i} delay={i * 80} />
        ))}
      </div>

      {/* Tabela placeholder */}
      <div className="mt-8 rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-5 shadow-[var(--shadow-sm)]">
        <Bar w="40%" />
        <div className="mt-4 space-y-2">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="grid grid-cols-6 gap-3">
              {[0, 1, 2, 3, 4, 5].map((j) => (
                <Bar key={j} w="100%" delay={(i * 6 + j) * 30} />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Cards de baixo */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <SkeletonCard tall delay={400} />
        <SkeletonCard tall delay={500} />
      </div>
    </div>
  );
}

function SkeletonCard({ delay = 0, tall = false }: { delay?: number; tall?: boolean }) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-5 shadow-[var(--shadow-sm)]",
        tall && "min-h-[180px]",
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      <Bar w="40%" />
      <div className="mt-3 h-8 w-3/4">
        <Bar w="100%" h="h-8" delay={delay + 60} />
      </div>
      <div className="mt-2">
        <Bar w="60%" delay={delay + 120} />
      </div>
      {tall && (
        <div className="mt-4 space-y-2">
          <Bar w="100%" delay={delay + 180} />
          <Bar w="90%" delay={delay + 220} />
          <Bar w="80%" delay={delay + 260} />
        </div>
      )}
    </div>
  );
}

/** Barra pulsante pro skeleton. Usa shimmer Tailwind animate-pulse. */
function Bar({ w = "100%", h = "h-3", delay = 0 }: { w?: string; h?: string; delay?: number }) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-gradient-to-r from-[var(--bg-muted)] via-[var(--border-soft)] to-[var(--bg-muted)]", h)}
      style={{ width: w, animationDelay: `${delay}ms` }}
    />
  );
}

function ErroDeCarregamento({ mensagem, onRetry }: { mensagem: string; onRetry: () => void }) {
  const semInternet = /fetch failed|network|ENOTFOUND/i.test(mensagem);
  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <div className="rounded-2xl border-2 border-red-200 bg-red-50 p-8 text-center shadow-[var(--shadow-md)] dark:border-red-900 dark:bg-red-950/30">
        <div className="mx-auto mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
          <AlertCircle className="h-7 w-7" />
        </div>
        <h2 className="text-xl font-bold text-red-900 dark:text-red-200">Não consegui carregar os dados</h2>
        <p className="mt-2 text-sm text-red-800 dark:text-red-300">
          {semInternet
            ? "Parece que não há conexão com a internet. O sistema precisa do Supabase pra funcionar."
            : "Aconteceu algum problema na conexão com o Supabase."}
        </p>
        <details className="mx-auto mt-3 max-w-md text-left">
          <summary className="cursor-pointer text-xs text-red-700 hover:text-red-900 dark:text-red-300 dark:hover:text-red-100">Detalhes técnicos</summary>
          <p className="mt-2 rounded-md bg-[var(--bg-surface)]/70 p-2 font-mono text-[11px] text-[var(--text-body)]">{mensagem}</p>
        </details>
        <button
          onClick={onRetry}
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-red-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-red-700"
        >
          <RefreshCw className="h-4 w-4" /> Tentar de novo
        </button>
        <p className="mt-4 text-[11px] text-[var(--text-muted)]">
          Se o erro persistir, confira sua internet e tente recarregar a página (F5).
        </p>
      </div>
    </div>
  );
}
