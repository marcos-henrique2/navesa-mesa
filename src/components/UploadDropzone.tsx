"use client";

import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { useRouter } from "next/navigation";
import { UploadCloud, FileSpreadsheet, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { parseNbsXlsx } from "@/lib/parsers/nbs-xlsx";
import { parseNbsVendasXlsx } from "@/lib/parsers/nbs-vendas-xlsx";
import { parseNbsCustosXls } from "@/lib/parsers/nbs-custos-xls";
import { useInventory } from "@/lib/store/inventory";
import { cn, formatInt } from "@/lib/utils";

type Modo = "estoque" | "vendas" | "custos";

const CONFIG = {
  estoque: {
    title: "Estoque (Veículos em Estoque)",
    desc: "Arraste o XLSX de estoque do NBS aqui.",
    redirect: "/veiculos",
    accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] },
  },
  vendas: {
    title: "Vendas (Veículos Vendidos)",
    desc: "Arraste o XLSX de vendas do NBS aqui.",
    redirect: "/vendas",
    accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] },
  },
  custos: {
    title: "Custos (Relatório de Custos)",
    desc: "Arraste o .xls de Custos do NBS aqui.",
    redirect: "/vendas",
    accept: {
      "application/vnd.ms-excel": [".xls"],
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
    },
  },
};

