"use client";

/**
 * Modal de configuração do Relatório de Estoque Customizável.
 *
 * O Marcos marca QUAIS colunas quer exportar (do catálogo `colunas-estoque`,
 * agrupadas em 5 grupos colapsáveis) e pode adicionar colunas em branco
 * personalizadas (nome livre, até 15 — ver `colunas-branco.ts`). A seleção é
 * lembrada entre exports via `usePersistedState` (sessionStorage). Ao
 * exportar, gera o XLSX e baixa.
 *
 * Busca: filtra colunas por label (ignora acento/caixa). Grupo sem nenhuma
 * coluna correspondente some; grupo com match expande sozinho mostrando só as
 * colunas que batem. Limpar a busca volta ao estado padrão de expansão (não
 * herda o que a busca forçou). As colunas em branco NÃO entram na busca —
 * ficam numa seção fixa, sempre expandida, no fim da área com scroll.
 *
 * Ordem de exportação: com 2+ itens selecionados (dado + branco nomeado), uma
 * seção plana no fim deixa reordenar a sequência final das colunas no XLSX
 * (botões subir/descer, sem wrap-around). A ordem é persistida e reconciliada
 * a cada render contra a seleção atual (ver `ordem-colunas-estoque.ts`):
 * coluna desmarcada some da lista, coluna marcada entra sempre no FIM.
 *
 * Acessibilidade: fecha com ESC (ou limpa a busca, se ela estiver focada e
 * com texto) e clique fora; headers de grupo são `<button>` com
 * aria-expanded/aria-controls reais; ícones de confiança têm aria-label via
 * Tooltip.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleHelp,
  FileSpreadsheet,
  Search,
  Trash2,
  TriangleAlert,
  UploadCloud,
  X,
} from "lucide-react";
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
import {
  adicionarColunaBranco,
  colunasBrancoParaExportar,
  focoAposRemover,
  inserirColunaBrancoApos,
  LIMITE_COLUNAS_BRANCO,
  mensagemColunaBrancoAdicionada,
  mensagemColunaBrancoRemovida,
  migrarColunasBrancoLegado,
  nenhumaColunaBrancoComNome,
  removerColunaBranco,
  renomearColunaBranco,
  textoAuxiliarColunaBranco,
  type ColunaBranco,
} from "@/lib/export/colunas-branco";
import {
  ariaLabelMoverItem,
  itensOrdemExportacao,
  mensagemItemMovido,
  moverItemOrdem,
  reconciliarOrdemColunas,
  resolverOrdemParaExportacao,
} from "@/lib/export/ordem-colunas-estoque";
import { baixarRelatorioEstoque, construirDefEstoque } from "@/lib/export/relatorio/estoque";
import type { VeiculoExportavel } from "@/lib/export/colunas-estoque";
import { usePersistedState } from "@/lib/hooks/usePersistedState";
import { showErrorToast, showSuccessToast } from "@/components/ui/Toast";
import { Tooltip } from "@/components/ui/Tooltip";

/** Gera um id estável pra uma nova linha de coluna em branco (só identidade de UI/React key). */
function criarIdColunaBranco(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `col-branco-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export type ConfigurarRelatorioEstoqueModalProps = {
  open: boolean;
  onClose: () => void;
  /** Veículos já filtrados + enriquecidos com empresa_nome. */
  veiculos: VeiculoExportavel[];
  /** Nome da loja filtrada (ou "TODAS"). */
  filtroLoja: string;
};

const TEXTO_CONFIANCA_BAIXA =
  "Confiança baixa: na amostra testada esse valor veio zerado na maioria dos carros. O código de custo existe no Oracle mas ainda não foi confirmado — salvo quando o ícone de upload ao lado indica que veio do PDF subido manualmente. Use com cautela.";
const TEXTO_NAO_APURADO =
  "Não apurado: aparece como — no Excel (não é R$ 0,00) — ainda não existe fórmula de cálculo definida pra essa categoria, salvo quando o ícone de upload ao lado indica que veio do PDF subido manualmente.";
const TEXTO_DIVERGE_RELATORIO =
  "O valor automático (Oracle) é real (imposto efetivamente lançado na aquisição), mas é uma métrica DIFERENTE da que o relatório nativo NBS mostra na coluna de mesmo nome — aquele valor é calculado internamente pelo NBS e não está disponível pra nós, então o automático pode divergir dele mesmo vindo ≠ 0. Quando você sobe o PDF na tela Upload (ícone de upload ao lado), o valor do upload sempre prevalece sobre o automático — é o valor real do relatório nativo, já que vem do PDF dele.";
const TEXTO_CUSTO_DETALHADO_PARCIAL =
  "Esta soma inclui categorias com confiança baixa, ainda não apuradas ou que divergem do relatório nativo (Revisões, HoldBack, Acessórios, Comissões, ADM, Despesas Gerais, Impostos) — pode estar subestimada ou não bater com o relatório nativo. Use com cautela.";
const TEXTO_FALLBACK_MANUAL =
  "Pode vir do upload manual: quando o valor automático (Oracle) vier zerado/não apurado, esta coluna usa o relatório \"Custos de Veículos em Estoque\" (PDF subido na tela Upload) como alternativa. Esse valor só atualiza quando alguém sobe o PDF de novo — pode estar desatualizado.";
const TEXTO_FALLBACK_MANUAL_IMPOSTOS =
  "Pode vir do upload manual: diferente das outras colunas com este ícone, aqui o valor do upload (PDF subido na tela Upload) prevalece SEMPRE que existir — mesmo quando o automático (Oracle) também tiver valor ≠ 0 — porque o automático mede uma métrica diferente da do relatório nativo (ver ícone de confiança ao lado). Esse valor só atualiza quando alguém sobe o PDF de novo — pode estar desatualizado.";

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
  if (confianca === "parcial") {
    return (
      <Tooltip content={TEXTO_CUSTO_DETALHADO_PARCIAL} ariaLabel={TEXTO_CUSTO_DETALHADO_PARCIAL} side="top">
        <TriangleAlert size={13} className="text-amber-600 dark:text-amber-400" aria-hidden="true" />
      </Tooltip>
    );
  }
  if (confianca === "diverge_relatorio") {
    return (
      <Tooltip content={TEXTO_DIVERGE_RELATORIO} ariaLabel={TEXTO_DIVERGE_RELATORIO} side="top">
        <TriangleAlert size={13} className="text-amber-600 dark:text-amber-400" aria-hidden="true" />
      </Tooltip>
    );
  }
  return null;
}

/**
 * Ícone extra (independente de `confianca`) avisando que a coluna pode cair
 * pro upload manual. `chave` seleciona o texto: Impostos tem prioridade
 * invertida (manual vence sempre que existir, não só quando automático = 0)
 * — ver `resolverCustoImpostosComPrioridadeManual`.
 */
function IconeFallbackManual({ ativo, chave }: { ativo?: boolean; chave?: ColunaKey }) {
  if (!ativo) return null;
  const texto = chave === "custo_impostos" ? TEXTO_FALLBACK_MANUAL_IMPOSTOS : TEXTO_FALLBACK_MANUAL;
  return (
    <Tooltip content={texto} ariaLabel={texto} side="top">
      <UploadCloud size={13} className="text-blue-600 dark:text-blue-400" aria-hidden="true" />
    </Tooltip>
  );
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

  // Preferências antigas (2 checkboxes fixos) — só lidas, nunca mais escritas.
  // Servem de DEFAULT pra migração one-shot da nova lista abaixo (ver
  // `migrarColunasBrancoLegado`): quem tinha "Observações"/"Anotações"
  // marcado ganha as linhas já preenchidas na 1ª abertura pós-deploy.
  const [incluirObsLegado] = usePersistedState<boolean>("estoque:relatorioCustom:observacoes", false);
  const [incluirAnotacoesLegado] = usePersistedState<boolean>("estoque:relatorioCustom:anotacoes", false);

  // Memoizado: só recalcula (com novos crypto.randomUUID()) 1x por montagem —
  // caso contrário, qualquer re-render antes da chave existir no
  // sessionStorage troca os IDs das linhas migradas e força remount dos
  // inputs "Observações"/"Anotações", podendo perder foco/estado não-commitado.
  const colunasBrancoMigradas = useMemo(
    () => migrarColunasBrancoLegado(incluirObsLegado, incluirAnotacoesLegado, criarIdColunaBranco),
    [incluirObsLegado, incluirAnotacoesLegado],
  );
  const [colunasBranco, setColunasBranco] = usePersistedState<ColunaBranco[]>(
    "estoque:relatorioCustom:colunasBranco",
    colunasBrancoMigradas,
  );
  const [mensagemColunaBranco, setMensagemColunaBranco] = useState("");
  const [exportando, setExportando] = useState(false);

  // Ordem de exportação (seção "Ordem de exportação", ver cabeçalho do
  // arquivo). Persistida crua; `ordemReconciliada` é a versão sempre
  // sincronizada com a seleção ATUAL de colunas/colunas em branco — usada pra
  // renderizar e exportar. O efeito abaixo escreve a reconciliação de volta
  // no sessionStorage (senão um item desmarcado e remarcado reapareceria na
  // posição antiga, em vez de entrar no fim — ver `reconciliarOrdemColunas`).
  const [ordemColunas, setOrdemColunas] = usePersistedState<string[]>(
    "estoque:relatorioCustom:ordem",
    [],
  );
  const ordemReconciliada = useMemo(
    () => reconciliarOrdemColunas(ordemColunas, colunasSel, colunasBranco),
    [ordemColunas, colunasSel, colunasBranco],
  );
  useEffect(() => {
    const igual =
      ordemReconciliada.length === ordemColunas.length &&
      ordemReconciliada.every((token, i) => token === ordemColunas[i]);
    if (!igual) setOrdemColunas(ordemReconciliada);
  }, [ordemReconciliada, ordemColunas, setOrdemColunas]);

  const [ordemSecaoExpandida, setOrdemSecaoExpandida] = useState(true);
  const [mensagemOrdemMovida, setMensagemOrdemMovida] = useState("");
  const [focoOrdemPendente, setFocoOrdemPendente] = useState<string | null>(null);
  const botoesOrdemRef = useRef<Map<string, HTMLButtonElement>>(new Map());

  useEffect(() => {
    if (focoOrdemPendente == null) return;
    const id = requestAnimationFrame(() => {
      botoesOrdemRef.current.get(focoOrdemPendente)?.focus();
      setFocoOrdemPendente(null);
    });
    return () => cancelAnimationFrame(id);
  }, [focoOrdemPendente]);

  const [busca, setBusca] = useState("");
  const [gruposExpandidos, setGruposExpandidos] = useState<ReadonlySet<GrupoColuna>>(() =>
    gruposAbertosPorDefault(),
  );
  const buscaInputRef = useRef<HTMLInputElement | null>(null);

  // Foco das linhas de coluna em branco: alvo pendente (id da linha, ou o
  // botão "+ Adicionar") aplicado no próximo paint via rAF — mesma técnica já
  // usada no foco do campo de busca, abaixo.
  const [focoColunaBrancoPendente, setFocoColunaBrancoPendente] = useState<string | null>(null);
  const inputsColunaBrancoRef = useRef<Map<string, HTMLInputElement>>(new Map());
  const botaoAdicionarColunaBrancoRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (focoColunaBrancoPendente == null) return;
    const id = requestAnimationFrame(() => {
      if (focoColunaBrancoPendente === "botao-adicionar") {
        botaoAdicionarColunaBrancoRef.current?.focus();
      } else {
        inputsColunaBrancoRef.current.get(focoColunaBrancoPendente)?.focus();
      }
      setFocoColunaBrancoPendente(null);
    });
    return () => cancelAnimationFrame(id);
  }, [focoColunaBrancoPendente]);

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
  const nenhumaColuna = selecionadas.size === 0 && nenhumaColunaBrancoComNome(colunasBranco);

  function toggleColuna(key: ColunaKey) {
    setColunasSel((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }

  function handleAdicionarColunaBranco() {
    const novoId = criarIdColunaBranco();
    const next = adicionarColunaBranco(colunasBranco, novoId);
    setColunasBranco(next);
    setMensagemColunaBranco(mensagemColunaBrancoAdicionada(next.length));
    setFocoColunaBrancoPendente(novoId);
  }

  function handleInserirColunaBrancoApos(idAtual: string) {
    const novoId = criarIdColunaBranco();
    const next = inserirColunaBrancoApos(colunasBranco, idAtual, novoId);
    setColunasBranco(next);
    if (next.length !== colunasBranco.length) {
      setMensagemColunaBranco(mensagemColunaBrancoAdicionada(next.length));
    }
    setFocoColunaBrancoPendente(novoId);
  }

  function handleRemoverColunaBranco(id: string) {
    const alvoFoco = focoAposRemover(colunasBranco, id);
    const next = removerColunaBranco(colunasBranco, id);
    setColunasBranco(next);
    setMensagemColunaBranco(mensagemColunaBrancoRemovida(next.length));
    setFocoColunaBrancoPendente(alvoFoco ?? "botao-adicionar");
  }

  function handleRenomearColunaBranco(id: string, nome: string) {
    setColunasBranco(renomearColunaBranco(colunasBranco, id, nome));
  }

  // Itens da seção "Ordem de exportação" — lista plana, já na ordem atual.
  const itensOrdem = itensOrdemExportacao(ordemReconciliada, colunasBranco);

  function handleMoverItemOrdem(indice: number, direcao: "cima" | "baixo") {
    const item = itensOrdem[indice];
    if (!item) return;
    setOrdemColunas(moverItemOrdem(ordemReconciliada, indice, direcao));
    const novaPosicao = direcao === "cima" ? indice : indice + 2;
    setMensagemOrdemMovida(mensagemItemMovido(item.label, novaPosicao, itensOrdem.length));
    setFocoOrdemPendente(`${item.token}:${direcao}`);
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
        colunasBranco: colunasBrancoParaExportar(colunasBranco),
        ordem: resolverOrdemParaExportacao(ordemReconciliada, colunasBranco),
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
                            <IconeFallbackManual ativo={c.fallbackManual} chave={c.key} />
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}

          <div className="my-3 border-t border-[var(--border-soft)]" />

          <section aria-labelledby="colunas-branco-heading" className="px-2 pb-2">
            <h3 id="colunas-branco-heading" className="mb-2 text-sm font-semibold text-[var(--text-strong)]">
              Colunas em branco personalizadas ({colunasBranco.length}/{LIMITE_COLUNAS_BRANCO})
            </h3>

            <div aria-live="polite" className="sr-only">
              {mensagemColunaBranco}
            </div>

            <div className="flex flex-col gap-2">
              {colunasBranco.map((coluna, idx) => {
                const posicao = idx + 1;
                const aux = textoAuxiliarColunaBranco(colunasBranco, coluna);
                const nomeTrim = coluna.nome.trim();
                return (
                  <div key={coluna.id} className="flex flex-col gap-1">
                    <div className="flex min-h-[40px] items-center gap-2">
                      <input
                        ref={(el) => {
                          if (el) inputsColunaBrancoRef.current.set(coluna.id, el);
                          else inputsColunaBrancoRef.current.delete(coluna.id);
                        }}
                        type="text"
                        value={coluna.nome}
                        onChange={(e) => handleRenomearColunaBranco(coluna.id, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && nomeTrim !== "") {
                            e.preventDefault();
                            handleInserirColunaBrancoApos(coluna.id);
                          }
                        }}
                        placeholder="Ex.: Conferido por, Data de revisão…"
                        aria-label={`Nome da coluna em branco ${posicao}`}
                        className="w-full flex-1 rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-body)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-700)]"
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoverColunaBranco(coluna.id)}
                        aria-label={nomeTrim !== "" ? `Remover coluna "${nomeTrim}"` : `Remover coluna em branco ${posicao}`}
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-muted)]"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                    {aux && <p className="px-1 text-xs text-amber-600 dark:text-amber-400">{aux}</p>}
                  </div>
                );
              })}
            </div>

            <button
              ref={botaoAdicionarColunaBrancoRef}
              type="button"
              onClick={handleAdicionarColunaBranco}
              disabled={colunasBranco.length >= LIMITE_COLUNAS_BRANCO}
              aria-disabled={colunasBranco.length >= LIMITE_COLUNAS_BRANCO}
              aria-describedby={colunasBranco.length >= LIMITE_COLUNAS_BRANCO ? "limite-colunas-branco" : undefined}
              className="mt-2 rounded-md border border-[var(--border-base)] px-3 py-2 text-sm text-[var(--text-body)] hover:bg-[var(--bg-muted)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              + Adicionar coluna em branco
            </button>
            {colunasBranco.length >= LIMITE_COLUNAS_BRANCO && (
              <p id="limite-colunas-branco" className="mt-1 text-xs text-[var(--text-muted)]">
                Limite de 15 colunas atingido.
              </p>
            )}
          </section>

          {itensOrdem.length >= 2 && (
            <>
              <div className="my-3 border-t border-[var(--border-soft)]" />
              <section aria-labelledby="ordem-exportacao-heading" className="px-2 pb-2">
                <button
                  type="button"
                  aria-expanded={ordemSecaoExpandida}
                  aria-controls="ordem-exportacao-painel"
                  onClick={() => setOrdemSecaoExpandida((v) => !v)}
                  className="flex min-h-[40px] w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-semibold text-[var(--text-strong)] hover:bg-[var(--bg-muted)]"
                >
                  {ordemSecaoExpandida ? (
                    <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                  )}
                  <span id="ordem-exportacao-heading">
                    Ordem de exportação ({itensOrdem.length} coluna{itensOrdem.length === 1 ? "" : "s"})
                  </span>
                </button>

                <div aria-live="polite" className="sr-only">
                  {mensagemOrdemMovida}
                </div>

                {ordemSecaoExpandida && (
                  <div id="ordem-exportacao-painel" className="flex flex-col gap-1 pl-2">
                    {itensOrdem.map((item, idx) => {
                      const posicao = idx + 1;
                      const total = itensOrdem.length;
                      return (
                        <div
                          key={item.token}
                          className="flex min-h-[40px] items-center gap-2 rounded-md px-2 py-1.5 text-sm text-[var(--text-body)]"
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {item.label}{" "}
                            <span className="text-xs text-[var(--text-muted)]">— {item.tagGrupo}</span>
                          </span>
                          <button
                            type="button"
                            ref={(el) => {
                              const chave = `${item.token}:cima`;
                              if (el) botoesOrdemRef.current.set(chave, el);
                              else botoesOrdemRef.current.delete(chave);
                            }}
                            onClick={() => handleMoverItemOrdem(idx, "cima")}
                            disabled={idx === 0}
                            aria-label={ariaLabelMoverItem(item.label, posicao, total, "cima")}
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-muted)] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <ChevronUp className="h-4 w-4" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            ref={(el) => {
                              const chave = `${item.token}:baixo`;
                              if (el) botoesOrdemRef.current.set(chave, el);
                              else botoesOrdemRef.current.delete(chave);
                            }}
                            onClick={() => handleMoverItemOrdem(idx, "baixo")}
                            disabled={idx === total - 1}
                            aria-label={ariaLabelMoverItem(item.label, posicao, total, "baixo")}
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-muted)] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <ChevronDown className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </>
          )}
        </div>

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
