"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown, Info, TrendingDown } from "lucide-react";
import type { MatrizMediaVendedor } from "@/lib/export/vendas-matriz/aba-media-vendedor";
import { CHAVE_AUTO_AVALIAR, CHAVE_SEM_VENDEDOR } from "@/lib/export/vendas-matriz/filtrar-vendas";
import { isNomeAutoAvaliar, type LinhaVendaMatriz } from "@/lib/export/vendas-matriz/tipos";
import {
  matrizDoMesSelecionado,
  ordenarRanking,
  rankingVendedores,
  valorMetrica,
  type LinhaRankingVendedor,
  type MetricaRanking,
} from "@/lib/export/vendas-matriz/vendedores-painel";
import { SegmentedToggle } from "@/components/ui/SegmentedToggle";
import { SkeletonBar } from "@/components/ui/Skeleton";
import { cn, formatBRL, formatInt } from "@/lib/utils";
import { InfoTooltip } from "./BlocoKpis";
import { CLASSE_NEGATIVO, Cartao, ErroNoCartao, LinkVerVendas, fmtFrac, type AoFiltrarVendas } from "./comum";
import { nomeMesAnoCapitalizado } from "./formato";
import { nomeCurto } from "./TabelaVendasMatriz";

export type EstadoAno = { status: "carregando" } | { status: "erro"; mensagem: string } | { status: "ok"; linhasAno: LinhaVendaMatriz[] };

const OPCOES_METRICA = [
  { valor: "vendas", label: "Vendas" },
  { valor: "margem", label: "Margem R$" },
  { valor: "margemPct", label: "Margem %" },
  { valor: "ticket", label: "Ticket" },
] as const;

const TOOLTIP_NAO_EXCEL =
  "Margem, % e ticket por vendedor não existem no Excel; são calculados aqui com as mesmas regras da aba Margens. Sem consignadas.";

const NOMES_MESES_ABREV = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const NF2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Médias e delta com 2 casas, igual ao FMT_DECIMAL2 da aba 8; sinal "−" tipográfico. */
function fmt2(v: number | null): string {
  if (v == null) return "—";
  return `${v < 0 ? "−" : ""}${NF2.format(Math.abs(v))}`;
}

function textoMetrica(v: LinhaRankingVendedor, m: MetricaRanking): string {
  if (m === "vendas") return formatInt(v.metricas.qtd);
  if (m === "margemPct") return fmtFrac(v.metricas.margemPct);
  return formatBRL(m === "margem" ? v.metricas.margem : v.metricas.ticket);
}

type ColTabela = "nome" | "vendas" | "pct" | "margem" | "margemPct" | "ticket" | "consig" | "media3" | "mediaAnt" | "delta";

function valorTabela(v: LinhaRankingVendedor, c: ColTabela): number | string | null {
  switch (c) {
    case "nome":
      return v.nome;
    case "vendas":
    case "pct":
      return v.metricas.qtd;
    case "margem":
      return v.metricas.margem;
    case "margemPct":
      return v.metricas.margemPct;
    case "ticket":
      return v.metricas.ticket;
    case "consig":
      return v.metricas.qtdConsignadas;
    case "media3":
      return v.mediaUltimos3;
    case "mediaAnt":
      return v.mediaAnteriores;
    case "delta":
      return v.delta;
  }
}

