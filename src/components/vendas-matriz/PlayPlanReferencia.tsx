import { FileText } from "lucide-react";
import {
  PLAY_PLAN_CLIENTE_FINAL,
  PLAY_PLAN_FATURADOS_LOJA,
  type TabelaPlayPlan,
} from "@/lib/export/vendas-matriz/dados-estaticos-play-plan";
import { formatBRL } from "@/lib/utils";

/**
 * Aba Play Plan — tabela de prêmio do vendedor influencer, REFERÊNCIA FIXA (mesmos dados da
 * aba 9 do Excel, `dados-estaticos-play-plan.ts`). Sem "posição do mês": falta definir qual
 * contagem alimenta cada tabela (decisão de produto pendente).
 */
function Tabela({ titulo, tabela }: { titulo: string; tabela: TabelaPlayPlan }) {
  const id = `play-plan-${titulo.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] p-4">
      <h3 id={id} className="text-sm font-semibold text-[var(--text-strong)]">
        {titulo}
      </h3>
      <dl className="mt-2 space-y-0.5 text-xs text-[var(--text-body)]">
        <div className="flex justify-between gap-3">
          <dt>Salário fixo</dt>
          <dd className="font-semibold tabular-nums">{formatBRL(tabela.salarioFixo)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Prêmio</dt>
          <dd>Fixo, sem DSR · variável pela tabela</dd>
        </div>
      </dl>
      <table className="mt-3 w-full text-sm tabular-nums">
        <caption className="sr-only">Prêmio por faixa — {titulo}</caption>
        <thead className="border-b border-[var(--border-soft)] text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
          <tr>
            <th scope="col" className="py-1.5 text-left font-semibold">
              Faixa (carros)
            </th>
            <th scope="col" className="py-1.5 text-right font-semibold">
              Prêmio
            </th>
          </tr>
        </thead>
        <tbody>
          {tabela.faixas.map((f) => (
            <tr key={f.faixa} className="border-b border-[var(--border-soft)] last:border-0">
              <th scope="row" className="py-1.5 text-left font-normal text-[var(--text-body)]">
                {f.faixa}
              </th>
              <td className="py-1.5 text-right font-medium text-[var(--text-strong)]">{f.premio === 0 ? "—" : formatBRL(f.premio)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function PlayPlanReferencia() {
  return (
    <section aria-labelledby="titulo-play-plan" className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-4 shadow-[var(--shadow-sm)] sm:p-5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="titulo-play-plan" className="text-sm font-semibold text-[var(--text-strong)]">
          Play Plan · vendedor influencer
        </h2>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--bg-muted)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--text-muted)]">
          <FileText className="h-3.5 w-3.5" aria-hidden="true" /> Tabela de referência · fixa
        </span>
      </header>
      <p className="mt-2 text-xs text-[var(--text-muted)]">
        Regra de prêmio transcrita do Excel (agosto/2026). Não é calculada a partir das vendas; muda só quando a tabela for atualizada no sistema.
      </p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Tabela titulo="Cliente final" tabela={PLAY_PLAN_CLIENTE_FINAL} />
        <Tabela titulo="Total faturados na loja" tabela={PLAY_PLAN_FATURADOS_LOJA} />
      </div>
    </section>
  );
}
