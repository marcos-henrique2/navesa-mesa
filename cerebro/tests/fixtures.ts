/**
 * Fixtures em formato de LINHA DO BANCO (como o pool `pg` do cérebro entrega:
 * numeric como number, timestamptz como ISO string) + um `Consulta` falso que
 * responde pelo SQL do loader. Assim os testes passam pelo caminho real:
 * loader → mappers → prepararDatasetsDeLinhas → tools.
 */
import { VENDAS_COLUNAS_CEREBRO } from "@/lib/data/mappers/vendas";
import { SQL, carregarSnapshot, type Snapshot } from "@cerebro/data/loader";
import type { Consulta, LinhaDb } from "@cerebro/data/db";
import type { ContextoTool } from "@cerebro/tools/comum";

/** Data "local" de Goiânia (UTC−3, sem horário de verão desde 2019) como ISO UTC. */
export const brt = (dia: string, hora = "12:00") => new Date(`${dia}T${hora}:00-03:00`).toISOString();

export const AGORA = new Date("2026-11-06T15:00:00-03:00");

let idVenda = 0;
export function vendaRow(over: Partial<LinhaDb> = {}): LinhaDb {
  idVenda++;
  const base: LinhaDb = {
    id: idVenda,
    chassi: `9BWZZZ000000${String(idVenda).padStart(5, "0")}`,
    placa: `VND${String(idVenda).padStart(4, "0")}`,
    modelo: "RANGER XLS 2.2",
    marca: "FORD",
    ano_fabricacao: 2022,
    ano_modelo: 2023,
    cor_externa: "PRATA",
    km: 45000,
    cod_empresa: 2,
    empresa_nome: "NAVESA FORD AEROPORTO",
    patio: "AEROPORTO",
    vendedor_codigo: "V1",
    vendedor_nome: "JOAO SILVA",
    vendedor_recebeu: null,
    cliente_tipo: "PF",
    cliente_cidade: "GOIANIA",
    cliente_uf: "GO",
    data_venda: brt("2026-10-10"),
    data_faturamento: null,
    data_entrada: null,
    valor_venda: 150000,
    preco_venda_tabela: 155000,
    total_nota_fabrica: 130000,
    custo_floor_plan: 1500,
    custo_total_final: 138000,
    despesas_gerais: 800,
    margem_pct: 8,
    comissao_vendedor: 900,
    dias_estoque: 25,
    placa_troca: null,
    atualizado_em: brt("2026-11-05", "06:00"),
    financiado: false,
    financeira: null,
    valoriza: 0,
    consignado: false,
  };
  const r = { ...base, ...over };
  // Só as colunas que a role enxerga (a 051 não libera cliente_nome/cliente_codigo/cpf/renavam).
  return Object.fromEntries(VENDAS_COLUNAS_CEREBRO.map((c) => [c, r[c] ?? null]));
}

let idVeic = 0;
export function veiculoRow(over: Partial<LinhaDb> = {}): LinhaDb {
  idVeic++;
  return {
    id: idVeic,
    snapshot_id: 77,
    cod_empresa: 2,
    chassi: `9BFZZZ111111${String(idVeic).padStart(5, "0")}`,
    placa: `EST${String(idVeic).padStart(4, "0")}`,
    marca: "FORD",
    modelo: "RANGER XLS 2.2",
    ano_fabricacao: 2023,
    ano_modelo: 2024,
    cor_externa: "BRANCO",
    combustivel: "DIESEL",
    km: 30000,
    patio: "AEROPORTO",
    descricao_situacao: "DISPONIVEL",
    preco_venda: 180000,
    valor_aquisicao: 150000,
    custo_total: 158000,
    dias_patio: 10,
    data_entrada: brt("2026-10-27"),
    vendedor_recebeu: null,
    cod_proposta: null,
    valoriza: 0,
    custo_impostos: 0,
    custo_revisoes: 0,
    custo_holdback: 0,
    custo_acessorios: 0,
    custo_forplan: 0,
    custo_comissoes: 0,
    custo_despesas_gerais: 0,
    custo_adm: null,
    ...over,
  };
}

export function custoRow(placa: string, over: Partial<LinhaDb> = {}): LinhaDb {
  return {
    placa,
    modelo: "RANGER XLS 2.2",
    data_fatura: null,
    data_venda: brt("2026-10-10"),
    dias_patio: 25,
    nota_fabrica_taxa_icms: 130000.11,
    despesas_oficina: 1200.35,
    frete_icms_frete: 0,
    forplan: 1500.5,
    impostos: 3000.07,
    comissoes: 900,
    ganhos_indiretos: 4000.33,
    adm: 500,
    despesas_gerais: 800.01,
    custo_total: 133900.71,
    valor_vendido: 150000.45,
    margem_real: 16099.74,
    margem_pct: 10.73,
    atualizado_em: brt("2026-11-05", "06:00"),
    ...over,
  };
}

