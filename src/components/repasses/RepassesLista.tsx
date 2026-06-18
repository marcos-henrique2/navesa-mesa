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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  Loader2,
  Plus,
  TruckIcon,
  Wallet,
  Filter,
  FilterX,
  CheckCircle2,
  Trash2,
  FileText,
  Search,
} from "lucide-react";
import {
  deleteRepasse,
  deleteRepasses,
  listRepasses,
  marcarComoSubido,
  marcarVariosComoSubido,
  updateRepasseCampos,
  type RepasseCamposManuaisPatch,
} from "@/lib/repasses/queries";
import type {
  CautelarStatus,
  DocStatus,
  IpvaStatus,
  Repasse,
  RepasseStatus,
} from "@/lib/repasses/types";
import {
  CAUTELAR_LABEL,
  CAUTELAR_VALUES,
  DOC_LABEL,
  DOC_VALUES,
  IPVA_LABEL,
  IPVA_VALUES,
  STATUS_LABEL,
} from "@/lib/repasses/types";
import { gerarRelatorioRepasseProfissional } from "@/lib/export/relatorio-repasse-xlsx";
import { useChassisEmRepasse } from "@/lib/repasses/useChassisEmRepasse";
import { usePersistedState } from "@/lib/hooks/usePersistedState";
import { useInventory, nomeOuCodigo } from "@/lib/store/inventory";
import { estaReservado } from "@/lib/inventory/reservado";
import { cn, formatBRL, formatBRLCents, formatInt } from "@/lib/utils";
import { parseValorBR } from "@/lib/utils/parse-br";
import { placaCasa } from "@/lib/utils/placa";
import { calcularValorPraSubir } from "@/lib/repasses/kpis";
import { showErrorToast, showSuccessToast } from "@/components/ui/Toast";
import { MarcarRepasseModal } from "./MarcarRepasseModal";
import { EscolherVeiculoModal } from "./EscolherVeiculoModal";
import { AnuncioModal } from "./AnuncioModal";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";

type StatusFiltro = "marcado" | "subido" | "todos";