export function AbaVendedores({
  linhasMes,
  ano,
  mes,
  parcial,
  estadoAno,
  onRetryAno,
  onFiltrar,
}: {
  linhasMes: LinhaVendaMatriz[];
  ano: number;
  mes: number;
  parcial: boolean;
  estadoAno: EstadoAno;
  onRetryAno: () => void;
  onFiltrar: AoFiltrarVendas;
}) {
  const [metrica, setMetrica] = useState<MetricaRanking>("vendas");
  const [verMatriz, setVerMatriz] = useState(false);
  const [verTodosMobile, setVerTodosMobile] = useState(false);
  const [ord, setOrd] = useState<{ col: ColTabela; dir: "asc" | "desc" }>({ col: "vendas", dir: "desc" });

  const matriz: MatrizMediaVendedor | null = useMemo(
    () => (estadoAno.status === "ok" ? matrizDoMesSelecionado(estadoAno.linhasAno, mes) : null),
    [estadoAno, mes],
  );
  const r = useMemo(() => rankingVendedores(linhasMes, matriz), [linhasMes, matriz]);
  const ranking = useMemo(() => ordenarRanking(r.vendedores, metrica), [r.vendedores, metrica]);
  const tabela = useMemo(() => {
    const sinal = ord.dir === "asc" ? 1 : -1;
    return [...r.tabela].sort((a, b) => {
      const va = valorTabela(a, ord.col);
      const vb = valorTabela(b, ord.col);
      if (va == null && vb != null) return 1;
      if (vb == null && va != null) return -1;
      if (va != null && vb != null && va !== vb) return (typeof va === "string" ? va.localeCompare(String(vb), "pt-BR") : va - (vb as number)) * sinal;
      return a.nome.localeCompare(b.nome, "pt-BR");
    });
  }, [r.tabela, ord]);

  const maxAbs = Math.max(0, ...ranking.map((v) => Math.abs(valorMetrica(v, metrica) ?? 0)), ...(metrica === "vendas" ? ranking.map((v) => v.mediaUltimos3 ?? 0) : []));
  const nomeMes = nomeMesAnoCapitalizado(mes, ano);
  const nFechados = mes - 1;
  const temBlocoA = matriz?.temBlocoA ?? nFechados > 3;
  const anoCarregado = estadoAno.status === "ok";

  const ordenarPor = (col: ColTabela) => setOrd((o) => (o.col === col ? { col, dir: o.dir === "asc" ? "desc" : "asc" } : { col, dir: col === "nome" ? "asc" : "desc" }));

  const notaMedias =
    nFechados === 0
      ? `Sem meses fechados em ${ano} para calcular médias.`
      : !temBlocoA
        ? "Delta aparece a partir de maio (precisa de 4 meses fechados)."
        : null;

  const colunas: { col: ColTabela; rotulo: string; dir?: boolean; some?: boolean; nota?: string }[] = [
    { col: "nome", rotulo: "Vendedor" },
    { col: "vendas", rotulo: "Vendas", dir: true },
    { col: "pct", rotulo: "%", dir: true },
    { col: "margem", rotulo: "Margem R$", dir: true, nota: TOOLTIP_NAO_EXCEL },
    { col: "margemPct", rotulo: "Margem %", dir: true, nota: TOOLTIP_NAO_EXCEL },
    { col: "ticket", rotulo: "Ticket", dir: true, nota: TOOLTIP_NAO_EXCEL },
    { col: "consig", rotulo: "Consig.", dir: true },
    { col: "media3", rotulo: "Média últ. 3 meses", dir: true, some: nFechados === 0 },
    { col: "mediaAnt", rotulo: "Média meses anteriores", dir: true, some: !temBlocoA },
    { col: "delta", rotulo: "Delta", dir: true, some: !temBlocoA },
  ];
  const colunasVisiveis = colunas.filter((c) => !c.some);

  const celulaMedia = (v: number | null) => (anoCarregado ? fmt2(v) : <span className="inline-block w-10"><SkeletonBar h="h-3" /></span>);

  // TOTAL do Delta = soma dos deltas da tabela (união mês × aba 8, Auto Avaliar incluso) = Excel no mês corrente.
  const totalDelta = r.somaDeltas;

  return (
    <div className="space-y-4">
      <Cartao
        idTitulo="titulo-ranking"
        titulo={
          <>
            Vendedores · {nomeMes}
            {parcial && <span className="font-normal text-[var(--text-muted)]">(parcial)</span>}
            <InfoTooltip rotulo="Vendedores" texto={TOOLTIP_NAO_EXCEL} />
          </>
        }
        acoes={<SegmentedToggle opcoes={OPCOES_METRICA} valor={metrica} onChange={setMetrica} ariaLabel="Ordenar ranking por" />}
      >
        {ranking.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">Nenhum vendedor da loja vendeu neste mês.</p>
        ) : (
          <ul className="space-y-1.5" aria-label={`Ranking de vendedores por ${OPCOES_METRICA.find((o) => o.valor === metrica)?.label}`}>
            {ranking.map((v) => {
              const valor = valorMetrica(v, metrica);
              const largura = valor != null && maxAbs > 0 ? (Math.abs(valor) / maxAbs) * 100 : 0;
              const neg = (valor ?? 0) < 0;
              const marcador = metrica === "vendas" && v.mediaUltimos3 != null && maxAbs > 0 ? (v.mediaUltimos3 / maxAbs) * 100 : null;
              const pctTotal = metrica === "vendas" ? fmtFrac(v.participacao) : metrica === "margem" && r.vendedores.every((x) => (x.metricas.margem ?? 0) >= 0) ? fmtFrac((v.metricas.margem ?? 0) / Math.max(1e-9, r.vendedores.reduce((s, x) => s + (x.metricas.margem ?? 0), 0))) : null;
              return (
                <li key={v.chave}>
                  <button
                    type="button"
                    onClick={() => onFiltrar({ vendedor: v.chave })}
                    aria-label={`${v.nome}: ${textoMetrica(v, metrica)}${pctTotal ? `, ${pctTotal} do total` : ""}${marcador != null ? `, média dos últimos 3 meses ${fmt2(v.mediaUltimos3)}` : ""}. Ver as vendas deste vendedor`}
                    className="grid w-full grid-cols-[minmax(6rem,10rem)_1fr_auto] items-center gap-3 rounded-md px-1 py-1 text-left text-sm hover:bg-[var(--bg-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-700)]"
                  >
                    <span className="truncate text-[var(--text-body)]" title={v.nome}>
                      {nomeCurto(v.nome)}
                    </span>
                    <span className="relative h-5 rounded bg-[var(--bg-muted)]">
                      <span className={cn("absolute inset-y-0 left-0 rounded", neg ? "bg-red-600 dark:bg-red-500" : "bg-[var(--brand-700)] dark:bg-[var(--brand-400)]")} style={{ width: `${largura}%` }} />
                      {marcador != null && (
                        <span className="absolute -inset-y-0.5 w-0.5 rounded bg-slate-500 dark:bg-slate-300" style={{ left: `calc(${Math.min(100, marcador)}% - 1px)` }} aria-hidden="true" />
                      )}
                    </span>
                    <span className={cn("min-w-[7rem] text-right tabular-nums font-semibold", neg ? CLASSE_NEGATIVO : "text-[var(--text-strong)]")}>
                      {textoMetrica(v, metrica)}
                      {pctTotal && <span className="ml-1.5 text-xs font-normal text-[var(--text-muted)]">{pctTotal}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-3 space-y-1 text-xs text-[var(--text-muted)]">
          {(r.autoAvaliar || r.semVendedor) && (
            <p className="flex flex-wrap gap-x-3">
              {r.autoAvaliar && (
                <LinkVerVendas
                  qtd={r.autoAvaliar.qtd}
                  descricao="do Auto Avaliar (leilão)"
                  filtro={{ vendedor: CHAVE_AUTO_AVALIAR }}
                  onFiltrar={onFiltrar}
                  rotulo={`○ Auto Avaliar (leilão): ${formatInt(r.autoAvaliar.qtd)} venda${r.autoAvaliar.qtd === 1 ? "" : "s"}, fora do ranking`}
                />
              )}
              {r.semVendedor && (
                <LinkVerVendas qtd={r.semVendedor.qtd} descricao="sem vendedor" filtro={{ vendedor: CHAVE_SEM_VENDEDOR }} onFiltrar={onFiltrar} rotulo={`○ Sem vendedor: ${formatInt(r.semVendedor.qtd)}`} />
              )}
            </p>
          )}
          {metrica === "vendas" && nFechados > 0 && (
            <p className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-0.5 bg-slate-500 dark:bg-slate-300" aria-hidden="true" /> = média do vendedor nos últimos 3 meses fechados
            </p>
          )}
          {parcial && <p>Mês em andamento: compare com o ritmo (marcador), não com o total de meses fechados.</p>}
        </div>
      </Cartao>

      <Cartao
        idTitulo="titulo-tabela-vendedores"
        titulo="Vendas e médias por vendedor"
        acoes={
          <label className="inline-flex items-center gap-1.5 text-xs text-[var(--text-body)]">
            <input type="checkbox" checked={verMatriz} onChange={(e) => setVerMatriz(e.target.checked)} className="h-4 w-4 accent-[var(--brand-700)]" />
            Ver mês a mês (como no Excel)
          </label>
        }
      >
        {estadoAno.status === "erro" && (
          <div className="mb-3">
            <ErroNoCartao mensagem="Não consegui carregar as vendas do ano para as médias" detalhe={estadoAno.mensagem} onRetry={onRetryAno} />
          </div>
        )}
        {notaMedias && <p className="mb-2 flex items-center gap-1.5 text-xs text-[var(--text-muted)]"><Info className="h-3.5 w-3.5" aria-hidden="true" />{notaMedias}</p>}
        <p className="mb-2 text-xs text-[var(--text-muted)]">
          Médias e delta = regra da aba MEDIA do Excel (÷ meses do bloco, mesmo com mês zerado), contando os meses fechados antes de {nomeMes.toLowerCase()}. A lista junta quem vendeu no mês e quem aparece na aba MEDIA (Auto Avaliar incluso, marcado). Com o mês corrente selecionado, médias, delta e o total do delta batem com o Excel.
        </p>

        {verMatriz ? (
          estadoAno.status === "ok" && matriz ? (
            <MatrizComoExcel matriz={matriz} ano={ano} />
          ) : estadoAno.status === "carregando" ? (
            <div className="space-y-2">{[0, 1, 2, 3, 4, 5].map((i) => <SkeletonBar key={i} h="h-5" delay={i * 60} />)}</div>
          ) : null
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm tabular-nums">
                <caption className="sr-only">Vendedores de {nomeMes}: vendas, margem e médias</caption>
                <thead className="border-b border-[var(--border-soft)] bg-[var(--bg-muted)]">
                  <tr>
                    {colunasVisiveis.map((c) => {
                      const ativo = ord.col === c.col;
                      const Icone = !ativo ? ChevronsUpDown : ord.dir === "asc" ? ChevronUp : ChevronDown;
                      return (
                        <th
                          key={c.col}
                          scope="col"
                          aria-sort={ativo ? (ord.dir === "asc" ? "ascending" : "descending") : "none"}
                          className={cn("whitespace-nowrap px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-body)]", c.dir ? "text-right" : "text-left")}
                        >
                          <button
                            type="button"
                            onClick={() => ordenarPor(c.col)}
                            title={c.nota}
                            className={cn("inline-flex items-center gap-1 rounded uppercase hover:text-[var(--text-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-700)]", c.dir && "flex-row-reverse")}
                          >
                            {c.rotulo}
                            {c.nota && <span className="sr-only"> (não tem no Excel)</span>}
                            <Icone className={cn("h-3 w-3", !ativo && "opacity-40")} aria-hidden="true" />
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {tabela.map((v) => {
                    const caiu = (v.delta ?? 0) < 0;
                    return (
                      <tr key={v.chave} className={cn("border-b border-[var(--border-soft)]", caiu && "bg-[var(--warning-bg)]")}>
                        {colunasVisiveis.map((c) => (
                          <td key={c.col} className={cn("whitespace-nowrap px-2 py-1.5", c.dir ? "text-right" : "text-left")}>
                            {c.col === "nome" ? (
                              v.metricas.qtd > 0 ? (
                                <button type="button" onClick={() => onFiltrar({ vendedor: v.chave })} className="rounded text-left font-medium text-[var(--text-strong)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-700)]" aria-label={`${v.nome}: ver as vendas`}>
                                  {v.nome}
                                </button>
                              ) : (
                                <span className="font-medium text-[var(--text-body)]">
                                  {v.nome}
                                  <span className="ml-1 text-[11px] font-normal text-[var(--text-muted)]">(sem venda no mês)</span>
                                </span>
                              )
                            ) : c.col === "vendas" ? (
                              formatInt(v.metricas.qtd)
                            ) : c.col === "pct" ? (
                              fmtFrac(v.participacao)
                            ) : c.col === "margem" ? (
                              <span className={cn((v.metricas.margem ?? 0) < 0 && CLASSE_NEGATIVO)}>{formatBRL(v.metricas.margem)}</span>
                            ) : c.col === "margemPct" ? (
                              <span className={cn((v.metricas.margemPct ?? 0) < 0 && CLASSE_NEGATIVO)}>{fmtFrac(v.metricas.margemPct)}</span>
                            ) : c.col === "ticket" ? (
                              formatBRL(v.metricas.ticket)
                            ) : c.col === "consig" ? (
                              v.metricas.qtdConsignadas > 0 ? formatInt(v.metricas.qtdConsignadas) : "—"
                            ) : c.col === "media3" ? (
                              celulaMedia(v.mediaUltimos3)
                            ) : c.col === "mediaAnt" ? (
                              celulaMedia(v.mediaAnteriores)
                            ) : anoCarregado ? (
                              <span className={cn("inline-flex items-center gap-1", caiu && CLASSE_NEGATIVO)}>
                                {caiu && <TrendingDown className="h-3.5 w-3.5" aria-hidden="true" />}
                                {fmt2(v.delta)}
                                {caiu && <span className="sr-only"> (ritmo caiu)</span>}
                              </span>
                            ) : (
                              celulaMedia(null)
                            )}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="border-t-2 border-[var(--border-base)] bg-[var(--bg-muted)] font-semibold text-[var(--text-strong)]">
                  <tr>
                    {colunasVisiveis.map((c) => (
                      <td key={c.col} className={cn("whitespace-nowrap px-2 py-2", c.dir ? "text-right" : "text-left")}>
                        {c.col === "nome"
                          ? "Total"
                          : c.col === "vendas"
                            ? formatInt(r.tabela.reduce((s, v) => s + v.metricas.qtd, 0))
                            : c.col === "delta" && anoCarregado
                              ? <span className={cn((totalDelta ?? 0) < 0 && CLASSE_NEGATIVO)}>{fmt2(totalDelta)}</span>
                              : ""}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* < md: cards (top 5 + Ver todos) */}
            <ul className="space-y-2 md:hidden">
              {(verTodosMobile ? tabela : tabela.slice(0, 5)).map((v) => {
                const caiu = (v.delta ?? 0) < 0;
                return (
                  <li key={v.chave} className={cn("rounded-lg border border-[var(--border-soft)] p-3 text-xs tabular-nums", caiu ? "bg-[var(--warning-bg)]" : "bg-[var(--bg-surface)]")}>
                    <button type="button" disabled={v.metricas.qtd === 0} onClick={() => onFiltrar({ vendedor: v.chave })} className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-700)]">
                      <p className="flex justify-between font-medium text-[var(--text-strong)]">
                        <span>{v.nome}</span>
                        <span>{formatInt(v.metricas.qtd)} vendas</span>
                      </p>
                      <p className="mt-1 text-[var(--text-body)]">
                        Margem <span className={cn((v.metricas.margem ?? 0) < 0 && CLASSE_NEGATIVO)}>{formatBRL(v.metricas.margem)}</span> · {fmtFrac(v.metricas.margemPct)} · Ticket {formatBRL(v.metricas.ticket)}
                      </p>
                      {anoCarregado && v.mediaUltimos3 != null && (
                        <p className="mt-1 text-[var(--text-muted)]">
                          Média últ. 3: {fmt2(v.mediaUltimos3)}
                          {v.delta != null && (
                            <>
                              {" "}· Delta <span className={cn(caiu && CLASSE_NEGATIVO)}>{fmt2(v.delta)}</span>
                            </>
                          )}
                        </p>
                      )}
                    </button>
                  </li>
                );
              })}
              {tabela.length > 5 && !verTodosMobile && (
                <li>
                  <button type="button" onClick={() => setVerTodosMobile(true)} className="text-xs font-medium text-[var(--brand-700)] hover:underline dark:text-[var(--brand-300)]">
                    Ver todos ({formatInt(tabela.length)})
                  </button>
                </li>
              )}
            </ul>
          </>
        )}
      </Cartao>
    </div>
  );
}

/** Matriz vendedor × meses fechados, idêntica à aba 8 (blocos A | B | Delta), Auto Avaliar marcado. */
function MatrizComoExcel({ matriz, ano }: { matriz: MatrizMediaVendedor; ano: number }) {
  if (matriz.nFechados === 0) return <p className="text-sm text-[var(--text-muted)]">Sem meses fechados em {ano} para calcular médias.</p>;
  const { mesesBlocoA, mesesBlocoB, temBlocoA, vendedores } = matriz;
  const totalMes = (m: number) => vendedores.reduce((s, v) => s + v.meses[m - 1], 0);
  const totalBloco = (meses: number[]) => meses.reduce((s, m) => s + totalMes(m), 0);
  const thBase = "whitespace-nowrap px-2 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wide";
  const separador = "border-l-2 border-[var(--border-base)]";
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs tabular-nums">
        <caption className="sr-only">Vendas por vendedor e mês fechado de {ano}, como na aba MEDIA do Excel</caption>
        <thead className="bg-[var(--brand-700)] text-white dark:bg-[var(--brand-800)]">
          <tr>
            <th scope="col" className="sticky left-0 z-10 bg-[var(--brand-700)] px-2 py-1.5 text-left text-[10px] font-semibold uppercase dark:bg-[var(--brand-800)]">
              Vendedor · {ano}
            </th>
            {temBlocoA && mesesBlocoA.map((m) => <th key={`a${m}`} scope="col" className={thBase}>{NOMES_MESES_ABREV[m - 1]}</th>)}
            {temBlocoA && <th scope="col" className={thBase}>Total</th>}
            {temBlocoA && <th scope="col" className={thBase}>Média</th>}
            {mesesBlocoB.map((m, i) => <th key={`b${m}`} scope="col" className={cn(thBase, i === 0 && temBlocoA && separador)}>{NOMES_MESES_ABREV[m - 1]}</th>)}
            <th scope="col" className={thBase}>Total</th>
            <th scope="col" className={thBase}>Média</th>
            {temBlocoA && <th scope="col" className={cn(thBase, separador)}>Delta</th>}
          </tr>
        </thead>
        <tbody>
          {vendedores.map((v) => {
            const caiu = (v.delta ?? 0) < 0;
            const aa = isNomeAutoAvaliar(v.vendedor);
            return (
              <tr key={v.vendedor} className={cn("border-b border-[var(--border-soft)]", caiu ? "bg-[var(--warning-bg)]" : "bg-[var(--bg-surface)]")}>
                <th scope="row" className="sticky left-0 z-10 whitespace-nowrap bg-inherit px-2 py-1 text-left font-medium text-[var(--text-strong)]">
                  {v.vendedor}
                  {aa && <span className="ml-1 font-normal text-[var(--text-muted)]">(leilão)</span>}
                </th>
                {temBlocoA && mesesBlocoA.map((m) => <td key={m} className="px-2 py-1 text-right">{v.meses[m - 1]}</td>)}
                {temBlocoA && <td className="px-2 py-1 text-right font-medium">{v.totalA}</td>}
                {temBlocoA && <td className="px-2 py-1 text-right">{fmt2(v.mediaA)}</td>}
                {mesesBlocoB.map((m, i) => <td key={m} className={cn("px-2 py-1 text-right", i === 0 && temBlocoA && separador)}>{v.meses[m - 1]}</td>)}
                <td className="px-2 py-1 text-right font-medium">{v.totalB}</td>
                <td className="px-2 py-1 text-right">{fmt2(v.mediaB)}</td>
                {temBlocoA && <td className={cn("px-2 py-1 text-right", separador, caiu && CLASSE_NEGATIVO)}>{fmt2(v.delta)}</td>}
              </tr>
            );
          })}
        </tbody>
        <tfoot className="bg-[var(--bg-muted)] font-semibold text-[var(--text-strong)]">
          <tr>
            <th scope="row" className="sticky left-0 bg-[var(--bg-muted)] px-2 py-1.5 text-left">TOTAL</th>
            {temBlocoA && mesesBlocoA.map((m) => <td key={m} className="px-2 py-1.5 text-right">{totalMes(m)}</td>)}
            {temBlocoA && <td className="px-2 py-1.5 text-right">{totalBloco(mesesBlocoA)}</td>}
            {temBlocoA && <td className="px-2 py-1.5 text-right">{fmt2(totalBloco(mesesBlocoA) / mesesBlocoA.length)}</td>}
            {mesesBlocoB.map((m, i) => <td key={m} className={cn("px-2 py-1.5 text-right", i === 0 && temBlocoA && separador)}>{totalMes(m)}</td>)}
            <td className="px-2 py-1.5 text-right">{totalBloco(mesesBlocoB)}</td>
            <td className="px-2 py-1.5 text-right">{fmt2(totalBloco(mesesBlocoB) / mesesBlocoB.length)}</td>
            {temBlocoA && <td className={cn("px-2 py-1.5 text-right", separador, (matriz.somaDeltas ?? 0) < 0 && CLASSE_NEGATIVO)}>{fmt2(matriz.somaDeltas)}</td>}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