export function fipeRow(chassi: string, preco: number, over: Partial<LinhaDb> = {}): LinhaDb {
  return {
    chassi,
    preco_fipe: preco,
    fipe_marca_cod: "22",
    fipe_marca_nome: "Ford",
    fipe_modelo_cod: 9999,
    fipe_modelo_nome: "Ranger XLS 2.2",
    fipe_ano_cod: "2024-3",
    fipe_ano_nome: "2024 Diesel",
    score: 0.92,
    plausibilidade_verificada: true,
    fipe_referencia: "novembro/2026",
    fipe_referencia_cod: 340,
    atualizado_em: brt("2026-11-01"),
    ...over,
  };
}

export type Tabelas = {
  vendas: LinhaDb[];
  veiculos: LinhaDb[];
  meta: LinhaDb[];
  custos: LinhaDb[];
  custosEstoque: LinhaDb[];
  fipe: LinhaDb[];
  cautelar: LinhaDb[];
  lojas: LinhaDb[];
  syncLog: LinhaDb[];
  syncLogSucesso: LinhaDb[];
  assinatura: string;
};

/** Estoque e vendas cobrindo os casos que as tools filtram. */
export function tabelasPadrao(): Tabelas {
  idVenda = 0;
  idVeic = 0;
  const vendas = [
    // Aeroporto (cod 2): 4 vendas em 3 meses, 2 com custo oficial
    vendaRow({ placa: "AAA1A11", data_venda: brt("2026-08-05"), valor_venda: 150000.45 }),
    vendaRow({ placa: "AAA1A12", data_venda: brt("2026-09-30", "23:30"), valor_venda: 98000.1, custo_total_final: 99500.2,
      modelo: "KA SE 1.0", vendedor_nome: "MARIA SOUZA", vendedor_codigo: "V2", placa_troca: "TRC0001", dias_estoque: 80 }),
    vendaRow({ placa: "AAA1A13", data_venda: brt("2026-10-01", "00:10"), valor_venda: 120000, custo_total_final: 110000.99 }),
    vendaRow({ placa: "AAA1A14", data_venda: brt("2026-10-31", "23:59"), valor_venda: 210000.5 }),
    // Buriti GWM (cod 5)
    vendaRow({ placa: "BBB2B21", cod_empresa: 5, empresa_nome: "NAVESA GWM BURITI", marca: "GWM", modelo: "HAVAL H6 PHEV",
      data_venda: brt("2026-10-15"), valor_venda: 260000, custo_total_final: 275000.75, vendedor_nome: "PEDRO LIMA", vendedor_codigo: "V3" }),
    vendaRow({ placa: "BBB2B22", cod_empresa: 5, empresa_nome: "NAVESA GWM BURITI", marca: "GWM", modelo: "HAVAL H6 PHEV",
      data_venda: brt("2026-10-20"), valor_venda: 255000, custo_total_final: 270100.3, vendedor_nome: "PEDRO LIMA", vendedor_codigo: "V3" }),
    vendaRow({ placa: "BBB2B23", cod_empresa: 5, empresa_nome: "NAVESA GWM BURITI", marca: "GWM", modelo: "HAVAL H6 PHEV",
      data_venda: brt("2026-11-02"), valor_venda: 249000, custo_total_final: 251000 }),
    // Renault Aeroporto (cod 12) — nome parecido para testar ambiguidade
    vendaRow({ placa: "CCC3C31", cod_empresa: 12, empresa_nome: "NAVESA RENAULT AEROPORTO", marca: "RENAULT", modelo: "KWID ZEN",
      data_venda: brt("2026-09-12"), valor_venda: 68000, custo_total_final: 64000.4 }),
    // Sem data (só entra sem filtro de período)
    vendaRow({ placa: "DDD4D41", cod_empresa: 12, empresa_nome: "NAVESA RENAULT AEROPORTO", marca: "RENAULT", modelo: "KWID ZEN",
      data_venda: null, valor_venda: 70000, custo_total_final: 66000 }),
    // Loja ignorada (29): some de tudo, junto com o custo da placa
    vendaRow({ placa: "IGN9I99", cod_empresa: 29, empresa_nome: "NAVESA FORD CAMPO GRANDE", valor_venda: 99999 }),
  ];
  const veiculos = [
    veiculoRow({ placa: "EST-0001", dias_patio: 5 }),
    veiculoRow({ dias_patio: 45, preco_venda: 200000 }), // +11,1% vs FIPE 180k
    veiculoRow({ dias_patio: 61, patio: "PREPARAÇÃO", cod_proposta: "P123" }),
    veiculoRow({ dias_patio: 90, valor_aquisicao: 149999.99 }),
    veiculoRow({ dias_patio: 91, modelo: "KA SE 1.0", marca: "FORD", valor_aquisicao: 52000.5, preco_venda: 61990 }),
    veiculoRow({ dias_patio: 200, modelo: "KA SE 1.0", valor_aquisicao: 50000.25, preco_venda: 55000, patio: "OFICINA CENTRAL" }),
    veiculoRow({ cod_empresa: 5, marca: "GWM", modelo: "HAVAL H6 PHEV", dias_patio: 120, valor_aquisicao: 240000.1, preco_venda: 239900 }),
    veiculoRow({ cod_empresa: 5, marca: "GWM", modelo: "HAVAL H6 PHEV", dias_patio: 31, valor_aquisicao: 238000, preco_venda: 249900 }),
    veiculoRow({ cod_empresa: 12, marca: "RENAULT", modelo: "KWID ZEN", dias_patio: null, valor_aquisicao: 55000, preco_venda: null }),
    veiculoRow({ cod_empresa: 8, marca: "FORD", modelo: "TERRITORY", dias_patio: 75, valor_aquisicao: 190000, preco_venda: 205000 }),
    veiculoRow({ cod_empresa: 29, dias_patio: 300 }), // ignorada
  ];
  const ch = (i: number) => String(veiculos[i].chassi);
  return {
    vendas,
    veiculos,
    meta: [{ id: 77, arquivo_nome: "sync-nbs", data_geracao: brt("2026-11-06", "06:00"), total_veiculos: 11, total_lojas: 5 }],
    custos: [
      custoRow("AAA1A11", { valor_vendido: 150000.45, custo_total: 133900.71 }),
      custoRow("AAA1A14", { valor_vendido: 210000.5, custo_total: 201234.56, ganhos_indiretos: 7000.01 }),
      custoRow("IGN9I99", { valor_vendido: 99999, custo_total: 1 }),
    ],
    custosEstoque: [
      { placa: "EST-0001", cod_empresa: 2, modelo: "RANGER XLS 2.2", dias_patio: 5, nota_fabrica: 150000, revisoes: 300,
        forplan: 800, holdback: 0, acessorios: 1200, adm: 0, impostos: 2000, comissoes: 0, desp_gerais: 150,
        custo_total: 154450, tabela: 180000, lucro_bruto: 25550, bonus: 0, ganhos_indiretos: 0, atualizado_em: brt("2026-11-01") },
    ],
    fipe: [
      fipeRow(ch(0), 175000),
      fipeRow(ch(1), 180000),
      fipeRow(ch(4), 70000),
      fipeRow(ch(6), 230000),
      fipeRow(ch(3), 150000, { score: 0.4 }), // não confirmado → sem FIPE
      fipeRow(ch(9), 210000, { fipe_referencia: null }), // sem referência → sem FIPE
    ],
    cautelar: [
      { chassi: ch(5), status: "reprovado", atualizado_em: brt("2026-10-01") },
      { chassi: ch(0), status: "aprovado", atualizado_em: brt("2026-10-01") },
    ],
    lojas: [],
    syncLog: [
      { id: 10, fonte: "veiculos", iniciado_em: brt("2026-11-06", "06:00"), finalizado_em: brt("2026-11-06", "06:02"), status: "sucesso", linhas_lidas: 11, linhas_gravadas: 11, duracao_ms: 120000 },
      { id: 11, fonte: "vendas", iniciado_em: brt("2026-11-06", "06:03"), finalizado_em: brt("2026-11-06", "06:04"), status: "sucesso", linhas_lidas: 10, linhas_gravadas: 10, duracao_ms: 60000 },
    ],
    syncLogSucesso: [
      { id: 10, fonte: "veiculos", iniciado_em: brt("2026-11-06", "06:00"), finalizado_em: brt("2026-11-06", "06:02"), status: "sucesso", linhas_lidas: 11, linhas_gravadas: 11, duracao_ms: 120000 },
      { id: 11, fonte: "vendas", iniciado_em: brt("2026-11-06", "06:03"), finalizado_em: brt("2026-11-06", "06:04"), status: "sucesso", linhas_lidas: 10, linhas_gravadas: 10, duracao_ms: 60000 },
    ],
    assinatura: "a1",
  };
}

