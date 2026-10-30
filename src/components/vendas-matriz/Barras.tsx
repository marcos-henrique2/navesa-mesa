import type { ReactNode } from "react";
import { Tooltip } from "@/components/ui/Tooltip";
import type { OrigemChave } from "@/lib/export/vendas-matriz/resumir-painel";
import { cn } from "@/lib/utils";

/** Cores fixas de origem (bloco 2 e split interno de PF/PJ). */
export const COR_ORIGEM: Record<OrigemChave, { barra: string; ponto: string }> = {
  proprio: { barra: "bg-emerald-600 dark:bg-emerald-500", ponto: "bg-emerald-600 dark:bg-emerald-500" },
  outras: { barra: "bg-amber-500", ponto: "bg-amber-500" },
  naoIdentificada: { barra: "bg-slate-400", ponto: "border-2 border-slate-400 bg-transparent" },
};

export const ROTULO_ORIGEM: Record<OrigemChave, string> = {
  proprio: "Estoque próprio (Aeroporto)",
  outras: "Outras lojas do grupo",
  naoIdentificada: "Origem não identificada",
};

export const ROTULO_ORIGEM_CURTO: Record<OrigemChave, string> = {
  proprio: "Próprio",
  outras: "Outras",
  naoIdentificada: "Não identificada",
};

export function PontoOrigem({ origem }: { origem: OrigemChave }) {
  return <span className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", COR_ORIGEM[origem].ponto)} aria-hidden="true" />;
}

/**
 * Uma linha de barra horizontal em CSS puro (padrão de ComposicaoCustosEstoque). O número
 * principal fica sempre visível; hover/foco/tap mostram `detalhe` (qtd · R$ · %).
 */
export function BarraCategorica({
  rotulo,
  extraRotulo,
  origem,
  larguraPct,
  valor,
  participacao,
  negativo = false,
  ariaLabel,
  detalhe,
  acao,
}: {
  rotulo: string;
  extraRotulo?: ReactNode;
  /** Link de cross-filter no fim da linha (opcional). */
  acao?: ReactNode;
  origem: OrigemChave;
  /** 0–100 */
  larguraPct: number;
  valor: string;
  participacao?: string;
  negativo?: boolean;
  ariaLabel: string;
  detalhe: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="inline-flex min-w-0 items-center gap-2 text-[var(--text-body)]">
          <PontoOrigem origem={origem} />
          <span className="truncate">{rotulo}</span>
          {extraRotulo}
        </span>
        <span className={cn("shrink-0 tabular-nums font-semibold", negativo ? "text-red-700 dark:text-red-400" : "text-[var(--text-strong)]")}>
          {valor}
          {participacao != null && <span className="ml-2 inline-block min-w-[3.5rem] text-right text-xs font-normal text-[var(--text-muted)]">{participacao}</span>}
          {acao && <span className="ml-2 inline-block">{acao}</span>}
        </span>
      </div>
      {/* Número já visível em texto acima: barra não é ponto de Tab; detalhe vai no aria-label. */}
      <Tooltip content={detalhe} focavel={false} className="flex w-full cursor-default">
        <div className="h-2 w-full overflow-hidden rounded bg-[var(--bg-muted)]" role="img" aria-label={`${ariaLabel}. ${detalhe}`}>
          <div
            className={cn("h-full rounded", negativo ? "bg-red-600 dark:bg-red-500" : COR_ORIGEM[origem].barra)}
            style={{ width: `${Math.max(0, Math.min(100, larguraPct))}%` }}
          />
        </div>
      </Tooltip>
    </div>
  );
}

/** Barra 100% empilhada (split de origem dentro de PF/PJ). Segmentos com valor 0 somem. */
export function BarraEmpilhada100({
  segmentos,
  ariaLabel,
}: {
  segmentos: { origem: OrigemChave; valor: number }[];
  ariaLabel: string;
}) {
  const total = segmentos.reduce((s, x) => s + x.valor, 0);
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--bg-muted)]" role="img" aria-label={ariaLabel}>
      {total > 0 &&
        segmentos
          .filter((s) => s.valor > 0)
          .map((s) => <div key={s.origem} className={cn("h-full", COR_ORIGEM[s.origem].barra)} style={{ width: `${(s.valor / total) * 100}%` }} />)}
    </div>
  );
}
