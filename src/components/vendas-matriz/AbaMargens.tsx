"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import type { MetricasBlocoMargens } from "@/lib/export/vendas-matriz/aba-margens";
import { CUSTOS_LINHA, ROTULO_CUSTO } from "@/lib/export/vendas-matriz/filtrar-vendas";
import {
  NOTA_REGRA_RECORRENTE,
  coberturaCustos,
  visaoMargens,
  type ColunaMargem,
  type CorColunaMargem,
  type VisaoMargensChave,
} from "@/lib/export/vendas-matriz/visoes-margens";
import type { LinhaVendaMatriz } from "@/lib/export/vendas-matriz/tipos";
import { SegmentedToggle } from "@/components/ui/SegmentedToggle";
import { Tooltip } from "@/components/ui/Tooltip";
import { cn, formatBRL, formatBRLCents, formatInt } from "@/lib/utils";
import { InfoTooltip } from "./BlocoKpis";
import { CLASSE_NEGATIVO, Cartao, LinkVerVendas, fmtFrac, type AoFiltrarVendas } from "./comum";
import { CascataMargem } from "./CascataMargem";
import { nomeMesAnoCapitalizado } from "./formato";

const OPCOES_VISAO = [
  { valor: "origem", label: "Total e origem" },
  { valor: "pfpj", label: "Pessoa física × jurídica" },
  { valor: "recorrente", label: "Comprador recorrente (lojista) × cliente final" },
] as const;

/** Linhas do DRE = as do `renderBloco` do Excel, na mesma ordem. */
type LinhaDre = {
  rotulo: string;
  /** Rótulo exato da planilha (pra quem confere). */
  rotuloExcel: string;
  campo: keyof MetricasBlocoMargens;
  fmt: "brl" | "int";
  comPct?: boolean;
  forte?: boolean;
  vermelhoSeNegativo?: boolean;
};

const LINHAS_DRE: LinhaDre[] = [
  { rotulo: "Valor da venda", rotuloExcel: "Valor da Venda", campo: "valorVendaTotal", fmt: "brl" },
  { rotulo: "Qtde faturados", rotuloExcel: "Qtde Faturados", campo: "qtdeFaturados", fmt: "int" },
  { rotulo: "Ticket médio", rotuloExcel: "Ticket Médio", campo: "ticketMedio", fmt: "brl" },
  { rotulo: "KM média", rotuloExcel: "KM Média", campo: "kmMedia", fmt: "int" },
  { rotulo: "FIPE total", rotuloExcel: "FIPE Total", campo: "fipeTotal", fmt: "brl" },
  { rotulo: "Custo real (NF entrada − valoriza)", rotuloExcel: "NF Entrada - Valoriza Total", campo: "custoRealTotal", fmt: "brl", comPct: true },
  { rotulo: "Lucro bruto", rotuloExcel: "Lucro Bruto", campo: "lucroBrutoTotal", fmt: "brl", comPct: true, forte: true, vermelhoSeNegativo: true },
  { rotulo: "(−) Despesas gerais", rotuloExcel: "Despesas Gerais", campo: "despesaGeralTotal", fmt: "brl", comPct: true },
  { rotulo: "(−) F Plan", rotuloExcel: "F Plan", campo: "forplanTotal", fmt: "brl", comPct: true },
  { rotulo: "(−) Impostos", rotuloExcel: "Impostos", campo: "impostosTotal", fmt: "brl", comPct: true },
  { rotulo: "(−) Comissão", rotuloExcel: "Comissão", campo: "comissaoTotal", fmt: "brl", comPct: true },
  { rotulo: "(−) ADM", rotuloExcel: "ADM", campo: "admTotal", fmt: "brl", comPct: true },
  { rotulo: "Margem líquida", rotuloExcel: "Margem Líquida", campo: "margemLiquidaTotal", fmt: "brl", comPct: true, forte: true, vermelhoSeNegativo: true },
  { rotulo: "Dias estoque médio", rotuloExcel: "Dias Estoque Médio", campo: "diasEstoqueMedio", fmt: "int" },
];

