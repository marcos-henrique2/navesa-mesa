"use client";

import { useMemo } from "react";
import { Building2, CheckCircle2, AlertCircle } from "lucide-react";
import { useInventory } from "@/lib/store/inventory";
import { formatInt, cn } from "@/lib/utils";

export function LojasTable() {
  const { lojas, veiculos, updateLoja, isHydrated } = useInventory();

  const linhas = useMemo(() => {
    const contagem = new Map<number, number>();
    for (const v of veiculos) contagem.set(v.cod_empresa, (contagem.get(v.cod_empresa) ?? 0) + 1);
    const cods = new Set<number>([...Object.keys(lojas).map(Number), ...contagem.keys()]);
    return [...cods]
      .sort((a, b) => (contagem.get(b) ?? 0) - (contagem.get(a) ?? 0) || a - b)
      .map((cod) => ({
        cod,
        nome: lojas[cod]?.nome ?? "",
        cidade: lojas[cod]?.cidade ?? "",
        carros: contagem.get(cod) ?? 0,
      }));
  }, [lojas, veiculos]);

  const preenchidas = linhas.filter((l) => l.nome.trim().length > 0).length;
  const total = linhas.length;

  if (!isHydrated) {
    return <p className="text-sm text-[var(--text-muted)]">Carregando…</p>;
  }

  if (linhas.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--border-base)] bg-[var(--bg-surface)] p-12 text-center">
        <Building2 className="mx-auto h-10 w-10 text-[var(--text-subtle)]" />
        <p className="mt-3 text-[var(--text-muted)]">Sem lojas cadastradas. Faça um upload primeiro.</p>
        <a href="/upload" className="mt-3 inline-block rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">📤 Subir relatório</a>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] p-4">
        <p className="text-sm">
          <strong>{preenchidas}</strong> de <strong>{total}</strong> lojas com nome preenchido.
          {preenchidas < total && <span className="ml-2 text-amber-600">Preencha as restantes para o nome aparecer nas telas.</span>}
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)]">
        <table className="w-full text-sm">
          <thead className="border-b border-[var(--border-soft)] bg-[var(--bg-muted)]">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-[var(--text-body)] dark:text-[var(--text-subtle)]" style={{ width: 80 }}>Código</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-[var(--text-body)] dark:text-[var(--text-subtle)]">Nome da loja</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-[var(--text-body)] dark:text-[var(--text-subtle)]" style={{ width: 200 }}>Cidade</th>
              <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-[var(--text-body)] dark:text-[var(--text-subtle)]" style={{ width: 120 }}>Carros</th>
              <th className="px-3 py-2 text-center text-xs font-medium uppercase tracking-wide text-[var(--text-body)] dark:text-[var(--text-subtle)]" style={{ width: 60 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.cod} className="border-b border-[var(--border-soft)] last:border-0">
                <td className="px-3 py-2"><span className="font-mono">{l.cod}</span></td>
                <td className="px-3 py-2">
                  <input
                    type="text"
                    value={l.nome}
                    onChange={(e) => updateLoja(l.cod, { nome: e.target.value })}
                    placeholder={`Ex: NAVESA ... loja ${l.cod}`}
                    className={cn(
                      "w-full rounded-md border bg-[var(--bg-surface)] px-2 py-1.5 text-sm",
                      l.nome.trim() ? "border-[var(--border-base)]" : "border-amber-300 dark:border-amber-700",
                    )}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="text"
                    value={l.cidade}
                    onChange={(e) => updateLoja(l.cod, { cidade: e.target.value })}
                    placeholder="Cidade"
                    className="w-full rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-2 py-1.5 text-sm"
                  />
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-[var(--text-body)]">{formatInt(l.carros)}</td>
                <td className="px-3 py-2 text-center">
                  {l.nome.trim() ? (
                    <CheckCircle2 className="mx-auto h-4 w-4 text-green-600" aria-label="Preenchida" />
                  ) : (
                    <AlertCircle className="mx-auto h-4 w-4 text-amber-500" aria-label="Falta nome" />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-[var(--text-muted)]">💾 As alterações são salvas automaticamente. Os nomes ficam guardados mesmo após novo upload.</p>
    </div>
  );
}
