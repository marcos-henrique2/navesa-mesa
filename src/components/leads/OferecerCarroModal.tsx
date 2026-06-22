"use client";
/* eslint-disable react-hooks/set-state-in-effect --
 * Carga inicial dos repasses ativos via Supabase. Mesmo padrão das outras telas.
 */

/**
 * Modal "Oferecer carro" (detalhe do lead).
 *
 * Duas fontes num seletor: Repasses ativos (status 'subido') e Estoque
 * (useInventory().veiculos). O Marcos busca e seleciona UM carro → cria um
 * lead_interesse com origem='oferta' e o pai abre o wa.me com a mensagem.
 *
 * Reusa o padrão visual de busca do EscolherVeiculoModal. Acessível: ESC + clique
 * fora; botão de fechar com aria-label.
 */

import { useEffect, useMemo, useState } from "react";
import { Search, X, Loader2, Repeat, Car } from "lucide-react";
import { useInventory } from "@/lib/store/inventory";
import { listRepasses } from "@/lib/repasses/queries";
import type { Repasse } from "@/lib/repasses/types";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";
import { criarInteresseOferta, type LeadInteresse } from "@/lib/leads/interesses";
import { cn, formatBRL, formatInt } from "@/lib/utils";
import { showErrorToast } from "@/components/ui/Toast";

type Fonte = "repasse" | "estoque";

/** Monta o modelo_snapshot a partir do modelo + ano. Ex.: "S10 LTZ 2016". */
function montarModeloSnapshot(modelo: string, ano: number | null): string {
  return ano != null ? `${modelo} ${ano}` : modelo;
}

