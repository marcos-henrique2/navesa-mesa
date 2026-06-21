"use client";
/* eslint-disable react-hooks/set-state-in-effect --
 * Carga inicial async via Supabase. Mesmo padrão do RepassesLista/VeiculoDetalhe:
 * o effect dispara fetch e o estado é setado quando a Promise resolve.
 */

/**
 * Mini-CRM de Interessados — quem visualizou o anúncio no Auto Avaliar.
 *
 * Página dedicada (não modal) porque é um fluxo de acompanhamento de funil:
 * importar leads, ver KPIs, mexer em status/observação e disparar WhatsApp.
 *
 * Padrão de inline edit + patch otimista replicado do RepassesLista (status e
 * observação editáveis na linha; salva em background; rollback se o banco recusa).
 *
 * O WhatsApp abre via link wa.me em nova aba — NÃO dispara nada automático.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  MessageCircle,
  Eye,
  Trash2,
  Users,
  UserPlus,
} from "lucide-react";
import { getRepasse } from "@/lib/repasses/queries";
import type { Repasse } from "@/lib/repasses/types";
import {
  contarComStatus,
  criarInteressados,
  deleteInteressado,
  listInteressados,
  STATUS_FOLLOWUP_LABEL,
  STATUS_FOLLOWUP_VALUES,
  updateInteressado,
  type InteressadoPatch,
  type RepasseInteressado,
  type StatusFollowup,
} from "@/lib/repasses/interessados";
import { parseInteressados } from "@/lib/repasses/parse-interessados";
import { gerarMensagemLead } from "@/lib/repasses/gerar-mensagem-lead";
import { cn, formatInt } from "@/lib/utils";
import { showErrorToast, showInfoToast, showSuccessToast } from "@/components/ui/Toast";
import { ImportarInteressadosModal } from "./ImportarInteressadosModal";
import { MensagemLeadModal } from "./MensagemLeadModal";

export function InteressadosCRM({ repasseId }: { repasseId: number }) {
  const [repasse, setRepasse] = useState<Repasse | null>(null);
  const [interessados, setInteressados] = useState<RepasseInteressado[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [importOpen, setImportOpen] = useState(false);
  const [importando, setImportando] = useState(false);
  const [verMensagem, setVerMensagem] = useState<RepasseInteressado | null>(null);

  // Carga inicial: carro + lista de interessados.
  useEffect(() => {
    if (!Number.isFinite(repasseId)) {
      setErro("Repasse inválido.");
      setCarregando(false);
      return;
    }
    let vivo = true;
    (async () => {
      try {
        const [r, lista] = await Promise.all([getRepasse(repasseId), listInteressados(repasseId)]);
        if (!vivo) return;
        setRepasse(r);
        setInteressados(lista);
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
  }, [repasseId]);

  // ─── KPIs do funil ─────────────────────────────────────────────────────────
  const kpis = useMemo(() => contarComStatus(interessados), [interessados]);

  // ─── Importar ──────────────────────────────────────────────────────────────
  const handleImportar = useCallback(
    async (textoColado: string) => {
      const parsed = parseInteressados(textoColado);
      if (parsed.length === 0) {
        showErrorToast("Nenhum interessado reconhecido no texto colado.");
        return;
      }
      setImportando(true);
      try {
        const { inseridos, ignorados, criados } = await criarInteressados(repasseId, parsed);
        // Mescla os novos no estado e re-ordena por views desc.
        setInteressados((prev) =>
          [...prev, ...criados].sort((a, b) => b.qtd_visualizacoes - a.qtd_visualizacoes),
        );
        setImportOpen(false);
        showSuccessToast(
          `${inseridos} importado(s)${ignorados > 0 ? ` · ${ignorados} duplicado(s) ignorado(s)` : ""}.`,
        );
      } catch (e) {
        showErrorToast(`Erro ao importar: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setImportando(false);
      }
    },
    [repasseId],
  );

  // ─── Patch otimista (status / observação / data_contato) ─────────────────────
  const handlePatch = useCallback(
    async (id: number, patch: InteressadoPatch) => {
      const anterior = interessados.find((i) => i.id === id);
      if (!anterior) return;

      setInteressados((prev) =>
        prev.map((i) =>
          i.id === id
            ? {
                ...i,
                ...("status_followup" in patch && patch.status_followup
                  ? { status_followup: patch.status_followup }
                  : {}),
                ...("observacao" in patch ? { observacao: patch.observacao ?? null } : {}),
                ...("data_contato" in patch ? { data_contato: patch.data_contato ?? null } : {}),
              }
            : i,
        ),
      );

      try {
        const atualizado = await updateInteressado(id, patch);
        setInteressados((prev) => prev.map((i) => (i.id === id ? atualizado : i)));
      } catch (e) {
        setInteressados((prev) => prev.map((i) => (i.id === id ? anterior : i)));
        showErrorToast(`Erro ao salvar: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [interessados],
  );

  // ─── WhatsApp ────────────────────────────────────────────────────────────────
  const handleWhatsapp = useCallback(
    (interessado: RepasseInteressado) => {
      if (!repasse) return;
      if (!interessado.telefone_whatsapp) {
        showInfoToast("Esse interessado não tem celular pra WhatsApp.");
        return;
      }
      const msg = gerarMensagemLead(repasse, interessado);
      const url = `https://wa.me/${interessado.telefone_whatsapp}?text=${encodeURIComponent(msg)}`;
      window.open(url, "_blank", "noopener");

      // Ao primeiro contato: se ainda "novo", avança pra "contatado" + data de hoje.
      if (interessado.status_followup === "novo") {
        const hoje = new Date().toISOString().slice(0, 10);
        void handlePatch(interessado.id, { status_followup: "contatado", data_contato: hoje });
      }
    },
    [repasse, handlePatch],
  );

  // ─── Remover ─────────────────────────────────────────────────────────────────
  const handleRemover = useCallback(async (id: number) => {
    const anterior = interessados;
    setInteressados((prev) => prev.filter((i) => i.id !== id));
    try {
      await deleteInteressado(id);
    } catch (e) {
      setInteressados(anterior);
      showErrorToast(`Erro ao remover: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [interessados]);

  if (carregando) {
    return (
      <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando interessados…
      </div>
    );
  }

  if (erro) {
    return <p className="text-sm text-red-700 dark:text-red-400">Erro: {erro}</p>;
  }

  const ano = repasse?.ano_modelo ?? repasse?.ano_fabricacao ?? null;

  return (
    <div className="space-y-6">
      {/* Cabeçalho: voltar + dados do carro */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/repasses"
            className="inline-flex items-center gap-1 rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs text-[var(--text-body)] hover:bg-[var(--bg-muted)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Repasses
          </Link>
          {repasse && (
            <div>
              <h2 className="text-base font-bold text-[var(--text-strong)]">
                {repasse.modelo}
                {ano != null ? ` ${ano}` : ""}
              </h2>
              <p className="text-xs text-[var(--text-muted)]">
                <span className="font-mono">{repasse.placa}</span>
                {repasse.km != null ? ` · ${formatInt(repasse.km)} km` : ""}
              </p>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setImportOpen(true)}
          className="inline-flex items-center gap-2 rounded-md bg-[var(--brand-700)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--brand-800)]"
        >
          <UserPlus className="h-4 w-4" /> Importar do Auto Avaliar
        </button>
      </div>

      {/* KPIs do funil */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiFunil label="Novos" value={kpis.novo} tone="info" />
        <KpiFunil label="Contatados" value={kpis.contatado} tone="neutro" />
        <KpiFunil label="Responderam" value={kpis.respondeu} tone="info" />
        <KpiFunil label="Negociando" value={kpis.negociando} tone="warn" />
        <KpiFunil label="Fecharam" value={kpis.fechou} tone="good" />
        <KpiFunil label="Perdidos" value={kpis.perdido} tone="bad" />
      </div>

      {/* Tabela */}
      {interessados.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border-base)] p-10 text-center">
          <Users className="mx-auto h-8 w-8 text-[var(--text-subtle)]" />
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            Nenhum interessado ainda. Clique em “Importar do Auto Avaliar” pra colar a lista de
            quem visualizou o anúncio.
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
                <Th>E-mail</Th>
                <Th className="text-right">Views</Th>
                <Th>Status</Th>
                <Th>Observação</Th>
                <Th className="text-right">Ações</Th>
              </tr>
            </thead>
            <tbody>
              {interessados.map((i) => (
                <tr
                  key={i.id}
                  className="border-b border-[var(--border-soft)] last:border-0 hover:bg-[var(--bg-muted)]"
                >
                  <Td>
                    <span className="font-medium text-[var(--text-strong)]">{i.nome}</span>
                  </Td>
                  <Td className="text-xs text-[var(--text-muted)]">{i.cidade_uf ?? "—"}</Td>
                  <Td className="font-mono text-xs">
                    {i.telefone_whatsapp ?? (
                      <span className="text-amber-700 dark:text-amber-400">—</span>
                    )}
                  </Td>
                  <Td className="text-xs text-[var(--text-muted)]">{i.email ?? "—"}</Td>
                  <Td className="text-right tabular-nums">{i.qtd_visualizacoes}</Td>
                  <Td>
                    <StatusSelect
                      value={i.status_followup}
                      onChange={(v) => void handlePatch(i.id, { status_followup: v })}
                      nome={i.nome}
                    />
                  </Td>
                  <Td>
                    <ObservacaoInput
                      value={i.observacao}
                      onCommit={(v) => void handlePatch(i.id, { observacao: v })}
                      nome={i.nome}
                    />
                  </Td>
                  <Td className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleWhatsapp(i)}
                        disabled={!i.telefone_whatsapp}
                        title={
                          i.telefone_whatsapp
                            ? "Abrir WhatsApp com mensagem pronta"
                            : "Sem celular pra WhatsApp"
                        }
                        className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <MessageCircle className="h-3 w-3" /> WhatsApp
                      </button>
                      <button
                        type="button"
                        onClick={() => setVerMensagem(i)}
                        title="Ver/copiar a mensagem"
                        className="inline-flex items-center gap-1 rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-body)] hover:bg-[var(--bg-muted)]"
                      >
                        <Eye className="h-3 w-3" /> Mensagem
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleRemover(i.id)}
                        title="Remover interessado"
                        aria-label={`Remover ${i.nome}`}
                        className="inline-flex items-center gap-1 rounded-md border border-red-300 bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-800 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ImportarInteressadosModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onConfirmar={handleImportar}
        importando={importando}
      />

      {verMensagem && repasse && (
        <MensagemLeadModal
          key={verMensagem.id}
          repasse={repasse}
          interessado={verMensagem}
          open={true}
          onClose={() => setVerMensagem(null)}
        />
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

function corStatus(s: StatusFollowup): string {
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
  value: StatusFollowup;
  onChange: (v: StatusFollowup) => void;
  nome: string;
}) {
  return (
    <select
      aria-label={`Status de ${nome}`}
      className={cn(SELECT_BASE, "min-w-[120px]", corStatus(value))}
      value={value}
      onChange={(e) => onChange(e.target.value as StatusFollowup)}
    >
      {STATUS_FOLLOWUP_VALUES.map((v) => (
        <option key={v} value={v}>
          {STATUS_FOLLOWUP_LABEL[v]}
        </option>
      ))}
    </select>
  );
}

/** Observação inline — commit no blur/Enter, Escape reverte. */
function ObservacaoInput({
  value,
  onCommit,
  nome,
}: {
  value: string | null;
  onCommit: (v: string | null) => void;
  nome: string;
}) {
  const [draft, setDraft] = useState<string>(value ?? "");

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  function commit() {
    const novo = draft.trim() === "" ? null : draft;
    if (novo === (value ?? null)) return;
    onCommit(novo);
  }

  return (
    <input
      type="text"
      aria-label={`Observação de ${nome}`}
      placeholder="—"
      className="w-full min-w-[200px] truncate rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-1.5 py-0.5 text-[11px] text-[var(--text-body)] focus:border-[var(--brand-500)] focus:outline-none"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
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

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={cn("px-3 py-2 text-left", className)}>{children}</th>;
}

function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={cn("px-3 py-2", className)}>{children}</td>;
}
