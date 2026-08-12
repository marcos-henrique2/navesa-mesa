"use client";

/**
 * Relatório "Carros em anúncio" (status='subido') — Stories 1.2 + 1.3.
 *
 * 1.2: tabela filtrável (dias/modelo/ano) + export XLSX/PDF respeitando o filtro.
 * 1.3: badge semáforo (cor da função canônica em oferta=compre_por), simulador de
 *      lance por carro e painel de alertas (prejuízo latente / anúncio / envelhecimento).
 *
 * Toda margem/cor delega ao núcleo `margem-repasse.ts`. Sem contra-proposta
 * automática e sem fluxo de aprovação (decisão do Marcos, fora do sistema).
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Download,
  FileText,
  Filter,
  FilterX,
  Loader2,
  AlertTriangle,
  Clock,
  TrendingDown,
} from "lucide-react";
import { listCarrosEmAnuncio } from "@/lib/repasses/anuncio-queries";
import {
  calcularAlertas,
  filtrarAnuncio,
  type CarroAnuncioItem,
} from "@/lib/repasses/relatorio-anuncio";
import type { SnapshotRecente } from "@/lib/pricing/origem-abaixo-do-custo";
import {
  COR_MARGEM_EMOJI,
  COR_MARGEM_LABEL,
  simularLance,
  type CorMargem,
} from "@/lib/repasses/margem-repasse";
import { gerarRelatorioAnuncioXlsx } from "@/lib/export/relatorio-anuncio-xlsx";
import { gerarRelatorioAnuncioPdf } from "@/lib/export/relatorio-anuncio-pdf";
import { cn, formatBRLCents, formatInt } from "@/lib/utils";
import { parseValorBR } from "@/lib/utils/parse-br";
import { hojeLocal } from "@/lib/utils/data-local";
import { showErrorToast, showSuccessToast } from "@/components/ui/Toast";

/**
 * Explicação do "~" nos dias em repasse. Os dias contam desde a data de subida;
 * nesses carros a data de subida não foi observada — o backfill da migration 027
 * a inferiu da data de marcação, que é anterior. Daí o número poder estar alto.
 */
const TITULO_DIAS_APROXIMADOS =
  "Estimativa. Esse carro é um registro legado: a data em que ele subiu não foi " +
  "registrada na época, então foi inferida a partir da data de marcação. O número " +
  "de dias pode estar alguns dias acima do real.";

