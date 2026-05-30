"use client";

import { useMemo, useState } from "react";
import { BarChart3 } from "lucide-react";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";
import { nomeOuCodigo, type LojaInfo } from "@/lib/store/inventory";
import { classificarPatio } from "@/lib/inventory/status";
import { formatBRL, formatInt, cn } from "@/lib/utils";

type Dim = "marca" | "loja" | "cor" | "combustivel" | "patio" | "situacao";

const LABELS: Record<Dim, string> = {
  marca: "Marca",
  loja: "Loja",
  cor: "Cor",
  combustivel: "Combustível",
  patio: "Pátio",
  situacao: "Situação",
};

function dimKey(v: VeiculoParsed, dim: Dim, lojas: Record<number, LojaInfo>): string {
  switch (dim) {
    case "marca": return v.marca ?? "(sem marca)";
    case "loja": return nomeOuCodigo(lojas, v.cod_empresa);
    case "cor": return v.cor_externa ?? "(sem cor)";
    case "combustivel": return v.combustivel ?? "(sem comb.)";
    case "patio": return v.patio.trim();
    case "situacao": return v.descricao_situacao ?? "(sem situação)";
  }
}

type Props = {
  veiculos: VeiculoParsed[];
  lojas: Record<number, LojaInfo>;
};

export function ResumoPorDimensao({ veiculos, lojas }: Props) {
  const [dim, setDim] = useState<Dim>("marca");

  const agregado = useMemo(() => {
    const map = new Map<string, { qt: number; valor: number; qtPrep: number }>();
    let totalValor = 0;
    let totalQt = 0;

    for (const v of veiculos) {
      const key = dimKey(v, dim, lojas);
      const custo = v.valor_aquisicao ?? 0; // custo de fábrica (capital travado)
      const isPrep = classificarPatio(v.patio) === "preparacao";
      const existing = map.get(key) ?? { qt: 0, valor: 0, qtPrep: 0 };
      existing.qt++;
      existing.valor += custo;
      if (isPrep) existing.qtPrep++;
      map.set(key, existing);
      totalValor += custo;
      totalQt++;
    }

    return {
      linhas: [...map.entries()]
        .map(([key, v]) => ({
          dimensao: key,
          qt: v.qt,
          valor: v.valor,
          qtPrep: v.qtPrep,
          pct: totalValor > 0 ? (v.valor / totalValor) * 100 : 0,
        }))
        .sort((a, b) => b.valor - a.valor),
      totalValor,
      totalQt,
    };
  }, [veiculos, dim, lojas]);

  return (
    <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <header className="flex flex-wrap items-center gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <BarChart3 className="h-4 w-4 text-zinc-500" />
        <h3 className="font-semibold text-sm">Resumo agregado</h3>
        <span className="text-xs text-zinc-500">com base nos filtros atuais</span>
        <div className="ml-auto flex flex-wrap gap-1">
          {(Object.keys(LABELS) as Dim[]).map((d) => (
            <button
              key={d}
              onClick={() => setDim(d)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition",
                dim === d
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700",
              )}
            >
              {LABELS[d]}
            </button>
          ))}
        </div>
      </header>

      {agregado.linhas.length === 0 ? (
        <p className="px-4 py-6 text-sm text-zinc-500">Nada para agregar.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-zinc-600 dark:text-zinc-400">{LABELS[dim]}</th>
                <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-zinc-600 dark:text-zinc-400">Carros</th>
                <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-zinc-600 dark:text-zinc-400">Em Prep.</th>
                <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-zinc-600 dark:text-zinc-400">Custo fábrica</th>
                <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-zinc-600 dark:text-zinc-400" style={{ width: 140 }}>% do total</th>
              </tr>
            </thead>
            <tbody>
              {agregado.linhas.map((l) => (
                <tr key={l.dimensao} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                  <td className="px-4 py-2 font-medium">{l.dimensao}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatInt(l.qt)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-amber-700 dark:text-amber-400">{l.qtPrep > 0 ? formatInt(l.qtPrep) : "—"}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold">{formatBRL(l.valor)}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center justify-end gap-2">
                      <div className="h-1.5 w-16 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-800">
                        <div className="h-full bg-blue-500" style={{ width: `${Math.min(100, l.pct)}%` }} />
                      </div>
                      <span className="tabular-nums text-xs text-zinc-600 dark:text-zinc-400" style={{ width: 42 }}>{l.pct.toFixed(1)}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-zinc-300 bg-zinc-50 font-semibold dark:border-zinc-700 dark:bg-zinc-950">
                <td className="px-4 py-2">TOTAL</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatInt(agregado.totalQt)}</td>
                <td className="px-4 py-2"></td>
                <td className="px-4 py-2 text-right tabular-nums">{formatBRL(agregado.totalValor)}</td>
                <td className="px-4 py-2"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
