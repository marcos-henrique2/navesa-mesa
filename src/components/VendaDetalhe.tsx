"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, ShoppingCart, Banknote, Wrench, UserSquare2, TrendingUp, TrendingDown, CheckCircle2, Repeat, AlertCircle } from "lucide-react";
import { useInventory, nomeOuCodigo } from "@/lib/store/inventory";
import { indexarClientes, getCliente, tierRecorrencia, TIER_LABEL, type RecorrenciaTier } from "@/lib/analytics/clientes";
import { formatBRL, formatInt, cn } from "@/lib/utils";

export function VendaDetalhe({ chassi }: { chassi: string }) {
  const { vendas, lojas, isHydrated } = useInventory();

  const venda = useMemo(() => vendas.find((v) => v.chassi === chassi), [vendas, chassi]);
  const clienteAgg = useMemo(() => {
    if (!venda) return null;
    const idx = indexarClientes(vendas);
    return getCliente(idx, venda);
  }, [vendas, venda]);

  if (!isHydrated) return <p className="text-sm text-zinc-500">Carregando…</p>;

  if (!venda) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-12 text-center dark:border-zinc-700 dark:bg-zinc-900">
        <p className="text-zinc-500">Venda com chassi <span className="font-mono">{chassi}</span> não encontrada.</p>
        <Link href="/vendas" className="mt-3 inline-block rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700">Voltar pra análise</Link>
      </div>
    );
  }

  const aquisicao = venda.total_nota_fabrica ?? 0;
  const floorPlan = venda.custo_floor_plan ?? 0;
  const despesas = venda.despesas_gerais ?? 0;
  const comissao = venda.comissao_vendedor ?? 0;
  const valorVenda = venda.valor_venda ?? 0;
  const custoTotal = aquisicao + floorPlan + despesas + comissao;
  const margem = valorVenda - custoTotal;
  const margemPct = custoTotal > 0 ? (margem / custoTotal) * 100 : 0;
  const positiva = margem > 0;

  const itens = [
    { label: "Aquisição (Nota Fábrica)", icon: <ShoppingCart className="h-3.5 w-3.5" />, value: aquisicao, color: "bg-blue-500" },
    { label: "Floor Plan", icon: <Banknote className="h-3.5 w-3.5" />, value: floorPlan, color: "bg-purple-500" },
    { label: "Despesas gerais", icon: <Wrench className="h-3.5 w-3.5" />, value: despesas, color: "bg-amber-500" },
    { label: "Comissão vendedor", icon: <UserSquare2 className="h-3.5 w-3.5" />, value: comissao, color: "bg-teal-500" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/vendas" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
          <ArrowLeft className="h-3 w-3" /> voltar para análise
        </Link>
        <div className="mt-3 flex flex-wrap items-baseline gap-3">
          <h1 className="text-2xl font-bold">{venda.marca} · {venda.modelo}</h1>
          <span className="font-mono text-sm text-zinc-500">{venda.placa}</span>
          {venda.placa_troca && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
              <Repeat className="h-3 w-3" /> Troca: {venda.placa_troca}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-zinc-500">Chassi <span className="font-mono">{venda.chassi}</span></p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="🚗 Veículo">
          <Row label="Marca / Modelo" value={`${venda.marca ?? "—"} · ${venda.modelo}`} />
          <Row label="Ano fab./mod." value={`${venda.ano_fabricacao ?? "—"} / ${venda.ano_modelo ?? "—"}`} />
          <Row label="Cor" value={venda.cor_externa ?? "—"} />
          <Row label="Renavam" value={venda.renavam ?? "—"} />
          <Row label="Loja vendedora" value={venda.empresa_nome || nomeOuCodigo(lojas, venda.cod_empresa)} />
          <Row label="Pátio" value={venda.patio ?? "—"} />
        </Card>

        <Card title="📅 Venda">
          <Row label="Data da venda" value={venda.data_venda ? new Date(venda.data_venda).toLocaleString("pt-BR") : "—"} bold />
          <Row label="Data entrada estoque" value={venda.data_entrada ? new Date(venda.data_entrada).toLocaleDateString("pt-BR") : "—"} />
          <Row label="Dias até venda" value={venda.dias_estoque !== null ? `${formatInt(venda.dias_estoque)} dias` : "—"} tone={diasTone(venda.dias_estoque)} bold />
          <Row label="Vendedor" value={venda.vendedor_nome || venda.vendedor_codigo || "—"} />
          {venda.vendedor_cpf && <Row label="CPF vendedor" value={venda.vendedor_cpf} muted />}
        </Card>
      </div>

      <ClienteCard venda={venda} cliente={clienteAgg} />



      {/* Composição de custos da venda */}
      <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <header className="border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <h3 className="font-semibold">💰 Composição financeira</h3>
        </header>

        <div className="grid gap-6 p-5 lg:grid-cols-[1fr,280px]">
          <div className="space-y-3">
            {itens.map((item) => {
              const pct = custoTotal > 0 ? (item.value / custoTotal) * 100 : 0;
              return (
                <div key={item.label}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="inline-flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
                      {item.icon} {item.label}
                    </span>
                    <span className="tabular-nums font-semibold">{formatBRL(item.value)}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-800">
                      <div className={item.color + " h-full"} style={{ width: `${Math.min(100, pct)}%` }} />
                    </div>
                    <span className="text-xs tabular-nums text-zinc-500" style={{ width: 48 }}>{pct.toFixed(1)}%</span>
                  </div>
                </div>
              );
            })}

            <div className="border-t border-zinc-200 pt-3 dark:border-zinc-800">
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold">Custo total</span>
                <span className="tabular-nums font-bold">{formatBRL(custoTotal)}</span>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">Valor vendido</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{formatBRL(valorVenda)}</p>
            {venda.preco_venda_tabela && venda.preco_venda_tabela !== valorVenda && (
              <p className="text-[11px] text-zinc-500">Tabela: {formatBRL(venda.preco_venda_tabela)}</p>
            )}

            <p className="mt-4 text-[10px] font-medium uppercase tracking-wide text-zinc-500">(−) Custo total</p>
            <p className="mt-1 text-base font-semibold tabular-nums text-zinc-600 dark:text-zinc-400">{formatBRL(custoTotal)}</p>

            <div className="my-3 border-t border-zinc-300 dark:border-zinc-700" />

            <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">Margem</p>
            <p className={cn("mt-1 flex items-center gap-1 text-2xl font-bold tabular-nums", positiva ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400")}>
              {positiva ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
              {formatBRL(margem)}
            </p>
            <p className={cn("text-xs tabular-nums", positiva ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400")}>
              {margemPct >= 0 ? "+" : ""}{margemPct.toFixed(1)}% sobre o custo
            </p>
            {venda.margem_pct !== null && (
              <p className="mt-2 text-[10px] text-zinc-500">NBS reporta margem: {venda.margem_pct.toFixed(2)}%</p>
            )}
          </div>
        </div>

        {/* Indicador de saúde da venda */}
        <footer className={cn("border-t px-5 py-3 text-sm",
          positiva
            ? "border-green-200 bg-green-50/50 text-green-900 dark:border-green-900 dark:bg-green-950/20 dark:text-green-200"
            : "border-red-200 bg-red-50/50 text-red-900 dark:border-red-900 dark:bg-red-950/20 dark:text-red-200",
        )}>
          {positiva ? (
            <span className="inline-flex items-center gap-2"><CheckCircle2 className="h-4 w-4" /> Venda lucrativa</span>
          ) : (
            <span className="inline-flex items-center gap-2"><TrendingDown className="h-4 w-4" /> Venda no prejuízo</span>
          )}
          {venda.dias_estoque !== null && (
            <span className="ml-3 text-xs opacity-80">· {venda.dias_estoque} dias no estoque{venda.dias_estoque > 90 ? " (carro travado)" : venda.dias_estoque < 30 ? " (giro rápido)" : ""}</span>
          )}
        </footer>
      </section>
    </div>
  );
}

function diasTone(d: number | null): "good" | "warn" | "bad" | undefined {
  if (d === null) return undefined;
  if (d < 30) return "good";
  if (d < 90) return undefined;
  if (d < 180) return "warn";
  return "bad";
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="mb-3 font-semibold">{title}</h3>
      <div className="space-y-1.5 text-sm">{children}</div>
    </div>
  );
}

type ClienteAggView = NonNullable<ReturnType<typeof getCliente>>;

function ClienteCard({ venda, cliente }: { venda: NonNullable<ReturnType<typeof Object>>; cliente: ClienteAggView | null }) {
  // Não usei tipo direto da venda pra evitar ciclo de import — venda é VendaParsed
  const v = venda as { cliente_nome: string; cliente_codigo: string | null; cliente_tipo: "PF" | "PJ" | null; cliente_cidade: string | null; cliente_uf: string | null; chassi: string };
  const tier = cliente ? tierRecorrencia(cliente.totalCompras) : "unica";
  const styles = TIER_STYLES[tier];

  return (
    <section className={cn("rounded-lg border bg-white shadow-[var(--shadow-sm)]", styles.cardBorder)}>
      <header className={cn("flex items-center gap-2 border-b px-5 py-3", styles.headerBg, styles.cardBorder)}>
        <h3 className="font-semibold">👤 Cliente</h3>
        {cliente && cliente.totalCompras > 1 && (
          <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", styles.badge)}>
            {styles.icon} {cliente.totalCompras} compras
          </span>
        )}
      </header>

      <div className="p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 text-sm">
            <Row label="Nome" value={v.cliente_nome} bold />
            {v.cliente_codigo && <Row label="CPF/CNPJ" value={v.cliente_codigo} muted />}
          </div>
          <div className="space-y-1.5 text-sm">
            <Row label="Tipo" value={v.cliente_tipo ?? "—"} />
            <Row label="Cidade / UF" value={`${v.cliente_cidade ?? "—"} / ${v.cliente_uf ?? "—"}`} />
          </div>
        </div>

        {cliente && cliente.totalCompras > 1 && (
          <div className={cn("mt-5 rounded-lg p-4", styles.alertBg)}>
            <p className={cn("flex items-center gap-2 text-sm font-semibold", styles.alertText)}>
              {styles.icon} {TIER_LABEL[tier]}
            </p>
            <p className="mt-1 text-xs text-slate-600">
              <strong>{cliente.totalCompras}</strong> compras no total
              {cliente.diasEntrePrimeiraUltima !== null && cliente.diasEntrePrimeiraUltima > 0 && (
                <> em <strong>{cliente.diasEntrePrimeiraUltima}</strong> dias</>
              )}
              {" · "}faturamento <strong>{formatBRL(cliente.totalValor)}</strong>
            </p>

            <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Histórico de compras</p>
            <ul className="mt-1.5 divide-y divide-slate-200">
              {cliente.vendas.map((vv, i) => {
                const isAtual = vv.chassi === v.chassi;
                return (
                  <li key={vv.chassi} className={cn("flex items-center justify-between py-1.5 text-xs", isAtual && "font-semibold text-slate-900")}>
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums text-slate-400" style={{ width: 18 }}>{i + 1}.</span>
                      {isAtual && <span className="rounded bg-slate-900 px-1 py-0.5 text-[9px] font-bold text-white">ATUAL</span>}
                      <span className="font-mono">{vv.placa}</span>
                      <span className="text-slate-500">{vv.marca} {vv.modelo.slice(0, 40)}</span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="text-slate-500">{vv.data_venda ? new Date(vv.data_venda).toLocaleDateString("pt-BR") : "—"}</span>
                      <span className="tabular-nums">{formatBRL(vv.valor_venda)}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

const TIER_STYLES: Record<RecorrenciaTier, {
  cardBorder: string; headerBg: string; badge: string; icon: React.ReactNode;
  alertBg: string; alertText: string;
}> = {
  "unica": {
    cardBorder: "border-[var(--border-soft)]", headerBg: "bg-slate-50",
    badge: "bg-slate-100 text-slate-700", icon: null,
    alertBg: "bg-slate-50", alertText: "text-slate-700",
  },
  "ocasional": {
    cardBorder: "border-[var(--border-soft)]", headerBg: "bg-blue-50",
    badge: "bg-blue-100 text-blue-800", icon: <Repeat className="h-3 w-3" />,
    alertBg: "bg-blue-50", alertText: "text-blue-900",
  },
  "recorrente": {
    cardBorder: "border-amber-200", headerBg: "bg-amber-50",
    badge: "bg-amber-200 text-amber-900", icon: <AlertCircle className="h-3 w-3" />,
    alertBg: "bg-amber-50", alertText: "text-amber-900",
  },
  "lojista-suspeito": {
    cardBorder: "border-red-300", headerBg: "bg-red-50",
    badge: "bg-red-600 text-white", icon: <AlertCircle className="h-3 w-3" />,
    alertBg: "bg-red-50", alertText: "text-red-900",
  },
};

function Row({ label, value, bold, muted, tone }: { label: string; value: string; bold?: boolean; muted?: boolean; tone?: "good" | "warn" | "bad" }) {
  const toneClass = tone === "good" ? "text-green-700 dark:text-green-400"
    : tone === "warn" ? "text-amber-700 dark:text-amber-400"
    : tone === "bad" ? "text-red-700 dark:text-red-400"
    : "";
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-zinc-500">{label}</span>
      <span className={cn("text-right tabular-nums", bold && "font-semibold", muted && "text-zinc-600 dark:text-zinc-400", toneClass)}>{value}</span>
    </div>
  );
}
