"use client";

/**
 * Demonstrativo do Lucro — decompõe linha a linha de onde sai o lucro.
 *
 * Usa SOMENTE valores reais que vêm do NBS — sem estimativas, sem percentuais
 * fictícios. Atualiza automaticamente toda vez que o usuário importa novos
 * relatórios OU mexe no preço do Simulador (via store global).
 *
 * Estrutura:
 *   1. Preço de venda
 *   2. LUCRO BRUTO = Preço − Aquisição (nota fábrica) — margem crua na venda
 *   3. Gastos operacionais do carro (Floor Plan, ADM, Despesas, etc.) — só ≠ 0
 *   4. Ganhos da fábrica (HoldBack, Bônus, Ganhos Indiretos) — só ≠ 0
 *   5. LUCRO LÍQUIDO = Lucro Bruto − gastos + ganhos = Preço − Custo Total NBS
 *   6. Aviso se carro ainda não fechou venda (impostos/comissões zerados)
 *   7. Timestamp da última importação
 */

import { useMemo } from "react";
import { Calculator, Wrench, Banknote, Gift, Package, Briefcase, Landmark, UserSquare2, FileText, Star, AlertTriangle, TrendingUp, RefreshCw } from "lucide-react";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";
import type { CustoEstoqueDetalhado } from "@/lib/parsers/nbs-custos-estoque-pdf";
import { useInventory } from "@/lib/store/inventory";
import { usePrecoSimulado } from "@/lib/store/simulador-preco";
import { normalizarPlaca } from "@/lib/utils/placa";
import { cn, formatBRLCents } from "@/lib/utils";
import { Tooltip } from "@/components/ui/Tooltip";

export function DemonstrativoLucro({ veiculo }: { veiculo: VeiculoParsed }) {
  const { custosEstoquePorPlaca, custosEstoqueMeta } = useInventory();
  const custoEstoque = veiculo.placa
    ? custosEstoquePorPlaca[normalizarPlaca(veiculo.placa)] ?? null
    : null;

  // Preço efetivo: simulação em curso (se Simulador mexeu) ou preço do NBS.
  const precoSimulado = usePrecoSimulado(veiculo.chassi);
  const precoEfetivo = precoSimulado ?? veiculo.preco_venda;

  // Sem custo total ou sem preço → não dá pra demonstrar.
  if (veiculo.custo_total == null || precoEfetivo == null || precoEfetivo <= 0) return null;

  return (
    <DemonstrativoView
      veiculo={veiculo}
      precoEfetivo={precoEfetivo}
      precoSendoSimulado={precoSimulado != null && precoSimulado !== veiculo.preco_venda}
      custoEstoque={custoEstoque}
      ultimaImportacao={custosEstoqueMeta?.data_impressao ?? null}
    />
  );
}

