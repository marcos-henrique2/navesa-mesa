"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { useInventory } from "@/lib/store/inventory";
import { useFipeBatch } from "@/lib/fipe/useFipeBatch";
import { useCautelares } from "@/lib/inventory/cautelar";
import { gerarExcelConsolidado } from "@/lib/export/excel-consolidado";

/**
 * Botão "Baixar Excel consolidado" — gera 1 .xlsx com 4 abas (Resumo, Estoque,
 * Vendas, Custos) a partir do estado atual da aplicação. Marcos envia esse
 * arquivo único pro contador/sócio em vez dos 3 relatórios brutos do NBS.
 */
export function ExportExcelButton() {
  const { veiculos, vendas, custosPorPlaca, lojas } = useInventory();
  const fipeBatch = useFipeBatch();
  const cautelares = useCautelares();
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function handleExport() {
    if (gerando) return;
    setGerando(true);
    setErro(null);
    try {
      // Pequeno delay pra o spinner aparecer (evita freeze visual perceptível
      // quando o cálculo é síncrono e bloqueia o main thread brevemente).
      await new Promise((r) => setTimeout(r, 16));
      const blob = gerarExcelConsolidado({
        veiculos,
        vendas,
        custosPorPlaca,
        lojas,
        fipeBatch,
        cautelares,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const hoje = new Date();
      const dataStr = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
      a.href = url;
      a.download = `navesa-mesa-consolidado-${dataStr}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErro(`Erro ao gerar Excel: ${msg}`);
    } finally {
      setGerando(false);
    }
  }

  // Não mostra se não tem dados ainda
  if (veiculos.length === 0 && vendas.length === 0) return null;

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-[var(--shadow-sm)] dark:border-emerald-900 dark:bg-emerald-950/30">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex-1">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--text-strong)]">
            <Download className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
            Baixar Excel consolidado
          </h3>
          <p className="mt-1 text-xs text-[var(--text-body)]">
            Gera 1 arquivo .xlsx com 4 abas (Resumo, Estoque, Vendas, Custos) pra
            mandar pro contador/sócio. Já vem com classe Auto Avaliar, FIPE,
            diagnóstico e margem real calculados.
          </p>
          {erro && (
            <p className="mt-2 text-xs text-red-700 dark:text-red-300">{erro}</p>
          )}
        </div>
        <button
          onClick={handleExport}
          disabled={gerando}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {gerando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {gerando ? "Gerando..." : "Baixar Excel consolidado"}
        </button>
      </div>
    </div>
  );
}
