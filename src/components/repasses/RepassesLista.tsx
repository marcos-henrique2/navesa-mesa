"use client";
/* eslint-disable react-hooks/set-state-in-effect --
 * Carga inicial async via Supabase. É o mesmo padrão do AppShell/PrecificacaoBlock/
 * VeiculoDetalhe: o effect dispara fetch e o estado é setado quando a Promise resolve.
 * A regra é conservadora demais pra esse uso.
 */

/**
 * Lista de repasses (carros marcados pra subir / já subidos).
 *
 * Fluxo:
 *   1. Filtra por status / período / loja
 *   2. Seleciona linhas (ou todas via checkbox header)
 *   3. Exporta XLSX (todos filtrados ou só selecionados) → preenche IPVA/Doc/
 *      Cautelar/Observação no Excel
 *   4. Sobe no Auto Avaliar (fora do sistema)
 *   5. Marca como "subido" pra registrar histórico
 *
 * KPIs mínimos: X marcados, Y subidos, Z capital travado nos marcados.
 * Sem detalhes de margem/venda — quem cuida disso é o Auto Avaliar.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Download,
  Loader2,
  Plus,
  TruckIcon,
  Wallet,
  Filter,
  CheckCircle2,
  Trash2,
} from "lucide-react";
import {
  deleteRepasse,
  deleteRepasses,
  listRepasses,
  marcarComoSubido,
  marcarVariosComoSubido,
} from "@/lib/repasses/queries";
import type { Repasse, RepasseStatus } from "@/lib/repasses/types";
import { STATUS_LABEL } from "@/lib/repasses/types";
import { gerarRelatorioRepasseProfissional } from "@/lib/export/relatorio-repasse-xlsx";
import { useChassisEmRepasse } from "@/lib/repasses/useChassisEmRepasse";
import { usePersistedState } from "@/lib/hooks/usePersistedState";
import { useInventory, nomeOuCodigo } from "@/lib/store/inventory";
import { cn, formatBRL, formatInt } from "@/lib/utils";
import { showErrorToast, showSuccessToast } from "@/components/ui/Toast";
import { MarcarRepasseModal } from "./MarcarRepasseModal";
import { EscolherVeiculoModal } from "./EscolherVeiculoModal";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";

type StatusFiltro = "marcado" | "subido" | "todos";

export function RepassesLista() {
  const { lojas } = useInventory();
  const { removerLocalmente: removerChassiEmRepasse } = useChassisEmRepasse();
  const [repasses, setRepasses] = useState<Repasse[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [statusFiltro, setStatusFiltro] = usePersistedState<StatusFiltro>(
    "repasses:status",
    "marcado",
  );
  // Período persistido (consistente com statusFiltro e lojaFiltro).
  const [periodoIni, setPeriodoIni] = usePersistedState<string>("repasses:periodoIni", "");
  const [periodoFim, setPeriodoFim] = usePersistedState<string>("repasses:periodoFim", "");
  const [lojaFiltro, setLojaFiltro] = usePersistedState<string>("repasses:loja", "all");
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set());
  const [escolherVeiculo, setEscolherVeiculo] = useState(false);
  const [veiculoSelecionado, setVeiculoSelecionado] = useState<VeiculoParsed | null>(null);
  const [exportando, setExportando] = useState(false);
  const [processando, setProcessando] = useState(false);

  async function recarregar() {
    try {
      const lista = await listRepasses();
      setRepasses(lista);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showErrorToast(`Erro ao carregar repasses: ${msg}`);
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    void recarregar();
  }, []);

  const filtrados = useMemo(() => {
    return repasses.filter((r) => {
      if (statusFiltro !== "todos" && r.status !== statusFiltro) return false;
      if (lojaFiltro !== "all" && String(r.loja_origem ?? "") !== lojaFiltro) return false;
      // Período aplica sobre data_marcado (ou data_subido se status='subido')
      const ref = r.status === "subido" ? r.data_subido : r.data_marcado;
      if (periodoIni && ref && ref < periodoIni) return false;
      if (periodoFim && ref && ref > periodoFim) return false;
      return true;
    });
  }, [repasses, statusFiltro, lojaFiltro, periodoIni, periodoFim]);

  const kpis = useMemo(() => {
    const marcados = repasses.filter((r) => r.status === "marcado");
    const subidos = repasses.filter((r) => r.status === "subido").length;
    let capitalTravado = 0;
    for (const r of marcados) {
      if (r.preco_atual != null) capitalTravado += r.preco_atual;
    }
    return { marcados: marcados.length, subidos, capitalTravado };
  }, [repasses]);

  const lojaOpcoes = useMemo(() => {
    const set = new Set<number>();
    for (const r of repasses) if (r.loja_origem != null) set.add(r.loja_origem);
    return [...set].sort((a, b) => a - b);
  }, [repasses]);

  const selecionadosArr = useMemo(
    () => filtrados.filter((r) => selecionados.has(r.id)),
    [filtrados, selecionados],
  );

  function toggleTodos() {
    if (selecionadosArr.length === filtrados.length && filtrados.length > 0) {
      setSelecionados(new Set());
    } else {
      setSelecionados(new Set(filtrados.map((r) => r.id)));
    }
  }

  function toggleUm(id: number) {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleMarcarSubido(id: number) {
    if (processando) return;
    setProcessando(true);
    try {
      const atualizado = await marcarComoSubido(id);
      setRepasses((prev) => prev.map((r) => (r.id === id ? atualizado : r)));
      showSuccessToast("Marcado como subido.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showErrorToast(msg);
    } finally {
      setProcessando(false);
    }
  }

  async function handleMarcarSubidoBulk() {
    if (processando || selecionadosArr.length === 0) return;
    const marcaveis = selecionadosArr.filter((r) => r.status === "marcado");
    if (marcaveis.length === 0) {
      showErrorToast("Nenhum dos selecionados está com status 'marcado'.");
      return;
    }
    setProcessando(true);
    try {
      const n = await marcarVariosComoSubido(marcaveis.map((r) => r.id));
      showSuccessToast(`${n} carro${n === 1 ? "" : "s"} marcado${n === 1 ? "" : "s"} como subido${n === 1 ? "" : "s"}.`);
      await recarregar();
      setSelecionados(new Set());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showErrorToast(msg);
    } finally {
      setProcessando(false);
    }
  }

  async function handleRemover(id: number) {
    if (processando) return;
    if (!window.confirm("Remover esse carro da lista de repasses?")) return;
    setProcessando(true);
    try {
      // Captura chassi ANTES do delete pra propagar no map global de
      // chassis em repasse (estoque atualiza sem reload).
      const alvo = repasses.find((r) => r.id === id);
      await deleteRepasse(id);
      if (alvo) removerChassiEmRepasse(alvo.chassi);
      setRepasses((prev) => prev.filter((r) => r.id !== id));
      setSelecionados((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      showSuccessToast("Removido.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showErrorToast(msg);
    } finally {
      setProcessando(false);
    }
  }

  async function handleRemoverBulk() {
    if (processando || selecionadosArr.length === 0) return;
    if (!window.confirm(`Remover ${selecionadosArr.length} carro(s) da lista?`)) return;
    setProcessando(true);
    try {
      const ids = selecionadosArr.map((r) => r.id);
      const chassisRemovidos = selecionadosArr.map((r) => r.chassi);
      const n = await deleteRepasses(ids);
      for (const chassi of chassisRemovidos) removerChassiEmRepasse(chassi);
      showSuccessToast(`${n} removido${n === 1 ? "" : "s"}.`);
      await recarregar();
      setSelecionados(new Set());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showErrorToast(msg);
    } finally {
      setProcessando(false);
    }
  }

  async function exportarLista(lista: ReadonlyArray<Repasse>) {
    if (exportando || lista.length === 0) return;
    setExportando(true);
    try {
      const buf = await gerarRelatorioRepasseProfissional(lista);
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
      showSuccessToast(`${lista.length} carro(s) exportado(s).`);
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
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi
          icon={<TruckIcon className="h-4 w-4" />}
          label="Marcados pra subir"
          value={String(kpis.marcados)}
          tone="warn"
        />
        <Kpi
          icon={<CheckCircle2 className="h-4 w-4" />}
          label="Já subidos"
          value={String(kpis.subidos)}
          tone="good"
        />
        <Kpi
          icon={<Wallet className="h-4 w-4" />}
          label="Capital travado (marcados)"
          value={formatBRL(kpis.capitalTravado)}
          tone="info"
        />
      </div>

      {/* Filtros + ações topo */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] p-4">
        <div className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
          <Filter className="h-3 w-3" /> Filtros:
        </div>

        <div className="flex flex-wrap gap-1.5">
          {(["marcado", "subido", "todos"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFiltro(s)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition",
                statusFiltro === s
                  ? "border-[var(--brand-600)] bg-[var(--brand-50)] text-[var(--brand-900)] dark:bg-[var(--brand-900)]/30 dark:text-[var(--brand-100)]"
                  : "border-[var(--border-base)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:bg-[var(--bg-muted)]",
              )}
            >
              {s === "marcado" ? "Marcados" : s === "subido" ? "Subidos" : "Todos"}
            </button>
          ))}
        </div>

        <label className="inline-flex items-center gap-1.5 text-xs">
          <span className="text-[var(--text-muted)]">De:</span>
          <input
            type="date"
            value={periodoIni}
            onChange={(e) => setPeriodoIni(e.target.value)}
            className="rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-2 py-1 text-xs"
          />
        </label>
        <label className="inline-flex items-center gap-1.5 text-xs">
          <span className="text-[var(--text-muted)]">Até:</span>
          <input
            type="date"
            value={periodoFim}
            onChange={(e) => setPeriodoFim(e.target.value)}
            className="rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-2 py-1 text-xs"
          />
        </label>

        {lojaOpcoes.length > 0 && (
          <label className="inline-flex items-center gap-1.5 text-xs">
            <span className="text-[var(--text-muted)]">Loja:</span>
            <select
              value={lojaFiltro}
              onChange={(e) => setLojaFiltro(e.target.value)}
              className="rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-2 py-1 text-xs"
            >
              <option value="all">Todas</option>
              {lojaOpcoes.map((cod) => (
                <option key={cod} value={String(cod)}>
                  {nomeOuCodigo(lojas, cod)}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => exportarLista(filtrados)}
            disabled={exportando || filtrados.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs text-[var(--text-body)] hover:bg-[var(--bg-muted)] disabled:opacity-50"
          >
            {exportando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Exportar XLSX (todos os filtrados)
          </button>
          <button
            type="button"
            onClick={() => setEscolherVeiculo(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-[var(--brand-700)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--brand-800)]"
          >
            <Plus className="h-3.5 w-3.5" /> Marcar carro pra subir
          </button>
        </div>
      </div>

      {/* Toolbar bulk (aparece com seleção) */}
      {selecionadosArr.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--brand-500)] bg-[var(--brand-50)] px-4 py-2 text-xs dark:bg-[var(--brand-900)]/20">
          <span className="font-semibold text-[var(--brand-900)] dark:text-[var(--brand-100)]">
            {selecionadosArr.length} selecionado{selecionadosArr.length === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            onClick={handleMarcarSubidoBulk}
            disabled={processando}
            className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <CheckCircle2 className="h-3 w-3" /> Marcar {selecionadosArr.length} como subido(s)
          </button>
          <button
            type="button"
            onClick={() => exportarLista(selecionadosArr)}
            disabled={exportando}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-2.5 py-1 text-xs hover:bg-[var(--bg-muted)] disabled:opacity-50"
          >
            <Download className="h-3 w-3" /> Exportar XLSX dos selecionados
          </button>
          <button
            type="button"
            onClick={handleRemoverBulk}
            disabled={processando}
            className="inline-flex items-center gap-1 rounded-md border border-red-300 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-800 hover:bg-red-100 disabled:opacity-50 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
          >
            <Trash2 className="h-3 w-3" /> Remover {selecionadosArr.length}
          </button>
          <button
            type="button"
            onClick={() => setSelecionados(new Set())}
            className="ml-auto text-xs text-[var(--text-muted)] hover:text-[var(--text-strong)]"
          >
            Limpar seleção
          </button>
        </div>
      )}

      {/* Tabela */}
      {filtrados.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border-base)] bg-[var(--bg-surface)] p-12 text-center">
          <p className="text-[var(--text-muted)]">
            {repasses.length === 0
              ? "Nenhum carro marcado pra subir ainda."
              : "Nenhum carro com esses filtros."}
          </p>
          {repasses.length === 0 && (
            <button
              type="button"
              onClick={() => setEscolherVeiculo(true)}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-[var(--brand-700)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--brand-800)]"
            >
              <Plus className="h-3.5 w-3.5" /> Marcar primeiro carro
            </button>
          )}
        </div>
      ) : (
        <TabelaRepasses
          repasses={filtrados}
          lojas={lojas}
          selecionados={selecionados}
          onToggleUm={toggleUm}
          onToggleTodos={toggleTodos}
          onMarcarSubido={handleMarcarSubido}
          onRemover={handleRemover}
          processando={processando}
        />
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
        <MarcarRepasseModal
          veiculo={veiculoSelecionado}
          open={true}
          onClose={() => setVeiculoSelecionado(null)}
          onSuccess={() => {
            setVeiculoSelecionado(null);
            void recarregar();
          }}
        />
      )}
    </div>
  );
}