export function UploadDropzone({ modo }: { modo: Modo }) {
  const router = useRouter();
  const { setFromParse, setVendasFromParse, setCustosFromParse, clearVendas, clearCustos, meta, vendasMeta, custosMeta } = useInventory();
  const [status, setStatus] = useState<"idle" | "parsing" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [resultCount, setResultCount] = useState<number | null>(null);
  const [mergeFeedback, setMergeFeedback] = useState<string | null>(null);

  const onDrop = useCallback(
    async (accepted: File[]) => {
      const file = accepted[0];
      if (!file) return;

      setFileName(file.name);
      setStatus("parsing");
      setError(null);
      setMergeFeedback(null);

      try {
        const buf = await file.arrayBuffer();
        if (modo === "estoque") {
          const result = await parseNbsXlsx(buf, file.name);
          setFromParse(result);
          setResultCount(result.meta.total_veiculos);
        } else if (modo === "vendas") {
          const result = await parseNbsVendasXlsx(buf, file.name);
          const delta = setVendasFromParse(result);
          setResultCount(result.meta.total_vendas);
          if (delta.mantidas > 0 || delta.substituidas > 0) {
            const partes: string[] = [];
            partes.push(`+${delta.novas} novas`);
            if (delta.substituidas > 0) partes.push(`${delta.substituidas} atualizadas`);
            if (delta.mantidas > 0) partes.push(`${delta.mantidas} mantidas do histórico`);
            setMergeFeedback(partes.join(" · "));
          }
        } else {
          const result = await parseNbsCustosXls(buf, file.name);
          const delta = setCustosFromParse(result);
          setResultCount(result.meta.total_vendas);
          if (delta.mantidos > 0 || delta.substituidos > 0) {
            const partes: string[] = [];
            partes.push(`+${delta.novos} novos`);
            if (delta.substituidos > 0) partes.push(`${delta.substituidos} atualizados`);
            if (delta.mantidos > 0) partes.push(`${delta.mantidos} mantidos do histórico`);
            setMergeFeedback(partes.join(" · "));
          }
        }
        setStatus("done");
        setTimeout(() => router.push(CONFIG[modo].redirect), 1500);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro desconhecido");
        setStatus("error");
      }
    },
    [modo, setFromParse, setVendasFromParse, setCustosFromParse, router],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: CONFIG[modo].accept,
    maxFiles: 1,
    disabled: status === "parsing",
  });

  const cfg = CONFIG[modo];
  const tone: "blue" | "purple" | "emerald" =
    modo === "estoque" ? "blue" : modo === "vendas" ? "purple" : "emerald";
  const existing = modo === "estoque" ? meta : modo === "vendas" ? vendasMeta : custosMeta;

  return (
    <div className="space-y-3">
      <div className="min-h-[3.5rem]">
        <h3 className="font-semibold">{cfg.title}</h3>
        <p className="text-xs text-zinc-500">{cfg.desc}</p>
      </div>

      <div
        {...getRootProps()}
        className={cn(
          "rounded-xl border-2 border-dashed p-8 text-center transition cursor-pointer",
          isDragActive && tone === "blue" && "border-blue-500 bg-blue-50",
          isDragActive && tone === "purple" && "border-purple-500 bg-purple-50",
          isDragActive && tone === "emerald" && "border-emerald-500 bg-emerald-50",
          !isDragActive && "border-zinc-300 bg-white",
          status === "parsing" && "cursor-wait opacity-60",
        )}
      >
        <input {...getInputProps()} />
        <UploadCloud className="mx-auto h-10 w-10 text-zinc-400" />
        <p className="mt-3 text-sm font-medium">
          {isDragActive ? "Solte aqui" : "Arraste o XLSX ou clique"}
        </p>
        <p className="mt-1 text-xs text-zinc-500">.xlsx ou .xls</p>
      </div>

      {existing && status === "idle" && (
        <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1 text-zinc-600">
              <p>
                <FileSpreadsheet className="mr-1 inline h-3 w-3" />
                {modo === "estoque" && <>{formatInt(meta!.total_veiculos)} veículos / {formatInt(meta!.total_lojas)} lojas</>}
                {modo === "vendas" && <>{formatInt(vendasMeta!.total_vendas)} vendas acumuladas</>}
                {modo === "custos" && <>{formatInt(custosMeta!.total_vendas)} custos detalhados</>}
              </p>
              {modo === "vendas" && vendasMeta?.periodo_inicio && vendasMeta?.periodo_fim && (
                <p className="mt-0.5 text-[10px] text-slate-500">
                  Período: {new Date(vendasMeta.periodo_inicio).toLocaleDateString("pt-BR")} → {new Date(vendasMeta.periodo_fim).toLocaleDateString("pt-BR")}
                </p>
              )}
              {modo === "custos" && custosMeta?.periodo && (
                <p className="mt-0.5 text-[10px] text-slate-500">{custosMeta.periodo}</p>
              )}
            </div>
            {modo !== "estoque" && (
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Apagar todo o histórico acumulado de ${modo}? Você precisará re-subir do zero.`)) {
                    if (modo === "vendas") clearVendas();
                    else clearCustos();
                  }
                }}
                className="shrink-0 rounded px-2 py-0.5 text-[10px] text-slate-500 hover:bg-slate-200 hover:text-slate-700"
                title="Limpar histórico acumulado"
              >
                Limpar histórico
              </button>
            )}
          </div>
        </div>
      )}

      {fileName && (
        <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="h-4 w-4 text-zinc-500" />
            <div className="flex-1 min-w-0">
              <p className="truncate text-sm font-medium">{fileName}</p>
              {status === "parsing" && (
                <p className="mt-1 flex items-center gap-2 text-xs text-blue-600">
                  <Loader2 className="h-3 w-3 animate-spin" /> Parseando…
                </p>
              )}
              {status === "done" && (
                <>
                  <p className="mt-1 flex items-center gap-2 text-xs text-green-600">
                    <CheckCircle2 className="h-3 w-3" />
                    {formatInt(resultCount ?? 0)} registros — redirecionando…
                  </p>
                  {mergeFeedback && (
                    <p className="mt-1 text-[11px] text-slate-500">
                      Merge incremental: {mergeFeedback}
                    </p>
                  )}
                </>
              )}
              {status === "error" && (
                <p className="mt-1 flex items-center gap-2 text-xs text-red-600">
                  <AlertCircle className="h-3 w-3" /> {error}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