/** `Consulta` falsa: responde por igualdade de SQL; registra o que foi pedido. */
export function consultaFalsa(t: Tabelas, log: string[] = []): Consulta {
  const porSql = new Map<string, () => LinhaDb[]>([
    [SQL.vendas, () => t.vendas],
    [SQL.veiculos, () => t.veiculos],
    [SQL.meta, () => t.meta],
    [SQL.custos, () => t.custos],
    [SQL.custosEstoque, () => t.custosEstoque],
    [SQL.fipe, () => t.fipe],
    [SQL.cautelar, () => t.cautelar],
    [SQL.lojas, () => t.lojas],
    [SQL.syncLog, () => t.syncLog],
    [SQL.syncLogSucesso, () => t.syncLogSucesso],
    [SQL.frescor, () => [{ assinatura: t.assinatura }]],
  ]);
  return async (sql) => {
    log.push(sql);
    const f = porSql.get(sql);
    if (!f) throw new Error(`SQL inesperado: ${sql.slice(0, 80)}`);
    return { rows: structuredClone(f()) };
  };
}

export async function snapshotPadrao(t: Tabelas = tabelasPadrao()): Promise<Snapshot> {
  return carregarSnapshot(consultaFalsa(t), () => AGORA);
}

export function contexto(snapshot: Snapshot, over: Partial<ContextoTool> = {}): ContextoTool {
  return { snapshot, cacheDesatualizado: false, agora: AGORA, ...over };
}
