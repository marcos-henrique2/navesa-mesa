"use client";

/**
 * Modal de configuração do Relatório de Estoque Customizável.
 *
 * O Marcos marca QUAIS colunas quer exportar (do catálogo `colunas-estoque`,
 * agrupadas em 5 grupos colapsáveis) e se quer colunas "Observações"/"Anotações"
 * em branco. A seleção é lembrada entre exports via `usePersistedState`
 * (sessionStorage). Ao exportar, gera o XLSX e baixa.
 *
 * Busca: filtra colunas por label (ignora acento/caixa). Grupo sem nenhuma
 * coluna correspondente some; grupo com match expande sozinho mostrando só as
 * colunas que batem. Limpar a busca volta ao estado padrão de expansão (não
 * herda o que a busca forçou).
 *
 * Acessibilidade: fecha com ESC (ou limpa a busca, se ela estiver focada e
 * com texto) e clique fora; headers de grupo são `<button>` com
 * aria-expanded/aria-controls reais; ícones de confiança têm aria-label via
 * Tooltip.
 */

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, CircleHelp, FileSpreadsheet, Search, TriangleAlert, X } from "lucide-react";
import {
  COLUNAS_ESTOQUE,
  COLUNAS_DEFAULT,
  GRUPOS_ESTOQUE,
  GRUPO_LABEL,
  colunaCorrespondeABusca,
  gruposAbertosPorDefault,
  type ColunaEstoque,
  type ColunaKey,
  type GrupoColuna,
} from "@/lib/export/colunas-estoque";
import { baixarRelatorioEstoque, construirDefEstoque } from "@/lib/export/relatorio/estoque";
import type { VeiculoExportavel } from "@/lib/export/colunas-estoque";
import { usePersistedState } from "@/lib/hooks/usePersistedState";
import { showErrorToast, showSuccessToast } from "@/components/ui/Toast";
import { Tooltip } from "@/components/ui/Tooltip";

export type ConfigurarRelatorioEstoqueModalProps = {
  open: boolean;
  onClose: () => void;
  /** Veículos já filtrados + enriquecidos com empresa_nome. */
  veiculos: VeiculoExportavel[];
  /** Nome da loja filtrada (ou "TODAS"). */
  filtroLoja: string;
};

const TEXTO_CONFIANCA_BAIXA =
  "Confiança baixa: na amostra testada esse valor veio zerado na maioria dos carros. O código de custo existe no Oracle mas ainda não foi confirmado. Use com cautela.";
const TEXTO_NAO_APURADO =
  "Não apurado: aparece como — no Excel (não é R$ 0,00) — ainda não existe fórmula de cálculo definida pra essa categoria.";

function todayISOLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function IconeConfianca({ confianca }: { confianca: ColunaEstoque["confianca"] }) {
  if (confianca === "baixa") {
    return (
      <Tooltip content={TEXTO_CONFIANCA_BAIXA} ariaLabel={TEXTO_CONFIANCA_BAIXA} side="top">
        <TriangleAlert size={13} className="text-amber-600 dark:text-amber-400" aria-hidden="true" />
      </Tooltip>
    );
  }
  if (confianca === "nao_apurado") {
    return (
      <Tooltip content={TEXTO_NAO_APURADO} ariaLabel={TEXTO_NAO_APURADO} side="top">
        <CircleHelp size={13} className="text-[var(--text-muted)]" aria-hidden="true" />
      </Tooltip>
    );
  }
  return null;
}

