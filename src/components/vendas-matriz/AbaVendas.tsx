"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Filter, Search, X } from "lucide-react";
import {
  CHAVE_AUTO_AVALIAR,
  CHAVE_SEM_VENDEDOR,
  FILTROS_VAZIOS,
  ORDENACAO_PADRAO,
  chaveVendedor,
  contarFiltrosAtivos,
  contarPor,
  filtrarVendas,
  ordenarVendas,
  rotuloVendedor,
  totaisFiltro,
  type ChaveOrdenacao,
  type FiltroConsig,
  type FiltrosVendas,
  type Ordenacao,
} from "@/lib/export/vendas-matriz/filtrar-vendas";
import { classificarComprador, metricasDe, type CompradorChave } from "@/lib/export/vendas-matriz/resumir-painel";
import type { LinhaVendaMatriz, OrigemChave } from "@/lib/export/vendas-matriz/tipos";
import { SegmentedToggle } from "@/components/ui/SegmentedToggle";
import { Tooltip } from "@/components/ui/Tooltip";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { cn, formatBRL, formatInt } from "@/lib/utils";
import { CLASSE_NEGATIVO, fmtFrac } from "./comum";
import { nomeMesAno } from "./formato";
import { TabelaVendasMatriz, type PresetColunas } from "./TabelaVendasMatriz";

const CHAVE_PRESET = "vendas-matriz:preset-colunas";

const OPCOES_ORIGEM = [
  { valor: "todas", label: "Todas" },
  { valor: "proprio", label: "Próprio" },
  { valor: "outras", label: "Outras" },
  { valor: "naoIdentificada", label: "Não ident." },
] as const;
type OrigemOpcao = (typeof OPCOES_ORIGEM)[number]["valor"];

const OPCOES_CONSIG = [
  { valor: "todas", label: "Todas" },
  { valor: "sem", label: "Sem" },
  { valor: "so", label: "Só" },
] as const;

const COMPRADORES: { chave: CompradorChave; curto: string; longo: string }[] = [
  { chave: "pf", curto: "PF", longo: "Pessoa física" },
  { chave: "pj", curto: "PJ", longo: "Pessoa jurídica" },
  { chave: "autoAvaliar", curto: "AA", longo: "Auto Avaliar" },
  { chave: "naoInformado", curto: "NI", longo: "Não informado" },
];

const ROTULO_ORIGEM_CHIP: Record<OrigemChave, string> = {
  proprio: "Estoque próprio",
  outras: "Outras lojas",
  naoIdentificada: "Origem não identificada",
};

const OPCOES_ORDENACAO: { valor: string; label: string; ord: Ordenacao }[] = [
  { valor: "data-desc", label: "Data (mais recente)", ord: { chave: "data", dir: "desc" } },
  { valor: "data-asc", label: "Data (mais antiga)", ord: { chave: "data", dir: "asc" } },
  { valor: "venda-desc", label: "Maior venda", ord: { chave: "venda", dir: "desc" } },
  { valor: "margem-desc", label: "Maior margem", ord: { chave: "margem", dir: "desc" } },
  { valor: "margem-asc", label: "Menor margem", ord: { chave: "margem", dir: "asc" } },
  { valor: "pctMargem-asc", label: "Menor % margem", ord: { chave: "pctMargem", dir: "asc" } },
  { valor: "dias-desc", label: "Mais dias de estoque", ord: { chave: "dias", dir: "desc" } },
];

function lerPreset(): PresetColunas {
  if (typeof window === "undefined") return "resumo";
  const v = window.localStorage.getItem(CHAVE_PRESET);
  return v === "custos" || v === "completo" ? v : "resumo";
}

const classeCampo =
  "h-9 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] px-2 text-sm text-[var(--text-strong)] focus:border-[var(--brand-700)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-700)]";

