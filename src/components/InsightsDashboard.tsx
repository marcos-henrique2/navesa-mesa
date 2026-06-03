"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  TrendingUp,
  Clock,
  Building2,
  Tag,
  UserSquare2,
  Repeat,
  Users,
  Package,
  Award,
  Flame,
} from "lucide-react";
import { useInventory } from "@/lib/store/inventory";
import {
  sumarioGlobal,
  margemPorLoja,
  margemPorMarca,
  giroVsMargem,
  margemPorModelo,
  trocasVsSem,
  margemPorVendedor,
  outliers,
  estoqueEmRisco,
  clientesRecorrentes,
  distribuicaoClasses,
} from "@/lib/analytics/insights";
import { CLASSE_COR, CLASSE_DESC } from "@/lib/pricing/classificacao";
import { formatBRL, formatInt, cn } from "@/lib/utils";

export function InsightsDashboard() {
  const { vendas, veiculos, custosPorPlaca, isHydrated } = useInventory();

  const dados = useMemo(() => {
    if (vendas.length === 0) return null;
    return {
      sumario: sumarioGlobal(vendas, custosPorPlaca),
      lojas: margemPorLoja(vendas, custosPorPlaca),
      marcas: margemPorMarca(vendas, custosPorPlaca).filter((m) => m.qt >= 5).slice(0, 12),
      giro: giroVsMargem(vendas, custosPorPlaca),
      modelosPiores: margemPorModelo(vendas, custosPorPlaca, { minVendas: 3 }).slice(0, 10),
      trocas: trocasVsSem(vendas, custosPorPlaca),
      vendedoresPiores: margemPorVendedor(vendas, custosPorPlaca, { minVendas: 5 })
        .slice()
        .reverse()
        .slice(0, 10),
      vendedoresTop: margemPorVendedor(vendas, custosPorPlaca, { minVendas: 5 }).slice(0, 10),
      outliersLucro: outliers(vendas, custosPorPlaca, { top: 5, modo: "lucro" }),
      outliersPrejuizo: outliers(vendas, custosPorPlaca, { top: 5, modo: "prejuizo" }),
      estoque: veiculos.length > 0 ? estoqueEmRisco(veiculos, vendas, custosPorPlaca, { topPiores: 15 }) : null,
      clientes: clientesRecorrentes(vendas, custosPorPlaca, { minCompras: 3 }).slice(0, 10),
      classificacao: veiculos.length > 0 ? distribuicaoClasses(veiculos) : null,
    };
  }, [vendas, veiculos, custosPorPlaca]);

  if (!isHydrated) return <div className="p-6 text-sm text-[var(--text-muted)]">Carregando…</div>;
  if (!dados) {
    return (
      <div className="mx-auto max-w-2xl rounded-2xl border border-dashed border-[var(--border-base)] bg-[var(--bg-surface)] p-12 text-center shadow-[var(--shadow-sm)]">
        <h2 className="text-xl font-bold text-[var(--text-strong)]">Sem dados de vendas</h2>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          Faça upload do relatório de vendas e custos em{" "}
          <Link href="/upload" className="text-[var(--brand-700)] underline">
            /upload
          </Link>{" "}
          pra ver os insights.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* 1. Risco crítico — dependência de Ganhos Indiretos */}
      <SectionCriticidade sumario={dados.sumario} />

      {/* 2. Ranking de lojas */}
      <Section title="Margem por loja" icon={<Building2 className="h-4 w-4" />}>
        <TabelaLojas dados={dados.lojas} />
      </Section>

      {/* 3. Giro vs margem */}
      <Section title="Giro × Margem — quanto mais parado, pior" icon={<Clock className="h-4 w-4" />}>
        <TabelaGiro dados={dados.giro} />
      </Section>

      {/* 4. Estoque em risco */}
      {dados.estoque && (
        <Section title="Estoque atual em risco" icon={<Package className="h-4 w-4" />}>
          <EstoqueRiscoCard dados={dados.estoque} />
        </Section>
      )}

      {/* 4b. Classificação Auto Avaliar */}
      {dados.classificacao && (
        <Section title="Classificação Auto Avaliar (Show Room × Repasse)" icon={<Award className="h-4 w-4" />}>
          <ClassificacaoCard dados={dados.classificacao} />
        </Section>
      )}

      {/* 5. Margem por marca */}
      <Section title="Margem por marca" icon={<Tag className="h-4 w-4" />}>
        <TabelaMarcas dados={dados.marcas} />
      </Section>

      {/* 6. Modelos tóxicos */}
      <Section title="Modelos com pior margem (≥3 vendas)" icon={<Flame className="h-4 w-4" />}>
        <TabelaModelos dados={dados.modelosPiores} />
      </Section>

      {/* 7. Trocas */}
      <Section title="Com troca × Sem troca" icon={<Repeat className="h-4 w-4" />}>
        <TrocasCard dados={dados.trocas} />
      </Section>

      {/* 8. Vendedores */}
      <Section title="Vendedores (≥5 vendas)" icon={<UserSquare2 className="h-4 w-4" />}>
        <div className="grid gap-4 lg:grid-cols-2">
          <TabelaVendedores dados={dados.vendedoresTop} titulo="🏆 Top 10 por margem" highlight="positivo" />
          <TabelaVendedores dados={dados.vendedoresPiores} titulo="🔴 10 piores por margem" highlight="negativo" />
        </div>
      </Section>

      {/* 9. Outliers */}
      <Section title="Outliers — vendas extremas" icon={<Award className="h-4 w-4" />}>
        <div className="grid gap-4 lg:grid-cols-2">
          <TabelaOutliers dados={dados.outliersLucro} titulo="🟢 Top 5 maior lucro" cor="emerald" />
          <TabelaOutliers dados={dados.outliersPrejuizo} titulo="🔴 Top 5 maior prejuízo" cor="red" />
        </div>
      </Section>

      {/* 10. Clientes recorrentes */}
      <Section title="Clientes recorrentes (≥3 compras)" icon={<Users className="h-4 w-4" />}>
        <TabelaClientes dados={dados.clientes} />
      </Section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SUBCOMPONENTES
// ─────────────────────────────────────────────────────────────────────────────

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-[var(--text-strong)]">
        <span className="text-[var(--brand-700)]">{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function SectionCriticidade({ sumario }: { sumario: ReturnType<typeof sumarioGlobal> }) {
  const positivaSemBonus = sumario.margemSemBonus >= 0;
  return (
    <section
      className={cn(
        "rounded-xl border-2 p-5 shadow-[var(--shadow-md)]",
        sumario.dependeDeBonus
          ? "border-red-300 bg-red-50 dark:border-red-900/70 dark:bg-red-950/30"
          : "border-emerald-300 bg-emerald-50 dark:border-emerald-900/70 dark:bg-emerald-950/30",
      )}
    >
      <div className="flex items-start gap-3">
        {sumario.dependeDeBonus ? (
          <AlertTriangle className="h-6 w-6 shrink-0 text-red-600 dark:text-red-400" />
        ) : (
          <TrendingUp className="h-6 w-6 shrink-0 text-emerald-600 dark:text-emerald-400" />
        )}
        <div className="flex-1">
          <h2 className="text-lg font-bold text-[var(--text-strong)]">
            {sumario.dependeDeBonus
              ? "⚠️ A operação depende dos bônus de fábrica"
              : "✓ Operação positiva mesmo sem bônus"}
          </h2>
          <p className="mt-1 text-sm text-[var(--text-body)]">
            Margem atual: <strong>{formatBRL(sumario.margem)}</strong> ({sumario.margemPct.toFixed(2)}%).
            {sumario.dependeDeBonus && (
              <>
                {" "}
                Sem os <strong>{formatBRL(sumario.ganhosIndiretos)}</strong> de Ganhos Indiretos (bônus + valorização), a operação estaria com{" "}
                <strong className={positivaSemBonus ? "text-emerald-700" : "text-red-700"}>
                  {formatBRL(sumario.margemSemBonus)}
                </strong>.
              </>
            )}
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <Kpi label="Faturamento" value={formatBRL(sumario.faturamento)} sub={`${formatInt(sumario.qt)} vendas`} />
            <Kpi label="Custo total" value={formatBRL(sumario.custo)} sub="oficial NBS" />
            <Kpi label="Margem REAL" value={formatBRL(sumario.margem)} tone={sumario.margem >= 0 ? "good" : "bad"} />
            <Kpi label="Margem SEM bônus" value={formatBRL(sumario.margemSemBonus)} tone={positivaSemBonus ? "good" : "bad"} />
          </div>
        </div>
      </div>
    </section>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "bad";
}) {
  const color =
    tone === "good"
      ? "text-emerald-700 dark:text-emerald-400"
      : tone === "bad"
        ? "text-red-700 dark:text-red-400"
        : "text-[var(--text-strong)]";
  return (
    <div className="rounded-lg bg-[var(--bg-surface)] p-3 shadow-[var(--shadow-sm)]">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{label}</p>
      <p className={cn("mt-1 text-base font-bold tabular-nums", color)}>{value}</p>
      {sub && <p className="text-[10px] text-[var(--text-muted)]">{sub}</p>}
    </div>
  );
}

function TabelaLojas({ dados }: { dados: ReturnType<typeof margemPorLoja> }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] shadow-[var(--shadow-sm)]">
      <table className="w-full text-sm">
        <thead className="bg-[var(--bg-muted)] text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          <tr>
            <th className="px-4 py-2">Loja</th>
            <th className="px-4 py-2 text-right">Vendas</th>
            <th className="px-4 py-2 text-right">Faturamento</th>
            <th className="px-4 py-2 text-right">Margem</th>
            <th className="px-4 py-2 text-right">Mg%</th>
            <th className="px-4 py-2 text-right">Bônus</th>
            <th className="px-4 py-2 text-right">Giro</th>
          </tr>
        </thead>
        <tbody>
          {dados.map((r) => {
            const neg = r.margem < 0;
            return (
              <tr key={r.loja} className="border-t border-[var(--border-soft)] hover:bg-[var(--bg-muted)]">
                <td className="px-4 py-2 font-medium text-[var(--text-strong)]">{r.loja}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatInt(r.qt)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-[var(--text-body)]">{formatBRL(r.faturamento)}</td>
                <td className={cn("px-4 py-2 text-right tabular-nums font-semibold", neg ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400")}>
                  {formatBRL(r.margem)}
                </td>
                <td className={cn("px-4 py-2 text-right tabular-nums", neg ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400")}>
                  {r.margemPct.toFixed(2)}%
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-[var(--text-muted)]">{formatBRL(r.ganhosIndiretos)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-[var(--text-muted)]">{r.giroMedio.toFixed(0)}d</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TabelaGiro({ dados }: { dados: ReturnType<typeof giroVsMargem> }) {
  const max = Math.max(...dados.map((d) => Math.abs(d.margem)), 1);
  return (
    <div className="space-y-2 rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-4 shadow-[var(--shadow-sm)]">
      {dados.map((b) => {
        const pos = b.margem >= 0;
        const w = (Math.abs(b.margem) / max) * 100;
        return (
          <div key={b.faixa} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-[var(--text-body)]">{b.faixa}</span>
              <span className="text-xs text-[var(--text-muted)]">
                {formatInt(b.qt)} vendas · Mg/un{" "}
                <span className={pos ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}>{formatBRL(b.margemPorUnidade)}</span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative h-2.5 flex-1 overflow-hidden rounded bg-[var(--bg-muted)]">
                <div
                  className={cn("absolute h-full rounded", pos ? "left-0 bg-emerald-500" : "left-0 bg-red-500")}
                  style={{ width: `${w}%` }}
                />
              </div>
              <span
                className={cn(
                  "w-32 shrink-0 text-right text-xs tabular-nums font-semibold",
                  pos ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400",
                )}
              >
                {formatBRL(b.margem)} ({b.margemPct.toFixed(1)}%)
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EstoqueRiscoCard({ dados }: { dados: ReturnType<typeof estoqueEmRisco> }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi
          label="🟢 Modelos rentáveis no estoque"
          value={`${formatInt(dados.qtSeguro)} carros`}
          sub={`${formatBRL(dados.valorSeguro)} em custo`}
          tone="good"
        />
        <Kpi
          label="🔴 Modelos com histórico negativo"
          value={`${formatInt(dados.qtEmRisco)} carros`}
          sub={`${formatBRL(dados.valorEmRisco)} em custo`}
          tone="bad"
        />
        <Kpi
          label="❓ Sem histórico no período"
          value={`${formatInt(dados.semHistorico)} carros`}
          sub="modelos novos no estoque"
        />
      </div>
      {dados.itens.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] shadow-[var(--shadow-sm)]">
          <table className="w-full text-sm">
            <thead className="bg-red-50 text-left text-xs font-semibold uppercase tracking-wider text-red-700 dark:bg-red-950/30 dark:text-red-300">
              <tr>
                <th className="px-4 py-2">Modelo</th>
                <th className="px-4 py-2">Placa</th>
                <th className="px-4 py-2 text-right">Preço pedido</th>
                <th className="px-4 py-2 text-right">Margem hist. média</th>
                <th className="px-4 py-2 text-right">N vendas hist.</th>
                <th className="px-4 py-2 text-right">Dias parado</th>
              </tr>
            </thead>
            <tbody>
              {dados.itens.map((i, idx) => (
                <tr key={`${i.placa}-${idx}`} className="border-t border-[var(--border-soft)] hover:bg-[var(--bg-muted)]">
                  <td className="px-4 py-2 text-xs">{i.modelo}</td>
                  <td className="px-4 py-2 font-mono text-xs">{i.placa}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatBRL(i.preco)}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold text-red-700 dark:text-red-400">
                    {formatBRL(i.margemHistoricaMedia)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-[var(--text-muted)]">{i.vendasHistoricas}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-[var(--text-muted)]">
                    {i.diasNoPatio != null ? `${i.diasNoPatio}d` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ClassificacaoCard({ dados }: { dados: ReturnType<typeof distribuicaoClasses> }) {
  const total = dados.classes.reduce((s, c) => s + c.qt, 0);
  if (total === 0) return null;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Kpi
          label="🛍️ Show Room (vende direto)"
          value={`${formatInt(dados.totalShowroom.qt)} carros`}
          sub={`${formatBRL(dados.totalShowroom.valor)} em custo`}
          tone="good"
        />
        <Kpi
          label="🤝 Repasse (Auto Avaliar)"
          value={`${formatInt(dados.totalRepasse.qt)} carros`}
          sub={`${formatBRL(dados.totalRepasse.valor)} em custo`}
        />
      </div>
      <div className="grid gap-2 md:grid-cols-5">
        {dados.classes.map((c) => {
          const cor = CLASSE_COR[c.classe];
          const pct = total > 0 ? (c.qt / total) * 100 : 0;
          return (
            <div key={c.classe} className={cn("rounded-lg border p-3 shadow-[var(--shadow-sm)]", cor.border, cor.bg.replace("bg-", "bg-").replace("100", "50"))}>
              <div className="flex items-center gap-2">
                <div className={cn("flex h-7 w-7 items-center justify-center rounded text-sm font-black", cor.bg, cor.text)}>
                  {c.classe}
                </div>
                <p className="text-[10px] text-[var(--text-body)]">{CLASSE_DESC[c.classe]}</p>
              </div>
              <p className="mt-2 text-xl font-bold tabular-nums text-[var(--text-strong)]">{formatInt(c.qt)}</p>
              <p className="text-[10px] text-[var(--text-muted)]">{pct.toFixed(1)}% · {formatBRL(c.valor)}</p>
            </div>
          );
        })}
      </div>
      {dados.rebaixadosPorEstoque > 0 && (
        <p className="text-xs text-[var(--text-body)]">
          ⚠️ <strong>{formatInt(dados.rebaixadosPorEstoque)} carros</strong> seriam Show Room pela política, mas viraram Repasse por estarem parados +30 dias ou ter ≥5 iguais no estoque.
        </p>
      )}
      <p className="text-[10px] text-[var(--text-muted)]">
        Classificação automática com base em idade, KM/ano, dias de pátio e repetição. Avarias, sinistro, modificações documentais e histórico de táxi precisam ser validados manualmente pelo avaliador.
      </p>
    </div>
  );
}

function TabelaMarcas({ dados }: { dados: ReturnType<typeof margemPorMarca> }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] shadow-[var(--shadow-sm)]">
      <table className="w-full text-sm">
        <thead className="bg-[var(--bg-muted)] text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          <tr>
            <th className="px-4 py-2">Marca</th>
            <th className="px-4 py-2 text-right">Vendas</th>
            <th className="px-4 py-2 text-right">Faturamento</th>
            <th className="px-4 py-2 text-right">Margem</th>
            <th className="px-4 py-2 text-right">Mg%</th>
            <th className="px-4 py-2 text-right">Bônus</th>
          </tr>
        </thead>
        <tbody>
          {dados.map((r) => {
            const neg = r.margem < 0;
            return (
              <tr key={r.marca} className="border-t border-[var(--border-soft)] hover:bg-[var(--bg-muted)]">
                <td className="px-4 py-2 font-medium text-[var(--text-strong)]">{r.marca}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatInt(r.qt)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-[var(--text-body)]">{formatBRL(r.faturamento)}</td>
                <td className={cn("px-4 py-2 text-right tabular-nums font-semibold", neg ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400")}>
                  {formatBRL(r.margem)}
                </td>
                <td className={cn("px-4 py-2 text-right tabular-nums", neg ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400")}>
                  {r.margemPct.toFixed(2)}%
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-[var(--text-muted)]">{formatBRL(r.ganhosIndiretos)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TabelaModelos({ dados }: { dados: ReturnType<typeof margemPorModelo> }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] shadow-[var(--shadow-sm)]">
      <table className="w-full text-sm">
        <thead className="bg-[var(--bg-muted)] text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          <tr>
            <th className="px-4 py-2">Modelo</th>
            <th className="px-4 py-2 text-right">Vendas</th>
            <th className="px-4 py-2 text-right">Faturamento</th>
            <th className="px-4 py-2 text-right">Margem</th>
            <th className="px-4 py-2 text-right">Mg%</th>
          </tr>
        </thead>
        <tbody>
          {dados.map((r) => (
            <tr key={r.modelo} className="border-t border-[var(--border-soft)] hover:bg-[var(--bg-muted)]">
              <td className="px-4 py-2 text-xs text-[var(--text-strong)]">{r.modelo}</td>
              <td className="px-4 py-2 text-right tabular-nums">{r.qt}</td>
              <td className="px-4 py-2 text-right tabular-nums text-[var(--text-body)]">{formatBRL(r.faturamento)}</td>
              <td className="px-4 py-2 text-right tabular-nums font-semibold text-red-700 dark:text-red-400">{formatBRL(r.margem)}</td>
              <td className="px-4 py-2 text-right tabular-nums text-red-700 dark:text-red-400">{r.margemPct.toFixed(2)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TrocasBox({ titulo, d }: { titulo: string; d: ReturnType<typeof trocasVsSem>["comTroca"] }) {
  return (
    <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-4 shadow-[var(--shadow-sm)]">
      <p className="text-sm font-semibold text-[var(--text-strong)]">{titulo}</p>
      <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
        <div>
          <p className="text-[var(--text-muted)]">Vendas</p>
          <p className="text-base font-bold tabular-nums text-[var(--text-strong)]">{formatInt(d.qt)}</p>
        </div>
        <div>
          <p className="text-[var(--text-muted)]">Ticket médio</p>
          <p className="text-base font-bold tabular-nums text-[var(--text-strong)]">{formatBRL(d.ticketMedio)}</p>
        </div>
        <div>
          <p className="text-[var(--text-muted)]">Margem total</p>
          <p className={cn("text-base font-bold tabular-nums", d.margem >= 0 ? "text-emerald-700" : "text-red-700")}>
            {formatBRL(d.margem)}
          </p>
        </div>
        <div>
          <p className="text-[var(--text-muted)]">Margem/un</p>
          <p className={cn("text-base font-bold tabular-nums", d.margemPorUnidade >= 0 ? "text-emerald-700" : "text-red-700")}>
            {formatBRL(d.margemPorUnidade)}
          </p>
        </div>
      </div>
    </div>
  );
}

function TrocasCard({ dados }: { dados: ReturnType<typeof trocasVsSem> }) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <TrocasBox titulo="🔄 Com troca" d={dados.comTroca} />
      <TrocasBox titulo="✓ Sem troca" d={dados.semTroca} />
    </div>
  );
}

function TabelaVendedores({
  dados,
  titulo,
  highlight,
}: {
  dados: ReturnType<typeof margemPorVendedor>;
  titulo: string;
  highlight: "positivo" | "negativo";
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] shadow-[var(--shadow-sm)]">
      <div className="border-b border-[var(--border-soft)] bg-[var(--bg-muted)] px-4 py-2 text-sm font-semibold text-[var(--text-strong)]">
        {titulo}
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          <tr>
            <th className="px-4 py-1.5">Vendedor</th>
            <th className="px-4 py-1.5 text-right">Vendas</th>
            <th className="px-4 py-1.5 text-right">Faturamento</th>
            <th className="px-4 py-1.5 text-right">Margem</th>
            <th className="px-4 py-1.5 text-right">Mg%</th>
          </tr>
        </thead>
        <tbody>
          {dados.map((r) => (
            <tr key={r.vendedor} className="border-t border-[var(--border-soft)] hover:bg-[var(--bg-muted)]">
              <td className="px-4 py-1.5 text-xs text-[var(--text-strong)]">{r.vendedor}</td>
              <td className="px-4 py-1.5 text-right tabular-nums text-xs">{r.qt}</td>
              <td className="px-4 py-1.5 text-right tabular-nums text-xs text-[var(--text-body)]">{formatBRL(r.faturamento)}</td>
              <td className={cn("px-4 py-1.5 text-right tabular-nums text-xs font-semibold", highlight === "negativo" ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400")}>
                {formatBRL(r.margem)}
              </td>
              <td className={cn("px-4 py-1.5 text-right tabular-nums text-xs", highlight === "negativo" ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400")}>
                {r.margemPct.toFixed(2)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TabelaOutliers({
  dados,
  titulo,
  cor,
}: {
  dados: ReturnType<typeof outliers>;
  titulo: string;
  cor: "emerald" | "red";
}) {
  return (
    <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-4 shadow-[var(--shadow-sm)]">
      <p className="mb-3 text-sm font-semibold text-[var(--text-strong)]">{titulo}</p>
      <ul className="space-y-2">
        {dados.map((o, idx) => (
          <li key={`${o.placa}-${idx}`} className="flex items-start justify-between gap-3 text-xs">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[var(--text-muted)]">{o.placa}</p>
              <p className="truncate text-[var(--text-strong)]">{o.modelo}</p>
              <p className="truncate text-[10px] text-[var(--text-subtle)]">
                {o.loja ?? "—"} · {o.vendedor ?? "—"}
              </p>
            </div>
            <div className="text-right">
              <p className="tabular-nums text-[var(--text-body)]">{formatBRL(o.valor)}</p>
              <p className={cn("tabular-nums font-bold", cor === "emerald" ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400")}>
                {formatBRL(o.margem)}
              </p>
              <p className={cn("text-[10px]", cor === "emerald" ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400")}>
                {o.margemPct.toFixed(1)}%
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TabelaClientes({ dados }: { dados: ReturnType<typeof clientesRecorrentes> }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] shadow-[var(--shadow-sm)]">
      <table className="w-full text-sm">
        <thead className="bg-[var(--bg-muted)] text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          <tr>
            <th className="px-4 py-2">Cliente</th>
            <th className="px-4 py-2 text-center">Tipo</th>
            <th className="px-4 py-2 text-right">Compras</th>
            <th className="px-4 py-2 text-right">Faturamento</th>
            <th className="px-4 py-2 text-right">Margem</th>
          </tr>
        </thead>
        <tbody>
          {dados.map((c) => (
            <tr key={c.codigo ?? c.nome} className="border-t border-[var(--border-soft)] hover:bg-[var(--bg-muted)]">
              <td className="px-4 py-2 text-[var(--text-strong)]">{c.nome}</td>
              <td className="px-4 py-2 text-center text-xs text-[var(--text-muted)]">{c.tipo}</td>
              <td className="px-4 py-2 text-right tabular-nums">{c.qt}</td>
              <td className="px-4 py-2 text-right tabular-nums text-[var(--text-body)]">{formatBRL(c.faturamento)}</td>
              <td
                className={cn(
                  "px-4 py-2 text-right tabular-nums font-semibold",
                  c.margem >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400",
                )}
              >
                {formatBRL(c.margem)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
