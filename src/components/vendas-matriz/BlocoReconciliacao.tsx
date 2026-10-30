import { Info } from "lucide-react";
import type { MetricasRecorte, ResumoPeriodo } from "@/lib/export/vendas-matriz/resumir-painel";
import { formatBRL, formatBRLCents, formatInt, cn } from "@/lib/utils";
import { InfoTooltip } from "./BlocoKpis";
import { fmtMargemPct, fmtPct, notaConsignadas } from "./formato";

function CardCompacto({ titulo, tooltip, m, total }: { titulo: string; tooltip: string; m: MetricasRecorte; total: number }) {
  const nota = notaConsignadas(m.qtdConsignadas);
  return (
    <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-muted)] p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 text-sm text-[var(--text-body)]">
          <span className="h-2.5 w-2.5 rounded-full border-2 border-slate-400" aria-hidden="true" />
          {titulo}
          <InfoTooltip texto={tooltip} rotulo={titulo} />
        </span>
        <span className="text-base font-semibold tabular-nums text-[var(--text-strong)]">
          {formatInt(m.qtd)}{" "}
          <span className="text-xs font-normal text-[var(--text-muted)]">
            venda{m.qtd === 1 ? "" : "s"} · {fmtPct(total > 0 ? (m.qtd / total) * 100 : 0)}
          </span>
        </span>
      </div>
      <p className="mt-1 text-xs tabular-nums text-[var(--text-muted)]">
        Margem{" "}
        <span className={cn("font-semibold", (m.margem ?? 0) < 0 ? "text-red-700 dark:text-red-400" : "text-[var(--text-body)]")}>
          {formatBRL(m.margem)}
        </span>{" "}
        ·{" "}
        <span className={cn("font-semibold", (m.margemPct ?? 0) < 0 ? "text-red-700 dark:text-red-400" : "text-[var(--text-body)]")}>
          {fmtMargemPct(m.margemPct)}
        </span>
        {nota && <span> · {nota}</span>}
      </p>
    </div>
  );
}

/**
 * Bloco 4 — Auto Avaliar + Não informado + nota de reconciliação (sempre visível):
 * Total = PF + PJ + Auto Avaliar + Não informado, em quantidade e em margem.
 */
export function BlocoReconciliacao({ resumo }: { resumo: ResumoPeriodo }) {
  const total = resumo.total.qtd;
  const aa = resumo.autoAvaliar;
  const ni = resumo.naoInformado;
  const grupos = [
    { m: resumo.pf.metricas, rotulo: "pessoa física" },
    { m: resumo.pj.metricas, rotulo: "pessoa jurídica" },
    { m: aa, rotulo: "Auto Avaliar" },
    { m: ni, rotulo: "não informado" },
  ];
  const parcelasQtd = grupos.filter((g) => g.m.qtd > 0);
  // Margem sem consignado; parcelas sem margem (null) ou zeradas somem.
  const parcelasMargem = grupos.filter((g) => g.m.margem != null && Math.round(g.m.margem * 100) !== 0);

  return (
    <section aria-label="Outros canais e reconciliação do total" className="space-y-3">
      {(aa.qtd > 0 || ni.qtd > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {aa.qtd > 0 && (
            <CardCompacto
              titulo="Auto Avaliar (leilão)"
              tooltip="Carros vendidos por leilão na plataforma Auto Avaliar, sem vendedor da loja. Contados como canal próprio, igual ao relatório Excel (aba Resumo). Margem sem consignados."
              m={aa}
              total={total}
            />
          )}
          {ni.qtd > 0 && (
            <CardCompacto
              titulo="Não informado"
              tooltip="Vendas cujo cliente não tem tipo (CPF ou CNPJ) preenchido nos dados importados do NBS. Aparecem aqui pra que o total (vendas e margem) feche. Margem sem consignados."
              m={ni}
              total={total}
            />
          )}
        </div>
      )}
      <div className="flex items-start gap-1.5 text-xs tabular-nums text-[var(--text-muted)]">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <div className="space-y-0.5">
          <p>
            Total do mês: {formatInt(total)} = {parcelasQtd.map((p) => `${formatInt(p.m.qtd)} ${p.rotulo}`).join(" + ")}
          </p>
          {resumo.total.margem != null && parcelasMargem.length > 0 && (
            <p>
              {/* Centavos aqui de propósito: arredondar cada parcela pro real faria a soma "não fechar" por R$ 1–2. */}
              Margem: {formatBRLCents(resumo.total.margem)} total ={" "}
              {parcelasMargem
                .map((p, i) => {
                  const v = p.m.margem ?? 0;
                  // "a − R$ 154.840,66 b" em vez de "a + -R$ 154.840,66 b"
                  if (i === 0) return `${formatBRLCents(v)} ${p.rotulo}`;
                  return `${v < 0 ? "−" : "+"} ${formatBRLCents(Math.abs(v))} ${p.rotulo}`;
                })
                .join(" ")}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
