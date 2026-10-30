"use client";

import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ColunaMargem } from "@/lib/export/vendas-matriz/visoes-margens";
import { formatBRL, formatInt } from "@/lib/utils";
import { fmtBRLAbrev, fmtFrac } from "./comum";
import { CLASSE_VARS_GRAFICO, ChartTooltip, GRID, Legenda, TICK, useMenosMovimento } from "./graficos-comum";

type Passo = {
  rotulo: string;
  /** Rótulo com cobertura ("Impostos (34 de 112 lançados)"). */
  detalhe: string;
  valor: number;
  faixa: [number, number];
  tipo: "subida" | "desconto" | "resultado";
};

/** Cascata Venda → −Custo → Lucro bruto → −custos → Margem (mesmos números da coluna). */
export function passosCascata(c: ColunaMargem): Passo[] {
  const m = c.metricas;
  const n = c.cobertura.total;
  const cob = (rot: string, lancados: number) => (lancados < n ? `${rot} (${formatInt(lancados)} de ${formatInt(n)} lançados)` : rot);
  const passos: Passo[] = [];
  let nivel = m.valorVendaTotal;
  passos.push({ rotulo: "Venda", detalhe: "Venda", valor: m.valorVendaTotal, faixa: [0, nivel], tipo: "subida" });
  const desconto = (rotulo: string, detalhe: string, v: number) => {
    const novo = nivel - v;
    passos.push({ rotulo, detalhe, valor: -v, faixa: [Math.min(nivel, novo), Math.max(nivel, novo)], tipo: "desconto" });
    nivel = novo;
  };
  desconto("Custo", c.cobertura.semNfEntrada > 0 ? `Custo real (${formatInt(n - c.cobertura.semNfEntrada)} de ${formatInt(n)} com NF)` : "Custo real", m.custoRealTotal);
  // Lucro bruto do Excel ignora vendas sem NF (custo vazio), então o nível pode não "fechar"
  // com Venda − Custo: o resultado usa SEMPRE o número da planilha.
  nivel = m.lucroBrutoTotal;
  passos.push({ rotulo: "Lucro bruto", detalhe: "Lucro bruto", valor: m.lucroBrutoTotal, faixa: [Math.min(0, nivel), Math.max(0, nivel)], tipo: "resultado" });
  desconto("Desp.", cob("Despesas gerais", c.cobertura.porCusto.despesaGeral), m.despesaGeralTotal);
  desconto("F Plan", cob("F Plan", c.cobertura.porCusto.forplan), m.forplanTotal);
  desconto("Impostos", cob("Impostos", c.cobertura.porCusto.impostos), m.impostosTotal);
  desconto("Comissão", cob("Comissão", c.cobertura.porCusto.comissao), m.comissaoTotal);
  desconto("ADM", cob("ADM", c.cobertura.porCusto.adm), m.admTotal);
  nivel = m.margemLiquidaTotal;
  passos.push({ rotulo: "Margem", detalhe: "Margem líquida", valor: nivel, faixa: [Math.min(0, nivel), Math.max(0, nivel)], tipo: "resultado" });
  return passos;
}

function cor(p: Passo): string {
  if (p.tipo === "subida") return "var(--c-brand)";
  if (p.tipo === "desconto") return "var(--c-desconto)";
  return p.valor < 0 ? "var(--danger)" : "var(--c-resultado)";
}

export function CascataMargem({ coluna }: { coluna: ColunaMargem }) {
  const semAnimacao = useMenosMovimento();
  const passos = passosCascata(coluna);
  const venda = coluna.metricas.valorVendaTotal;
  const pct = (v: number) => (venda > 0 ? ` (${fmtFrac(v / venda)} da venda)` : "");
  const margem = coluna.metricas.margemLiquidaTotal;
  const aria = `Cascata da margem — ${coluna.titulo}: venda ${formatBRL(venda)}, lucro bruto ${formatBRL(coluna.metricas.lucroBrutoTotal)}, margem líquida ${formatBRL(margem)}${pct(margem)}.`;

  return (
    <div className={CLASSE_VARS_GRAFICO}>
      <div role="img" aria-label={aria} className="h-56 w-full sm:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={passos} margin={{ top: 8, right: 8, bottom: 0, left: 8 }} barCategoryGap="18%">
            <CartesianGrid {...GRID} />
            <XAxis dataKey="rotulo" tick={TICK} tickLine={false} axisLine={{ stroke: "var(--border-base)" }} interval={0} />
            <YAxis tick={TICK} tickLine={false} axisLine={false} tickFormatter={fmtBRLAbrev} width={72} />
            <ReferenceLine y={0} stroke="var(--border-base)" />
            <Tooltip
              cursor={{ fill: "var(--bg-muted)" }}
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as Passo | undefined;
                if (!active || !p) return null;
                const sinal = p.valor < 0 ? "−" : "";
                return (
                  <ChartTooltip>
                    <p>
                      {p.detalhe}: {sinal}
                      {formatBRL(Math.abs(p.valor))}
                      {pct(Math.abs(p.valor))}
                    </p>
                  </ChartTooltip>
                );
              }}
            />
            <Bar dataKey="faixa" radius={[4, 4, 4, 4]} isAnimationActive={!semAnimacao} stroke="var(--bg-surface)" strokeWidth={2}>
              {passos.map((p) => (
                <Cell key={p.rotulo} fill={cor(p)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <Legenda
        itens={[
          { rotulo: "Venda", cor: "var(--c-brand)" },
          { rotulo: "Descontos (custo e despesas)", cor: "var(--c-desconto)" },
          { rotulo: margem < 0 ? "Resultado negativo" : "Resultado", cor: margem < 0 ? "var(--danger)" : "var(--c-resultado)" },
        ]}
      />
    </div>
  );
}
