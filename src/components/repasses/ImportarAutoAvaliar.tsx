"use client";

/**
 * Importador Auto Avaliar (Story 2.2 / Fatia 2) — tela de cola + PREVIEW + gravação.
 *
 * Fluxo:
 *   1. Marcos cola a lista do Auto Avaliar e clica "Analisar".
 *   2. Preview OBRIGATÓRIO em 4 blocos (Criar / Atualizar / Reconciliação /
 *      Pendências sem chassi) + painel de Avisos.
 *   3. "Confirmar gravação" → 1 RPC atômica → mostra as contagens.
 *
 * Regra (parser + preview) é PURA nos módulos `parse-auto-avaliar` /
 * `import-auto-avaliar`; aqui é só orquestração de UI + as 2 chamadas de I/O.
 */

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  PlusCircle,
  RefreshCw,
  Repeat,
  Ban,
} from "lucide-react";
import { parseAutoAvaliar } from "@/lib/repasses/parse-auto-avaliar";
import { montarPreviewImport, confirmarImport } from "@/lib/repasses/import-auto-avaliar-queries";
import type { ImportPreview, ImportResultado, PreviewItem } from "@/lib/repasses/import-auto-avaliar";
import { formatBRLCents, formatInt } from "@/lib/utils";
import { showErrorToast, showSuccessToast } from "@/components/ui/Toast";

const ROTULO_AVISO: Record<string, string> = {
  header_nao_reconhecido: "Cabeçalho não reconhecido",
  coluna_ausente: "Coluna ausente",
  placa_invalida: "Placa inválida (linha descartada)",
  valor_ilegivel: "Valor ilegível",
  ano_ausente: "Ano ausente",
  km_ausente: "KM ausente",
  bloco_medias_incompleto: "Bloco de médias incompleto",
  linha_ignorada: "Linha ignorada",
};

