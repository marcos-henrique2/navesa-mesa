"use client";

/**
 * Modal pra registrar o desfecho "vendido" de um repasse.
 *
 * Captura valor de venda (parser BR), data da venda (default hoje) e comprador
 * (opcional). Mostra a margem prévia AO VIVO sobre o custo_real do repasse
 * (valor_compra_repasse + Σ gastos — REGRA DE OURO de `margem-repasse.ts`),
 * com a cor do semáforo canônico. NUNCA usa valor_aquisicao (custo de varejo).
 */

import { useMemo, useState } from "react";
import { Loader2, X } from "lucide-react";
import type { Repasse } from "@/lib/repasses/types";
import type { MarcarVendidoInput } from "@/lib/repasses/queries";
import {
  calcularCustoReal,
  calcularMargemValor,
  COR_MARGEM_LABEL,
  type CorMargem,
} from "@/lib/repasses/margem-repasse";
import { classificarMargemVendaValores } from "@/lib/repasses/margem-venda";
import { parseValorBR } from "@/lib/utils/parse-br";
import { hojeLocal } from "@/lib/utils/data-local";
import { formatBRL } from "@/lib/utils";

/**
 * Recorte do repasse que o modal realmente lê. `Repasse` satisfaz este tipo, então
 * quem já passava a linha inteira continua passando — mas fluxos que buscam um
 * select estreito (o diff de presença do arquivo do Auto Avaliar, Fatia 3b)
 * também servem, sem precisar carregar a row completa só pra abrir este modal.
 */
export type RepasseParaVenda = Pick<
  Repasse,
  "placa" | "modelo" | "valor_compra_repasse" | "valor_minimo" | "valor_compre_por"
>;

export type MarcarVendidoModalProps = {
  repasse: RepasseParaVenda;
  /**
   * Valores de `repasse_gastos` do carro — entram no custo_real.
   * `null` = a query de gastos falhou: sem o Σ gastos a prévia sairia
   * SUPERESTIMADA, então o custo_real vira null e a margem fica indisponível.
   */
  gastos: ReadonlyArray<number> | null;
  open: boolean;
  onClose: () => void;
  onConfirm: (input: MarcarVendidoInput) => void | Promise<void>;
  /**
   * Linha de contexto sob o título — usada quando o modal é um passo de uma
   * FILA ("Carro 2 de 6 que saíram do anúncio"). Sem ela o usuário não sabe
   * quantos ainda vêm.
   */
  contexto?: string;
  /** Rótulo do botão de saída. Numa fila, "Cancelar" mente: ali ele PULA o carro. */
  rotuloCancelar?: string;
};

/** Data de hoje pro `<input type="date">` — LOCAL, senão às 22h já mostra amanhã. */
function hojeYMD(): string {
  return hojeLocal();
}

/** Cor do texto da margem por classificação canônica do semáforo. */
const COR_MARGEM_TEXTO: Record<CorMargem, string> = {
  verde: "text-emerald-700 dark:text-emerald-400",
  amarelo: "text-yellow-700 dark:text-yellow-400",
  laranja: "text-orange-700 dark:text-orange-400",
  vermelho: "text-red-700 dark:text-red-400",
  neutro: "text-[var(--text-muted)]",
};

