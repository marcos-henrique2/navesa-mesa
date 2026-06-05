"use client";

/**
 * Demonstrativo do Lucro — decompõe linha a linha de onde sai o lucro.
 *
 * Mostra:
 *   1. Preço de venda
 *   2. Custos REAIS (do NBS) com valor ≠ 0
 *   3. Ganhos da fábrica (HoldBack, Bônus, Ganhos Indiretos)
 *   4. LUCRO BRUTO (= preço − custos reais NBS)
 *   5. Custos ESTIMADOS (Impostos, Comissões, Despesas Gerais) — só quando NBS está zerado
 *   6. LUCRO LÍQUIDO ESTIMADO (= bruto − estimados)
 *
 * Inteligência:
 *   - Se NBS já tem Impostos > 0 (venda já fechada), não estima esses.
 *   - Se Comissões > 0, não estima comissão.
 *   - Mostra avisos claros sobre o que é REAL vs ESTIMADO.
 *
 * Configuração de % via componente EditorEstimativas (botão ⚙️).
 */

import { useMemo, useState } from "react";
import { Calculator, ShoppingCart, Wrench, Banknote, Gift, Package, Briefcase, Landmark, UserSquare2, FileText, Star, Settings, AlertTriangle, TrendingUp } from "lucide-react";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";
import type { CustoEstoqueDetalhado } from "@/lib/parsers/nbs-custos-estoque-pdf";
import { useInventory } from "@/lib/store/inventory";
import { useEstimativas } from "@/lib/config/useEstimativas";
import { setEstimativas, type EstimativasCustos } from "@/lib/config/estimativas-custos";
import { normalizarPlaca } from "@/lib/utils/placa";
import { cn, formatBRLCents } from "@/lib/utils";
import { Tooltip } from "@/components/ui/Tooltip";
import { showSuccessToast } from "@/components/ui/Toast";

export function DemonstrativoLucro({
  veiculo,
  precoSim,
}: {
  veiculo: VeiculoParsed;
  precoSim: number | null;
}) {
  const { custosEstoquePorPlaca } = useInventory();
  const custoEstoque = veiculo.placa
    ? custosEstoquePorPlaca[normalizarPlaca(veiculo.placa)] ?? null
    : null;
  const estimativas = useEstimativas();
  const [editandoConfig, setEditandoConfig] = useState(false);

  // Sem custo total ou sem preço → não dá pra demonstrar.
  if (veiculo.custo_total == null || precoSim == null || precoSim <= 0) return null;

  return (
    <DemonstrativoView
      veiculo={veiculo}
      precoSim={precoSim}
      custoEstoque={custoEstoque}
      estimativas={estimativas}
      editandoConfig={editandoConfig}
      setEditandoConfig={setEditandoConfig}
    />
  );
}

