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
import { AlertTriangle, ClipboardCopy } from "lucide-react";
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
import { formatBRL, cn } from "@/lib/utils";
import { usePrecificacao } from "./usePrecificacao";
import { ConfidenceChip, type ConfidenceChipType } from "./ConfidenceChip";
import { StrategySelector, type EstrategiaId, type EstrategiaItem } from "./StrategySelector";
import { DetailsAccordion } from "./DetailsAccordion";
import { FipeReviewDrawer } from "./FipeReviewDrawer";
import { BreakdownAjustes, FipeSecao, ComparaveisSecao } from "./PrecificacaoDetails";
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

  // ─ Toast/feedback de copia ─
  const [copiado, setCopiado] = useState(false);
  async function handleCopiar() {
    const valor = estrategiaSelecionada.valor;
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(String(valor));
      } else {
        // fallback bem simples
        const ta = document.createElement("textarea");
        ta.value = String(valor);
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1800);
    } catch (err) {
      console.warn("Falha ao copiar:", err);
      alert(`Valor: R$ ${valor.toLocaleString("pt-BR")}`);
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
            />
          )}

          {/* CTAs */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {diagnostico.status !== "sem_dados" && (
              <button
                type="button"
                onClick={handleCopiar}
                aria-label={`Copiar valor ${formatBRL(estrategiaSelecionada.valor)} pra área de transferência`}
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition",
                  aparencia.ctaBg,
                  aparencia.ctaText,
                  aparencia.ctaHover,
                  "focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-current/40",
                )}
              >
                <ClipboardCopy className="h-4 w-4" aria-hidden="true" />
                {copiado ? "Copiado!" : `Copiar ${formatBRL(estrategiaSelecionada.valor)}`}
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

          {/* Linha de fechamento — sempre visível, contextual */}
          {fechamento && (
            <p className="rounded-lg bg-white/60 px-3 py-2 text-xs">{fechamento}</p>
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

// ═════════════════════════════════════════════════════════════════════════════
// SUBCOMPONENTES
// ═════════════════════════════════════════════════════════════════════════════

function Numero({
  label,
  valor,
  destaque,
}: {
  label: string;
  valor: string;
  destaque: boolean;
}) {
  return (
    <div className="rounded-lg bg-white/70 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider opacity-70">{label}</p>
      <p className={cn("tabular-nums", destaque ? "text-xl font-bold" : "text-base font-semibold")}>
        {valor}
      </p>
    </div>
  );
}

function DiferencaCard({ diagnostico }: { diagnostico: DiagnosticoResult }) {
  if (diagnostico.precoAtual == null || diagnostico.precoEsperado <= 0) {
    return <Numero label="Diferença" valor="—" destaque={false} />;
  }
  const pct = diagnostico.desvioPct * 100;
  const reais = diagnostico.desvioReais;
  const negativo = reais < 0;
  const positivo = reais > 0;
  const toneClasse = negativo
    ? "text-red-700"
    : positivo
      ? "text-emerald-700"
      : "text-slate-600";
  const icone = negativo ? "⚠" : positivo ? "↑" : "=";
  return (
    <div className="rounded-lg bg-white/70 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider opacity-70">Diferença</p>
      <p className={cn("text-xl font-bold tabular-nums", toneClasse)}>
        {pct >= 0 ? "+" : ""}
        {pct.toFixed(1)}% <span className="text-base" aria-hidden="true">{icone}</span>
      </p>
      <p className={cn("text-[11px] tabular-nums", toneClasse)}>
        {reais >= 0 ? "+" : ""}
        {formatBRL(reais)}
      </p>
    </div>
  );
}

function MarcarButton({
  pendente,
  carregando,
  salvando,
  desabilitado,
  onMarcar,
  onDesmarcar,
  veiculoLabel,
}: {
  pendente: ReprecificacaoRow | null;
  carregando: boolean;
  salvando: boolean;
  desabilitado: boolean;
  onMarcar: () => void;
  onDesmarcar: () => void;
  veiculoLabel: string;
}) {
  if (carregando) {
    return <span className="text-xs text-current/60">Carregando status…</span>;
  }
  if (pendente) {
    const quando = new Date(pendente.criado_em).toLocaleDateString("pt-BR");
    return (
      <div className="inline-flex items-center gap-2 text-xs">
        <span className="rounded-full bg-white/80 px-3 py-1 font-medium">
          ✓ Marcado em {quando}
        </span>
        <button
          type="button"
          onClick={onDesmarcar}
          disabled={salvando}
          className="text-current underline hover:opacity-80 disabled:opacity-50"
          aria-label={`Desfazer marcação de reprecificação${veiculoLabel ? ` de ${veiculoLabel}` : ""}`}
        >
          Desfazer
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onMarcar}
      disabled={salvando || desabilitado}
      className={cn(
        "inline-flex items-center gap-2 rounded-lg border border-current/30 bg-white/70 px-3 py-2 text-xs font-medium",
        "hover:bg-white disabled:cursor-not-allowed disabled:opacity-50",
      )}
      aria-label={`Marcar ${veiculoLabel || "veículo"} pra reprecificar`}
      title={desabilitado ? "Sem preço esperado — não dá pra marcar reprecificação" : undefined}
    >
      {salvando ? "Salvando…" : "Marcar pra reprecificar"}
    </button>
  );
}