export function AbaVendas({
  linhasMes,
  codEmpresa,
  mes,
  ano,
  filtros,
  onFiltros,
  focoToken,
}: {
  linhasMes: LinhaVendaMatriz[];
  codEmpresa: number;
  mes: number;
  ano: number;
  filtros: FiltrosVendas;
  /** Grava os filtros na URL (replace). */
  onFiltros: (f: FiltrosVendas) => void;
  /** Muda a cada cross-filter: rola até a lista e foca a linha "Mostrando…". */
  focoToken: number;
}) {
  const [ordenacao, setOrdenacao] = useState<Ordenacao>(ORDENACAO_PADRAO);
  const [preset, setPresetState] = useState<PresetColunas>(lerPreset);
  const [sheetAberto, setSheetAberto] = useState(false);
  const resumoRef = useRef<HTMLParagraphElement | null>(null);
  const topoRef = useRef<HTMLDivElement | null>(null);

  // Busca: digitação local com debounce de 150 ms; filtro externo (cross-filter) reescreve.
  const [q, setQ] = useState(filtros.q);
  const [qExterno, setQExterno] = useState(filtros.q);
  if (filtros.q !== qExterno) {
    setQExterno(filtros.q);
    setQ(filtros.q);
  }
  useEffect(() => {
    if (q === filtros.q) return;
    const t = setTimeout(() => onFiltros({ ...filtros, q }), 150);
    return () => clearTimeout(t);
  }, [q, filtros, onFiltros]);

  useEffect(() => {
    if (focoToken === 0) return;
    topoRef.current?.scrollIntoView({ block: "start" });
    resumoRef.current?.focus({ preventScroll: true });
  }, [focoToken]);

  const setPreset = (p: PresetColunas) => {
    setPresetState(p);
    window.localStorage.setItem(CHAVE_PRESET, p);
  };

  const filtradas = useMemo(() => filtrarVendas(linhasMes, filtros, codEmpresa), [linhasMes, filtros, codEmpresa]);
  const ordenadas = useMemo(() => ordenarVendas(filtradas, ordenacao, codEmpresa), [filtradas, ordenacao, codEmpresa]);
  const totais = useMemo(() => totaisFiltro(filtradas), [filtradas]);
  const m = useMemo(() => metricasDe(filtradas), [filtradas]);
  const porComprador = useMemo(() => contarPor(linhasMes, classificarComprador), [linhasMes]);
  const vendedores = useMemo(() => {
    const cont = contarPor(linhasMes, chaveVendedor);
    if (filtros.vendedor && !cont.has(filtros.vendedor)) cont.set(filtros.vendedor, 0);
    const especial = (k: string) => k === CHAVE_AUTO_AVALIAR || k === CHAVE_SEM_VENDEDOR;
    return [...cont.entries()].sort((a, b) => Number(especial(a[0])) - Number(especial(b[0])) || b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"));
  }, [linhasMes, filtros.vendedor]);

  const set = useCallback((over: Partial<FiltrosVendas>) => onFiltros({ ...filtros, ...over }), [filtros, onFiltros]);
  const limpar = () => {
    setQ("");
    onFiltros(FILTROS_VAZIOS);
  };
  const fecharSheet = useCallback(() => setSheetAberto(false), []);

  const onOrdenar = (chave: ChaveOrdenacao) =>
    setOrdenacao((o) => (o.chave === chave ? { chave, dir: o.dir === "asc" ? "desc" : "asc" } : { chave, dir: chave === "data" || chave === "venda" || chave === "margem" ? "desc" : "asc" }));

  const nAtivos = contarFiltrosAtivos(filtros);
  const nomeMes = nomeMesAno(mes, ano);
  const ddmm = (d: number) => `${String(d).padStart(2, "0")}/${String(mes).padStart(2, "0")}`;

  // ─── Chips de filtros ativos ───
  const chips: { chave: string; rotulo: string; remover: () => void }[] = [];
  if (filtros.origem) chips.push({ chave: "origem", rotulo: ROTULO_ORIGEM_CHIP[filtros.origem], remover: () => set({ origem: null }) });
  for (const c of filtros.comprador)
    chips.push({ chave: `c-${c}`, rotulo: COMPRADORES.find((x) => x.chave === c)?.longo ?? c, remover: () => set({ comprador: filtros.comprador.filter((x) => x !== c) }) });
  if (filtros.vendedor) chips.push({ chave: "vendedor", rotulo: rotuloVendedor(filtros.vendedor), remover: () => set({ vendedor: null }) });
  if (filtros.consig !== "todas")
    chips.push({ chave: "consig", rotulo: filtros.consig === "sem" ? "Sem consignadas" : "Só consignadas", remover: () => set({ consig: "todas" }) });
  if (filtros.neg) chips.push({ chave: "neg", rotulo: "Margem negativa", remover: () => set({ neg: false }) });
  if (filtros.dia != null) chips.push({ chave: "dia", rotulo: `Dia ${ddmm(filtros.dia)}`, remover: () => set({ dia: null }) });
  if (filtros.lojista)
    chips.push({
      chave: "lojista",
      rotulo: filtros.lojista === "sim" ? "Comprador recorrente (regra Excel)" : "Cliente final (regra Excel)",
      remover: () => set({ lojista: null }),
    });
  if (filtros.q.trim()) chips.push({ chave: "q", rotulo: `“${filtros.q.trim()}”`, remover: () => { setQ(""); set({ q: "" }); } });

  const linhaChips =
    chips.length > 0 ? (
      <div className="flex flex-wrap items-center gap-1.5" aria-label="Filtros ativos">
        <span className="text-xs text-[var(--text-muted)]">Filtros:</span>
        {chips.map((c) => (
          <button
            key={c.chave}
            type="button"
            onClick={c.remover}
            aria-label={`Remover filtro ${c.rotulo}`}
            className="inline-flex items-center gap-1 rounded-full border border-[var(--border-base)] bg-[var(--bg-surface)] px-2 py-0.5 text-xs text-[var(--text-body)] hover:bg-[var(--bg-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-700)]"
          >
            {c.rotulo} <X className="h-3 w-3" aria-hidden="true" />
          </button>
        ))}
      </div>
    ) : null;

  // ─── Controles (reusados na barra desktop e no bottom sheet) ───
  const controleOrigem = (
    <Tooltip content="Próprio = carros do estoque da própria Ford Aeroporto, igual à aba 'Só estoque' do Excel." focavel={false}>
      <SegmentedToggle<OrigemOpcao>
        opcoes={OPCOES_ORIGEM}
        valor={filtros.origem ?? "todas"}
        onChange={(v) => set({ origem: v === "todas" ? null : v })}
        ariaLabel="Origem do estoque"
      />
    </Tooltip>
  );
  const controleComprador = (
    <div role="group" aria-label="Comprador" className="inline-flex flex-wrap gap-1">
      {COMPRADORES.map((c) => {
        const ativo = filtros.comprador.includes(c.chave);
        const n = porComprador.get(c.chave) ?? 0;
        return (
          <button
            key={c.chave}
            type="button"
            aria-pressed={ativo}
            title={c.longo}
            onClick={() => set({ comprador: ativo ? filtros.comprador.filter((x) => x !== c.chave) : [...filtros.comprador, c.chave] })}
            className={cn(
              "h-9 rounded-lg border px-2.5 text-xs font-medium tabular-nums transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-700)]",
              ativo
                ? "border-[var(--brand-700)] bg-[var(--brand-50)] text-[var(--brand-800)] dark:bg-[var(--brand-900)]/40 dark:text-[var(--brand-100)]"
                : "border-[var(--border-soft)] bg-[var(--bg-surface)] text-[var(--text-body)] hover:bg-[var(--bg-muted)]",
            )}
          >
            <span aria-hidden="true">{c.curto}</span>
            <span className="sr-only">{c.longo}</span> {formatInt(n)}
          </button>
        );
      })}
    </div>
  );
  const controleVendedor = (
    <select aria-label="Vendedor" value={filtros.vendedor ?? ""} onChange={(e) => set({ vendedor: e.target.value || null })} className={cn(classeCampo, "max-w-[14rem]")}>
      <option value="">Todos os vendedores</option>
      {vendedores.map(([k, n]) => (
        <option key={k} value={k}>
          {rotuloVendedor(k)} ({formatInt(n)})
        </option>
      ))}
    </select>
  );
  const controleConsig = (
    <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
      Consignado
      <SegmentedToggle<FiltroConsig> opcoes={OPCOES_CONSIG} valor={filtros.consig} onChange={(v) => set({ consig: v })} ariaLabel="Consignado" />
    </span>
  );
  const controleNeg = (
    <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-[var(--text-body)]">
      <input type="checkbox" checked={filtros.neg} onChange={(e) => set({ neg: e.target.checked })} className="h-4 w-4 accent-[var(--brand-700)]" />
      Só margem negativa
    </label>
  );

  const resumoTexto = (
    <>
      Mostrando <strong>{formatInt(filtradas.length)}</strong> de <strong>{formatInt(linhasMes.length)}</strong> vendas
      {filtradas.length > 0 && (
        <>
          {" "}· Venda {formatBRL(m.receita)} · Margem <span className={cn((m.margem ?? 0) < 0 && CLASSE_NEGATIVO)}>{formatBRL(m.margem)}</span> (
          {fmtFrac(m.margemPct)})
          {m.qtdConsignadas > 0 && (
            <>
              {" "}· sem {formatInt(m.qtdConsignadas)} consignada{m.qtdConsignadas === 1 ? "" : "s"}
            </>
          )}
        </>
      )}
    </>
  );

  const tooltipRodape =
    totais.qtdConsignadas > 0
      ? `Sem as ${formatInt(totais.qtdConsignadas)} consignadas. No Excel, o rodapé da aba 1 soma também as consignadas: venda ${formatBRL(totais.excelComConsig.venda)}, margem ${formatBRL(totais.excelComConsig.margem)}.`
      : "Totais sem consignadas (não há consignadas neste filtro).";

  const botaoLimpar = nAtivos > 0 && (
    <Tooltip content="Os filtros mudam só esta lista, não os números do Resumo." focavel={false}>
      <button
        type="button"
        onClick={limpar}
        className="h-9 rounded-lg px-2 text-xs font-medium text-[var(--brand-700)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-700)] dark:text-[var(--brand-300)]"
      >
        Limpar
      </button>
    </Tooltip>
  );

  return (
    <div className="space-y-3">
      <div ref={topoRef} className="scroll-mt-16" />
      {/* Barra de filtros (sticky) */}
      <div className="sticky top-12 z-20 space-y-2 rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)]/95 p-3 shadow-[var(--shadow-sm)] backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-0 flex-1 basis-56">
            <span className="sr-only">Buscar venda</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-subtle)]" aria-hidden="true" />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Placa, modelo, cliente ou chassi" className={cn(classeCampo, "w-full pl-8")} />
          </label>
          <div className="hidden md:block">{controleOrigem}</div>
          <button
            type="button"
            onClick={() => setSheetAberto(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] px-3 text-sm font-medium text-[var(--text-body)] hover:bg-[var(--bg-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-700)] md:hidden"
          >
            <Filter className="h-4 w-4" aria-hidden="true" /> Filtros{nAtivos > 0 ? ` (${nAtivos})` : ""}
          </button>
        </div>
        <div className="hidden flex-wrap items-center gap-2 md:flex">
          {controleComprador}
          {controleVendedor}
          {controleConsig}
          {controleNeg}
          <select aria-label="Colunas" value={preset} onChange={(e) => setPreset(e.target.value as PresetColunas)} className={cn(classeCampo, "ml-auto")}>
            <option value="resumo">Colunas: Resumo</option>
            <option value="custos">Colunas: Custos</option>
            <option value="completo">Colunas: Completo (como no Excel)</option>
          </select>
          {botaoLimpar}
        </div>
        {linhaChips}
        <p ref={resumoRef} tabIndex={-1} aria-live="polite" className="text-xs tabular-nums text-[var(--text-body)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-700)]">
          {resumoTexto}
        </p>
      </div>

      {filtradas.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border-base)] bg-[var(--bg-surface)] p-8 text-center">
          <p className="text-sm font-medium text-[var(--text-strong)]">Nenhuma venda com esses filtros</p>
          {linhaChips && <div className="mt-3 flex justify-center">{linhaChips}</div>}
          <button
            type="button"
            onClick={limpar}
            className="mt-4 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] px-4 py-2 text-sm font-medium text-[var(--text-body)] hover:bg-[var(--bg-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-700)]"
          >
            Limpar filtros
          </button>
        </div>
      ) : (
        <TabelaVendasMatriz
          linhas={ordenadas}
          totais={totais}
          preset={preset}
          ordenacao={ordenacao}
          onOrdenar={onOrdenar}
          codEmpresa={codEmpresa}
          caption={`Vendas de ${nomeMes}, ${formatInt(filtradas.length)} filtradas`}
          tooltipRodape={tooltipRodape}
        />
      )}

      <BottomSheet
        aberto={sheetAberto}
        onFechar={fecharSheet}
        titulo="Filtros"
        rodape={
          <button
            type="button"
            onClick={fecharSheet}
            className="w-full rounded-lg bg-[var(--brand-700)] px-4 py-2.5 text-sm font-medium text-white hover:bg-[var(--brand-800)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-700)] focus-visible:ring-offset-2"
          >
            Ver {formatInt(filtradas.length)} venda{filtradas.length === 1 ? "" : "s"}
          </button>
        }
      >
        <CampoSheet rotulo="Origem">{controleOrigem}</CampoSheet>
        <CampoSheet rotulo="Comprador">{controleComprador}</CampoSheet>
        <CampoSheet rotulo="Vendedor">{controleVendedor}</CampoSheet>
        <CampoSheet rotulo="Consignado">
          <SegmentedToggle<FiltroConsig> opcoes={OPCOES_CONSIG} valor={filtros.consig} onChange={(v) => set({ consig: v })} ariaLabel="Consignado" />
        </CampoSheet>
        {controleNeg}
        <CampoSheet rotulo="Ordenar por">
          <select
            aria-label="Ordenar por"
            value={OPCOES_ORDENACAO.find((o) => o.ord.chave === ordenacao.chave && o.ord.dir === ordenacao.dir)?.valor ?? ""}
            onChange={(e) => {
              const o = OPCOES_ORDENACAO.find((x) => x.valor === e.target.value);
              if (o) setOrdenacao(o.ord);
            }}
            className={cn(classeCampo, "w-full")}
          >
            {OPCOES_ORDENACAO.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.label}
              </option>
            ))}
          </select>
        </CampoSheet>
        {nAtivos > 0 && (
          <button type="button" onClick={limpar} className="text-sm font-medium text-[var(--brand-700)] hover:underline dark:text-[var(--brand-300)]">
            Limpar filtros
          </button>
        )}
      </BottomSheet>
    </div>
  );
}

function CampoSheet({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{rotulo}</p>
      {children}
    </div>
  );
}
