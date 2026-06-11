"use client";
/* eslint-disable react-hooks/set-state-in-effect --
 * Carga inicial async via Supabase (repasse + gastos + documentos). É o mesmo
 * padrão do AppShell/PrecificacaoBlock: o effect dispara fetch e o estado é
 * setado quando a Promise resolve. A regra é conservadora demais pra esse uso.
 */

/**
 * Tela de detalhe de um repasse. Reúne 4 blocos editáveis (veículo,
 * valores, gastos, documentação) + bloco lateral de marketing.
 *
 * Estado:
 *   - repasse + lista de gastos + lista de documentos carregados em paralelo
 *   - cada bloco tem seu próprio "salvando" pra feedback granular
 *   - patches otimistas no estado local (rollback em caso de erro do servidor)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, Loader2 } from "lucide-react";
import {
  addGasto,
  getRepasse,
  listDocumentos,
  listGastos,
  marcarNaoVendido,
  marcarVendido,
  removeGasto,
  updateRepasse,
  upsertDocumento,
} from "@/lib/repasses/queries";
import {
  CANAL_LABEL,
  DOCUMENTO_TIPO_LABEL,
  DOCUMENTOS_PADRAO,
  DOC_STATUS_LABEL,
  GASTO_TIPO_LABEL,
  STATUS_LABEL,
} from "@/lib/repasses/types";
import type {
  DocStatus,
  DocumentoTipo,
  GastoTipo,
  Repasse,
  RepasseDocumento,
  RepasseGasto,
  RepasseStatus,
} from "@/lib/repasses/types";
import {
  calcularCustoTotal,
  calcularMargemPct,
  calcularMargemReal,
  calcularTotalGastos,
} from "@/lib/repasses/calc";
import { gerarRelatorioRepasseXlsx } from "@/lib/export/relatorio-repasse-xlsx";
import { cn, formatBRL } from "@/lib/utils";
import { showErrorToast, showSuccessToast } from "@/components/ui/Toast";
import { MarcarVendidoModal } from "./MarcarVendidoModal";
import { MarcarNaoVendidoModal } from "./MarcarNaoVendidoModal";

export function RepasseDetalhe({ id }: { id: number }) {
  const [repasse, setRepasse] = useState<Repasse | null>(null);
  const [gastos, setGastos] = useState<RepasseGasto[]>([]);
  const [documentos, setDocumentos] = useState<RepasseDocumento[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [modalVendido, setModalVendido] = useState(false);
  const [modalNaoVendido, setModalNaoVendido] = useState(false);
  const [exportando, setExportando] = useState(false);

  const recarregar = useCallback(async () => {
    if (!Number.isFinite(id) || id <= 0) {
      setErro("ID inválido.");
      setCarregando(false);
      return;
    }
    try {
      const [r, g, d] = await Promise.all([
        getRepasse(id),
        listGastos(id),
        listDocumentos(id),
      ]);
      if (!r) {
        setErro(`Repasse #${id} não encontrado.`);
        setRepasse(null);
      } else {
        setRepasse(r);
        setGastos(g);
        // Garante presença dos 5 docs padrão na UI (mesmo se algum não foi criado por falha)
        setDocumentos(mergeDocumentosPadrao(d));
        setErro(null);
      }
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setCarregando(false);
    }
  }, [id]);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  const totais = useMemo(() => {
    if (!repasse) return null;
    return {
      totalGastos: calcularTotalGastos(gastos),
      custoTotal: calcularCustoTotal(repasse, gastos),
      margemReal: calcularMargemReal(repasse, gastos),
      margemPct: calcularMargemPct(repasse, gastos),
    };
  }, [repasse, gastos]);

  async function handleBaixarXlsx() {
    if (!repasse || exportando) return;
    setExportando(true);
    try {
      const buf = await gerarRelatorioRepasseXlsx(repasse, gastos, documentos);
      const blob = new Blob([new Uint8Array(buf)], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `repasse-${repasse.placa}-${repasse.id}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showSuccessToast("Planilha baixada.");
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : String(err));
    } finally {
      setExportando(false);
    }
  }

  if (carregando) {
    return (
      <div className="inline-flex items-center gap-2 text-sm text-[var(--text-muted)]">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando repasse...
      </div>
    );
  }

  if (erro || !repasse || !totais) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--border-base)] bg-[var(--bg-surface)] p-12 text-center">
        <p className="text-[var(--text-muted)]">{erro ?? "Repasse não encontrado."}</p>
        <Link
          href="/repasses"
          className="mt-3 inline-block rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Voltar pra lista
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/repasses"
          className="inline-flex items-center gap-1 text-sm text-[var(--text-muted)] hover:text-[var(--text-strong)]"
        >
          <ArrowLeft className="h-3 w-3" /> voltar pra lista de repasses
        </Link>
        <div className="mt-3 flex flex-wrap items-baseline gap-3">
          <h1 className="text-2xl font-bold">{repasse.modelo}</h1>
          <span className="font-mono text-sm text-[var(--text-muted)]">{repasse.placa}</span>
          <StatusChip status={repasse.status} />
          <DocStatusChip status={repasse.documentacao_status} />
        </div>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          #{repasse.id} · Canal {CANAL_LABEL[repasse.canal] ?? repasse.canal} · Subiu em {formatDataBR(repasse.data_subiu)}
        </p>
      </div>

      {/* Ações principais */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleBaixarXlsx}
          disabled={exportando}
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-3 py-1.5 text-sm text-[var(--text-body)] hover:bg-[var(--bg-muted)] disabled:opacity-50"
        >
          {exportando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Baixar planilha XLSX
        </button>
        {repasse.status === "subido" && (
          <>
            <button
              type="button"
              onClick={() => setModalVendido(true)}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
            >
              Marcar como vendido
            </button>
            <button
              type="button"
              onClick={() => setModalNaoVendido(true)}
              className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
            >
              Marcar como não vendido
            </button>
          </>
        )}
      </div>

      {/* Bloco 1: Veículo (read-only) */}
      <Card title="Veículo">
        <div className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
          <Row label="Marca" value={repasse.marca ?? "—"} />
          <Row label="Modelo" value={repasse.modelo} />
          <Row
            label="Ano fab./mod."
            value={`${repasse.ano_fabricacao ?? "—"} / ${repasse.ano_modelo ?? "—"}`}
          />
          <Row label="Cor" value={repasse.cor ?? "—"} />
          <Row label="KM" value={repasse.km != null ? repasse.km.toLocaleString("pt-BR") : "—"} />
          <Row label="Loja origem" value={repasse.loja_origem ?? "—"} />
          <Row label="Pátio" value={repasse.patio_origem ?? "—"} />
          <Row label="Aquisição" value={formatBRL(repasse.valor_aquisicao)} />
        </div>
        <p className="mt-3 text-xs text-[var(--text-subtle)]">
          Chassi <span className="font-mono">{repasse.chassi}</span> ·{" "}
          <Link
            href={`/veiculos/${repasse.chassi}`}
            className="text-[var(--brand-700)] hover:underline"
          >
            ver no estoque
          </Link>
        </p>
      </Card>

      {/* Bloco 2: Valores */}
      <ValoresCard
        repasse={repasse}
        totais={totais}
        onPatch={async (patch) => {
          const prev = repasse;
          setRepasse({ ...repasse, ...patch });
          try {
            const updated = await updateRepasse(repasse.id, patch);
            setRepasse(updated);
            showSuccessToast("Valores salvos.");
          } catch (err) {
            setRepasse(prev);
            showErrorToast(err instanceof Error ? err.message : String(err));
          }
        }}
      />

      {/* Bloco 3: Gastos */}
      <GastosCard
        gastos={gastos}
        onAdd={async (input) => {
          try {
            const novo = await addGasto(repasse.id, input);
            setGastos((g) => [...g, novo]);
            showSuccessToast("Gasto adicionado.");
          } catch (err) {
            showErrorToast(err instanceof Error ? err.message : String(err));
          }
        }}
        onRemove={async (gastoId) => {
          const prev = gastos;
          setGastos((g) => g.filter((x) => x.id !== gastoId));
          try {
            await removeGasto(gastoId);
          } catch (err) {
            setGastos(prev);
            showErrorToast(err instanceof Error ? err.message : String(err));
          }
        }}
      />

      {/* Bloco 4: Documentação */}
      <DocsCard
        documentos={documentos}
        onChange={async (tipo, patch) => {
          const prev = documentos;
          setDocumentos((ds) =>
            ds.map((d) => (d.tipo === tipo ? { ...d, ...patch } : d)),
          );
          try {
            const saved = await upsertDocumento(repasse.id, tipo, patch);
            setDocumentos((ds) => ds.map((d) => (d.tipo === tipo ? saved : d)));
          } catch (err) {
            setDocumentos(prev);
            showErrorToast(err instanceof Error ? err.message : String(err));
          }
        }}
      />

      {/* Bloco 5: Marketing (Sprint 3 vai usar) */}
      <MarketingCard
        repasse={repasse}
        onPatch={async (patch) => {
          const prev = repasse;
          setRepasse({ ...repasse, ...patch });
          try {
            const updated = await updateRepasse(repasse.id, patch);
            setRepasse(updated);
            showSuccessToast("Marketing salvo.");
          } catch (err) {
            setRepasse(prev);
            showErrorToast(err instanceof Error ? err.message : String(err));
          }
        }}
      />

      {modalVendido && (
        <MarcarVendidoModal
          repasse={repasse}
          onClose={() => setModalVendido(false)}
          onConfirm={async (payload) => {
            try {
              const updated = await marcarVendido(repasse.id, payload);
              setRepasse(updated);
              setModalVendido(false);
              showSuccessToast("Marcado como vendido.");
            } catch (err) {
              showErrorToast(err instanceof Error ? err.message : String(err));
            }
          }}
        />
      )}

      {modalNaoVendido && (
        <MarcarNaoVendidoModal
          onClose={() => setModalNaoVendido(false)}
          onConfirm={async (motivo) => {
            try {
              const updated = await marcarNaoVendido(repasse.id, motivo);
              setRepasse(updated);
              setModalNaoVendido(false);
              showSuccessToast("Marcado como não vendido.");
            } catch (err) {
              showErrorToast(err instanceof Error ? err.message : String(err));
            }
          }}
        />
      )}
    </div>
  );
}

