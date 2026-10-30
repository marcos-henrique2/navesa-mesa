"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, CalendarX2, ChevronLeft, ChevronRight, FileSpreadsheet, Loader2, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/AppShell";
import { showSuccessToast, showErrorToast } from "@/components/ui/Toast";
import { Tooltip } from "@/components/ui/Tooltip";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { SyncIndicator } from "@/components/vendas-matriz/SyncIndicator";
import { BlocoKpis } from "@/components/vendas-matriz/BlocoKpis";
import { BlocoOrigem } from "@/components/vendas-matriz/BlocoOrigem";
import { BlocoCompradores } from "@/components/vendas-matriz/BlocoCompradores";
import { BlocoReconciliacao } from "@/components/vendas-matriz/BlocoReconciliacao";
import {
  mesAnoCurto,
  mesCurto,
  nomeMesAno,
  nomeMesAnoCapitalizado,
  type ContextoComparacao,
} from "@/components/vendas-matriz/formato";
import { baixarVendasMatrizWorkbook } from "@/lib/export/vendas-matriz/gerar-workbook";
import { nomeMesExtenso } from "@/lib/export/vendas-matriz/tipos";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  carregarBaseVendasMatriz,
  coletarPainelMatriz,
  type BaseVendasMatriz,
} from "@/lib/export/vendas-matriz/coletar-dados";
import { resumirPainelMatriz, type PainelMatriz } from "@/lib/export/vendas-matriz/resumir-painel";
import { hojeLocal } from "@/lib/utils/data-local";
import { cn } from "@/lib/utils";

// Loja "dona" do relatório. Fixo por enquanto (só existe seletor de mês na tela), mas
// nunca hardcoded dentro da lógica de coleta/geração — sempre passado como parâmetro.
const COD_EMPRESA_MATRIZ = 2; // Ford Aeroporto

/** A base (vendas do grupo + custos + FIPE) é reaproveitada entre trocas de mês por até 5 min. */
const VALIDADE_BASE_MS = 5 * 60 * 1000;

function parseMesAno(v: string): { mes: number; ano: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(v);
  if (!m) return null;
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12) return null;
  return { mes, ano: Number(m[1]) };
}

function paraMesAno(mes: number, ano: number): string {
  return `${ano}-${String(mes).padStart(2, "0")}`;
}

function deslocarMes(v: string, delta: 1 | -1): string {
  const p = parseMesAno(v);
  if (!p) return v;
  const idx = p.ano * 12 + (p.mes - 1) + delta;
  return paraMesAno((idx % 12) + 1, Math.floor(idx / 12));
}

function contextoDe(p: PainelMatriz): ContextoComparacao {
  const { mes, ano } = p.corte.mesAnterior;
  return {
    rotuloBase: p.corte.parcial ? `1–${p.corte.diaFimAnterior} ${mesCurto(mes, ano)}` : mesAnoCurto(mes, ano),
    semBaseMes: p.anterior.total.qtd === 0,
    nomeMesAnterior: nomeMesAno(mes, ano),
    recorteAnterior: p.corte.parcial ? `1–${p.corte.diaFimAnterior} ${mesCurto(mes, ano)}` : nomeMesAno(mes, ano),
  };
}

/** Base em cache: `em` = instante em que a carga terminou (`null` enquanto a promise está em andamento). */
type CacheBase = { promise: Promise<BaseVendasMatriz>; em: number | null; tentativa: number };

function baseExpirada(c: CacheBase | null, tentativa: number): boolean {
  if (c == null || c.tentativa !== tentativa) return true;
  return c.em != null && Date.now() - c.em >= VALIDADE_BASE_MS;
}

/**
 * Devolve a base válida (ou a carga já em andamento — nunca duas cargas paralelas) ou
 * dispara uma nova. `aoCarregar` recebe o instante da carga concluída.
 */
function obterBase(ref: { current: CacheBase | null }, tentativa: number, aoCarregar: (em: number) => void): Promise<BaseVendasMatriz> {
  const c = ref.current;
  if (c && !baseExpirada(c, tentativa)) return c.promise;
  const promise = carregarBaseVendasMatriz();
  const entrada: CacheBase = { promise, em: null, tentativa };
  ref.current = entrada;
  promise.then(
    () => {
      entrada.em = Date.now();
      aoCarregar(entrada.em);
    },
    () => {
      if (ref.current === entrada) ref.current = null;
    },
  );
  return promise;
}

