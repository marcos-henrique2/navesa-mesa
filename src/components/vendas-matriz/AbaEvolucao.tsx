"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { serieDiaria, serieMensal, type PontoDiario, type PontoMensal, type SerieDiaria, type SerieMensal } from "@/lib/export/vendas-matriz/evolucao";
import { calcularDelta, type CompradorChave, type CorteComparacao, type MetricasRecorte } from "@/lib/export/vendas-matriz/resumir-painel";
import { ORDEM_ORIGEM, type LinhaVendaMatriz, type OrigemChave } from "@/lib/export/vendas-matriz/tipos";
import { SegmentedToggle } from "@/components/ui/SegmentedToggle";
import { SkeletonBar } from "@/components/ui/Skeleton";
import { cn, formatBRL, formatInt } from "@/lib/utils";
import { ROTULO_ORIGEM_CURTO } from "./Barras";
import { CLASSE_NEGATIVO, Cartao, ErroNoCartao, fmtBRLAbrev, fmtFrac, type AoFiltrarVendas } from "./comum";
import { mesCurto, nomeMesAno, nomeMesAnoCapitalizado } from "./formato";
import {
  CLASSE_VARS_GRAFICO,
  COR_COMPRADOR_GRAFICO,
  COR_ORIGEM_GRAFICO,
  ChartTooltip,
  GRID,
  Legenda,
  ROTULO_COMPRADOR_GRAFICO,
  TICK,
  useMenosMovimento,
} from "./graficos-comum";
import type { EstadoAno } from "./AbaVendedores";

const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const COMPRADORES: readonly CompradorChave[] = ["pf", "pj", "autoAvaliar", "naoInformado"];

function dd(n: number): string {
  return String(n).padStart(2, "0");
}