function DemonstrativoView({
  veiculo,
  precoSim,
  custoEstoque,
  estimativas,
  editandoConfig,
  setEditandoConfig,
}: {
  veiculo: VeiculoParsed;
  precoSim: number;
  custoEstoque: CustoEstoqueDetalhado | null;
  estimativas: EstimativasCustos;
  editandoConfig: boolean;
  setEditandoConfig: (b: boolean) => void;
}) {
  // Linhas REAIS do NBS — só mostra as ≠ 0.
  const linhasReais = useMemo(() => {
    if (!custoEstoque) {
      // Sem detalhe importado: só temos o agregado.
      return [
        {
          label: "Custo Total NBS (sem detalhe)",
          icon: <Calculator className="h-3.5 w-3.5" />,
          valor: veiculo.custo_total ?? 0,
          tipo: "custo" as const,
        },
      ];
    }
    const out: { label: string; icon: React.ReactNode; valor: number; tipo: "custo" | "ganho" }[] = [];
    // Mostra qualquer valor ≠ 0 — inclusive negativos (estornos, devoluções) pra
    // não esconder transações que afetam o custo_total agregado.
    if (custoEstoque.nota_fabrica !== 0) out.push({ label: "Aquisição (Nota Fábrica)", icon: <ShoppingCart className="h-3.5 w-3.5" />, valor: custoEstoque.nota_fabrica, tipo: "custo" });
    if (custoEstoque.revisoes !== 0) out.push({ label: "Revisões", icon: <Wrench className="h-3.5 w-3.5" />, valor: custoEstoque.revisoes, tipo: "custo" });
    if (custoEstoque.forplan !== 0) out.push({ label: "Floor Plan", icon: <Banknote className="h-3.5 w-3.5" />, valor: custoEstoque.forplan, tipo: "custo" });
    if (custoEstoque.acessorios !== 0) out.push({ label: "Acessórios", icon: <Package className="h-3.5 w-3.5" />, valor: custoEstoque.acessorios, tipo: "custo" });
    if (custoEstoque.adm !== 0) out.push({ label: "ADM", icon: <Briefcase className="h-3.5 w-3.5" />, valor: custoEstoque.adm, tipo: "custo" });
    if (custoEstoque.impostos !== 0) out.push({ label: "Impostos", icon: <Landmark className="h-3.5 w-3.5" />, valor: custoEstoque.impostos, tipo: "custo" });
    if (custoEstoque.comissoes !== 0) out.push({ label: "Comissões", icon: <UserSquare2 className="h-3.5 w-3.5" />, valor: custoEstoque.comissoes, tipo: "custo" });
    if (custoEstoque.desp_gerais !== 0) out.push({ label: "Despesas Gerais", icon: <FileText className="h-3.5 w-3.5" />, valor: custoEstoque.desp_gerais, tipo: "custo" });
    if (custoEstoque.holdback !== 0) out.push({ label: "(−) HoldBack", icon: <Gift className="h-3.5 w-3.5" />, valor: custoEstoque.holdback, tipo: "ganho" });
    if (custoEstoque.bonus !== 0) out.push({ label: "(−) Bônus de Fábrica", icon: <Star className="h-3.5 w-3.5" />, valor: custoEstoque.bonus, tipo: "ganho" });
    if (custoEstoque.ganhos_indiretos !== 0) out.push({ label: "(−) Ganhos Indiretos", icon: <Gift className="h-3.5 w-3.5" />, valor: custoEstoque.ganhos_indiretos, tipo: "ganho" });
    return out;
  }, [custoEstoque, veiculo.custo_total]);

  // Lucro Bruto = preço − custo total NBS (já reflete todos os custos reais e ganhos)
  const custoTotal = veiculo.custo_total ?? 0;
  const lucroBruto = precoSim - custoTotal;

  // Custos ESTIMADOS — só calcula pros campos que estão zerados no NBS.
  // Limiar pra "comissão parcial": se NBS tem comissões positivas MAS muito baixas
  // (< 80% do esperado), sinaliza que pode estar faltando o gerente.
  const estimados = useMemo(() => {
    const impostosReais = custoEstoque?.impostos ?? 0;
    const comissoesReais = custoEstoque?.comissoes ?? 0;
    const despesasReais = custoEstoque?.desp_gerais ?? 0;
    const comissoesEsperadas = (precoSim * estimativas.comissoesPct) / 100;

    const out: {
      label: string;
      pct: number;
      valor: number;
      aplicavel: boolean;
      parcial?: boolean;
    }[] = [];
    out.push({
      label: "Impostos sobre venda",
      pct: estimativas.impostosPct,
      valor: (precoSim * estimativas.impostosPct) / 100,
      aplicavel: impostosReais === 0,
    });
    out.push({
      label: "Comissões (vendedor + gerente)",
      pct: estimativas.comissoesPct,
      valor: comissoesEsperadas,
      aplicavel: comissoesReais === 0,
      parcial: comissoesReais > 0 && comissoesReais < comissoesEsperadas * 0.8,
    });
    out.push({
      label: "Despesas Gerais alocadas",
      pct: estimativas.despesasGeraisPct,
      valor: (precoSim * estimativas.despesasGeraisPct) / 100,
      aplicavel: despesasReais === 0,
    });
    return out;
  }, [precoSim, estimativas, custoEstoque]);

  const totalEstimado = estimados.filter(e => e.aplicavel).reduce((s, e) => s + e.valor, 0);
  const lucroLiquidoEst = lucroBruto - totalEstimado;
  const carroJaVendeu = (custoEstoque?.impostos ?? 0) > 0 || (custoEstoque?.comissoes ?? 0) > 0;
  const algumaComissaoParcial = estimados.some(e => e.parcial);

  // Divergência centavo-perfect entre XLSX (custo_total agregado) e PDF (CustoEstoqueDetalhado).
  // Diferença ≥ R$ 0,01 indica que uma das fontes está desatualizada.
  const divergenciaCusto = custoEstoque != null
    ? Math.abs(custoEstoque.custo_total - custoTotal)
    : 0;
  const temDivergencia = divergenciaCusto >= 0.01;

  return (
    <section className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] shadow-[var(--shadow-sm)]">
      <header className="flex flex-wrap items-center gap-2 border-b border-[var(--border-soft)] px-5 py-3">
        <Calculator className="h-4 w-4 text-[var(--text-muted)]" />
        <h3 className="text-sm font-semibold text-[var(--text-strong)]">Demonstrativo do Lucro</h3>
        <span className="text-xs text-[var(--text-muted)]">— passo a passo de onde sai cada R$</span>
        <button
          type="button"
          onClick={() => setEditandoConfig(!editandoConfig)}
          className="ml-auto inline-flex items-center gap-1 rounded-md border border-[var(--border-soft)] bg-[var(--bg-app)] px-2 py-1 text-[10px] font-medium text-[var(--text-muted)] transition hover:bg-[var(--bg-muted)] hover:text-[var(--text-strong)]"
          title="Ajustar percentuais estimados (impostos, comissões, despesas)"
        >
          <Settings className="h-3 w-3" />
          Ajustar estimativas
        </button>
      </header>

      {editandoConfig && (
        <EditorEstimativas
          atuais={estimativas}
          onSalvar={(novas) => {
            setEstimativas(novas);
            setEditandoConfig(false);
            showSuccessToast("Estimativas atualizadas");
          }}
          onCancelar={() => setEditandoConfig(false)}
        />
      )}

      <div className="space-y-3 p-5">
        {temDivergencia && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
            ⚠️ Custo divergente entre XLSX e PDF de Custos em Estoque ({formatBRLCents(divergenciaCusto)} de diferença).
            Pode ser que uma das fontes está desatualizada — vale reimportar pra atualizar.
          </div>
        )}

        {/* Preço de venda */}
        <div className="flex items-baseline justify-between gap-2 border-b border-[var(--border-soft)] pb-2">
          <span className="text-sm font-semibold text-[var(--text-strong)]">Preço de Venda</span>
          <span className="text-lg font-bold tabular-nums text-[var(--text-strong)]">{formatBRLCents(precoSim)}</span>
        </div>

        {/* Custos e ganhos reais */}
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Custos e ganhos reais (do NBS)
          </p>
          <div className="space-y-1">
            {linhasReais.map((linha) => (
              <LinhaConta
                key={linha.label}
                icon={linha.icon}
                label={linha.label}
                valor={linha.valor}
                sinal={linha.tipo === "custo" ? "-" : "+"}
                tom={linha.tipo === "custo" ? "neutro" : "ganho"}
              />
            ))}
          </div>
        </div>

        {/* Lucro Bruto */}
        <div className={cn(
          "flex items-baseline justify-between gap-2 rounded-lg border-2 px-3 py-2",
          lucroBruto >= 0 ? "border-emerald-300 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/30" : "border-red-300 bg-red-50 dark:border-red-900/60 dark:bg-red-950/30",
        )}>
          <span className="inline-flex items-center gap-1.5 text-sm font-bold uppercase tracking-wider">
            <TrendingUp className={cn("h-3.5 w-3.5", lucroBruto >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400")} />
            <span className={lucroBruto >= 0 ? "text-emerald-800 dark:text-emerald-300" : "text-red-800 dark:text-red-300"}>Lucro Bruto</span>
            <Tooltip content="Lucro Bruto = Preço de Venda − Custo Total NBS. Considera todos os custos REAIS que o NBS já lançou." side="top">
              <span className="text-[var(--text-subtle)] opacity-70 hover:opacity-100" aria-label="Sobre Lucro Bruto">ⓘ</span>
            </Tooltip>
          </span>
          <span className={cn("text-xl font-bold tabular-nums", lucroBruto >= 0 ? "text-emerald-800 dark:text-emerald-300" : "text-red-800 dark:text-red-300")}>
            {formatBRLCents(lucroBruto)}
          </span>
        </div>

        {/* Custos estimados (só se aplicáveis) */}
        {totalEstimado > 0 && (
          <>
            <div>
              <div className="mb-1.5 flex items-center gap-2">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                  Custos estimados (entram quando vender)
                </p>
              </div>
              <div className="space-y-1">
                {estimados.filter(e => e.aplicavel).map((e) => (
                  <LinhaConta
                    key={e.label}
                    icon={<span className="text-[10px] tabular-nums text-[var(--text-subtle)]" style={{ width: 14 }}>({e.pct}%)</span>}
                    label={e.label}
                    valor={e.valor}
                    sinal="-"
                    tom="estimado"
                  />
                ))}
              </div>
            </div>

            {/* Lucro Líquido Estimado */}
            <div className={cn(
              "flex items-baseline justify-between gap-2 rounded-lg border-2 px-3 py-2",
              lucroLiquidoEst >= 0 ? "border-emerald-400 bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/50" : "border-red-400 bg-red-100 dark:border-red-800 dark:bg-red-950/50",
            )}>
              <span className="inline-flex items-center gap-1.5 text-sm font-bold uppercase tracking-wider">
                💰
                <span className={lucroLiquidoEst >= 0 ? "text-emerald-900 dark:text-emerald-200" : "text-red-900 dark:text-red-200"}>Lucro Líquido Estimado</span>
                <Tooltip content="Lucro Líquido Estimado = Lucro Bruto − custos que ainda vão entrar quando o carro vender (impostos sobre venda, comissões, despesas). NÃO inclui IR/CSLL sobre o lucro." side="top">
                  <span className="text-[var(--text-subtle)] opacity-70 hover:opacity-100" aria-label="Sobre Lucro Líquido Estimado">ⓘ</span>
                </Tooltip>
              </span>
              <span className={cn("text-2xl font-bold tabular-nums", lucroLiquidoEst >= 0 ? "text-emerald-900 dark:text-emerald-200" : "text-red-900 dark:text-red-200")}>
                {formatBRLCents(lucroLiquidoEst)}
              </span>
            </div>

            {carroJaVendeu && (
              <p className="text-[11px] italic text-[var(--text-muted)]">
                ℹ️ Esse carro já tem alguns custos reais lançados — o sistema só estimou os que ainda estão zerados.
              </p>
            )}
            {algumaComissaoParcial && (
              <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
                ⚠️ A comissão lançada no NBS parece parcial — talvez só o vendedor entrou e o gerente ainda não. Confira no NBS antes de fechar.
              </p>
            )}
          </>
        )}

        {totalEstimado === 0 && (
          <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
            ✅ Todos os custos reais já estão no NBS — o Lucro Bruto acima já é o lucro real do veículo (antes de IR/CSLL).
          </p>
        )}
      </div>
    </section>
  );
}

