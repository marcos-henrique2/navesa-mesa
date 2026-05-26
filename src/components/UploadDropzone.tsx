"use client";

import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { useRouter } from "next/navigation";
import { UploadCloud, FileSpreadsheet, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { parseNbsXlsx } from "@/lib/parsers/nbs-xlsx";
import { useInventory } from "@/lib/store/inventory";
import { cn, formatInt } from "@/lib/utils";

export function UploadDropzone() {
  const router = useRouter();
  const { setFromParse, meta } = useInventory();
  const [status, setStatus] = useState<"idle" | "parsing" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const onDrop = useCallback(
    async (accepted: File[]) => {
      const file = accepted[0];
      if (!file) return;

      setFileName(file.name);
      setStatus("parsing");
      setError(null);

      try {
        const buf = await file.arrayBuffer();
        const result = await parseNbsXlsx(buf, file.name);
        setFromParse(result);
        setStatus("done");
        setTimeout(() => router.push("/veiculos"), 800);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro desconhecido");
        setStatus("error");
      }
    },
    [setFromParse, router],
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

  return (
    <div className="space-y-6">
      <div
        {...getRootProps()}
        className={cn(
          "rounded-xl border-2 border-dashed p-12 text-center transition cursor-pointer",
          isDragActive ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30" : "border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900",
          status === "parsing" && "cursor-wait opacity-60",
        )}
      >
        <input {...getInputProps()} />
        <UploadCloud className="mx-auto h-12 w-12 text-zinc-400" />
        <p className="mt-4 text-sm font-medium">
          {isDragActive ? "Solte o arquivo aqui" : "Arraste o XLSX do NBS aqui, ou clique para escolher"}
        </p>
        <p className="mt-1 text-xs text-zinc-500">Apenas .xlsx ou .xls</p>
      </div>

      {fileName && (
        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="h-5 w-5 text-zinc-500" />
            <div className="flex-1">
              <p className="font-medium text-sm">{fileName}</p>
              {status === "parsing" && (
                <p className="mt-1 flex items-center gap-2 text-xs text-blue-600">
                  <Loader2 className="h-3 w-3 animate-spin" /> Parseando…
                </p>
              )}
              {status === "done" && meta && (
                <p className="mt-1 flex items-center gap-2 text-xs text-green-600">
                  <CheckCircle2 className="h-3 w-3" />
                  {formatInt(meta.total_veiculos)} veículos / {formatInt(meta.total_lojas)} lojas — redirecionando…
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
