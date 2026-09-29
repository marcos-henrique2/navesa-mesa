"use client";

/**
 * Conferência Auto Avaliar — sobe o .xls "Veículos em Oferta" e confere cada
 * placa contra `vendas` e `veiculos_atual` no Supabase.
 *
 * Substitui a conferência manual que o Marcos fazia toda semana comparando o
 * arquivo do Auto Avaliar com o estoque/vendas reais. Diferente de
 * `/repasses/importar`: aqui é 100% leitura (nenhum RPC, nenhuma gravação) e
 * cobre TODO o arquivo — de qualquer loja, não só quem está marcado pra
 * repasse. Por isso não tem etapa de confirmação: o resultado já É a tela.
 */

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  HelpCircle,
  PackageCheck,
  RotateCcw,
  UploadCloud,
} from "lucide-react";
import {
  parseAutoAvaliarOfertasXls,
  mensagemErroArquivo,
} from "@/lib/parsers/auto-avaliar-ofertas-xls";
import {
  entradasDoParse,
  ROTULO_STATUS_CONFERENCIA,
  type ResultadoConferencia,
  type StatusConferencia,
} from "@/lib/conferencia-auto-avaliar/classificar";
import { conferirContraOSistema } from "@/lib/conferencia-auto-avaliar/queries";
import { cn, formatBRLCents, formatInt } from "@/lib/utils";
import { formatarDataBR } from "@/lib/utils/data-local";

type Status = "idle" | "parsing" | "conferindo" | "done" | "error";

type Filtro = "todos" | StatusConferencia;

export function ConferenciaAutoAvaliar() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoConferencia | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("todos");

  const resetar = useCallback(() => {
    setStatus("idle");
    setError(null);
    setFileName(null);
    setResultado(null);
    setFiltro("todos");
  }, []);

  const onDrop = useCallback(async (accepted: File[]) => {
    const file = accepted[0];
    if (!file) return;

    setFileName(file.name);
    setStatus("parsing");
    setError(null);
    setResultado(null);
    setFiltro("todos");

    try {
      const buf = await file.arrayBuffer();
      const parse = parseAutoAvaliarOfertasXls(buf, file.name);
      if (!parse.ok) {
        setError(mensagemErroArquivo(parse.erro));
        setStatus("error");
        return;
      }

      setStatus("conferindo");
      const entradas = entradasDoParse(parse);
      const conferido = await conferirContraOSistema(entradas);
      setResultado(conferido);
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
      setStatus("error");
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "application/vnd.ms-excel": [".xls"], "text/html": [".xls"] },
    maxFiles: 1,
    // Teto baixo: mesmo relatório do sync de repasses, ~60-110 linhas / poucos KB.
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
              ? "border-[var(--brand-600)] bg-[var(--brand-50)] dark:bg-[var(--brand-900)]/20"
              : "border-[var(--border-base)] bg-[var(--bg-muted)]",
            (status === "parsing" || status === "conferindo") && "cursor-wait opacity-60",
          )}
        >
          <input {...getInputProps()} />
          <UploadCloud className="mx-auto h-10 w-10 text-[var(--text-subtle)]" />
          <p className="mt-3 text-sm font-medium text-[var(--text-strong)]">
            {isDragActive ? "Solte aqui" : "Arraste o arquivo ou clique"}
          </p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">.xls do Auto Avaliar</p>
        </div>

        <p className="mt-4 rounded-md border border-[var(--border-soft)] bg-[var(--bg-muted)] px-3 py-2 text-[11px] text-[var(--text-body)]">
          Só leitura: compara o arquivo contra o sistema e mostra o resultado. Nada é gravado.
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
                  <RotateCcw className="h-3 w-3 animate-spin" /> Lendo o arquivo…
                </p>
              )}
              {status === "conferindo" && (
                <p className="mt-1 flex items-center gap-2 text-xs text-blue-600">
                  <RotateCcw className="h-3 w-3 animate-spin" /> Conferindo contra o sistema…
                </p>
              )}
              {status === "done" && resultado && (
                <p className="mt-1 flex items-center gap-2 text-xs font-medium text-green-700">
                  <CheckCircle2 className="h-3 w-3" /> Conferência concluída — {formatInt(resultado.resumo.total)}{" "}
                  {resultado.resumo.total === 1 ? "linha" : "linhas"} no arquivo.
                </p>
              )}
              {status === "error" && (
                <p className="mt-1 flex items-center gap-2 text-xs text-red-600">
                  <AlertCircle className="h-3 w-3" /> {error}
                </p>
              )}
            </div>
            {(status === "done" || status === "error") && (
              <button
                type="button"
                onClick={resetar}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-2.5 py-1 text-xs font-medium text-[var(--text-body)] hover:bg-[var(--bg-muted)]"
              >
                <RotateCcw className="h-3 w-3" /> Subir outro arquivo
              </button>
            )}
          </div>
        </div>
      )}

      {resultado && <ResumoCards resumo={resultado.resumo} filtro={filtro} onFiltro={setFiltro} />}
      {resultado && <TabelaConferencia resultado={resultado} filtro={filtro} />}
    </div>
  );
}

// ─── Resumo ────────────────────────────────────────────────────────────────

