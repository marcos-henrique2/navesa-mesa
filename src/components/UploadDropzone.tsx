"use client";

import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { UploadCloud, FileSpreadsheet, AlertCircle, CheckCircle2, Loader2, RotateCcw } from "lucide-react";
import { parseNbsXlsx } from "@/lib/parsers/nbs-xlsx";
import { parseNbsVendasXlsx } from "@/lib/parsers/nbs-vendas-xlsx";
import { parseNbsCustosXls } from "@/lib/parsers/nbs-custos-xls";
import { parseNbsCustosEstoquePdf } from "@/lib/parsers/nbs-custos-estoque-pdf";
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
import { useInventory } from "@/lib/store/inventory";
import { cn, formatInt } from "@/lib/utils";

/**
 * ⚠️ Os quatro primeiros modos são do NBS: processam local e terminam num store
 * do navegador. O quinto (`repasse-ofertas`) é diferente em espécie — ele chama
 * o Supabase e GRAVA EM PRODUÇÃO. Por isso ele tem passo de confirmação e os
 * outros não: o arquivo vira preview (RPC read-only), a conferência abre, e só
 * um clique explícito grava.
 */
type Modo = "estoque" | "vendas" | "custos" | "custos-estoque" | "repasse-ofertas";

type ConfigModo = {
  title: string;
  desc: string;
  label: string;
  accept: Record<string, string[]>;
  /** Teto de tamanho. Default 50MB (XLSX real do NBS é ~1-3MB). */
  maxSize?: number;
  /** Extensões mostradas no dropzone. */
  hint: string;
};

const CONFIG: Record<Modo, ConfigModo> = {
  estoque: {
    title: "Estoque (Veículos em Estoque)",
    desc: "Arraste o XLSX de estoque do NBS aqui.",
    label: "Estoque",
    accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] },
    hint: ".xlsx ou .xls",
  },
  vendas: {
    title: "Vendas (Veículos Vendidos)",
    desc: "Arraste o XLSX de vendas do NBS aqui.",
    label: "Vendas",
    accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] },
    hint: ".xlsx ou .xls",
  },
  custos: {
    title: "Custos (Relatório de Custos)",
    desc: "Arraste o .xls de Custos do NBS aqui.",
    label: "Custos",
    accept: {
      "application/vnd.ms-excel": [".xls"],
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
    },
    hint: ".xlsx ou .xls",
  },
  "custos-estoque": {
    title: "Custos de Estoque (Markup)",
    desc: "Arraste o PDF 'Custos de Veículos em Estoque' do NBS aqui.",
    label: "Custos Estoque",
    accept: { "application/pdf": [".pdf"] },
    hint: ".pdf",
  },
  "repasse-ofertas": {
    title: "Repasse — Veículos em Oferta",
    desc: "Arraste o .xls 'Veículos em Oferta' do Auto Avaliar. Mostra o que vai mudar antes de gravar.",
    label: "Veículos em Oferta",
    accept: { "application/vnd.ms-excel": [".xls"], "text/html": [".xls"] },
    // Teto menor: o relatório real tem ~60 linhas / 30 KB. Um arquivo grande aqui
    // trava a aba no SheetJS sem nenhum ganho possível.
    maxSize: 5 * 1024 * 1024,
    hint: ".xls do Auto Avaliar",
  },
};

/** Estado do quinto modo entre o preview e a gravação. Nada foi escrito ainda. */
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