export function MarcarVendidoModal({
  repasse,
  gastos,
  open,
  onClose,
  onConfirm,
  contexto,
  rotuloCancelar = "Cancelar",
}: MarcarVendidoModalProps) {
  const [valorRaw, setValorRaw] = useState("");
  const [data, setData] = useState(hojeYMD());
  const [comprador, setComprador] = useState("");
  const [salvando, setSalvando] = useState(false);

  const valorVendido = useMemo(() => parseValorBR(valorRaw), [valorRaw]);

  const custoReal = useMemo(
    () => (gastos == null ? null : calcularCustoReal(repasse.valor_compra_repasse, gastos)),
    [repasse.valor_compra_repasse, gastos],
  );

  // Margem prévia ao vivo = valor vendido − custo_real. null se falta custo.
  const margem = useMemo(
    () => calcularMargemValor(valorVendido, custoReal),
    [valorVendido, custoReal],
  );

  // Camada de VENDA (não o núcleo): inclui a exceção do prejuízo, então a prévia
  // pinta de vermelho exatamente o que a coluna "Resultado" vai pintar depois.
  const cor = useMemo(
    () =>
      classificarMargemVendaValores(
        valorVendido,
        custoReal,
        repasse.valor_minimo,
        repasse.valor_compre_por,
      ).cor,
    [valorVendido, custoReal, repasse.valor_minimo, repasse.valor_compre_por],
  );

  if (!open) return null;

  const valorInvalido = valorRaw.trim() !== "" && valorVendido == null;
  const podeConfirmar = valorVendido != null && !salvando;

  async function handleConfirmar() {
    if (valorVendido == null || salvando) return;
    setSalvando(true);
    try {
      await onConfirm({
        valor_vendido: valorVendido,
        data_vendido: data || hojeYMD(),
        comprador: comprador.trim() || null,
      });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-[var(--text-strong)]">Registrar venda</h2>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              {repasse.modelo} · <span className="font-mono">{repasse.placa}</span>
            </p>
            {contexto && (
              <p className="mt-1 text-[11px] font-medium text-[var(--brand-700)] dark:text-[var(--brand-300)]">
                {contexto}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--bg-muted)]"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-[var(--text-muted)]">Valor de venda</span>
            <input
              type="text"
              inputMode="decimal"
              autoFocus
              value={valorRaw}
              onChange={(e) => setValorRaw(e.target.value)}
              placeholder="R$ 0,00"
              aria-label="Valor de venda"
              className="mt-1 w-full rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-sm tabular-nums focus:border-[var(--brand-500)] focus:outline-none"
            />
            {valorInvalido && (
              <span className="mt-1 block text-[11px] text-red-700 dark:text-red-400">
                Valor inválido. Use formato R$ (ex.: 145.000,00).
              </span>
            )}
          </label>

          <label className="block">
            <span className="text-xs font-medium text-[var(--text-muted)]">Data da venda</span>
            <input
              type="date"
              value={data}
              onChange={(e) => setData(e.target.value)}
              aria-label="Data da venda"
              className="mt-1 w-full rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-sm focus:border-[var(--brand-500)] focus:outline-none"
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-[var(--text-muted)]">Comprador (opcional)</span>
            <input
              type="text"
              value={comprador}
              onChange={(e) => setComprador(e.target.value)}
              placeholder="Nome do comprador"
              aria-label="Comprador"
              className="mt-1 w-full rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-sm focus:border-[var(--brand-500)] focus:outline-none"
            />
          </label>

          {/* Margem prévia ao vivo */}
          <div className="flex items-center justify-between rounded-md border border-[var(--border-soft)] bg-[var(--bg-muted)] px-3 py-2 text-sm">
            <span className="text-[var(--text-muted)]">Margem prévia</span>
            {margem == null ? (
              <span
                className="text-[var(--text-subtle)]"
                title={
                  gastos == null
                    ? "Falha ao carregar os gastos do repasse — margem indisponível"
                    : custoReal == null
                      ? "Sem valor de compra do repasse — margem indisponível"
                      : undefined
                }
              >
                —
              </span>
            ) : (
              <span
                className={`font-semibold tabular-nums ${COR_MARGEM_TEXTO[cor]}`}
                title={COR_MARGEM_LABEL[cor]}
              >
                {formatBRL(margem)}
              </span>
            )}
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={salvando}
            className="rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-4 py-2 text-sm text-[var(--text-body)] hover:bg-[var(--bg-muted)] disabled:opacity-50"
          >
            {rotuloCancelar}
          </button>
          <button
            type="button"
            onClick={handleConfirmar}
            disabled={!podeConfirmar}
            className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
            Confirmar venda
          </button>
        </div>
      </div>
    </div>
  );
}