export function ImportarAutoAvaliar() {
  const [texto, setTexto] = useState("");
  const [analisando, setAnalisando] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [resultado, setResultado] = useState<ImportResultado | null>(null);

  const criar = useMemo(
    () => preview?.itens.filter((i) => i.acao === "criar") ?? [],
    [preview],
  );
  const atualizar = useMemo(
    () => preview?.itens.filter((i) => i.acao === "atualizar") ?? [],
    [preview],
  );
  const vendidos = useMemo(
    () => preview?.reconciliacao.filter((r) => r.novo_status === "vendido") ?? [],
    [preview],
  );
  const marcados = useMemo(
    () => preview?.reconciliacao.filter((r) => r.novo_status === "marcado") ?? [],
    [preview],
  );

  async function analisar() {
    setResultado(null);
    setPreview(null);
    const parsed = parseAutoAvaliar(texto);
    if (parsed.registros.length === 0 && parsed.avisos.length === 0) {
      showErrorToast("Nenhum registro reconhecido. Confira se colou a lista completa.");
      return;
    }
    setAnalisando(true);
    try {
      const pv = await montarPreviewImport(parsed);
      setPreview(pv);
      if (pv.itens.length === 0 && pv.reconciliacao.length === 0) {
        showErrorToast("Nada a gravar: nenhum item nem reconciliação reconhecidos.");
      }
    } catch (err: unknown) {
      showErrorToast(err instanceof Error ? err.message : String(err));
    } finally {
      setAnalisando(false);
    }
  }

  async function confirmar() {
    if (!preview) return;
    setConfirmando(true);
    try {
      const res = await confirmarImport(preview);
      setResultado(res);
      setPreview(null);
      setTexto("");
      showSuccessToast(
        `Gravado: ${res.criados} criados, ${res.atualizados} atualizados, ${
          res.reconciliados_vendidos + res.reconciliados_marcados
        } reconciliados.`,
      );
    } catch (err: unknown) {
      showErrorToast(err instanceof Error ? err.message : String(err));
    } finally {
      setConfirmando(false);
    }
  }

  const totalGravar =
    (preview?.itens.length ?? 0) + (preview?.reconciliacao.length ?? 0);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* ── Entrada ─────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-5">
        <label
          htmlFor="aa-textarea"
          className="mb-2 block text-sm font-medium text-[var(--text-strong)]"
        >
          Cole a lista do Auto Avaliar
        </label>
        <textarea
          id="aa-textarea"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          spellCheck={false}
          placeholder="Selecione a grade de carros no Auto Avaliar, copie e cole aqui (com o cabeçalho)…"
          className="h-[28vh] w-full resize-none rounded-md border border-[var(--border-base)] bg-[var(--bg-muted)] p-3 font-mono text-xs leading-relaxed text-[var(--text-body)] focus:border-[var(--brand-500)] focus:outline-none"
        />
        <div className="mt-4 flex items-center justify-end">
          <button
            type="button"
            onClick={() => void analisar()}
            disabled={analisando || texto.trim() === ""}
            className="inline-flex items-center gap-2 rounded-md bg-[var(--brand-700)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-800)] disabled:opacity-50"
          >
            {analisando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {analisando ? "Analisando…" : "Analisar"}
          </button>
        </div>
      </div>

      {/* ── Resultado final ─────────────────────────────────────────────────── */}
      {resultado && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-5 dark:border-emerald-800 dark:bg-emerald-950/40">
          <h2 className="inline-flex items-center gap-2 text-base font-bold text-emerald-800 dark:text-emerald-300">
            <CheckCircle2 className="h-5 w-5" /> Importação concluída
          </h2>
          <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-emerald-900 sm:grid-cols-3 dark:text-emerald-200">
            <li>Criados: <strong>{resultado.criados}</strong></li>
            <li>Atualizados: <strong>{resultado.atualizados}</strong></li>
            <li>Vendidos: <strong>{resultado.reconciliados_vendidos}</strong></li>
            <li>Marcados: <strong>{resultado.reconciliados_marcados}</strong></li>
            <li>Conflitos: <strong>{resultado.conflitos}</strong></li>
          </ul>
        </div>
      )}

      {/* ── Preview ─────────────────────────────────────────────────────────── */}
      {preview && (
        <div className="space-y-5">
          {/* Avisos */}
          {preview.avisos.length > 0 && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/40">
              <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4" /> Avisos ({preview.avisos.length})
              </h3>
              <ul className="mt-2 space-y-1 text-xs text-amber-900 dark:text-amber-200">
                {preview.avisos.map((a, idx) => (
                  <li key={idx}>
                    <span className="font-medium">
                      {ROTULO_AVISO[a.codigo] ?? a.codigo}
                    </span>{" "}
                    — linha {a.linha}, campo <code>{a.campo}</code>
                    {a.valor_raw ? `: "${a.valor_raw}"` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Blocos */}
          <div className="grid gap-4 lg:grid-cols-2">
            <BlocoItens
              titulo="Criar"
              icone={<PlusCircle className="h-4 w-4 text-emerald-600" />}
              itens={criar}
              vazio="Nenhum carro novo pra criar."
            />
            <BlocoItens
              titulo="Atualizar"
              icone={<RefreshCw className="h-4 w-4 text-sky-600" />}
              itens={atualizar}
              vazio="Nenhum repasse existente pra atualizar."
            />

            {/* Reconciliação */}
            <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-4">
              <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-strong)]">
                <Repeat className="h-4 w-4 text-violet-600" /> Reconciliação (
                {preview.reconciliacao.length})
              </h3>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                Subidos que sumiram da lista: cruzam com vendas (vendido) ou voltam pra marcado.
              </p>
              {preview.reconciliacao.length === 0 ? (
                <p className="mt-3 text-xs text-[var(--text-muted)]">Nada a reconciliar.</p>
              ) : (
                <ul className="mt-3 space-y-1.5 text-xs">
                  {vendidos.map((r) => (
                    <li key={r.repasse_id} className="flex items-center justify-between gap-2">
                      <span className="truncate">
                        <span className="font-mono font-medium text-[var(--text-strong)]">
                          {r.placa_norm}
                        </span>{" "}
                        {r.modelo}
                      </span>
                      <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                        vendido {r.valor_vendido != null ? formatBRLCents(r.valor_vendido) : ""}
                      </span>
                    </li>
                  ))}
                  {marcados.map((r) => (
                    <li key={r.repasse_id} className="flex items-center justify-between gap-2">
                      <span className="truncate">
                        <span className="font-mono font-medium text-[var(--text-strong)]">
                          {r.placa_norm}
                        </span>{" "}
                        {r.modelo}
                      </span>
                      <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                        marcado
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Pendências */}
            <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-4">
              <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-strong)]">
                <Ban className="h-4 w-4 text-rose-600" /> Pendências sem chassi (
                {preview.pendencias.length})
              </h3>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                Consignados sem chassi no estoque — NÃO serão criados.
              </p>
              {preview.pendencias.length === 0 ? (
                <p className="mt-3 text-xs text-[var(--text-muted)]">Nenhuma pendência.</p>
              ) : (
                <ul className="mt-3 space-y-1.5 text-xs">
                  {preview.pendencias.map((p, idx) => (
                    <li key={idx} className="truncate">
                      <span className="font-mono font-medium text-[var(--text-strong)]">
                        {p.registro.placa_norm}
                      </span>{" "}
                      {p.registro.modelo ?? "—"}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Confirmar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-4">
            <span className="text-sm text-[var(--text-muted)]">
              {criar.length} criar · {atualizar.length} atualizar · {vendidos.length} vendidos ·{" "}
              {marcados.length} marcados · {preview.pendencias.length} pendências
            </span>
            <button
              type="button"
              onClick={() => void confirmar()}
              disabled={confirmando || totalGravar === 0}
              className="inline-flex items-center gap-2 rounded-md bg-[var(--brand-700)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-800)] disabled:opacity-50"
            >
              {confirmando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {confirmando ? "Gravando…" : "Confirmar gravação"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Bloco de itens Criar/Atualizar (placa, modelo, custo real). */
function BlocoItens({
  titulo,
  icone,
  itens,
  vazio,
}: {
  titulo: string;
  icone: React.ReactNode;
  itens: ReadonlyArray<PreviewItem>;
  vazio: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-4">
      <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-strong)]">
        {icone} {titulo} ({itens.length})
      </h3>
      {itens.length === 0 ? (
        <p className="mt-3 text-xs text-[var(--text-muted)]">{vazio}</p>
      ) : (
        <ul className="mt-3 space-y-1.5 text-xs">
          {itens.map((it, idx) => (
            <li key={idx} className="flex items-center justify-between gap-2">
              <span className="truncate">
                <span className="font-mono font-medium text-[var(--text-strong)]">
                  {it.registro.placa_norm}
                </span>{" "}
                {it.registro.modelo ?? "—"}
                {it.registro.km != null ? ` · ${formatInt(it.registro.km)} km` : ""}
              </span>
              <span className="shrink-0 tabular-nums text-[var(--text-muted)]">
                {it.custo_real != null ? formatBRLCents(it.custo_real) : "—"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