function ResumoCards({
  resumo,
  filtro,
  onFiltro,
}: {
  resumo: ResultadoConferencia["resumo"];
  filtro: Filtro;
  onFiltro: (f: Filtro) => void;
}) {
  const cards: { key: Filtro; label: string; valor: number; tone: string; icon: React.ReactNode }[] = [
    {
      key: "todos",
      label: "Total no arquivo",
      valor: resumo.total,
      tone: "border-[var(--border-soft)] bg-[var(--bg-surface)] text-[var(--text-strong)]",
      icon: <FileSpreadsheet className="h-4 w-4 text-[var(--text-muted)]" />,
    },
    {
      key: "vendido",
      label: "Vendidos",
      valor: resumo.vendidos,
      tone: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200",
      icon: <CheckCircle2 className="h-4 w-4" />,
    },
    {
      key: "estoque",
      label: "Em estoque",
      valor: resumo.em_estoque,
      tone: "border-[var(--border-soft)] bg-[var(--bg-muted)] text-[var(--text-strong)]",
      icon: <PackageCheck className="h-4 w-4 text-[var(--text-muted)]" />,
    },
    {
      key: "nao_encontrado",
      label: "Não encontrados",
      valor: resumo.nao_encontrados,
      tone: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200",
      icon: <AlertTriangle className="h-4 w-4" />,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cards.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={() => onFiltro(filtro === c.key ? "todos" : c.key)}
          className={cn(
            "rounded-xl border p-3 text-left transition",
            c.tone,
            filtro === c.key && "ring-2 ring-[var(--brand-600)] ring-offset-1 ring-offset-[var(--bg-app)]",
          )}
        >
          <div className="flex items-center gap-2 text-xs font-medium">
            {c.icon}
            {c.label}
          </div>
          <p className="mt-1 text-2xl font-bold tabular-nums">{formatInt(c.valor)}</p>
        </button>
      ))}
    </div>
  );
}

// ─── Tabela ────────────────────────────────────────────────────────────────

const BADGE_STATUS: Record<StatusConferencia, string> = {
  vendido:
    "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  estoque:
    "border-[var(--border-soft)] bg-[var(--bg-muted)] text-[var(--text-body)]",
  nao_encontrado:
    "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
};

function TabelaConferencia({
  resultado,
  filtro,
}: {
  resultado: ResultadoConferencia;
  filtro: Filtro;
}) {
  const itens =
    filtro === "todos" ? resultado.itens : resultado.itens.filter((i) => i.status === filtro);

  if (resultado.itens.length === 0) {
    return (
      <p className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] p-4 text-sm text-[var(--text-muted)]">
        O arquivo não trouxe nenhuma linha legível.
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-4">
      {resultado.resumo.nao_encontrados > 0 && (
        <p className="mb-3 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Carro não encontrado pode ser divergência de cadastro (placa diferente entre sistemas) ou
          atraso de sincronização — confira manualmente antes de agir.
        </p>
      )}

      {itens.length === 0 ? (
        <p className="py-4 text-center text-sm text-[var(--text-muted)]">
          Nenhuma linha com este status.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--border-soft)] text-left text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                <th className="py-1.5 pr-2 font-semibold">Placa</th>
                <th className="py-1.5 pr-2 font-semibold">Loja</th>
                <th className="py-1.5 pr-2 font-semibold">Marca / Modelo</th>
                <th className="py-1.5 pr-2 font-semibold">Status</th>
                <th className="py-1.5 pr-2 font-semibold">Detalhe da venda</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((item) => (
                <tr
                  key={`${item.entrada.linha}-${item.entrada.placa_norm}`}
                  className="border-b border-[var(--border-soft)] last:border-0"
                >
                  <td className="py-1.5 pr-2 font-mono font-semibold text-[var(--text-strong)]">
                    {item.entrada.placa_raw || item.entrada.placa_norm || "—"}
                  </td>
                  <td className="max-w-[12rem] truncate py-1.5 pr-2 text-[var(--text-muted)]">
                    {item.entrada.loja || "—"}
                  </td>
                  <td className="max-w-[16rem] truncate py-1.5 pr-2 text-[var(--text-body)]">
                    {[item.entrada.marca, item.entrada.modelo].filter(Boolean).join(" ") || "—"}
                  </td>
                  <td className="py-1.5 pr-2">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                        BADGE_STATUS[item.status],
                      )}
                    >
                      {ROTULO_STATUS_CONFERENCIA[item.status]}
                    </span>
                  </td>
                  <td className="py-1.5 pr-2 text-[var(--text-body)]">
                    {item.status === "vendido" && item.venda ? (
                      <span>
                        <span className="font-semibold tabular-nums">
                          {formatBRLCents(item.venda.valor_venda)}
                        </span>
                        {" · "}
                        {formatarDataBR(item.venda.data_venda)}
                        {item.venda.cliente_nome && (
                          <>
                            {" · "}
                            {item.venda.cliente_nome}
                          </>
                        )}
                        {item.venda.vendedor_nome && (
                          <>
                            {" · "}
                            {item.venda.vendedor_nome}
                          </>
                        )}
                      </span>
                    ) : (
                      <span className="text-[var(--text-subtle)]">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
