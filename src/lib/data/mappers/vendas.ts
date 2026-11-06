/**
 * Mapper PURO de `vendas` ↔ `VendaParsed`.
 * Sem "use client", sem Supabase: usado pelo client, pelo sync Node
 * (`scripts/sync-nbs/gravar.ts`) e pelo cérebro (Node).
 */
import type { VendaParsed } from "@/lib/parsers/nbs-vendas-xlsx";
import { parseDate } from "@/lib/data/mappers/datas";

/**
 * Colunas sensíveis (PII) que podem vir AUSENTES da linha: a role `cerebro_leitor`
 * (migration 051) não tem SELECT nelas. No browser (`select("*")`) elas sempre vêm.
 * Nenhuma entra no cálculo de margem (mas `cliente_codigo` alimenta a detecção de
 * lojista do Vendas Matriz — sem ela, `lojista` fica `null`).
 */
export type ColunaVendaRestrita = "cliente_nome" | "cliente_codigo" | "vendedor_cpf" | "renavam";

/**
 * Colunas de `vendas` que a role `cerebro_leitor` pode ler — espelho exato da
 * allowlist `permitidas` de `vendas` em `supabase/migrations/051_cerebro_leitor.sql`
 * (o teste `preparar-datasets.test.ts` compara os dois). Use no `SELECT` do cérebro:
 * `select *` falha, pois a role só tem GRANT por coluna.
 * `financiado`/`financeira` (037), `valoriza` (039) e `consignado` (042) estão nas
 * migrations do repo e são lidas por `vendaFromRow`.
 */
export const VENDAS_COLUNAS_CEREBRO = [
  "id", "chassi", "placa", "modelo", "marca", "ano_fabricacao", "ano_modelo", "cor_externa", "km",
  "cod_empresa", "empresa_nome", "patio",
  "vendedor_codigo", "vendedor_nome", "vendedor_recebeu",
  "cliente_tipo", "cliente_cidade", "cliente_uf",
  "data_venda", "data_faturamento", "data_entrada",
  "valor_venda", "preco_venda_tabela", "total_nota_fabrica", "custo_floor_plan", "custo_total_final",
  "despesas_gerais", "margem_pct", "comissao_vendedor", "dias_estoque", "placa_troca",
  "atualizado_em", "financiado", "financeira", "valoriza", "consignado",
] as const;

/** Placeholder do parser NBS pra venda sem nome de cliente. */
export const CLIENTE_SEM_NOME = "(sem nome)";

export type VendaRow = Omit<
  VendaParsed,
  "data_venda" | "data_faturamento" | "data_entrada" | "valoriza" | "consignado" | ColunaVendaRestrita
> & {
  cliente_nome?: VendaParsed["cliente_nome"];
  cliente_codigo?: VendaParsed["cliente_codigo"];
  vendedor_cpf?: VendaParsed["vendedor_cpf"];
  renavam?: VendaParsed["renavam"];
  data_venda: string | null;
  data_faturamento: string | null;
  data_entrada: string | null;
  /** NOT NULL DEFAULT 0 (039); opcional pra tolerar snapshot antigo sem o campo. */
  valoriza?: number | null;
  /** NOT NULL DEFAULT false (042); opcional pelo mesmo motivo. */
  consignado?: boolean | null;
  atualizado_em?: string;
};

/** Payload de upsert. Exportado como `toRow` em `@/lib/data/vendas` (reuso no sync Node). */
export function vendaToRow(v: VendaParsed): Record<string, unknown> {
  return {
    chassi: v.chassi,
    placa: v.placa,
    modelo: v.modelo,
    marca: v.marca,
    ano_fabricacao: v.ano_fabricacao,
    ano_modelo: v.ano_modelo,
    cor_externa: v.cor_externa,
    renavam: v.renavam,
    km: v.km,
    cod_empresa: v.cod_empresa,
    empresa_nome: v.empresa_nome,
    patio: v.patio,
    vendedor_codigo: v.vendedor_codigo,
    vendedor_nome: v.vendedor_nome,
    vendedor_cpf: v.vendedor_cpf,
    vendedor_recebeu: v.vendedor_recebeu,
    cliente_codigo: v.cliente_codigo,
    cliente_nome: v.cliente_nome,
    cliente_tipo: v.cliente_tipo,
    cliente_cidade: v.cliente_cidade,
    cliente_uf: v.cliente_uf,
    data_venda: v.data_venda?.toISOString() ?? null,
    data_faturamento: v.data_faturamento?.toISOString() ?? null,
    data_entrada: v.data_entrada?.toISOString() ?? null,
    valor_venda: v.valor_venda,
    preco_venda_tabela: v.preco_venda_tabela,
    total_nota_fabrica: v.total_nota_fabrica,
    custo_floor_plan: v.custo_floor_plan,
    custo_total_final: v.custo_total_final,
    despesas_gerais: v.despesas_gerais,
    margem_pct: v.margem_pct,
    comissao_vendedor: v.comissao_vendedor,
    dias_estoque: v.dias_estoque,
    placa_troca: v.placa_troca,
    financiado: v.financiado,
    financeira: v.financeira,
    valoriza: v.valoriza,
    consignado: v.consignado,
  };
}

export function vendaFromRow(r: VendaRow): VendaParsed {
  return {
    chassi: r.chassi,
    placa: r.placa,
    modelo: r.modelo,
    marca: r.marca,
    ano_fabricacao: r.ano_fabricacao,
    ano_modelo: r.ano_modelo,
    cor_externa: r.cor_externa,
    // Colunas restritas: ausente (undefined) vira null/placeholder; valor presente passa intacto.
    renavam: r.renavam ?? null,
    km: r.km,
    cod_empresa: r.cod_empresa,
    empresa_nome: r.empresa_nome,
    patio: r.patio,
    vendedor_codigo: r.vendedor_codigo,
    vendedor_nome: r.vendedor_nome,
    vendedor_cpf: r.vendedor_cpf ?? null,
    vendedor_recebeu: r.vendedor_recebeu,
    cliente_codigo: r.cliente_codigo ?? null,
    cliente_nome: r.cliente_nome === undefined ? CLIENTE_SEM_NOME : r.cliente_nome,
    cliente_tipo: r.cliente_tipo,
    cliente_cidade: r.cliente_cidade,
    cliente_uf: r.cliente_uf,
    data_venda: parseDate(r.data_venda),
    data_faturamento: parseDate(r.data_faturamento),
    data_entrada: parseDate(r.data_entrada),
    valor_venda: r.valor_venda,
    preco_venda_tabela: r.preco_venda_tabela,
    total_nota_fabrica: r.total_nota_fabrica,
    custo_floor_plan: r.custo_floor_plan,
    custo_total_final: r.custo_total_final,
    despesas_gerais: r.despesas_gerais,
    margem_pct: r.margem_pct,
    comissao_vendedor: r.comissao_vendedor,
    dias_estoque: r.dias_estoque,
    placa_troca: r.placa_troca,
    financiado: r.financiado,
    financeira: r.financeira,
    valoriza: r.valoriza ?? 0,
    // Coluna NOT NULL DEFAULT false (migration 042) — mas o fallback `?? false` protege
    // contra snapshot de localStorage salvo antes da coluna existir (sem o campo no JSON).
    consignado: r.consignado ?? false,
    // Sem PII de cliente (cérebro): marca a venda como não identificável. Só entra a chave
    // nesse caso, pra linha com PII sair idêntica ao legado.
    ...(r.cliente_nome === undefined && !r.cliente_codigo?.trim() ? { cliente_pii_ausente: true as const } : {}),
  };
}