function TabelaRepasses({
  repasses,
  lojas,
  selecionados,
  onToggleUm,
  onToggleTodos,
  onMarcarSubido,
  onRemover,
  processando,
}: {
  repasses: Repasse[];
  lojas: ReturnType<typeof useInventory>["lojas"];
  selecionados: Set<number>;
  onToggleUm: (id: number) => void;
  onToggleTodos: () => void;
  onMarcarSubido: (id: number) => void;
  onRemover: (id: number) => void;
  processando: boolean;
}) {
  const todosSelecionados =
    repasses.length > 0 && repasses.every((r) => selecionados.has(r.id));
  const algunsSelecionados = repasses.some((r) => selecionados.has(r.id));

  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)]">
      <table className="w-full text-sm">
        <thead className="border-b border-[var(--border-soft)] bg-[var(--bg-muted)] text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          <tr>
            <Th>
              <input
                type="checkbox"
                checked={todosSelecionados}
                ref={(el) => {
                  if (el) el.indeterminate = algunsSelecionados && !todosSelecionados;
                }}
                onChange={onToggleTodos}
                aria-label="Selecionar todos"
              />
            </Th>
            <Th>Placa</Th>
            <Th>Modelo</Th>
            <Th>Ano</Th>
            <Th className="text-right">KM</Th>
            <Th>Loja</Th>
            <Th>Pátio</Th>
            <Th className="text-right">Dias parado</Th>
            <Th className="text-right">Preço atual</Th>
            <Th className="text-right">Custo</Th>
            <Th>Status</Th>
            <Th>Data marcado</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {repasses.map((r) => {
            const dias = diasParado(r.data_marcado);
            return (
              <tr
                key={r.id}
                className={cn(
                  "border-b border-[var(--border-soft)] last:border-0 hover:bg-[var(--bg-muted)]",
                  selecionados.has(r.id) && "bg-[var(--brand-50)]/50 dark:bg-[var(--brand-900)]/10",
                )}
              >
                <Td>
                  <input
                    type="checkbox"
                    checked={selecionados.has(r.id)}
                    onChange={() => onToggleUm(r.id)}
                    aria-label={`Selecionar ${r.placa}`}
                  />
                </Td>
                <Td className="font-mono text-xs">{r.placa}</Td>
                <Td>
                  <div className="font-medium text-[var(--text-strong)]">{r.modelo}</div>
                  {r.marca && <div className="text-[10px] text-[var(--text-subtle)]">{r.marca}</div>}
                </Td>
                <Td className="text-xs text-[var(--text-muted)]">
                  {r.ano_modelo ?? "—"}
                </Td>
                <Td className="text-right text-xs tabular-nums">{formatInt(r.km)}</Td>
                <Td className="text-xs">{r.loja_origem != null ? nomeOuCodigo(lojas, r.loja_origem) : "—"}</Td>
                <Td className="text-xs">{r.patio_origem ?? "—"}</Td>
                <Td className="text-right text-xs tabular-nums">{dias != null ? `${dias}d` : "—"}</Td>
                <Td className="text-right tabular-nums">{formatBRL(r.preco_atual)}</Td>
                <Td className="text-right tabular-nums">{formatBRL(r.valor_aquisicao)}</Td>
                <Td>
                  <StatusBadge status={r.status} />
                </Td>
                <Td className="text-xs text-[var(--text-muted)]">{formatDataBR(r.data_marcado)}</Td>
                <Td>
                  <div className="flex items-center gap-2">
                    {r.status === "marcado" && (
                      <button
                        type="button"
                        onClick={() => onMarcarSubido(r.id)}
                        disabled={processando}
                        className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                        title="Marcar como subido pro Auto Avaliar"
                      >
                        <CheckCircle2 className="h-3 w-3" /> Já subi
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onRemover(r.id)}
                      disabled={processando}
                      className="inline-flex items-center gap-1 text-[11px] text-red-700 hover:underline disabled:opacity-50 dark:text-red-400"
                      title="Remover da lista"
                    >
                      <Trash2 className="h-3 w-3" /> Remover
                    </button>
                  </div>
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
    status === "subido"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
      : status === "cancelado"
        ? "bg-[var(--bg-muted)] text-[var(--text-muted)]"
        : "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300";
  const icone = status === "subido" ? "🟢" : status === "cancelado" ? "⚪" : "🟡";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold", cor)}>
      <span>{icone}</span>
      {STATUS_LABEL[status]}
    </span>
  );
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

function formatDataBR(yyyymmdd: string | null): string {
  if (!yyyymmdd) return "—";
  const [y, m, d] = yyyymmdd.split("-");
  if (!y || !m || !d) return yyyymmdd;
  return `${d}/${m}/${y}`;
}

function diasParado(dataMarcado: string | null): number | null {
  if (!dataMarcado) return null;
  const [y, m, d] = dataMarcado.split("-").map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  const hoje = new Date();
  const ms = hoje.getTime() - dt.getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}
