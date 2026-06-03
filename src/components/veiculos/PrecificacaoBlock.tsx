"use client";
/* eslint-disable react-hooks/set-state-in-effect --
 * Sincronização assíncrona com Supabase (listarSugestoesPorChassi): o componente
 * precisa fazer setState dentro de useEffect pra refletir o estado de
 * reprecificação pendente do chassi atual. É o padrão idiomático pra esse caso
 * (data fetching → React state) e a regra é conservadora demais aqui.
 */

/**
 * BLOCO UNIFICADO DE PRECIFICAÇÃO — Fase B.2a
 *
 * Sucessor do `DiagnosticoBlock`. Une numa única superfície visual:
 *   1. Diagnóstico de coerência (5 estados + sem_dados) — zona quente sempre visível.
 *   2. Trio "Preço hoje | Esperado | Diferença".
 *   3. Strategy Selector (Target / Giro / Mínimo) — vem do `sugerirPreco`.
 *   4. CTAs primários (Copiar R$ X) + secundário (Marcar pra reprecificar).
 *   5. "Ver detalhes" colapsável: breakdown, avisos unificados, FIPE & matching,
 *      comparáveis do histórico.
 *
 * Fonte FIPE única: `usePrecificacao()` lê do `useFipeBatch` → reflete overrides
 * manuais feitos pelo `FipeReviewDrawer` em tempo real.
 */

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ClipboardCopy, Target, WifiOff } from "lucide-react";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";
import type { DiagnosticoResult } from "@/lib/pricing/diagnostico";
import type { PrecoSuggestion } from "@/lib/pricing/suggest";
import type { StatusCautelar } from "@/lib/inventory/cautelar";
import {
  listarSugestoesPorChassi,
  marcarParaReprecificar,
  desmarcarReprecificacao,
  type ReprecificacaoRow,
} from "@/lib/data/reprecificacao";
import {
  definirPrecoAlvo,
  buscarPrecoAlvoAtivo,
  revogarPrecoAlvo,
  type PrecoAlvoRow,
} from "@/lib/data/preco-alvo";
import { useFipeDirty } from "@/lib/fipe/useFipeDirty";
import { formatBRL, cn } from "@/lib/utils";
import { usePrecificacao } from "./usePrecificacao";
import { ConfidenceChip, type ConfidenceChipType } from "./ConfidenceChip";
import { StrategySelector, type EstrategiaId, type EstrategiaItem } from "./StrategySelector";
import { DetailsAccordion } from "./DetailsAccordion";
import { FipeReviewDrawer } from "./FipeReviewDrawer";
import { BreakdownAjustes, FipeSecao, ComparaveisSecao } from "./PrecificacaoDetails";
import {
  Numero,
  DiferencaCard,
  MarcarButton,
  PrecoAlvoIndicador,
} from "./PrecificacaoBlockSubcomponents";
import {
  APARENCIA,
  TITULO_POR_STATUS,
  PRESELECAO_POR_STATUS,
  deduplicarAvisos,
  renderFechamento,
  renderMetricaLateral,
} from "./precificacao-copy";

// ═════════════════════════════════════════════════════════════════════════════
// COMPONENTE
// ═════════════════════════════════════════════════════════════════════════════

export function PrecificacaoBlock({ veiculo }: { veiculo: VeiculoParsed }) {
  const { diagnostico, sugestao, medianaKm, cautelar, fipeBatchPreco } = usePrecificacao(veiculo);

  if (!diagnostico || !sugestao) return null;

  return (
    <PrecificacaoView
      veiculo={veiculo}
      diagnostico={diagnostico}
      sugestao={sugestao}
      medianaKm={medianaKm}
      cautelar={cautelar}
      fipeBatchPreco={fipeBatchPreco}
    />
  );
}