export function UploadDropzone({ modo }: { modo: Modo }) {
  const {
    setFromParse,
    setVendasFromParse,
    setCustosFromParse,
    setCustosEstoqueFromParse,
    clearVendas,
    clearCustos,
    clearCustosEstoque,
    meta,
    vendasMeta,
    custosMeta,
    custosEstoqueMeta,
  } = useInventory();
  const [status, setStatus] = useState<
    "idle" | "parsing" | "conferindo" | "done" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [resultCount, setResultCount] = useState<number | null>(null);
  const [mergeFeedback, setMergeFeedback] = useState<string | null>(null);
  const [conferencia, setConferencia] = useState<ConferenciaOfertas | null>(null);

  const resetar = useCallback(() => {
    setStatus("idle");
    setError(null);
    setFileName(null);
    setResultCount(null);
    setMergeFeedback(null);
    setConferencia(null);
  }, []);

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

        // ─── Quinto modo: sync de valores de repasse (grava em PRODUÇÃO) ───
        // O parser devolve ERRO TIPADO em vez de lançar: ramificar em `ok` é
        // obrigatório. Um `catch` aqui nunca veria "esse é o arquivo errado" e
        // a tela cairia num "erro ao processar" sem informação.
        if (modo === "repasse-ofertas") {
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
          return;
        }

        if (modo === "estoque") {
          const result = await parseNbsXlsx(buf, file.name);
          await setFromParse(result);
          setResultCount(result.meta.total_veiculos);
        } else if (modo === "vendas") {
          const result = await parseNbsVendasXlsx(buf, file.name);
          const delta = await setVendasFromParse(result);
          setResultCount(result.meta.total_vendas);
          if (delta.mantidas > 0 || delta.substituidas > 0) {
            const partes: string[] = [];
            partes.push(`+${delta.novas} novas`);
            if (delta.substituidas > 0) partes.push(`${delta.substituidas} atualizadas`);
            if (delta.mantidas > 0) partes.push(`${delta.mantidas} mantidas do histórico`);
            setMergeFeedback(partes.join(" · "));
          }
        } else if (modo === "custos") {
          const result = await parseNbsCustosXls(buf, file.name);
          const delta = await setCustosFromParse(result);
          setResultCount(result.meta.total_vendas);
          if (delta.mantidos > 0 || delta.substituidos > 0) {
            const partes: string[] = [];
            partes.push(`+${delta.novos} novos`);
            if (delta.substituidos > 0) partes.push(`${delta.substituidos} atualizados`);
            if (delta.mantidos > 0) partes.push(`${delta.mantidos} mantidos do histórico`);
            setMergeFeedback(partes.join(" · "));
          }
        } else {
          // custos-estoque (PDF)
          const result = await parseNbsCustosEstoquePdf(buf, file.name);
          const delta = await setCustosEstoqueFromParse(result);
          setResultCount(result.meta.total_veiculos);
          if (delta.mantidos > 0 || delta.substituidos > 0) {
            const partes: string[] = [];
            partes.push(`+${delta.novos} novos`);
            if (delta.substituidos > 0) partes.push(`${delta.substituidos} atualizados`);
            if (delta.mantidos > 0) partes.push(`${delta.mantidos} mantidos do histórico`);
            setMergeFeedback(partes.join(" · "));
          }
        }
        setStatus("done");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro desconhecido");
        setStatus("error");
      }
    },
    [modo, setFromParse, setVendasFromParse, setCustosFromParse, setCustosEstoqueFromParse],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: CONFIG[modo].accept,
    maxFiles: 1,
    // 50MB por padrão — XLSX real do NBS é ~1-3MB; previne DoS local com arquivo
    // gigante. Modos com teto próprio declaram `maxSize` no CONFIG.
    maxSize: CONFIG[modo].maxSize ?? 50 * 1024 * 1024,
    disabled: status === "parsing" || status === "conferindo",
  });

  const cfg = CONFIG[modo];
  // `rose` só no quinto modo: é o único que grava em produção, e a cor é o
  // primeiro sinal de que ele não é mais um upload local do NBS.
  const tone: "blue" | "purple" | "emerald" | "amber" | "rose" =
    modo === "estoque" ? "blue"
    : modo === "vendas" ? "purple"
    : modo === "custos" ? "emerald"
    : modo === "custos-estoque" ? "amber"
    : "rose";
  const existing =
    modo === "estoque" ? meta
    : modo === "vendas" ? vendasMeta
    : modo === "custos" ? custosMeta
    : modo === "custos-estoque" ? custosEstoqueMeta
    : null; // repasse-ofertas não tem store local: o destino é o banco

  return (
    <div className="space-y-3">
      <div className="min-h-[3.5rem]">
        <h3 className="font-semibold">{cfg.title}</h3>
        <p className="text-xs text-[var(--text-muted)]">{cfg.desc}</p>
      </div>

      <div
        {...getRootProps()}
        className={cn(
          "rounded-xl border-2 border-dashed p-8 text-center transition cursor-pointer",
          isDragActive && tone === "blue" && "border-blue-500 bg-blue-50",
          isDragActive && tone === "purple" && "border-purple-500 bg-purple-50",
          isDragActive && tone === "emerald" && "border-emerald-500 bg-emerald-50",
          isDragActive && tone === "amber" && "border-amber-500 bg-amber-50",
          isDragActive && tone === "rose" && "border-rose-500 bg-rose-50",
          !isDragActive && "border-[var(--border-base)] bg-[var(--bg-surface)]",
          (status === "parsing" || status === "conferindo") && "cursor-wait opacity-60",
        )}
      >
        <input {...getInputProps()} />
        <UploadCloud className="mx-auto h-10 w-10 text-[var(--text-subtle)]" />
        <p className="mt-3 text-sm font-medium">
          {isDragActive ? "Solte aqui" : modo === "custos-estoque" ? "Arraste o PDF ou clique" : "Arraste o XLSX ou clique"}
        </p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">{cfg.hint}</p>
      </div>

      {modo === "repasse-ofertas" && (
        <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          Único upload que <strong>grava no sistema</strong> (os outros ficam só no navegador).
          Abre uma conferência antes: nada é gravado sem sua confirmação.
        </p>
      )}

      {existing && status === "idle" && (
        <div className="rounded-md border border-[var(--border-soft)] bg-[var(--bg-muted)] px-3 py-2 text-xs">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1 text-[var(--text-body)]">
              <p>
                <FileSpreadsheet className="mr-1 inline h-3 w-3" />
                {modo === "estoque" && <>{formatInt(meta!.total_veiculos)} veículos / {formatInt(meta!.total_lojas)} lojas</>}
                {modo === "vendas" && <>{formatInt(vendasMeta!.total_vendas)} vendas acumuladas</>}
                {modo === "custos" && <>{formatInt(custosMeta!.total_vendas)} custos detalhados</>}
                {modo === "custos-estoque" && <>{formatInt(custosEstoqueMeta!.total_veiculos)} carros com markup</>}
              </p>
              {modo === "vendas" && vendasMeta?.periodo_inicio && vendasMeta?.periodo_fim && (
                <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">
                  Período: {new Date(vendasMeta.periodo_inicio).toLocaleDateString("pt-BR")} → {new Date(vendasMeta.periodo_fim).toLocaleDateString("pt-BR")}
                </p>
              )}
              {modo === "custos" && custosMeta?.periodo && (
                <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">{custosMeta.periodo}</p>
              )}
              {modo === "custos-estoque" && custosEstoqueMeta?.filial && (
                <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">
                  {custosEstoqueMeta.filial}
                  {custosEstoqueMeta.data_impressao && ` · ${custosEstoqueMeta.data_impressao.toLocaleDateString("pt-BR")}`}
                </p>
              )}
            </div>
            {modo !== "estoque" && (
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Apagar todo o histórico acumulado de ${modo}? Você precisará re-subir do zero.`)) {
                    if (modo === "vendas") clearVendas();
                    else if (modo === "custos") clearCustos();
                    else clearCustosEstoque();
                  }
                }}
                className="shrink-0 rounded px-2 py-0.5 text-[10px] text-[var(--text-muted)] hover:bg-[var(--bg-app)] hover:text-[var(--text-body)]"
                title="Limpar histórico acumulado"
              >
                Limpar histórico
              </button>
            )}
          </div>
        </div>
      )}

      {fileName && (
        <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] p-3">
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="h-4 w-4 text-[var(--text-muted)]" />
            <div className="flex-1 min-w-0">
              <p className="truncate text-sm font-medium">{fileName}</p>
              {status === "parsing" && (
                <p className="mt-1 flex items-center gap-2 text-xs text-blue-600">
                  <Loader2 className="h-3 w-3 animate-spin" />{" "}
                  {modo === "repasse-ofertas" ? "Conferindo contra o sistema…" : "Parseando…"}
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
                    <CheckCircle2 className="h-3 w-3" />
                    {modo === "repasse-ofertas" ? (
                      <>
                        Sincronizado: {formatInt(resultCount ?? 0)}{" "}
                        {resultCount === 1 ? "carro atualizado" : "carros atualizados"} no sistema.
                      </>
                    ) : (
                      <>
                        {cfg.label} importado ({formatInt(resultCount ?? 0)} registros). Você pode
                        subir o próximo arquivo.
                      </>
                    )}
                  </p>
                  {mergeFeedback && (
                    <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                      Merge incremental: {mergeFeedback}
                    </p>
                  )}
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
            setResultCount(relatorio.resumo.linhas_gravadas);
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