async function montarPainel(base: BaseVendasMatriz, mes: number, ano: number): Promise<PainelMatriz> {
  const input = { codEmpresa: COD_EMPRESA_MATRIZ, mes, ano };
  const { linhasMes, linhasMesAnterior } = await coletarPainelMatriz(base, input);
  return resumirPainelMatriz({ ...input, linhasMes, linhasMesAnterior, hoje: hojeLocal() });
}

type Resultado = { chave: string; painel: PainelMatriz } | { chave: string; erro: string };

export default function VendasUsadosMatrizPage() {
  const mesMax = hojeLocal().slice(0, 7);
  const [mesAno, setMesAno] = useState<string>(mesMax); // "YYYY-MM"
  const [tentativa, setTentativa] = useState(0);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [ultimoPainel, setUltimoPainel] = useState<PainelMatriz | null>(null);
  const [gerando, setGerando] = useState(false);
  /** Incrementa quando a base expira (aba volta ao foco) → recarrega base + painel. */
  const [recarga, setRecarga] = useState(0);
  const [baseCarregadaEm, setBaseCarregadaEm] = useState<number | null>(null);
  const baseRef = useRef<CacheBase | null>(null);

  const chave = `${mesAno}#${tentativa}#${recarga}`;
  const sel = parseMesAno(mesAno);

  useEffect(() => {
    const alvo = parseMesAno(mesAno);
    if (!alvo) return;
    let vivo = true;
    const chaveAtual = `${mesAno}#${tentativa}#${recarga}`;
    (async () => {
      try {
        const base = await obterBase(baseRef, tentativa, setBaseCarregadaEm);
        const painel = await montarPainel(base, alvo.mes, alvo.ano);
        if (!vivo) return;
        setResultado({ chave: chaveAtual, painel });
        setUltimoPainel(painel);
      } catch (err) {
        if (!vivo) return;
        setResultado({ chave: chaveAtual, erro: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => {
      vivo = false;
    };
  }, [mesAno, tentativa, recarga]);

  // Voltou pra aba depois de >5 min: recarrega (dado velho nunca fica na tela sem aviso).
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible" && baseRef.current?.em != null && baseExpirada(baseRef.current, tentativa)) {
        setRecarga((r) => r + 1);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [tentativa]);

  const atualizado = resultado?.chave === chave ? resultado : null;
  const carregando = atualizado == null;
  const painelExibido = atualizado && "painel" in atualizado ? atualizado.painel : carregando ? ultimoPainel : null;
  const vazio = atualizado != null && "painel" in atualizado && atualizado.painel.atual.total.qtd === 0;

  const selecionarMes = (v: string) => {
    if (!parseMesAno(v) || v > mesMax) return;
    setMesAno(v);
  };

  const handleGerar = async () => {
    if (gerando || !sel) return;
    setGerando(true);
    try {
      // Base expirada: recarrega a base e gera o Excel dela; o painel é redesenhado pelo
      // effect (setRecarga), que pega a MESMA base nova do cache. Não gravamos resultado
      // aqui de propósito: se o usuário trocar de mês durante a carga, uma chave capturada
      // no clique sobrescreveria o mês novo (spinner eterno + painel do mês errado).
      const expirada = baseExpirada(baseRef.current, tentativa);
      const base = await obterBase(baseRef, tentativa, setBaseCarregadaEm);
      if (expirada) setRecarga((r) => r + 1);
      await baixarVendasMatrizWorkbook({ codEmpresa: COD_EMPRESA_MATRIZ, mes: sel.mes, ano: sel.ano }, base);
      showSuccessToast(`Relatório de ${nomeMesExtenso(sel.mes)}/${sel.ano} gerado.`);
    } catch (err) {
      showErrorToast(`Erro ao gerar relatório: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setGerando(false);
    }
  };

  const nomeSel = sel ? nomeMesAno(sel.mes, sel.ano) : "";
  const tooltipExcel = vazio
    ? "Sem vendas no mês para gerar o relatório"
    : sel
      ? `Baixa o relatório completo de ${nomeMesAnoCapitalizado(sel.mes, sel.ano)} com todas as abas e fórmulas — para a contabilidade.`
      : "";

  const botaoChevron =
    "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] text-[var(--text-body)] transition hover:bg-[var(--bg-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-700)] disabled:cursor-not-allowed disabled:opacity-40";

  const acoes = (
    <div className="flex flex-wrap items-center gap-2">
      {carregando && ultimoPainel && (
        <Loader2 className="h-4 w-4 animate-spin text-[var(--text-muted)]" aria-label="Carregando mês selecionado" />
      )}
      <button type="button" className={botaoChevron} aria-label="Mês anterior" onClick={() => selecionarMes(deslocarMes(mesAno, -1))}>
        <ChevronLeft className="h-4 w-4" />
      </button>
      <input
        type="month"
        value={mesAno}
        max={mesMax}
        aria-label="Mês de referência"
        onChange={(e) => selecionarMes(e.target.value)}
        className="h-9 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] px-3 text-sm text-[var(--text-strong)] focus:border-[var(--brand-700)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-700)]"
      />
      <button
        type="button"
        className={botaoChevron}
        aria-label="Próximo mês"
        disabled={mesAno >= mesMax}
        onClick={() => selecionarMes(deslocarMes(mesAno, 1))}
      >
        <ChevronRight className="h-4 w-4" />
      </button>
      {/* Um só ponto de foco: o Tooltip não vira botão em volta do botão; o texto vai em aria-describedby. */}
      <Tooltip content={tooltipExcel} side="bottom" focavel={false}>
        <button
          type="button"
          onClick={handleGerar}
          disabled={gerando || vazio}
          aria-label={gerando ? "Gerando relatório Excel (.xlsx)…" : "Baixar relatório Excel (.xlsx)"}
          aria-describedby="descricao-botao-excel"
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] px-3 text-sm font-medium text-[var(--text-body)] transition hover:bg-[var(--bg-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-700)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {gerando ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
          <span className="hidden sm:inline">{gerando ? "Gerando…" : "Excel (.xlsx)"}</span>
        </button>
      </Tooltip>
      <span id="descricao-botao-excel" className="sr-only">
        {tooltipExcel}
      </span>
    </div>
  );

  return (
    <>
      <PageHeader title="Vendas usados matriz" subtitle="Ford Aeroporto · vendas de usados do mês, margens e canais" action={acoes} />

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {/* Barra de contexto */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-[var(--text-strong)]">
              {painelExibido ? nomeMesAnoCapitalizado(painelExibido.mes, painelExibido.ano) : sel ? nomeMesAnoCapitalizado(sel.mes, sel.ano) : ""}
            </h2>
            {painelExibido?.corte.parcial && painelExibido.corte.diaHoje != null && (
              <span className="rounded-full bg-[var(--bg-muted)] px-2 py-0.5 text-[11px] font-medium tabular-nums text-[var(--text-body)]">
                Parcial até {String(painelExibido.corte.diaHoje).padStart(2, "0")}/{String(painelExibido.mes).padStart(2, "0")}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {baseCarregadaEm != null && (
              <span className="text-[11px] tabular-nums text-[var(--text-subtle)]">
                dados carregados às {format(baseCarregadaEm, "HH:mm", { locale: ptBR })}
              </span>
            )}
            {/* Consulta o sync_log no mount, a cada carga de base e a cada "Tentar de novo" — inclusive se a base falhar. */}
            <SyncIndicator recarga={`${tentativa}:${baseCarregadaEm ?? ""}`} />
          </div>
        </div>

        {atualizado && "erro" in atualizado ? (
          <ErroCarregamento nomeMes={nomeSel} mensagem={atualizado.erro} onRetry={() => setTentativa((t) => t + 1)} />
        ) : painelExibido == null ? (
          <CarregandoPainel nomeMes={nomeSel} />
        ) : painelExibido.atual.total.qtd === 0 ? (
          <div aria-busy={carregando} className={cn("transition-opacity", carregando && "opacity-60")}>
            <EstadoVazio
              nomeMes={nomeMesAno(painelExibido.mes, painelExibido.ano)}
              nomeMesAnterior={nomeMesAno(painelExibido.corte.mesAnterior.mes, painelExibido.corte.mesAnterior.ano)}
              onVerAnterior={() => selecionarMes(paraMesAno(painelExibido.corte.mesAnterior.mes, painelExibido.corte.mesAnterior.ano))}
            />
          </div>
        ) : (
          <div aria-busy={carregando} className={cn("space-y-6 transition-opacity", carregando && "opacity-60")}>
            <ConteudoPainel painel={painelExibido} />
            {/* Fase 2 (ranking de vendedores, detalhe linha a linha) entra aqui como novas <section>. */}
          </div>
        )}
      </div>
    </>
  );
}

function ConteudoPainel({ painel }: { painel: PainelMatriz }) {
  const ctx = contextoDe(painel);
  const { atual, anterior } = painel;
  return (
    <>
      <BlocoKpis atual={atual.total} anterior={anterior.total} ctx={ctx} />
      <BlocoOrigem origem={atual.origem} total={atual.total} />
      <BlocoCompradores
        pf={atual.pf}
        pj={atual.pj}
        pfAnterior={anterior.pf}
        pjAnterior={anterior.pj}
        totalMes={atual.total.qtd}
        ctx={ctx}
      />
      <BlocoReconciliacao resumo={atual} />
    </>
  );
}

function CarregandoPainel({ nomeMes }: { nomeMes: string }) {
  return (
    <div aria-busy="true" className="space-y-4">
      <p className="inline-flex items-center gap-2 text-sm text-[var(--text-muted)]" role="status">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        Carregando vendas de {nomeMes}…
      </p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <SkeletonCard key={i} delay={i * 80} />
        ))}
      </div>
      <SkeletonCard tall delay={320} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SkeletonCard tall delay={400} />
        <SkeletonCard tall delay={480} />
      </div>
    </div>
  );
}

function EstadoVazio({ nomeMes, nomeMesAnterior, onVerAnterior }: { nomeMes: string; nomeMesAnterior: string; onVerAnterior: () => void }) {
  return (
    <div className="mx-auto max-w-lg rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-8 text-center shadow-[var(--shadow-sm)]">
      <CalendarX2 className="mx-auto h-10 w-10 text-[var(--text-subtle)]" aria-hidden="true" />
      <h3 className="mt-3 text-base font-semibold text-[var(--text-strong)]">Nenhuma venda de usado em {nomeMes}</h3>
      <p className="mt-1 text-sm text-[var(--text-muted)]">Se você esperava ver vendas aqui, confira o horário da última atualização acima.</p>
      <button
        type="button"
        onClick={onVerAnterior}
        className="mt-5 inline-flex items-center gap-2 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] px-4 py-2 text-sm font-medium text-[var(--text-body)] transition hover:bg-[var(--bg-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-700)]"
      >
        Ver {nomeMesAnterior}
      </button>
    </div>
  );
}

/** Mesmo padrão visual do ErroDeCarregamento do DataGate. */
function ErroCarregamento({ nomeMes, mensagem, onRetry }: { nomeMes: string; mensagem: string; onRetry: () => void }) {
  return (
    <div className="mx-auto max-w-2xl" role="alert">
      <div className="rounded-2xl border-2 border-red-200 bg-red-50 p-8 text-center shadow-[var(--shadow-md)] dark:border-red-900 dark:bg-red-950/30">
        <div className="mx-auto mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
          <AlertCircle className="h-7 w-7" aria-hidden="true" />
        </div>
        <h3 className="text-xl font-bold text-red-900 dark:text-red-200">Não consegui carregar as vendas de {nomeMes}</h3>
        <details className="mx-auto mt-3 max-w-md text-left">
          <summary className="cursor-pointer text-xs text-red-700 hover:text-red-900 dark:text-red-300 dark:hover:text-red-100">Detalhes técnicos</summary>
          <p className="mt-2 rounded-md bg-[var(--bg-surface)]/70 p-2 font-mono text-[11px] text-[var(--text-body)]">{mensagem}</p>
        </details>
        <button
          type="button"
          onClick={onRetry}
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-red-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> Tentar de novo
        </button>
      </div>
    </div>
  );
}