export function RepassesLista() {
  const { lojas, veiculos } = useInventory();
  // Map chassi → dias_patio ATUAL do estoque (não snapshot da marcação).
  // Marcos espera ver dias de pátio reais — quanto tempo o carro está parado.
  const diasPatioPorChassi = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const v of veiculos) m.set(v.chassi, v.dias_patio);
    return m;
  }, [veiculos]);
  // Map chassi → reservado ATUAL do estoque (cod_proposta != null). Igual ao
  // diasPatioPorChassi: status vem do estoque vivo, não do snapshot do repasse —
  // a reserva muda com o tempo. Aviso pra Marcos não subir no Auto Avaliar.
  const reservadoPorChassi = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const v of veiculos) m.set(v.chassi, estaReservado(v));
    return m;
  }, [veiculos]);
  const { removerLocalmente: removerChassiEmRepasse } = useChassisEmRepasse();
  const [repasses, setRepasses] = useState<Repasse[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [statusFiltro, setStatusFiltro] = usePersistedState<StatusFiltro>(
    "repasses:status:v2",
    "todos",
  );
  // Período persistido (consistente com statusFiltro e lojaFiltro).
  const [periodoIni, setPeriodoIni] = usePersistedState<string>("repasses:periodoIni", "");
  const [periodoFim, setPeriodoFim] = usePersistedState<string>("repasses:periodoFim", "");
  const [lojaFiltro, setLojaFiltro] = usePersistedState<string>("repasses:loja", "all");
  // Busca por placa — não persiste (filtro efêmero). Normalização tolerante a
  // hífen/espaço/case fica no helper puro placaCasa.
  const [buscaPlaca, setBuscaPlaca] = useState("");
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set());
  const [escolherVeiculo, setEscolherVeiculo] = useState(false);
  const [veiculoSelecionado, setVeiculoSelecionado] = useState<VeiculoParsed | null>(null);
  const [anuncioRepasse, setAnuncioRepasse] = useState<Repasse | null>(null);
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
      if (!placaCasa(r.placa, buscaPlaca)) return false;
      // Período aplica sobre data_marcado (ou data_subido se status='subido')
      const ref = r.status === "subido" ? r.data_subido : r.data_marcado;
      if (periodoIni && ref && ref < periodoIni) return false;
      if (periodoFim && ref && ref > periodoFim) return false;
      return true;
    });
  }, [repasses, statusFiltro, lojaFiltro, periodoIni, periodoFim, buscaPlaca]);

  const kpis = useMemo(() => {
    const marcados = repasses.filter((r) => r.status === "marcado");
    const subidos = repasses.filter((r) => r.status === "subido").length;
    let capitalTravado = 0;
    for (const r of marcados) {
      if (r.preco_atual != null) capitalTravado += r.preco_atual;
    }
    const valorPraSubir = calcularValorPraSubir(repasses);
    return { marcados: marcados.length, subidos, capitalTravado, valorPraSubir };
  }, [repasses]);

  const lojaOpcoes = useMemo(() => {
    const set = new Set<number>();
    for (const r of repasses) if (r.loja_origem != null) set.add(r.loja_origem);
    return [...set].sort((a, b) => a - b);
  }, [repasses]);

  const filtrosAtivos =
    (statusFiltro !== "todos" ? 1 : 0) +
    (lojaFiltro !== "all" ? 1 : 0) +
    (periodoIni ? 1 : 0) +
    (periodoFim ? 1 : 0) +
    (buscaPlaca.trim() !== "" ? 1 : 0);

  function limparFiltrosRepasses() {
    if (filtrosAtivos === 0) return;
    setStatusFiltro("todos");
    setLojaFiltro("all");
    setPeriodoIni("");
    setPeriodoFim("");
    setBuscaPlaca("");
    showSuccessToast("Filtros limpos");
  }

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

  /**
   * Patch otimista nos campos manuais. Atualiza UI imediatamente; salva em
   * background. Se Supabase reclamar (CHECK fail, network) reverte o estado.
   *
   * Não aciona spinner global `processando` — edição inline precisa fluir
   * sem bloquear o resto da tela.
   */
  const handlePatchCampos = useCallback(
    async (id: number, patch: RepasseCamposManuaisPatch) => {
      // Snapshot pra rollback.
      const anterior = repasses.find((r) => r.id === id);
      if (!anterior) return;

      // Aplica otimista no estado local.
      setRepasses((prev) =>
        prev.map((r) =>
          r.id === id
            ? {
                ...r,
                ...("ipva_status" in patch ? { ipva_status: patch.ipva_status ?? null } : {}),
                ...("documentacao_status" in patch
                  ? { documentacao_status: patch.documentacao_status ?? null }
                  : {}),
                ...("cautelar_status_manual" in patch
                  ? { cautelar_status_manual: patch.cautelar_status_manual ?? null }
                  : {}),
                ...("valor_subir" in patch ? { valor_subir: patch.valor_subir ?? null } : {}),
                ...("observacoes" in patch ? { observacoes: patch.observacoes ?? null } : {}),
              }
            : r,
        ),
      );

      try {
        const atualizado = await updateRepasseCampos(id, patch);
        // Substitui pelo retorno autoritativo do banco (ex.: trim de string vazia).
        setRepasses((prev) => prev.map((r) => (r.id === id ? atualizado : r)));
      } catch (err) {
        // Rollback: volta ao estado anterior.
        setRepasses((prev) => prev.map((r) => (r.id === id ? anterior : r)));
        const msg = err instanceof Error ? err.message : String(err);
        showErrorToast(`Erro ao salvar: ${msg}`);
      }
    },
    [repasses],
  );

  async function exportarLista(lista: ReadonlyArray<Repasse>) {
    if (exportando || lista.length === 0) return;
    setExportando(true);
    try {
      const buf = await gerarRelatorioRepasseProfissional(
        lista,
        diasPatioPorChassi,
        reservadoPorChassi,
      );
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
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
        <Kpi
          icon={<Wallet className="h-4 w-4" />}
          label="Valor pra subir"
          value={formatBRLCents(kpis.valorPraSubir.total)}
          hint={`${kpis.valorPraSubir.comValor} de ${kpis.valorPraSubir.totalSubidos} com valor`}
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

        <label className="relative inline-flex items-center">
          <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-[var(--text-muted)]" />
          <input
            type="text"
            value={buscaPlaca}
            onChange={(e) => setBuscaPlaca(e.target.value)}
            placeholder="Buscar placa..."
            aria-label="Buscar por placa"
            className="w-40 rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] py-1 pl-7 pr-2 text-xs focus:border-[var(--brand-500)] focus:outline-none"
          />
        </label>

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

        <button
          type="button"
          onClick={limparFiltrosRepasses}
          disabled={filtrosAtivos === 0}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition",
            filtrosAtivos > 0
              ? "border-red-300 bg-red-50 text-red-800 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
              : "cursor-not-allowed border-[var(--border-soft)] bg-[var(--bg-surface)] text-[var(--text-subtle)] opacity-60",
          )}
          title={filtrosAtivos > 0 ? `Limpar ${filtrosAtivos} filtro${filtrosAtivos === 1 ? "" : "s"} ativo${filtrosAtivos === 1 ? "" : "s"}` : "Nenhum filtro ativo"}
          aria-label="Limpar todos os filtros"
        >
          <FilterX className="h-3 w-3" />
          Limpar filtros
          {filtrosAtivos > 0 && (
            <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
              {filtrosAtivos}
            </span>
          )}
        </button>

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
          diasPatioPorChassi={diasPatioPorChassi}
          reservadoPorChassi={reservadoPorChassi}
          selecionados={selecionados}
          onToggleUm={toggleUm}
          onToggleTodos={toggleTodos}
          onMarcarSubido={handleMarcarSubido}
          onRemover={handleRemover}
          onPatchCampos={handlePatchCampos}
          onGerarAnuncio={setAnuncioRepasse}
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

      {anuncioRepasse && (
        <AnuncioModal
          key={anuncioRepasse.id}
          repasse={anuncioRepasse}
          open={true}
          onClose={() => setAnuncioRepasse(null)}
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
  onPatchCampos,
  onGerarAnuncio,
  processando,
  diasPatioPorChassi,
  reservadoPorChassi,
}: {
  repasses: Repasse[];
  lojas: ReturnType<typeof useInventory>["lojas"];
  diasPatioPorChassi: Map<string, number | null>;
  reservadoPorChassi: Map<string, boolean>;
  selecionados: Set<number>;
  onToggleUm: (id: number) => void;
  onToggleTodos: () => void;
  onMarcarSubido: (id: number) => void;
  onRemover: (id: number) => void;
  onPatchCampos: (id: number, patch: RepasseCamposManuaisPatch) => void | Promise<void>;
  onGerarAnuncio: (repasse: Repasse) => void;
  processando: boolean;
}) {
  const todosSelecionados =
    repasses.length > 0 && repasses.every((r) => selecionados.has(r.id));
  const algunsSelecionados = repasses.some((r) => selecionados.has(r.id));

  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)]">
      {/*
       * `min-w-max` força a tabela a crescer pra acomodar todas as colunas com
       * espaço respiratório (os min-w dos selects/inputs viram lei). Quando o
       * total ultrapassa a largura disponível, o `overflow-x-auto` do parent
       * ativa scroll horizontal. Placa e Ações ficam sticky pra navegação.
       */}
      <table className="min-w-max text-sm">
        <thead className="border-b border-[var(--border-soft)] bg-[var(--bg-muted)] text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          <tr>
            <Th className="sticky left-0 z-20 bg-[var(--bg-muted)]">
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
            <Th className="sticky left-[44px] z-20 bg-[var(--bg-muted)]">Placa</Th>
            <Th>Modelo</Th>
            <Th>Ano</Th>
            <Th className="text-right">KM</Th>
            <Th>Loja</Th>
            <Th>Pátio</Th>
            <Th className="text-right">Dias pátio</Th>
            <Th className="text-right">Preço atual</Th>
            <Th className="text-right">Custo</Th>
            {/* Campos manuais (Caminho B — inline edit) */}
            <Th>IPVA</Th>
            <Th>Doc</Th>
            <Th>Cautelar</Th>
            <Th className="text-right">Valor pra subir</Th>
            <Th>Observação</Th>
            <Th>Status</Th>
            <Th>Data marcado</Th>
            <Th className="sticky right-0 z-20 bg-[var(--bg-muted)]" />
          </tr>
        </thead>
        <tbody>
          {repasses.map((r) => {
            const dias = diasPatioPorChassi.get(r.chassi) ?? null;
            const reservado = reservadoPorChassi.get(r.chassi) === true;
            const isSel = selecionados.has(r.id);
            // bg que as células sticky precisam carregar pra não ficarem transparentes
            // ao scroll horizontal. Tem que casar com row normal/selecionada/hover.
            const stickyBg = isSel
              ? "bg-[var(--brand-50)] group-hover:bg-[var(--brand-100)] dark:bg-[#1a2540] dark:group-hover:bg-[#23304f]"
              : "bg-[var(--bg-surface)] group-hover:bg-[var(--bg-muted)]";
            return (
              <tr
                key={r.id}
                className={cn(
                  "group border-b border-[var(--border-soft)] last:border-0 hover:bg-[var(--bg-muted)]",
                  isSel && "bg-[var(--brand-50)]/50 dark:bg-[var(--brand-900)]/10",
                )}
              >
                <Td className={cn("sticky left-0 z-10", stickyBg)}>
                  <input
                    type="checkbox"
                    checked={isSel}
                    onChange={() => onToggleUm(r.id)}
                    aria-label={`Selecionar ${r.placa}`}
                  />
                </Td>
                <Td className={cn("sticky left-[44px] z-10 font-mono text-xs", stickyBg)}>{r.placa}</Td>
                <Td>
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-[var(--text-strong)]">{r.modelo}</span>
                    {reservado && (
                      <span
                        className="inline-flex items-center rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-800 dark:bg-red-950/40 dark:text-red-300"
                        title="Carro reservado no estoque — não subir no Auto Avaliar"
                      >
                        Reservado
                      </span>
                    )}
                  </div>
                  {r.marca && <div className="text-[10px] text-[var(--text-subtle)]">{r.marca}</div>}
                </Td>
                <Td className="text-xs text-[var(--text-muted)]">{r.ano_modelo ?? "—"}</Td>
                <Td className="text-right text-xs tabular-nums">{formatInt(r.km)}</Td>
                <Td className="text-xs">
                  {r.loja_origem != null ? nomeOuCodigo(lojas, r.loja_origem) : "—"}
                </Td>
                <Td className="text-xs">{r.patio_origem ?? "—"}</Td>
                <Td className="text-right text-xs tabular-nums">{dias != null ? `${dias}d` : "—"}</Td>
                <Td className="text-right tabular-nums">{formatBRL(r.preco_atual)}</Td>
                <Td className="text-right tabular-nums">{formatBRL(r.valor_aquisicao)}</Td>

                {/* IPVA */}
                <Td>
                  <IpvaSelect
                    value={r.ipva_status}
                    onChange={(v) => void onPatchCampos(r.id, { ipva_status: v })}
                    placa={r.placa}
                  />
                </Td>

                {/* Doc */}
                <Td>
                  <DocSelect
                    value={r.documentacao_status}
                    onChange={(v) => void onPatchCampos(r.id, { documentacao_status: v })}
                    placa={r.placa}
                  />
                </Td>

                {/* Cautelar manual */}
                <Td>
                  <CautelarSelect
                    value={r.cautelar_status_manual}
                    onChange={(v) => void onPatchCampos(r.id, { cautelar_status_manual: v })}
                    placa={r.placa}
                  />
                </Td>

                {/* Valor pra subir (o lance que vai dar) */}
                <Td className="text-right">
                  <ValorInput
                    value={r.valor_subir}
                    onCommit={(v) => void onPatchCampos(r.id, { valor_subir: v })}
                    ariaLabel={`Valor pra subir de ${r.placa}`}
                  />
                </Td>

                {/* Observação */}
                <Td>
                  <ObservacaoInput
                    value={r.observacoes}
                    onCommit={(v) => void onPatchCampos(r.id, { observacoes: v })}
                    placa={r.placa}
                  />
                </Td>

                <Td>
                  <StatusBadge status={r.status} />
                </Td>
                <Td className="text-xs text-[var(--text-muted)]">{formatDataBR(r.data_marcado)}</Td>
                <Td className={cn("sticky right-0 z-10", stickyBg)}>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onGerarAnuncio(r)}
                      className="inline-flex items-center gap-1 rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-body)] hover:bg-[var(--bg-muted)]"
                      title="Gerar texto de anúncio pro Auto Avaliar"
                      aria-label={`Gerar anúncio de ${r.placa}`}
                    >
                      <FileText className="h-3 w-3" /> Anúncio
                    </button>
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

// ─── Inline edit components ─────────────────────────────────────────────────

const SELECT_BASE =
  "w-full rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-1.5 py-0.5 text-[11px] text-[var(--text-body)] focus:border-[var(--brand-500)] focus:outline-none";

/** Cor de fundo do select por status preenchido. Cells vazias mantêm bg neutro. */
function corIpva(s: IpvaStatus | null): string {
  if (s === "pago") return "bg-emerald-50 dark:bg-emerald-950/30";
  if (s === "em_aberto") return "bg-amber-50 dark:bg-amber-950/30";
  if (s === "nao_verificado") return "bg-[var(--bg-muted)]";
  return "";
}
function corDoc(s: DocStatus | null): string {
  if (s === "ok") return "bg-emerald-50 dark:bg-emerald-950/30";
  if (s === "pendente") return "bg-amber-50 dark:bg-amber-950/30";
  if (s === "irregular") return "bg-red-50 dark:bg-red-950/30";
  if (s === "nao_verificado") return "bg-[var(--bg-muted)]";
  return "";
}
function corCautelar(s: CautelarStatus | null): string {
  if (s === "limpa") return "bg-emerald-50 dark:bg-emerald-950/30";
  if (s === "com_restricao") return "bg-red-50 dark:bg-red-950/30";
  if (s === "nao_verificada") return "bg-[var(--bg-muted)]";
  return "";
}

function IpvaSelect({
  value,
  onChange,
  placa,
}: {
  value: IpvaStatus | null;
  onChange: (v: IpvaStatus | null) => void;
  placa: string;
}) {
  return (
    <select
      aria-label={`IPVA de ${placa}`}
      className={cn(SELECT_BASE, "min-w-[130px]", corIpva(value))}
      value={value ?? ""}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === "" ? null : (v as IpvaStatus));
      }}
    >
      <option value="">—</option>
      {IPVA_VALUES.map((v) => (
        <option key={v} value={v}>
          {IPVA_LABEL[v]}
        </option>
      ))}
    </select>
  );
}

