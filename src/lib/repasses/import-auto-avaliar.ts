/**
 * Núcleo PURO do importador Auto Avaliar (Story 2.2 / Fatia 2).
 *
 * Recebe o resultado do parser + os dados já carregados do banco (resolução de
 * chassi, repasses ativos, universo subido, vendas) e monta o PREVIEW que o
 * Marcos confirma na tela. Também monta o PAYLOAD (snapshot já decidido) que vai
 * pra RPC `importar_repasse_auto_avaliar`.
 *
 * A RPC é atômica/idempotente e NÃO recalcula regra — a decisão (criar vs
 * atualizar, vendido vs marcado) é tomada AQUI e enviada como snapshot. Por isso
 * esta camada é pura e 100% testável (as queries vivem em `-queries.ts`).
 *
 * custo_real do preview usa o MESMO núcleo canônico (`calcularCustoReal`):
 * valor_compra + gastos (regra de ouro — NUNCA valor_aquisicao).
 */

import { calcularCustoReal } from "@/lib/repasses/margem-repasse";
import type { Aviso, RegistroAA } from "@/lib/repasses/parse-auto-avaliar";

// ─── Tipos do preview ────────────────────────────────────────────────────────

export type AcaoItem = "criar" | "atualizar";

export type PreviewItem = {
  registro: RegistroAA;
  acao: AcaoItem;
  /** repasse existente a atualizar; null quando é criação. */
  repasse_id: number | null;
  /** chassi resolvido (obrigatório pra criar; presente no ativo pra atualizar). */
  chassi: string | null;
  /** valor_compra + gastos do registro AA. null se compra ausente. */
  custo_real: number | null;
};

export type Pendencia = {
  registro: RegistroAA;
  /** Consignado sem chassi no estoque → não dá pra criar repasse. */
  motivo: "sem_chassi";
};

export type ReconItem = {
  repasse_id: number;
  placa_norm: string;
  modelo: string;
  novo_status: "vendido" | "marcado";
  /** ISO (YYYY-MM-DD) quando vendido (cruzou com `vendas`); senão null. */
  data_vendido: string | null;
  valor_vendido: number | null;
};

export type ImportPreview = {
  itens: PreviewItem[];
  pendencias: Pendencia[];
  reconciliacao: ReconItem[];
  avisos: Aviso[];
};

// ─── Entradas resolvidas do banco (já normalizadas por placa_norm) ────────────

/** Repasse ativo (status marcado|subido) encontrado por placa_norm. */
export type RepasseAtivoRef = { id: number; chassi: string };

/** Repasse do universo canal='auto_avaliar' AND status='subido'. */
export type SubidoRef = { id: number; placa_norm: string; modelo: string };

/** Referência de venda (NBS) cruzada por placa_norm. */
export type VendaRef = { data_vendido: string | null; valor_vendido: number | null };

export type PreviewInputs = {
  registros: ReadonlyArray<RegistroAA>;
  avisos: ReadonlyArray<Aviso>;
  /** placa_norm → chassi (veiculos_atual). */
  chassiPorPlaca: ReadonlyMap<string, string>;
  /** placa_norm → repasse ativo. */
  repasseAtivoPorPlaca: ReadonlyMap<string, RepasseAtivoRef>;
  /** Universo de repasses canal='auto_avaliar' AND status='subido'. */
  subidoUniverso: ReadonlyArray<SubidoRef>;
  /** placa_norm → venda (pra reconciliar quem sumiu da lista). */
  vendaPorPlaca: ReadonlyMap<string, VendaRef>;
};

// ─── Builder puro do preview ──────────────────────────────────────────────────

/**
 * Monta o preview a partir dos dados já resolvidos.
 *
 * Para cada registro da lista:
 *   - Tem repasse ATIVO na mesma placa → 'atualizar' (repasse_id + chassi do ativo).
 *   - Senão, tem chassi no estoque → 'criar'.
 *   - Senão (consignado sem chassi) → Pendência 'sem_chassi' (NÃO cria).
 *
 * Reconciliação: todo repasse do universo subido cuja placa SUMIU da lista atual
 * vira reconciliação — 'vendido' se cruza com `vendas` (com data/valor reais),
 * senão 'marcado'.
 */
