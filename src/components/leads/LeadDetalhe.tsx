"use client";
/* eslint-disable react-hooks/set-state-in-effect --
 * Carga inicial async via Supabase. Mesmo padrão do RepassesLista/InteressadosCRM.
 */

/**
 * Detalhe do lead (CRM central).
 *
 * Bloco de contato (nome/cidade/whatsapp/email) com status do relacionamento e
 * observação editáveis inline (patch otimista). Lista "Carros de interesse" com
 * badge de origem (👁 Visualizou / 📤 Ofertado) e tipo (Repasse/Estoque), status
 * do follow-up inline, WhatsApp e remover. Botão "Oferecer carro" abre o modal F4.
 *
 * Padrão visual replicado do InteressadosCRM / RepassesLista.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  MessageCircle,
  Trash2,
  PlusCircle,
} from "lucide-react";
import { getLead, updateLead, type Lead, type LeadPatch } from "@/lib/leads/leads";
import {
  deleteInteresse,
  listInteressesPorLead,
  updateInteresse,
  ORIGEM_BADGE,
  TIPO_CARRO_LABEL,
  STATUS_FOLLOWUP_LABEL,
  STATUS_FOLLOWUP_VALUES,
  type LeadInteresse,
  type LeadInteressePatch,
  type Origem,
  type StatusFollowup,
  type TipoCarro,
} from "@/lib/leads/interesses";
import {
  STATUS_RELACIONAMENTO_LABEL,
  STATUS_RELACIONAMENTO_VALUES,
  type StatusRelacionamento,
} from "@/lib/leads/leads";
import { gerarMensagemLead } from "@/lib/repasses/gerar-mensagem-lead";
import { cn } from "@/lib/utils";
import { showErrorToast, showInfoToast } from "@/components/ui/Toast";
import { MensagemLeadModal } from "@/components/repasses/MensagemLeadModal";
import { OferecerCarroModal } from "./OferecerCarroModal";

export function LeadDetalhe({ leadId }: { leadId: number }) {
  const [lead, setLead] = useState<Lead | null>(null);
  const [interesses, setInteresses] = useState<LeadInteresse[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [oferecerOpen, setOferecerOpen] = useState(false);
  const [verMensagem, setVerMensagem] = useState<LeadInteresse | null>(null);

  useEffect(() => {
    if (!Number.isFinite(leadId)) {
      setErro("Lead inválido.");
      setCarregando(false);
      return;
    }
    let vivo = true;
    (async () => {
      try {
        const [l, lista] = await Promise.all([
          getLead(leadId),
          listInteressesPorLead(leadId),
        ]);
        if (!vivo) return;
        if (!l) {
          setErro("Lead não encontrado.");
          return;
        }
        setLead(l);
        setInteresses(lista);
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
  }, [leadId]);

  // ─── Patch do lead (status / observação) ─────────────────────────────────────
  const handlePatchLead = useCallback(
    async (patch: LeadPatch) => {
      if (!lead) return;
      const anterior = lead;
      setLead((prev) =>
        prev
          ? {
              ...prev,
              ...("status_relacionamento" in patch && patch.status_relacionamento
                ? { status_relacionamento: patch.status_relacionamento }
                : {}),
              ...("observacao" in patch ? { observacao: patch.observacao ?? null } : {}),
            }
          : prev,
      );
      try {
        const atualizado = await updateLead(lead.id, patch);
        setLead(atualizado);
      } catch (e) {
        setLead(anterior);
        showErrorToast(`Erro ao salvar: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [lead],
  );

  // ─── Patch do interesse (status do follow-up) ────────────────────────────────
  const handlePatchInteresse = useCallback(
    async (id: number, patch: LeadInteressePatch) => {
      const anterior = interesses.find((i) => i.id === id);
      if (!anterior) return;
      setInteresses((prev) =>
        prev.map((i) =>
          i.id === id
            ? {
                ...i,
                ...("status_followup" in patch && patch.status_followup
                  ? { status_followup: patch.status_followup }
                  : {}),
              }
            : i,
        ),
      );
      try {
        const atualizado = await updateInteresse(id, patch);
        setInteresses((prev) => prev.map((i) => (i.id === id ? atualizado : i)));
      } catch (e) {
        setInteresses((prev) => prev.map((i) => (i.id === id ? anterior : i)));
        showErrorToast(`Erro ao salvar: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [interesses],
  );

  // ─── WhatsApp por interesse ──────────────────────────────────────────────────
  const handleWhatsapp = useCallback(
    (interesse: LeadInteresse) => {
      if (!lead) return;
      if (!lead.telefone_whatsapp) {
        showInfoToast("Esse lead não tem celular pra WhatsApp.");
        return;
      }
      // modelo_snapshot já embute modelo+ano; passa como modelo do carro.
      const msg = gerarMensagemLead(
        { modelo: interesse.modelo_snapshot, ano: null, km: null },
        { nome: lead.nome },
        interesse.origem,
      );
      const url = `https://wa.me/${lead.telefone_whatsapp}?text=${encodeURIComponent(msg)}`;
      window.open(url, "_blank", "noopener");

      if (interesse.status_followup === "novo") {
        const hoje = new Date().toISOString().slice(0, 10);
        void handlePatchInteresse(interesse.id, {
          status_followup: "contatado",
          data_contato: hoje,
        });
      }
    },
    [lead, handlePatchInteresse],
  );

  const handleRemover = useCallback(
    async (id: number) => {
      const anterior = interesses;
      setInteresses((prev) => prev.filter((i) => i.id !== id));
      try {
        await deleteInteresse(id);
      } catch (e) {
        setInteresses(anterior);
        showErrorToast(`Erro ao remover: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [interesses],
  );

  const handleOfertado = useCallback(
    (interesse: LeadInteresse) => {
      setInteresses((prev) => [interesse, ...prev]);
      setOferecerOpen(false);
      // Abre direto a mensagem da oferta.
      setVerMensagem(interesse);
    },
    [],
  );

  if (carregando) {
    return (
      <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando lead…
      </div>
    );
  }

  if (erro || !lead) {
    return <p className="text-sm text-red-700 dark:text-red-400">Erro: {erro ?? "lead ausente"}</p>;
  }

  return (
    <div className="space-y-6">
      {/* Voltar */}
      <Link
        href="/leads"
        className="inline-flex items-center gap-1 rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs text-[var(--text-body)] hover:bg-[var(--bg-muted)]"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Leads
      </Link>

      {/* Bloco de contato */}
      <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-[var(--text-strong)]">{lead.nome}</h2>
            <div className="mt-1 space-y-0.5 text-sm text-[var(--text-muted)]">
              <p>{lead.cidade_uf ?? "—"}</p>
              <p className="font-mono text-xs">
                {lead.telefone_whatsapp ?? (
                  <span className="text-amber-700 dark:text-amber-400">sem WhatsApp</span>
                )}
              </p>
              <p className="text-xs">{lead.email ?? "—"}</p>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Relacionamento
            </label>
            <RelacionamentoSelect
              value={lead.status_relacionamento}
              onChange={(v) => void handlePatchLead({ status_relacionamento: v })}
            />
          </div>
        </div>

        {/* Observação */}
        <div className="mt-4">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Observação
          </label>
          <ObservacaoInput
            value={lead.observacao}
            onCommit={(v) => void handlePatchLead({ observacao: v })}
          />
        </div>
      </div>

      {/* Carros de interesse */}
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold text-[var(--text-strong)]">
          Carros de interesse{" "}
          <span className="text-sm font-normal text-[var(--text-muted)]">
            ({interesses.length})
          </span>
        </h3>
        <button
          type="button"
          onClick={() => setOferecerOpen(true)}
          className="inline-flex items-center gap-2 rounded-md bg-[var(--brand-700)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--brand-800)]"
        >
          <PlusCircle className="h-4 w-4" /> Oferecer carro
        </button>
      </div>

      {interesses.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border-base)] p-10 text-center">
          <p className="text-sm text-[var(--text-muted)]">
            Nenhum carro de interesse ainda. Clique em “Oferecer carro” pra apresentar um.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {interesses.map((i) => (
            <li
              key={i.id}
              className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <OrigemBadge origem={i.origem} />
                    <TipoBadge tipo={i.tipo_carro} />
                  </div>
                  <p className="mt-1.5 font-medium text-[var(--text-strong)]">{i.modelo_snapshot}</p>
                  <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                    {i.tipo_carro === "repasse" && i.repasse_id != null ? (
                      <Link
                        href={`/repasses/${i.repasse_id}/interessados`}
                        className="hover:underline"
                      >
                        Repasse #{i.repasse_id}
                      </Link>
                    ) : i.chassi ? (
                      <span className="font-mono">{i.chassi}</span>
                    ) : (
                      "—"
                    )}
                    {i.origem === "visualizou" && ` · ${i.qtd_visualizacoes} visualização(ões)`}
                  </p>
                </div>

                <div className="flex flex-col items-end gap-2">
                  <StatusFollowupSelect
                    value={i.status_followup}
                    onChange={(v) => void handlePatchInteresse(i.id, { status_followup: v })}
                  />
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleWhatsapp(i)}
                      disabled={!lead.telefone_whatsapp}
                      title={
                        lead.telefone_whatsapp
                          ? "Abrir WhatsApp com mensagem pronta"
                          : "Sem celular pra WhatsApp"
                      }
                      className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <MessageCircle className="h-3 w-3" /> WhatsApp
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRemover(i.id)}
                      title="Remover interesse"
                      aria-label={`Remover ${i.modelo_snapshot}`}
                      className="inline-flex items-center gap-1 rounded-md border border-red-300 bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-800 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <OferecerCarroModal
        leadId={lead.id}
        open={oferecerOpen}
        onClose={() => setOferecerOpen(false)}
        onOfertado={handleOfertado}
      />

      {verMensagem && (
        <MensagemLeadModal
          key={verMensagem.id}
          carro={{ modelo: verMensagem.modelo_snapshot, ano: null, km: null }}
          nome={lead.nome}
          telefoneWhatsapp={lead.telefone_whatsapp}
          contexto={verMensagem.origem}
          open={true}
          onClose={() => setVerMensagem(null)}
        />
      )}
    </div>
  );
}

