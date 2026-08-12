"use client";

/**
 * Sync por ARQUIVO do Auto Avaliar (Story 2.2 / Fatia 3a) — aba "Subir arquivo"
 * de `/repasses/importar`.
 *
 * Fluxo: arrasta o .xls "Veículos em Oferta" → parseia no navegador → preview
 * (RPC read-only) → `SyncOfertasConferencia` abre com os 4 baldes + o painel
 * "saíram do Auto Avaliar" → só um clique explícito grava.
 *
 * NUNCA cria carro: é o irmão de `ImportarPorTexto`, que é quem cria. Este só
 * atualiza valores de quem já existe — e é o único que traz maior oferta
 * recebida e qtde de anúncios.
 */

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import {
  AlertCircle,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  RotateCcw,
  UploadCloud,
} from "lucide-react";
import {
  parseAutoAvaliarOfertasXls,
  montarPayloadSyncArquivo,
  mensagemErroArquivo,
  type LinhaOutraLoja,
  type OfertasMeta,
  type PayloadSyncArquivo,
} from "@/lib/parsers/auto-avaliar-ofertas-xls";
import { placasVistasNoArquivo } from "@/lib/repasses/presenca-arquivo-auto-avaliar";
import { previewSyncArquivo } from "@/lib/repasses/sync-arquivo-auto-avaliar-queries";
import type { RelatorioSync } from "@/lib/repasses/sync-arquivo-auto-avaliar";
import { SyncOfertasConferencia } from "@/components/repasses/SyncOfertasConferencia";
import { cn, formatInt } from "@/lib/utils";

/** Estado entre o preview e a gravação. Nada foi escrito ainda. */
type ConferenciaOfertas = {
  arquivoNome: string;
  meta: OfertasMeta;
  outraLoja: LinhaOutraLoja[];
  /**
   * Placas de TODAS as lojas do arquivo. Só existe aqui porque `payload` já saiu
   * filtrado pela Matriz: o balde "saiu do anúncio" precisa do arquivo inteiro,
   * senão carro transferido de loja é acusado de ter sumido.
   */
  placasNoArquivo: ReadonlySet<string>;
  payload: PayloadSyncArquivo;
  preview: RelatorioSync;
};