// ─── Bloco Valores ────────────────────────────────────────────────────────────

function ValoresCard({
  repasse,
  totais,
  onPatch,
}: {
  repasse: Repasse;
  totais: {
    totalGastos: number;
    custoTotal: number | null;
    margemReal: number | null;
    margemPct: number | null;
  };
  onPatch: (patch: { valor_subiu?: number | null; valor_minimo?: number | null }) => Promise<void>;
}) {
  const [valorSubiu, setValorSubiu] = useState<string>(
    repasse.valor_subiu != null ? String(repasse.valor_subiu) : "",
  );
  const [valorMinimo, setValorMinimo] = useState<string>(
    repasse.valor_minimo != null ? String(repasse.valor_minimo) : "",
  );
  const [salvando, setSalvando] = useState(false);

  const subiuDirty =
    parseValor(valorSubiu) !== repasse.valor_subiu ||
    parseValor(valorMinimo) !== repasse.valor_minimo;

  async function handleSalvar() {
    if (!subiuDirty || salvando) return;
    setSalvando(true);
    await onPatch({
      valor_subiu: parseValor(valorSubiu),
      valor_minimo: parseValor(valorMinimo),
    });
    setSalvando(false);
  }

  return (
    <Card title="Valores">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-3">
          <NumberField label="Valor subiu (R$)" value={valorSubiu} onChange={setValorSubiu} />
          <NumberField label="Valor mínimo (R$)" value={valorMinimo} onChange={setValorMinimo} />
          <button
            type="button"
            onClick={handleSalvar}
            disabled={!subiuDirty || salvando}
            className="inline-flex items-center gap-1.5 rounded-md bg-[var(--brand-700)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--brand-800)] disabled:opacity-50"
          >
            {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
            Salvar valores
          </button>
        </div>

        <div className="space-y-1.5 rounded-md border border-[var(--border-soft)] bg-[var(--bg-muted)] p-3 text-sm">
          <Row label="Aquisição" value={formatBRL(repasse.valor_aquisicao)} muted />
          <Row label="+ Gastos" value={formatBRL(totais.totalGastos)} muted />
          <Row label="= Custo total" value={formatBRL(totais.custoTotal)} bold />
          <hr className="my-1 border-[var(--border-soft)]" />
          <Row label="Valor vendido" value={formatBRL(repasse.valor_vendido)} />
          <Row
            label="Margem real"
            value={
              totais.margemReal == null
                ? "—"
                : `${formatBRL(totais.margemReal)} ${totais.margemPct != null ? `(${totais.margemPct.toFixed(1)}%)` : ""}`
            }
            tone={
              totais.margemReal == null
                ? undefined
                : totais.margemReal < 0
                  ? "bad"
                  : "good"
            }
            bold
          />
        </div>
      </div>
    </Card>
  );
}

// ─── Bloco Gastos ─────────────────────────────────────────────────────────────

function GastosCard({
  gastos,
  onAdd,
  onRemove,
}: {
  gastos: RepasseGasto[];
  onAdd: (input: { tipo: GastoTipo; descricao: string; valor: number; data: string; observacao: string | null }) => Promise<void>;
  onRemove: (id: number) => Promise<void>;
}) {
  const [mostrarForm, setMostrarForm] = useState(false);
  const total = useMemo(() => gastos.reduce((s, g) => s + g.valor, 0), [gastos]);

  return (
    <Card title={`Gastos (${gastos.length})`} subtitle={`Total: ${formatBRL(total)}`}>
      {gastos.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">Nenhum gasto registrado.</p>
      ) : (
        <ul className="divide-y divide-[var(--border-soft)] text-sm">
          {gastos.map((g) => (
            <li key={g.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate font-medium text-[var(--text-strong)]">{g.descricao}</p>
                <p className="text-[11px] text-[var(--text-muted)]">
                  {GASTO_TIPO_LABEL[g.tipo]} · {formatDataBR(g.data)}
                  {g.observacao && ` · ${g.observacao}`}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="tabular-nums">{formatBRL(g.valor)}</span>
                <button
                  type="button"
                  onClick={() => onRemove(g.id)}
                  className="text-xs text-red-700 hover:underline dark:text-red-400"
                  aria-label="Remover gasto"
                >
                  Remover
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {mostrarForm ? (
        <GastoForm
          onCancel={() => setMostrarForm(false)}
          onSubmit={async (input) => {
            await onAdd(input);
            setMostrarForm(false);
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setMostrarForm(true)}
          className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-dashed border-[var(--border-base)] bg-[var(--bg-surface)] px-3 py-1.5 text-sm text-[var(--text-body)] hover:bg-[var(--bg-muted)]"
        >
          + Novo gasto
        </button>
      )}
    </Card>
  );
}

function GastoForm({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (input: { tipo: GastoTipo; descricao: string; valor: number; data: string; observacao: string | null }) => Promise<void>;
}) {
  const [tipo, setTipo] = useState<GastoTipo>("outro");
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10));
  const [observacao, setObservacao] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (salvando) return;
    const v = parseValor(valor);
    if (!descricao.trim() || v == null || v <= 0) {
      showErrorToast("Descrição e valor (>0) são obrigatórios.");
      return;
    }
    setSalvando(true);
    await onSubmit({
      tipo,
      descricao: descricao.trim(),
      valor: v,
      data,
      observacao: observacao.trim() || null,
    });
    setSalvando(false);
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 grid gap-3 rounded-md border border-[var(--border-soft)] bg-[var(--bg-muted)] p-3 sm:grid-cols-2">
      <label className="text-xs">
        <span className="text-[var(--text-muted)]">Tipo</span>
        <select
          value={tipo}
          onChange={(e) => setTipo(e.target.value as GastoTipo)}
          className="mt-1 w-full rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-2 py-1.5 text-sm"
        >
          {Object.entries(GASTO_TIPO_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>

      <label className="text-xs">
        <span className="text-[var(--text-muted)]">Data</span>
        <input
          type="date"
          value={data}
          onChange={(e) => setData(e.target.value)}
          className="mt-1 w-full rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-2 py-1.5 text-sm"
        />
      </label>

      <label className="text-xs sm:col-span-2">
        <span className="text-[var(--text-muted)]">Descrição</span>
        <input
          type="text"
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          placeholder="Ex: troca de pastilhas de freio"
          className="mt-1 w-full rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-2 py-1.5 text-sm"
        />
      </label>

      <label className="text-xs">
        <span className="text-[var(--text-muted)]">Valor (R$)</span>
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder="0,00"
          className="mt-1 w-full rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-2 py-1.5 text-sm tabular-nums"
        />
      </label>

      <label className="text-xs">
        <span className="text-[var(--text-muted)]">Observação (opcional)</span>
        <input
          type="text"
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          className="mt-1 w-full rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-2 py-1.5 text-sm"
        />
      </label>

      <div className="flex justify-end gap-2 sm:col-span-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={salvando}
          className="rounded-md border border-[var(--border-base)] px-3 py-1.5 text-xs text-[var(--text-body)] hover:bg-[var(--bg-surface)]"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={salvando}
          className="inline-flex items-center gap-1.5 rounded-md bg-[var(--brand-700)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--brand-800)] disabled:opacity-50"
        >
          {salvando && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Adicionar
        </button>
      </div>
    </form>
  );
}

// ─── Bloco Documentação ──────────────────────────────────────────────────────

function DocsCard({
  documentos,
  onChange,
}: {
  documentos: RepasseDocumento[];
  onChange: (
    tipo: DocumentoTipo,
    patch: { status: DocStatus; observacao?: string | null; data_verificacao?: string | null },
  ) => Promise<void>;
}) {
  return (
    <Card title="Documentação">
      <ul className="space-y-2 text-sm">
        {documentos.map((d) => (
          <DocRow key={d.tipo} doc={d} onChange={(patch) => onChange(d.tipo, patch)} />
        ))}
      </ul>
    </Card>
  );
}

function DocRow({
  doc,
  onChange,
}: {
  doc: RepasseDocumento;
  onChange: (patch: { status: DocStatus; observacao?: string | null; data_verificacao?: string | null }) => Promise<void>;
}) {
  const [observacao, setObservacao] = useState(doc.observacao ?? "");

  // Persiste observação no blur (evita 1 request por tecla)
  function handleObservacaoBlur() {
    if ((doc.observacao ?? "") === observacao) return;
    void onChange({
      status: doc.status,
      observacao: observacao.trim() || null,
      data_verificacao: doc.data_verificacao,
    });
  }

  return (
    <li className="grid grid-cols-1 items-center gap-2 rounded-md border border-[var(--border-soft)] bg-[var(--bg-surface)] p-2 sm:grid-cols-[160px_140px_1fr]">
      <span className="font-medium text-[var(--text-strong)]">{DOCUMENTO_TIPO_LABEL[doc.tipo]}</span>
      <select
        value={doc.status}
        onChange={(e) =>
          onChange({
            status: e.target.value as DocStatus,
            observacao: observacao.trim() || null,
            data_verificacao: new Date().toISOString().slice(0, 10),
          })
        }
        className="rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-2 py-1 text-xs"
      >
        <option value="pendente">⏳ Pendente</option>
        <option value="ok">✅ OK</option>
        <option value="irregular">❌ Irregular</option>
      </select>
      <input
        type="text"
        value={observacao}
        onChange={(e) => setObservacao(e.target.value)}
        onBlur={handleObservacaoBlur}
        placeholder="Observação (opcional)"
        className="rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-2 py-1 text-xs"
      />
    </li>
  );
}

// ─── Bloco Marketing ──────────────────────────────────────────────────────────

function MarketingCard({
  repasse,
  onPatch,
}: {
  repasse: Repasse;
  onPatch: (patch: { descricao?: string | null; opcionais?: string | null; observacoes?: string | null }) => Promise<void>;
}) {
  const [descricao, setDescricao] = useState(repasse.descricao ?? "");
  const [opcionais, setOpcionais] = useState(repasse.opcionais ?? "");
  const [observacoes, setObservacoes] = useState(repasse.observacoes ?? "");
  const [salvando, setSalvando] = useState(false);

  const dirty =
    (repasse.descricao ?? "") !== descricao ||
    (repasse.opcionais ?? "") !== opcionais ||
    (repasse.observacoes ?? "") !== observacoes;

  async function handleSalvar() {
    if (!dirty || salvando) return;
    setSalvando(true);
    await onPatch({
      descricao: descricao.trim() || null,
      opcionais: opcionais.trim() || null,
      observacoes: observacoes.trim() || null,
    });
    setSalvando(false);
  }

  return (
    <Card title="Marketing & observações" subtitle="Conteúdo do anúncio">
      <div className="space-y-3 text-sm">
        <TextArea label="Descrição" value={descricao} onChange={setDescricao} placeholder="Texto principal do anúncio" />
        <TextArea label="Opcionais" value={opcionais} onChange={setOpcionais} placeholder="Ex: air bag, ar cond., câmera de ré..." />
        <TextArea label="Observações internas" value={observacoes} onChange={setObservacoes} placeholder="Anotações que ficam só com você" />
        <button
          type="button"
          onClick={handleSalvar}
          disabled={!dirty || salvando}
          className="inline-flex items-center gap-1.5 rounded-md bg-[var(--brand-700)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--brand-800)] disabled:opacity-50"
        >
          {salvando && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Salvar
        </button>
      </div>
    </Card>
  );
}

// ─── Helpers UI ───────────────────────────────────────────────────────────────

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] p-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="font-semibold text-[var(--text-strong)]">{title}</h3>
        {subtitle && <span className="text-xs text-[var(--text-muted)]">{subtitle}</span>}
      </div>
      {children}
    </div>
  );
}

function Row({
  label,
  value,
  bold,
  muted,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  bold?: boolean;
  muted?: boolean;
  tone?: "good" | "bad";
}) {
  const tc =
    tone === "good"
      ? "text-emerald-700 dark:text-emerald-400"
      : tone === "bad"
        ? "text-red-700 dark:text-red-400"
        : muted
          ? "text-[var(--text-muted)]"
          : "text-[var(--text-body)]";
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-[var(--text-muted)]">{label}</span>
      <span className={cn("tabular-nums", bold && "font-semibold", tc)}>{value}</span>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block text-xs">
      <span className="text-[var(--text-muted)]">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0,00"
        className="mt-1 w-full rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-2 py-1.5 text-sm tabular-nums"
      />
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block text-xs">
      <span className="text-[var(--text-muted)]">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="mt-1 w-full rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-2 py-1.5 text-sm"
      />
    </label>
  );
}

function StatusChip({ status }: { status: RepasseStatus }) {
  const cor =
    status === "vendido"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
      : status === "nao_vendido"
        ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
        : status === "cancelado"
          ? "bg-[var(--bg-muted)] text-[var(--text-muted)]"
          : "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300";
  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-semibold", cor)}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function DocStatusChip({ status }: { status: DocStatus }) {
  const cor =
    status === "ok"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
      : status === "irregular"
        ? "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300"
        : "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300";
  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-semibold", cor)}>
      Doc {DOC_STATUS_LABEL[status]}
    </span>
  );
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function parseValor(s: string): number | null {
  if (s.trim() === "") return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function formatDataBR(yyyymmdd: string | null): string {
  if (!yyyymmdd) return "—";
  const [y, m, d] = yyyymmdd.split("-");
  if (!y || !m || !d) return yyyymmdd;
  return `${d}/${m}/${y}`;
}

/** Garante que os 5 itens padrão estejam presentes na UI mesmo se faltar no banco. */
function mergeDocumentosPadrao(docs: RepasseDocumento[]): RepasseDocumento[] {
  const porTipo = new Map(docs.map((d) => [d.tipo, d]));
  const result: RepasseDocumento[] = [];
  for (const tipo of DOCUMENTOS_PADRAO) {
    const existente = porTipo.get(tipo);
    if (existente) {
      result.push(existente);
    } else {
      // Placeholder local (sem id ainda — vai ser criado no primeiro upsert)
      result.push({
        id: 0,
        repasse_id: docs[0]?.repasse_id ?? 0,
        tipo,
        status: "pendente",
        observacao: null,
        data_verificacao: null,
        criado_em: "",
        atualizado_em: "",
      });
    }
  }
  return result;
}