function DocSelect({
  value,
  onChange,
  placa,
}: {
  value: DocStatus | null;
  onChange: (v: DocStatus | null) => void;
  placa: string;
}) {
  return (
    <select
      aria-label={`Documentação de ${placa}`}
      className={cn(SELECT_BASE, "min-w-[140px]", corDoc(value))}
      value={value ?? ""}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === "" ? null : (v as DocStatus));
      }}
    >
      <option value="">—</option>
      {DOC_VALUES.map((v) => (
        <option key={v} value={v}>
          {DOC_LABEL[v]}
        </option>
      ))}
    </select>
  );
}

function CautelarSelect({
  value,
  onChange,
  placa,
}: {
  value: CautelarStatus | null;
  onChange: (v: CautelarStatus | null) => void;
  placa: string;
}) {
  return (
    <select
      aria-label={`Cautelar de ${placa}`}
      className={cn(SELECT_BASE, "min-w-[140px]", corCautelar(value))}
      value={value ?? ""}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === "" ? null : (v as CautelarStatus));
      }}
    >
      <option value="">—</option>
      {CAUTELAR_VALUES.map((v) => (
        <option key={v} value={v}>
          {CAUTELAR_LABEL[v]}
        </option>
      ))}
    </select>
  );
}

/**
 * Input genérico pra valor R$. Mantém estado local (string) durante edição;
 * commita no banco apenas no blur ou Enter — evita request a cada tecla.
 * Sem debounce porque o blur já cobre o caso natural de "perdi o foco".
 *
 * Usado por "Valor pra subir" (parser BR, commit no blur/Enter, Escape reverte).
 */