function PrecificacaoView({
  veiculo,
  diagnostico,
  sugestao,
  medianaKm,
  cautelar,
  fipeBatchPreco,
}: {
  veiculo: VeiculoParsed;
  diagnostico: DiagnosticoResult;
  sugestao: PrecoSuggestion;
  medianaKm: number | null;
  cautelar: StatusCautelar | null;
  fipeBatchPreco: number | null;
}) {
  const aparencia = APARENCIA[diagnostico.status];
  const { Icon } = aparencia;

  // ─ Estratégias derivadas da sugestão ─
  const estrategias = useMemo<EstrategiaItem[]>(() => {
    return [
      {
        id: "target",
        icone: "🎯",
        label: "Target",
        valor: sugestao.target.preco,
        margemPct: sugestao.target.margemSobreFaturamento,
        fonte: sugestao.baseUsada,
      },
      {
        id: "giro",
        icone: "⚡",
        label: "Giro rápido",
        valor: sugestao.giroRapido.preco,
        margemPct: sugestao.giroRapido.margemSobreFaturamento,
        fonte: sugestao.baseUsada,
      },
      {
        id: "minimo",
        icone: "🚨",
        label: "Mínimo",
        valor: sugestao.minimo.preco,
        margemPct: sugestao.minimo.margemSobreFaturamento,
        fonte: "custo",
      },
    ];
  }, [sugestao]);

  const preselecionada = PRESELECAO_POR_STATUS[diagnostico.status];
  const [estrategiaId, setEstrategiaId] = useState<EstrategiaId>(preselecionada ?? "target");
  // Override manual: quando o usuário clica num chip, a escolha "fixa" pra esse veículo.
  // Sem esse flag, qualquer mudança de status (ex: corrigir FIPE) reseta pra pré-seleção
  // e apaga a decisão do usuário.
  const [userOverride, setUserOverride] = useState(false);

  // Troca de veículo (novo chassi) — reset atômico: zera override E aplica pré-seleção do novo carro
  // no mesmo efeito. Evita 1 frame de flash com a estratégia errada (useEffect anterior rodava com
  // userOverride=true do snapshot e só no próximo render é que o reset propagava).
  //
  // `preselecionada` está fora das deps de propósito: ela é lida aqui pra capturar o valor desejado
  // no momento da troca de chassi. Mudanças DENTRO do mesmo chassi (ex: status muda quando o usuário
  // corrige FIPE) são cobertas pelo segundo useEffect abaixo.
  useEffect(() => {
    setUserOverride(false);
    setEstrategiaId(preselecionada ?? "target");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [veiculo.chassi]);

  // Status muda DENTRO do mesmo chassi (ex: usuário corrige FIPE e o status migra de subprecificado
  // pra coerente) — SOMENTE se o usuário ainda não escolheu manualmente.
  useEffect(() => {
    if (!userOverride && preselecionada) setEstrategiaId(preselecionada);
  }, [preselecionada, userOverride]);

  function handleSelecionarEstrategia(id: EstrategiaId) {
    setEstrategiaId(id);
    setUserOverride(true);
  }

  const estrategiaSelecionada = estrategias.find((e) => e.id === estrategiaId) ?? estrategias[0];

  // ─ Chips de confiança (zona quente) ─
  const chips = useMemo<Array<{ type: ConfidenceChipType; diasPatio?: number | null }>>(() => {
    const c = diagnostico.confianca;
    const out: Array<{ type: ConfidenceChipType; diasPatio?: number | null }> = [];
    if (c.recemEntrado) out.push({ type: "fresh", diasPatio: veiculo.dias_patio });
    if (c.semFipe) out.push({ type: "no-fipe" });
    if (c.semCautelar) out.push({ type: "no-cautelar" });
    if (c.kmHeuristica) out.push({ type: "km-heuristic" });
    if (c.semDiasPatio) out.push({ type: "no-dias-patio" });
    return out;
  }, [diagnostico.confianca, veiculo.dias_patio]);

  // ─ Avisos unificados (dedup confiança × operacional) ─
  const avisosOperacionais = useMemo(() => {
    return deduplicarAvisos(sugestao.alertas, diagnostico.confianca, veiculo.dias_patio);
  }, [sugestao.alertas, diagnostico.confianca, veiculo.dias_patio]);

  // ─ Estado da reprecificação (Supabase) ─
  const [pendente, setPendente] = useState<ReprecificacaoRow | null>(null);
  const [carregandoMarca, setCarregandoMarca] = useState(true);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let ativo = true;
    setCarregandoMarca(true);
    setPendente(null);
    listarSugestoesPorChassi(veiculo.chassi)
      .then((rows) => {
        if (!ativo) return;
        const p = rows.find((r) => r.status === "pendente" || r.status === "em_revisao") ?? null;
        setPendente(p);
      })
      .catch((err) => {
        console.error("PrecificacaoBlock: falha ao listar sugestões:", err);
      })
      .finally(() => {
        if (ativo) setCarregandoMarca(false);
      });
    return () => {
      ativo = false;
    };
  }, [veiculo.chassi]);

  // ─ Drawer FIPE ─
  const [drawerOpen, setDrawerOpen] = useState(false);

  // ─ B.2b-F12: badge "FIPE local não sincronizado" ─
  const fipeDirty = useFipeDirty(veiculo.chassi);

  // ─ Preço-alvo (B.2b-2) ─
  const [precoAlvoAtivo, setPrecoAlvoAtivo] = useState<PrecoAlvoRow | null>(null);
  const [carregandoAlvo, setCarregandoAlvo] = useState(true);
  const [salvandoAlvo, setSalvandoAlvo] = useState(false);

  useEffect(() => {
    let ativo = true;
    setCarregandoAlvo(true);
    setPrecoAlvoAtivo(null);
    buscarPrecoAlvoAtivo(veiculo.chassi)
      .then((row) => {
        if (!ativo) return;
        setPrecoAlvoAtivo(row);
      })
      .catch((err) => {
        console.error("PrecificacaoBlock: falha ao buscar preço-alvo:", err);
      })
      .finally(() => {
        if (ativo) setCarregandoAlvo(false);
      });
    return () => {
      ativo = false;
    };
  }, [veiculo.chassi]);

  // ─ Toast/feedback de copia ─
  const [copiado, setCopiado] = useState(false);

  async function copiarParaClipboard(valor: number): Promise<void> {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(String(valor));
      return;
    }
    // fallback bem simples
    const ta = document.createElement("textarea");
    ta.value = String(valor);
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }

  /**
   * CTA primário: define preço-alvo no Supabase + copia pra clipboard.
   * Falha do Supabase NÃO bloqueia o copy (operador ainda precisa do número
   * pra colar no DMS — só o registro de alvo é que não vai pro histórico).
   */
  async function handleDefinirPrecoAlvo() {
    if (salvandoAlvo) return;
    const valor = estrategiaSelecionada.valor;
    setSalvandoAlvo(true);
    let salvouAlvo = false;
    try {
      const row = await definirPrecoAlvo({
        chassi: veiculo.chassi,
        precoAlvo: valor,
        estrategia: estrategiaSelecionada.id,
        precoAtualSnapshot: veiculo.preco_venda,
        margemPctSnapshot: estrategiaSelecionada.margemPct,
        fonte: estrategiaSelecionada.fonte,
        versaoFormula: diagnostico.versao,
      });
      setPrecoAlvoAtivo(row);
      salvouAlvo = true;
    } catch (err) {
      console.error("Falha ao definir preço-alvo:", err);
      alert(err instanceof Error ? err.message : "Não foi possível salvar preço-alvo.");
    } finally {
      setSalvandoAlvo(false);
    }
    try {
      await copiarParaClipboard(valor);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1800);
    } catch (err) {
      console.warn("Falha ao copiar:", err);
      if (!salvouAlvo) alert(`Valor: R$ ${valor.toLocaleString("pt-BR")}`);
    }
  }

  async function handleRevogarPrecoAlvo() {
    if (salvandoAlvo || !precoAlvoAtivo) return;
    const previo = precoAlvoAtivo;
    setSalvandoAlvo(true);
    setPrecoAlvoAtivo(null);
    try {
      await revogarPrecoAlvo(veiculo.chassi);
    } catch (err) {
      console.error("Falha ao revogar preço-alvo:", err);
      setPrecoAlvoAtivo(previo);
      alert(err instanceof Error ? err.message : "Não foi possível revogar preço-alvo.");
    } finally {
      setSalvandoAlvo(false);
    }
  }

  async function handleMarcar() {
    if (salvando) return;
    setSalvando(true);
    try {
      const novo = await marcarParaReprecificar({
        chassi: veiculo.chassi,
        diagnostico,
        veiculoSnapshot: {
          preco_venda: veiculo.preco_venda,
          dias_patio: veiculo.dias_patio,
          km: veiculo.km,
        },
        cautelarSnapshot: cautelar,
        medianaKmSnapshot: medianaKm,
      });
      setPendente(novo);
    } catch (err) {
      console.error("Falha ao marcar pra reprecificar:", err);
      try {
        const sugs = await listarSugestoesPorChassi(veiculo.chassi);
        const ativa = sugs.find((s) => s.status === "pendente" || s.status === "em_revisao") ?? null;
        setPendente(ativa);
      } catch (reloadErr) {
        console.error("Falha ao recarregar estado pós-erro:", reloadErr);
      }
      alert(err instanceof Error ? err.message : "Não foi possível marcar pra reprecificar.");
    } finally {
      setSalvando(false);
    }
  }

  async function handleDesmarcar() {
    if (salvando || !pendente) return;
    setSalvando(true);
    const previo = pendente;
    setPendente(null);
    try {
      await desmarcarReprecificacao(veiculo.chassi);
    } catch (err) {
      console.error("Falha ao desmarcar:", err);
      setPendente(previo);
      alert(`Não foi possível desmarcar: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSalvando(false);
    }
  }

  const metricaLateral = renderMetricaLateral(diagnostico, veiculo);
  const fechamento = renderFechamento(diagnostico);
  const tituloContexto = TITULO_POR_STATUS[diagnostico.status];

  // ─ FIPE summary pro accordion ─
  const fipeMatch = fipeBatchPreco != null
    ? `FIPE ${formatBRL(fipeBatchPreco)}`
    : "Sem FIPE";
  const totalAvisos = chips.length + avisosOperacionais.length;
  const accordionSummary = (
    <span>
      {fipeMatch}
      {totalAvisos > 0 && (
        <>
          {" · "}
          {totalAvisos} aviso{totalAvisos === 1 ? "" : "s"}
        </>
      )}
    </span>
  );

  return (
    <>
      <section
        className={cn(
          "rounded-xl shadow-[var(--shadow-sm)]",
          aparencia.bg,
          aparencia.text,
          aparencia.border,
          aparencia.borderWidth,
        )}
      >
        {/* ─── ZONA QUENTE (sempre visível) ─── */}

        {/* Header */}
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-current/10 px-5 pt-4 pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span
              className={cn(
                "rounded-full px-2.5 py-0.5 text-xs font-bold tracking-wide",
                aparencia.badgeBg,
                aparencia.badgeText,
              )}
            >
              {aparencia.badgeLabel}
            </span>
            {diagnostico.status === "subprecificado_grave" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-200 px-2 py-0.5 text-[10px] font-bold tracking-wide text-red-900">
                ⚠ PERDA SIGNIFICATIVA
              </span>
            )}
            {fipeDirty && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold tracking-wide text-amber-800"
                role="status"
                title="O override FIPE em memória ainda não foi confirmado no servidor. Pode se perder no próximo reload."
              >
                <WifiOff className="h-3 w-3" aria-hidden="true" />
                FIPE local não sincronizado — recarregue pra confirmar
              </span>
            )}
            {chips.map((c, i) => (
              <ConfidenceChip key={`${c.type}-${i}`} type={c.type} diasPatio={c.diasPatio} />
            ))}
          </div>
          {metricaLateral && (
            <p className={cn("text-right text-xs sm:text-sm", metricaLateral.classe)}>
              {metricaLateral.texto}
            </p>
          )}
        </header>

        <div className="space-y-4 px-5 pt-4 pb-5">
          {/* Trio */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Numero label="Preço hoje" valor={formatBRL(diagnostico.precoAtual)} destaque={false} />
            <Numero
              label="Preço esperado"
              valor={diagnostico.precoEsperado > 0 ? formatBRL(diagnostico.precoEsperado) : "—"}
              destaque
            />
            <DiferencaCard diagnostico={diagnostico} />
          </div>

          {/* Strategy Selector — não aparece em sem_dados */}
          {diagnostico.status !== "sem_dados" && (
            <StrategySelector
              estrategias={estrategias}
              selecionadaId={estrategiaId}
              onChange={handleSelecionarEstrategia}
              userOverride={userOverride}
            />
          )}

          {/* CTAs */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {diagnostico.status !== "sem_dados" && (
              <button
                type="button"
                onClick={handleDefinirPrecoAlvo}
                disabled={salvandoAlvo}
                aria-label={`Definir ${formatBRL(estrategiaSelecionada.valor)} como preço-alvo e copiar pra área de transferência`}
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition",
                  aparencia.ctaBg,
                  aparencia.ctaText,
                  aparencia.ctaHover,
                  "focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-current/40",
                  "disabled:cursor-not-allowed disabled:opacity-60",
                )}
              >
                {copiado ? (
                  <>
                    <ClipboardCopy className="h-4 w-4" aria-hidden="true" />
                    Preço-alvo definido + copiado!
                  </>
                ) : (
                  <>
                    <Target className="h-4 w-4" aria-hidden="true" />
                    {salvandoAlvo
                      ? "Salvando…"
                      : `Definir preço-alvo ${formatBRL(estrategiaSelecionada.valor)}`}
                  </>
                )}
              </button>
            )}
            <MarcarButton
              pendente={pendente}
              carregando={carregandoMarca}
              salvando={salvando}
              desabilitado={diagnostico.status === "sem_dados" || diagnostico.precoEsperado <= 0}
              onMarcar={handleMarcar}
              onDesmarcar={handleDesmarcar}
              veiculoLabel={`${veiculo.marca ?? ""} ${veiculo.modelo}`.trim()}
            />
          </div>

          {/* Indicador de preço-alvo ativo */}
          {!carregandoAlvo && precoAlvoAtivo && (
            <PrecoAlvoIndicador
              row={precoAlvoAtivo}
              onRevogar={handleRevogarPrecoAlvo}
              salvando={salvandoAlvo}
            />
          )}

          {/* Linha de fechamento — sempre visível, contextual */}
          {fechamento && (
            <p className="rounded-lg bg-[var(--bg-surface)]/60 px-3 py-2 text-xs">{fechamento}</p>
          )}

          {/* ─── VER DETALHES ─── */}
          <DetailsAccordion label="Ver detalhes" summary={accordionSummary}>
            {/* Cálculo */}
            {diagnostico.precoEsperado > 0 && (
              <section>
                <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider opacity-70">
                  Cálculo
                </h4>
                {tituloContexto && (
                  <p className="mb-1 text-xs font-medium">{tituloContexto}</p>
                )}
                <BreakdownAjustes
                  diagnostico={diagnostico}
                  medianaKm={medianaKm}
                  veiculo={veiculo}
                  sugestao={sugestao}
                />
              </section>
            )}

            {/* Avisos */}
            {totalAvisos > 0 && (
              <section>
                <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider opacity-70">
                  Avisos
                </h4>
                {chips.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1">
                    {chips.map((c, i) => (
                      <ConfidenceChip
                        key={`detail-${c.type}-${i}`}
                        type={c.type}
                        diasPatio={c.diasPatio}
                      />
                    ))}
                  </div>
                )}
                {avisosOperacionais.length > 0 && (
                  <ul className="space-y-1 text-xs">
                    {avisosOperacionais.map((a, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-amber-900">
                        <AlertTriangle
                          className="mt-0.5 h-3 w-3 shrink-0 text-amber-600"
                          aria-hidden="true"
                        />
                        <span>{a}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {/* FIPE & matching */}
            <FipeSecao
              fipeBatchPreco={fipeBatchPreco}
              modeloNbs={veiculo.modelo}
              onAbrirDrawer={() => setDrawerOpen(true)}
            />

            {/* Comparáveis */}
            {sugestao.comparaveis.length > 0 && (
              <ComparaveisSecao sugestao={sugestao} />
            )}
          </DetailsAccordion>
        </div>
      </section>

      <FipeReviewDrawer
        veiculo={veiculo}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </>
  );
}


