"use client";
/* eslint-disable react-hooks/set-state-in-effect --
 * Reset de estado quando o drawer abre + sincronização com fetch assíncrono
 * dos modelos FIPE. Padrão idiomático React pra data fetching → state.
 */

/**
 * Drawer lateral pra revisar/corrigir o match FIPE de um veículo.
 *
 * Fluxo:
 *   1. Mostra o match atual (se houver) + sugestões alternativas dentro da mesma marca.
 *   2. Usuário escolhe outro modelo OU busca manual pelo nome.
 *   3. Opcionalmente aplica em todos os carros com o mesmo `modelKey` no estoque.
 *   4. Confirma → `saveMatch` (localStorage) + `upsertBatchItem` (cache + Supabase + evento).
 *
 * Após confirmar, `useFipeBatch` recebe o `notify()` e o `usePrecificacao`
 * recalcula o diagnóstico/sugestão automaticamente.
 *
 * UI: slide-in 480px à direita, ESC fecha, focus trap simples (autofocus no botão fechar).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, X } from "lucide-react";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";
import type { FipeMarca, FipeModelo, FipeAno, FipeMatch } from "@/lib/fipe/types";
import { getMarcas, getModelos, getAnos, getValor, parseFipeValor } from "@/lib/fipe/service";
import { findMarca, findModelos, findAno } from "@/lib/fipe/matcher";
import { saveMatch, forgetMatch, forgetModelMatch, countSimilarVeiculos } from "@/lib/store/fipeMatches";
import { upsertBatchItem } from "@/lib/fipe/batch";
import { useInventory } from "@/lib/store/inventory";
import { cn } from "@/lib/utils";

type Props = {
  veiculo: VeiculoParsed;
  open: boolean;
  onClose: () => void;
};

type LoadState =
  | { kind: "idle" }
  | { kind: "loading"; msg: string }
  | { kind: "ready"; marca: FipeMarca; modelos: FipeModelo[]; sugeridos: FipeModelo[] }
  | { kind: "error"; message: string };

export function FipeReviewDrawer({ veiculo, open, onClose }: Props) {
  const { veiculos } = useInventory();
  const similares = useMemo(() => countSimilarVeiculos(veiculo, veiculos), [veiculo, veiculos]);

  const [load, setLoad] = useState<LoadState>({ kind: "idle" });
  const [busca, setBusca] = useState("");
  const [aplicarTodos, setAplicarTodos] = useState(true);
  const [confirmando, setConfirmando] = useState(false);
  const [escolhido, setEscolhido] = useState<FipeModelo | null>(null);
  const fecharBtn = useRef<HTMLButtonElement>(null);

  // ─ Carrega modelos da marca quando o drawer abre ─
  useEffect(() => {
    if (!open) return;
    setEscolhido(null);
    setBusca("");
    setLoad({ kind: "loading", msg: "Carregando modelos FIPE…" });
    let ativo = true;
    (async () => {
      try {
        const marcas = await getMarcas();
        const marca = veiculo.marca ? findMarca(veiculo.marca, marcas) : null;
        if (!marca) {
          if (ativo) setLoad({ kind: "error", message: `Marca "${veiculo.marca ?? "—"}" não encontrada na FIPE.` });
          return;
        }
        const modelos = await getModelos(marca.codigo);
        const sugeridos = findModelos(veiculo.modelo, modelos, 5, veiculo.combustivel ?? null).map((m) => m.modelo);
        if (ativo) setLoad({ kind: "ready", marca, modelos, sugeridos });
      } catch (err) {
        if (ativo) setLoad({ kind: "error", message: err instanceof Error ? err.message : "Erro desconhecido" });
      }
    })();
    return () => {
      ativo = false;
    };
  }, [open, veiculo.chassi, veiculo.marca, veiculo.modelo, veiculo.combustivel]);

  // ─ ESC fecha + autofocus ─
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    fecharBtn.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // ─ Filtragem da busca manual ─
  const modelosFiltrados = useMemo(() => {
    if (load.kind !== "ready") return [];
    const q = busca.trim().toUpperCase();
    if (!q) return [];
    return load.modelos.filter((m) => m.nome.toUpperCase().includes(q)).slice(0, 20);
  }, [load, busca]);

  async function handleConfirmar() {
    if (load.kind !== "ready" || !escolhido || confirmando) return;
    setConfirmando(true);
    try {
      const anos = await getAnos(load.marca.codigo, escolhido.codigo);
      const matchedAno = findAno(veiculo.ano_modelo, veiculo.combustivel, anos);
      const ano: FipeAno | null = matchedAno ?? anos[0] ?? null;
      if (!ano) throw new Error("Nenhum ano disponível pra esse modelo na FIPE.");
      const valor = await getValor(load.marca.codigo, escolhido.codigo, ano.codigo);
      const precoFipe = parseFipeValor(valor.Valor);
      if (!Number.isFinite(precoFipe) || precoFipe <= 0) {
        throw new Error(`FIPE retornou valor inválido: ${valor.Valor}`);
      }

      const match: FipeMatch = {
        marcaCod: load.marca.codigo,
        marcaNome: load.marca.nome,
        modeloCod: escolhido.codigo,
        modeloNome: escolhido.nome,
        anoCod: ano.codigo,
        anoNome: ano.nome,
      };

      // Localstorage: chassi + (opcional) modelo aprendido
      if (aplicarTodos) {
        // Esquece o aprendizado antigo do modelo antes de re-salvar (saveMatch faz isso implicitamente).
        forgetModelMatch(veiculo);
      } else {
        // Só pra esse chassi — limpa o modelKey pro outros não pegarem.
        // Não chama forgetModelMatch aqui pra não bagunçar matches existentes.
      }
      forgetMatch(veiculo);
      saveMatch(veiculo, match);

      // Batch: atualiza cache em memória + Supabase + dispara evento (faz a UI reagir)
      const targets = aplicarTodos
        ? [veiculo, ...veiculos.filter((v) => v.chassi !== veiculo.chassi && saoSimilares(v, veiculo))]
        : [veiculo];

      // Persiste em paralelo pra ser rápido — mas aguarda TODOS pra reportar falhas.
      const resultados = await Promise.all(
        targets.map((v) => upsertBatchItem({ chassi: v.chassi, precoFipe, match })),
      );
      if (aplicarTodos) {
        for (const v of targets) {
          if (v.chassi !== veiculo.chassi) saveMatch(v, match);
        }
      }

      const falhas = resultados.filter((r) => !r).length;
      // B.2b-F13: ramifica copy — falha total vs parcial cobrem cenários distintos.
      if (falhas === targets.length) {
        alert(
          "Nenhum match foi salvo no servidor. Reabra a revisão FIPE quando a conexão voltar.",
        );
      } else if (falhas > 0) {
        alert(
          `${falhas} de ${targets.length} match${targets.length === 1 ? "" : "es"} FIPE não foram salvos no servidor. ` +
            `A correção aparece nessa sessão, mas pode se perder no próximo reload. Tente novamente.`,
        );
      }

      onClose();
    } catch (err) {
      console.error("Falha ao confirmar match FIPE:", err);
      alert(err instanceof Error ? err.message : "Não foi possível salvar o match.");
    } finally {
      setConfirmando(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Revisar match FIPE">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Drawer */}
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-[480px] flex-col bg-[var(--bg-surface)] shadow-2xl">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-[var(--border-soft)] px-5 py-4">
          <h2 className="text-base font-semibold text-[var(--text-strong)]">Revisar match FIPE</h2>
          <button
            ref={fecharBtn}
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-muted)] hover:text-[var(--text-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-400)]"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 text-sm">
          <div className="rounded-lg bg-[var(--bg-muted)] p-3">
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Modelo NBS</p>
            <p className="font-mono text-xs text-[var(--text-body)]">{veiculo.modelo}</p>
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">
              {veiculo.marca ?? "—"} · {veiculo.ano_modelo ?? "—"} · {veiculo.combustivel ?? "—"}
            </p>
          </div>

          {load.kind === "loading" && (
            <p className="mt-4 flex items-center gap-2 text-xs text-[var(--text-muted)]">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> {load.msg}
            </p>
          )}

          {load.kind === "error" && (
            <div className="mt-4 rounded-md bg-red-50 p-3 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">
              <p>{load.message}</p>
              <button
                type="button"
                onClick={() => setLoad({ kind: "idle" })}
                className="mt-1 inline-flex items-center gap-1 underline"
              >
                <RefreshCw className="h-3 w-3" aria-hidden="true" /> tentar novamente
              </button>
            </div>
          )}

          {load.kind === "ready" && (
            <div className="mt-4 space-y-4">
              {load.sugeridos.length > 0 && (
                <section>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    Sugestões automáticas
                  </p>
                  <ul className="space-y-1">
                    {load.sugeridos.map((m) => (
                      <ModeloOption
                        key={m.codigo}
                        modelo={m}
                        selecionado={escolhido?.codigo === m.codigo}
                        onClick={() => setEscolhido(m)}
                      />
                    ))}
                  </ul>
                </section>
              )}

              <section>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Buscar manualmente
                </label>
                <input
                  type="text"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder={`Buscar nos ${load.modelos.length} modelos ${load.marca.nome}…`}
                  className="w-full rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-3 py-2 text-xs focus:border-[var(--brand-400)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-400)]"
                />
                {modelosFiltrados.length > 0 && (
                  <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto">
                    {modelosFiltrados.map((m) => (
                      <ModeloOption
                        key={m.codigo}
                        modelo={m}
                        selecionado={escolhido?.codigo === m.codigo}
                        onClick={() => setEscolhido(m)}
                      />
                    ))}
                  </ul>
                )}
                {busca && modelosFiltrados.length === 0 && (
                  <p className="mt-2 text-[11px] text-[var(--text-muted)]">Nenhum modelo bate com &quot;{busca}&quot;.</p>
                )}
              </section>
            </div>
          )}
        </div>

        {/* Footer */}
        {load.kind === "ready" && (
          <footer className="border-t border-[var(--border-soft)] bg-[var(--bg-muted)] px-5 py-4">
            {similares > 0 && (
              <label className="flex items-start gap-2 text-xs text-[var(--text-body)]">
                <input
                  type="checkbox"
                  checked={aplicarTodos}
                  onChange={(e) => setAplicarTodos(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Aplicar pra todos os <span className="font-semibold">{veiculo.modelo}</span> no estoque
                  {" "}
                  <span className="text-[var(--text-muted)]">({similares + 1} carros)</span>
                </span>
              </label>
            )}
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md px-3 py-2 text-xs font-medium text-[var(--text-body)] hover:bg-[var(--bg-app)]"
                disabled={confirmando}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmar}
                disabled={!escolhido || confirmando}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold text-white",
                  "bg-[var(--brand-700)] hover:bg-[var(--brand-900)] disabled:cursor-not-allowed disabled:opacity-50",
                )}
              >
                {confirmando ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Salvando…
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Confirmar match
                  </>
                )}
              </button>
            </div>
          </footer>
        )}
      </aside>
    </div>
  );
}

function ModeloOption({
  modelo,
  selecionado,
  onClick,
}: {
  modelo: FipeModelo;
  selecionado: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-left text-xs",
          selecionado
            ? "border-[var(--brand-700)] bg-[var(--brand-50)] text-[var(--brand-900)] dark:bg-[var(--brand-950)] dark:text-[var(--brand-100)]"
            : "border-[var(--border-soft)] bg-[var(--bg-surface)] hover:border-[var(--border-base)] hover:bg-[var(--bg-muted)]",
        )}
      >
        <span>{modelo.nome}</span>
        <span className="font-mono text-[10px] text-[var(--text-muted)]">{modelo.codigo}</span>
      </button>
    </li>
  );
}

function saoSimilares(a: VeiculoParsed, b: VeiculoParsed): boolean {
  return (
    (a.marca ?? "").trim().toUpperCase() === (b.marca ?? "").trim().toUpperCase() &&
    a.modelo.trim().toUpperCase() === b.modelo.trim().toUpperCase() &&
    (a.ano_modelo ?? 0) === (b.ano_modelo ?? 0) &&
    (a.combustivel ?? "").trim().toUpperCase() === (b.combustivel ?? "").trim().toUpperCase()
  );
}

