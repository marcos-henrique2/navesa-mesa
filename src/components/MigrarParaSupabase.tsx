"use client";

import { useCallback, useState } from "react";
import { Cloud, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { migrarLocalStorageParaSupabase, type MigracaoProgresso, type MigracaoResultado } from "@/lib/data/migracao";
import { formatInt, cn } from "@/lib/utils";

export function MigrarParaSupabase() {
  const [rodando, setRodando] = useState(false);
  const [progresso, setProgresso] = useState<MigracaoProgresso | null>(null);
  const [resultado, setResultado] = useState<MigracaoResultado | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const rodar = useCallback(async () => {
    if (rodando) return;
    if (!confirm("Subir os dados do navegador pro Supabase? Os dados existentes no Supabase com mesma placa/chassi serão atualizados.")) return;
    setRodando(true);
    setErro(null);
    setResultado(null);
    setProgresso(null);
    try {
      const r = await migrarLocalStorageParaSupabase(setProgresso);
      setResultado(r);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setRodando(false);
    }
  }, [rodando]);

  return (
    <div className="rounded-xl border-2 border-dashed border-[var(--brand-300)] bg-[var(--brand-50)] p-4 shadow-[var(--shadow-sm)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex-1">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Cloud className="h-4 w-4 text-[var(--brand-700)]" />
            Migrar dados do navegador pro Supabase
          </h3>
          <p className="mt-1 text-xs text-slate-600">
            Sobe vendas, custos e estoque atual do localStorage pra nuvem.
            <strong> Não apaga o localStorage</strong> — você pode rodar de novo se precisar.
            Faça <strong>1 vez só</strong> depois de configurar o Supabase.
          </p>
        </div>
        <button
          onClick={rodar}
          disabled={rodando}
          className="inline-flex items-center gap-2 rounded-lg bg-[var(--brand-700)] px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-[var(--brand-800)] disabled:opacity-50"
        >
          {rodando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}
          {rodando ? "Migrando..." : "Migrar agora"}
        </button>
      </div>

      {progresso && rodando && (
        <div className="mt-3 rounded-lg bg-white px-3 py-2 text-xs text-slate-700">
          <span className="inline-flex items-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin text-[var(--brand-700)]" />
            <strong className="capitalize">{progresso.fase.replace("-", " ")}:</strong> {progresso.mensagem}
          </span>
        </div>
      )}

      {resultado && (
        <div className="mt-3 space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs">
          <p className="flex items-center gap-2 font-semibold text-emerald-900">
            <CheckCircle2 className="h-4 w-4" /> Migração concluída
          </p>
          <ul className="space-y-0.5 text-emerald-800">
            <li>📦 Vendas: <strong>{formatInt(resultado.vendasMigradas)}</strong> subiram (já tinham {formatInt(resultado.jaTinhamNoSupabase.vendas)} antes){resultado.duplicatas.vendas > 0 && <> · {formatInt(resultado.duplicatas.vendas)} duplicatas no localStorage ignoradas</>}</li>
            <li>💰 Custos: <strong>{formatInt(resultado.custosMigrados)}</strong> subiram (já tinham {formatInt(resultado.jaTinhamNoSupabase.custos)} antes){resultado.duplicatas.custos > 0 && <> · {formatInt(resultado.duplicatas.custos)} duplicatas ignoradas</>}</li>
            <li>🚗 Estoque: <strong>{formatInt(resultado.veiculosMigrados)}</strong> veículos no novo snapshot (já tinham {formatInt(resultado.jaTinhamNoSupabase.veiculos)} antes)</li>
            <li>📋 Cautelares: <strong>{formatInt(resultado.cautelaresMigrados)}</strong> subiram (já tinham {formatInt(resultado.jaTinhamNoSupabase.cautelares)} antes)</li>
            <li>💲 FIPE batch: <strong>{formatInt(resultado.fipeBatchMigrados)}</strong> preços (já tinham {formatInt(resultado.jaTinhamNoSupabase.fipeBatch)} antes)</li>
            <li>📸 Fotos KPI: <strong>{formatInt(resultado.snapshotsMigrados)}</strong> fotos (já tinham {formatInt(resultado.jaTinhamNoSupabase.snapshots)} antes)</li>
            <li>💬 Chat: <strong>{formatInt(resultado.chatMensagensMigradas)}</strong> mensagens {resultado.jaTinhamNoSupabase.chat > 0 ? <>(já tinha {formatInt(resultado.jaTinhamNoSupabase.chat)} no Supabase — pulei pra não duplicar)</> : null}</li>
          </ul>
          <p className="text-[10px] text-emerald-700">
            Confira no painel do Supabase em <strong>Database → Tables</strong>.
            O localStorage continua intacto (segurança), você pode limpar depois se quiser.
          </p>
        </div>
      )}

      {erro && (
        <div className={cn("mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs")}>
          <p className="flex items-center gap-2 font-semibold text-red-900">
            <AlertCircle className="h-4 w-4" /> Erro na migração
          </p>
          <p className="mt-1 text-red-700">{erro}</p>
        </div>
      )}
    </div>
  );
}
