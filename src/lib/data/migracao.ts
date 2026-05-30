"use client";

/**
 * MIGRAÇÃO localStorage → Supabase
 *
 * Le os dados acumulados em localStorage e sobe pro Supabase em uma única operação.
 * Cobre: vendas, custos, estoque, cautelar, FIPE batch, snapshots KPI e chat.
 *
 * Não apaga o localStorage automaticamente — assim você pode rodar de novo
 * se der algo errado. Após confirmar que está tudo no Supabase, você pode
 * limpar manualmente o localStorage.
 */

import type { VendaParsed } from "@/lib/parsers/nbs-vendas-xlsx";
import type { CustoDetalhado } from "@/lib/parsers/nbs-custos-xls";
import type { VeiculoParsed, SnapshotMeta } from "@/lib/parsers/nbs-xlsx";
import type { StatusCautelar } from "@/lib/inventory/cautelar";
import type { BatchResult } from "@/lib/fipe/batch";
import type { Snapshot } from "@/lib/storage/snapshots";
import { upsertVendas, contarVendas } from "./vendas";
import { upsertCustos, contarCustos } from "./custos";
import { inserirEstoqueSnapshot, contarVeiculosAtual } from "./veiculos";
import { upsertCautelaresEmLote, contarCautelares } from "./cautelar";
import { saveBatchToSupabase, contarBatchFipe } from "./fipe-batch";
import { upsertKpiSnapshot, contarKpiSnapshots } from "./kpi-snapshots";
import { inserirMensagem, contarChatMessages } from "./chat";

const INV_KEY = "navesa-mesa:inventory-v1";
const VENDAS_KEY = "navesa-mesa:vendas-v1";
const CUSTOS_KEY = "navesa-mesa:custos-v1";
const CAUTELAR_KEY = "navesa-mesa:cautelar-v1";
const FIPE_BATCH_KEY = "navesa-mesa:fipe-batch-v1";
const SNAPSHOTS_KEY = "navesa-mesa:snapshots-v1";
const CHAT_KEY = "navesa-mesa:chat-v1";

export type MigracaoFase =
  | "lendo-local"
  | "vendas"
  | "custos"
  | "estoque"
  | "cautelar"
  | "fipe-batch"
  | "kpi-snapshots"
  | "chat"
  | "concluido"
  | "erro";

export type MigracaoProgresso = {
  fase: MigracaoFase;
  mensagem: string;
};

export type MigracaoResultado = {
  vendasMigradas: number;
  custosMigrados: number;
  veiculosMigrados: number;
  cautelaresMigrados: number;
  fipeBatchMigrados: number;
  snapshotsMigrados: number;
  chatMensagensMigradas: number;
  duplicatas: { vendas: number; custos: number };
  jaTinhamNoSupabase: {
    vendas: number;
    custos: number;
    veiculos: number;
    cautelares: number;
    fipeBatch: number;
    snapshots: number;
    chat: number;
  };
};

