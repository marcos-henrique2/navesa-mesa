"use client";

/**
 * Seções da zona "Ver detalhes" do PrecificacaoBlock:
 *   - BreakdownAjustes: fórmula auditável do preço esperado
 *   - FipeSecao: modelo NBS + preço FIPE + botão "Revisar match FIPE"
 *   - ComparaveisSecao: mediana + tempo médio + tabela inline de N vendas
 *
 * Extraídos do PrecificacaoBlock pra manter o componente principal abaixo do
 * limite de 600 linhas.
 */

import { useState } from "react";
import { Sparkles } from "lucide-react";
import type { DiagnosticoResult } from "@/lib/pricing/diagnostico";
import type { PrecoSuggestion } from "@/lib/pricing/suggest";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";
import { formatBRL, formatInt } from "@/lib/utils";
import { formatReferenciaCurta } from "@/lib/fipe/service";

// ─── Breakdown do cálculo ───────────────────────────────────────────────────

export function BreakdownAjustes({
  diagnostico,
  medianaKm,
  veiculo,
  sugestao,
  fipeReferencia,
}: {
  diagnostico: DiagnosticoResult;
  medianaKm: number | null;
  veiculo: VeiculoParsed;
  sugestao: PrecoSuggestion;
  /** Tabela FIPE de origem do preço (`"julho/2026"`), ou `null` no legado. */
  fipeReferencia: string | null;
}) {
  const baseProxy = veiculo.valor_aquisicao != null ? veiculo.valor_aquisicao * 1.18 : null;
  // `diagnostico.precoFipe` já vem filtrado por confiança (usePrecificacao):
  // match não confirmado chega como null e cai no proxy de custo.
  //
  // A referência entra aqui porque esta lista é a fórmula AUDITÁVEL do preço
  // esperado: sem o mês, a primeira linha não é reproduzível.
  const refCurtaBreakdown = formatReferenciaCurta(fipeReferencia);
  const baseRefLabel = diagnostico.precoFipe != null
    ? `FIPE${refCurtaBreakdown ? ` ${refCurtaBreakdown}` : ""}: ${formatBRL(diagnostico.precoFipe)}`
    : `FIPE não confirmada — usando custo × 1,18 (proxy): ${formatBRL(baseProxy)}`;
  const baseClasseLabel = `Base classe (${formatPct(diagnostico.baseClassePct)})`;

  return (
    <ul className="space-y-0.5 text-xs">
      <li>• {baseRefLabel}</li>
      <li>• {baseClasseLabel}</li>
      {diagnostico.ajustes.map((a) => (
        <li key={a.codigo}>• {a.label}</li>
      ))}
      {medianaKm != null && veiculo.km != null && !diagnostico.ajustes.some((a) => a.codigo === "km_vs_mediana") && (
        <li className="opacity-70">
          • KM {formatInt(veiculo.km)} (mediana modelo/ano: {formatInt(medianaKm)}) — sem ajuste
        </li>
      )}
      {diagnostico.ajusteTotalPct !== sumAjustes(diagnostico.ajustes) && (
        <li className="opacity-70">
          • <em>Cap aplicado: ajustes limitados a {formatPct(diagnostico.ajusteTotalPct)}</em>
        </li>
      )}
      <li className="border-t border-current/20 pt-1 font-medium">
        Esperado = base × (1 {formatPct(diagnostico.baseClassePct)}{" "}
        {formatPctSinal(diagnostico.ajusteTotalPct)}) ={" "}
        {formatBRL(diagnostico.precoEsperado)}
      </li>
      {sugestao.medianaHistorica != null && (
        <li className="mt-1 pt-1 opacity-70">
          • Mediana de {sugestao.comparaveis.length} venda{sugestao.comparaveis.length === 1 ? "" : "s"}:{" "}
          {formatBRL(sugestao.medianaHistorica)}
        </li>
      )}
    </ul>
  );
}

// ─── FIPE & matching ────────────────────────────────────────────────────────