export function RelatorioAnuncio() {
  const [itens, setItens] = useState<CarroAnuncioItem[]>([]);
  /** C16 — último snapshot de decisão por repasse. Vazio = comportamento antigo. */
  const [snapshots, setSnapshots] = useState<ReadonlyMap<number, SnapshotRecente>>(new Map());
  const [carregando, setCarregando] = useState(true);
  const [exportando, setExportando] = useState(false);

  // Filtros (Story 1.2)
  const [diasMin, setDiasMin] = useState("");
  const [modelo, setModelo] = useState("");
  const [ano, setAno] = useState("");

  useEffect(() => {
    listCarrosEmAnuncio()
      .then((r) => {
        setItens(r.itens);
        setSnapshots(r.snapshots);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        showErrorToast(`Erro ao carregar carros em anúncio: ${msg}`);
      })
      .finally(() => setCarregando(false));
  }, []);

  const filtrados = useMemo(() => {
    const diasNum = diasMin.trim() === "" ? null : Number(diasMin);
    const anoNum = ano.trim() === "" ? null : Number(ano);
    return filtrarAnuncio(itens, {
      diasMin: diasNum != null && Number.isFinite(diasNum) ? diasNum : null,
      modelo: modelo.trim() || null,
      ano: anoNum != null && Number.isFinite(anoNum) ? anoNum : null,
    });
  }, [itens, diasMin, modelo, ano]);

  const alertas = useMemo(() => calcularAlertas(itens, snapshots), [itens, snapshots]);
  const temFiltro = diasMin.trim() !== "" || modelo.trim() !== "" || ano.trim() !== "";

  function limparFiltros() {
    setDiasMin("");
    setModelo("");
    setAno("");
  }

  async function exportarXlsx() {
    if (exportando) return;
    setExportando(true);
    try {
      const buf = await gerarRelatorioAnuncioXlsx(filtrados);
      baixar(
        new Blob([new Uint8Array(buf)], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
        `navesa-carros-anuncio-${hojeISO()}.xlsx`,
      );
      showSuccessToast(`${filtrados.length} carro(s) exportado(s) em XLSX.`);
    } catch (err) {
      showErrorToast(`Erro ao gerar XLSX: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExportando(false);
    }
  }

  function exportarPdf() {
    if (exportando) return;
    setExportando(true);
    try {
      baixar(gerarRelatorioAnuncioPdf(filtrados), `navesa-carros-anuncio-${hojeISO()}.pdf`);
      showSuccessToast(`${filtrados.length} carro(s) exportado(s) em PDF.`);
    } catch (err) {
      showErrorToast(`Erro ao gerar PDF: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExportando(false);
    }
  }

  if (carregando) {
    return (
      <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando carros em anúncio...
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Link
        href="/repasses"
        className="inline-flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text-strong)]"
      >
        <ArrowLeft className="h-4 w-4" /> Voltar pro fluxo de repasse
      </Link>

      <PainelAlertas alertas={alertas} />

      {/* Filtros + export */}
      <div className="flex flex-wrap items-end gap-3">
        <CampoFiltro label="Dias no repasse (mín.)">
          <input
            type="number"
            min={0}
            value={diasMin}
            onChange={(e) => setDiasMin(e.target.value)}
            placeholder="ex.: 60"
            className={INPUT_CLASS}
          />
        </CampoFiltro>
        <CampoFiltro label="Modelo">
          <input
            type="text"
            value={modelo}
            onChange={(e) => setModelo(e.target.value)}
            placeholder="ex.: onix"
            className={INPUT_CLASS}
          />
        </CampoFiltro>
        <CampoFiltro label="Ano">
          <input
            type="number"
            value={ano}
            onChange={(e) => setAno(e.target.value)}
            placeholder="ex.: 2021"
            className={INPUT_CLASS}
          />
        </CampoFiltro>

        {temFiltro && (
          <button
            onClick={limparFiltros}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-base)] px-3 py-1.5 text-sm text-[var(--text-muted)] hover:bg-[var(--bg-muted)]"
          >
            <FilterX className="h-4 w-4" /> Limpar
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <span className="text-sm text-[var(--text-muted)]">
            <Filter className="mr-1 inline h-3.5 w-3.5" />
            {filtrados.length} de {itens.length}
          </span>
          <button
            onClick={exportarXlsx}
            disabled={exportando}
            className="inline-flex items-center gap-1.5 rounded-md bg-[var(--brand-600)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--brand-700)] disabled:opacity-50"
          >
            {exportando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            XLSX
          </button>
          <button
            onClick={exportarPdf}
            disabled={exportando}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-base)] px-3 py-1.5 text-sm font-medium text-[var(--text-strong)] hover:bg-[var(--bg-muted)] disabled:opacity-50"
          >
            <FileText className="h-4 w-4" /> PDF
          </button>
        </div>
      </div>

      <TabelaAnuncio itens={filtrados} />
    </div>
  );
}

// ─── Painel de alertas (Story 1.3) ───────────────────────────────────────────

function PainelAlertas({ alertas }: { alertas: ReturnType<typeof calcularAlertas> }) {
  const { prejuizoLatente, prejuizoNoAnuncio, envelhecimento } = alertas;
  if (prejuizoLatente.length === 0 && envelhecimento.length === 0) return null;

  const piores = new Set(prejuizoNoAnuncio.map((i) => i.id));

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {prejuizoLatente.length > 0 && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950/40">
          <div className="flex items-center gap-2 text-sm font-semibold text-red-700 dark:text-red-300">
            <TrendingDown className="h-4 w-4" />
            Prejuízo latente — {prejuizoLatente.length} carro(s)
          </div>
          <p className="mt-1 text-xs text-red-600/90 dark:text-red-400/90">
            Mínimo abaixo do custo real. Os piores anunciam abaixo do custo (
            <AlertTriangle className="inline h-3 w-3" /> destacados).
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {prejuizoLatente.map((it) => (
              <li
                key={it.id}
                className={cn(
                  "rounded px-1.5 py-0.5 font-mono text-[11px]",
                  piores.has(it.id)
                    ? "bg-red-600 font-bold text-white"
                    : "bg-red-200 text-red-800 dark:bg-red-900 dark:text-red-200",
                )}
                title={piores.has(it.id) ? "Compre-por abaixo do custo" : "Mínimo abaixo do custo"}
              >
                {it.placa}
              </li>
            ))}
          </ul>
        </div>
      )}

      {envelhecimento.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/40">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-300">
            <Clock className="h-4 w-4" />
            Envelhecimento — {envelhecimento.length} carro(s) &gt; 60 dias
          </div>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {envelhecimento.map((it) => (
              <li
                key={it.id}
                className="rounded bg-amber-200 px-1.5 py-0.5 font-mono text-[11px] text-amber-800 dark:bg-amber-900 dark:text-amber-200"
                title={
                  it.diasAproximados
                    ? `~${it.diasNoRepasse} dias no ar. ${TITULO_DIAS_APROXIMADOS}`
                    : `${it.diasNoRepasse} dias no ar`
                }
              >
                {it.placa} · {it.diasAproximados ? "~" : ""}
                {it.diasNoRepasse}d
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Tabela ──────────────────────────────────────────────────────────────────

function TabelaAnuncio({ itens }: { itens: ReadonlyArray<CarroAnuncioItem> }) {
  if (itens.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--border-base)] p-8 text-center text-sm text-[var(--text-muted)]">
        Nenhum carro em anúncio para o filtro atual.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border-base)]">
      <table className="min-w-max text-sm">
        <thead>
          <tr className="border-b border-[var(--border-base)] bg-[var(--bg-muted)] text-left text-xs text-[var(--text-muted)]">
            <Th>Semáforo</Th>
            <Th>Placa</Th>
            <Th>Modelo</Th>
            <Th>Ano</Th>
            <Th className="text-right">KM</Th>
            <Th className="text-right">Custo real</Th>
            <Th className="text-right">Mínimo</Th>
            <Th className="text-right">Compre por</Th>
            <Th className="text-right">Dias</Th>
            <Th className="text-right">FIPE/Web</Th>
            <Th className="text-right">Inter.</Th>
            <Th className="text-right">Margem mín.</Th>
            <Th className="text-right">Margem c/por</Th>
            <Th>Simulador de lance</Th>
          </tr>
        </thead>
        <tbody>
          {itens.map((it) => (
            <LinhaAnuncio key={it.id} it={it} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LinhaAnuncio({ it }: { it: CarroAnuncioItem }) {
  return (
    <tr className="border-b border-[var(--border-base)] last:border-0 hover:bg-[var(--bg-muted)]">
      <Td>
        <SemaforoBadge cor={it.cor} />
      </Td>
      <Td className="font-mono font-semibold">{it.placa}</Td>
      <Td>{it.modelo}</Td>
      <Td className="text-xs">{it.anoLabel}</Td>
      <Td className="text-right tabular-nums">{formatInt(it.km)}</Td>
      <Td className="text-right tabular-nums">{formatBRLCents(it.custoReal)}</Td>
      <Td className="text-right tabular-nums">{formatBRLCents(it.valorMinimo)}</Td>
      <Td className="text-right tabular-nums">{formatBRLCents(it.valorComprePor)}</Td>
      <Td className="text-right tabular-nums">
        <DiasNoRepasse it={it} />
      </Td>
      <Td className="text-right tabular-nums">{it.fipe == null ? "—" : formatBRLCents(it.fipe)}</Td>
      <Td className="text-right tabular-nums">{it.interessados}</Td>
      <Td className="text-right tabular-nums">
        <MargemCell valor={it.margemMinimoValor} pct={it.margemMinimoPct} incompleto={it.incompleto} />
      </Td>
      <Td className="text-right tabular-nums">
        <MargemCell valor={it.margemComPorValor} pct={it.margemComPorPct} incompleto={it.incompleto} />
      </Td>
      <Td>
        <SimuladorCell it={it} />
      </Td>
    </tr>
  );
}

/**
 * Dias em repasse — contados desde a data de subida (`data_subido`), ou seja,
 * desde que o carro está NO AR. Quando essa data veio do backfill da migration
 * 027 (registro legado, inferida da data de marcação), prefixa "~" e explica no
 * title: número estimado não pode se passar por número medido.
 */
function DiasNoRepasse({ it }: { it: CarroAnuncioItem }) {
  if (it.diasNoRepasse == null) return <>—</>;
  if (!it.diasAproximados) return <>{it.diasNoRepasse}d</>;
  return (
    <span
      className="cursor-help text-[var(--text-muted)]"
      title={TITULO_DIAS_APROXIMADOS}
    >
      ~{it.diasNoRepasse}d
    </span>
  );
}

function MargemCell({
  valor,
  pct,
  incompleto,
}: {
  valor: number | null;
  pct: number | null;
  incompleto: boolean;
}) {
  if (incompleto) {
    return <span className="text-xs italic text-[var(--text-subtle)]">indisponível</span>;
  }
  const neg = valor != null && valor < 0;
  return (
    <div className={cn("leading-tight", neg ? "text-red-600 dark:text-red-400" : "text-[var(--text-strong)]")}>
      <div className="font-medium">{formatBRLCents(valor)}</div>
      <div className="text-[10px] text-[var(--text-muted)]">{pct == null ? "—" : `${pct.toFixed(1)}%`}</div>
    </div>
  );
}

// ─── Simulador de lance (Story 1.3) ──────────────────────────────────────────

function SimuladorCell({ it }: { it: CarroAnuncioItem }) {
  const [raw, setRaw] = useState("");

  const sim = useMemo(() => {
    if (raw.trim() === "") return null;
    const oferta = parseValorBR(raw);
    return simularLance(oferta, {
      custoReal: it.custoReal,
      minimo: it.valorMinimo,
      comprePor: it.valorComprePor,
    });
  }, [raw, it.custoReal, it.valorMinimo, it.valorComprePor]);

  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        inputMode="decimal"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        placeholder="oferta R$"
        className="w-24 rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-2 py-1 text-right text-xs tabular-nums text-[var(--text-body)] focus:border-[var(--brand-500)] focus:outline-none"
      />
      {sim && (
        <div className="min-w-[150px] text-xs leading-tight">
          {!sim.valido ? (
            <span className="italic text-[var(--text-subtle)]">{sim.motivo}</span>
          ) : !sim.completo ? (
            <span className="italic text-[var(--text-subtle)]">{sim.motivo}</span>
          ) : (
            <div className="flex items-center gap-1.5">
              <SemaforoBadge cor={sim.cor} compact />
              <div>
                <span
                  className={cn(
                    "font-semibold tabular-nums",
                    sim.abaixoDoCusto ? "text-red-600 dark:text-red-400" : "text-[var(--text-strong)]",
                  )}
                >
                  {formatBRLCents(sim.margemValor)}
                </span>
                <span className="ml-1 text-[10px] text-[var(--text-muted)]">
                  {sim.margemPct == null ? "" : `(${sim.margemPct.toFixed(1)}%)`}
                </span>
                <div className="flex gap-1">
                  {sim.abaixoDoCusto && (
                    <span className="rounded bg-red-600 px-1 text-[9px] font-bold text-white">
                      PREJUÍZO
                    </span>
                  )}
                  {sim.abaixoDoMinimo && !sim.abaixoDoCusto && (
                    <span className="rounded bg-orange-500 px-1 text-[9px] font-bold text-white">
                      abaixo do mínimo
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Semáforo badge ──────────────────────────────────────────────────────────

const COR_CLASSES: Record<CorMargem, string> = {
  verde: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  amarelo: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300",
  laranja: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
  vermelho: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  neutro: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
};

function SemaforoBadge({ cor, compact = false }: { cor: CorMargem; compact?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-medium",
        compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs",
        COR_CLASSES[cor],
      )}
      title={COR_MARGEM_LABEL[cor]}
    >
      <span aria-hidden>{COR_MARGEM_EMOJI[cor]}</span>
      {!compact && <span className="sr-only">{COR_MARGEM_LABEL[cor]}</span>}
    </span>
  );
}

// ─── Helpers de layout ───────────────────────────────────────────────────────

const INPUT_CLASS =
  "w-32 rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-2 py-1.5 text-sm text-[var(--text-body)] focus:border-[var(--brand-500)] focus:outline-none";

function CampoFiltro({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-[var(--text-muted)]">{label}</span>
      {children}
    </label>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={cn("px-3 py-2 font-medium", className)}>{children}</th>;
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn("px-3 py-2", className)}>{children}</td>;
}

/** Data local pro nome do arquivo exportado — o Marcos espera o dia DELE. */
function hojeISO(): string {
  return hojeLocal();
}

/** Dispara o download de um Blob no navegador. */
function baixar(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