const PONTO: Record<CorColunaMargem, string> = {
  total: "bg-[var(--brand-700)] dark:bg-[var(--brand-400)]",
  proprio: "bg-emerald-600 dark:bg-emerald-500",
  outras: "bg-amber-500",
  naoIdentificada: "border-2 border-slate-400 bg-transparent",
  pf: "bg-blue-500",
  pj: "bg-purple-500",
  neutro: "border-2 border-slate-400 bg-transparent",
};

function valorCelula(l: LinhaDre, m: MetricasBlocoMargens): { texto: string; titulo: string; pct: string | null; negativo: boolean } {
  const v = m[l.campo];
  const negativo = l.vermelhoSeNegativo === true && v < 0;
  const pct = l.comPct ? (m.valorVendaTotal > 0 ? fmtFrac(v / m.valorVendaTotal) : "") : null;
  if (l.fmt === "int") return { texto: formatInt(Math.round(v)), titulo: String(v), pct, negativo };
  return { texto: formatBRL(v), titulo: formatBRLCents(v), pct, negativo };
}

function CoberturaCustos({ linhasMes }: { linhasMes: LinhaVendaMatriz[] }) {
  const c = coberturaCustos(linhasMes);
  const completa = c.completas === c.total && c.semNfEntrada === 0;
  if (completa) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Todos os custos lançados ({formatInt(c.total)} vendas, sem consignadas)
      </p>
    );
  }
  return (
    <div className="rounded-xl border border-amber-300 bg-[var(--warning-bg)] p-3 text-xs text-[var(--text-body)] dark:border-amber-800">
      <p className="flex items-center gap-1.5 font-semibold text-[var(--warning)]">
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        Custos lançados em {formatInt(c.completas)} de {formatInt(c.total)} vendas (sem consignadas)
      </p>
      <p className="mt-1 tabular-nums">
        {CUSTOS_LINHA.map((k) => `${ROTULO_CUSTO[k]} ${formatInt(c.porCusto[k])}`).join(" · ")}
        {c.semNfEntrada > 0 && ` · ${formatInt(c.semNfEntrada)} sem NF de entrada (fora do lucro bruto)`}
      </p>
      <p className="mt-1">Custo não lançado conta como zero, igual ao Excel: a margem líquida pode estar maior que a real.</p>
    </div>
  );
}

function CabecalhoColuna({ c, foco, onFoco }: { c: ColunaMargem; foco: boolean; onFoco: () => void }) {
  return (
    <button
      type="button"
      onClick={onFoco}
      aria-pressed={foco}
      title="Mostrar esta coluna na cascata"
      className={cn(
        "w-full rounded-md px-1 py-0.5 text-right focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-700)]",
        foco && "bg-[var(--bg-surface)] shadow-sm",
      )}
    >
      <span className={cn("inline-flex items-center justify-end gap-1.5 text-xs font-semibold uppercase tracking-wide", c.secundaria ? "text-[var(--text-muted)]" : "text-[var(--text-strong)]")}>
        <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", PONTO[c.cor])} aria-hidden="true" />
        {c.titulo}
      </span>
      <span className="mt-0.5 block text-[10px] font-normal normal-case leading-tight text-[var(--text-muted)]">{c.blocoExcel ?? "(fora do Excel)"}</span>
    </button>
  );
}

function descricaoFiltro(c: ColunaMargem): string {
  return `da coluna ${c.titulo}, sem consignadas`;
}