export function ConfigurarRelatorioEstoqueModal({
  open,
  onClose,
  veiculos,
  filtroLoja,
}: ConfigurarRelatorioEstoqueModalProps) {
  // Seleção persistida entre exports (sessionStorage, prefixo do projeto).
  const [colunasSel, setColunasSel] = usePersistedState<ColunaKey[]>(
    "estoque:relatorioCustom:colunas",
    [...COLUNAS_DEFAULT],
  );
  const [incluirObs, setIncluirObs] = usePersistedState<boolean>(
    "estoque:relatorioCustom:observacoes",
    true,
  );
  const [incluirAnotacoes, setIncluirAnotacoes] = usePersistedState<boolean>(
    "estoque:relatorioCustom:anotacoes",
    false,
  );
  const [exportando, setExportando] = useState(false);

  const [busca, setBusca] = useState("");
  const [gruposExpandidos, setGruposExpandidos] = useState<ReadonlySet<GrupoColuna>>(() =>
    gruposAbertosPorDefault(),
  );
  const buscaInputRef = useRef<HTMLInputElement | null>(null);

  const buscando = busca.trim().length > 0;

  function limparBusca() {
    setBusca("");
    setGruposExpandidos(gruposAbertosPorDefault());
  }

  function toggleGrupo(grupo: GrupoColuna) {
    setGruposExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(grupo)) next.delete(grupo);
      else next.add(grupo);
      return next;
    });
  }

  // Reseta busca/expansão a cada abertura (padrão React p/ ajustar estado
  // quando uma prop muda, sem setState síncrono dentro de efeito — ver
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).
  const [abriuComo, setAbriuComo] = useState(open);
  if (open !== abriuComo) {
    setAbriuComo(open);
    if (open) {
      setBusca("");
      setGruposExpandidos(gruposAbertosPorDefault());
    }
  }

  // Dá foco no campo de busca a cada abertura (efeito "de verdade": só
  // sincroniza o DOM, não dispara setState).
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => buscaInputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  // ESC: limpa a busca se ela estiver focada e com texto; senão fecha o modal.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      const buscaFocadaComTexto = document.activeElement === buscaInputRef.current && buscando;
      if (buscaFocadaComTexto) {
        limparBusca();
        return;
      }
      onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, buscando]);

  if (!open) return null;

  const selecionadas = new Set(colunasSel);
  const nenhumaColuna = selecionadas.size === 0 && !incluirObs && !incluirAnotacoes;

  function toggleColuna(key: ColunaKey) {
    setColunasSel((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }

  // Colunas visíveis por grupo (filtradas pela busca, quando ativa).
  const colunasPorGrupo = GRUPOS_ESTOQUE.map((grupo) => {
    const todas = COLUNAS_ESTOQUE.filter((c) => c.grupo === grupo);
    const visiveis = buscando ? todas.filter((c) => colunaCorrespondeABusca(c, busca)) : todas;
    return { grupo, todas, visiveis };
  });

  const totalColunasVisiveis = buscando
    ? colunasPorGrupo.reduce((acc, g) => acc + g.visiveis.length, 0)
    : 0;
  const totalGruposVisiveis = buscando
    ? colunasPorGrupo.filter((g) => g.visiveis.length > 0).length
    : 0;
  const semResultado = buscando && totalColunasVisiveis === 0;

  const mensagemAriaLive = !buscando
    ? ""
    : semResultado
      ? `Nenhuma coluna encontrada para "${busca.trim()}".`
      : `${totalColunasVisiveis} coluna${totalColunasVisiveis === 1 ? "" : "s"} em ${totalGruposVisiveis} grupo${totalGruposVisiveis === 1 ? "" : "s"} encontrada${totalColunasVisiveis === 1 ? "" : "s"} para "${busca.trim()}".`;

  async function exportar() {
    if (exportando || nenhumaColuna) return;
    setExportando(true);
    try {
      const def = construirDefEstoque({
        colunas: colunasSel,
        incluirObservacoes: incluirObs,
        incluirAnotacoes,
        filtroLoja,
      });
      await baixarRelatorioEstoque(def, veiculos);
      showSuccessToast(`relatorio-estoque-customizado-${todayISOLocal()}.xlsx baixado`);
      onClose();
    } catch (err) {
      console.error("Falha ao gerar relatório customizado:", err);
      showErrorToast("Erro ao gerar relatório customizado. Tente novamente.");
    } finally {
      setExportando(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Configurar relatório de estoque customizado"
    >
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-[var(--text-strong)]">
              Relatório de estoque customizado
            </h2>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              Escolha as colunas. O arquivo já vem com filtro em todas as colunas. Exporta os{" "}
              {veiculos.length} veículo{veiculos.length === 1 ? "" : "s"} filtrado
              {veiculos.length === 1 ? "" : "s"}.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--bg-muted)]"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto pr-1">
          <div className="sticky top-0 z-10 -mx-1 bg-[var(--bg-surface)] px-1 pb-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                ref={buscaInputRef}
                type="text"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar coluna por nome"
                aria-label="Buscar coluna por nome"
                className="w-full rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] py-2 pl-8 pr-8 text-sm text-[var(--text-body)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-700)]"
              />
              {busca.length > 0 && (
                <button
                  type="button"
                  onClick={limparBusca}
                  aria-label="Limpar busca"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--text-muted)] hover:bg-[var(--bg-muted)]"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          <div aria-live="polite" className="sr-only">
            {mensagemAriaLive}
          </div>

          {semResultado ? (
            <div className="flex flex-col items-center gap-3 px-2 py-10 text-center text-sm text-[var(--text-muted)]">
              <p>Nenhuma coluna encontrada para &quot;{busca.trim()}&quot;.</p>
              <button
                type="button"
                onClick={limparBusca}
                className="rounded-md border border-[var(--border-base)] px-3 py-1.5 text-xs text-[var(--text-body)] hover:bg-[var(--bg-muted)]"
              >
                Limpar busca
              </button>
            </div>
          ) : (
            colunasPorGrupo.map(({ grupo, todas, visiveis }) => {
              if (buscando && visiveis.length === 0) return null;
              const expandido = buscando ? true : gruposExpandidos.has(grupo);
              const painelId = `grupo-painel-${grupo}`;
              const marcadasNoGrupo = todas.filter((c) => selecionadas.has(c.key)).length;
              const contagemTexto = buscando
                ? `${visiveis.length}/${todas.length} correspondem`
                : `${marcadasNoGrupo}/${todas.length}`;

              return (
                <div key={grupo} className="mb-1">
                  <button
                    type="button"
                    aria-expanded={expandido}
                    aria-controls={painelId}
                    onClick={() => toggleGrupo(grupo)}
                    className="flex min-h-[40px] w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-semibold text-[var(--text-strong)] hover:bg-[var(--bg-muted)]"
                  >
                    {expandido ? (
                      <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                    )}
                    <span>
                      {GRUPO_LABEL[grupo]} ({contagemTexto})
                    </span>
                  </button>

                  {expandido && (
                    <div id={painelId} className="pb-2 pl-2">
                      {grupo === "custos_detalhados" && (
                        <p className="mb-1 px-2 text-xs text-[var(--text-muted)]">
                          Hoje só uma pequena parte do estoque tem custo detalhado fechado no
                          Oracle — a maioria dos carros vai aparecer com R$ 0,00 ou em branco
                          nessas colunas.
                        </p>
                      )}
                      <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
                        {visiveis.map((c) => (
                          <label
                            key={c.key}
                            className="flex min-h-[40px] cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-[var(--text-body)] hover:bg-[var(--bg-muted)]"
                          >
                            <input
                              type="checkbox"
                              checked={selecionadas.has(c.key)}
                              onChange={() => toggleColuna(c.key)}
                              className="h-4 w-4 accent-[var(--brand-700)]"
                            />
                            <span>{c.label}</span>
                            <IconeConfianca confianca={c.confianca} />
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        <label className="mt-3 flex cursor-pointer items-center gap-2 rounded-md border border-[var(--border-base)] bg-[var(--bg-muted)] px-3 py-2 text-sm text-[var(--text-body)]">
          <input
            type="checkbox"
            checked={incluirObs}
            onChange={(e) => setIncluirObs(e.target.checked)}
            className="h-4 w-4 accent-[var(--brand-700)]"
          />
          Incluir coluna de Observações (em branco) para anotar no Excel
        </label>

        <label className="mt-2 flex cursor-pointer items-center gap-2 rounded-md border border-[var(--border-base)] bg-[var(--bg-muted)] px-3 py-2 text-sm text-[var(--text-body)]">
          <input
            type="checkbox"
            checked={incluirAnotacoes}
            onChange={(e) => setIncluirAnotacoes(e.target.checked)}
            className="h-4 w-4 accent-[var(--brand-700)]"
          />
          Incluir coluna de Anotações (em branco) para anotar no Excel
        </label>

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          {nenhumaColuna && (
            <span className="mr-auto text-xs text-[var(--text-muted)]">
              Marque pelo menos uma coluna.
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-4 py-2 text-sm text-[var(--text-body)] hover:bg-[var(--bg-muted)]"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={exportar}
            disabled={exportando || nenhumaColuna}
            className="inline-flex items-center gap-2 rounded-md bg-[var(--brand-700)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-800)] disabled:opacity-50"
          >
            <FileSpreadsheet className="h-4 w-4" />
            {exportando ? "Gerando…" : "Exportar"}
          </button>
        </div>
      </div>
    </div>
  );
}
