"use client";

/**
 * SimuladorPreco — campo editável de preço de venda com recálculo em tempo real.
 *
 * O gerente digita um valor hipotético; o componente mostra na hora:
 *   • lucro bruto (R$) — preço − custo total
 *   • margem (%)       — lucro / preço
 *   • diferença vs preço de tabela NBS atual
 *   • diferença vs preço FIPE (se disponível no batch)
 *
 * Semáforo:
 *   verde   → margem ≥ 5% (lucro saudável)
 *   amarelo → margem 0–5% (margem fina)
 *   vermelho → margem < 0 (prejuízo)
 *
 * Ações:
 *   • Copiar R$ X pro clipboard (colar de volta no NBS)
 *   • Resetar pro preço atual do NBS
 *
 * Não persiste nada — é puramente what-if. Pra fixar como preço-alvo,
 * o usuário continua usando o PrecificacaoBlock.
 */

import { useMemo, useState } from "react";
import { Calculator, ClipboardCopy, RotateCcw, AlertTriangle, TrendingUp, TrendingDown, Sparkles, Info } from "lucide-react";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";
import { useFipeBatch } from "@/lib/fipe/useFipeBatch";
import { cn, formatBRL, formatBRLCents } from "@/lib/utils";
import { showSuccessToast } from "@/components/ui/Toast";
import { Tooltip } from "@/components/ui/Tooltip";

type StatusSemaforo = "lucro" | "atencao" | "prejuizo";

export function SimuladorPreco({ veiculo }: { veiculo: VeiculoParsed }) {
  const fipeBatch = useFipeBatch();
  const precoFipe = fipeBatch?.items[veiculo.chassi]?.precoFipe ?? null;

  // Sem custo total → não dá pra simular, mas explica em vez de sumir silenciosamente.
  if (veiculo.custo_total == null) {
    return (
      <section className="rounded-xl border border-dashed border-[var(--border-base)] bg-[var(--bg-surface)] px-5 py-4 text-sm text-[var(--text-muted)]">
        <div className="flex items-start gap-2">
          <Calculator className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-subtle)]" />
          <p>
            <span className="font-semibold text-[var(--text-body)]">Simulador de preço indisponível.</span>{" "}
            Custo total ainda não foi importado pra esse veículo. Faça upload do relatório <em>&quot;Custos de Veículos em Estoque&quot;</em> do NBS pra habilitar a simulação.
          </p>
        </div>
      </section>
    );
  }

  return <SimuladorView veiculo={veiculo} precoFipe={precoFipe} custoTotal={veiculo.custo_total} />;
}