function lerVendasLocal(): VendaParsed[] {
  try {
    const raw = localStorage.getItem(VENDAS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { vendas?: VendaParsed[] };
    const vendas = parsed.vendas ?? [];
    // Reidrata Datas
    for (const v of vendas) {
      if (v.data_venda) v.data_venda = new Date(v.data_venda) as unknown as Date;
      if (v.data_faturamento) v.data_faturamento = new Date(v.data_faturamento) as unknown as Date;
      if (v.data_entrada) v.data_entrada = new Date(v.data_entrada) as unknown as Date;
    }
    return vendas;
  } catch {
    return [];
  }
}

function lerCustosLocal(): CustoDetalhado[] {
  try {
    const raw = localStorage.getItem(CUSTOS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { custosPorPlaca?: Record<string, CustoDetalhado> };
    const mapa = parsed.custosPorPlaca ?? {};
    const out: CustoDetalhado[] = [];
    for (const c of Object.values(mapa)) {
      if (c.data_fatura) c.data_fatura = new Date(c.data_fatura) as unknown as Date;
      if (c.data_venda) c.data_venda = new Date(c.data_venda) as unknown as Date;
      out.push(c);
    }
    return out;
  } catch {
    return [];
  }
}

function lerEstoqueLocal(): { veiculos: VeiculoParsed[]; meta: SnapshotMeta | null } {
  try {
    const raw = localStorage.getItem(INV_KEY);
    if (!raw) return { veiculos: [], meta: null };
    const parsed = JSON.parse(raw) as { meta?: SnapshotMeta; veiculos?: VeiculoParsed[] };
    const veiculos = parsed.veiculos ?? [];
    for (const v of veiculos) {
      if (v.data_entrada) v.data_entrada = new Date(v.data_entrada) as unknown as Date;
    }
    const meta = parsed.meta ?? null;
    if (meta?.data_geracao) meta.data_geracao = new Date(meta.data_geracao) as unknown as Date;
    return { veiculos, meta };
  } catch {
    return { veiculos: [], meta: null };
  }
}

function lerCautelarLocal(): Record<string, StatusCautelar> {
  try {
    const raw = localStorage.getItem(CAUTELAR_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, StatusCautelar>;
  } catch {
    return {};
  }
}

function lerFipeBatchLocal(): BatchResult | null {
  try {
    const raw = localStorage.getItem(FIPE_BATCH_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as BatchResult;
  } catch {
    return null;
  }
}

function lerSnapshotsLocal(): Snapshot[] {
  try {
    const raw = localStorage.getItem(SNAPSHOTS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as Snapshot[]) : [];
  } catch {
    return [];
  }
}

function lerChatLocal(): { role: "user" | "assistant"; content: string }[] {
  try {
    const raw = localStorage.getItem(CHAT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as { role: "user" | "assistant"; content: string }[]) : [];
  } catch {
    return [];
  }
}

export async function migrarLocalStorageParaSupabase(
  onProgress?: (p: MigracaoProgresso) => void,
): Promise<MigracaoResultado> {
  const report = (p: MigracaoProgresso) => onProgress?.(p);

  // Conta o que já está no Supabase pra avisar
  const [jaVendas, jaCustos, jaVeic, jaCaut, jaFipe, jaSnap, jaChat] = await Promise.all([
    contarVendas(),
    contarCustos(),
    contarVeiculosAtual(),
    contarCautelares(),
    contarBatchFipe(),
    contarKpiSnapshots(),
    contarChatMessages(),
  ]);

  report({ fase: "lendo-local", mensagem: "Lendo dados do navegador..." });
  const vendas = lerVendasLocal();
  const custos = lerCustosLocal();
  const { veiculos, meta } = lerEstoqueLocal();
  const cautelares = lerCautelarLocal();
  const fipeBatch = lerFipeBatchLocal();
  const snapshots = lerSnapshotsLocal();
  const chat = lerChatLocal();

  // VENDAS
  let dupVendas = 0, totalVendas = 0;
  if (vendas.length > 0) {
    report({ fase: "vendas", mensagem: `Subindo ${vendas.length} vendas...` });
    const r = await upsertVendas(vendas);
    dupVendas = r.duplicatasIgnoradas;
    totalVendas = r.total;
  }

  // CUSTOS
  let dupCustos = 0, totalCustos = 0;
  if (custos.length > 0) {
    report({ fase: "custos", mensagem: `Subindo ${custos.length} custos...` });
    const r = await upsertCustos(custos);
    dupCustos = r.duplicatasIgnoradas;
    totalCustos = r.total;
  }

  // ESTOQUE (cria snapshot novo)
  if (veiculos.length > 0) {
    report({ fase: "estoque", mensagem: `Subindo ${veiculos.length} veículos como novo snapshot...` });
    await inserirEstoqueSnapshot(veiculos, meta ?? {
      arquivo_nome: "migracao-localStorage",
      data_geracao: new Date(),
      total_veiculos: veiculos.length,
      total_lojas: 0,
    });
  }

  // CAUTELAR
  let totalCaut = 0;
  const totalCautelarLocal = Object.keys(cautelares).length;
  if (totalCautelarLocal > 0) {
    report({ fase: "cautelar", mensagem: `Subindo ${totalCautelarLocal} cautelares...` });
    const r = await upsertCautelaresEmLote(cautelares);
    totalCaut = r.total;
  }

  // FIPE BATCH
  let totalFipe = 0;
  if (fipeBatch && Object.keys(fipeBatch.items).length > 0) {
    totalFipe = Object.keys(fipeBatch.items).length;
    report({ fase: "fipe-batch", mensagem: `Subindo ${totalFipe} preços FIPE...` });
    await saveBatchToSupabase(fipeBatch);
  }

  // KPI SNAPSHOTS
  let totalSnap = 0;
  if (snapshots.length > 0) {
    report({ fase: "kpi-snapshots", mensagem: `Subindo ${snapshots.length} fotos de KPI...` });
    for (const s of snapshots) {
      await upsertKpiSnapshot(s);
      totalSnap++;
    }
  }

  // CHAT (só sobe se a tabela está vazia — evita duplicar histórico se rodar 2 vezes)
  let totalChat = 0;
  if (chat.length > 0 && jaChat === 0) {
    report({ fase: "chat", mensagem: `Subindo ${chat.length} mensagens de chat...` });
    for (const m of chat) {
      await inserirMensagem(m.role, m.content);
      totalChat++;
    }
  }

  report({ fase: "concluido", mensagem: "Migração concluída!" });
  return {
    vendasMigradas: totalVendas,
    custosMigrados: totalCustos,
    veiculosMigrados: veiculos.length,
    cautelaresMigrados: totalCaut,
    fipeBatchMigrados: totalFipe,
    snapshotsMigrados: totalSnap,
    chatMensagensMigradas: totalChat,
    duplicatas: { vendas: dupVendas, custos: dupCustos },
    jaTinhamNoSupabase: {
      vendas: jaVendas,
      custos: jaCustos,
      veiculos: jaVeic,
      cautelares: jaCaut,
      fipeBatch: jaFipe,
      snapshots: jaSnap,
      chat: jaChat,
    },
  };
}
