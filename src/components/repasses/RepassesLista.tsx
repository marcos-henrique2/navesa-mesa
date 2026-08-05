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
import Link from "next/link";
import {
  Download,
  Loader2,
  Plus,
  TruckIcon,
  Wallet,
  Filter,
  FilterX,
  CheckCircle2,
  XCircle,
  TrendingUp,
  Percent,
  RotateCcw,
  Trash2,
  FileText,
  Search,
  Users,
  BarChart3,
} from "lucide-react";
import {
  deleteRepasse,
  deleteRepasses,
  listGastosPorRepasse,
  listRepasses,
  marcarComoSubido,
  marcarComoVendido,
  marcarComoNaoVendido,
  reverterParaSubido,
  marcarVariosComoSubido,
  updateRepasseCampos,
  type MarcarVendidoInput,
  type RepasseCamposManuaisPatch,
} from "@/lib/repasses/queries";
import { contarInteressesPorRepasse } from "@/lib/leads/interesses";
import { calcularMargemVenda, classificarMargemVenda } from "@/lib/repasses/margem-venda";
import {
  COR_MARGEM_LABEL,
  type CorMargem,
} from "@/lib/repasses/margem-repasse";
import type {
  CautelarStatus,
  DocStatus,
  IpvaResponsavel,
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
  IPVA_RESPONSAVEL_LABEL,
  IPVA_RESPONSAVEL_VALUES,
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
import { calcularBonus } from "@/lib/repasses/bonus";
import { showErrorToast, showSuccessToast } from "@/components/ui/Toast";
import { MarcarRepasseModal } from "./MarcarRepasseModal";
import { MarcarVendidoModal } from "./MarcarVendidoModal";
import { MarcarNaoVendidoModal } from "./MarcarNaoVendidoModal";
import { EscolherVeiculoModal } from "./EscolherVeiculoModal";
import { AnuncioModal } from "./AnuncioModal";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";

type StatusFiltro = "marcado" | "subido" | "vendido" | "nao_vendido" | "todos";

const STATUS_FILTROS: ReadonlyArray<{ value: StatusFiltro; label: string }> = [
  { value: "marcado", label: "Marcados" },
  { value: "subido", label: "Subidos" },
  { value: "vendido", label: "Vendidos" },
  { value: "nao_vendido", label: "Não vendidos" },
  { value: "todos", label: "Todos" },
];

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
  // Map repasse_id → qtd de interessados (badge "Interessados (N)"). Carregado
  // em paralelo; falha aqui não derruba a lista de repasses.
  const [interessadosPorRepasse, setInteressadosPorRepasse] = useState<Map<number, number>>(
    new Map(),
  );
  // Map repasse_id → valores de repasse_gastos. Junto com valor_compra_repasse
  // forma o custo_real da REGRA DE OURO (margem-repasse.ts). Sem ele a margem
  // sairia subestimada. Falha aqui não derruba a lista — margem fica neutra.
  const [gastosPorRepasse, setGastosPorRepasse] = useState<Map<number, number[]>>(new Map());
  const [carregando, setCarregando] = useState(true);
  const [statusFiltro, setStatusFiltro] = usePersistedState<StatusFiltro>(
    "repasses:status:v3",
    "subido",
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
  const [vendidoRepasse, setVendidoRepasse] = useState<Repasse | null>(null);
  const [naoVendidoRepasse, setNaoVendidoRepasse] = useState<Repasse | null>(null);
  const [exportando, setExportando] = useState(false);
  const [processando, setProcessando] = useState(false);

  async function recarregar() {
    try {
      const lista = await listRepasses();
      setRepasses(lista);
      // Gastos alimentam o custo_real da margem — só faz sentido depois da lista.
      try {
        setGastosPorRepasse(await listGastosPorRepasse(lista.map((r) => r.id)));
      } catch {
        // silencioso — carros ficam sem gasto somado (cor neutra onde faltar dado)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showErrorToast(`Erro ao carregar repasses: ${msg}`);
    } finally {
      setCarregando(false);
    }
    // Contagem de interessados — independente: falha não bloqueia a lista.
    try {
      setInteressadosPorRepasse(await contarInteressesPorRepasse());
    } catch {
      // silencioso — badge fica zerado
    }
  }

  useEffect(() => {
    void recarregar();
  }, []);

  const filtrados = useMemo(() => {
    return repasses.filter((r) => {
      if (statusFiltro !== "todos" && r.status !== statusFiltro) return false;
      if (lojaFiltro !== "all" && String(r.loja_origem ?? "") !== lojaFiltro) return false;
      if (buscaPlaca.trim() !== "") {
        // Acha por placa (normaliza hífen) OU por nome do modelo (contém o termo).
        const termo = buscaPlaca.trim().toLowerCase();
        if (!placaCasa(r.placa, buscaPlaca) && !r.modelo.toLowerCase().includes(termo)) return false;
      }
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

    // Desfecho da venda.
    const vendidos = repasses.filter((r) => r.status === "vendido");
    const naoVendidos = repasses.filter((r) => r.status === "nao_vendido").length;
    let somaVendido = 0;
    let margemReal = 0;
    // Quantos vendidos têm custo_real conhecido (valor_compra_repasse presente).
    // Os demais NÃO entram na soma — cair pra valor_aquisicao (custo de varejo)
    // subestimaria a margem. Melhor mostrar o denominador do que mentir no total.
    let margemComCusto = 0;
    for (const r of vendidos) {
      if (r.valor_vendido != null) somaVendido += r.valor_vendido;
      const m = calcularMargemVenda(r, gastosPorRepasse.get(r.id) ?? []);
      if (m != null) {
        margemReal += m;
        margemComCusto += 1;
      }
    }
    // Conversão = vendidos ÷ (vendidos + não vendidos) — só dos que tiveram
    // desfecho. Sem desfecho → null (UI mostra "—").
    const comDesfecho = vendidos.length + naoVendidos;
    const conversao = comDesfecho > 0 ? (vendidos.length / comDesfecho) * 100 : null;

    return {
      marcados: marcados.length,
      subidos,
      capitalTravado,
      valorPraSubir,
      vendidos: vendidos.length,
      naoVendidos,
      somaVendido,
      margemReal,
      margemComCusto,
      conversao,
    };
  }, [repasses, gastosPorRepasse]);

  const lojaOpcoes = useMemo(() => {
    const set = new Set<number>();
    for (const r of repasses) if (r.loja_origem != null) set.add(r.loja_origem);
    return [...set].sort((a, b) => a - b);
  }, [repasses]);

  const filtrosAtivos =
    (statusFiltro !== "subido" ? 1 : 0) +
    (lojaFiltro !== "all" ? 1 : 0) +
    (periodoIni ? 1 : 0) +
    (periodoFim ? 1 : 0) +
    (buscaPlaca.trim() !== "" ? 1 : 0);

  function limparFiltrosRepasses() {
    if (filtrosAtivos === 0) return;
    setStatusFiltro("subido");
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

  async function handleMarcarVendido(id: number, input: MarcarVendidoInput) {
    const anterior = repasses.find((r) => r.id === id);
    if (!anterior) return;
    // Patch otimista: aplica desfecho previsto.
    setRepasses((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              status: "vendido",
              valor_vendido: input.valor_vendido,
              data_vendido: input.data_vendido ?? r.data_vendido,
              comprador: input.comprador ?? null,
            }
          : r,
      ),
    );
    try {
      const atualizado = await marcarComoVendido(id, input);
      setRepasses((prev) => prev.map((r) => (r.id === id ? atualizado : r)));
      setVendidoRepasse(null);
      showSuccessToast("Venda registrada.");
    } catch (err) {
      setRepasses((prev) => prev.map((r) => (r.id === id ? anterior : r)));
      const msg = err instanceof Error ? err.message : String(err);
      showErrorToast(msg);
    }
  }

  async function handleMarcarNaoVendido(id: number, motivo: string | null) {
    const anterior = repasses.find((r) => r.id === id);
    if (!anterior) return;
    setRepasses((prev) =>
      prev.map((r) => (r.id === id ? { ...r, status: "nao_vendido" } : r)),
    );
    try {
      const atualizado = await marcarComoNaoVendido(id, { motivo });
      setRepasses((prev) => prev.map((r) => (r.id === id ? atualizado : r)));
      setNaoVendidoRepasse(null);
      showSuccessToast("Marcado como não vendido.");
    } catch (err) {
      setRepasses((prev) => prev.map((r) => (r.id === id ? anterior : r)));
      const msg = err instanceof Error ? err.message : String(err);
      showErrorToast(msg);
    }
  }

  async function handleReverterSubido(id: number) {
    const anterior = repasses.find((r) => r.id === id);
    if (!anterior) return;
    setRepasses((prev) =>
      prev.map((r) =>
        r.id === id
          ? { ...r, status: "subido", valor_vendido: null, data_vendido: null, comprador: null }
          : r,
      ),
    );
    try {
      const atualizado = await reverterParaSubido(id);
      setRepasses((prev) => prev.map((r) => (r.id === id ? atualizado : r)));
      showSuccessToast("Repasse reaberto.");
    } catch (err) {
      setRepasses((prev) => prev.map((r) => (r.id === id ? anterior : r)));
      const msg = err instanceof Error ? err.message : String(err);
      showErrorToast(msg);
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
                ...("ipva_responsavel" in patch
                  ? { ipva_responsavel: patch.ipva_responsavel ?? null }
                  : {}),
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
      const buf = await gerarRelatorioRepasseProfissional(lista, diasPatioPorChassi);
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
          label="Subidos (aguardando desfecho)"
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
        <Kpi
          icon={<CheckCircle2 className="h-4 w-4" />}
          label="Vendidos"
          value={String(kpis.vendidos)}
          hint={formatBRL(kpis.somaVendido)}
          tone="good"
        />
        <Kpi
          icon={<TrendingUp className="h-4 w-4" />}
          label="Margem real"
          value={formatBRL(kpis.margemReal)}
          hint={`${kpis.margemComCusto} de ${kpis.vendidos} com custo de repasse`}
          tone={kpis.margemReal >= 0 ? "good" : "bad"}
        />
        <Kpi
          icon={<Percent className="h-4 w-4" />}
          label="Conversão"
          value={kpis.conversao == null ? "—" : `${kpis.conversao.toFixed(0)}%`}
          hint={
            kpis.conversao == null
              ? "sem desfecho ainda"
              : `${kpis.vendidos} de ${kpis.vendidos + kpis.naoVendidos}`
          }
          tone="info"
        />
        <Kpi
          icon={<XCircle className="h-4 w-4" />}
          label="Não vendidos"
          value={String(kpis.naoVendidos)}
          tone="bad"
        />
      </div>

      {/* Filtros + ações topo */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] p-4">
        <div className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
          <Filter className="h-3 w-3" /> Filtros:
        </div>

        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTROS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setStatusFiltro(opt.value)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition",
                statusFiltro === opt.value
                  ? "border-[var(--brand-600)] bg-[var(--brand-50)] text-[var(--brand-900)] dark:bg-[var(--brand-900)]/30 dark:text-[var(--brand-100)]"
                  : "border-[var(--border-base)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:bg-[var(--bg-muted)]",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <label className="relative inline-flex items-center">
          <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-[var(--text-muted)]" />
          <input
            type="text"
            value={buscaPlaca}
            onChange={(e) => setBuscaPlaca(e.target.value)}
            placeholder="Buscar placa ou modelo..."
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
          <Link
            href="/repasses/anuncio"
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--brand-300)] bg-[var(--brand-50)] px-3 py-1.5 text-xs font-medium text-[var(--brand-800)] hover:bg-[var(--brand-100)] dark:border-[var(--brand-800)] dark:bg-[var(--brand-900)]/20 dark:text-[var(--brand-200)]"
          >
            <BarChart3 className="h-3.5 w-3.5" /> Carros em anúncio (inteligência)
          </Link>
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
          onAbrirVendido={setVendidoRepasse}
          onAbrirNaoVendido={setNaoVendidoRepasse}
          onReverter={handleReverterSubido}
          onRemover={handleRemover}
          onPatchCampos={handlePatchCampos}
          onGerarAnuncio={setAnuncioRepasse}
          interessadosPorRepasse={interessadosPorRepasse}
          gastosPorRepasse={gastosPorRepasse}
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

      {vendidoRepasse && (
        <MarcarVendidoModal
          key={`vendido-${vendidoRepasse.id}`}
          repasse={vendidoRepasse}
          gastos={gastosPorRepasse.get(vendidoRepasse.id) ?? []}
          open={true}
          onClose={() => setVendidoRepasse(null)}
          onConfirm={(input) => handleMarcarVendido(vendidoRepasse.id, input)}
        />
      )}

      {naoVendidoRepasse && (
        <MarcarNaoVendidoModal
          key={`naovendido-${naoVendidoRepasse.id}`}
          repasse={naoVendidoRepasse}
          open={true}
          onClose={() => setNaoVendidoRepasse(null)}
          onConfirm={({ motivo }) => handleMarcarNaoVendido(naoVendidoRepasse.id, motivo)}
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
  onAbrirVendido,
  onAbrirNaoVendido,
  onReverter,
  onRemover,
  onPatchCampos,
  onGerarAnuncio,
  interessadosPorRepasse,
  gastosPorRepasse,
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
  onAbrirVendido: (repasse: Repasse) => void;
  onAbrirNaoVendido: (repasse: Repasse) => void;
  onReverter: (id: number) => void;
  onRemover: (id: number) => void;
  onPatchCampos: (id: number, patch: RepasseCamposManuaisPatch) => void | Promise<void>;
  onGerarAnuncio: (repasse: Repasse) => void;
  interessadosPorRepasse: Map<number, number>;
  gastosPorRepasse: Map<number, number[]>;
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
            <Th className="text-right">Bônus</Th>
            <Th>Observação</Th>
            <Th>Status</Th>
            <Th className="text-right">Resultado</Th>
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

                {/* IPVA (+ responsável condicional quando em aberto) */}
                <Td>
                  <div className="flex flex-col gap-1">
                    <IpvaSelect
                      value={r.ipva_status}
                      onChange={(v) => {
                        // Ao sair de "em aberto", limpa o responsável (não faz sentido).
                        const patch: RepasseCamposManuaisPatch =
                          v === "em_aberto"
                            ? { ipva_status: v }
                            : { ipva_status: v, ipva_responsavel: null };
                        void onPatchCampos(r.id, patch);
                      }}
                      placa={r.placa}
                    />
                    {r.ipva_status === "em_aberto" && (
                      <IpvaResponsavelSelect
                        value={r.ipva_responsavel}
                        onChange={(v) => void onPatchCampos(r.id, { ipva_responsavel: v })}
                        placa={r.placa}
                      />
                    )}
                  </div>
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

                {/* Bônus (derivado: Custo − Valor pra subir; só quando > 0) */}
                <Td className="text-right tabular-nums">
                  {(() => {
                    const bonus = calcularBonus(r);
                    return bonus != null ? (
                      <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                        {formatBRL(bonus)}
                      </span>
                    ) : (
                      <span className="text-[var(--text-subtle)]">—</span>
                    );
                  })()}
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
                <Td className="text-right">
                  <ResultadoCell repasse={r} gastos={gastosPorRepasse.get(r.id) ?? []} />
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
                    <Link
                      href={`/repasses/${r.id}/interessados`}
                      className="inline-flex items-center gap-1 rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-body)] hover:bg-[var(--bg-muted)]"
                      title="Interessados que visualizaram o anúncio no Auto Avaliar"
                    >
                      <Users className="h-3 w-3" /> Interessados
                      {(() => {
                        const n = interessadosPorRepasse.get(r.id) ?? 0;
                        return n > 0 ? (
                          <span className="rounded-full bg-[var(--brand-100)] px-1.5 text-[10px] font-semibold text-[var(--brand-800)] dark:bg-[var(--brand-900)] dark:text-[var(--brand-100)]">
                            {n}
                          </span>
                        ) : null;
                      })()}
                    </Link>
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
                    {r.status === "subido" && (
                      <>
                        <button
                          type="button"
                          onClick={() => onAbrirVendido(r)}
                          className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-emerald-700"
                          title="Registrar venda"
                        >
                          <CheckCircle2 className="h-3 w-3" /> Vendido
                        </button>
                        <button
                          type="button"
                          onClick={() => onAbrirNaoVendido(r)}
                          className="inline-flex items-center gap-1 rounded-md border border-red-300 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-800 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
                          title="Marcar como não vendido"
                        >
                          <XCircle className="h-3 w-3" /> Não vendeu
                        </button>
                      </>
                    )}
                    {(r.status === "vendido" || r.status === "nao_vendido") && (
                      <button
                        type="button"
                        onClick={() => onReverter(r.id)}
                        className="inline-flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-strong)] hover:underline"
                        title="Reabrir como subido"
                      >
                        <RotateCcw className="h-3 w-3" /> Reabrir
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
  if (s === "conforme") return "bg-emerald-50 dark:bg-emerald-950/30";
  if (s === "nao_conforme") return "bg-red-50 dark:bg-red-950/30";
  if (s === "nao_verificado") return "bg-[var(--bg-muted)]";
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

/**
 * Sub-select de quem paga o IPVA quando está "em aberto". Só aparece nesse caso.
 *
 * Default visual: quando `ipva_responsavel` é null, mostra "Por conta do
 * comprador" como selecionado (é o default de negócio que o anúncio usa). O
 * valor só é persistido quando o Marcos escolhe explicitamente.
 */
function IpvaResponsavelSelect({
  value,
  onChange,
  placa,
}: {
  value: IpvaResponsavel | null;
  onChange: (v: IpvaResponsavel) => void;
  placa: string;
}) {
  return (
    <select
      aria-label={`Responsável pelo IPVA de ${placa}`}
      className={cn(SELECT_BASE, "min-w-[130px] text-[10px]")}
      value={value ?? "comprador"}
      onChange={(e) => onChange(e.target.value as IpvaResponsavel)}
    >
      {IPVA_RESPONSAVEL_VALUES.map((v) => (
        <option key={v} value={v}>
          {IPVA_RESPONSAVEL_LABEL[v]}
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

const STATUS_BADGE_COR: Record<RepasseStatus, string> = {
  marcado: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  subido: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  vendido: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  nao_vendido: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
  cancelado: "bg-[var(--bg-muted)] text-[var(--text-muted)]",
};

const STATUS_BADGE_ICONE: Record<RepasseStatus, string> = {
  marcado: "🟡",
  subido: "🔵",
  vendido: "🟢",
  nao_vendido: "🔴",
  cancelado: "⚪",
};

function StatusBadge({ status }: { status: RepasseStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
        STATUS_BADGE_COR[status],
      )}
    >
      <span>{STATUS_BADGE_ICONE[status]}</span>
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Cor do texto da margem por classificação canônica do semáforo. */
const COR_MARGEM_TEXTO: Record<CorMargem, string> = {
  verde: "text-emerald-700 dark:text-emerald-400",
  amarelo: "text-yellow-700 dark:text-yellow-400",
  laranja: "text-orange-700 dark:text-orange-400",
  vermelho: "text-red-700 dark:text-red-400",
  neutro: "text-[var(--text-muted)]",
};

/** Coluna "Resultado": vendido → valor + margem; nao_vendido → texto; senão "—". */
function ResultadoCell({ repasse, gastos }: { repasse: Repasse; gastos: ReadonlyArray<number> }) {
  if (repasse.status === "nao_vendido") {
    return <span className="text-xs text-red-700 dark:text-red-400">Não vendido</span>;
  }
  if (repasse.status === "vendido") {
    // Margem sobre custo_real (compra de repasse + gastos) — NUNCA valor_aquisicao.
    const margem = calcularMargemVenda(repasse, gastos);
    const { cor } = classificarMargemVenda(repasse, gastos);
    return (
      <div className="flex flex-col items-end">
        <span className="text-xs font-medium tabular-nums text-[var(--text-strong)]">
          {formatBRL(repasse.valor_vendido)}
        </span>
        {margem == null ? (
          <span
            className="text-[10px] text-[var(--text-muted)]"
            title="Sem valor de compra do repasse — margem indisponível"
          >
            margem —
          </span>
        ) : (
          <span
            className={cn("text-[10px] font-semibold tabular-nums", COR_MARGEM_TEXTO[cor])}
            title={COR_MARGEM_LABEL[cor]}
          >
            {formatBRL(margem)}
          </span>
        )}
      </div>
    );
  }
  return <span className="text-[var(--text-subtle)]">—</span>;
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