export function AbaMargens({
  linhasMes,
  codEmpresa,
  mes,
  ano,
  onFiltrar,
}: {
  linhasMes: LinhaVendaMatriz[];
  codEmpresa: number;
  mes: number;
  ano: number;
  onFiltrar: AoFiltrarVendas;
}) {
  const [visao, setVisao] = useState<VisaoMargensChave>("origem");
  const [abrirPorOrigem, setAbrirPorOrigem] = useState(false);
  const [focoId, setFocoId] = useState("total");
  const v = useMemo(() => visaoMargens(visao, linhasMes, codEmpresa, abrirPorOrigem), [visao, linhasMes, codEmpresa, abrirPorOrigem]);
  const foco = v.colunas.find((c) => c.id === focoId) ?? v.colunas[0];

  const soConsignadas = linhasMes.length > 0 && v.totalSemConsig === 0;
  const nomeMes = nomeMesAnoCapitalizado(mes, ano);

  const reconciliacao = (() => {
    const partes = v.colunas.filter((c) => c.id !== "total");
    if (v.chave === "recorrente") {
      const [semDoc, naoIdent] = v.foraDaVisao;
      const fora = [semDoc.qtd > 0 ? `${formatInt(semDoc.qtd)} venda${semDoc.qtd === 1 ? "" : "s"} ${semDoc.rotulo}` : null, naoIdent.qtd > 0 ? `${formatInt(naoIdent.qtd)} ${naoIdent.rotulo}` : null].filter(Boolean);
      return (
        <>
          {fora.length > 0 ? `Fora desta visão, como no Excel: ${fora.join(" e ")}. ` : "Nenhuma venda fora desta visão. "}
          As 4 colunas somam {formatInt(v.somaColunas.qtd)} das {formatInt(v.totalSemConsig)} vendas (sem consignadas) e {formatBRLCents(v.somaColunas.margem)} dos {formatBRLCents(v.margemTotal)} de margem.
        </>
      );
    }
    return (
      <>
        Total: {formatInt(v.totalSemConsig)} vendas = {partes.filter((c) => c.metricas.qtdeFaturados > 0).map((c) => `${formatInt(c.metricas.qtdeFaturados)} ${c.titulo.toLowerCase()}`).join(" + ")}. Margem {formatBRLCents(v.margemTotal)} = soma das colunas ({formatBRLCents(v.somaColunas.margem)}).
      </>
    );
  })();

  return (
    <div className="space-y-4">
      <CoberturaCustos linhasMes={linhasMes} />

      <Cartao
        idTitulo="titulo-margens"
        titulo={
          <>
            Margens · {nomeMes}
            {v.qtdConsignadas > 0 && <span className="font-normal text-[var(--text-muted)]">· sem {formatInt(v.qtdConsignadas)} consignada{v.qtdConsignadas === 1 ? "" : "s"}</span>}
            <InfoTooltip rotulo="Margens" texto="Mesmos blocos e mesmas contas das abas MARGENS do Excel. Consignadas ficam fora de toda margem." />
          </>
        }
        acoes={
          <>
            <SegmentedToggle opcoes={OPCOES_VISAO} valor={visao} onChange={(x) => { setVisao(x); setFocoId("total"); }} ariaLabel="Visão das margens" />
            {visao === "pfpj" && (
              <label className="inline-flex items-center gap-1.5 text-xs text-[var(--text-body)]">
                <input type="checkbox" checked={abrirPorOrigem} onChange={(e) => setAbrirPorOrigem(e.target.checked)} className="h-4 w-4 accent-[var(--brand-700)]" />
                Abrir por origem
              </label>
            )}
          </>
        }
      >
        {visao === "recorrente" && (
          <p className="mb-3 flex items-start gap-1.5 rounded-lg bg-[var(--bg-muted)] p-3 text-xs text-[var(--text-body)]">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              <strong>Comprador recorrente (lojista) × Cliente final</strong> — as abas MARGENS VENDAS LOJISTAS e CLIENTES do Excel. {NOTA_REGRA_RECORRENTE} Um PJ com 1 compra aparece aqui como cliente final.
            </span>
          </p>
        )}

        {soConsignadas ? (
          <p className="text-sm text-[var(--text-muted)]">Todas as vendas do mês são consignadas — sem margem a calcular</p>
        ) : (
          <>
            {/* < md: uma coluna por vez */}
            <div className="space-y-2 md:hidden">
              <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                Recorte
                <select
                  value={foco.id}
                  onChange={(e) => setFocoId(e.target.value)}
                  className="h-9 flex-1 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] px-2 text-sm text-[var(--text-strong)]"
                >
                  {v.colunas.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.titulo}
                    </option>
                  ))}
                </select>
              </label>
              {foco.blocoExcel && <p className="text-[10px] text-[var(--text-muted)]">Excel: {foco.blocoExcel}</p>}
              <dl className="divide-y divide-[var(--border-soft)] text-sm">
                {LINHAS_DRE.map((l) => {
                  const cel = valorCelula(l, foco.metricas);
                  return (
                    <div key={l.campo} className={cn("flex items-baseline justify-between gap-3 py-1.5", l.forte && "font-semibold text-[var(--text-strong)]")}>
                      <dt>{l.rotulo}</dt>
                      <dd className={cn("tabular-nums", cel.negativo && CLASSE_NEGATIVO)} title={cel.titulo}>
                        {cel.texto}
                        {cel.pct ? <span className="ml-1.5 text-[11px] font-normal text-[var(--text-muted)]">{cel.pct}</span> : null}
                      </dd>
                    </div>
                  );
                })}
              </dl>
              <LinkVerVendas qtd={foco.metricas.qtdeFaturados} descricao={descricaoFiltro(foco)} filtro={foco.filtro} onFiltrar={onFiltrar} rotulo="Ver vendas" />
            </div>

            {/* ≥ md: DRE com colunas */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[40rem] text-sm tabular-nums">
                <caption className="sr-only">Margens de {nomeMes} em formato DRE, visão {OPCOES_VISAO.find((o) => o.valor === visao)?.label}</caption>
                <thead>
                  <tr className="border-b border-[var(--border-soft)] bg-[var(--bg-muted)]">
                    <th scope="col" className="sticky left-0 z-10 bg-[var(--bg-muted)] px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                      <span className="sr-only">Linha</span>
                    </th>
                    {v.colunas.map((c) => (
                      <th key={c.id} scope="col" className="min-w-[8.5rem] px-2 py-2 align-bottom">
                        <span className="inline-flex w-full items-start justify-end gap-1">
                          <CabecalhoColuna c={c} foco={c.id === foco.id} onFoco={() => setFocoId(c.id)} />
                          {c.tooltip && <InfoTooltip rotulo={c.titulo} texto={c.tooltip} />}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {LINHAS_DRE.map((l) => (
                    <tr key={l.campo} className={cn("border-b border-[var(--border-soft)]", l.forte && "font-semibold text-[var(--text-strong)]")}>
                      <th scope="row" title={`Excel: ${l.rotuloExcel}`} className="sticky left-0 z-10 whitespace-nowrap bg-[var(--bg-surface)] px-2 py-1.5 text-left font-[inherit] text-[var(--text-body)]">
                        {l.rotulo}
                      </th>
                      {v.colunas.map((c) => {
                        const cel = valorCelula(l, c.metricas);
                        return (
                          <td key={c.id} className={cn("whitespace-nowrap px-2 py-1.5 text-right", c.secundaria && "text-[var(--text-muted)]", cel.negativo && CLASSE_NEGATIVO)} title={cel.titulo}>
                            {cel.texto}
                            {cel.pct != null && <span className="ml-1.5 inline-block min-w-[3rem] text-[11px] font-normal text-[var(--text-muted)]">{cel.pct}</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr>
                    <th scope="row" className="sticky left-0 bg-[var(--bg-surface)]">
                      <span className="sr-only">Ver vendas</span>
                    </th>
                    {v.colunas.map((c) => (
                      <td key={c.id} className="px-2 py-2 text-right">
                        <LinkVerVendas qtd={c.metricas.qtdeFaturados} descricao={descricaoFiltro(c)} filtro={c.filtro} onFiltrar={onFiltrar} rotulo="Ver vendas" />
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>

            <p className="mt-3 flex items-start gap-1.5 text-xs tabular-nums text-[var(--text-muted)]">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{reconciliacao}</span>
            </p>
          </>
        )}
      </Cartao>

      {!soConsignadas && foco.metricas.qtdeFaturados > 0 && (
        <Cartao
          idTitulo="titulo-cascata"
          titulo={
            <>
              Da venda à margem · {foco.titulo}
              <Tooltip content="Clique no cabeçalho de uma coluna da tabela para trocar o recorte." focavel={false}>
                <span className="text-xs font-normal text-[var(--text-muted)]">(clique no cabeçalho pra trocar)</span>
              </Tooltip>
            </>
          }
        >
          <CascataMargem coluna={foco} />
        </Cartao>
      )}
    </div>
  );
}
