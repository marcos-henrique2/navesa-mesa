"use client";

import { useCallback, useSyncExternalStore } from "react";
import { Camera, Trash2, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { useInventory } from "@/lib/store/inventory";
import {
  capturarSnapshot,
  salvarSnapshot,
  removerSnapshot,
  listarSnapshots,
  ensureSnapshotsLoaded,
  getCachedSnapshots,
  type Snapshot,
} from "@/lib/storage/snapshots";
import { formatBRL, formatInt, cn } from "@/lib/utils";

const EVT = "navesa-mesa:snapshots-updated";

function subscribe(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  ensureSnapshotsLoaded();
  window.addEventListener(EVT, cb);
  return () => window.removeEventListener(EVT, cb);
}

function getServer(): readonly Snapshot[] {
  return [];
}

function useSnapshots(): readonly Snapshot[] {
  return useSyncExternalStore(subscribe, getCachedSnapshots, getServer);
}

export function HistoricoSnapshots() {
  const { vendas, veiculos, custosPorPlaca, isHydrated } = useInventory();
  const snapshots = useSnapshots();

  const salvarFoto = useCallback(async () => {
    const snap = capturarSnapshot(vendas, custosPorPlaca, veiculos);
    if (!snap.vendas && !snap.estoque) {
      alert("Nenhum dado carregado pra fotografar. Suba os relatórios primeiro.");
      return;
    }
    const jaExiste = listarSnapshots().some((s) => s.id === snap.id);
    if (jaExiste && !confirm("Já existe uma foto de hoje. Sobrescrever com o estado atual?")) return;
    try {
      await salvarSnapshot(snap);
    } catch (err) {
      alert(`Falha ao salvar foto: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [vendas, custosPorPlaca, veiculos]);

  if (!isHydrated) return <div className="p-6 text-sm text-slate-500">Carregando…</div>;

  // ordena do mais recente pro mais antigo pra exibir
  const ordenados = [...snapshots].reverse();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          {snapshots.length === 0
            ? "Nenhuma foto ainda. Salve uma foto pra começar a acompanhar a evolução."
            : `${snapshots.length} foto${snapshots.length === 1 ? "" : "s"} salva${snapshots.length === 1 ? "" : "s"}.`}
        </p>
        <button
          onClick={salvarFoto}
          className="inline-flex items-center gap-2 rounded-lg bg-[var(--brand-700)] px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-[var(--brand-800)]"
        >
          <Camera className="h-4 w-4" /> Salvar foto de hoje
        </button>
      </div>

      {snapshots.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border-base)] bg-white p-10 text-center">
          <Camera className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-3 text-sm text-slate-600">
            Toda vez que subir relatórios novos, volte aqui e clique em <strong>&quot;Salvar foto de hoje&quot;</strong>.
            Assim o sistema vai montando a linha do tempo da operação.
          </p>
        </div>
      ) : (
        <>
          {/* KPIs de evolução (compara últimas 2 fotos) */}
          {ordenados.length >= 2 && <EvolucaoCards atual={ordenados[0]} anterior={ordenados[1]} />}

          {/* Tabela de vendas ao longo do tempo */}
          <SecaoVendas snapshots={ordenados} />

          {/* Tabela de estoque ao longo do tempo */}
          <SecaoEstoque snapshots={ordenados} />
        </>
      )}
    </div>
  );
}

function fmtData(id: string): string {
  const [a, m, d] = id.split("-");
  return `${d}/${m}/${a}`;
}

function Delta({ atual, anterior, invertido }: { atual: number; anterior: number; invertido?: boolean }) {
  const diff = atual - anterior;
  if (Math.abs(diff) < 0.01) return <span className="inline-flex items-center gap-0.5 text-slate-400"><Minus className="h-3 w-3" /></span>;
  // invertido = true → subir é ruim (ex: estoque parado). Default: subir é bom.
  const bom = invertido ? diff < 0 : diff > 0;
  const Icon = diff > 0 ? TrendingUp : TrendingDown;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[11px] font-medium", bom ? "text-emerald-600" : "text-red-600")}>
      <Icon className="h-3 w-3" />
      {diff > 0 ? "+" : ""}{formatBRL(diff)}
    </span>
  );
}

function EvolucaoCards({ atual, anterior }: { atual: Snapshot; anterior: Snapshot }) {
  const va = atual.vendas, vp = anterior.vendas;
  const ea = atual.estoque, ep = anterior.estoque;
  return (
    <section>
      <h2 className="mb-3 text-base font-semibold text-slate-900">
        Evolução: {fmtData(anterior.id)} → {fmtData(atual.id)}
      </h2>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        {va && vp && (
          <>
            <CardEvol titulo="Margem real" valor={formatBRL(va.margem)} delta={<Delta atual={va.margem} anterior={vp.margem} />} />
            <CardEvol titulo="Faturamento" valor={formatBRL(va.faturamento)} delta={<Delta atual={va.faturamento} anterior={vp.faturamento} />} />
          </>
        )}
        {ea && ep && (
          <>
            <CardEvol titulo="Estoque (custo)" valor={formatBRL(ea.custoTotal)} delta={<Delta atual={ea.custoTotal} anterior={ep.custoTotal} invertido />} />
            <CardEvol titulo="Parado +180d" valor={formatBRL(ea.parados180Custo)} delta={<Delta atual={ea.parados180Custo} anterior={ep.parados180Custo} invertido />} />
          </>
        )}
      </div>
    </section>
  );
}

function CardEvol({ titulo, valor, delta }: { titulo: string; valor: string; delta: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--border-soft)] bg-white p-4 shadow-[var(--shadow-sm)]">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{titulo}</p>
      <p className="mt-1 text-lg font-bold tabular-nums text-slate-900">{valor}</p>
      <p className="mt-0.5">{delta}</p>
    </div>
  );
}

function SecaoVendas({ snapshots }: { snapshots: Snapshot[] }) {
  const comVendas = snapshots.filter((s) => s.vendas);
  if (comVendas.length === 0) return null;
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-slate-900">
        <TrendingUp className="h-4 w-4 text-[var(--brand-700)]" /> Vendas ao longo do tempo
      </h2>
      <div className="overflow-x-auto rounded-xl border border-[var(--border-soft)] bg-white shadow-[var(--shadow-sm)]">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-2">Data</th>
              <th className="px-4 py-2 text-right">Vendas</th>
              <th className="px-4 py-2 text-right">Faturamento</th>
              <th className="px-4 py-2 text-right">Margem</th>
              <th className="px-4 py-2 text-right">Mg%</th>
              <th className="px-4 py-2 text-right">Bônus</th>
              <th className="px-4 py-2 text-right">Sem bônus</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {comVendas.map((s) => (
              <tr key={s.id} className="border-t border-[var(--border-soft)] hover:bg-slate-50">
                <td className="px-4 py-2 font-medium text-slate-900">{fmtData(s.id)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatInt(s.vendas!.qt)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-600">{formatBRL(s.vendas!.faturamento)}</td>
                <td className={cn("px-4 py-2 text-right tabular-nums font-semibold", s.vendas!.margem >= 0 ? "text-emerald-700" : "text-red-700")}>
                  {formatBRL(s.vendas!.margem)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-600">{s.vendas!.margemPct.toFixed(2)}%</td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-500">{formatBRL(s.vendas!.ganhosIndiretos)}</td>
                <td className={cn("px-4 py-2 text-right tabular-nums", s.vendas!.margemSemBonus >= 0 ? "text-emerald-700" : "text-red-700")}>
                  {formatBRL(s.vendas!.margemSemBonus)}
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    onClick={async () => {
                      if (!confirm(`Apagar foto de ${fmtData(s.id)}?`)) return;
                      try { await removerSnapshot(s.id); }
                      catch (err) { alert(`Falha: ${err instanceof Error ? err.message : String(err)}`); }
                    }}
                    className="text-slate-300 hover:text-red-500"
                    title="Apagar foto"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SecaoEstoque({ snapshots }: { snapshots: Snapshot[] }) {
  const comEstoque = snapshots.filter((s) => s.estoque);
  if (comEstoque.length === 0) return null;
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-slate-900">
        <TrendingDown className="h-4 w-4 text-[var(--brand-700)]" /> Estoque ao longo do tempo (custo de fábrica)
      </h2>
      <div className="overflow-x-auto rounded-xl border border-[var(--border-soft)] bg-white shadow-[var(--shadow-sm)]">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-2">Data</th>
              <th className="px-4 py-2 text-right">Carros</th>
              <th className="px-4 py-2 text-right">Custo total</th>
              <th className="px-4 py-2 text-right">Disponível</th>
              <th className="px-4 py-2 text-right">Preparação</th>
              <th className="px-4 py-2 text-right">Parado +180d</th>
            </tr>
          </thead>
          <tbody>
            {comEstoque.map((s) => (
              <tr key={s.id} className="border-t border-[var(--border-soft)] hover:bg-slate-50">
                <td className="px-4 py-2 font-medium text-slate-900">{fmtData(s.id)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatInt(s.estoque!.totalCarros)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-600">{formatBRL(s.estoque!.custoTotal)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-emerald-700">{formatInt(s.estoque!.disponivelQt)} · {formatBRL(s.estoque!.disponivelCusto)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-amber-700">{formatInt(s.estoque!.preparacaoQt)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-red-700">{formatInt(s.estoque!.parados180Qt)} · {formatBRL(s.estoque!.parados180Custo)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
