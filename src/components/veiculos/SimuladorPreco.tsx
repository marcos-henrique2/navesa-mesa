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

import { useEffect, useMemo, useState } from "react";
import { Calculator, ClipboardCopy, RotateCcw, AlertTriangle, TrendingUp, TrendingDown, Sparkles, Info, Plus, Minus, SlidersHorizontal } from "lucide-react";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";
import type { CustoEstoqueDetalhado } from "@/lib/parsers/nbs-custos-estoque-pdf";
import { useFipeBatch } from "@/lib/fipe/useFipeBatch";
import { precoFipeConfiavel } from "@/lib/fipe/batch";
import { useInventory } from "@/lib/store/inventory";
import { setPrecoSimulado } from "@/lib/store/simulador-preco";
import { normalizarPlaca } from "@/lib/utils/placa";
import { cn, formatBRL, formatBRLCents } from "@/lib/utils";
import { showSuccessToast } from "@/components/ui/Toast";
import { Tooltip } from "@/components/ui/Tooltip";

type StatusSemaforo = "lucro" | "atencao" | "prejuizo";

type Composicao = {
  precoBasico: number;
  acessorios: number;
  frete: number;
  outros: number;
  descontoTipo: "valor" | "pct";
  descontoValor: number; // R$ quando "valor", % quando "pct"
};

export function SimuladorPreco({ veiculo }: { veiculo: VeiculoParsed }) {
  const fipeBatch = useFipeBatch();
  const { custosEstoquePorPlaca } = useInventory();
  const precoFipe = precoFipeConfiavel(fipeBatch, veiculo.chassi);
  const custoEstoque = veiculo.placa
    ? custosEstoquePorPlaca[normalizarPlaca(veiculo.placa)] ?? null
    : null;

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

  return <SimuladorView veiculo={veiculo} precoFipe={precoFipe} custoTotal={veiculo.custo_total} custoEstoque={custoEstoque} />;
}