// ─── Subcomponentes ───────────────────────────────────────────────────────────

function OrigemBadge({ origem }: { origem: Origem }) {
  const cor =
    origem === "oferta"
      ? "bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300"
      : "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300";
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold", cor)}>
      {ORIGEM_BADGE[origem]}
    </span>
  );
}

function TipoBadge({ tipo }: { tipo: TipoCarro }) {
  return (
    <span className="inline-flex items-center rounded-full bg-[var(--bg-muted)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-muted)]">
      {TIPO_CARRO_LABEL[tipo]}
    </span>
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

function StatusFollowupSelect({
  value,
  onChange,
}: {
  value: StatusFollowup;
  onChange: (v: StatusFollowup) => void;
}) {
  return (
    <select
      aria-label="Status do follow-up"
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

function RelacionamentoSelect({
  value,
  onChange,
}: {
  value: StatusRelacionamento;
  onChange: (v: StatusRelacionamento) => void;
}) {
  return (
    <select
      aria-label="Status do relacionamento"
      className={cn(SELECT_BASE, "min-w-[140px]", corStatus(value))}
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

/** Observação inline — commit no blur/Enter, Escape reverte. */
function ObservacaoInput({
  value,
  onCommit,
}: {
  value: string | null;
  onCommit: (v: string | null) => void;
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
      aria-label="Observação do lead"
      placeholder="Anotação livre sobre o lead…"
      className="mt-1 w-full rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-2 py-1.5 text-sm text-[var(--text-body)] focus:border-[var(--brand-500)] focus:outline-none"
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
