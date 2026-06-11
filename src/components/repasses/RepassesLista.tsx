"use client";

/**
 * Lista de repasses + KPIs + filtros + ações em massa.
 *
 * Estado: lista de repasses + map de "total gastos por repasse" carregado
 * paralelamente pra exibir custo total e margem na tabela sem N+1.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Download,
  Loader2,
  Plus,
  TruckIcon,
  TrendingUp,
  AlertTriangle,
  Wallet,
  Eye,
  Filter,
} from "lucide-react";
import { getSupabase } from "@/lib/data/supabase";
import { listRepasses } from "@/lib/repasses/queries";
import type { Repasse, RepasseGasto, RepasseStatus } from "@/lib/repasses/types";
import { STATUS_LABEL, CANAL_LABEL, CANAIS_DISPONIVEIS } from "@/lib/repasses/types";
import { calcularCustoTotal, calcularMargemReal, calcularMargemPct } from "@/lib/repasses/calc";
import { gerarConsolidadoRepassesXlsx } from "@/lib/export/relatorio-repasse-xlsx";
import { usePersistedState } from "@/lib/hooks/usePersistedState";
import { cn, formatBRL } from "@/lib/utils";
import { showErrorToast, showSuccessToast } from "@/components/ui/Toast";
import { SubirRepasseModal } from "./SubirRepasseModal";
import { EscolherVeiculoModal } from "./EscolherVeiculoModal";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";

type GastosMap = Record<number, RepasseGasto[]>;

const STATUS_OPCOES: { value: RepasseStatus; label: string }[] = [
  { value: "subido", label: STATUS_LABEL.subido },
  { value: "vendido", label: STATUS_LABEL.vendido },
  { value: "nao_vendido", label: STATUS_LABEL.nao_vendido },
  { value: "cancelado", label: STATUS_LABEL.cancelado },
];

export function RepassesLista() {
  const [repasses, setRepasses] = useState<Repasse[]>([]);
  const [gastosPorRepasse, setGastosPorRepasse] = useState<GastosMap>({});
  const [carregando, setCarregando] = useState(true);
  const [statusFiltro, setStatusFiltro] = usePersistedState<RepasseStatus[]>(
    "repasses:status",
    ["subido", "vendido", "nao_vendido"],
  );
  const [canalFiltro, setCanalFiltro] = usePersistedState<string>("repasses:canal", "all");
  const [escolherVeiculo, setEscolherVeiculo] = useState(false);
  const [veiculoSelecionado, setVeiculoSelecionado] = useState<VeiculoParsed | null>(null);
  const [exportando, setExportando] = useState(false);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const lista = await listRepasses();
        if (cancelado) return;
        setRepasses(lista);

        if (lista.length === 0) {
          setCarregando(false);
          return;
        }

        // Carrega todos os gastos numa query só (filtrando por repasse_id IN)
        const sb = getSupabase();
        const ids = lista.map((r) => r.id);
        const { data, error } = await sb
          .from("repasse_gastos")
          .select("*")
          .in("repasse_id", ids);
        if (error) throw new Error(error.message);

        const mapa: GastosMap = {};
        for (const g of (data ?? []) as RepasseGasto[]) {
          (mapa[g.repasse_id] ??= []).push(g);
        }
        if (!cancelado) setGastosPorRepasse(mapa);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        showErrorToast(`Erro ao carregar repasses: ${msg}`);
      } finally {
        if (!cancelado) setCarregando(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, []);

  const filtrados = useMemo(() => {
    return repasses.filter((r) => {
      if (statusFiltro.length > 0 && !statusFiltro.includes(r.status)) return false;
      if (canalFiltro !== "all" && r.canal !== canalFiltro) return false;
      return true;
    });
  }, [repasses, statusFiltro, canalFiltro]);

  const kpis = useMemo(() => {
    const subidos = filtrados.filter((r) => r.status === "subido").length;
    const vendidos = filtrados.filter((r) => r.status === "vendido").length;
    const naoVendidos = filtrados.filter((r) => r.status === "nao_vendido").length;
    const totalFechados = vendidos + naoVendidos;
    const conv = totalFechados > 0 ? (vendidos / totalFechados) * 100 : null;

    // Capital travado = soma do custo_total dos que ainda estão "subido"
    let capitalTravado = 0;
    for (const r of filtrados) {
      if (r.status !== "subido") continue;
      const custo = calcularCustoTotal(r, gastosPorRepasse[r.id] ?? []);
      if (custo != null) capitalTravado += custo;
    }

    return { subidos, vendidos, naoVendidos, conv, capitalTravado };
  }, [filtrados, gastosPorRepasse]);

  async function handleExportConsolidado() {
    if (exportando) return;
    setExportando(true);
    try {
      const rows = filtrados.map((r) => {
        const gastos = gastosPorRepasse[r.id] ?? [];
        return {
          repasse: r,
          totalGastos: gastos.reduce((s, g) => s + g.valor, 0),
          custoTotal: calcularCustoTotal(r, gastos),
          margemReal: calcularMargemReal(r, gastos),
          margemPct: calcularMargemPct(r, gastos),
        };
      });
      const buf = await gerarConsolidadoRepassesXlsx(rows);
      const blob = new Blob([new Uint8Array(buf)], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const hoje = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `navesa-repasses-${hoje}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showSuccessToast(`${rows.length} repasse(s) exportado(s).`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showErrorToast(`Erro ao gerar XLSX: ${msg}`);
    } finally {
      setExportando(false);
    }
  }

  if (carregando) {
    return (
      <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando repasses...
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi icon={<TruckIcon className="h-4 w-4" />} label="Subidos" value={String(kpis.subidos)} tone="info" />
        <Kpi icon={<TrendingUp className="h-4 w-4" />} label="Vendidos" value={String(kpis.vendidos)} tone="good" />
        <Kpi icon={<AlertTriangle className="h-4 w-4" />} label="Não vendidos" value={String(kpis.naoVendidos)} tone="warn" />
        <Kpi
          label="Conversão"
          value={kpis.conv != null ? `${kpis.conv.toFixed(1)}%` : "—"}
          tone={kpis.conv != null && kpis.conv >= 50 ? "good" : "neutro"}
        />
        <Kpi
          icon={<Wallet className="h-4 w-4" />}
          label="Capital travado"
          value={formatBRL(kpis.capitalTravado)}
          tone="warn"
        />
      </div>

      {/* Filtros + ações */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] p-4">
        <div className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
          <Filter className="h-3 w-3" /> Filtros:
        </div>

        <div className="flex flex-wrap gap-1.5">
          {STATUS_OPCOES.map((s) => {
            const ativo = statusFiltro.includes(s.value);
            return (
              <button
                key={s.value}
                type="button"
                onClick={() =>
                  setStatusFiltro((prev) =>
                    prev.includes(s.value) ? prev.filter((x) => x !== s.value) : [...prev, s.value],
                  )
                }
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition",
                  ativo
                    ? "border-[var(--brand-600)] bg-[var(--brand-50)] text-[var(--brand-900)] dark:bg-[var(--brand-900)]/30 dark:text-[var(--brand-100)]"
                    : "border-[var(--border-base)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:bg-[var(--bg-muted)]",
                )}
              >
                {s.label}
              </button>
            );
          })}
        </div>

        <label className="inline-flex items-center gap-1.5 text-xs">
          <span className="text-[var(--text-muted)]">Canal:</span>
          <select
            value={canalFiltro}
            onChange={(e) => setCanalFiltro(e.target.value)}
            className="rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-2 py-1 text-xs"
          >
            <option value="all">Todos</option>
            {CANAIS_DISPONIVEIS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportConsolidado}
            disabled={exportando || filtrados.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs text-[var(--text-body)] hover:bg-[var(--bg-muted)] disabled:opacity-50"
          >
            {exportando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Exportar consolidado
          </button>
          <button
            type="button"
            onClick={() => setEscolherVeiculo(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-[var(--brand-700)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--brand-800)]"
          >
            <Plus className="h-3.5 w-3.5" /> Subir carro pra repasse
          </button>
        </div>
      </div>

      {/* Tabela */}
      {filtrados.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border-base)] bg-[var(--bg-surface)] p-12 text-center">
          <p className="text-[var(--text-muted)]">
            {repasses.length === 0
              ? "Nenhum repasse cadastrado ainda."
              : "Nenhum repasse com esses filtros."}
          </p>
          {repasses.length === 0 && (
            <button
              type="button"
              onClick={() => setEscolherVeiculo(true)}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-[var(--brand-700)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--brand-800)]"
            >
              <Plus className="h-3.5 w-3.5" /> Subir primeiro carro
            </button>
          )}
        </div>
      ) : (
        <TabelaRepasses repasses={filtrados} gastosPorRepasse={gastosPorRepasse} />
      )}

      <EscolherVeiculoModal
        open={escolherVeiculo}
        onClose={() => setEscolherVeiculo(false)}
        onSelect={(v) => {
          setEscolherVeiculo(false);
          setVeiculoSelecionado(v);
        }}
      />

      {veiculoSelecionado && (
        <SubirRepasseModal
          veiculo={veiculoSelecionado}
          open={true}
          onClose={() => setVeiculoSelecionado(null)}
        />
      )}
    </div>
  );
}

