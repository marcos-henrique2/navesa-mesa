/**
 * Loader: lê o banco com a role `cerebro_leitor` e devolve os MESMOS datasets
 * que as telas usam (`prepararDatasetsDeLinhas`, refactor da fatia 1a).
 *
 * Colunas:
 *   - `vendas`, `cautelar`: SELECT com as colunas explícitas da 051
 *     (`VENDAS_COLUNAS_CEREBRO`, `CAUTELAR_COLUNAS_CEREBRO`). `select *` falha
 *     nelas: a role só tem GRANT por coluna.
 *   - `sync_log`: só as 8 colunas liberadas (sem `erro_mensagem`).
 *   - `veiculos_atual`, `estoque_snapshots`, `custos_*`, `fipe_batch`, `lojas`:
 *     GRANT de tabela inteira (sem PII), `select *` igual ao `selectAll` do app.
 *
 * Todas as queries são estáticas (sem parâmetros): funcionam no modo transação
 * do Supavisor, que não suporta prepared statements nomeados.
 */
import { VENDAS_COLUNAS_CEREBRO, type VendaRow } from "@/lib/data/mappers/vendas";
import { CAUTELAR_COLUNAS_CEREBRO, type CautelarRow } from "@/lib/data/mappers/cautelar";
import type { VeiculoRow, EstoqueSnapshotRow } from "@/lib/data/mappers/veiculos";
import type { CustoRow } from "@/lib/data/mappers/custos";
import type { CustoEstoqueRow } from "@/lib/data/mappers/custos-estoque";
import type { FipeBatchRow } from "@/lib/data/mappers/fipe-batch";
import {
  prepararDatasetsDeLinhas,
  type DatasetsPreparadosCompletos,
  type LojaInfo,
} from "@/lib/data/preparar-datasets";
import { isLojaIgnorada } from "@/lib/config/lojas-ignoradas";
import type { Consulta, LinhaDb } from "@cerebro/data/db";

export const SYNC_LOG_COLUNAS = [
  "id", "fonte", "iniciado_em", "finalizado_em", "status",
  "linhas_lidas", "linhas_gravadas", "duracao_ms",
] as const;

const cols = (c: readonly string[]) => c.map((x) => `"${x}"`).join(", ");

export const SQL = {
  vendas: `select ${cols(VENDAS_COLUNAS_CEREBRO)} from public.vendas order by data_venda asc nulls last, id asc`,
  veiculos: `select * from public.veiculos_atual order by id asc`,
  meta: `select * from public.estoque_snapshots order by id desc limit 1`,
  custos: `select * from public.custos_detalhados order by placa asc`,
  custosEstoque: `select * from public.custos_estoque_detalhado order by placa asc`,
  fipe: `select * from public.fipe_batch order by chassi asc`,
  cautelar: `select ${cols(CAUTELAR_COLUNAS_CEREBRO)} from public.cautelar`,
  lojas: `select "cod_empresa", "nome", "cidade", "ativo" from public.lojas order by cod_empresa`,
  /** Última execução e último sucesso de cada fonte do sync NBS. */
  syncLog:
    `select distinct on (fonte) ${cols(SYNC_LOG_COLUNAS)} from public.sync_log order by fonte, iniciado_em desc`,
  syncLogSucesso:
    `select distinct on (fonte) ${cols(SYNC_LOG_COLUNAS)} from public.sync_log where status = 'sucesso' order by fonte, iniciado_em desc`,
  /**
   * Assinatura barata do estado do banco. Mudou → recarrega o cache.
   * max(id)/count/max(atualizado_em) por tabela + último id do sync_log.
   */
  frescor: `select concat_ws('|',
    (select max(id) from public.estoque_snapshots),
    (select count(*) from public.vendas), (select max(atualizado_em) from public.vendas),
    (select count(*) from public.custos_detalhados), (select max(atualizado_em) from public.custos_detalhados),
    (select count(*) from public.custos_estoque_detalhado), (select max(atualizado_em) from public.custos_estoque_detalhado),
    (select count(*) from public.fipe_batch), (select max(atualizado_em) from public.fipe_batch),
    (select count(*) from public.cautelar), (select max(atualizado_em) from public.cautelar),
    (select max(id) from public.sync_log)
  ) as assinatura`,
} as const;

