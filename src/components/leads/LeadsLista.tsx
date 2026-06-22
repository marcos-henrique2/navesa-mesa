"use client";

/**
 * Lista central de Leads (CRM).
 *
 * Cada lead é um contato único com N carros de interesse. Filtros por status,
 * busca livre (nome/email/telefone) e "tem WhatsApp". KPIs do funil no topo.
 * Status do relacionamento editável inline (patch otimista). Ordena por mais
 * recente ou por nº de interesses.
 *
 * Padrão visual e de inline edit replicado do RepassesLista / InteressadosCRM.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Filter, FilterX, Loader2, Search, Users } from "lucide-react";
import {
  contarComStatusRelacionamento,
  listLeads,
  updateLead,
  STATUS_RELACIONAMENTO_LABEL,
  STATUS_RELACIONAMENTO_VALUES,
  type LeadComInteresses,
  type LeadPatch,
  type StatusRelacionamento,
} from "@/lib/leads/leads";
import { cn } from "@/lib/utils";
import { showErrorToast } from "@/components/ui/Toast";

type StatusFiltro = StatusRelacionamento | "todos";
type Ordenacao = "recente" | "interesses";

const STATUS_FILTROS: ReadonlyArray<{ value: StatusFiltro; label: string }> = [
  { value: "todos", label: "Todos" },
  ...STATUS_RELACIONAMENTO_VALUES.map((v) => ({
    value: v,
    label: STATUS_RELACIONAMENTO_LABEL[v],
  })),
];

export function LeadsLista() {
  const [leads, setLeads] = useState<LeadComInteresses[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [statusFiltro, setStatusFiltro] = useState<StatusFiltro>("todos");
  const [busca, setBusca] = useState("");
  const [soComWhatsapp, setSoComWhatsapp] = useState(false);
  const [ordenacao, setOrdenacao] = useState<Ordenacao>("recente");

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const lista = await listLeads();
        if (!vivo) return;
        setLeads(lista);
      } catch (e) {
        if (!vivo) return;
        setErro(e instanceof Error ? e.message : String(e));
      } finally {
        if (vivo) setCarregando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  const kpis = useMemo(() => contarComStatusRelacionamento(leads), [leads]);

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const lista = leads.filter((l) => {
      if (statusFiltro !== "todos" && l.status_relacionamento !== statusFiltro) return false;
      if (soComWhatsapp && !l.telefone_whatsapp) return false;
      if (termo) {
        const alvo = `${l.nome} ${l.email ?? ""} ${l.telefone_whatsapp ?? ""} ${l.telefones_raw ?? ""}`.toLowerCase();
        if (!alvo.includes(termo)) return false;
      }
      return true;
    });
    const ordenada = [...lista];
    if (ordenacao === "interesses") {
      ordenada.sort((a, b) => b.qtd_interesses - a.qtd_interesses || b.id - a.id);
    } else {
      ordenada.sort((a, b) => (a.criado_em < b.criado_em ? 1 : a.criado_em > b.criado_em ? -1 : 0));
    }
    return ordenada;
  }, [leads, statusFiltro, busca, soComWhatsapp, ordenacao]);

  const filtrosAtivos =
    (statusFiltro !== "todos" ? 1 : 0) +
    (busca.trim() !== "" ? 1 : 0) +
    (soComWhatsapp ? 1 : 0);

  function limparFiltros() {
    if (filtrosAtivos === 0) return;
    setStatusFiltro("todos");
    setBusca("");
    setSoComWhatsapp(false);
  }

  const handlePatch = useCallback(
    async (id: number, patch: LeadPatch) => {
      const anterior = leads.find((l) => l.id === id);
      if (!anterior) return;
      setLeads((prev) =>
        prev.map((l) =>
          l.id === id
            ? {
                ...l,
                ...("status_relacionamento" in patch && patch.status_relacionamento
                  ? { status_relacionamento: patch.status_relacionamento }
                  : {}),
              }
            : l,
        ),
      );
      try {
        const atualizado = await updateLead(id, patch);
        setLeads((prev) =>
          prev.map((l) => (l.id === id ? { ...l, ...atualizado } : l)),
        );
      } catch (e) {
        setLeads((prev) => prev.map((l) => (l.id === id ? anterior : l)));
        showErrorToast(`Erro ao salvar: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [leads],
  );

  if (carregando) {
    return (
      <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando leads…
      </div>
    );
  }

  if (erro) {
    return <p className="text-sm text-red-700 dark:text-red-400">Erro: {erro}</p>;
  }

  return (
    <div className="space-y-5">
      {/* KPIs do funil */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiFunil label="Novos" value={kpis.novo} tone="info" />
        <KpiFunil label="Contatados" value={kpis.contatado} tone="neutro" />
        <KpiFunil label="Responderam" value={kpis.respondeu} tone="info" />
        <KpiFunil label="Negociando" value={kpis.negociando} tone="warn" />
        <KpiFunil label="Fecharam" value={kpis.fechou} tone="good" />
        <KpiFunil label="Perdidos" value={kpis.perdido} tone="bad" />
      </div>

      {/* Filtros */}
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
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar nome, e-mail, telefone..."
            aria-label="Buscar lead"
            className="w-56 rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] py-1 pl-7 pr-2 text-xs focus:border-[var(--brand-500)] focus:outline-none"
          />
        </label>

        <label className="inline-flex items-center gap-1.5 text-xs text-[var(--text-body)]">
          <input
            type="checkbox"
            checked={soComWhatsapp}
            onChange={(e) => setSoComWhatsapp(e.target.checked)}
          />
          Só com WhatsApp
        </label>

        <label className="inline-flex items-center gap-1.5 text-xs">
          <span className="text-[var(--text-muted)]">Ordenar:</span>
          <select
            value={ordenacao}
            onChange={(e) => setOrdenacao(e.target.value as Ordenacao)}
            className="rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-2 py-1 text-xs"
          >
            <option value="recente">Mais recentes</option>
            <option value="interesses">Mais carros de interesse</option>
          </select>
        </label>

        <button
          type="button"
          onClick={limparFiltros}
          disabled={filtrosAtivos === 0}
          className={cn(
            "ml-auto inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition",
            filtrosAtivos > 0
              ? "border-red-300 bg-red-50 text-red-800 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
              : "cursor-not-allowed border-[var(--border-soft)] bg-[var(--bg-surface)] text-[var(--text-subtle)] opacity-60",
          )}
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
      </div>

      {/* Tabela */}
      {filtrados.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border-base)] p-12 text-center">
          <Users className="mx-auto h-8 w-8 text-[var(--text-subtle)]" />
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            {leads.length === 0
              ? "Nenhum lead ainda. Importe interessados de um repasse pra começar."
              : "Nenhum lead com esses filtros."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--border-soft)]">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[var(--border-soft)] bg-[var(--bg-muted)] text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              <tr>
                <Th>Nome</Th>
                <Th>Cidade/UF</Th>
                <Th>WhatsApp</Th>
                <Th className="text-right">Carros</Th>
                <Th>Relacionamento</Th>
                <Th>Último contato</Th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((l) => (
                <tr
                  key={l.id}
                  className="border-b border-[var(--border-soft)] last:border-0 hover:bg-[var(--bg-muted)]"
                >
                  <Td>
                    <Link
                      href={`/leads/${l.id}`}
                      className="font-medium text-[var(--text-strong)] hover:text-[var(--brand-700)] hover:underline"
                    >
                      {l.nome}
                    </Link>
                    {l.email && (
                      <div className="text-[10px] text-[var(--text-subtle)]">{l.email}</div>
                    )}
                  </Td>
                  <Td className="text-xs text-[var(--text-muted)]">{l.cidade_uf ?? "—"}</Td>
                  <Td className="font-mono text-xs">
                    {l.telefone_whatsapp ?? (
                      <span className="text-amber-700 dark:text-amber-400">—</span>
                    )}
                  </Td>
                  <Td className="text-right tabular-nums">{l.qtd_interesses}</Td>
                  <Td>
                    <StatusSelect
                      value={l.status_relacionamento}
                      onChange={(v) => void handlePatch(l.id, { status_relacionamento: v })}
                      nome={l.nome}
                    />
                  </Td>
                  <Td className="text-xs text-[var(--text-muted)]">
                    {formatDataBR(l.atualizado_em)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Subcomponentes ───────────────────────────────────────────────────────────

function KpiFunil({
  label,
  value,
  tone = "neutro",
}: {
  label: string;
  value: number;
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
    <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        {label}
      </p>
      <p className={cn("mt-1 text-xl font-bold tabular-nums", toneClass)}>{value}</p>
    </div>
  );
}

const SELECT_BASE =
  "w-full rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-1.5 py-0.5 text-[11px] text-[var(--text-body)] focus:border-[var(--brand-500)] focus:outline-none";

function corStatus(s: StatusRelacionamento): string {
  switch (s) {
    case "novo":
      return "bg-blue-50 dark:bg-blue-950/30";
    case "contatado":
      return "bg-[var(--bg-muted)]";
    case "respondeu":
      return "bg-blue-50 dark:bg-blue-950/30";
    case "negociando":
      return "bg-amber-50 dark:bg-amber-950/30";
    case "fechou":
      return "bg-emerald-50 dark:bg-emerald-950/30";
    case "perdido":
      return "bg-red-50 dark:bg-red-950/30";
  }
}

function StatusSelect({
  value,
  onChange,
  nome,
}: {
  value: StatusRelacionamento;
  onChange: (v: StatusRelacionamento) => void;
  nome: string;
}) {
  return (
    <select
      aria-label={`Relacionamento de ${nome}`}
      className={cn(SELECT_BASE, "min-w-[130px]", corStatus(value))}
      value={value}
      onChange={(e) => onChange(e.target.value as StatusRelacionamento)}
    >
      {STATUS_RELACIONAMENTO_VALUES.map((v) => (
        <option key={v} value={v}>
          {STATUS_RELACIONAMENTO_LABEL[v]}
        </option>
      ))}
    </select>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={cn("px-3 py-2 text-left", className)}>{children}</th>;
}

function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={cn("px-3 py-2", className)}>{children}</td>;
}

/** ISO timestamp → DD/MM/YYYY. */
function formatDataBR(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}