function TabelaRepasses({
  repasses,
  gastosPorRepasse,
}: {
  repasses: Repasse[];
  gastosPorRepasse: GastosMap;
}) {
  const router = useRouter();

  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)]">
      <table className="w-full text-sm">
        <thead className="border-b border-[var(--border-soft)] bg-[var(--bg-muted)] text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          <tr>
            <Th>Placa</Th>
            <Th>Modelo</Th>
            <Th>Subido em</Th>
            <Th>Canal</Th>
            <Th className="text-right">Subiu por</Th>
            <Th className="text-right">Vendido por</Th>
            <Th className="text-right">Margem</Th>
            <Th>Status</Th>
            <Th>Doc</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {repasses.map((r) => {
            const gastos = gastosPorRepasse[r.id] ?? [];
            const margem = calcularMargemReal(r, gastos);
            const margemPct = calcularMargemPct(r, gastos);
            return (
              <tr
                key={r.id}
                onClick={() => router.push(`/repasses/${r.id}`)}
                className="cursor-pointer border-b border-[var(--border-soft)] last:border-0 hover:bg-[var(--bg-muted)]"
              >
                <Td className="font-mono text-xs">{r.placa}</Td>
                <Td>
                  <div className="font-medium text-[var(--text-strong)]">{r.modelo}</div>
                  {r.marca && <div className="text-[10px] text-[var(--text-subtle)]">{r.marca}</div>}
                </Td>
                <Td className="text-xs text-[var(--text-muted)]">
                  {formatDataBR(r.data_subiu)}
                </Td>
                <Td className="text-xs">{CANAL_LABEL[r.canal] ?? r.canal}</Td>
                <Td className="text-right tabular-nums">{formatBRL(r.valor_subiu)}</Td>
                <Td className="text-right tabular-nums">{formatBRL(r.valor_vendido)}</Td>
                <Td className="text-right tabular-nums">
                  {margem == null ? (
                    <span className="text-[var(--text-subtle)]">—</span>
                  ) : (
                    <span className={margem < 0 ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}>
                      {formatBRL(margem)}
                      {margemPct != null && (
                        <span className="ml-1 text-[10px] text-[var(--text-muted)]">
                          ({margemPct.toFixed(1)}%)
                        </span>
                      )}
                    </span>
                  )}
                </Td>
                <Td>
                  <StatusBadge status={r.status} />
                </Td>
                <Td>
                  <DocBadge status={r.documentacao_status} />
                </Td>
                <Td>
                  <Link
                    href={`/repasses/${r.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 text-xs text-[var(--brand-700)] hover:underline"
                  >
                    <Eye className="h-3 w-3" /> Ver
                  </Link>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ status }: { status: RepasseStatus }) {
  const cor =
    status === "vendido"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
      : status === "nao_vendido"
        ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
        : status === "cancelado"
          ? "bg-[var(--bg-muted)] text-[var(--text-muted)]"
          : "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300";
  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold", cor)}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function DocBadge({ status }: { status: "ok" | "pendente" | "irregular" }) {
  const icon = status === "ok" ? "✅" : status === "pendente" ? "⏳" : "❌";
  return <span className="text-sm">{icon}</span>;
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={cn("px-3 py-2 text-left", className)}>{children}</th>;
}

function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={cn("px-3 py-2", className)}>{children}</td>;
}

function Kpi({
  label,
  value,
  icon,
  tone = "neutro",
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  tone?: "neutro" | "good" | "warn" | "bad" | "info";
}) {
  const toneClass =
    tone === "good"
      ? "text-emerald-700 dark:text-emerald-400"
      : tone === "warn"
        ? "text-amber-700 dark:text-amber-400"
        : tone === "bad"
          ? "text-red-700 dark:text-red-400"
          : tone === "info"
            ? "text-blue-700 dark:text-blue-400"
            : "text-[var(--text-body)]";
  return (
    <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] p-4">
      <p className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        {icon}
        {label}
      </p>
      <p className={cn("mt-1 text-xl font-bold tabular-nums", toneClass)}>{value}</p>
    </div>
  );
}

function formatDataBR(yyyymmdd: string): string {
  const [y, m, d] = yyyymmdd.split("-");
  if (!y || !m || !d) return yyyymmdd;
  return `${d}/${m}/${y}`;
}
