"use client";

import { useState } from "react";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/AppShell";
import { showSuccessToast, showErrorToast } from "@/components/ui/Toast";
import { baixarVendasMatrizWorkbook } from "@/lib/export/vendas-matriz/gerar-workbook";
import { nomeMesExtenso } from "@/lib/export/vendas-matriz/tipos";
import { hojeLocal } from "@/lib/utils/data-local";

// Loja "dona" do relatório. Fixo por enquanto (só existe seletor de mês na tela), mas
// nunca hardcoded dentro da lógica de coleta/geração — sempre passado como parâmetro.
const COD_EMPRESA_MATRIZ = 2; // Ford Aeroporto

export default function VendasUsadosMatrizPage() {
  const [mesAno, setMesAno] = useState<string>(() => hojeLocal().slice(0, 7)); // "YYYY-MM"
  const [gerando, setGerando] = useState(false);

  const handleGerar = async () => {
    if (gerando) return;
    const m = /^(\d{4})-(\d{2})$/.exec(mesAno);
    if (!m) {
      showErrorToast("Selecione um mês válido.");
      return;
    }
    const ano = Number(m[1]);
    const mes = Number(m[2]);

    setGerando(true);
    try {
      await baixarVendasMatrizWorkbook({ codEmpresa: COD_EMPRESA_MATRIZ, mes, ano });
      showSuccessToast(`Relatório de ${nomeMesExtenso(mes)}/${ano} gerado.`);
    } catch (err) {
      showErrorToast(`Erro ao gerar relatório: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setGerando(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Vendas usados matriz"
        subtitle="Excel com 9 abas (detalhe, resumo, margens, médias de vendedor) e fórmulas de verdade — reproduz o modelo manual"
      />
      <div className="mx-auto max-w-2xl px-6 py-8">
        <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-5 shadow-[var(--shadow-sm)]">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--text-strong)]">
            <FileSpreadsheet className="h-4 w-4 text-[var(--brand-700)]" />
            Gerar relatório do mês
          </h3>
          <p className="mt-1 text-xs text-[var(--text-body)]">
            Escolha o mês e gere o .xlsx completo (vendas, resumo, margens, médias de
            vendedor e play plan) pra loja Ford Aeroporto.
          </p>

          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-[var(--text-muted)]">Mês de referência</span>
              <input
                type="month"
                value={mesAno}
                onChange={(e) => setMesAno(e.target.value)}
                className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-strong)] focus:border-[var(--brand-700)] focus:outline-none"
              />
            </label>

            <button
              onClick={handleGerar}
              disabled={gerando}
              className="inline-flex items-center gap-2 rounded-lg bg-[var(--brand-700)] px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-[var(--brand-800)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {gerando ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
              {gerando ? "Gerando..." : "Gerar relatório"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