function LinhaConta({
  icon,
  label,
  valor,
  sinal,
  tom,
}: {
  icon: React.ReactNode;
  label: string;
  valor: number;
  sinal: "+" | "-";
  tom: "neutro" | "ganho" | "estimado";
}) {
  const valorTom =
    tom === "ganho" ? "text-emerald-700 dark:text-emerald-400 font-medium"
      : tom === "estimado" ? "text-amber-700 dark:text-amber-400"
        : "text-[var(--text-body)]";

  // Sinal efetivo: combina o sinal "convencional" do tipo (custo "-", ganho "+")
  // com o sinal real do valor. Ex: custo negativo (estorno) vira "+" no display.
  const valorAbs = Math.abs(valor);
  const sinalConvencional = sinal === "+" ? 1 : -1;
  const sinalReal = valor >= 0 ? 1 : -1;
  const sinalEfetivo = sinalConvencional * sinalReal >= 0 ? "+" : "−";

  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="inline-flex items-center gap-1.5 text-[var(--text-body)]">
        {icon}
        <span>{label}</span>
      </span>
      <span className={cn("tabular-nums", valorTom)}>
        {sinalEfetivo} {formatBRLCents(valorAbs)}
      </span>
    </div>
  );
}

function EditorEstimativas({
  atuais,
  onSalvar,
  onCancelar,
}: {
  atuais: EstimativasCustos;
  onSalvar: (novas: EstimativasCustos) => void;
  onCancelar: () => void;
}) {
  const [valores, setValores] = useState<EstimativasCustos>(atuais);

  function setCampo(campo: keyof EstimativasCustos, v: string) {
    const limpo = v.replace(",", ".").replace(/[^\d.]/g, "");
    const n = parseFloat(limpo);
    // Clamp [0, 100] — não aceita negativo nem absurdo (% impossível).
    const clamped = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
    setValores({ ...valores, [campo]: clamped });
  }

  const totalEstimadoPct =
    valores.impostosPct + valores.comissoesPct + valores.despesasGeraisPct;
  const totalAlto = totalEstimadoPct > 20;

  return (
    <div className="border-b border-[var(--border-soft)] bg-[var(--bg-muted)]/40 p-4">
      <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        Ajustar percentuais (vale pra todos os carros)
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <CampoPct label="Impostos sobre venda" valor={valores.impostosPct} onChange={(v) => setCampo("impostosPct", v)} />
        <CampoPct label="Comissões (vend + ger)" valor={valores.comissoesPct} onChange={(v) => setCampo("comissoesPct", v)} />
        <CampoPct label="Despesas Gerais" valor={valores.despesasGeraisPct} onChange={(v) => setCampo("despesasGeraisPct", v)} />
      </div>
      <p className="mt-2 text-[10px] text-[var(--text-muted)]">
        Total estimado: <span className={cn("tabular-nums font-semibold", totalAlto && "text-amber-700 dark:text-amber-400")}>{totalEstimadoPct.toFixed(2)}%</span>
        {totalAlto && " · ⚠️ acima do típico de mercado (15–20%)"}
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancelar}
          className="rounded-md border border-[var(--border-soft)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs text-[var(--text-body)] hover:bg-[var(--bg-muted)]"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={() => onSalvar(valores)}
          className="rounded-md bg-[var(--brand-700)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--brand-800)]"
        >
          Salvar
        </button>
      </div>
    </div>
  );
}

function CampoPct({
  label,
  valor,
  onChange,
}: {
  label: string;
  valor: number;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{label}</span>
      <div className="mt-1 flex items-center rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] focus-within:border-[var(--brand-500)]">
        <input
          type="text"
          inputMode="decimal"
          value={String(valor).replace(".", ",")}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-transparent px-2 py-1.5 text-sm tabular-nums outline-none"
        />
        <span className="pr-2 text-xs text-[var(--text-muted)]">%</span>
      </div>
    </label>
  );
}
