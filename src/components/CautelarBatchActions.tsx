"use client";

import { useCallback, useRef, useState } from "react";
import { CheckCircle2, FileUp, ClipboardCheck, AlertCircle } from "lucide-react";
import { useInventory } from "@/lib/store/inventory";
import {
  useCautelares,
  setMultipleCautelares,
  aprovarTodosSemCautelar,
  CAUTELAR_LABEL,
  type StatusCautelar,
} from "@/lib/inventory/cautelar";
import { importarCautelaresDeXlsx } from "@/lib/inventory/cautelar-import";
import { formatInt, cn } from "@/lib/utils";

type Feedback = {
  tipo: "sucesso" | "erro";
  mensagem: string;
};

export function CautelarBatchActions() {
  const { veiculos, isHydrated } = useInventory();
  const cautelares = useCautelares();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [importando, setImportando] = useState(false);

  // Stats
  const totalComCautelar = veiculos.filter((v) => cautelares[v.chassi]).length;
  const porStatus: Record<StatusCautelar, number> = { aprovado: 0, com_restricao: 0, reprovado: 0 };
  for (const v of veiculos) {
    const c = cautelares[v.chassi];
    if (c) porStatus[c]++;
  }

  const onPickFile = useCallback(() => fileInputRef.current?.click(), []);

  const onFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setImportando(true);
      setFeedback(null);
      try {
        const buf = await file.arrayBuffer();
        const result = await importarCautelaresDeXlsx(buf);

        // Mapeia placa → chassi usando o estoque atual
        const placaParaChassi = new Map<string, string>();
        for (const v of veiculos) {
          if (v.placa) placaParaChassi.set(v.placa.trim().toUpperCase(), v.chassi);
        }

        const aplicar: Record<string, StatusCautelar> = {};
        let semCorrespondencia = 0;
        for (const [placa, status] of Object.entries(result.placas)) {
          const chassi = placaParaChassi.get(placa);
          if (chassi) {
            aplicar[chassi] = status;
          } else {
            semCorrespondencia++;
          }
        }

        const { aplicados, ignorados } = setMultipleCautelares(aplicar, { overwrite: false });

        const partes: string[] = [];
        partes.push(`${aplicados} cautelares aplicadas`);
        if (ignorados > 0) partes.push(`${ignorados} já estavam definidas`);
        if (semCorrespondencia > 0) partes.push(`${semCorrespondencia} placas não encontradas no estoque atual`);
        if (result.ignorados > 0) partes.push(`${result.ignorados} sem status reconhecido (ex: "sem laudo")`);

        setFeedback({
          tipo: "sucesso",
          mensagem: `Sheets lidas: ${result.sheetsLidas.join(", ")}. ${partes.join(" · ")}`,
        });
      } catch (err) {
        setFeedback({ tipo: "erro", mensagem: err instanceof Error ? err.message : String(err) });
      } finally {
        setImportando(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [veiculos],
  );

  const onAprovarTodos = useCallback(() => {
    const chassisSemCautelar = veiculos.filter((v) => !cautelares[v.chassi]).map((v) => v.chassi);
    if (chassisSemCautelar.length === 0) {
      setFeedback({ tipo: "sucesso", mensagem: "Todos os carros já têm cautelar definida." });
      return;
    }
    if (
      !confirm(
        `Marcar ${chassisSemCautelar.length} carros sem cautelar como "Aprovado"?\n\nVocê depois pode editar os exceções individualmente.`,
      )
    )
      return;
    const { aprovados } = aprovarTodosSemCautelar(chassisSemCautelar);
    setFeedback({ tipo: "sucesso", mensagem: `${aprovados} carros marcados como Aprovado.` });
  }, [veiculos, cautelares]);

  if (!isHydrated || veiculos.length === 0) return null;

  const semCautelar = veiculos.length - totalComCautelar;
  const cobertura = veiculos.length > 0 ? (totalComCautelar / veiculos.length) * 100 : 0;

  return (
    <div className="rounded-xl border border-[var(--border-soft)] bg-white p-4 shadow-[var(--shadow-sm)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <ClipboardCheck className="h-4 w-4 text-[var(--brand-700)]" />
            Status do laudo cautelar
          </h3>
          <p className="mt-0.5 text-xs text-slate-600">
            <strong>{formatInt(totalComCautelar)}</strong> de {formatInt(veiculos.length)} carros
            com cautelar definida ({cobertura.toFixed(0)}% de cobertura)
            {semCautelar > 0 && (
              <span className="text-amber-700"> · {formatInt(semCautelar)} sem definição</span>
            )}
          </p>
          {totalComCautelar > 0 && (
            <p className="mt-1 flex flex-wrap gap-2 text-[11px] text-slate-500">
              {(["aprovado", "com_restricao", "reprovado"] as StatusCautelar[]).map((s) =>
                porStatus[s] > 0 ? (
                  <span key={s} className="inline-flex items-center gap-1">
                    <span className="font-semibold tabular-nums">{porStatus[s]}</span>{" "}
                    {CAUTELAR_LABEL[s].toLowerCase()}
                  </span>
                ) : null,
              )}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onPickFile}
            disabled={importando}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-soft)] bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            <FileUp className="h-3.5 w-3.5" />
            {importando ? "Importando..." : "Importar de planilha"}
          </button>
          <button
            onClick={onAprovarTodos}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-emerald-700"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Marcar todos sem cautelar como Aprovado
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={onFile}
            className="hidden"
          />
        </div>
      </div>
      {feedback && (
        <div
          className={cn(
            "mt-3 rounded-lg border px-3 py-2 text-xs",
            feedback.tipo === "sucesso"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-800",
          )}
        >
          <span className="inline-flex items-start gap-1">
            {feedback.tipo === "sucesso" ? (
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            ) : (
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            )}
            <span>{feedback.mensagem}</span>
          </span>
        </div>
      )}
    </div>
  );
}
