"use client";

/**
 * Demonstrativo do Lucro — decompõe linha a linha de onde sai o lucro.
 *
 * Usa SOMENTE valores reais que vêm do NBS — sem estimativas, sem percentuais
 * fictícios. Atualiza automaticamente toda vez que o usuário importa novos
 * relatórios.
 *
 * Mostra:
 *   1. Preço de venda
 *   2. Linhas reais do NBS (custos + ganhos da fábrica) — só as ≠ 0
 *   3. LUCRO BRUTO (= preço − custo total NBS)
 *   4. Quando carro ainda não vendeu: aviso informativo de que custos como
 *      impostos e comissões vão entrar quando vender no NBS — não estimamos.
 *   5. Timestamp da última importação pro usuário saber quando foi atualizado.
 */

import { useMemo } from "react";
import { Calculator, ShoppingCart, Wrench, Banknote, Gift, Package, Briefcase, Landmark, UserSquare2, FileText, Star, AlertTriangle, TrendingUp, RefreshCw } from "lucide-react";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";
import type { CustoEstoqueDetalhado } from "@/lib/parsers/nbs-custos-estoque-pdf";
import { useInventory } from "@/lib/store/inventory";
import { normalizarPlaca } from "@/lib/utils/placa";
import { cn, formatBRLCents } from "@/lib/utils";
import { Tooltip } from "@/components/ui/Tooltip";

export function DemonstrativoLucro({
  veiculo,
  precoSim,
}: {
  veiculo: VeiculoParsed;
  precoSim: number | null;
}) {
  const { custosEstoquePorPlaca, custosEstoqueMeta } = useInventory();
  const custoEstoque = veiculo.placa
    ? custosEstoquePorPlaca[normalizarPlaca(veiculo.placa)] ?? null
    : null;

  // Sem custo total ou sem preço → não dá pra demonstrar.
  if (veiculo.custo_total == null || precoSim == null || precoSim <= 0) return null;

  return (
    <DemonstrativoView
      veiculo={veiculo}
      precoSim={precoSim}
      custoEstoque={custoEstoque}
      ultimaImportacao={custosEstoqueMeta?.data_impressao ?? null}
    />
  );
}

function DemonstrativoView({
  veiculo,
  precoSim,
  custoEstoque,
  ultimaImportacao,
}: {
  veiculo: VeiculoParsed;
  precoSim: number;
  custoEstoque: CustoEstoqueDetalhado | null;
  ultimaImportacao: Date | null;
}) {
  // Linhas REAIS do NBS — mostra qualquer valor ≠ 0 (inclusive negativos).
  const linhasReais = useMemo(() => {
    if (!custoEstoque) {
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

  const custoTotal = veiculo.custo_total ?? 0;
  const lucroBruto = precoSim - custoTotal;
  const margemPct = precoSim > 0 ? (lucroBruto / precoSim) * 100 : 0;

  // Divergência centavo-perfect entre XLSX e PDF — alerta se ≥ R$ 0,01.
  const divergenciaCusto = custoEstoque != null
    ? Math.abs(custoEstoque.custo_total - custoTotal)
    : 0;
  const temDivergencia = divergenciaCusto >= 0.01;

  // Carro ainda em estoque (não vendeu): impostos + comissões zerados.
  // Sinaliza ao usuário que esses valores virão SÓ quando o NBS registrar a venda.
  const semImpostos = custoEstoque ? custoEstoque.impostos === 0 : false;
  const semComissoes = custoEstoque ? custoEstoque.comissoes === 0 : false;
  const podeAumentarCustosNaVenda = semImpostos || semComissoes;

  return (
    <section className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] shadow-[var(--shadow-sm)]">
      <header className="flex flex-wrap items-center gap-2 border-b border-[var(--border-soft)] px-5 py-3">
        <Calculator className="h-4 w-4 text-[var(--text-muted)]" />
        <h3 className="text-sm font-semibold text-[var(--text-strong)]">Demonstrativo do Lucro</h3>
        <span className="text-xs text-[var(--text-muted)]">— só valores reais do NBS</span>
        {ultimaImportacao && (
          <span
            className="ml-auto inline-flex items-center gap-1 text-[10px] text-[var(--text-muted)]"
            title={`Atualize importando um relatório mais recente em /upload`}
          >
            <RefreshCw className="h-3 w-3" />
            Atualizado em {ultimaImportacao.toLocaleDateString("pt-BR")}
          </span>
        )}
      </header>

      <div className="space-y-3 p-5">
        {temDivergencia && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
            ⚠️ Custo divergente entre XLSX e PDF de Custos em Estoque ({formatBRLCents(divergenciaCusto)} de diferença).
            Vale reimportar pra alinhar.
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

        {/* Lucro Bruto — único KPI calculado, em cima de valores reais */}
        <div className={cn(
          "flex items-baseline justify-between gap-2 rounded-lg border-2 px-3 py-2",
          lucroBruto >= 0 ? "border-emerald-400 bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/50" : "border-red-400 bg-red-100 dark:border-red-800 dark:bg-red-950/50",
        )}>
          <span className="inline-flex items-center gap-1.5 text-sm font-bold uppercase tracking-wider">
            <TrendingUp className={cn("h-3.5 w-3.5", lucroBruto >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400")} />
            <span className={lucroBruto >= 0 ? "text-emerald-900 dark:text-emerald-200" : "text-red-900 dark:text-red-200"}>Lucro Bruto</span>
            <Tooltip content="Lucro Bruto = Preço de Venda − Custo Total NBS. Usa só os valores REAIS lançados no NBS." side="top">
              <span className="text-[var(--text-subtle)] opacity-70 hover:opacity-100" aria-label="Sobre Lucro Bruto">ⓘ</span>
            </Tooltip>
          </span>
          <div className="text-right">
            <p className={cn("text-2xl font-bold tabular-nums", lucroBruto >= 0 ? "text-emerald-900 dark:text-emerald-200" : "text-red-900 dark:text-red-200")}>
              {formatBRLCents(lucroBruto)}
            </p>
            <p className={cn("text-xs tabular-nums", lucroBruto >= 0 ? "text-emerald-800 dark:text-emerald-300" : "text-red-800 dark:text-red-300")}>
              {margemPct >= 0 ? "+" : ""}{margemPct.toFixed(2)}% sobre venda
            </p>
          </div>
        </div>

        {/* Aviso pra carros ainda em estoque: alguns custos só entram na venda */}
        {podeAumentarCustosNaVenda && (
          <div className="rounded-md border border-[var(--border-soft)] bg-[var(--bg-muted)]/40 px-3 py-2 text-[11px] text-[var(--text-body)]">
            <p className="inline-flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
              <span className="font-medium text-[var(--text-strong)]">Esse carro ainda não fechou venda no NBS.</span>
            </p>
            <p className="mt-1 text-[var(--text-muted)]">
              {semImpostos && semComissoes && "Impostos e Comissões ainda não foram lançados — "}
              {semImpostos && !semComissoes && "Impostos ainda não foram lançados — "}
              {!semImpostos && semComissoes && "Comissões ainda não foram lançadas — "}
              quando a venda for registrada no NBS, esses valores entram e o Lucro Bruto vai cair. Importe um novo relatório depois pra ver o número real.
            </p>
          </div>
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
  tom: "neutro" | "ganho";
}) {
  const valorTom =
    tom === "ganho" ? "text-emerald-700 dark:text-emerald-400 font-medium"
      : "text-[var(--text-body)]";

  // Sinal efetivo: combina o sinal "convencional" do tipo com o sinal real
  // do valor (cobre estornos e devoluções que aparecem como negativos no NBS).
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