/** Índice do ponto clicado (Recharts passa o estado do gráfico no onClick). */
function indiceClicado(estado: unknown): number | null {
  if (estado == null || typeof estado !== "object" || !("activeTooltipIndex" in estado)) return null;
  const i = Number((estado as { activeTooltipIndex: unknown }).activeTooltipIndex);
  return Number.isInteger(i) && i >= 0 ? i : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Dia a dia
// ═══════════════════════════════════════════════════════════════════════════

type ModoDia = "qtd" | "margem";

function GraficoRitmoDiario({
  serie,
  mes,
  ano,
  corte,
  atual,
  anterior,
  onDia,
}: {
  serie: SerieDiaria;
  mes: number;
  ano: number;
  corte: CorteComparacao;
  /** KPIs do Resumo (o topo usa o MESMO número e o MESMO delta). */
  atual: MetricasRecorte;
  anterior: MetricasRecorte;
  onDia: (dia: number) => void;
}) {
  const [modo, setModo] = useState<ModoDia>("qtd");
  const semAnimacao = useMenosMovimento();
  const ant = corte.mesAnterior;
  const nomeAnt = nomeMesAnoCapitalizado(ant.mes, ant.ano);
  const nomeAtual = nomeMesAnoCapitalizado(mes, ano);
  const margem = modo === "margem";
  const sufixo = (p: PontoDiario) => ({
    noDia: margem ? p.noDiaMargem : p.noDiaQtd,
    acum: margem ? p.acumMargem : p.acumQtd,
    antAte: margem ? p.antAteCorteMargem : p.antAteCorteQtd,
    antDepois: margem ? p.antDepoisMargem : p.antDepoisQtd,
    ant: margem ? p.antMargem : p.antQtd,
  });
  // `qtdDia` acompanha os dois modos: um dia com venda e margem 0 continua clicável.
  const dados = serie.pontos.map((p) => ({ dia: p.dia, qtdDia: p.noDiaQtd, ...sufixo(p) }));
  const fmt = (v: number | null) => (margem ? formatBRL(v) : formatInt(v));

  // Frase do topo = KPI da Fase 1 (mesmo corte, mesmo delta).
  const vAtual = margem ? atual.margem : atual.qtd;
  const vAnt = anterior.qtd === 0 ? null : margem ? anterior.margem : anterior.qtd;
  const delta = calcularDelta(vAtual, vAnt, "valor");
  const textoDelta =
    delta == null || delta.tipo === "semBase"
      ? "sem base de comparação"
      : delta.tipo === "absoluto"
        ? `${delta.abs >= 0 ? "▲ +" : "▼ −"}${fmt(Math.abs(delta.abs))}`
        : delta.tipo === "percentual"
          ? `${delta.pct >= 0 ? "▲ +" : "▼ −"}${fmtFrac(Math.abs(delta.pct) / 100)}`
          : "";
  const rotuloCorte = serie.parcial ? `Até dia ${serie.diaCorte}` : nomeAtual;
  const rotuloAnt = serie.parcial ? `${mesCurto(ant.mes, ant.ano)} até dia ${serie.diaCorteAnterior}` : nomeAnt;
  const frase = margem
    ? `${rotuloCorte}: margem ${formatBRL(atual.margem)} · ${rotuloAnt}: ${formatBRL(anterior.qtd === 0 ? null : anterior.margem)} (${textoDelta})`
    : `${rotuloCorte}: ${formatInt(atual.qtd)} vendas · ${rotuloAnt}: ${formatInt(anterior.qtd)} (${textoDelta})`;

  const aria = margem
    ? `Margem acumulada: ${formatBRL(atual.margem)} até ${dd(serie.diaCorte)}/${dd(mes)}, contra ${formatBRL(anterior.margem)} no mesmo período de ${nomeMesAno(ant.mes, ant.ano)}.`
    : `Vendas acumuladas: ${formatInt(atual.qtd)} até ${dd(serie.diaCorte)}/${dd(mes)}, contra ${formatInt(anterior.qtd)} no mesmo período de ${nomeMesAno(ant.mes, ant.ano)}.`;

  const ultimo = serie.diaCorte;

  return (
    <Cartao
      idTitulo="titulo-ritmo"
      titulo="Ritmo do mês"
      acoes={<SegmentedToggle opcoes={[{ valor: "qtd", label: "Vendas" }, { valor: "margem", label: "Margem R$" }] as const} valor={modo} onChange={setModo} ariaLabel="Medida do ritmo do mês" />}
    >
      <p className="text-sm tabular-nums text-[var(--text-body)]">{frase}</p>
      {margem && atual.qtdConsignadas > 0 && <p className="text-[11px] text-[var(--text-muted)]">Sem as {formatInt(atual.qtdConsignadas)} consignadas.</p>}
      <div className={cn("mt-3", CLASSE_VARS_GRAFICO)}>
        <div role="img" aria-label={aria} className="h-56 w-full sm:h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={dados}
              margin={{ top: 16, right: 16, bottom: 0, left: 4 }}
              onClick={(estado: unknown) => {
                const i = indiceClicado(estado);
                if (i != null && dados[i] && (dados[i].qtdDia ?? 0) > 0) onDia(dados[i].dia);
              }}
              className="cursor-pointer"
            >
              <CartesianGrid {...GRID} />
              <XAxis dataKey="dia" tick={TICK} tickLine={false} axisLine={{ stroke: "var(--border-base)" }} ticks={[1, 5, 10, 15, 20, 25, 30].filter((d) => d <= dados.length)} />
              <YAxis tick={TICK} tickLine={false} axisLine={false} width={margem ? 72 : 32} tickFormatter={(v: number) => (margem ? fmtBRLAbrev(v) : formatInt(v))} allowDecimals={false} />
              {margem && <ReferenceLine y={0} stroke="var(--border-base)" />}
              {serie.parcial && <ReferenceLine x={ultimo} stroke="var(--text-subtle)" strokeDasharray="2 2" label={{ value: "Hoje", position: "top", fontSize: 11, fill: "var(--text-muted)" }} />}
              <Tooltip
                cursor={{ fill: "var(--bg-muted)" }}
                content={({ active, payload }) => {
                  const p = payload?.[0]?.payload as (typeof dados)[number] | undefined;
                  if (!active || !p) return null;
                  const semana = DIAS_SEMANA[new Date(Date.UTC(ano, mes - 1, p.dia, 12)).getUTCDay()];
                  const unidade = (v: number | null) => (margem ? fmt(v) : `${formatInt(v)} venda${v === 1 ? "" : "s"}`);
                  return (
                    <ChartTooltip titulo={`${semana}, ${dd(p.dia)}/${dd(mes)}`}>
                      {p.noDia != null && <p>No dia: {unidade(p.noDia)}</p>}
                      {p.acum != null && <p>Acumulado: {fmt(p.acum)}</p>}
                      {p.ant != null && (
                        <p>
                          {nomeAnt.split("/")[0]} até {dd(p.dia)}/{dd(ant.mes)}: {fmt(p.ant)}
                        </p>
                      )}
                    </ChartTooltip>
                  );
                }}
              />
              <Bar dataKey="noDia" name="No dia" fill="var(--c-brand)" fillOpacity={0.28} radius={[4, 4, 0, 0]} isAnimationActive={!semAnimacao}>
                {dados.map((p) => (
                  <Cell key={p.dia} fill={margem && (p.noDia ?? 0) < 0 ? "var(--danger)" : "var(--c-brand)"} fillOpacity={margem && (p.noDia ?? 0) < 0 ? 0.7 : 0.28} />
                ))}
              </Bar>
              <Line dataKey="antAte" name={nomeAnt} stroke="var(--c-anterior)" strokeWidth={2} strokeDasharray="4 3" dot={false} connectNulls={false} isAnimationActive={!semAnimacao} />
              {serie.parcial && (
                <Line dataKey="antDepois" name={`${nomeAnt} (depois do corte)`} stroke="var(--c-anterior)" strokeOpacity={0.35} strokeWidth={2} strokeDasharray="4 3" dot={false} isAnimationActive={!semAnimacao} />
              )}
              <Line
                dataKey="acum"
                name={nomeAtual}
                stroke="var(--c-brand)"
                strokeWidth={2.5}
                isAnimationActive={!semAnimacao}
                dot={(props: { cx?: number; cy?: number; index?: number }) => {
                  const { cx, cy, index } = props;
                  if (index !== ultimo - 1 || cx == null || cy == null) return <g key={`d${index}`} />;
                  return (
                    <g key={`d${index}`}>
                      <circle cx={cx} cy={cy} r={4.5} fill="var(--c-brand)" stroke="var(--bg-surface)" strokeWidth={2} />
                      <text x={cx - 6} y={cy - 10} textAnchor="end" fontSize={11} fontWeight={600} fill="var(--text-strong)">
                        {fmt(dados[index].acum)}
                      </text>
                    </g>
                  );
                }}
                activeDot={{ r: 4 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <Legenda
          itens={[
            { rotulo: `${nomeAtual} (acumulado)`, cor: "var(--c-brand)", forma: "linha" },
            { rotulo: `${nomeAnt} (acumulado)`, cor: "var(--c-anterior)", forma: "tracejada" },
            { rotulo: margem ? "Margem no dia" : "Vendas no dia", cor: "color-mix(in srgb, var(--c-brand) 35%, transparent)" },
          ]}
        />
      </div>
      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-[var(--text-muted)] hover:text-[var(--text-body)]">Ver números por dia</summary>
        <div className="mt-2 max-h-72 overflow-y-auto">
          <table className="w-full tabular-nums">
            <caption className="sr-only">Vendas por dia de {nomeMesAno(mes, ano)}</caption>
            <thead className="sticky top-0 bg-[var(--bg-surface)] text-[var(--text-muted)]">
              <tr>
                <th scope="col" className="py-1 text-left font-medium">Dia</th>
                <th scope="col" className="py-1 text-right font-medium">No dia</th>
                <th scope="col" className="py-1 text-right font-medium">Acumulado</th>
                <th scope="col" className="py-1 text-right font-medium">{nomeAnt}</th>
              </tr>
            </thead>
            <tbody>
              {dados.filter((p) => p.acum != null).map((p) => (
                <tr key={p.dia} className="border-t border-[var(--border-soft)]">
                  <th scope="row" className="py-1 text-left font-normal">
                    {(p.qtdDia ?? 0) > 0 ? (
                      <button type="button" onClick={() => onDia(p.dia)} className="rounded text-[var(--brand-700)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-700)] dark:text-[var(--brand-300)]" aria-label={`Ver as vendas de ${dd(p.dia)}/${dd(mes)}`}>
                        {dd(p.dia)}/{dd(mes)}
                      </button>
                    ) : (
                      `${dd(p.dia)}/${dd(mes)}`
                    )}
                  </th>
                  <td className={cn("py-1 text-right", margem && (p.noDia ?? 0) < 0 && CLASSE_NEGATIVO)}>{fmt(p.noDia)}</td>
                  <td className={cn("py-1 text-right", margem && (p.acum ?? 0) < 0 && CLASSE_NEGATIVO)}>{fmt(p.acum)}</td>
                  <td className="py-1 text-right text-[var(--text-muted)]">{fmt(p.ant)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </Cartao>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Mês a mês
// ═══════════════════════════════════════════════════════════════════════════

type ModoMes = "qtd" | "margem" | "margemPct";
type Quebra = "nenhuma" | "origem" | "comprador";

/** `hachura`: PJ ganha textura (barra) e traço (linha) — PF × PJ não dependem só da cor. */
type Grupo = { chave: string; rotulo: string; cor: string; hachura?: boolean; m: (p: PontoMensal) => MetricasRecorte };

function gruposDe(quebra: Quebra): Grupo[] {
  if (quebra === "origem")
    return ORDEM_ORIGEM.map((o: OrigemChave) => ({ chave: o, rotulo: ROTULO_ORIGEM_CURTO[o], cor: COR_ORIGEM_GRAFICO[o], m: (p) => p.origem[o] }));
  if (quebra === "comprador")
    return COMPRADORES.map((c) => ({ chave: c, rotulo: ROTULO_COMPRADOR_GRAFICO[c], cor: COR_COMPRADOR_GRAFICO[c], hachura: c === "pj", m: (p) => p.comprador[c] }));
  return [];
}

function valorModo(m: MetricasRecorte, modo: ModoMes): number | null {
  if (modo === "qtd") return m.qtd;
  if (modo === "margem") return m.margem;
  return m.margemPct == null ? null : m.margemPct * 100;
}

function GraficoMesAMes({ serie, diaHoje, onSelecionarMes }: { serie: SerieMensal; diaHoje: number | null; onSelecionarMes: (mes: number) => void }) {
  const [modo, setModo] = useState<ModoMes>("qtd");
  const [quebra, setQuebra] = useState<Quebra>("nenhuma");
  const semAnimacao = useMenosMovimento();
  const grupos = gruposDe(quebra);
  const { ano, meses, media } = serie;

  const dados = meses.map((p) => {
    const linha: Record<string, number | string | boolean | null> = {
      mes: p.mes,
      rotulo: mesCurto(p.mes, ano),
      total: valorModo(p.total, modo),
      parcial: p.parcial,
      selecionado: p.selecionado,
    };
    for (const g of grupos) linha[g.chave] = valorModo(g.m(p), modo);
    return linha;
  });

  const fmtV = (v: number | null) => (v == null ? "—" : modo === "qtd" ? formatInt(v) : modo === "margem" ? formatBRL(v) : fmtFrac(v / 100));
  const fmtEixo = (v: number) => (modo === "qtd" ? formatInt(v) : modo === "margem" ? fmtBRLAbrev(v) : `${formatInt(v)}%`);
  const rotuloMedia = media && media.meses.length > 0 ? `${mesCurto(media.meses[0], ano)}–${mesCurto(media.meses[media.meses.length - 1], ano)}` : "";
  const valorMedia = media == null ? null : modo === "qtd" ? media.qtd : modo === "margem" ? media.margem : null;
  const parcial = meses.find((m) => m.parcial);

  const selecionado = meses.find((m) => m.selecionado);
  const aria = `${ano} mês a mês: ${meses.map((m) => `${mesCurto(m.mes, ano)} ${fmtV(valorModo(m.total, modo))}`).join(", ")}.${valorMedia != null ? ` Média ${rotuloMedia}: ${fmtV(valorMedia)}.` : ""}`;

  const clique = (estado: unknown) => {
    const i = indiceClicado(estado);
    if (i != null && meses[i] && !meses[i].selecionado) onSelecionarMes(meses[i].mes);
  };

  return (
    <Cartao
      idTitulo="titulo-mes-a-mes"
      titulo={`${ano} mês a mês`}
      acoes={
        <>
          <SegmentedToggle opcoes={[{ valor: "qtd", label: "Vendas" }, { valor: "margem", label: "Margem R$" }, { valor: "margemPct", label: "Margem %" }] as const} valor={modo} onChange={setModo} ariaLabel="Medida do mês a mês" />
          <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
            Quebra
            <SegmentedToggle opcoes={[{ valor: "nenhuma", label: "Nenhuma" }, { valor: "origem", label: "Origem" }, { valor: "comprador", label: "Comprador" }] as const} valor={quebra} onChange={setQuebra} ariaLabel="Quebra do mês a mês" />
          </span>
        </>
      }
    >
      {media == null && <p className="mb-2 text-xs text-[var(--text-muted)]">Ainda não há meses fechados em {ano} para comparar.</p>}
      {modo !== "qtd" && <p className="mb-1 text-[11px] text-[var(--text-muted)]">Margens sem consignadas.</p>}
      <div className={CLASSE_VARS_GRAFICO}>
        <div role="img" aria-label={aria} className="h-56 w-full sm:h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={dados} margin={{ top: 16, right: 16, bottom: 0, left: 4 }} onClick={clique} className="cursor-pointer" stackOffset="sign">
              <defs>
                <pattern id="hachura-parcial" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width="6" height="6" fill="var(--c-brand)" fillOpacity={0.45} />
                  <line x1="0" y1="0" x2="0" y2="6" stroke="var(--bg-surface)" strokeWidth="2" />
                </pattern>
                <pattern id="hachura-pj" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width="5" height="5" fill="var(--c-pj)" />
                  <line x1="0" y1="0" x2="0" y2="5" stroke="var(--bg-surface)" strokeWidth="1.5" />
                </pattern>
              </defs>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="rotulo" tick={TICK} tickLine={false} axisLine={{ stroke: "var(--border-base)" }} />
              <YAxis tick={TICK} tickLine={false} axisLine={false} width={modo === "margem" ? 72 : 40} tickFormatter={fmtEixo} />
              {modo !== "qtd" && <ReferenceLine y={0} stroke="var(--border-base)" />}
              {valorMedia != null && quebra === "nenhuma" && (
                <ReferenceLine
                  y={valorMedia}
                  stroke="var(--text-muted)"
                  strokeDasharray="4 3"
                  label={{ value: `Média ${rotuloMedia}: ${fmtV(valorMedia)}`, position: "insideTopRight", fontSize: 11, fill: "var(--text-muted)" }}
                />
              )}
              <Tooltip
                cursor={{ fill: "var(--bg-muted)" }}
                content={({ active, payload }) => {
                  const linha = payload?.[0]?.payload as { mes: number } | undefined;
                  const p = linha ? meses.find((m) => m.mes === linha.mes) : undefined;
                  if (!active || !p) return null;
                  const t = p.total;
                  return (
                    <ChartTooltip titulo={`${nomeMesAnoCapitalizado(p.mes, ano)}${p.parcial && diaHoje ? ` (parcial até ${dd(diaHoje)}/${dd(p.mes)})` : ""}`}>
                      <p>
                        {formatInt(t.qtd)} vendas · Margem {formatBRL(t.margem)} · {fmtFrac(t.margemPct)} · Ticket {formatBRL(t.ticket)}
                      </p>
                      {grupos.map((g) => {
                        const m = g.m(p);
                        if (m.qtd === 0) return null;
                        return (
                          <p key={g.chave} className="flex items-center gap-1.5">
                            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: g.cor }} aria-hidden="true" />
                            {g.rotulo}: {formatInt(m.qtd)} · {formatBRL(m.margem)} · {fmtFrac(m.margemPct)}
                          </p>
                        );
                      })}
                      {!p.selecionado && <p className="pt-1 text-[11px] text-[var(--text-muted)]">Clique para ver este mês</p>}
                    </ChartTooltip>
                  );
                }}
              />
              {modo === "margemPct" ? (
                grupos.length === 0 ? (
                  <Line dataKey="total" name="Margem %" stroke="var(--c-brand)" strokeWidth={2} dot={{ r: 4 }} connectNulls isAnimationActive={!semAnimacao} />
                ) : (
                  grupos.map((g) => (
                    <Line key={g.chave} dataKey={g.chave} name={g.rotulo} stroke={g.cor} strokeWidth={2} strokeDasharray={g.hachura ? "6 3" : undefined} dot={{ r: 4, fill: g.cor }} connectNulls isAnimationActive={!semAnimacao} />
                  ))
                )
              ) : grupos.length === 0 ? (
                <Bar dataKey="total" name={modo === "qtd" ? "Vendas" : "Margem"} radius={[4, 4, 0, 0]} isAnimationActive={!semAnimacao}>
                  {dados.map((d) => {
                    const neg = modo === "margem" && Number(d.total ?? 0) < 0;
                    return (
                      <Cell
                        key={String(d.mes)}
                        fill={d.parcial ? "url(#hachura-parcial)" : neg ? "var(--danger)" : "var(--c-brand)"}
                        fillOpacity={d.selecionado ? 1 : 0.55}
                        stroke={d.parcial ? "var(--c-brand)" : undefined}
                      />
                    );
                  })}
                </Bar>
              ) : (
                grupos.map((g) => (
                  <Bar key={g.chave} dataKey={g.chave} name={g.rotulo} stackId="quebra" fill={g.hachura ? "url(#hachura-pj)" : g.cor} stroke="var(--bg-surface)" strokeWidth={1} isAnimationActive={!semAnimacao}>
                    {dados.map((d) => (
                      <Cell key={String(d.mes)} fillOpacity={d.selecionado ? 1 : 0.6} />
                    ))}
                  </Bar>
                ))
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <Legenda
          itens={[
            ...(grupos.length > 0 ? grupos.map((g) => ({
                  rotulo: g.rotulo,
                  cor: g.cor,
                  forma: modo === "margemPct" ? (g.hachura ? ("tracejada" as const) : ("linha" as const)) : g.hachura ? ("hachura" as const) : ("barra" as const),
                })) : [{ rotulo: modo === "qtd" ? "Vendas" : modo === "margem" ? "Margem R$" : "Margem %", cor: "var(--c-brand)" }]),
            ...(valorMedia != null && quebra === "nenhuma" ? [{ rotulo: `Média ${rotuloMedia} (meses fechados)`, cor: "var(--text-muted)", forma: "tracejada" as const }] : []),
          ]}
        />
        {parcial && diaHoje != null && grupos.length === 0 && modo !== "margemPct" && (
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">
            Barra hachurada = {mesCurto(parcial.mes, ano)} parcial até {dd(diaHoje)}/{dd(parcial.mes)}.
          </p>
        )}
        {selecionado && <p className="sr-only">Mês selecionado: {nomeMesAno(selecionado.mes, ano)}</p>}
      </div>
      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-[var(--text-muted)] hover:text-[var(--text-body)]">Ver números</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full tabular-nums">
            <caption className="sr-only">{ano} mês a mês: vendas, receita, margem e ticket</caption>
            <thead className="text-[var(--text-muted)]">
              <tr>
                <th scope="col" className="py-1 text-left font-medium">Mês</th>
                <th scope="col" className="py-1 text-right font-medium">Vendas</th>
                <th scope="col" className="py-1 text-right font-medium">Receita</th>
                <th scope="col" className="py-1 text-right font-medium">Margem R$</th>
                <th scope="col" className="py-1 text-right font-medium">Margem %</th>
                <th scope="col" className="py-1 text-right font-medium">Ticket</th>
              </tr>
            </thead>
            <tbody>
              {meses.map((p) => (
                <tr key={p.mes} className={cn("border-t border-[var(--border-soft)]", p.selecionado && "font-semibold text-[var(--text-strong)]")}>
                  <th scope="row" className="py-1 text-left font-[inherit]">
                    {p.selecionado ? (
                      nomeMesAnoCapitalizado(p.mes, ano)
                    ) : (
                      <button type="button" onClick={() => onSelecionarMes(p.mes)} className="rounded text-[var(--brand-700)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-700)] dark:text-[var(--brand-300)]">
                        {nomeMesAnoCapitalizado(p.mes, ano)}
                      </button>
                    )}
                    {p.parcial && <span className="ml-1 font-normal text-[var(--text-muted)]">(parcial)</span>}
                  </th>
                  <td className="py-1 text-right">{formatInt(p.total.qtd)}</td>
                  <td className="py-1 text-right">{formatBRL(p.total.receita)}</td>
                  <td className={cn("py-1 text-right", (p.total.margem ?? 0) < 0 && CLASSE_NEGATIVO)}>{formatBRL(p.total.margem)}</td>
                  <td className={cn("py-1 text-right", (p.total.margemPct ?? 0) < 0 && CLASSE_NEGATIVO)}>{fmtFrac(p.total.margemPct)}</td>
                  <td className="py-1 text-right">{formatBRL(p.total.ticket)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </Cartao>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Aba
// ═══════════════════════════════════════════════════════════════════════════

export function AbaEvolucao({
  linhasMes,
  linhasMesAnterior,
  codEmpresa,
  mes,
  ano,
  corte,
  atual,
  anterior,
  hoje,
  estadoAno,
  onRetryAno,
  onFiltrar,
  onSelecionarMes,
}: {
  linhasMes: LinhaVendaMatriz[];
  linhasMesAnterior: LinhaVendaMatriz[];
  codEmpresa: number;
  mes: number;
  ano: number;
  corte: CorteComparacao;
  atual: MetricasRecorte;
  anterior: MetricasRecorte;
  hoje: string;
  estadoAno: EstadoAno;
  onRetryAno: () => void;
  onFiltrar: AoFiltrarVendas;
  onSelecionarMes: (mes: number) => void;
}) {
  const diaria = useMemo(() => serieDiaria({ linhasMes, linhasMesAnterior, mes, ano, corte }), [linhasMes, linhasMesAnterior, mes, ano, corte]);
  const mensal = useMemo(
    () => (estadoAno.status === "ok" ? serieMensal({ linhasAno: estadoAno.linhasAno, codEmpresa, ano, ateMes: mes, hoje }) : null),
    [estadoAno, codEmpresa, ano, mes, hoje],
  );

  return (
    <div className="space-y-4">
      {linhasMes.length === 0 ? (
        <Cartao idTitulo="titulo-ritmo" titulo="Ritmo do mês">
          <p className="text-sm text-[var(--text-muted)]">Nenhuma venda em {nomeMesAno(mes, ano)}</p>
        </Cartao>
      ) : (
        <GraficoRitmoDiario serie={diaria} mes={mes} ano={ano} corte={corte} atual={atual} anterior={anterior} onDia={(d) => onFiltrar({ dia: d })} />
      )}
      {estadoAno.status === "erro" ? (
        <Cartao idTitulo="titulo-mes-a-mes" titulo={`${ano} mês a mês`}>
          <ErroNoCartao mensagem={`Não consegui carregar as vendas de ${ano}`} detalhe={estadoAno.mensagem} onRetry={onRetryAno} />
        </Cartao>
      ) : mensal == null ? (
        <Cartao idTitulo="titulo-mes-a-mes" titulo={`${ano} mês a mês`}>
          <div aria-busy="true" className="h-72 space-y-3">
            <p className="sr-only" role="status">Carregando vendas de {ano}…</p>
            <SkeletonBar w="30%" />
            <SkeletonBar h="h-60" delay={80} />
          </div>
        </Cartao>
      ) : (
        <GraficoMesAMes serie={mensal} diaHoje={corte.diaHoje} onSelecionarMes={onSelecionarMes} />
      )}
    </div>
  );
}
