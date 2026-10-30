"use client";

import { useState } from "react";
import { ORDEM_ORIGEM, participacaoMargem, type MetricasRecorte, type OrigemChave } from "@/lib/export/vendas-matriz/resumir-painel";
import { SegmentedToggle } from "@/components/ui/SegmentedToggle";
import { formatBRL, formatInt, cn } from "@/lib/utils";
import { BarraCategorica, ROTULO_ORIGEM } from "./Barras";
import { InfoTooltip } from "./BlocoKpis";
import { fmtMargemPct, fmtPct, notaConsignadas } from "./formato";

type Modo = "qtd" | "margem" | "margemPct";

const OPCOES = [
  { valor: "qtd", label: "Qtd" },
  { valor: "margem", label: "Margem R$" },
  { valor: "margemPct", label: "Margem %" },
] as const;

function vendas(n: number): string {
  return `${formatInt(n)} venda${n === 1 ? "" : "s"}`;
}

function detalheDe(m: MetricasRecorte): string {
  const nota = notaConsignadas(m.qtdConsignadas);
  return `${vendas(m.qtd)} · margem ${formatBRL(m.margem)} · ${fmtMargemPct(m.margemPct)}${nota ? ` · ${nota}` : ""}`;
}

/** Bloco 2 — origem do estoque vendido em 3 parcelas (mesma regra das abas 2/4 do Excel). */
export function BlocoOrigem({ origem, total }: { origem: Record<OrigemChave, MetricasRecorte>; total: MetricasRecorte }) {
  const [modo, setModo] = useState<Modo>("qtd");

  const visiveis = ORDEM_ORIGEM.filter((k) => k !== "naoIdentificada" || origem[k].qtd > 0);
  // Sinais iguais → participação no total ("do prejuízo" se negativo); mistos → sem participação.
  const part = participacaoMargem(visiveis.map((k) => origem[k].margem));
  const sufixoPart = part.sinal === "negativo" ? " do prejuízo" : "";
  const maxAbsPct = visiveis.reduce((s, k) => Math.max(s, Math.abs(origem[k].margemPct ?? 0)), 0);

  return (
    <section
      aria-labelledby="titulo-origem"
      className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-5 shadow-[var(--shadow-sm)]"
    >
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1.5">
          <h2 id="titulo-origem" className="text-sm font-semibold text-[var(--text-strong)]">
            Origem do estoque
          </h2>
          <InfoTooltip
            rotulo="Origem do estoque"
            texto="De onde veio o carro vendido: do estoque da própria Ford Aeroporto ou repassado de outra loja do Grupo Navesa. Margens sem consignados."
          />
        </div>
        <SegmentedToggle opcoes={OPCOES} valor={modo} onChange={setModo} ariaLabel="Medida da origem do estoque" />
      </header>

      <div className="mt-4 space-y-3">
        {visiveis.map((k) => {
          const m = origem[k];
          const rotulo = ROTULO_ORIGEM[k];
          const extra =
            k === "naoIdentificada" ? (
              <InfoTooltip
                rotulo={rotulo}
                texto="Vendas cujo chassi não tem registro de entrada no estoque do grupo. Entram no total, mas não dá pra atribuir a uma loja."
              />
            ) : undefined;

          let largura = 0;
          let valor = "—";
          let participacao: string | undefined;
          let negativo = false;
          let aria = "";

          if (modo === "qtd") {
            const pct = total.qtd > 0 ? (m.qtd / total.qtd) * 100 : 0;
            largura = pct;
            valor = formatInt(m.qtd);
            participacao = fmtPct(pct);
            aria = `${rotulo}: ${vendas(m.qtd)}, ${fmtPct(pct)}`;
          } else if (modo === "margem") {
            const i = visiveis.indexOf(k);
            const pct = part.participacoes[i];
            largura = part.larguras[i];
            valor = formatBRL(m.margem);
            participacao = pct != null ? `${fmtPct(pct)}${sufixoPart}` : undefined;
            negativo = (m.margem ?? 0) < 0;
            aria = `${rotulo}: margem ${formatBRL(m.margem)}${participacao ? `, ${participacao}${sufixoPart ? "" : " da margem"}` : ""}`;
          } else {
            largura = m.margemPct != null && maxAbsPct > 0 ? (Math.abs(m.margemPct) / maxAbsPct) * 100 : 0;
            valor = fmtMargemPct(m.margemPct);
            negativo = (m.margemPct ?? 0) < 0;
            aria = `${rotulo}: margem ${fmtMargemPct(m.margemPct)}`;
          }

          return (
            <BarraCategorica
              key={k}
              rotulo={rotulo}
              extraRotulo={extra}
              origem={k}
              larguraPct={largura}
              valor={valor}
              participacao={participacao}
              negativo={negativo}
              ariaLabel={aria}
              detalhe={detalheDe(m)}
            />
          );
        })}

        {modo !== "margemPct" && (
          <div className="flex items-center justify-between gap-3 border-t border-[var(--border-soft)] pt-3 text-sm">
            <span className="font-semibold text-[var(--text-strong)]">
              Total
              {modo === "qtd" && notaConsignadas(total.qtdConsignadas) && (
                <span className="ml-2 text-[11px] font-normal text-[var(--text-muted)]">{notaConsignadas(total.qtdConsignadas)}</span>
              )}
            </span>
            <span
              className={cn(
                "tabular-nums font-bold",
                modo === "margem" && (total.margem ?? 0) < 0 ? "text-red-700 dark:text-red-400" : "text-[var(--text-strong)]",
              )}
            >
              {modo === "qtd" ? formatInt(total.qtd) : formatBRL(total.margem)}
              <span className="ml-2 inline-block min-w-[3.5rem] text-right text-xs font-normal text-[var(--text-muted)]">
                {modo === "qtd" ? "100%" : part.sinal === "positivo" || part.sinal === "negativo" ? `100%${sufixoPart}` : ""}
              </span>
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