function SimuladorView({
  veiculo,
  precoFipe,
  custoTotal,
  custoEstoque,
}: {
  veiculo: VeiculoParsed;
  precoFipe: number | null;
  custoTotal: number;
  custoEstoque: CustoEstoqueDetalhado | null;
}) {
  const precoAtual = veiculo.preco_venda;
  const [modoDecomposto, setModoDecomposto] = useState(false);
  const [precoSimples, setPrecoSimples] = useState<number | null>(precoAtual);
  const [composicao, setComposicao] = useState<Composicao>({
    precoBasico: precoAtual ?? 0,
    acessorios: 0,
    frete: 0,
    outros: 0,
    descontoTipo: "valor",
    descontoValor: 0,
  });

  // Cálculo do preço composto (só importa quando modoDecomposto=true).
  const composto = useMemo(() => {
    const subtotal =
      composicao.precoBasico + composicao.acessorios + composicao.frete + composicao.outros;
    const descontoEmReais =
      composicao.descontoTipo === "valor"
        ? composicao.descontoValor
        : (subtotal * composicao.descontoValor) / 100;
    const descontoEmPct = subtotal > 0 ? (descontoEmReais / subtotal) * 100 : 0;
    const precoFinal = Math.max(0, subtotal - descontoEmReais);
    return { subtotal, descontoEmReais, descontoEmPct, precoFinal };
  }, [composicao]);

  // Preço efetivo que alimenta todos os cálculos abaixo.
  const precoSim = modoDecomposto ? composto.precoFinal : precoSimples;

  // Propaga o preço simulado pro store global — assim o Demonstrativo de Lucro
  // e outros componentes da página reagem em tempo real às mudanças do Simulador.
  useEffect(() => {
    setPrecoSimulado(veiculo.chassi, precoSim);
    return () => {
      setPrecoSimulado(veiculo.chassi, null);
    };
  }, [veiculo.chassi, precoSim]);

  function toggleModo() {
    if (!modoDecomposto) {
      // Entrando no modo decomposto: leva precoSimples atual pro precoBasico, zera complementos.
      setComposicao({
        precoBasico: precoSimples ?? precoAtual ?? 0,
        acessorios: 0,
        frete: 0,
        outros: 0,
        descontoTipo: "valor",
        descontoValor: 0,
      });
    } else {
      // Saindo: leva o preço composto pro modo simples (mantém o valor entre alternâncias).
      setPrecoSimples(composto.precoFinal);
    }
    setModoDecomposto((v) => !v);
  }

  // Separação Custo Fixo vs Variável pra calcular Margem de Contribuição.
  //
  // Classificação adotada:
  //   FIXO (rateado da operação)   = ADM + Despesas Gerais
  //   VARIÁVEL (específico do carro) = todo o resto que compõe o custo total
  //
  // Observação importante sobre abatimentos (HoldBack, Bônus Fábrica, Ganhos
  // Indiretos): o NBS já os subtrai do `custo_total`. Portanto NÃO os tratamos
  // separadamente aqui — ficam "embutidos" no custoVariavel (que é derivado
  // como custoTotal − custoFixo). Isso é consistente com o conceito de
  // "Custo Variável Líquido" no NBS Markup.
  //
  // Se a classificação contábil real da Navesa for diferente (ex: tratar
  // comissões variáveis como parte do custo fixo), revisitar aqui.
  const custoFixo = useMemo(() => {
    if (!custoEstoque) return null;
    return custoEstoque.adm + custoEstoque.desp_gerais;
  }, [custoEstoque]);

  const custoVariavel = custoFixo != null ? custoTotal - custoFixo : null;

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

    // Margem de contribuição: (preço − custo variável) ÷ preço.
    // Só calcula se temos o detalhe da composição (CustoEstoqueDetalhado).
    const margemContribRs = custoVariavel != null ? precoSim - custoVariavel : null;
    const margemContribPct = custoVariavel != null && precoSim > 0
      ? ((precoSim - custoVariavel) / precoSim) * 100
      : null;

    return { lucroBruto, margemPct, status, difAtual, difAtualPct, desvioFipePct, margemContribRs, margemContribPct };
  }, [precoSim, custoTotal, custoVariavel, precoAtual, precoFipe]);

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
    if (modoDecomposto) {
      setComposicao({
        precoBasico: precoAtual ?? 0,
        acessorios: 0,
        frete: 0,
        outros: 0,
        descontoTipo: "valor",
        descontoValor: 0,
      });
    } else {
      setPrecoSimples(precoAtual);
    }
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
        {/* Coluna 1 — input simples OU composição decomposta */}
        <div className="space-y-3">
          {/* Toggle de modo */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              {modoDecomposto ? "Composição do preço" : "Preço de venda simulado"}
            </span>
            <button
              type="button"
              onClick={toggleModo}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--border-soft)] bg-[var(--bg-surface)] px-2 py-1 text-[10px] font-medium text-[var(--text-muted)] transition hover:bg-[var(--bg-muted)] hover:text-[var(--text-strong)]"
              title={modoDecomposto ? "Voltar pro modo simples (preço único)" : "Decompor em Preço Básico + Acessórios + Frete − Desconto"}
            >
              <SlidersHorizontal className="h-3 w-3" />
              {modoDecomposto ? "Modo simples" : "Decompor preço"}
            </button>
          </div>

          {modoDecomposto ? (
            <ComposicaoEditor
              composicao={composicao}
              setComposicao={setComposicao}
              composto={composto}
              status={calc?.status}
            />
          ) : (
            <CurrencyInput
              value={precoSimples}
              onChange={setPrecoSimples}
              className={cn(
                "w-full rounded-lg border bg-[var(--bg-app)] px-4 py-3 text-2xl font-bold tabular-nums tracking-tight outline-none transition-colors duration-200",
                "focus:border-[var(--brand-500)] focus:ring-2 focus:ring-[var(--brand-500)]/30",
                calc?.status === "prejuizo" && "border-red-400 text-red-700 dark:text-red-400",
                calc?.status === "atencao" && "border-amber-400 text-amber-700 dark:text-amber-400",
                calc?.status === "lucro" && "border-emerald-400 text-emerald-700 dark:text-emerald-400",
                !calc && "border-[var(--border-base)] text-[var(--text-strong)]",
              )}
            />
          )}

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
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-soft)] bg-[var(--bg-surface)] px-3 py-2 text-xs font-medium text-[var(--text-body)] transition hover:bg-[var(--bg-muted)]"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Voltar pro atual ({precoAtual != null ? formatBRL(precoAtual) : "—"})
            </button>
          </div>

          {/* Atalhos rápidos — só em modo simples (no decomposto, edita-se o desconto) */}
          {!modoDecomposto && precoAtual != null && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Atalhos:</span>
              {[-0.05, -0.03, -0.01, 0.01, 0.03, 0.05].map((delta) => {
                const novo = Math.round(precoAtual * (1 + delta));
                const sign = delta > 0 ? "+" : "";
                return (
                  <button
                    key={delta}
                    type="button"
                    onClick={() => setPrecoSimples(novo)}
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
            label="Lucro Líquido"
            value={calc ? formatBRLCents(calc.lucroBruto) : "—"}
            tone={calc?.status === "lucro" ? "good" : calc?.status === "atencao" ? "warn" : calc?.status === "prejuizo" ? "bad" : "neutral"}
            tooltip="Lucro Líquido = Preço de Venda − Custo Total NBS. Considera TODOS os gastos do carro (Floor Plan, ADM, Impostos, Comissões, Despesas) e os abatimentos da fábrica (HoldBack, Bônus, Ganhos Indiretos). Veja a decomposição completa no Demonstrativo do Lucro abaixo."
          />
          <MetricCard
            label="Margem Líquida"
            value={calc ? `${calc.margemPct >= 0 ? "+" : ""}${calc.margemPct.toFixed(1)}%` : "—"}
            tone={calc?.status === "lucro" ? "good" : calc?.status === "atencao" ? "warn" : calc?.status === "prejuizo" ? "bad" : "neutral"}
            tooltip="Margem Líquida = Lucro Líquido ÷ Preço de Venda. Considera TODOS os custos lançados no NBS. Saudável: ≥ 5%. Fina: 0–5%. Prejuízo: < 0%."
          />
          <MetricCard
            label="Margem de Contribuição"
            value={calc?.margemContribPct != null
              ? `${calc.margemContribPct >= 0 ? "+" : ""}${calc.margemContribPct.toFixed(1)}%`
              : custoEstoque == null ? "—" : "—"}
            sub={calc?.margemContribRs != null ? formatBRLCents(calc.margemContribRs) : (custoEstoque == null ? "importe markup pra calcular" : undefined)}
            tone={
              calc?.margemContribPct == null ? "neutral"
                : calc.margemContribPct >= 10 ? "good"
                  : calc.margemContribPct >= 0 ? "warn"
                    : "bad"
            }
            tooltip="Margem de Contribuição = (preço − custos variáveis) ÷ preço. Exclui custos fixos rateados (ADM + Despesas Gerais). Representa quanto a venda contribui pra cobrir o operacional. Sempre maior que Margem de Venda. Use pra negociar fundo: se 'cair' nessa margem, ainda contribui pro fixo."
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
            sub={precoFipe != null ? `FIPE ${formatBRL(precoFipe)}` : "FIPE não confirmada"}
            tone={
              calc?.desvioFipePct == null ? "neutral"
                : calc.desvioFipePct > 5 ? "warn"
                  : calc.desvioFipePct < -5 ? "good"
                    : "neutral"
            }
            tooltip="Desvio do preço simulado em relação à FIPE. Acima de +5% = caro (risco de demora). Abaixo de −5% = barato (gira rápido mas perde margem)."
          />
          <MetricCard
            label="Custo total NBS"
            value={formatBRLCents(custoTotal)}
            sub={custoFixo != null ? `Fixo ${formatBRLCents(custoFixo)} · Var ${formatBRLCents(custoTotal - custoFixo)}` : undefined}
            tone="neutral"
            tooltip="Custo total final do veículo conforme NBS DMS. Quando há detalhe importado, mostra também a quebra: 'Fixo' = ADM + Despesas Gerais; 'Var' = todo o resto."
          />
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
/**
 * Editor da composição do preço (modo decomposto).
 * Mostra Preço Básico + Acessórios + Frete + Outros − Desconto = Preço de Venda.
 * Desconto pode ser editado em R$ ou em % — converte ao trocar de tipo.
 */
function ComposicaoEditor({
  composicao,
  setComposicao,
  composto,
  status,
}: {
  composicao: Composicao;
  setComposicao: (c: Composicao) => void;
  composto: { subtotal: number; descontoEmReais: number; descontoEmPct: number; precoFinal: number };
  status: StatusSemaforo | undefined;
}) {
  function trocarDescontoTipo(novo: "valor" | "pct") {
    if (novo === composicao.descontoTipo) return;
    // Ao trocar, converte o valor digitado pro novo tipo pra não pular numericamente.
    // Quando subtotal=0 (todos os componentes zerados), não há base pra converter %:
    // o desconto cai pra 0 silenciosamente — comportamento esperado, sem divisão por zero.
    if (novo === "pct") {
      const pct = composto.subtotal > 0 ? (composicao.descontoValor / composto.subtotal) * 100 : 0;
      setComposicao({ ...composicao, descontoTipo: novo, descontoValor: Number(pct.toFixed(2)) });
    } else {
      const reais = (composto.subtotal * composicao.descontoValor) / 100;
      setComposicao({ ...composicao, descontoTipo: novo, descontoValor: Number(reais.toFixed(2)) });
    }
  }

  const finalTone =
    status === "prejuizo"
      ? "border-red-400 text-red-700 dark:text-red-400"
      : status === "atencao"
        ? "border-amber-400 text-amber-700 dark:text-amber-400"
        : status === "lucro"
          ? "border-emerald-400 text-emerald-700 dark:text-emerald-400"
          : "border-[var(--border-base)] text-[var(--text-strong)]";

  return (
    <div className="space-y-2 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-app)] p-3">
      <LinhaComposicao
        label="Preço Básico"
        prefixo={null}
        value={composicao.precoBasico}
        onChange={(v) => setComposicao({ ...composicao, precoBasico: v ?? 0 })}
      />
      <LinhaComposicao
        label="Acessórios"
        prefixo="add"
        value={composicao.acessorios}
        onChange={(v) => setComposicao({ ...composicao, acessorios: v ?? 0 })}
      />
      <LinhaComposicao
        label="Frete"
        prefixo="add"
        value={composicao.frete}
        onChange={(v) => setComposicao({ ...composicao, frete: v ?? 0 })}
      />
      <LinhaComposicao
        label="Outros"
        prefixo="add"
        value={composicao.outros}
        onChange={(v) => setComposicao({ ...composicao, outros: v ?? 0 })}
      />

      <div className="flex items-center justify-between border-t border-[var(--border-soft)] pt-2 text-xs">
        <span className="text-[var(--text-muted)]">Subtotal</span>
        <span className="font-semibold tabular-nums text-[var(--text-body)]">{formatBRLCents(composto.subtotal)}</span>
      </div>

      {/* Desconto com toggle R$ / % */}
      <div className="rounded-md bg-[var(--bg-muted)]/50 p-2">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1 text-xs">
            <Minus className="h-3 w-3 text-red-600 dark:text-red-400" />
            <span className="text-[var(--text-body)]">Desconto</span>
            <div className="ml-1 inline-flex overflow-hidden rounded border border-[var(--border-soft)]">
              <button
                type="button"
                onClick={() => trocarDescontoTipo("valor")}
                className={cn(
                  "px-1.5 py-0.5 text-[10px] font-medium transition",
                  composicao.descontoTipo === "valor"
                    ? "bg-[var(--brand-700)] text-white"
                    : "bg-[var(--bg-surface)] text-[var(--text-muted)] hover:bg-[var(--bg-app)]",
                )}
              >
                R$
              </button>
              <button
                type="button"
                onClick={() => trocarDescontoTipo("pct")}
                className={cn(
                  "px-1.5 py-0.5 text-[10px] font-medium transition",
                  composicao.descontoTipo === "pct"
                    ? "bg-[var(--brand-700)] text-white"
                    : "bg-[var(--bg-surface)] text-[var(--text-muted)] hover:bg-[var(--bg-app)]",
                )}
              >
                %
              </button>
            </div>
          </span>
          <div className="flex items-center gap-2">
            <CurrencyInput
              value={composicao.descontoValor}
              onChange={(v) => setComposicao({ ...composicao, descontoValor: v ?? 0 })}
              className="w-24 rounded border border-[var(--border-soft)] bg-[var(--bg-app)] px-2 py-1 text-right text-xs tabular-nums focus:border-[var(--brand-500)] focus:outline-none"
            />
            <span className="text-[10px] tabular-nums text-[var(--text-muted)]" style={{ minWidth: 64 }}>
              {composicao.descontoTipo === "pct"
                ? `= ${formatBRLCents(composto.descontoEmReais)}`
                : `= ${composto.descontoEmPct.toFixed(2)}%`}
            </span>
          </div>
        </div>
      </div>

      {/* Preço final */}
      <div className={cn("flex items-center justify-between rounded-md border-2 border-dashed px-3 py-2 transition-colors duration-200", finalTone)}>
        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider">
          <Plus className="h-3 w-3" /> Preço de Venda
        </span>
        <span className="text-xl font-bold tabular-nums">{formatBRLCents(composto.precoFinal)}</span>
      </div>
    </div>
  );
}

function LinhaComposicao({
  label,
  prefixo,
  value,
  onChange,
}: {
  label: string;
  prefixo: "add" | null;
  value: number;
  onChange: (v: number | null) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="inline-flex items-center gap-1 text-[var(--text-body)]">
        {prefixo === "add" && <Plus className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />}
        {label}
      </span>
      <CurrencyInput
        value={value}
        onChange={onChange}
        className="w-32 rounded border border-[var(--border-soft)] bg-[var(--bg-app)] px-2 py-1 text-right text-xs tabular-nums focus:border-[var(--brand-500)] focus:outline-none"
      />
    </div>
  );
}

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