function DemonstrativoView({
  veiculo,
  precoEfetivo,
  precoSendoSimulado,
  custoEstoque,
  ultimaImportacao,
}: {
  veiculo: VeiculoParsed;
  precoEfetivo: number;
  precoSendoSimulado: boolean;
  custoEstoque: CustoEstoqueDetalhado | null;
  ultimaImportacao: Date | null;
}) {
  // Aquisição: prefere o valor do PDF de custos (detalhado), fallback pro XLSX.
  const aquisicao = custoEstoque?.nota_fabrica ?? veiculo.valor_aquisicao ?? 0;
  const custoTotal = veiculo.custo_total ?? 0;

  // GASTOS OPERACIONAIS (não-aquisição, não-ganhos) — só ≠ 0.
  const gastosOperacionais = useMemo(() => {
    if (!custoEstoque) return [];
    const out: { label: string; icon: React.ReactNode; valor: number }[] = [];
    if (custoEstoque.revisoes !== 0) out.push({ label: "Revisões", icon: <Wrench className="h-3.5 w-3.5" />, valor: custoEstoque.revisoes });
    if (custoEstoque.forplan !== 0) out.push({ label: "Floor Plan", icon: <Banknote className="h-3.5 w-3.5" />, valor: custoEstoque.forplan });
    if (custoEstoque.acessorios !== 0) out.push({ label: "Acessórios", icon: <Package className="h-3.5 w-3.5" />, valor: custoEstoque.acessorios });
    if (custoEstoque.adm !== 0) out.push({ label: "ADM", icon: <Briefcase className="h-3.5 w-3.5" />, valor: custoEstoque.adm });
    if (custoEstoque.impostos !== 0) out.push({ label: "Impostos", icon: <Landmark className="h-3.5 w-3.5" />, valor: custoEstoque.impostos });
    if (custoEstoque.comissoes !== 0) out.push({ label: "Comissões", icon: <UserSquare2 className="h-3.5 w-3.5" />, valor: custoEstoque.comissoes });
    if (custoEstoque.desp_gerais !== 0) out.push({ label: "Despesas Gerais", icon: <FileText className="h-3.5 w-3.5" />, valor: custoEstoque.desp_gerais });
    return out;
  }, [custoEstoque]);

  // GANHOS DA FÁBRICA (abatimentos) — só ≠ 0.
  const ganhosFabrica = useMemo(() => {
    if (!custoEstoque) return [];
    const out: { label: string; icon: React.ReactNode; valor: number }[] = [];
    if (custoEstoque.holdback !== 0) out.push({ label: "HoldBack", icon: <Gift className="h-3.5 w-3.5" />, valor: custoEstoque.holdback });
    if (custoEstoque.bonus !== 0) out.push({ label: "Bônus de Fábrica", icon: <Star className="h-3.5 w-3.5" />, valor: custoEstoque.bonus });
    if (custoEstoque.ganhos_indiretos !== 0) out.push({ label: "Ganhos Indiretos", icon: <Gift className="h-3.5 w-3.5" />, valor: custoEstoque.ganhos_indiretos });
    return out;
  }, [custoEstoque]);

  // LUCRO BRUTO = Preço − Aquisição (margem crua, antes dos custos operacionais)
  const lucroBruto = precoEfetivo - aquisicao;
  const margemBrutaPct = precoEfetivo > 0 ? (lucroBruto / precoEfetivo) * 100 : 0;

  // LUCRO LÍQUIDO = Preço − Custo Total NBS (depois dos gastos e ganhos)
  const lucroLiquido = precoEfetivo - custoTotal;
  const margemLiquidaPct = precoEfetivo > 0 ? (lucroLiquido / precoEfetivo) * 100 : 0;

  // Divergência centavo-perfect entre XLSX e PDF — alerta se ≥ R$ 0,01.
  const divergenciaCusto = custoEstoque != null
    ? Math.abs(custoEstoque.custo_total - custoTotal)
    : 0;
  const temDivergencia = divergenciaCusto >= 0.01;

  // Carro ainda em estoque (não vendeu): impostos + comissões zerados.
  const semImpostos = custoEstoque ? custoEstoque.impostos === 0 : false;
  const semComissoes = custoEstoque ? custoEstoque.comissoes === 0 : false;
  const podeAumentarCustosNaVenda = semImpostos || semComissoes;

  return (
    <section className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] shadow-[var(--shadow-sm)]">
      <header className="flex flex-wrap items-center gap-2 border-b border-[var(--border-soft)] px-5 py-3">
        <Calculator className="h-4 w-4 text-[var(--text-muted)]" />
        <h3 className="text-sm font-semibold text-[var(--text-strong)]">Demonstrativo do Lucro</h3>
        <span className="text-xs text-[var(--text-muted)]">— só valores reais do NBS</span>
        {precoSendoSimulado && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--brand-100)] px-2 py-0.5 text-[10px] font-semibold text-[var(--brand-800)] dark:bg-[var(--brand-900)]/40 dark:text-[var(--brand-300)]">
            🧮 simulação ativa
          </span>
        )}
        {ultimaImportacao && (
          <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-[var(--text-muted)]" title="Atualize importando um relatório mais recente em /upload">
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

        {/* Preço de Venda */}
        <div className="flex items-baseline justify-between gap-2 border-b border-[var(--border-soft)] pb-2">
          <span className="text-sm font-semibold text-[var(--text-strong)]">Preço de Venda</span>
          <span className="text-lg font-bold tabular-nums text-[var(--text-strong)]">{formatBRLCents(precoEfetivo)}</span>
        </div>

        {/* Aquisição (única linha, sempre presente) */}
        <LinhaConta
          icon={<span className="text-sm">🛒</span>}
          label="Aquisição (Nota Fábrica)"
          valor={aquisicao}
          sinal="-"
          tom="neutro"
        />

        {/* LUCRO BRUTO — preço − aquisição */}
        <KpiLucro
          titulo="Lucro Bruto"
          subtitulo="Preço de Venda − Aquisição"
          valor={lucroBruto}
          margemPct={margemBrutaPct}
          tooltip="Lucro Bruto = Preço de Venda − Aquisição (Nota Fábrica). Mostra a margem 'crua' antes de descontar gastos operacionais do carro."
          destaque="medio"
        />

        {/* Gastos operacionais */}
        {gastosOperacionais.length > 0 && (
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Gastos operacionais do carro
            </p>
            <div className="space-y-1">
              {gastosOperacionais.map((linha) => (
                <LinhaConta
                  key={linha.label}
                  icon={linha.icon}
                  label={linha.label}
                  valor={linha.valor}
                  sinal="-"
                  tom="neutro"
                />
              ))}
            </div>
          </div>
        )}

        {/* Ganhos da fábrica */}
        {ganhosFabrica.length > 0 && (
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
              Ganhos da fábrica (abatem o custo)
            </p>
            <div className="space-y-1">
              {ganhosFabrica.map((linha) => (
                <LinhaConta
                  key={linha.label}
                  icon={linha.icon}
                  label={linha.label}
                  valor={linha.valor}
                  sinal="+"
                  tom="ganho"
                />
              ))}
            </div>
          </div>
        )}

        {/* LUCRO LÍQUIDO — preço − custo total */}
        <KpiLucro
          titulo="Lucro Líquido"
          subtitulo="Lucro Bruto − gastos + ganhos da fábrica"
          valor={lucroLiquido}
          margemPct={margemLiquidaPct}
          tooltip="Lucro Líquido = Preço de Venda − Custo Total NBS. Considera todos os custos REAIS lançados (Floor Plan, ADM, Impostos, Comissões, Despesas) e abatimentos (HoldBack, Bônus, Ganhos Indiretos). NÃO inclui IR/CSLL sobre o lucro."
          destaque="forte"
        />

        {/* Aviso pra carros ainda em estoque */}
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
              quando a venda for registrada no NBS, esses valores entram e o Lucro Líquido vai cair. Importe um novo relatório depois pra ver o número real.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function KpiLucro({
  titulo,
  subtitulo,
  valor,
  margemPct,
  tooltip,
  destaque,
}: {
  titulo: string;
  subtitulo: string;
  valor: number;
  margemPct: number;
  tooltip: string;
  destaque: "medio" | "forte";
}) {
  const positivo = valor >= 0;
  const borda = destaque === "forte"
    ? (positivo ? "border-emerald-400 bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/50" : "border-red-400 bg-red-100 dark:border-red-800 dark:bg-red-950/50")
    : (positivo ? "border-emerald-300 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/30" : "border-red-300 bg-red-50 dark:border-red-900/60 dark:bg-red-950/30");
  const corTitulo = positivo ? "text-emerald-900 dark:text-emerald-200" : "text-red-900 dark:text-red-200";
  const corValor = destaque === "forte"
    ? (positivo ? "text-emerald-900 dark:text-emerald-200" : "text-red-900 dark:text-red-200")
    : (positivo ? "text-emerald-800 dark:text-emerald-300" : "text-red-800 dark:text-red-300");
  const tamValor = destaque === "forte" ? "text-2xl" : "text-xl";

  return (
    <div className={cn("flex items-baseline justify-between gap-2 rounded-lg border-2 px-3 py-2", borda)}>
      <span className="inline-flex flex-col gap-0.5">
        <span className="inline-flex items-center gap-1.5 text-sm font-bold uppercase tracking-wider">
          <TrendingUp className={cn("h-3.5 w-3.5", positivo ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400")} />
          <span className={corTitulo}>{titulo}</span>
          <Tooltip content={tooltip} side="top">
            <span className="text-[var(--text-subtle)] opacity-70 hover:opacity-100" aria-label={`Sobre ${titulo}`}>ⓘ</span>
          </Tooltip>
        </span>
        <span className="text-[10px] normal-case tracking-normal text-[var(--text-muted)]">{subtitulo}</span>
      </span>
      <div className="text-right">
        <p className={cn("font-bold tabular-nums", tamValor, corValor)}>{formatBRLCents(valor)}</p>
        <p className={cn("text-xs tabular-nums", corValor)}>
          {margemPct >= 0 ? "+" : ""}{margemPct.toFixed(2)}% sobre venda
        </p>
      </div>
    </div>
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

  // Sinal efetivo: combina sinal convencional com sinal real (estornos, devoluções).
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
