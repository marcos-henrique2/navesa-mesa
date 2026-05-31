"use client";

/**
 * Subcomponentes visuais do PrecificacaoBlock:
 *   - Numero: card label + valor (preço hoje / preço esperado)
 *   - DiferencaCard: card da diferença % + R$ com tom de cor
 *   - MarcarButton: CTA "Marcar pra reprecificar" + estado pendente + Desfazer
 *   - PrecoAlvoIndicador: pílula "✓ Preço-alvo R$ X (em DD/MM)" + botão Revogar
 *
 * Extraídos pra manter o componente principal abaixo do limite de 600 linhas.
 */

import type { DiagnosticoResult } from "@/lib/pricing/diagnostico";
import type { ReprecificacaoRow } from "@/lib/data/reprecificacao";
import type { PrecoAlvoRow } from "@/lib/data/preco-alvo";
import { formatBRL, cn } from "@/lib/utils";

export function Numero({
  label,
  valor,
  destaque,
}: {
  label: string;
  valor: string;
  destaque: boolean;
}) {
  return (
    <div className="rounded-lg bg-white/70 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider opacity-70">{label}</p>
      <p className={cn("tabular-nums", destaque ? "text-xl font-bold" : "text-base font-semibold")}>
        {valor}
      </p>
    </div>
  );
}

export function DiferencaCard({ diagnostico }: { diagnostico: DiagnosticoResult }) {
  if (diagnostico.precoAtual == null || diagnostico.precoEsperado <= 0) {
    return <Numero label="Diferença" valor="—" destaque={false} />;
  }
  const pct = diagnostico.desvioPct * 100;
  const reais = diagnostico.desvioReais;
  const negativo = reais < 0;
  const positivo = reais > 0;
  const toneClasse = negativo
    ? "text-red-700"
    : positivo
      ? "text-emerald-700"
      : "text-slate-600";
  const icone = negativo ? "⚠" : positivo ? "↑" : "=";
  return (
    <div className="rounded-lg bg-white/70 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider opacity-70">Diferença</p>
      <p className={cn("text-xl font-bold tabular-nums", toneClasse)}>
        {pct >= 0 ? "+" : ""}
        {pct.toFixed(1)}% <span className="text-base" aria-hidden="true">{icone}</span>
      </p>
      <p className={cn("text-[11px] tabular-nums", toneClasse)}>
        {reais >= 0 ? "+" : ""}
        {formatBRL(reais)}
      </p>
    </div>
  );
}

export function MarcarButton({
  pendente,
  carregando,
  salvando,
  desabilitado,
  onMarcar,
  onDesmarcar,
  veiculoLabel,
}: {
  pendente: ReprecificacaoRow | null;
  carregando: boolean;
  salvando: boolean;
  desabilitado: boolean;
  onMarcar: () => void;
  onDesmarcar: () => void;
  veiculoLabel: string;
}) {
  if (carregando) {
    return <span className="text-xs text-current/60">Carregando status…</span>;
  }
  if (pendente) {
    const quando = new Date(pendente.criado_em).toLocaleDateString("pt-BR");
    return (
      <div className="inline-flex items-center gap-2 text-xs">
        <span className="rounded-full bg-white/80 px-3 py-1 font-medium">
          ✓ Marcado em {quando}
        </span>
        <button
          type="button"
          onClick={onDesmarcar}
          disabled={salvando}
          className="text-current underline hover:opacity-80 disabled:opacity-50"
          aria-label={`Desfazer marcação de reprecificação${veiculoLabel ? ` de ${veiculoLabel}` : ""}`}
        >
          Desfazer
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onMarcar}
      disabled={salvando || desabilitado}
      className={cn(
        "inline-flex items-center gap-2 rounded-lg border border-current/30 bg-white/70 px-3 py-2 text-xs font-medium",
        "hover:bg-white disabled:cursor-not-allowed disabled:opacity-50",
      )}
      aria-label={`Marcar ${veiculoLabel || "veículo"} pra reprecificar`}
      title={desabilitado ? "Sem preço esperado — não dá pra marcar reprecificação" : undefined}
    >
      {salvando ? "Salvando…" : "Marcar pra reprecificar"}
    </button>
  );
}

export function PrecoAlvoIndicador({
  row,
  onRevogar,
  salvando,
}: {
  row: PrecoAlvoRow;
  onRevogar: () => void;
  salvando: boolean;
}) {
  const quando = new Date(row.criado_em).toLocaleDateString("pt-BR");
  return (
    <div className="inline-flex flex-wrap items-center gap-2 rounded-lg bg-white/70 px-3 py-2 text-xs">
      <span className="font-medium">
        ✓ Preço-alvo: <span className="tabular-nums">{formatBRL(row.preco_alvo)}</span>{" "}
        <span className="opacity-70">(definido em {quando})</span>
      </span>
      <button
        type="button"
        onClick={onRevogar}
        disabled={salvando}
        className="text-current underline hover:opacity-80 disabled:opacity-50"
        aria-label={`Revogar preço-alvo de ${formatBRL(row.preco_alvo)}`}
      >
        Revogar
      </button>
    </div>
  );
}