export function FipeSecao({
  fipeBatchPreco,
  fipeReferencia,
  modeloNbs,
  onAbrirDrawer,
}: {
  fipeBatchPreco: number | null;
  /** Tabela FIPE de origem do preço (`"julho/2026"`), ou `null` no legado. */
  fipeReferencia: string | null;
  modeloNbs: string;
  onAbrirDrawer: () => void;
}) {
  const refCurta = formatReferenciaCurta(fipeReferencia);
  return (
    <section>
      <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider opacity-70">
        FIPE &amp; matching
      </h4>
      <div className="rounded-lg bg-[var(--bg-surface)]/70 p-3 text-xs">
        <p className="text-[10px] uppercase tracking-wider opacity-60">Modelo NBS</p>
        <p className="font-mono text-[var(--text-body)]">{modeloNbs}</p>
        <div className="mt-2 flex items-center justify-between gap-3">
          <div>
            {/* "atual" saiu do rótulo: o preço é de uma tabela mensal específica,
                e chamá-lo de atual foi parte do que escondeu a defasagem. */}
            <p className="text-[10px] uppercase tracking-wider opacity-60">Preço FIPE</p>
            <p className="font-bold tabular-nums">
              {fipeBatchPreco != null ? formatBRL(fipeBatchPreco) : "—"}
              {fipeBatchPreco != null && refCurta && (
                <span className="ml-1.5 font-normal text-[10px] uppercase tracking-wider opacity-60">
                  {refCurta}
                </span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onAbrirDrawer}
            className="inline-flex items-center gap-1.5 rounded-md border border-current/30 bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--bg-muted)]"
            aria-label="Abrir revisão de match FIPE"
          >
            <Sparkles className="h-3 w-3" aria-hidden="true" /> Revisar match FIPE
          </button>
        </div>
      </div>
    </section>
  );
}

// ─── Comparáveis ────────────────────────────────────────────────────────────

export function ComparaveisSecao({ sugestao }: { sugestao: PrecoSuggestion }) {
  const [tabelaAberta, setTabelaAberta] = useState(false);
  const totalDias = sugestao.comparaveis
    .map((c) => c.diasAteVenda)
    .filter((d): d is number => d != null);
  const tempoMedio = totalDias.length > 0
    ? Math.round(totalDias.reduce((a, b) => a + b, 0) / totalDias.length)
    : null;

  return (
    <section>
      <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider opacity-70">
        {sugestao.comparaveis.length} venda{sugestao.comparaveis.length === 1 ? "" : "s"} comparável{sugestao.comparaveis.length === 1 ? "" : "is"}
      </h4>
      <div className="rounded-lg bg-[var(--bg-surface)]/70 p-3 text-xs">
        <p>
          {sugestao.medianaHistorica != null && (
            <>Mediana <span className="font-semibold tabular-nums">{formatBRL(sugestao.medianaHistorica)}</span></>
          )}
          {tempoMedio != null && (
            <> · Tempo médio: <span className="font-semibold tabular-nums">{tempoMedio} dias</span></>
          )}
        </p>
        <button
          type="button"
          onClick={() => setTabelaAberta((v) => !v)}
          className="mt-1.5 text-[var(--brand-700)] underline hover:text-[var(--brand-900)] dark:text-[var(--brand-300)] dark:hover:text-[var(--brand-100)]"
        >
          {tabelaAberta ? "Ocultar tabela" : "Ver tabela"}
        </button>
        {tabelaAberta && (
          <div className="mt-2 overflow-x-auto rounded-md border border-current/10 bg-[var(--bg-surface)]">
            <table className="w-full text-[11px]">
              <thead className="bg-[var(--bg-muted)] text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                <tr>
                  <th className="px-2 py-1.5">Placa</th>
                  <th className="px-2 py-1.5 text-right">Vendido</th>
                  <th className="px-2 py-1.5 text-right">KM</th>
                  <th className="px-2 py-1.5 text-right">Dias</th>
                  <th className="px-2 py-1.5 text-right">Data</th>
                </tr>
              </thead>
              <tbody>
                {sugestao.comparaveis.slice(0, 10).map((c) => (
                  <tr key={c.placa} className="border-t border-current/10">
                    <td className="px-2 py-1 font-mono">{c.placa}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{formatBRL(c.precoVenda)}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-[var(--text-muted)]">
                      {c.km != null ? formatInt(c.km) : "—"}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums text-[var(--text-muted)]">
                      {c.diasAteVenda != null ? `${c.diasAteVenda}d` : "—"}
                    </td>
                    <td className="px-2 py-1 text-right text-[var(--text-muted)]">
                      {c.dataVenda ? new Date(c.dataVenda).toLocaleDateString("pt-BR") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

// ─── Helpers locais ─────────────────────────────────────────────────────────

function formatPct(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(1)}%`;
}

function formatPctSinal(n: number): string {
  if (n === 0) return "+ 0,0%";
  return n >= 0 ? `+ ${(n * 100).toFixed(1)}%` : `- ${(Math.abs(n) * 100).toFixed(1)}%`;
}

function sumAjustes(arr: { pct: number }[]): number {
  return Number(arr.reduce((acc, a) => acc + a.pct, 0).toFixed(4));
}
