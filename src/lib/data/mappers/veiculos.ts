/**
 * Mapper PURO de `veiculos` / `veiculos_atual` / `estoque_snapshots` ↔ domínio.
 * Sem "use client", sem Supabase: usado pelo client, pelo sync Node
 * (`scripts/sync-nbs/gravar.ts`) e pelo cérebro (Node).
 */
import type { VeiculoParsed, SnapshotMeta } from "@/lib/parsers/nbs-xlsx";
import { parseDate } from "@/lib/data/mappers/datas";

/** Família de custo do markup oficial NBS gravada em `veiculos` (migrations 040/048). */
type ColunaCustoEstoque =
  | "valoriza"
  | "custo_impostos"
  | "custo_revisoes"
  | "custo_holdback"
  | "custo_acessorios"
  | "custo_forplan"
  | "custo_comissoes"
  | "custo_despesas_gerais";

export type VeiculoRow = Omit<VeiculoParsed, "data_entrada" | ColunaCustoEstoque> & {
  snapshot_id: number;
  data_entrada: string | null;
} & {
  /** Registros pré-sync podem estar NULL no banco — `veiculoFromRow` lê como 0. */
  [K in ColunaCustoEstoque]?: number | null;
};

export type EstoqueSnapshotRow = {
  arquivo_nome: string;
  data_geracao: string | null;
  total_veiculos: number | null;
  total_lojas: number | null;
};

/** Payload de insert. Exportado como `toRow` em `@/lib/data/veiculos` (reuso no sync Node). */
export function veiculoToRow(v: VeiculoParsed, snapshotId: number): Record<string, unknown> {
  return {
    snapshot_id: snapshotId,
    cod_empresa: v.cod_empresa,
    chassi: v.chassi,
    placa: v.placa,
    marca: v.marca,
    modelo: v.modelo,
    ano_fabricacao: v.ano_fabricacao,
    ano_modelo: v.ano_modelo,
    cor_externa: v.cor_externa,
    combustivel: v.combustivel,
    km: v.km,
    patio: v.patio,
    descricao_situacao: v.descricao_situacao,
    preco_venda: v.preco_venda,
    valor_aquisicao: v.valor_aquisicao,
    custo_total: v.custo_total,
    dias_patio: v.dias_patio,
    data_entrada: v.data_entrada?.toISOString() ?? null,
    vendedor_recebeu: v.vendedor_recebeu,
    cod_proposta: v.cod_proposta,
    valoriza: v.valoriza,
    custo_impostos: v.custo_impostos,
    custo_revisoes: v.custo_revisoes,
    custo_holdback: v.custo_holdback,
    custo_acessorios: v.custo_acessorios,
    custo_forplan: v.custo_forplan,
    custo_comissoes: v.custo_comissoes,
    custo_despesas_gerais: v.custo_despesas_gerais,
    // custo_adm NÃO entra aqui de propósito — sem CODIGO_CUSTO/TIPO mapeado
    // (ver VeiculoParsed em nbs-xlsx.ts e migrations 040/048). Omitir a
    // chave deixa o Postgres gravar NULL (coluna NULLABLE SEM DEFAULT) em
    // vez de afirmar falsamente "custo zero conhecido".
  };
}

export function veiculoFromRow(r: VeiculoRow): VeiculoParsed {
  return {
    cod_empresa: r.cod_empresa,
    chassi: r.chassi,
    placa: r.placa,
    marca: r.marca,
    modelo: r.modelo,
    ano_fabricacao: r.ano_fabricacao,
    ano_modelo: r.ano_modelo,
    cor_externa: r.cor_externa,
    combustivel: r.combustivel,
    km: r.km,
    patio: r.patio,
    descricao_situacao: r.descricao_situacao,
    preco_venda: r.preco_venda,
    valor_aquisicao: r.valor_aquisicao,
    custo_total: r.custo_total,
    dias_patio: r.dias_patio,
    data_entrada: parseDate(r.data_entrada),
    vendedor_recebeu: r.vendedor_recebeu,
    cod_proposta: r.cod_proposta ?? null,
    valoriza: r.valoriza ?? 0,
    custo_impostos: r.custo_impostos ?? 0,
    custo_revisoes: r.custo_revisoes ?? 0,
    custo_holdback: r.custo_holdback ?? 0,
    custo_acessorios: r.custo_acessorios ?? 0,
    custo_forplan: r.custo_forplan ?? 0,
    custo_comissoes: r.custo_comissoes ?? 0,
    // custo_despesas_gerais: ATUALIZADO 07/10/2026 (migration 048) — agora
    // tem fonte automática real (TIPO=9), mesmo contrato "ausência de
    // lançamento = 0, fato conhecido, nunca null" das outras 5 colunas desta
    // família. Registros antigos pré-sync ainda podem estar NULL no banco
    // até o próximo ciclo de sync rodar — daí o fallback ?? 0 aqui.
    custo_despesas_gerais: r.custo_despesas_gerais ?? 0,
    // custo_adm: leitura direta, SEM fallback pra 0 — NULL aqui significa
    // "não apurado" (ver nota em VeiculoParsed), nunca "zero conhecido".
    custo_adm: r.custo_adm ?? null,
  };
}

export function snapshotMetaFromRow(r: EstoqueSnapshotRow): SnapshotMeta {
  return {
    arquivo_nome: r.arquivo_nome,
    data_geracao: parseDate(r.data_geracao),
    total_veiculos: r.total_veiculos ?? 0,
    total_lojas: r.total_lojas ?? 0,
  };
}