export function montarPreviewPuro(inp: PreviewInputs): ImportPreview {
  const itens: PreviewItem[] = [];
  const pendencias: Pendencia[] = [];
  const placasImportadas = new Set<string>();

  for (const registro of inp.registros) {
    placasImportadas.add(registro.placa_norm);
    const custo_real = calcularCustoReal(registro.valor_compra, [registro.gastos]);

    const ativo = inp.repasseAtivoPorPlaca.get(registro.placa_norm);
    if (ativo) {
      itens.push({ registro, acao: "atualizar", repasse_id: ativo.id, chassi: ativo.chassi, custo_real });
      continue;
    }

    const chassi = inp.chassiPorPlaca.get(registro.placa_norm) ?? null;
    if (chassi) {
      itens.push({ registro, acao: "criar", repasse_id: null, chassi, custo_real });
    } else {
      pendencias.push({ registro, motivo: "sem_chassi" });
    }
  }

  const reconciliacao: ReconItem[] = [];
  for (const s of inp.subidoUniverso) {
    if (placasImportadas.has(s.placa_norm)) continue; // ainda na lista → é 'atualizar', não reconcilia
    const venda = inp.vendaPorPlaca.get(s.placa_norm);
    if (venda) {
      reconciliacao.push({
        repasse_id: s.id,
        placa_norm: s.placa_norm,
        modelo: s.modelo,
        novo_status: "vendido",
        data_vendido: venda.data_vendido,
        valor_vendido: venda.valor_vendido,
      });
    } else {
      reconciliacao.push({
        repasse_id: s.id,
        placa_norm: s.placa_norm,
        modelo: s.modelo,
        novo_status: "marcado",
        data_vendido: null,
        valor_vendido: null,
      });
    }
  }

  return { itens, pendencias, reconciliacao, avisos: [...inp.avisos] };
}

// ─── Payload da RPC (snapshot já decidido) ────────────────────────────────────

export type PayloadRegistro = {
  placa_norm: string;
  modelo: string | null;
  cor: string | null;
  ano_modelo: number | null;
  km: number | null;
  valor_compra: number | null;
  gastos: number;
  minimo: number | null;
  compre_por: number | null;
  media_aa: number | null;
  media_fipe: number | null;
  media_web: number | null;
};

export type PayloadItem = {
  acao: AcaoItem;
  repasse_id: number | null;
  chassi: string | null;
  registro: PayloadRegistro;
};

export type PayloadRecon = {
  repasse_id: number;
  novo_status: "vendido" | "marcado";
  data_vendido: string | null;
  valor_vendido: number | null;
};

export type PayloadImport = {
  itens: PayloadItem[];
  reconciliacao: PayloadRecon[];
};

/** Snapshot do preview → payload da RPC. Pendências NÃO entram (não criam). */
export function montarPayloadImport(preview: ImportPreview): PayloadImport {
  return {
    itens: preview.itens.map((it) => ({
      acao: it.acao,
      repasse_id: it.repasse_id,
      chassi: it.chassi,
      registro: {
        placa_norm: it.registro.placa_norm,
        modelo: it.registro.modelo,
        cor: it.registro.cor,
        ano_modelo: it.registro.ano_modelo,
        km: it.registro.km,
        valor_compra: it.registro.valor_compra,
        gastos: it.registro.gastos,
        minimo: it.registro.minimo,
        compre_por: it.registro.compre_por,
        media_aa: it.registro.media_aa,
        media_fipe: it.registro.media_fipe,
        media_web: it.registro.media_web,
      },
    })),
    reconciliacao: preview.reconciliacao.map((r) => ({
      repasse_id: r.repasse_id,
      novo_status: r.novo_status,
      data_vendido: r.data_vendido,
      valor_vendido: r.valor_vendido,
    })),
  };
}

// ─── Contagens de retorno da RPC ──────────────────────────────────────────────

export type ImportResultado = {
  criados: number;
  atualizados: number;
  reconciliados_vendidos: number;
  reconciliados_marcados: number;
  conflitos: number;
};