function ValorInput({
  value,
  onCommit,
  ariaLabel,
}: {
  value: number | null;
  onCommit: (v: number | null) => void;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState<string>(value != null ? String(value) : "");

  // Sincroniza quando a prop muda (ex.: rollback de erro vindo do pai).
  useEffect(() => {
    setDraft(value != null ? String(value) : "");
  }, [value]);

  function commit() {
    const parsed = parseValorBR(draft);
    if (parsed === value) return; // sem mudança
    onCommit(parsed);
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={ariaLabel}
      placeholder="R$"
      className={cn(
        "w-full min-w-[140px] rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-1.5 py-0.5 text-right text-[11px] tabular-nums text-[var(--text-body)] focus:border-[var(--brand-500)] focus:outline-none",
        value != null && "bg-emerald-50 dark:bg-emerald-950/30",
      )}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          setDraft(value != null ? String(value) : "");
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/**
 * Input de observação inline. Commit no blur ou Enter (sem nova linha — texto
 * curto, livre). Truncamento natural via overflow do input (não precisa de
 * preview separado).
 */
function ObservacaoInput({
  value,
  onCommit,
  placa,
}: {
  value: string | null;
  onCommit: (v: string | null) => void;
  placa: string;
}) {
  const [draft, setDraft] = useState<string>(value ?? "");

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  // Debounce 600ms — caso usuário digite muito sem dar blur.
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * `override` existe pra evitar stale closure: como `setDraft` é async, o
   * draft do state no onChange seguinte ainda reflete o render anterior.
   * Quando o caller já tem o valor "fresh" (ex.: e.target.value), passa via
   * override pra garantir que o commit use o que o usuário acabou de digitar.
   */
  function commit(immediate: boolean, override?: string) {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    const fonte = override ?? draft;
    const novo = fonte.trim() === "" ? null : fonte;
    const atual = value ?? null;
    if (novo === atual) return;
    if (immediate) {
      onCommit(novo);
    } else {
      timeoutRef.current = setTimeout(() => onCommit(novo), 600);
    }
  }

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return (
    <input
      type="text"
      aria-label={`Observação de ${placa}`}
      placeholder="—"
      className="w-full min-w-[220px] truncate rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-1.5 py-0.5 text-[11px] text-[var(--text-body)] focus:border-[var(--brand-500)] focus:outline-none"
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        commit(false, e.target.value);
      }}
      onBlur={() => commit(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          setDraft(value ?? "");
          e.currentTarget.blur();
        }
      }}
    />
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
  hint,
  tone = "neutro",
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  hint?: string;
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
      <p className={cn("mt-1 text-xl font-bold tabular-nums", toneClass)}>
        {value}
        {hint && (
          <span className="ml-1 align-middle text-[11px] font-medium text-[var(--text-muted)]">
            · {hint}
          </span>
        )}
      </p>
    </div>
  );
}

function formatDataBR(yyyymmdd: string | null): string {
  if (!yyyymmdd) return "—";
  const [y, m, d] = yyyymmdd.split("-");
  if (!y || !m || !d) return yyyymmdd;
  return `${d}/${m}/${y}`;
}
