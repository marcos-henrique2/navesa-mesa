"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Upload as UploadIcon, ShieldCheck, AlertTriangle, CheckCircle2 } from "lucide-react";
import { baixarBackup, restaurarBackup, resumoEstadoAtual } from "@/lib/storage/backup";

export function BackupRestore() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [resumo, setResumo] = useState<{ totalChaves: number; tamanhoKB: number; pctLimite: number } | null>(null);
  const [feedback, setFeedback] = useState<{ tipo: "ok" | "erro"; msg: string } | null>(null);

  useEffect(() => {
    // Leitura de localStorage só após montagem (evita mismatch de hidratação SSR)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setResumo(resumoEstadoAtual());
  }, []);

  const exportar = useCallback(() => {
    try {
      const meta = baixarBackup();
      setFeedback({ tipo: "ok", msg: `Backup baixado: ${meta.totalChaves} chaves, ${meta.tamanhoKB} KB.` });
    } catch (err) {
      setFeedback({ tipo: "erro", msg: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  const onPickFile = useCallback(() => fileRef.current?.click(), []);

  const onFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!confirm("Restaurar este backup? Os dados atuais serão sobrescritos pelos do arquivo. Recomendado exportar um backup antes.")) {
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    try {
      const texto = await file.text();
      const r = restaurarBackup(texto, { limparAntes: true });
      setFeedback({
        tipo: "ok",
        msg: `Backup restaurado: ${r.aplicadas} chaves aplicadas${r.meta?.exportadoEm ? ` (de ${new Date(r.meta.exportadoEm).toLocaleString("pt-BR")})` : ""}. Recarregando…`,
      });
      setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      setFeedback({ tipo: "erro", msg: `Arquivo inválido: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }, []);

  return (
    <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-5 shadow-[var(--shadow-sm)]">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[var(--brand-700)] dark:text-[var(--brand-300)]" />
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-[var(--text-strong)]">Backup & Restauração</h3>
          <p className="mt-0.5 text-xs text-[var(--text-body)]">
            Seus dados ficam só no navegador. Exporte um backup pra não perder estoque, vendas, custos,
            FIPE, cautelar e o histórico do chat.
          </p>

          {resumo && (
            <p className="mt-2 text-[11px] text-[var(--text-muted)]">
              Estado atual: <strong>{resumo.totalChaves}</strong> conjuntos de dados · {resumo.tamanhoKB} KB ·{" "}
              <span className={resumo.pctLimite > 70 ? "font-semibold text-amber-700" : ""}>
                {resumo.pctLimite}% do limite do navegador
              </span>
              {resumo.pctLimite > 70 && " — considere migrar pra banco em breve"}
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={exportar}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--brand-700)] px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-[var(--brand-800)]"
            >
              <Download className="h-3.5 w-3.5" /> Exportar backup
            </button>
            <button
              onClick={onPickFile}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-body)] transition hover:bg-[var(--bg-muted)]"
            >
              <UploadIcon className="h-3.5 w-3.5" /> Restaurar backup
            </button>
            <input ref={fileRef} type="file" accept=".json,application/json" onChange={onFile} className="hidden" />
          </div>

          {feedback && (
            <p
              className={`mt-2 inline-flex items-start gap-1 text-xs ${
                feedback.tipo === "ok" ? "text-emerald-700" : "text-red-700"
              }`}
            >
              {feedback.tipo === "ok" ? (
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              ) : (
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              )}
              <span>{feedback.msg}</span>
            </p>
          )}

          <p className="mt-3 text-[10px] text-[var(--text-subtle)]">
            💡 Dica: exporte um backup antes de limpar o navegador ou trocar de computador. Guarde o arquivo em local seguro (Drive, pen drive).
          </p>
        </div>
      </div>
    </div>
  );
}
