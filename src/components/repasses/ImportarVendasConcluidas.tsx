"use client";

/**
 * Importação do relatório "Vendas Concluídas" do Auto Avaliar — aba
 * "Vendas concluídas" de `/repasses/importar`.
 *
 * Fluxo: arrasta o .xlsx → parseia no navegador → preview (RPC read-only) →
 * `VendasConcluidasConferencia` abre com os 4 baldes → só um clique explícito
 * grava.
 *
 * DIFERENÇA DAS OUTRAS DUAS ABAS: esta CRIA carro quando ele não existe. É o
 * oposto do sync de "Veículos em Oferta", e de propósito — a venda é fato
 * consumado e o carro pode nunca ter passado pelo sistema. Ver a caixa no topo
 * da migration 036.
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
  montarPayloadVendas,
  mensagemErroVendas,
  parseAutoAvaliarVendasXlsx,
  type LinhaVendaOutraLoja,
  type PayloadVendas,
  type VendasMeta,
} from "@/lib/parsers/auto-avaliar-vendas-xlsx";
import { previewVendasConcluidas } from "@/lib/repasses/vendas-concluidas-queries";
import type { RelatorioVendas } from "@/lib/repasses/vendas-concluidas";
import { VendasConcluidasConferencia } from "@/components/repasses/VendasConcluidasConferencia";
import { cn, formatInt } from "@/lib/utils";

/** Estado entre o preview e a gravação. Nada foi escrito ainda. */
type ConferenciaVendas = {
  arquivoNome: string;
  meta: VendasMeta;
  outraLoja: LinhaVendaOutraLoja[];
  payload: PayloadVendas;
  preview: RelatorioVendas;
};

type Gravado = { atualizados: number; criados: number };

export function ImportarVendasConcluidas() {
  const [status, setStatus] = useState<
    "idle" | "parsing" | "conferindo" | "done" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [gravado, setGravado] = useState<Gravado | null>(null);
  const [conferencia, setConferencia] = useState<ConferenciaVendas | null>(null);

  const resetar = useCallback(() => {
    setStatus("idle");
    setError(null);
    setFileName(null);
    setGravado(null);
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
      // obrigatório. Um `catch` aqui nunca veria "esse é o arquivo errado".
      const parse = parseAutoAvaliarVendasXlsx(buf, file.name);
      if (!parse.ok) {
        setError(mensagemErroVendas(parse.erro));
        setStatus("error");
        return;
      }

      const payload = montarPayloadVendas(parse.linhas);
      const preview = await previewVendasConcluidas(payload);
      setConferencia({
        arquivoNome: file.name,
        meta: parse.meta,
        outraLoja: parse.outra_loja,
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
    // XLSX de verdade (ZIP + XML), diferente do "Veículos em Oferta", que é HTML
    // disfarçado de .xls.
    accept: {
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
    },
    maxFiles: 1,
    // Teto baixo: o relatório real tem 17 linhas / poucas dezenas de KB.
    maxSize: 5 * 1024 * 1024,
    disabled: status === "parsing" || status === "conferindo",
  });

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-5">
        <p className="mb-2 text-sm font-medium text-[var(--text-strong)]">
          Suba o .xlsx &quot;Vendas Concluídas&quot; do Auto Avaliar
        </p>
        <div
          {...getRootProps()}
          className={cn(
            "cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition",
            isDragActive
              ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40"
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
            .xlsx do Auto Avaliar (não é o .xls de &quot;Veículos em Oferta&quot;)
          </p>
        </div>

        <p className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          Abre uma conferência carro a carro antes de gravar — nada muda sem a sua
          confirmação. <strong>Esta é a única aba que cria carro vendido</strong>: quem não
          existe no sistema entra já como vendido, com data e valor. Nunca sobrescreve valor
          de compra existente e nunca apaga gasto.
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
                <p className="mt-1 flex items-center gap-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                  <AlertCircle className="h-3 w-3" /> Conferência aberta — nada foi gravado ainda.
                </p>
              )}
              {status === "done" && gravado && (
                <>
                  <p className="mt-1 flex items-center gap-2 text-xs font-medium text-green-700">
                    <CheckCircle2 className="h-3 w-3" /> {formatInt(gravado.atualizados)}{" "}
                    {gravado.atualizados === 1 ? "carro atualizado" : "carros atualizados"} ·{" "}
                    {formatInt(gravado.criados)}{" "}
                    {gravado.criados === 1 ? "carro criado" : "carros criados"}.
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
        <VendasConcluidasConferencia
          arquivoNome={conferencia.arquivoNome}
          meta={conferencia.meta}
          outraLoja={conferencia.outraLoja}
          payload={conferencia.payload}
          preview={conferencia.preview}
          onAplicado={(relatorio) => {
            setGravado({
              atualizados: relatorio.resumo.linhas_gravadas,
              criados: relatorio.resumo.repasses_criados,
            });
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
