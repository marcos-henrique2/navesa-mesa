"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { AlertCircle, ChevronLeft, ChevronRight, FileSpreadsheet, Loader2, RefreshCw } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { PageHeader } from "@/components/AppShell";
import { showErrorToast, showInfoToast, showSuccessToast } from "@/components/ui/Toast";
import { Tooltip } from "@/components/ui/Tooltip";
import { SkeletonBar, SkeletonCard } from "@/components/ui/Skeleton";
import { Tabs, type TabItem } from "@/components/ui/Tabs";
import { SyncIndicator } from "@/components/vendas-matriz/SyncIndicator";
import { BlocoKpis } from "@/components/vendas-matriz/BlocoKpis";
import { BlocoOrigem } from "@/components/vendas-matriz/BlocoOrigem";
import { BlocoCompradores } from "@/components/vendas-matriz/BlocoCompradores";
import { BlocoReconciliacao } from "@/components/vendas-matriz/BlocoReconciliacao";
import { AbaVendas } from "@/components/vendas-matriz/AbaVendas";
import { PlayPlanReferencia } from "@/components/vendas-matriz/PlayPlanReferencia";
import { EstadoVazioMes, type AoFiltrarVendas } from "@/components/vendas-matriz/comum";
import type { EstadoAno } from "@/components/vendas-matriz/AbaVendedores";
import { mesAnoCurto, mesCurto, nomeMesAno, nomeMesAnoCapitalizado, type ContextoComparacao } from "@/components/vendas-matriz/formato";
import { baixarVendasMatrizWorkbook } from "@/lib/export/vendas-matriz/gerar-workbook";
import { nomeMesExtenso, type LinhaVendaMatriz } from "@/lib/export/vendas-matriz/tipos";
import {
  carregarBaseVendasMatriz,
  coletarPainelMatriz,
  montarLinhasAno,
  type BaseVendasMatriz,
} from "@/lib/export/vendas-matriz/coletar-dados";
import { resumirPainelMatriz, type PainelMatriz } from "@/lib/export/vendas-matriz/resumir-painel";
import {
  FILTROS_VAZIOS,
  escreverEstadoUrl,
  lerEstadoUrl,
  type AbaPainel,
  type EstadoUrlPainel,
  type FiltrosVendas,
} from "@/lib/export/vendas-matriz/filtrar-vendas";
import { hojeLocal } from "@/lib/utils/data-local";
import { cn, formatInt } from "@/lib/utils";

// Recharts só carrega quando a aba que usa gráfico é aberta.
function SkeletonAba({ cards = 2 }: { cards?: number }) {
  return (
    <div aria-busy="true" className="space-y-4">
      {Array.from({ length: cards }, (_, i) => (
        <div key={i} className="h-72 rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-5">
          <SkeletonBar w="30%" delay={i * 80} />
          <div className="mt-4">
            <SkeletonBar h="h-52" delay={i * 80 + 60} />
          </div>
        </div>
      ))}
    </div>
  );
}
const AbaEvolucao = dynamic(() => import("@/components/vendas-matriz/AbaEvolucao").then((m) => m.AbaEvolucao), {
  ssr: false,
  loading: () => <SkeletonAba />,
});
const AbaVendedores = dynamic(() => import("@/components/vendas-matriz/AbaVendedores").then((m) => m.AbaVendedores), {
  ssr: false,
  loading: () => <SkeletonAba />,
});
const AbaMargens = dynamic(() => import("@/components/vendas-matriz/AbaMargens").then((m) => m.AbaMargens), {
  ssr: false,
  loading: () => <SkeletonAba />,
});

// Loja "dona" do relatório. Fixo por enquanto (só existe seletor de mês na tela), mas
// nunca hardcoded dentro da lógica de coleta/geração — sempre passado como parâmetro.
const COD_EMPRESA_MATRIZ = 2; // Ford Aeroporto

