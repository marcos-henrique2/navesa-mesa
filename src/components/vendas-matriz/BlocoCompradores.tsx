import { calcularDelta, ORDEM_ORIGEM, type RecorteComprador } from "@/lib/export/vendas-matriz/resumir-painel";
import { formatBRL, formatInt, cn } from "@/lib/utils";
import { BarraEmpilhada100, PontoOrigem, ROTULO_ORIGEM_CURTO } from "./Barras";
import { InfoTooltip } from "./BlocoKpis";
import { DeltaMoM, fmtMargemPct, fmtPct, notaConsignadas, type ContextoComparacao } from "./formato";
import { LinkVerVendas, type AoFiltrarVendas } from "./comum";

type Identidade = "pf" | "pj";

const CONFIG: Record<Identidade, { titulo: string; tooltip: string; borda: string; ponto: string }> = {
  pf: {
    titulo: "Pessoa física",
    tooltip:
      "Compradores com CPF, conforme cadastro do cliente no NBS. Não inclui vendas pelo Auto Avaliar. Margens sem consignados.",
    borda: "border-t-blue-500",
    ponto: "bg-blue-500",
  },
  pj: {
    titulo: "Pessoa jurídica",
    tooltip:
      "Compradores com CNPJ (empresas e lojistas), conforme cadastro do cliente no NBS. Não inclui vendas pelo Auto Avaliar. Margens sem consignados.",
    borda: "border-t-purple-500",
    ponto: "bg-purple-500",
  },
};

function CardComprador({
  tipo,
  atual,
  anterior,
  totalMes,
  ctx,
  onFiltrar,
}: {
  tipo: Identidade;
  atual: RecorteComprador;
  anterior: RecorteComprador;
  totalMes: number;
  ctx: ContextoComparacao;
  onFiltrar?: AoFiltrarVendas;
}) {
  const cfg = CONFIG[tipo];
  const m = atual.metricas;
  const ant = (v: number | null): number | null => (ctx.semBaseMes ? null : v);
  const motivo = ctx.semBaseMes
    ? `Não houve vendas em ${ctx.recorteAnterior}`
    : `Sem margem calculável para ${cfg.titulo.toLowerCase()} em ${ctx.recorteAnterior}`;
  const nota = notaConsignadas(m.qtdConsignadas);
  const pctTotal = totalMes > 0 ? (m.qtd / totalMes) * 100 : 0;
  const origens = ORDEM_ORIGEM.filter((k) => k !== "naoIdentificada" || atual.origem[k].qtd > 0);
  const idTitulo = `titulo-comprador-${tipo}`;

  return (
    <section
      aria-labelledby={idTitulo}
      className={cn("rounded-xl border border-t-[3px] border-[var(--border-soft)] bg-[var(--bg-surface)] p-5 shadow-[var(--shadow-sm)]", cfg.borda)}
    >
      <header className="flex items-center gap-2">
        <span className={cn("h-2.5 w-2.5 rounded-full", cfg.ponto)} aria-hidden="true" />
        <h2 id={idTitulo} className="text-sm font-semibold text-[var(--text-strong)]">
          {cfg.titulo}
        </h2>
        <InfoTooltip texto={cfg.tooltip} rotulo={cfg.titulo} />
      </header>

      <p className="mt-3 flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums text-[var(--text-strong)]">{formatInt(m.qtd)}</span>
        <span className="text-xs tabular-nums text-[var(--text-muted)]">
          venda{m.qtd === 1 ? "" : "s"} · {fmtPct(pctTotal)} do total
        </span>
      </p>
      {nota && <p className="text-[11px] text-[var(--text-muted)]">{nota}</p>}

      {m.qtd === 0 ? (
        <p className="mt-3 text-xs text-[var(--text-muted)]">Nenhuma venda neste mês.</p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">Margem</p>
              <p className={cn("mt-0.5 text-base font-semibold tabular-nums", (m.margem ?? 0) < 0 ? "text-red-700 dark:text-red-400" : "text-[var(--text-strong)]")}>
                {formatBRL(m.margem)}
              </p>
              <DeltaMoM delta={calcularDelta(m.margem, ant(anterior.metricas.margem), "valor")} formato="money" motivoSemBase={motivo} />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">Margem %</p>
              <p className={cn("mt-0.5 text-base font-semibold tabular-nums", (m.margemPct ?? 0) < 0 ? "text-red-700 dark:text-red-400" : "text-[var(--text-strong)]")}>
                {fmtMargemPct(m.margemPct)}
              </p>
              <DeltaMoM delta={calcularDelta(m.margemPct, ant(anterior.metricas.margemPct), "pontos")} motivoSemBase={motivo} />
            </div>
          </div>
          {m.qtdComMargem === 0 && (
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">Todas as vendas deste grupo são consignadas — sem margem a calcular</p>
          )}

          <div className="mt-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">De onde veio</p>
            <div className="mt-2">
              <BarraEmpilhada100
                segmentos={origens.map((k) => ({ origem: k, valor: atual.origem[k].qtd }))}
                ariaLabel={origens.map((k) => `${ROTULO_ORIGEM_CURTO[k]}: ${formatInt(atual.origem[k].qtd)}`).join(", ")}
              />
            </div>
            <ul className="mt-2 space-y-1">
              {origens.map((k) => {
                const o = atual.origem[k];
                return (
                  <li key={k} className="flex items-center gap-2 text-xs tabular-nums text-[var(--text-body)]">
                    <PontoOrigem origem={k} />
                    <span className="font-medium">{ROTULO_ORIGEM_CURTO[k]}</span>
                    <span className="text-[var(--text-muted)]">
                      {formatInt(o.qtd)} ·{" "}
                      <span className={cn((o.margem ?? 0) < 0 && "text-red-700 dark:text-red-400")}>{formatBRL(o.margem)}</span> ·{" "}
                      <span className={cn((o.margemPct ?? 0) < 0 && "text-red-700 dark:text-red-400")}>{fmtMargemPct(o.margemPct)}</span>
                    </span>
                    <LinkVerVendas
                      qtd={o.qtd}
                      descricao={`para ${cfg.titulo.toLowerCase()}, origem ${ROTULO_ORIGEM_CURTO[k].toLowerCase()}`}
                      filtro={{ comprador: [tipo], origem: k }}
                      onFiltrar={onFiltrar}
                      rotulo="Ver"
                      className="ml-auto"
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
      <div className="mt-3 border-t border-[var(--border-soft)] pt-2">
        <LinkVerVendas qtd={m.qtd} descricao={`para ${cfg.titulo.toLowerCase()}`} filtro={{ comprador: [tipo] }} onFiltrar={onFiltrar} />
      </div>
    </section>
  );
}

/** Bloco 3 — PF × PJ por `cliente_tipo` (Auto Avaliar e consignado fora das margens). */
export function BlocoCompradores({
  pf,
  pj,
  pfAnterior,
  pjAnterior,
  totalMes,
  ctx,
  onFiltrar,
}: {
  pf: RecorteComprador;
  pj: RecorteComprador;
  pfAnterior: RecorteComprador;
  pjAnterior: RecorteComprador;
  totalMes: number;
  ctx: ContextoComparacao;
  onFiltrar?: AoFiltrarVendas;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <CardComprador tipo="pf" atual={pf} anterior={pfAnterior} totalMes={totalMes} ctx={ctx} onFiltrar={onFiltrar} />
      <CardComprador tipo="pj" atual={pj} anterior={pjAnterior} totalMes={totalMes} ctx={ctx} onFiltrar={onFiltrar} />
    </div>
  );
}
