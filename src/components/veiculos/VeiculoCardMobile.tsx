"use client";

import { useRouter } from "next/navigation";
import { AlertTriangle, MapPin, Tag, Gift } from "lucide-react";
import { classificarPatio } from "@/lib/inventory/status";
import { CLASSE_COR } from "@/lib/pricing/classificacao";
import { CAUTELAR_ICONE, CAUTELAR_LABEL, type StatusCautelar } from "@/lib/inventory/cautelar";
import type { ClassificacaoVeiculo } from "@/lib/pricing/classificacao";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";
import type { LojaInfo } from "@/lib/store/inventory";
import type { FlagsVeiculo } from "@/lib/data/flags-veiculo";
import { cn, formatBRL, formatInt } from "@/lib/utils";
import { calcularDesvioFipe, isFipeConfirmado, type BatchFipeItem } from "@/lib/fipe/batch";

/**
 * Card vertical do veículo pra uso em viewport mobile (<md).
 * Substitui a tabela densa nessa faixa de tela — tap no card abre detalhe.
 */
export function VeiculoCardMobile({
  veiculo,
  loja,
  classif,
  cautelar,
  flags,
  fipeItem,
  selecionado,
  onToggleSelect,
}: {
  veiculo: VeiculoParsed;
  loja: LojaInfo | undefined;
  classif: ClassificacaoVeiculo | null;
  cautelar: StatusCautelar | null;
  flags: FlagsVeiculo | null;
  fipeItem: BatchFipeItem | null;
  selecionado: boolean;
  onToggleSelect: () => void;
}) {
  const router = useRouter();
  const status = classificarPatio(veiculo.patio);
  const ehPrep = status === "preparacao";

  const margemTeorica =
    veiculo.preco_venda != null && veiculo.custo_total != null && veiculo.preco_venda !== 0
      ? ((veiculo.preco_venda - veiculo.custo_total) / veiculo.preco_venda) * 100
      : null;

  const gastoPos =
    veiculo.custo_total != null && veiculo.valor_aquisicao != null
      ? veiculo.custo_total - veiculo.valor_aquisicao
      : null;

  // Match não confirmado não vira desvio: o card mostraria um % calculado
  // sobre um preço que a UI se recusa a exibir.
  const desvioFipe =
    fipeItem && isFipeConfirmado(fipeItem)
      ? calcularDesvioFipe(veiculo.preco_venda, fipeItem.precoFipe)
      : null;

  const margemTone =
    margemTeorica == null
      ? "text-[var(--text-subtle)]"
      : margemTeorica >= 5
        ? "text-emerald-700 dark:text-emerald-400"
        : margemTeorica >= 0
          ? "text-amber-700 dark:text-amber-400"
          : "text-red-700 dark:text-red-400";

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border bg-[var(--bg-surface)] shadow-sm transition active:scale-[0.99]",
        selecionado ? "border-[var(--brand-500)] ring-1 ring-[var(--brand-500)]" : "border-[var(--border-soft)]",
      )}
    >
      {/* Faixa lateral de status */}
      {ehPrep && <div className="absolute left-0 top-0 h-full w-1 bg-amber-500" />}

      <button
        type="button"
        onClick={() => router.push(`/veiculos/${veiculo.chassi}`)}
        className="w-full px-4 py-3 pl-12 text-left"
      >
        {/* Header: marca + modelo + placa + classe */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              {veiculo.marca}
            </p>
            <h3 className="mt-0.5 truncate text-sm font-semibold text-[var(--text-strong)]" title={veiculo.modelo}>
              {veiculo.modelo}
            </h3>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="font-mono text-xs font-semibold text-[var(--text-body)]">{veiculo.placa}</span>
            {classif && (
              <span
                className={cn("inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold", CLASSE_COR[classif.classe].bg, CLASSE_COR[classif.classe].text)}
                title={`Classe ${classif.classe}`}
              >
                {classif.classe}
              </span>
            )}
          </div>
        </div>

        {/* Specs em linha */}
        <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">
          {veiculo.ano_modelo ?? "—"} · {veiculo.km != null ? `${formatInt(veiculo.km)} km` : "— km"}
          {veiculo.cor_externa && ` · ${veiculo.cor_externa}`}
          {veiculo.combustivel && ` · ${veiculo.combustivel}`}
        </p>

        {/* Loja + status badges */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-[11px] text-[var(--text-body)]">
            <MapPin className="h-3 w-3 text-[var(--text-subtle)]" />
            {loja?.nome?.trim() ?? `Loja ${veiculo.cod_empresa}`}
          </span>
          {ehPrep && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              <AlertTriangle className="h-2.5 w-2.5" /> Preparação
            </span>
          )}
          {cautelar && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-muted)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-body)]" title={CAUTELAR_LABEL[cautelar]}>
              {CAUTELAR_ICONE[cautelar]} {CAUTELAR_LABEL[cautelar]}
            </span>
          )}
          {flags?.em_promocao && (
            <span className="inline-flex items-center gap-1 rounded-full bg-pink-100 px-1.5 py-0.5 text-[10px] font-medium text-pink-800 dark:bg-pink-950/40 dark:text-pink-300" title="Veículo em promoção">
              <Tag className="h-2.5 w-2.5" /> Promoção
            </span>
          )}
          {flags?.brinde_acessorios && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-800 dark:bg-purple-950/40 dark:text-purple-300"
              title={flags.observacao_brinde ? `Brinde: ${flags.observacao_brinde}` : "Brinde de acessórios incluso"}
            >
              <Gift className="h-2.5 w-2.5" /> Brinde
            </span>
          )}
        </div>

        {/* Financeiro grid 2x2 */}
        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-[var(--border-soft)] pt-3 text-xs">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Preço</p>
            <p className="mt-0.5 font-semibold tabular-nums text-[var(--text-strong)]">{formatBRL(veiculo.preco_venda)}</p>
            {desvioFipe && (
              <p className={cn(
                "text-[10px] tabular-nums",
                desvioFipe.pct > 5 ? "text-red-700 dark:text-red-400"
                  : desvioFipe.pct > 0 ? "text-amber-700 dark:text-amber-400"
                    : "text-emerald-700 dark:text-emerald-400",
              )}>
                FIPE {desvioFipe.pct >= 0 ? "+" : ""}{desvioFipe.pct.toFixed(1)}%
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Margem</p>
            <p className={cn("mt-0.5 font-semibold tabular-nums", margemTone)}>
              {margemTeorica != null
                ? `${margemTeorica >= 0 ? "+" : ""}${margemTeorica.toFixed(1)}%`
                : "—"}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Custo</p>
            <p className="mt-0.5 tabular-nums text-[var(--text-body)]">{formatBRL(veiculo.custo_total)}</p>
            {gastoPos != null && gastoPos !== 0 && (
              <p className={cn(
                "text-[10px] tabular-nums",
                gastoPos < 0 ? "text-red-700 dark:text-red-400" : "text-[var(--text-muted)]",
              )}>
                {gastoPos < 0 ? "" : "+"}{formatBRL(gastoPos)} pós
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Pátio</p>
            <p className="mt-0.5 tabular-nums text-[var(--text-body)]">
              {veiculo.dias_patio != null ? `${veiculo.dias_patio} dias` : "—"}
            </p>
          </div>
        </div>
      </button>

      {/* Checkbox flutuante (canto sup. esq.) — tap independente do botão */}
      {/* Checkbox de seleção — canto sup. esq., longe do header (placa/classe).
          Tap independente do botão principal via stopPropagation. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleSelect();
        }}
        className="absolute left-2 top-3 flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-subtle)] hover:bg-[var(--bg-muted)]"
        aria-label={selecionado ? "Remover seleção" : "Selecionar veículo"}
      >
        <span
          className={cn(
            "flex h-4 w-4 items-center justify-center rounded border",
            selecionado
              ? "border-[var(--brand-600)] bg-[var(--brand-600)] text-white"
              : "border-[var(--border-base)]",
          )}
        >
          {selecionado && <span className="text-[10px] leading-none">✓</span>}
        </span>
      </button>
    </div>
  );
}