/** A base (vendas do grupo + custos + FIPE) é reaproveitada entre trocas de mês por até 5 min. */
const VALIDADE_BASE_MS = 5 * 60 * 1000;

const ID_TABS = "painel-matriz";

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

/**
 * Linhas do ano por base: a MESMA política de validade da base (5 min) — quando a base é
 * recarregada vira outro objeto e as linhas do ano são remontadas a partir dela. Uma
 * promise por (base, ano): nunca duas buscas de origem paralelas pro mesmo ano.
 */
type CacheAno = WeakMap<BaseVendasMatriz, Map<number, Promise<LinhaVendaMatriz[]>>>;

function obterLinhasAno(cache: CacheAno, base: BaseVendasMatriz, ano: number): Promise<LinhaVendaMatriz[]> {
  let porAno = cache.get(base);
  if (!porAno) {
    porAno = new Map();
    cache.set(base, porAno);
  }
  const existente = porAno.get(ano);
  if (existente) return existente;
  const anos = porAno;
  // Até dezembro: meses futuros não têm venda; uma busca serve qualquer mês selecionado do ano.
  const promise = montarLinhasAno(base, COD_EMPRESA_MATRIZ, ano, 12);
  anos.set(ano, promise);
  promise.catch(() => {
    if (anos.get(ano) === promise) anos.delete(ano);
  });
  return promise;
}

type DadosMes = { painel: PainelMatriz; linhasMes: LinhaVendaMatriz[]; linhasMesAnterior: LinhaVendaMatriz[] };

async function montarDadosMes(base: BaseVendasMatriz, mes: number, ano: number): Promise<DadosMes> {
  const input = { codEmpresa: COD_EMPRESA_MATRIZ, mes, ano };
  const { linhasMes, linhasMesAnterior } = await coletarPainelMatriz(base, input);
  return { painel: resumirPainelMatriz({ ...input, linhasMes, linhasMesAnterior, hoje: hojeLocal() }), linhasMes, linhasMesAnterior };
}

type Resultado = { chave: string; dados: DadosMes } | { chave: string; erro: string };
type ResultadoAno = { chave: string; estado: EstadoAno };

const ROTULOS_ABA: Record<AbaPainel, string> = {
  resumo: "Resumo",
  evolucao: "Evolução",
  vendedores: "Vendedores",
  margens: "Margens",
  vendas: "Vendas",
  playplan: "Play Plan",
};

