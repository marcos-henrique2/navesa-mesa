"use client";

import { useMemo } from "react";
import { useInventory, nomeOuCodigo } from "@/lib/store/inventory";
import { agregarMargem } from "@/lib/analytics/margem";
import { cn } from "@/lib/utils";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";
import type { VendaParsed } from "@/lib/parsers/nbs-vendas-xlsx";

type Tone = "good" | "warn" | "bad" | "neutral";

type LojaStats = {
  loja: string;
  estoqueQt: number;
  estoqueValor: number;
  diasPatioMedio: number;
  diasPatioTone: Tone;
  margemPct: number;
  margemTone: Tone;
  /** Carros em estoque há mais de 60 dias com aquisição > R$ 80k — proxy de capital travado. */
  subprecQt: number;
  subprecTone: Tone;
};

export function HeatmapLojas() {
  const { veiculos, vendas, custosPorPlaca, lojas } = useInventory();

  const stats = useMemo<LojaStats[]>(() => {
    // Chave canônica: cod_empresa (estável entre vendas e veículos).
    // Veículos não têm empresa_nome no Supabase — só vendas têm.
    // Mapa cod_empresa → nome derivado de vendas (fallback pra "Loja X" se desconhecido).
    const nomePorCod = new Map<number, string>();
    for (const v of vendas) {
      if (typeof v.cod_empresa === "number" && v.empresa_nome && !nomePorCod.has(v.cod_empresa)) {
        nomePorCod.set(v.cod_empresa, v.empresa_nome);
      }
    }

    const map = new Map<number, { veiculos: VeiculoParsed[]; vendas: VendaParsed[] }>();
    for (const v of veiculos) {
      if (typeof v.cod_empresa !== "number") continue;
      const cur = map.get(v.cod_empresa) ?? { veiculos: [], vendas: [] };
      cur.veiculos.push(v);
      map.set(v.cod_empresa, cur);
    }
    for (const v of vendas) {
      if (typeof v.cod_empresa !== "number") continue;
      const cur = map.get(v.cod_empresa) ?? { veiculos: [], vendas: [] };
      cur.vendas.push(v);
      map.set(v.cod_empresa, cur);
    }

    const result: LojaStats[] = [];
    for (const [cod, grupo] of map.entries()) {
      const loja = nomeOuCodigo(lojas, cod) || nomePorCod.get(cod) || `Loja ${cod}`;
      const estoqueQt = grupo.veiculos.length;
      const estoqueValor = grupo.veiculos.reduce((s, v) => s + (v.valor_aquisicao ?? 0), 0);

      const diasArr = grupo.veiculos.map((v) => v.dias_patio ?? 0).filter((d) => d > 0);
      const diasPatioMedio = diasArr.length > 0 ? diasArr.reduce((a, b) => a + b, 0) / diasArr.length : 0;
      const diasPatioTone: Tone =
        diasPatioMedio === 0 ? "neutral" :
        diasPatioMedio < 45 ? "good" :
        diasPatioMedio < 75 ? "warn" : "bad";

      const aggVendas = agregarMargem(grupo.vendas, custosPorPlaca);
      const margemPct = aggVendas.margemPct;
      const margemTone: Tone =
        aggVendas.qt === 0 ? "neutral" :
        margemPct > 5 ? "good" :
        margemPct > 0 ? "warn" : "bad";

      // proxy de subprec: estoque parado caro
      const subprecQt = grupo.veiculos.filter((v) =>
        (v.dias_patio ?? 0) > 60 && (v.valor_aquisicao ?? 0) > 80000
      ).length;
      const subprecPct = estoqueQt > 0 ? (subprecQt / estoqueQt) * 100 : 0;
      const subprecTone: Tone =
        estoqueQt === 0 ? "neutral" :
        subprecPct < 10 ? "good" :
        subprecPct < 25 ? "warn" : "bad";

      result.push({
        loja,
        estoqueQt,
        estoqueValor,
        diasPatioMedio,
        diasPatioTone,
        margemPct,
        margemTone,
        subprecQt,
        subprecTone,
      });
    }

    return result.sort((a, b) => b.estoqueValor - a.estoqueValor);
  }, [veiculos, vendas, custosPorPlaca]);

  if (stats.length === 0) return null;

  return (
    <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-5">
      <h3 className="text-sm font-semibold text-[var(--text-strong)]">Visão por loja</h3>
      <p className="mt-0.5 text-xs text-[var(--text-muted)]">Quanto mais vermelho, mais atenção precisa</p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border-soft)] text-left text-xs font-medium text-[var(--text-muted)]">
              <th className="pb-2 pr-3 font-normal">Loja</th>
              <th className="pb-2 px-3 font-normal text-right">Estoque</th>
              <th className="pb-2 px-3 font-normal text-center">Dias pátio</th>
              <th className="pb-2 px-3 font-normal text-center">Margem</th>
              <th className="pb-2 px-3 font-normal text-center">Subprec</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => (
              <tr key={s.loja} className="border-b border-[var(--border-soft)] last:border-0">
                <td className="py-2 pr-3 text-[var(--text-strong)]">{s.loja}</td>
                <td className="py-2 px-3 text-right text-[var(--text-body)]">{s.estoqueQt} carros</td>
                <Cell tone={s.diasPatioTone} label={s.diasPatioMedio === 0 ? "—" : `${Math.round(s.diasPatioMedio)}d`} />
                <Cell tone={s.margemTone} label={s.margemTone === "neutral" ? "—" : `${s.margemPct.toFixed(1)}%`} />
                <Cell tone={s.subprecTone} label={s.estoqueQt === 0 ? "—" : `${s.subprecQt}`} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-[var(--text-muted)]">
        <Legenda tone="good" label="OK" />
        <Legenda tone="warn" label="Atenção" />
        <Legenda tone="bad" label="Crítico" />
        <Legenda tone="neutral" label="Sem dados" />
      </div>
    </div>
  );
}

function Cell({ tone, label }: { tone: Tone; label: string }) {
  return (
    <td className="py-2 px-3 text-center">
      <span className={cn(
        "inline-flex min-w-[60px] items-center justify-center rounded-md px-2 py-0.5 text-xs font-medium",
        tone === "good" && "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
        tone === "warn" && "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
        tone === "bad" && "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
        tone === "neutral" && "bg-[var(--bg-muted)] text-[var(--text-muted)]",
      )}>
        {label}
      </span>
    </td>
  );
}

function Legenda({ tone, label }: { tone: Tone; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn(
        "h-2.5 w-2.5 rounded-full",
        tone === "good" && "bg-emerald-500",
        tone === "warn" && "bg-amber-500",
        tone === "bad" && "bg-red-500",
        tone === "neutral" && "bg-[var(--text-subtle)]",
      )} />
      {label}
    </span>
  );
}