export function ImportarPorArquivo() {
  const [status, setStatus] = useState<
    "idle" | "parsing" | "conferindo" | "done" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [gravadas, setGravadas] = useState<number | null>(null);
  const [conferencia, setConferencia] = useState<ConferenciaOfertas | null>(null);

  const resetar = useCallback(() => {
    setStatus("idle");
    setError(null);
    setFileName(null);
    setGravadas(null);
    setConferencia(null);
  }, []);

  const onDrop = useCallback(async (accepted: File[]) => {
    const file = accepted[0];
    if (!file) return;

    setFileName(file.name);
    setStatus("parsing");
    setError(null);

    try {
      const buf = await file.arrayBuffer();
      // O parser devolve ERRO TIPADO em vez de lançar: ramificar em `ok` é
      // obrigatório. Um `catch` aqui nunca veria "esse é o arquivo errado" e a
      // tela cairia num "erro ao processar" sem informação.
      const parse = parseAutoAvaliarOfertasXls(buf, file.name);
      if (!parse.ok) {
        setError(mensagemErroArquivo(parse.erro));
        setStatus("error");
        return;
      }

      const payload = montarPayloadSyncArquivo(parse.linhas);
      const preview = await previewSyncArquivo(payload);
      setConferencia({
        arquivoNome: file.name,
        meta: parse.meta,
        outraLoja: parse.outra_loja,
        placasNoArquivo: placasVistasNoArquivo(parse.linhas, parse.outra_loja),
        payload,
        preview,
      });
      // "conferindo", não "done": nada foi gravado até o clique no modal.
      setStatus("conferindo");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
      setStatus("error");
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "application/vnd.ms-excel": [".xls"], "text/html": [".xls"] },
    maxFiles: 1,
    // Teto baixo: o relatório real tem ~60 linhas / 30 KB. Um arquivo grande
    // trava a aba no SheetJS sem nenhum ganho possível.
    maxSize: 5 * 1024 * 1024,
    disabled: status === "parsing" || status === "conferindo",
  });

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-5">
        <p className="mb-2 text-sm font-medium text-[var(--text-strong)]">
          Suba o .xls &quot;Veículos em Oferta&quot; do Auto Avaliar
        </p>
        <div
          {...getRootProps()}
          className={cn(
            "cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition",
            isDragActive
              ? "border-rose-500 bg-rose-50 dark:bg-rose-950/40"
              : "border-[var(--border-base)] bg-[var(--bg-muted)]",
            (status === "parsing" || status === "conferindo") && "cursor-wait opacity-60",
          )}
        >
          <input {...getInputProps()} />
          <UploadCloud className="mx-auto h-10 w-10 text-[var(--text-subtle)]" />
          <p className="mt-3 text-sm font-medium text-[var(--text-strong)]">
            {isDragActive ? "Solte aqui" : "Arraste o arquivo ou clique"}
          </p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            .xls do Auto Avaliar (não é o do NBS)
          </p>
        </div>

        <p className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          Abre uma conferência carro a carro antes de gravar — nada muda sem a sua
          confirmação. Nunca cria carro, nunca apaga valor que já existe e só
          sincroniza a Matriz.
        </p>
      </div>

      {fileName && (
        <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] p-3">
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-[var(--text-strong)]">{fileName}</p>
              {status === "parsing" && (
                <p className="mt-1 flex items-center gap-2 text-xs text-blue-600">
                  <Loader2 className="h-3 w-3 animate-spin" /> Conferindo contra o sistema…
                </p>
              )}
              {status === "conferindo" && (
                <p className="mt-1 flex items-center gap-2 text-xs font-medium text-rose-700 dark:text-rose-400">
                  <AlertCircle className="h-3 w-3" /> Conferência aberta — nada foi gravado ainda.
                </p>
              )}
              {status === "done" && (
                <>
                  <p className="mt-1 flex items-center gap-2 text-xs font-medium text-green-700">
                    <CheckCircle2 className="h-3 w-3" /> Sincronizado: {formatInt(gravadas ?? 0)}{" "}
                    {gravadas === 1 ? "carro atualizado" : "carros atualizados"} no sistema.
                  </p>
                  <button
                    type="button"
                    onClick={resetar}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-2.5 py-1 text-xs font-medium text-[var(--text-body)] hover:bg-[var(--bg-muted)]"
                  >
                    <RotateCcw className="h-3 w-3" /> Subir outro arquivo
                  </button>
                </>
              )}
              {status === "error" && (
                <>
                  <p className="mt-1 flex items-center gap-2 text-xs text-red-600">
                    <AlertCircle className="h-3 w-3" /> {error}
                  </p>
                  <button
                    type="button"
                    onClick={resetar}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-2.5 py-1 text-xs font-medium text-[var(--text-body)] hover:bg-[var(--bg-muted)]"
                  >
                    <RotateCcw className="h-3 w-3" /> Tentar novamente
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {conferencia && (
        <SyncOfertasConferencia
          arquivoNome={conferencia.arquivoNome}
          meta={conferencia.meta}
          outraLoja={conferencia.outraLoja}
          placasNoArquivo={conferencia.placasNoArquivo}
          payload={conferencia.payload}
          preview={conferencia.preview}
          onAplicado={(relatorio) => {
            setGravadas(relatorio.resumo.linhas_gravadas);
            setStatus("done");
          }}
          onFechar={() => {
            // Descartar sem gravar limpa tudo; depois de gravar, o card fica em
            // "done" com a contagem e só perde o modal.
            if (status === "conferindo") resetar();
            else setConferencia(null);
          }}
        />
      )}
    </div>
  );
}