export type SyncFonte = {
  fonte: string;
  status: string;
  iniciado_em: string | null;
  finalizado_em: string | null;
  linhas_gravadas: number | null;
  /** Último `finalizado_em` com status `sucesso` (pode ser anterior à última execução). */
  ultimo_sucesso_em: string | null;
};

export type LojaCadastro = LojaInfo & { ativo: boolean };

export type Snapshot = {
  datasets: DatasetsPreparadosCompletos;
  /** Lojas da tabela `lojas` (pode estar vazia) já sem as ignoradas. */
  lojasCadastro: LojaCadastro[];
  sync: SyncFonte[];
  snapshotId: number | null;
  /** Data de geração do relatório de estoque (snapshot atual). */
  estoqueGeradoEm: string | null;
  carregadoEm: string;
  assinatura: string;
};

const str = (v: unknown): string | null => (v == null ? null : String(v));

export async function lerAssinatura(q: Consulta): Promise<string> {
  const { rows } = await q(SQL.frescor);
  return String(rows[0]?.assinatura ?? "");
}

export async function carregarSnapshot(q: Consulta, agora: () => Date = () => new Date()): Promise<Snapshot> {
  // Sequencial de propósito: o pool tem 3 conexões e a role, limite 5.
  const assinatura = await lerAssinatura(q);
  const vendas = (await q(SQL.vendas)).rows as unknown as VendaRow[];
  const veiculos = (await q(SQL.veiculos)).rows as unknown as VeiculoRow[];
  const metaRows = (await q(SQL.meta)).rows;
  const custos = (await q(SQL.custos)).rows as unknown as CustoRow[];
  const custosEstoque = (await q(SQL.custosEstoque)).rows as unknown as CustoEstoqueRow[];
  const fipe = (await q(SQL.fipe)).rows as unknown as FipeBatchRow[];
  const cautelares = (await q(SQL.cautelar)).rows as unknown as CautelarRow[];
  const lojasRows = (await q(SQL.lojas)).rows;
  const syncRows = (await q(SQL.syncLog)).rows;
  const syncOkRows = (await q(SQL.syncLogSucesso)).rows;

  const lojasCadastro: LojaCadastro[] = lojasRows
    .map((r: LinhaDb) => ({
      cod_empresa: Number(r.cod_empresa),
      nome: String(r.nome ?? ""),
      cidade: String(r.cidade ?? ""),
      ativo: r.ativo !== false,
    }))
    .filter((l) => !isLojaIgnorada(l.cod_empresa));
  const lojasAtuais: Record<number, LojaInfo> = {};
  for (const l of lojasCadastro) lojasAtuais[l.cod_empresa] = { cod_empresa: l.cod_empresa, nome: l.nome, cidade: l.cidade };

  const metaRow = metaRows[0] as (EstoqueSnapshotRow & { id?: unknown }) | undefined;
  const datasets = prepararDatasetsDeLinhas(
    { vendas, veiculos, custos, custosEstoque, meta: metaRow ?? null, fipe, cautelares },
    lojasAtuais,
  );

  const sucessoPorFonte = new Map(syncOkRows.map((r) => [String(r.fonte), str(r.finalizado_em)]));
  const sync: SyncFonte[] = syncRows.map((r) => ({
    fonte: String(r.fonte),
    status: String(r.status),
    iniciado_em: str(r.iniciado_em),
    finalizado_em: str(r.finalizado_em),
    linhas_gravadas: r.linhas_gravadas == null ? null : Number(r.linhas_gravadas),
    ultimo_sucesso_em: sucessoPorFonte.get(String(r.fonte)) ?? null,
  }));

  return {
    datasets,
    lojasCadastro,
    sync,
    snapshotId: metaRow?.id == null ? null : Number(metaRow.id),
    estoqueGeradoEm: metaRow?.data_geracao ?? null,
    carregadoEm: agora().toISOString(),
    assinatura,
  };
}