function SimuladorView({
  veiculo,
  precoFipe,
  custoTotal,
}: {
  veiculo: VeiculoParsed;
  precoFipe: number | null;
  custoTotal: number;
}) {
  const precoAtual = veiculo.preco_venda;
  const [precoSim, setPrecoSim] = useState<number | null>(precoAtual);

  const calc = useMemo(() => {
    if (precoSim == null || precoSim <= 0) return null;
    const lucroBruto = precoSim - custoTotal;
    const margemPct = (lucroBruto / precoSim) * 100;

    let status: StatusSemaforo;
    if (margemPct >= 5) status = "lucro";
    else if (margemPct >= 0) status = "atencao";
    else status = "prejuizo";

    const difAtual = precoAtual != null ? precoSim - precoAtual : null;
    const difAtualPct = precoAtual != null && precoAtual > 0 ? ((precoSim - precoAtual) / precoAtual) * 100 : null;
    const desvioFipePct = precoFipe != null && precoFipe > 0 ? ((precoSim - precoFipe) / precoFipe) * 100 : null;

    return { lucroBruto, margemPct, status, difAtual, difAtualPct, desvioFipePct };
  }, [precoSim, custoTotal, precoAtual, precoFipe]);

  const alertas = useMemo(() => {
    const out: { tipo: "ruim" | "atenção" | "bom"; texto: string }[] = [];
    if (!calc) return out;
    if (calc.status === "prejuizo") {
      out.push({ tipo: "ruim", texto: `Prejuízo de ${formatBRLCents(Math.abs(calc.lucroBruto))} a esse preço.` });
    } else if (calc.status === "atencao") {
      out.push({ tipo: "atenção", texto: `Margem fina (${calc.margemPct.toFixed(1)}%) — pouco espaço pra negociar.` });
    }
    if (calc.desvioFipePct != null) {
      if (calc.desvioFipePct > 5) {
        out.push({ tipo: "atenção", texto: `Acima da FIPE em +${calc.desvioFipePct.toFixed(1)}% — risco de demorar a girar.` });
      } else if (calc.desvioFipePct < -5) {
        out.push({ tipo: "atenção", texto: `Abaixo da FIPE (${calc.desvioFipePct.toFixed(1)}%) — venda rápida provável, margem perdida.` });
      }
    }
    if (calc.status === "lucro" && (calc.desvioFipePct == null || (calc.desvioFipePct >= -5 && calc.desvioFipePct <= 5))) {
      out.push({ tipo: "bom", texto: `Margem saudável (${calc.margemPct.toFixed(1)}%) e dentro da faixa da FIPE.` });
    }
    return out;
  }, [calc]);

  async function copiarPreco() {
    if (precoSim == null) return;
    try {
      await navigator.clipboard.writeText(precoSim.toFixed(2).replace(".", ","));
      showSuccessToast(`Preço ${formatBRL(precoSim)} copiado`);
    } catch {
      showSuccessToast(`Preço ${formatBRL(precoSim)}`);
    }
  }

  function resetar() {
    setPrecoSim(precoAtual);
  }

  const borderTone =
    calc?.status === "prejuizo"
      ? "border-red-300 dark:border-red-900/60"
      : calc?.status === "atencao"
        ? "border-amber-300 dark:border-amber-900/60"
        : calc?.status === "lucro"
          ? "border-emerald-300 dark:border-emerald-900/60"
          : "border-[var(--border-soft)]";

  return (
    <section className={cn("rounded-xl border bg-[var(--bg-surface)] shadow-[var(--shadow-sm)] transition-colors duration-200", borderTone)}>
      <header className="flex flex-wrap items-center gap-2 border-b border-[var(--border-soft)] px-5 py-3">
        <Calculator className="h-4 w-4 text-[var(--text-muted)]" />
        <h3 className="text-sm font-semibold text-[var(--text-strong)]">Simulador de preço</h3>
        <span className="text-xs text-[var(--text-muted)]">— teste cenários sem salvar nada</span>
        {calc && <StatusBadge status={calc.status} />}
      </header>

      <div className="grid gap-5 p-5 lg:grid-cols-[1fr,1fr]">
        {/* Coluna 1 — input + ações */}
        <div className="space-y-3">
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Preço de venda simulado
            </span>
            <CurrencyInput
              value={precoSim}
              onChange={setPrecoSim}
              className={cn(
                "mt-1 w-full rounded-lg border bg-[var(--bg-app)] px-4 py-3 text-2xl font-bold tabular-nums tracking-tight outline-none transition-colors duration-200",
                "focus:border-[var(--brand-500)] focus:ring-2 focus:ring-[var(--brand-500)]/30",
                calc?.status === "prejuizo" && "border-red-400 text-red-700 dark:text-red-400",
                calc?.status === "atencao" && "border-amber-400 text-amber-700 dark:text-amber-400",
                calc?.status === "lucro" && "border-emerald-400 text-emerald-700 dark:text-emerald-400",
                !calc && "border-[var(--border-base)] text-[var(--text-strong)]",
              )}
            />
          </label>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={copiarPreco}
              disabled={precoSim == null || precoSim <= 0}
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--brand-700)] px-3 py-2 text-xs font-medium text-white transition hover:bg-[var(--brand-800)] disabled:opacity-40"
            >
              <ClipboardCopy className="h-3.5 w-3.5" />
              Copiar {precoSim != null ? formatBRL(precoSim) : "—"}
            </button>
            <button
              type="button"
              onClick={resetar}
              disabled={precoSim === precoAtual}
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-soft)] bg-[var(--bg-surface)] px-3 py-2 text-xs font-medium text-[var(--text-body)] transition hover:bg-[var(--bg-muted)] disabled:opacity-40"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Voltar pro atual ({precoAtual != null ? formatBRL(precoAtual) : "—"})
            </button>
          </div>

          {/* Atalhos rápidos */}
          {precoAtual != null && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Atalhos:</span>
              {[-0.05, -0.03, -0.01, 0.01, 0.03, 0.05].map((delta) => {
                const novo = Math.round(precoAtual * (1 + delta));
                const sign = delta > 0 ? "+" : "";
                return (
                  <button
                    key={delta}
                    type="button"
                    onClick={() => setPrecoSim(novo)}
                    className="rounded border border-[var(--border-soft)] bg-[var(--bg-app)] px-1.5 py-0.5 text-[10px] tabular-nums text-[var(--text-muted)] hover:border-[var(--border-base)] hover:text-[var(--text-strong)]"
                  >
                    {sign}{(delta * 100).toFixed(0)}%
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Coluna 2 — métricas */}
        <div className="grid grid-cols-2 gap-3">
          <MetricCard
            label="Lucro bruto"
            value={calc ? formatBRLCents(calc.lucroBruto) : "—"}
            tone={calc?.status === "lucro" ? "good" : calc?.status === "atencao" ? "warn" : calc?.status === "prejuizo" ? "bad" : "neutral"}
            tooltip="Lucro bruto = preço de venda simulado − custo total NBS. Não considera impostos sobre o lucro."
          />
          <MetricCard
            label="Margem"
            value={calc ? `${calc.margemPct >= 0 ? "+" : ""}${calc.margemPct.toFixed(1)}%` : "—"}
            tone={calc?.status === "lucro" ? "good" : calc?.status === "atencao" ? "warn" : calc?.status === "prejuizo" ? "bad" : "neutral"}
            tooltip="Margem percentual = lucro bruto ÷ preço de venda. Saudável: ≥ 5%. Fina: 0–5%. Prejuízo: < 0%."
          />
          <MetricCard
            label="vs Preço atual"
            value={calc?.difAtualPct != null
              ? `${calc.difAtualPct >= 0 ? "+" : ""}${calc.difAtualPct.toFixed(1)}%`
              : "—"}
            sub={calc?.difAtual != null ? `${calc.difAtual >= 0 ? "+" : ""}${formatBRLCents(calc.difAtual)}` : undefined}
            tone="neutral"
            tooltip={`Diferença entre o preço simulado e o preço atual da tabela NBS (${precoAtual != null ? formatBRL(precoAtual) : "—"}).`}
          />
          <MetricCard
            label="vs FIPE"
            value={calc?.desvioFipePct != null
              ? `${calc.desvioFipePct >= 0 ? "+" : ""}${calc.desvioFipePct.toFixed(1)}%`
              : "—"}
            sub={precoFipe != null ? `FIPE ${formatBRL(precoFipe)}` : "FIPE não calculada"}
            tone={
              calc?.desvioFipePct == null ? "neutral"
                : calc.desvioFipePct > 5 ? "warn"
                  : calc.desvioFipePct < -5 ? "good"
                    : "neutral"
            }
            tooltip="Desvio do preço simulado em relação à FIPE. Acima de +5% = caro (risco de demora). Abaixo de −5% = barato (gira rápido mas perde margem)."
          />
          <div className="col-span-2">
            <MetricCard
              label="Custo total NBS"
              value={formatBRLCents(custoTotal)}
              tone="neutral"
              tooltip="Custo total final do veículo conforme NBS DMS — não muda com a simulação."
              dense
            />
          </div>
        </div>
      </div>

      {/* Alertas dinâmicos */}
      {alertas.length > 0 && (
        <div className="space-y-1.5 border-t border-[var(--border-soft)] px-5 py-3">
          {alertas.map((a, i) => (
            <p
              key={i}
              className={cn(
                "flex items-start gap-2 text-xs",
                a.tipo === "ruim" && "text-red-700 dark:text-red-400",
                a.tipo === "atenção" && "text-amber-700 dark:text-amber-400",
                a.tipo === "bom" && "text-emerald-700 dark:text-emerald-400",
              )}
            >
              {a.tipo === "ruim" && <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
              {a.tipo === "atenção" && <TrendingDown className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
              {a.tipo === "bom" && <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
              <span>{a.texto}</span>
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

function StatusBadge({ status }: { status: StatusSemaforo }) {
  const conf =
    status === "lucro"
      ? { bg: "bg-emerald-100 dark:bg-emerald-950/40", text: "text-emerald-800 dark:text-emerald-300", icon: <TrendingUp className="h-3 w-3" />, label: "Lucro saudável" }
      : status === "atencao"
        ? { bg: "bg-amber-100 dark:bg-amber-950/40", text: "text-amber-800 dark:text-amber-300", icon: <TrendingDown className="h-3 w-3" />, label: "Margem fina" }
        : { bg: "bg-red-100 dark:bg-red-950/40", text: "text-red-800 dark:text-red-300", icon: <AlertTriangle className="h-3 w-3" />, label: "Prejuízo" };
  return (
    <span className={cn("ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold", conf.bg, conf.text)}>
      {conf.icon} {conf.label}
    </span>
  );
}

type MetricTone = "good" | "warn" | "bad" | "neutral";

function MetricCard({
  label,
  value,
  sub,
  tone,
  tooltip,
  dense,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: MetricTone;
  tooltip: string;
  dense?: boolean;
}) {
  const toneClass =
    tone === "good"
      ? "text-emerald-700 dark:text-emerald-400"
      : tone === "warn"
        ? "text-amber-700 dark:text-amber-400"
        : tone === "bad"
          ? "text-red-700 dark:text-red-400"
          : "text-[var(--text-strong)]";

  return (
    <div className={cn("rounded-lg border border-[var(--border-soft)] bg-[var(--bg-app)] p-3 transition-colors duration-200", dense && "py-2")}>
      <div className="flex items-center gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{label}</span>
        <Tooltip content={tooltip} side="top">
          <Info className="h-3 w-3 text-[var(--text-subtle)] opacity-60 hover:opacity-100" aria-label={`Sobre ${label}`} />
        </Tooltip>
      </div>
      <p className={cn("mt-0.5 text-lg font-bold tabular-nums transition-colors duration-200", toneClass, dense && "text-base")}>{value}</p>
      {sub && <p className="text-[10px] tabular-nums text-[var(--text-muted)]">{sub}</p>}
    </div>
  );
}

/**
 * Input de moeda BRL controlado.
 * Aceita teclado livre (digita só números) e mantém o valor formatado no display.
 * Em vez de máscara custom, usa um type="text" simples com onChange parseando.
 */
function CurrencyInput({
  value,
  onChange,
  className,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  className?: string;
}) {
  const [focado, setFocado] = useState(false);
  const [rascunho, setRascunho] = useState<string>("");

  const display = focado
    ? rascunho
    : value != null
      ? formatBRL(value)
      : "";

  return (
    <input
      type="text"
      inputMode="decimal"
      value={display}
      placeholder="R$ 0,00"
      onFocus={() => {
        setRascunho(value != null ? value.toFixed(2).replace(".", ",") : "");
        setFocado(true);
      }}
      onBlur={() => {
        setFocado(false);
        const parsed = parseDecimal(rascunho);
        onChange(parsed);
      }}
      onChange={(e) => {
        // Só aceita dígitos, vírgula e ponto. Limita a 1 separador decimal.
        const limpo = e.target.value.replace(/[^\d.,]/g, "");
        setRascunho(limpo);
        const parsed = parseDecimal(limpo);
        onChange(parsed);
      }}
      className={className}
    />
  );
}

/**
 * Parser tolerante de número em formato BR. Regras:
 *   1. Se há vírgula → vírgula é o separador decimal; pontos são milhares.
 *      ex: "178.500,47" → 178500.47
 *   2. Se NÃO há vírgula mas há ponto seguido por 1-2 dígitos no final → ponto é decimal.
 *      ex: "178.50" → 178.50 ; "1.5" → 1.5
 *   3. Caso contrário (sem vírgula, ponto seguido por 3 dígitos) → ponto é milhar.
 *      ex: "178.500" → 178500 ; "1.234.567" → 1234567
 *   4. Strings sem dígito retornam null.
 */
function parseDecimal(s: string): number | null {
  if (!s) return null;
  let norm: string;
  if (s.includes(",")) {
    // Regra 1: vírgula é decimal, ponto é milhar.
    norm = s.replace(/\./g, "").replace(",", ".");
  } else if (/\.\d{1,2}$/.test(s) && (s.match(/\./g) ?? []).length === 1) {
    // Regra 2: único ponto seguido por 1-2 dígitos no fim → decimal.
    norm = s;
  } else {
    // Regra 3: ponto é milhar.
    norm = s.replace(/\./g, "");
  }
  const n = parseFloat(norm);
  return Number.isFinite(n) ? n : null;
}
