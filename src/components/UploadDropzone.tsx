"use client";

import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { useRouter } from "next/navigation";
import { UploadCloud, FileSpreadsheet, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { parseNbsXlsx } from "@/lib/parsers/nbs-xlsx";
import { parseNbsVendasXlsx } from "@/lib/parsers/nbs-vendas-xlsx";
import { useInventory } from "@/lib/store/inventory";
import { cn, formatInt } from "@/lib/utils";

type Modo = "estoque" | "vendas";

const CONFIG = {
  estoque: {
    title: "Estoque (Veículos em Estoque)",
    desc: "Arraste o XLSX de estoque do NBS aqui.",
    redirect: "/veiculos",
  },
  vendas: {
    title: "Vendas (Veículos Vendidos)",
    desc: "Arraste o XLSX de vendas do NBS aqui.",
    redirect: "/vendas",
  },
};

export function UploadDropzone({ modo }: { modo: Modo }) {
  const router = useRouter();
  const { setFromParse, setVendasFromParse, meta, vendasMeta } = useInventory();
  const [status, setStatus] = useState<"idle" | "parsing" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [resultCount, setResultCount] = useState<number | null>(null);

  const onDrop = useCallback(
    async (accepted: File[]) => {
      const file = accepted[0];
      if (!file) return;

      setFileName(file.name);
      setStatus("parsing");
      setError(null);

      try {
        const buf = await file.arrayBuffer();
        if (modo === "estoque") {
          const result = await parseNbsXlsx(buf, file.name);
          setFromParse(result);
          setResultCount(result.meta.total_veiculos);
        } else {
          const result = await parseNbsVendasXlsx(buf, file.name);
          setVendasFromParse(result);
          setResultCount(result.meta.total_vendas);
        }
        setStatus("done");
        setTimeout(() => router.push(CONFIG[modo].redirect), 1000);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro desconhecido");
        setStatus("error");
      }
    },
    [modo, setFromParse, setVendasFromParse, router],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
      "application/vnd.ms-excel": [".xls"],
    },
    maxFiles: 1,
    disabled: status === "parsing",
  });

  const cfg = CONFIG[modo];
  const tone = modo === "estoque" ? "blue" : "purple";
  const existing = modo === "estoque" ? meta : vendasMeta;

  return (
    <div className="space-y-3">
      <div>
        <h3 className="font-semibold">{cfg.title}</h3>
        <p className="text-xs text-zinc-500">{cfg.desc}</p>
      </div>

      <div
        {...getRootProps()}
        className={cn(
          "rounded-xl border-2 border-dashed p-8 text-center transition cursor-pointer",
          isDragActive
            ? tone === "blue" ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30" : "border-purple-500 bg-purple-50 dark:bg-purple-950/30"
            : "border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900",
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
        <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-950">
          <p className="text-zinc-600 dark:text-zinc-400">
            <FileSpreadsheet className="mr-1 inline h-3 w-3" />
            Último upload: {modo === "estoque"
              ? `${formatInt(meta!.total_veiculos)} veículos / ${formatInt(meta!.total_lojas)} lojas`
              : `${formatInt(vendasMeta!.total_vendas)} vendas`}
          </p>
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
                <p className="mt-1 flex items-center gap-2 text-xs text-green-600">
                  <CheckCircle2 className="h-3 w-3" />
                  {formatInt(resultCount ?? 0)} registros — redirecionando…
                </p>
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