export function OferecerCarroModal({
  leadId,
  open,
  onClose,
  onOfertado,
}: {
  leadId: number;
  open: boolean;
  onClose: () => void;
  /** Chamado com o interesse criado pra o pai abrir o WhatsApp. */
  onOfertado: (interesse: LeadInteresse) => void;
}) {
  const { veiculos, isHydrated } = useInventory();
  const [fonte, setFonte] = useState<Fonte>("repasse");
  const [q, setQ] = useState("");
  const [repasses, setRepasses] = useState<Repasse[]>([]);
  const [carregandoRepasses, setCarregandoRepasses] = useState(true);
  const [salvando, setSalvando] = useState(false);

  // Carrega repasses ativos (status 'subido' — já estão anunciados).
  useEffect(() => {
    if (!open) return;
    let vivo = true;
    setCarregandoRepasses(true);
    (async () => {
      try {
        const lista = await listRepasses();
        if (!vivo) return;
        setRepasses(lista.filter((r) => r.status === "subido"));
      } catch (e) {
        if (!vivo) return;
        showErrorToast(`Erro ao carregar repasses: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        if (vivo) setCarregandoRepasses(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [open]);

  // Fecha com ESC.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const repassesFiltrados = useMemo(() => {
    const termo = q.trim().toLowerCase();
    const base = !termo
      ? repasses
      : repasses.filter(
          (r) =>
            r.placa.toLowerCase().includes(termo) ||
            r.modelo.toLowerCase().includes(termo) ||
            (r.marca?.toLowerCase().includes(termo) ?? false),
        );
    return base.slice(0, 50);
  }, [repasses, q]);

  const veiculosFiltrados = useMemo(() => {
    const termo = q.trim().toLowerCase();
    if (!termo) return veiculos.slice(0, 50);
    return veiculos
      .filter(
        (v) =>
          v.placa.toLowerCase().includes(termo) ||
          v.chassi.toLowerCase().includes(termo) ||
          v.modelo.toLowerCase().includes(termo) ||
          (v.marca?.toLowerCase().includes(termo) ?? false),
      )
      .slice(0, 50);
  }, [veiculos, q]);

  async function ofertarRepasse(r: Repasse) {
    if (salvando) return;
    setSalvando(true);
    try {
      const ano = r.ano_modelo ?? r.ano_fabricacao ?? null;
      const interesse = await criarInteresseOferta({
        leadId,
        tipo_carro: "repasse",
        repasse_id: r.id,
        modelo_snapshot: montarModeloSnapshot(r.modelo, ano),
      });
      onOfertado(interesse);
    } catch (e) {
      showErrorToast(`Erro ao ofertar: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSalvando(false);
    }
  }

  async function ofertarVeiculo(v: VeiculoParsed) {
    if (salvando) return;
    setSalvando(true);
    try {
      const ano = v.ano_modelo ?? v.ano_fabricacao ?? null;
      const interesse = await criarInteresseOferta({
        leadId,
        tipo_carro: "estoque",
        chassi: v.chassi,
        modelo_snapshot: montarModeloSnapshot(v.modelo, ano),
      });
      onOfertado(interesse);
    } catch (e) {
      showErrorToast(`Erro ao ofertar: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSalvando(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-20"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Oferecer carro pro lead"
    >
      <div
        className="w-full max-w-2xl rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-soft)] p-4">
          <h2 className="text-lg font-bold text-[var(--text-strong)]">Oferecer carro</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--bg-muted)]"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Seletor de fonte */}
        <div className="flex gap-1.5 px-4 pt-4">
          <button
            type="button"
            onClick={() => setFonte("repasse")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition",
              fonte === "repasse"
                ? "border-[var(--brand-600)] bg-[var(--brand-50)] text-[var(--brand-900)] dark:bg-[var(--brand-900)]/30 dark:text-[var(--brand-100)]"
                : "border-[var(--border-base)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:bg-[var(--bg-muted)]",
            )}
          >
            <Repeat className="h-3.5 w-3.5" /> Repasses ativos
          </button>
          <button
            type="button"
            onClick={() => setFonte("estoque")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition",
              fonte === "estoque"
                ? "border-[var(--brand-600)] bg-[var(--brand-50)] text-[var(--brand-900)] dark:bg-[var(--brand-900)]/30 dark:text-[var(--brand-100)]"
                : "border-[var(--border-base)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:bg-[var(--bg-muted)]",
            )}
          >
            <Car className="h-3.5 w-3.5" /> Estoque
          </button>
        </div>

        <div className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-subtle)]" />
            <input
              autoFocus
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={
                fonte === "repasse"
                  ? "Buscar por placa, modelo..."
                  : "Buscar por placa, chassi, modelo..."
              }
              className="w-full rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--brand-600)]"
            />
          </div>
        </div>

        <div className="max-h-[55vh] overflow-y-auto border-t border-[var(--border-soft)]">
          {fonte === "repasse" ? (
            carregandoRepasses ? (
              <p className="flex items-center justify-center gap-2 p-8 text-sm text-[var(--text-muted)]">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando repasses…
              </p>
            ) : repassesFiltrados.length === 0 ? (
              <p className="p-8 text-center text-sm text-[var(--text-muted)]">
                {repasses.length === 0
                  ? "Nenhum repasse ativo (subido) no momento."
                  : "Nenhum repasse encontrado."}
              </p>
            ) : (
              <ul className="divide-y divide-[var(--border-soft)]">
                {repassesFiltrados.map((r) => {
                  const ano = r.ano_modelo ?? r.ano_fabricacao ?? null;
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        disabled={salvando}
                        onClick={() => void ofertarRepasse(r)}
                        className="block w-full px-4 py-3 text-left transition hover:bg-[var(--bg-muted)] disabled:opacity-50"
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-[var(--text-strong)]">
                              {r.modelo}
                              {ano != null ? ` ${ano}` : ""}
                            </p>
                            <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                              <span className="font-mono">{r.placa}</span>
                              {r.km != null && ` · ${formatInt(r.km)} km`}
                            </p>
                          </div>
                          <p className="shrink-0 text-xs tabular-nums text-[var(--text-muted)]">
                            {formatBRL(r.preco_atual)}
                          </p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )
          ) : !isHydrated ? (
            <p className="p-8 text-center text-sm text-[var(--text-muted)]">Carregando estoque…</p>
          ) : veiculosFiltrados.length === 0 ? (
            <p className="p-8 text-center text-sm text-[var(--text-muted)]">
              {veiculos.length === 0 ? "Nenhum veículo no estoque." : "Nenhum veículo encontrado."}
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border-soft)]">
              {veiculosFiltrados.map((v) => (
                <li key={v.chassi}>
                  <button
                    type="button"
                    disabled={salvando}
                    onClick={() => void ofertarVeiculo(v)}
                    className="block w-full px-4 py-3 text-left transition hover:bg-[var(--bg-muted)] disabled:opacity-50"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-[var(--text-strong)]">
                          {v.modelo}
                          {v.ano_modelo ? ` ${v.ano_modelo}` : ""}
                        </p>
                        <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                          <span className="font-mono">{v.placa}</span>
                          {v.km != null && ` · ${formatInt(v.km)} km`}
                          {v.cor_externa && ` · ${v.cor_externa}`}
                        </p>
                      </div>
                      <p className="shrink-0 text-xs tabular-nums text-[var(--text-muted)]">
                        {formatBRL(v.preco_venda)}
                      </p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