export function PainelVendasMatriz() {
  const mesMax = hojeLocal().slice(0, 7);
  const searchParams = useSearchParams();
  const estadoUrl = useMemo(() => lerEstadoUrl(new URLSearchParams(searchParams.toString())), [searchParams]);
  const mesAno = estadoUrl.mes != null && estadoUrl.mes <= mesMax ? estadoUrl.mes : mesMax; // "YYYY-MM"
  const aba = estadoUrl.aba;
  const filtros = estadoUrl.filtros;

  const [tentativa, setTentativa] = useState(0);
  const [tentativaAno, setTentativaAno] = useState(0);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [ultimo, setUltimo] = useState<DadosMes | null>(null);
  const [resultadoAno, setResultadoAno] = useState<ResultadoAno | null>(null);
  const [gerando, setGerando] = useState(false);
  /** Incrementa quando a base expira (aba volta ao foco) → recarrega base + painel. */
  const [recarga, setRecarga] = useState(0);
  const [baseCarregadaEm, setBaseCarregadaEm] = useState<number | null>(null);
  const [focoVendas, setFocoVendas] = useState(0);
  const [painelFocavel, setPainelFocavel] = useState(false);
  const baseRef = useRef<CacheBase | null>(null);
  const cacheAnoRef = useRef<CacheAno>(new WeakMap());

  const chave = `${mesAno}#${tentativa}#${recarga}`;
  const sel = parseMesAno(mesAno);
  const precisaAno = aba === "evolucao" || aba === "vendedores";
  const chaveAno = sel ? `${sel.ano}#${tentativa}#${tentativaAno}#${recarga}` : "";

  // ─── URL = fonte única de mês, aba e filtros (replace pra ajuste, push pra cross-filter) ───
  const navegar = useCallback(
    (novo: Partial<EstadoUrlPainel>, modo: "push" | "replace") => {
      const prox: EstadoUrlPainel = { mes: mesAno === mesMax ? null : mesAno, aba, filtros, ...novo };
      // Cross-filter (push) grava SEMPRE o mês: o link "PJ de outubro" não pode abrir novembro.
      // Ajustes (replace) omitem o mês corrente pra a URL "sem mês" continuar = mês corrente.
      if (modo === "push") prox.mes = prox.mes ?? mesAno;
      else if (prox.mes === mesMax) prox.mes = null;
      const url = `${window.location.pathname}${escreverEstadoUrl(prox)}`;
      if (modo === "push") window.history.pushState(null, "", url);
      else window.history.replaceState(null, "", url);
    },
    [mesAno, mesMax, aba, filtros],
  );

  useEffect(() => {
    const alvo = parseMesAno(mesAno);
    if (!alvo) return;
    let vivo = true;
    const chaveAtual = `${mesAno}#${tentativa}#${recarga}`;
    (async () => {
      try {
        const base = await obterBase(baseRef, tentativa, setBaseCarregadaEm);
        const dados = await montarDadosMes(base, alvo.mes, alvo.ano);
        if (!vivo) return;
        setResultado({ chave: chaveAtual, dados });
        setUltimo(dados);
      } catch (err) {
        if (!vivo) return;
        setResultado({ chave: chaveAtual, erro: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => {
      vivo = false;
    };
  }, [mesAno, tentativa, recarga]);

  // Linhas do ano (evolução mês a mês e médias de vendedor) — só quando uma aba precisa.
  const anoSel = sel?.ano ?? null;
  useEffect(() => {
    if (!precisaAno || anoSel == null) return;
    let vivo = true;
    const ano = anoSel;
    const chaveAtual = chaveAno;
    (async () => {
      try {
        const base = await obterBase(baseRef, tentativa, setBaseCarregadaEm);
        const linhasAno = await obterLinhasAno(cacheAnoRef.current, base, ano);
        if (vivo) setResultadoAno({ chave: chaveAtual, estado: { status: "ok", linhasAno } });
      } catch (err) {
        if (vivo) setResultadoAno({ chave: chaveAtual, estado: { status: "erro", mensagem: err instanceof Error ? err.message : String(err) } });
      }
    })();
    return () => {
      vivo = false;
    };
  }, [precisaAno, anoSel, chaveAno, tentativa]);

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
  const exibido = atualizado && "dados" in atualizado ? atualizado.dados : carregando ? ultimo : null;
  const painelExibido = exibido?.painel ?? null;
  const vazio = atualizado != null && "dados" in atualizado && atualizado.dados.painel.atual.total.qtd === 0;
  const estadoAno: EstadoAno = resultadoAno?.chave === chaveAno ? resultadoAno.estado : { status: "carregando" };

  const selecionarMes = useCallback(
    (v: string) => {
      if (!parseMesAno(v) || v > mesMax) return;
      // Trocar de mês mantém os filtros e limpa só o dia.
      navegar({ mes: v, filtros: { ...filtros, dia: null } }, "replace");
    },
    [mesMax, navegar, filtros],
  );

  const trocarAba = (id: AbaPainel, viaTeclado: boolean) => {
    setPainelFocavel(viaTeclado);
    // Voltar à aba Vendas pela tablist não deve rolar/focar a lista (isso é só do cross-filter).
    setFocoVendas(0);
    navegar({ aba: id }, "replace");
  };

  const onFiltrar: AoFiltrarVendas = useCallback(
    (f) => {
      navegar({ aba: "vendas", filtros: { ...FILTROS_VAZIOS, ...f } }, "push");
      setFocoVendas((n) => n + 1);
    },
    [navegar],
  );
  const onFiltrosVendas = useCallback((f: FiltrosVendas) => navegar({ filtros: f }, "replace"), [navegar]);

  const onSelecionarMesDoAno = (mes: number) => {
    if (!sel) return;
    const anterior = mesAno;
    const destino = paraMesAno(mes, sel.ano);
    selecionarMes(destino);
    const p = parseMesAno(anterior);
    showInfoToast(`Mostrando ${nomeMesAno(mes, sel.ano)}`, {
      duracaoMs: 7000,
      acao: p ? { label: `Voltar para ${nomeMesAno(p.mes, p.ano).split("/")[0]}`, onClick: () => selecionarMes(anterior) } : undefined,
    });
  };

  const handleGerar = async () => {
    if (gerando || !sel) return;
    setGerando(true);
    try {
      // Base expirada: recarrega a base e gera o Excel dela; o painel é redesenhado pelo
      // effect (setRecarga), que pega a MESMA base nova do cache.
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
      {carregando && ultimo && <Loader2 className="h-4 w-4 animate-spin text-[var(--text-muted)]" aria-label="Carregando mês selecionado" />}
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
      <button type="button" className={botaoChevron} aria-label="Próximo mês" disabled={mesAno >= mesMax} onClick={() => selecionarMes(deslocarMes(mesAno, 1))}>
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

  const itensAbas: TabItem<AbaPainel>[] = (Object.keys(ROTULOS_ABA) as AbaPainel[]).map((id) => ({
    id,
    rotulo: ROTULOS_ABA[id],
    // Contador da aba Vendas = total do mês (não o filtrado).
    contador: id === "vendas" && painelExibido ? formatInt(painelExibido.atual.total.qtd) : undefined,
  }));

  const erroMes = atualizado && "erro" in atualizado ? atualizado.erro : null;
  const vazioExibido = painelExibido != null && painelExibido.atual.total.qtd === 0;

  const conteudoAba = (): ReactNode => {
    if (aba === "playplan") return <PlayPlanReferencia />;
    if (erroMes != null) return <ErroCarregamento nomeMes={nomeSel} mensagem={erroMes} onRetry={() => setTentativa((t) => t + 1)} />;
    if (exibido == null || painelExibido == null) return <CarregandoPainel nomeMes={nomeSel} aba={aba} />;
    const { painel, linhasMes, linhasMesAnterior } = exibido;
    const vazioCard = (
      <EstadoVazioMes
        nomeMes={nomeMesAno(painel.mes, painel.ano)}
        nomeMesAnterior={nomeMesAno(painel.corte.mesAnterior.mes, painel.corte.mesAnterior.ano)}
        onVerAnterior={() => selecionarMes(paraMesAno(painel.corte.mesAnterior.mes, painel.corte.mesAnterior.ano))}
      />
    );
    if (aba === "evolucao") {
      return (
        <AbaEvolucao
          linhasMes={linhasMes}
          linhasMesAnterior={linhasMesAnterior}
          codEmpresa={COD_EMPRESA_MATRIZ}
          mes={painel.mes}
          ano={painel.ano}
          corte={painel.corte}
          atual={painel.atual.total}
          anterior={painel.anterior.total}
          hoje={hojeLocal()}
          estadoAno={estadoAno}
          onRetryAno={() => setTentativaAno((t) => t + 1)}
          onFiltrar={onFiltrar}
          onSelecionarMes={onSelecionarMesDoAno}
        />
      );
    }
    if (vazioExibido) return vazioCard;
    if (aba === "vendedores") {
      return (
        <AbaVendedores
          linhasMes={linhasMes}
          ano={painel.ano}
          mes={painel.mes}
          parcial={painel.corte.parcial}
          estadoAno={estadoAno}
          onRetryAno={() => setTentativaAno((t) => t + 1)}
          onFiltrar={onFiltrar}
        />
      );
    }
    if (aba === "margens") return <AbaMargens linhasMes={linhasMes} codEmpresa={COD_EMPRESA_MATRIZ} mes={painel.mes} ano={painel.ano} onFiltrar={onFiltrar} />;
    if (aba === "vendas") {
      return (
        <AbaVendas
          linhasMes={linhasMes}
          codEmpresa={COD_EMPRESA_MATRIZ}
          mes={painel.mes}
          ano={painel.ano}
          filtros={filtros}
          onFiltros={onFiltrosVendas}
          focoToken={focoVendas}
        />
      );
    }
    return <ConteudoResumo painel={painel} onFiltrar={onFiltrar} />;
  };

  return (
    <>
      <PageHeader title="Vendas usados matriz" subtitle="Ford Aeroporto · vendas de usados do mês, margens e canais" action={acoes} />

      <div className="mx-auto max-w-7xl space-y-4 px-4 py-6 sm:px-6">
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
              <span className="text-[11px] tabular-nums text-[var(--text-subtle)]">dados carregados às {format(baseCarregadaEm, "HH:mm", { locale: ptBR })}</span>
            )}
            {/* Consulta o sync_log no mount, a cada carga de base e a cada "Tentar de novo" — inclusive se a base falhar. */}
            <SyncIndicator recarga={`${tentativa}:${baseCarregadaEm ?? ""}`} />
          </div>
        </div>

        <div className="sticky top-0 z-30 -mx-4 border-b border-[var(--border-soft)] bg-[var(--bg-app)] px-4 sm:-mx-6 sm:px-6">
          <Tabs itens={itensAbas} ativa={aba} onChange={trocarAba} ariaLabel="Seções do painel" idBase={ID_TABS} />
        </div>

        <div
          role="tabpanel"
          id={`${ID_TABS}-painel-${aba}`}
          aria-labelledby={`${ID_TABS}-tab-${aba}`}
          tabIndex={painelFocavel ? 0 : undefined}
          aria-busy={carregando && aba !== "playplan"}
          className={cn("space-y-6 pt-2 transition-opacity focus:outline-none", carregando && exibido != null && aba !== "playplan" && "opacity-60")}
        >
          {conteudoAba()}
        </div>
      </div>
    </>
  );
}

function ConteudoResumo({ painel, onFiltrar }: { painel: PainelMatriz; onFiltrar: AoFiltrarVendas }) {
  const ctx = contextoDe(painel);
  const { atual, anterior } = painel;
  return (
    <>
      <BlocoKpis atual={atual.total} anterior={anterior.total} ctx={ctx} onFiltrar={onFiltrar} />
      <BlocoOrigem origem={atual.origem} total={atual.total} onFiltrar={onFiltrar} />
      <BlocoCompradores pf={atual.pf} pj={atual.pj} pfAnterior={anterior.pf} pjAnterior={anterior.pj} totalMes={atual.total.qtd} ctx={ctx} onFiltrar={onFiltrar} />
      <BlocoReconciliacao resumo={atual} onFiltrar={onFiltrar} />
    </>
  );
}

function CarregandoPainel({ nomeMes, aba }: { nomeMes: string; aba: AbaPainel }) {
  return (
    <div aria-busy="true" className="space-y-4">
      <p className="inline-flex items-center gap-2 text-sm text-[var(--text-muted)]" role="status">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        Carregando vendas de {nomeMes}…
      </p>
      {aba === "resumo" ? (
        <>
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
        </>
      ) : aba === "evolucao" ? (
        <SkeletonAba />
      ) : (
        <div className="space-y-2 rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-5">
          {Array.from({ length: aba === "margens" ? 14 : aba === "vendedores" ? 6 : 8 }, (_, i) => (
            <SkeletonBar key={i} h="h-5" delay={i * 40} />
          ))}
        </div>
      )}
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
