"use client";

import { useCallback, useState } from "react";
import { RefreshCw, CheckCircle2, AlertCircle, Loader2, X } from "lucide-react";
import { useInventory } from "@/lib/store/inventory";
import { runFipeBatch, batchIdadeHoras, clearBatch, type BatchProgress } from "@/lib/fipe/batch";
import { useFipeBatch } from "@/lib/fipe/useFipeBatch";
import { formatInt, cn } from "@/lib/utils";

/**
 * Banner pra disparar o batch FIPE e ver o status.
 * Mostra: data do último batch, # de carros com match, ação pra atualizar.
 */
export function FipeBatchRunner() {
  const { veiculos, isHydrated } = useInventory();
  const batch = useFipeBatch();
  const [rodando, setRodando] = useState(false);
  const [progresso, setProgresso] = useState<BatchProgress | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const rodar = useCallback(async () => {
    setRodando(true);
    setErro(null);
    setProgresso(null);
    try {
      await runFipeBatch(veiculos, (p) => setProgresso(p));
      // batch atualiza automaticamente via useFipeBatch hook
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setRodando(false);
    }
  }, [veiculos]);

  const limpar = useCallback(() => {
    if (!confirm("Limpar o cache de preços FIPE? Você vai precisar rodar de novo.")) return;
    clearBatch();
    setProgresso(null);
  }, []);

  if (!isHydrated || veiculos.length === 0) return null;

  const idadeHoras = batchIdadeHoras();
  const idadeLabel =
    idadeHoras == null
      ? null
      : idadeHoras < 1
        ? "agora há pouco"
        : idadeHoras < 24
          ? `há ${Math.floor(idadeHoras)}h`
          : `há ${Math.floor(idadeHoras / 24)}d`;

  const totalComFipe = batch ? Object.keys(batch.items).length : 0;

  // Banner inicial (sem batch ou batch antigo)
  if (!batch && !rodando) {
    return (
      <div className="rounded-xl border-2 border-dashed border-[var(--brand-300)] bg-[var(--brand-50)] p-4 shadow-[var(--shadow-sm)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-slate-900">
              💰 Buscar preços FIPE do estoque
            </h3>
            <p className="mt-0.5 text-xs text-slate-600">
              Vamos comparar cada um dos {formatInt(veiculos.length)} carros com a FIPE atual — leva ~2 minutos.
            </p>
          </div>
          <button
            onClick={rodar}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--brand-700)] px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-[var(--brand-800)]"
          >
            <RefreshCw className="h-4 w-4" /> Buscar FIPE
          </button>
        </div>
      </div>
    );
  }

  // Em execução
  if (rodando && progresso) {
    const pct = progresso.total > 0 ? (progresso.atual / progresso.total) * 100 : 0;
    return (
      <div className="rounded-xl border border-[var(--brand-300)] bg-[var(--brand-50)] p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--brand-700)]" />
          Buscando FIPE...
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
          <div className="h-full bg-[var(--brand-700)] transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
          <span>{progresso.mensagem}</span>
          <span className="tabular-nums">
            {progresso.atual}/{progresso.total} grupos · {progresso.matchesAteAgora} matches
            {progresso.errosAteAgora > 0 && ` · ${progresso.errosAteAgora} sem FIPE`}
          </span>
        </div>
      </div>
    );
  }

  // Concluído ou histórico
  if (batch) {
    const erros = batch.erros.length;
    const cobertura = batch.totalVeiculos > 0 ? (totalComFipe / batch.totalVeiculos) * 100 : 0;
    return (
      <div className="rounded-xl border border-[var(--border-soft)] bg-white p-4 shadow-[var(--shadow-sm)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                FIPE buscada · {formatInt(totalComFipe)} de {formatInt(batch.totalVeiculos)} carros ({cobertura.toFixed(0)}%)
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Última busca: {idadeLabel} · {formatInt(batch.totalGrupos)} grupos consultados
                {erros > 0 && <span className="text-amber-700"> · {erros} sem match</span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={rodar}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-soft)] bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
            >
              <RefreshCw className="h-3 w-3" /> Atualizar
            </button>
            <button
              onClick={limpar}
              className="inline-flex items-center gap-1 rounded-lg p-1.5 text-xs text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              title="Limpar cache"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (erro) {
    return (
      <div className="rounded-xl border border-red-300 bg-red-50 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-red-900">
          <AlertCircle className="h-4 w-4" /> Erro na busca FIPE
        </div>
        <p className="mt-1 text-xs text-red-700">{erro}</p>
        <button
          onClick={rodar}
          className={cn(
            "mt-2 inline-flex items-center gap-1 rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700",
          )}
        >
          Tentar de novo
        </button>
      </div>
    );
  }

  return null;
}
