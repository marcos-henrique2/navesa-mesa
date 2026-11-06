/**
 * Paridade do refactor fatia 1a (v2, sobre o main com markup oficial NBS, valoriza,
 * financiado/consignado e custos_estoque_detalhado em veiculos): mappers +
 * preparar-datasets (puros) vs o pipeline que vivia dentro de `inventoryStore.load()`
 * e os `fromRow` privados de `src/lib/data/*.ts`.
 *
 * `legado*` abaixo são cópias literais do código removido (main d41c9d2). Se alguém
 * mexer em mapper/`prepararDatasets` e mudar número, este teste quebra.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { VendaParsed, VendasSnapshotMeta } from "@/lib/parsers/nbs-vendas-xlsx";
import type { VeiculoParsed, SnapshotMeta } from "@/lib/parsers/nbs-xlsx";
import type { CustoDetalhado, CustosMeta } from "@/lib/parsers/nbs-custos-xls";
import type { CustoEstoqueDetalhado, CustosEstoquePdfMeta } from "@/lib/parsers/nbs-custos-estoque-pdf";
import { LOJAS_IGNORADAS, isLojaIgnorada } from "@/lib/config/lojas-ignoradas";
import { normalizarPlaca, normalizarIdentificador } from "@/lib/utils/placa";
import { calcMargemVenda, agregarMargem } from "@/lib/analytics/margem";
import { montarBundle } from "@/lib/analytics/insights";
import { montarCustoEstoqueView } from "@/lib/veiculos/custo-estoque-view";
import { COLUNAS_ESTOQUE } from "@/lib/export/colunas-estoque";
import { resolverCustoImpostosComPrioridadeManual } from "@/lib/export/custo-estoque-fallback";
import { calcularCustoReal } from "@/lib/export/custo-real";
import { mapearLinha, contarComprasPorClienteNoAno } from "@/lib/export/vendas-matriz/coletar-dados";
import { calcularDerivadosLinha } from "@/lib/export/vendas-matriz/tipos";
import {
  prepararDatasets,
  prepararDatasetsDeLinhas,
  type DadosCarregados,
  type DatasetsPreparados,
  type LinhasBrutas,
  type LojaInfo,
  type VendedorInfo,
} from "@/lib/data/preparar-datasets";
import {
  vendaFromRow,
  CLIENTE_SEM_NOME,
  VENDAS_COLUNAS_CEREBRO,
  type ColunaVendaRestrita,
  type VendaRow,
} from "@/lib/data/mappers/vendas";
import { veiculoFromRow, snapshotMetaFromRow, type VeiculoRow } from "@/lib/data/mappers/veiculos";
import { custoFromRow, type CustoRow } from "@/lib/data/mappers/custos";
import { montarCustosEstoque, type CustoEstoqueRow } from "@/lib/data/mappers/custos-estoque";
import { montarBatchFipe, type FipeBatchRow } from "@/lib/data/mappers/fipe-batch";
import { montarCautelares, CAUTELAR_COLUNAS_CEREBRO } from "@/lib/data/mappers/cautelar";
import { VEICULOS_FLAGS_COLUNAS_CEREBRO } from "@/lib/data/mappers/veiculos-flags";
import { venda, custo, veiculo } from "./_mocks";

const centavos = (n: number | null | undefined): number | null => (n == null ? null : Math.round(n * 100));

// ───── fromRow legados (cópia literal de src/lib/data/*.ts no main d41c9d2) ─────

function legadoVendaFromRow(r: VendaRow): VendaParsed {
  const parseDate = (v: unknown): Date | null => {
    if (v == null || v === "") return null;
    const d = new Date(v as string);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  return {
    chassi: r.chassi,
    placa: r.placa,
    modelo: r.modelo,
    marca: r.marca,
    ano_fabricacao: r.ano_fabricacao,
    ano_modelo: r.ano_modelo,
    cor_externa: r.cor_externa,
    renavam: r.renavam as string | null,
    km: r.km,
    cod_empresa: r.cod_empresa,
    empresa_nome: r.empresa_nome,
    patio: r.patio,
    vendedor_codigo: r.vendedor_codigo,
    vendedor_nome: r.vendedor_nome,
    vendedor_cpf: r.vendedor_cpf as string | null,
    vendedor_recebeu: r.vendedor_recebeu,
    cliente_codigo: r.cliente_codigo as string | null,
    cliente_nome: r.cliente_nome as string,
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
    consignado: r.consignado ?? false,
  };
}

function legadoVeiculoFromRow(r: VeiculoRow): VeiculoParsed {
  const parseDate = (v: unknown): Date | null => {
    if (v == null || v === "") return null;
    const d = new Date(v as string);
    return Number.isNaN(d.getTime()) ? null : d;
  };
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
    custo_despesas_gerais: r.custo_despesas_gerais ?? 0,
    custo_adm: r.custo_adm ?? null,
  };
}

/** custos / custos_estoque legados: cópia campo a campo (+ parseDate nas datas). */
function legadoCopia<T>(row: object, datas: string[], descartar: string[]): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (descartar.includes(k)) continue;
    out[k] = datas.includes(k) ? (v == null || v === "" ? null : new Date(v as string)) : v;
  }
  return out as T;
}

function legadoListCustosEstoque(rows: CustoEstoqueRow[]) {
  const codEmpresaPorPlaca: Record<string, number> = {};
  const itens = rows.map((r) => {
    if (r.cod_empresa != null) codEmpresaPorPlaca[r.placa] = r.cod_empresa;
    return legadoCopia<CustoEstoqueDetalhado>(r, [], ["cod_empresa"]);
  });
  return { itens, codEmpresaPorPlaca };
}

// ───── Pipeline legado (cópia literal do inventoryStore.load() no main d41c9d2) ─────

function legadoDerivarVendedores(vendas: VendaParsed[]): Record<string, VendedorInfo> {
  const out: Record<string, VendedorInfo> = {};
  for (const v of vendas) {
    if (v.vendedor_codigo && v.vendedor_nome) {
      out[v.vendedor_codigo] = { codigo: v.vendedor_codigo, nome: v.vendedor_nome, cpf: v.vendedor_cpf };
    }
  }
  return out;
}

function legadoDerivarVendasMeta(vendas: VendaParsed[]): VendasSnapshotMeta | null {
  if (vendas.length === 0) return null;
  let ini: number | null = null, fim: number | null = null;
  const lojas = new Set<number>(), vendedores = new Set<string>();
  for (const v of vendas) {
    if (v.data_venda) {
      const t = new Date(v.data_venda).getTime();
      if (ini == null || t < ini) ini = t;
      if (fim == null || t > fim) fim = t;
    }
    lojas.add(v.cod_empresa);
    if (v.vendedor_codigo) vendedores.add(v.vendedor_codigo);
  }
  return {
    arquivo_nome: "supabase",
    data_geracao: null,
    total_vendas: vendas.length,
    total_lojas: lojas.size,
    total_vendedores: vendedores.size,
    periodo_inicio: ini ? new Date(ini) : null,
    periodo_fim: fim ? new Date(fim) : null,
  };
}

function legadoCustosMeta(qt: number): CustosMeta | null {
  if (qt === 0) return null;
  return { arquivo_nome: "supabase", periodo: null, data_geracao: null, total_vendas: qt, loja_principal: null };
}

function legadoCustosEstoqueMeta(qt: number): CustosEstoquePdfMeta | null {
  if (qt === 0) return null;
  return { arquivo_nome: "supabase", empresa: "", filial: "", cod_empresa: null, data_impressao: null, total_veiculos: qt };
}

function pipelineLegado(
  vendasDb: VendaParsed[],
  veiculosDb: VeiculoParsed[],
  custosDb: CustoDetalhado[],
  custosEstoqueDb: { itens: CustoEstoqueDetalhado[]; codEmpresaPorPlaca: Record<string, number> },
  metaDb: SnapshotMeta | null,
  currentLojas: Record<number, LojaInfo>,
): DatasetsPreparados {
  const vendasFiltradas = vendasDb.filter((v) => !isLojaIgnorada(v.cod_empresa));
  const veiculosFiltrados = veiculosDb.filter((v) => !isLojaIgnorada(v.cod_empresa));
  const placasIgnoradas = new Set<string>();
  for (const v of vendasDb) {
    if (isLojaIgnorada(v.cod_empresa) && v.placa) placasIgnoradas.add(v.placa);
  }
  const custosFiltrados = custosDb.filter((c) => !placasIgnoradas.has(c.placa));
  const custosEstoqueFiltrados = custosEstoqueDb.itens.filter((c) => {
    const cod = custosEstoqueDb.codEmpresaPorPlaca[c.placa];
    return !isLojaIgnorada(cod);
  });
  const cMap: Record<string, CustoDetalhado> = {};
  for (const c of custosFiltrados) if (c.placa) cMap[c.placa] = c;
  const ceMap: Record<string, CustoEstoqueDetalhado> = {};
  for (const c of custosEstoqueFiltrados) {
    if (c.placa) ceMap[normalizarPlaca(c.placa)] = c;
  }
  const nextLojas = { ...currentLojas };
  for (const v of vendasFiltradas) {
    if (v.empresa_nome && !nextLojas[v.cod_empresa]?.nome) {
      nextLojas[v.cod_empresa] = {
        cod_empresa: v.cod_empresa,
        nome: v.empresa_nome,
        cidade: nextLojas[v.cod_empresa]?.cidade ?? "",
      };
    } else if (!nextLojas[v.cod_empresa]) {
      nextLojas[v.cod_empresa] = { cod_empresa: v.cod_empresa, nome: "", cidade: "" };
    }
  }
  for (const v of veiculosFiltrados) {
    if (!nextLojas[v.cod_empresa]) {
      nextLojas[v.cod_empresa] = { cod_empresa: v.cod_empresa, nome: "", cidade: "" };
    }
  }
  for (const cod of LOJAS_IGNORADAS) delete nextLojas[cod];
  return {
    vendas: vendasFiltradas,
    vendasMeta: legadoDerivarVendasMeta(vendasFiltradas),
    vendedores: legadoDerivarVendedores(vendasFiltradas),
    custosPorPlaca: cMap,
    custosMeta: legadoCustosMeta(custosFiltrados.length),
    custosEstoquePorPlaca: ceMap,
    custosEstoqueMeta: legadoCustosEstoqueMeta(custosEstoqueFiltrados.length),
    veiculos: veiculosFiltrados,
    meta: metaDb,
    lojas: nextLojas,
  };
}

/** Caminho antigo completo: fromRow legados + pipeline legado do store. */
function caminhoAntigo(l: LinhasBrutas, lojas: Record<number, LojaInfo>): DatasetsPreparados {
  const meta = l.meta
    ? {
        arquivo_nome: l.meta.arquivo_nome,
        data_geracao: l.meta.data_geracao ? new Date(l.meta.data_geracao) : null,
        total_veiculos: l.meta.total_veiculos ?? 0,
        total_lojas: l.meta.total_lojas ?? 0,
      }
    : null;
  return pipelineLegado(
    l.vendas.map(legadoVendaFromRow),
    l.veiculos.map(legadoVeiculoFromRow),
    l.custos.map((r) => legadoCopia<CustoDetalhado>(r, ["data_fatura", "data_venda"], [])),
    legadoListCustosEstoque(l.custosEstoque),
    meta,
    lojas,
  );
}

// ───── Fixtures (linhas cruas, como o Supabase devolve) ─────

const IGNORADA = [...LOJAS_IGNORADAS][0];

function vendaRow(over: Partial<VendaParsed> = {}): VendaRow {
  const v = venda(over);
  return {
    ...v,
    data_venda: v.data_venda?.toISOString() ?? null,
    data_faturamento: v.data_faturamento?.toISOString() ?? null,
    data_entrada: v.data_entrada?.toISOString() ?? null,
    atualizado_em: "2026-10-01T12:00:00.000Z",
  };
}

function custoRow(over: Partial<CustoDetalhado> = {}): CustoRow {
  const c = custo(over);
  return {
    ...c,
    data_fatura: c.data_fatura?.toISOString() ?? null,
    data_venda: c.data_venda?.toISOString() ?? null,
  };
}

function veiculoRow(over: Partial<VeiculoParsed> = {}): VeiculoRow {
  const v = veiculo(over);
  return { ...v, snapshot_id: 7, data_entrada: v.data_entrada?.toISOString() ?? null };
}

function custoEstoqueRow(placa: string, cod: number | null, over: Partial<CustoEstoqueDetalhado> = {}): CustoEstoqueRow {
  return {
    placa,
    cod_empresa: cod,
    modelo: "RANGER XLS 2.2",
    dias_patio: 34,
    nota_fabrica: 76543.21,
    revisoes: 350.25,
    forplan: 1234.56,
    holdback: 0,
    acessorios: 0,
    adm: 0,
    impostos: 0,
    comissoes: 0,
    desp_gerais: 0,
    custo_total: 78128.02,
    tabela: 89990,
    lucro_bruto: 89990 - 78128.02,
    bonus: 0,
    ganhos_indiretos: 0,
    ...over,
  };
}

function linhasFixture(): LinhasBrutas {
  // Venda C4: snapshot anterior às migrations 039/042 (sem as chaves valoriza/consignado).
  const c4: Partial<VendaRow> = vendaRow({
    chassi: "C4", placa: "DDD4D44", cod_empresa: 2,
    valor_venda: null as unknown as number, custo_total_final: null as unknown as number,
    data_venda: new Date("2026-10-15T13:00:00Z"),
  });
  delete c4.valoriza;
  delete c4.consignado;

  // Veículo V2: linha pré-sync — família custo_* e valoriza NULL no banco.
  const v2: VeiculoRow = {
    ...veiculoRow({ chassi: "V2", placa: "FFF-6F66", cod_empresa: 8, custo_total: null, preco_venda: null }),
    valoriza: null, custo_impostos: null, custo_revisoes: null, custo_holdback: null,
    custo_acessorios: null, custo_forplan: null, custo_comissoes: null, custo_despesas_gerais: null,
  };

  return {
    vendas: [
      // Oficial, financiada, PJ (cadastro NBS), com Valoriza de fábrica
      vendaRow({
        chassi: "9BFZH55L0P8000001", placa: "AAA1A11", cod_empresa: 2, empresa_nome: "NAVESA FORD AEROPORTO",
        modelo: "RANGER XLS 2.2", valor_venda: 87350.45, total_nota_fabrica: 76543.21,
        financiado: true, financeira: "BANCO FORD", valoriza: 2500.37, consignado: false,
        cliente_tipo: "PJ", cliente_codigo: "12.345.678/0001-90",
        data_venda: new Date("2026-10-02T13:00:00Z"),
      }),
      // Sem custo oficial → fallback; à vista
      vendaRow({
        chassi: "C2", placa: "BBB2B22", cod_empresa: 2, valor_venda: 54999.99, custo_total_final: 51234.56,
        total_nota_fabrica: 50123.45, financiado: false, financeira: null, cliente_codigo: "12.345.678/0001-90",
        data_venda: new Date("2026-10-20T13:00:00Z"),
      }),
      // Consignado, outra loja, vendedor sem nome, data nula
      vendaRow({
        chassi: "C3", placa: "CCC3C33", cod_empresa: 5, empresa_nome: "", vendedor_codigo: "V9",
        vendedor_nome: null as unknown as string, data_venda: null, consignado: true, cliente_tipo: null,
      }),
      c4 as VendaRow,
      // Loja ignorada: some, e o custo da placa dela também some
      vendaRow({ chassi: "C5", placa: "EEE5E55", cod_empresa: IGNORADA, valor_venda: 70000 }),
    ],
    veiculos: [
      // Markup oficial NBS (sync Oracle): custo_* preenchidos, HoldBack 0 (cai pro manual), ADM não apurado
      veiculoRow({
        chassi: "V1", placa: "AAA1A11", cod_empresa: 2, data_entrada: new Date("2026-09-01T00:00:00Z"),
        valor_aquisicao: 76543.21, custo_total: 81000.01, preco_venda: 89990, valoriza: 1500.5,
        custo_impostos: 1600, custo_revisoes: 350.25, custo_holdback: 0, custo_acessorios: 0,
        custo_forplan: 1234.56, custo_comissoes: 450, custo_despesas_gerais: 300, custo_adm: null,
      }),
      v2,
      veiculoRow({ chassi: "V3", placa: "GGG7G77", cod_empresa: IGNORADA }),
    ],
    custos: [
      custoRow({ placa: "AAA1A11", valor_vendido: 87350.45, custo_total: 80123.78, nota_fabrica_taxa_icms: 76543.21 }),
      custoRow({ placa: "EEE5E55", valor_vendido: 70000, custo_total: 60000 }),
      custoRow({ placa: "ZZZ9Z99", valor_vendido: 10000.1, custo_total: 9999.99, data_venda: null }),
    ],
    custosEstoque: [
      // Placa com hífen no PDF manual → chave normalizada
      custoEstoqueRow("AAA-1A11", 2, { holdback: 812.34, impostos: 2740.8 }),
      custoEstoqueRow("FFF6F66", 8, { custo_total: 42000.42, tabela: 47990, lucro_bruto: 5989.58 }),
      custoEstoqueRow("GGG7G77", IGNORADA),
      custoEstoqueRow("HHH8H88", null, { custo_total: 42000.42 }),
    ],
    meta: { arquivo_nome: "sync-oracle", data_geracao: "2026-10-30T08:00:00.000Z", total_veiculos: null, total_lojas: 3 },
    fipe: [
      {
        chassi: "V1", preco_fipe: 95000, fipe_marca_cod: "22", fipe_marca_nome: "Ford", fipe_modelo_cod: 10,
        fipe_modelo_nome: "Ranger", fipe_ano_cod: "2024-1", fipe_ano_nome: "2024", score: 0.9,
        plausibilidade_verificada: true, fipe_referencia: "outubro/2026", fipe_referencia_cod: 338,
        atualizado_em: "2026-10-02T00:00:00.000Z",
      },
      {
        chassi: "V2", preco_fipe: 40000, fipe_marca_cod: null, fipe_marca_nome: null, fipe_modelo_cod: null,
        fipe_modelo_nome: null, fipe_ano_cod: null, fipe_ano_nome: null, score: null,
        plausibilidade_verificada: null, fipe_referencia: "  ", fipe_referencia_cod: null,
        atualizado_em: "2026-10-01T00:00:00.000Z",
      },
    ] satisfies FipeBatchRow[],
    cautelares: [
      { chassi: "V1", status: "aprovado", observacao: null, atualizado_em: "2026-10-01T00:00:00.000Z" },
      // Linha do cérebro: sem `observacao` (coluna bloqueada na 051)
      { chassi: "V2", status: "reprovado", atualizado_em: "2026-10-01T00:00:00.000Z" },
    ],
  };
}

const LOJAS_ATUAIS: Record<number, LojaInfo> = {
  2: { cod_empresa: 2, nome: "", cidade: "Goiânia" },
  [IGNORADA]: { cod_empresa: IGNORADA, nome: "IGNORADA", cidade: "" },
};

/** Caminho do browser: list*() aplicam os mappers e o store chama prepararDatasets. */
function dadosDoBrowser(l: LinhasBrutas): DadosCarregados {
  return {
    vendas: l.vendas.map(vendaFromRow),
    veiculos: l.veiculos.map(veiculoFromRow),
    custos: l.custos.map(custoFromRow),
    custosEstoque: montarCustosEstoque(l.custosEstoque),
    meta: l.meta ? snapshotMetaFromRow(l.meta) : null,
  };
}

/** Linhas como o cérebro recebe: `vendas` sem as colunas restritas. */
function semPii(l: LinhasBrutas): LinhasBrutas {
  return {
    ...l,
    vendas: l.vendas.map((r) => {
      const s: Partial<VendaRow> = { ...r };
      delete s.cliente_nome;
      delete s.cliente_codigo;
      delete s.vendedor_cpf;
      delete s.renavam;
      return s as VendaRow;
    }),
  };
}

// ───── Testes ─────

test("mappers: idênticos aos fromRow legados (incl. fallbacks valoriza/consignado/custo_*)", () => {
  const l = linhasFixture();
  for (const r of l.vendas) assert.deepEqual(vendaFromRow(r), legadoVendaFromRow(r));
  for (const r of l.veiculos) assert.deepEqual(veiculoFromRow(r), legadoVeiculoFromRow(r));
  for (const r of l.custos) {
    assert.deepEqual(custoFromRow(r), legadoCopia<CustoDetalhado>(r, ["data_fatura", "data_venda"], []));
  }
  assert.deepEqual(montarCustosEstoque(l.custosEstoque), legadoListCustosEstoque(l.custosEstoque));

  const c4 = vendaFromRow(l.vendas[3]);
  assert.equal(c4.valoriza, 0);
  assert.equal(c4.consignado, false);
  const v2 = veiculoFromRow(l.veiculos[1]);
  assert.equal(v2.valoriza, 0);
  assert.equal(v2.custo_despesas_gerais, 0);
  assert.equal(v2.custo_adm, null); // não apurado nunca vira 0
  const ce = montarCustosEstoque(l.custosEstoque);
  assert.deepEqual(ce.codEmpresaPorPlaca, { "AAA-1A11": 2, FFF6F66: 8, GGG7G77: IGNORADA });
  assert.ok(ce.itens.every((i) => !("cod_empresa" in i)));
});

test("prepararDatasets: mesma saída do pipeline legado do inventoryStore", () => {
  const l = linhasFixture();
  const novo = prepararDatasets(dadosDoBrowser(l), LOJAS_ATUAIS);
  const antigo = caminhoAntigo(l, LOJAS_ATUAIS);
  assert.deepEqual(novo, antigo);
  // ordem das chaves de lojas também (vai pro localStorage via JSON.stringify)
  assert.equal(JSON.stringify(novo.lojas), JSON.stringify(antigo.lojas));
  // não muta as lojas de entrada
  assert.equal(LOJAS_ATUAIS[2].nome, "");
  assert.ok(LOJAS_ATUAIS[IGNORADA]);
  // meta reconstruída pós-load: cod_empresa não apurado (null), nunca 0
  assert.equal(novo.custosEstoqueMeta?.cod_empresa, null);
});

test("prepararDatasetsDeLinhas (caminho do cérebro) == caminho do browser", () => {
  const l = linhasFixture();
  const cerebro = prepararDatasetsDeLinhas(l, LOJAS_ATUAIS);
  const browser = prepararDatasets(dadosDoBrowser(l), LOJAS_ATUAIS);
  const { fipe, cautelares, ...resto } = cerebro;
  assert.deepEqual(resto, browser);
  assert.deepEqual(cautelares, { V1: "aprovado", V2: "reprovado" });
  assert.ok(fipe);
  assert.equal(fipe.totalVeiculos, 2);
  assert.equal(fipe.timestamp, new Date("2026-10-02T00:00:00.000Z").getTime());
  assert.deepEqual(fipe.erros.map((e) => [e.chassi, e.motivo, e.modelo]), [["V2", "score-baixo", "—"]]);
  assert.equal(fipe.items.V2.fipeReferencia, null);
  assert.equal(fipe.items.V2.plausibilidadeVerificada, false);
});

test("montarBundle: mesmo resultado sobre datasets do caminho antigo e do novo", () => {
  const l = linhasFixture();
  const novo = prepararDatasetsDeLinhas(l, LOJAS_ATUAIS);
  const antigo = caminhoAntigo(l, LOJAS_ATUAIS);
  const fipeAntigo = montarBatchFipe(l.fipe ?? []);
  const cautelaresAntigo = montarCautelares(l.cautelares ?? []);
  assert.deepEqual(
    montarBundle(novo.vendas, novo.custosPorPlaca, novo.veiculos, novo.fipe, novo.cautelares),
    montarBundle(antigo.vendas, antigo.custosPorPlaca, antigo.veiculos, fipeAntigo, cautelaresAntigo),
  );
});

test("filtros: loja ignorada sai de vendas, veículos, custos e custos de estoque", () => {
  const ds = prepararDatasets(dadosDoBrowser(linhasFixture()), LOJAS_ATUAIS);
  assert.deepEqual(ds.vendas.map((v) => v.chassi), ["9BFZH55L0P8000001", "C2", "C3", "C4"]);
  assert.deepEqual(ds.veiculos.map((v) => v.chassi), ["V1", "V2"]);
  assert.deepEqual(Object.keys(ds.custosPorPlaca).sort(), ["AAA1A11", "ZZZ9Z99"]);
  // placa normalizada; cod_empresa null não é ignorado
  assert.deepEqual(Object.keys(ds.custosEstoquePorPlaca).sort(), ["AAA1A11", "FFF6F66", "HHH8H88"]);
  assert.equal(ds.custosMeta?.total_vendas, 2);
  assert.equal(ds.custosEstoqueMeta?.total_veiculos, 3);
  assert.deepEqual(Object.keys(ds.lojas).map(Number).sort((a, b) => a - b), [2, 5, 8]);
  assert.equal(ds.lojas[2].nome, "NAVESA FORD AEROPORTO");
  assert.equal(ds.lojas[2].cidade, "Goiânia");
  assert.equal(ds.lojas[5].nome, "");
  assert.equal(ds.meta?.total_veiculos, 0);
  assert.equal(ds.vendasMeta?.total_vendas, 4);
  assert.equal(ds.vendasMeta?.periodo_inicio?.toISOString(), "2026-10-02T13:00:00.000Z");
  assert.equal(ds.vendasMeta?.periodo_fim?.toISOString(), "2026-10-20T13:00:00.000Z");
  assert.ok(!ds.vendedores.V9); // sem nome não entra
});

test("margem: centavo-perfect e idêntica entre caminho antigo e novo", () => {
  const l = linhasFixture();
  const novo = prepararDatasets(dadosDoBrowser(l), LOJAS_ATUAIS);
  const antigo = caminhoAntigo(l, LOJAS_ATUAIS);
  for (let i = 0; i < novo.vendas.length; i++) {
    assert.deepEqual(
      calcMargemVenda(novo.vendas[i], novo.custosPorPlaca),
      calcMargemVenda(antigo.vendas[i], antigo.custosPorPlaca),
    );
  }
  assert.deepEqual(agregarMargem(novo.vendas, novo.custosPorPlaca), agregarMargem(antigo.vendas, antigo.custosPorPlaca));

  const porChassi = Object.fromEntries(novo.vendas.map((v) => [v.chassi, calcMargemVenda(v, novo.custosPorPlaca)]));
  // Oficial: 87.350,45 − 80.123,78 = 7.226,67
  assert.equal(porChassi["9BFZH55L0P8000001"].fonte, "oficial");
  assert.equal(centavos(porChassi["9BFZH55L0P8000001"].margem), 722667);
  // Sem custo oficial → fallback: 54.999,99 − 51.234,56 = 3.765,43
  assert.equal(porChassi.C2.fonte, "fallback");
  assert.equal(centavos(porChassi.C2.margem), 376543);
  // Valores nulos → zera sem NaN
  assert.equal(porChassi.C4.valor, 0);
  assert.equal(porChassi.C4.custo, 0);
  assert.equal(porChassi.C4.margem, 0);
  assert.equal(porChassi.C4.margemPct, 0);
});

test("estoque: markup oficial NBS + fallback manual (HoldBack/Impostos) idênticos e centavo-perfect", () => {
  const l = linhasFixture();
  const novo = prepararDatasets(dadosDoBrowser(l), LOJAS_ATUAIS);
  const antigo = caminhoAntigo(l, LOJAS_ATUAIS);
  const manualDe = (ds: DatasetsPreparados, v: VeiculoParsed) => ds.custosEstoquePorPlaca[normalizarPlaca(v.placa)] ?? null;

  for (let i = 0; i < novo.veiculos.length; i++) {
    const vn = novo.veiculos[i], va = antigo.veiculos[i];
    assert.deepEqual(montarCustoEstoqueView(vn, manualDe(novo, vn)), montarCustoEstoqueView(va, manualDe(antigo, va)));
    // Catálogo inteiro do Relatório de Estoque Customizado (custo real, fallbacks, totais)
    const exN = { ...vn, custoEstoqueManual: manualDe(novo, vn) };
    const exA = { ...va, custoEstoqueManual: manualDe(antigo, va) };
    for (const col of COLUNAS_ESTOQUE) assert.deepEqual(col.getValor(exN), col.getValor(exA), `coluna ${col.key}`);
  }

  const [v1, v2] = novo.veiculos;
  const view1 = montarCustoEstoqueView(v1, manualDe(novo, v1));
  assert.ok(view1);
  assert.equal(view1.fonte, "automatico");
  assert.equal(centavos(view1.custo_total), 8100001);
  assert.equal(centavos(view1.lucro_bruto), 898999); // 89.990,00 − 81.000,01
  assert.equal(centavos(view1.holdback), 81234); // automático 0 → PDF manual
  assert.equal(view1.adm, 0); // automático null (não apurado) e manual 0
  assert.equal(centavos(view1.impostos), 160000); // card usa o automático
  // Impostos com prioridade manual (relatório nativo NBS): 2.740,80 vence 1.600,00
  assert.equal(centavos(resolverCustoImpostosComPrioridadeManual(v1.custo_impostos, manualDe(novo, v1)?.impostos)), 274080);
  // Custo real = Entrada − Valoriza: 76.543,21 − 1.500,50 = 75.042,71
  assert.equal(centavos(calcularCustoReal(v1.valor_aquisicao, v1.valoriza)), 7504271);

  // Sem markup automático (custo_total null) → PDF manual completo
  const view2 = montarCustoEstoqueView(v2, manualDe(novo, v2));
  assert.ok(view2);
  assert.equal(view2.fonte, "manual");
  assert.equal(centavos(view2.custo_total), 4200042);
  assert.equal(centavos(view2.lucro_bruto), 598958);
});

test("Vendas Matriz: financiado/consignado/valoriza e custo real idênticos e centavo-perfect", () => {
  const l = linhasFixture();
  const montar = (vendas: VendaParsed[], custos: CustoDetalhado[]) => {
    const custosPorPlaca = new Map<string, CustoDetalhado>();
    for (const c of custos) if (c.placa) custosPorPlaca.set(normalizarPlaca(c.placa), c);
    const nomes = new Map<number, string>([[2, "NAVESA FORD AEROPORTO"]]);
    const origem = new Map<string, number>([[normalizarIdentificador("9BFZH55L0P8000001"), 2]]);
    const compras = contarComprasPorClienteNoAno(vendas, 2026);
    return vendas.map((v) => mapearLinha(v, custosPorPlaca, new Map(), origem, nomes, compras));
  };
  const novo = montar(l.vendas.map(vendaFromRow), l.custos.map(custoFromRow));
  const antigo = montar(
    l.vendas.map(legadoVendaFromRow),
    l.custos.map((r) => legadoCopia<CustoDetalhado>(r, ["data_fatura", "data_venda"], [])),
  );
  assert.deepEqual(novo, antigo);
  assert.deepEqual(novo.map(calcularDerivadosLinha), antigo.map(calcularDerivadosLinha));

  const [c1, c2, c3, c4] = novo;
  assert.equal(c1.financiou, true);
  assert.equal(c1.clienteTipo, "PJ");
  assert.equal(c1.consignado, false);
  assert.equal(c2.financiou, false);
  assert.equal(c3.consignado, true);
  assert.equal(c3.financiou, null);
  assert.equal(c4.valoriza, 0);
  assert.equal(c4.consignado, false);

  const d1 = calcularDerivadosLinha(c1);
  // Custo real = NF 76.543,21 − Valoriza 2.500,37 = 74.042,84; lucro = 87.350,45 − 74.042,84 = 13.307,61
  assert.equal(centavos(d1.custoReal), 7404284);
  assert.equal(centavos(d1.lucroBruto), 1330761);
  // Margem líquida = 13.307,61 − desp 1.000 − forplan 3.000 − impostos 1.000 − comissão 500 − ADM 0 = 7.807,61
  assert.equal(centavos(d1.margemLiquida), 780761);
  const d2 = calcularDerivadosLinha(c2);
  // Sem upload manual: NF = total_nota_fabrica 50.123,45; lucro 4.876,54; − desp 1.000 − floor plan 2.000 − comissão 500
  assert.equal(centavos(d2.custoReal), 5012345);
  assert.equal(centavos(d2.lucroBruto), 487654);
  assert.equal(centavos(d2.margemLiquida), 137654);

  // Cérebro (sem cliente_codigo): lojista vira "não sei" (null); números financeiros não mudam
  const cerebro = montar(semPii(l).vendas.map(vendaFromRow), l.custos.map(custoFromRow));
  assert.ok(cerebro.every((x) => x.lojista === null));
  assert.deepEqual(cerebro.map(calcularDerivadosLinha), novo.map(calcularDerivadosLinha));
});

test("vendas sem colunas restritas (role cerebro_leitor): mapper não quebra e margem não muda", () => {
  const completas = linhasFixture();
  const restritas = semPii(completas);
  const a = prepararDatasetsDeLinhas(completas, LOJAS_ATUAIS);
  const b = prepararDatasetsDeLinhas(restritas, LOJAS_ATUAIS);
  for (const v of b.vendas) {
    assert.equal(v.cliente_nome, CLIENTE_SEM_NOME);
    assert.equal(v.cliente_codigo, null);
    assert.equal(v.vendedor_cpf, null);
    assert.equal(v.renavam, null);
  }
  assert.deepEqual(
    b.vendas.map((v) => calcMargemVenda(v, b.custosPorPlaca)),
    a.vendas.map((v) => calcMargemVenda(v, a.custosPorPlaca)),
  );
  assert.deepEqual(agregarMargem(b.vendas, b.custosPorPlaca), agregarMargem(a.vendas, a.custosPorPlaca));
  // Campos novos do main passam intactos sem PII
  assert.deepEqual(
    b.vendas.map((v) => [v.financiado, v.financeira, v.valoriza, v.consignado, v.cliente_tipo]),
    a.vendas.map((v) => [v.financiado, v.financeira, v.valoriza, v.consignado, v.cliente_tipo]),
  );
  // Com as colunas presentes, null do banco passa intacto (comportamento do browser)
  const comNull = vendaFromRow({ ...completas.vendas[0], cliente_codigo: null, renavam: null });
  assert.equal(comNull.cliente_codigo, null);
  assert.equal(comNull.cliente_nome, "CLIENTE TESTE");
});

/** Cópia literal de `clientesRecorrentes` antes do marcador `cliente_pii_ausente` (575b3c0). */
function legadoClientesRecorrentes(vendas: VendaParsed[], custosPorPlaca: DatasetsPreparados["custosPorPlaca"], min: number) {
  const map = new Map<
    string,
    { nome: string; codigo: string | null; tipo: "PF" | "PJ" | "?"; qt: number; valor: number; margem: number }
  >();
  for (const v of vendas) {
    const k = v.cliente_codigo?.trim() || `__sem_doc__${v.cliente_nome ?? ""}`;
    if (!map.has(k)) {
      map.set(k, { nome: v.cliente_nome ?? "?", codigo: v.cliente_codigo, tipo: v.cliente_tipo ?? "?", qt: 0, valor: 0, margem: 0 });
    }
    const r = map.get(k)!;
    const m = calcMargemVenda(v, custosPorPlaca);
    r.qt++;
    r.valor += m.valor;
    r.margem += m.margem;
  }
  return [...map.values()]
    .filter((c) => c.qt >= min)
    .map((c) => ({ nome: c.nome, codigo: c.codigo, tipo: c.tipo, qt: c.qt, faturamento: c.valor, margem: c.margem }))
    .sort((a, b) => b.qt - a.qt);
}

/** Vendas de clientes distintos + 2 vendas reais "(sem nome)"/sem código (acontece no parser NBS). */
function linhasClientes(): LinhasBrutas {
  const vazio = linhasFixture();
  return {
    ...vazio,
    vendas: [
      vendaRow({ chassi: "K1", placa: "KKK1K11", cliente_nome: "ANA", cliente_codigo: null }),
      vendaRow({ chassi: "K2", placa: "KKK2K22", cliente_nome: "BRUNO", cliente_codigo: null }),
      vendaRow({ chassi: "K3", placa: "KKK3K33", cliente_nome: "CARLA", cliente_codigo: "111" }),
      vendaRow({ chassi: "K4", placa: "KKK4K44", cliente_nome: "CARLA", cliente_codigo: "111" }),
      vendaRow({ chassi: "K5", placa: "KKK5K55", cliente_nome: CLIENTE_SEM_NOME, cliente_codigo: null }),
      vendaRow({ chassi: "K6", placa: "KKK6K66", cliente_nome: CLIENTE_SEM_NOME, cliente_codigo: null }),
    ],
  };
}

test("clientesRecorrentes sem PII (cérebro): nenhum cliente recorrente falso no bundle", () => {
  const ds = prepararDatasetsDeLinhas(semPii(linhasClientes()), LOJAS_ATUAIS);
  assert.equal(ds.vendas.length, 6);
  assert.ok(ds.vendas.every((v) => v.cliente_pii_ausente === true && v.cliente_nome === CLIENTE_SEM_NOME));
  const b = montarBundle(ds.vendas, ds.custosPorPlaca, ds.veiculos, ds.fipe, ds.cautelares);
  assert.deepEqual(b.clientesRecorrentes, []);
  // O legado agruparia as 6 vendas num único "(sem nome)" — o bug do QA.
  assert.deepEqual(
    legadoClientesRecorrentes(ds.vendas, ds.custosPorPlaca, 2).map((c) => [c.nome, c.codigo, c.qt]),
    [[CLIENTE_SEM_NOME, null, 6]],
  );
  // Fixture geral sem PII também não produz recorrente
  const geral = prepararDatasetsDeLinhas(semPii(linhasFixture()), LOJAS_ATUAIS);
  assert.deepEqual(montarBundle(geral.vendas, geral.custosPorPlaca, geral.veiculos, geral.fipe, geral.cautelares).clientesRecorrentes, []);
});

test("clientesRecorrentes com PII (app web): idêntico ao legado, inclusive vendas reais \"(sem nome)\"", () => {
  for (const l of [linhasClientes(), linhasFixture()]) {
    const ds = prepararDatasetsDeLinhas(l, LOJAS_ATUAIS);
    assert.ok(ds.vendas.every((v) => !("cliente_pii_ausente" in v)));
    const b = montarBundle(ds.vendas, ds.custosPorPlaca, ds.veiculos, ds.fipe, ds.cautelares);
    assert.deepEqual(b.clientesRecorrentes, legadoClientesRecorrentes(ds.vendas, ds.custosPorPlaca, 2).slice(0, 20));
  }
  const ds = prepararDatasetsDeLinhas(linhasClientes(), LOJAS_ATUAIS);
  const b = montarBundle(ds.vendas, ds.custosPorPlaca, ds.veiculos, ds.fipe, ds.cautelares);
  assert.deepEqual(
    b.clientesRecorrentes?.map((c) => [c.nome, c.codigo, c.qt]),
    [["CARLA", "111", 2], [CLIENTE_SEM_NOME, null, 2]],
  );
  // Só o código ausente (nome presente) não marca; só o nome ausente com código também não.
  const r = linhasClientes().vendas[2];
  assert.equal("cliente_pii_ausente" in vendaFromRow({ ...r, cliente_codigo: null }), false);
  const { cliente_nome: _n, ...semNome } = r;
  void _n;
  assert.equal("cliente_pii_ausente" in vendaFromRow(semNome), false);
});

test("entradas vazias: datasets vazios, metas nulas, sem FIPE", () => {
  const ds = prepararDatasetsDeLinhas({ vendas: [], veiculos: [], custos: [], custosEstoque: [], meta: null });
  assert.deepEqual(ds.vendas, []);
  assert.equal(ds.vendasMeta, null);
  assert.equal(ds.custosMeta, null);
  assert.equal(ds.custosEstoqueMeta, null);
  assert.equal(ds.meta, null);
  assert.equal(ds.fipe, null);
  assert.deepEqual(ds.cautelares, {});
  assert.deepEqual(ds.lojas, {});
  assert.equal(montarBatchFipe([]), null);
  assert.deepEqual(montarCautelares([]), {});
});

// ───── Allowlists da migration 051 ─────

const SQL_051 = readFileSync(join(process.cwd(), "supabase", "migrations", "051_cerebro_leitor.sql"), "utf8");

function allowlist051(tabela: string): { permitidas: string[]; bloqueadas: string[] } {
  const re = new RegExp(`\\('${tabela}',\\s*array\\[([\\s\\S]*?)\\]::text\\[\\],\\s*array\\[([\\s\\S]*?)\\]::text\\[\\]\\)`);
  const m = re.exec(SQL_051);
  assert.ok(m, `bloco de ${tabela} não encontrado na migration 051`);
  const cols = (s: string) => [...s.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  return { permitidas: cols(m[1]), bloqueadas: cols(m[2]) };
}

test("VENDAS_COLUNAS_CEREBRO: igual à allowlist de vendas da migration 051, sem PII", () => {
  const restritas: ColunaVendaRestrita[] = ["cliente_nome", "cliente_codigo", "vendedor_cpf", "renavam"];
  const permitidas: readonly string[] = VENDAS_COLUNAS_CEREBRO;
  assert.equal(permitidas.length, 36);
  assert.equal(new Set(permitidas).size, permitidas.length);
  for (const c of restritas) assert.ok(!permitidas.includes(c), `coluna restrita na allowlist: ${c}`);

  const sql = allowlist051("vendas");
  assert.deepEqual([...permitidas], sql.permitidas);
  assert.deepEqual([...sql.bloqueadas].sort(), [...restritas].sort());

  // Todo campo que vendaFromRow lê está liberado ou é PII tratada como ausente
  const lidos = Object.keys(vendaFromRow(linhasFixture().vendas[0]));
  const faltando = lidos.filter((c) => !permitidas.includes(c) && !(restritas as string[]).includes(c));
  assert.deepEqual(faltando, []);
});

test("CAUTELAR/VEICULOS_FLAGS_COLUNAS_CEREBRO: iguais às allowlists da migration 051", () => {
  assert.deepEqual([...CAUTELAR_COLUNAS_CEREBRO], allowlist051("cautelar").permitidas);
  assert.deepEqual(allowlist051("cautelar").bloqueadas, ["observacao"]);
  assert.deepEqual([...VEICULOS_FLAGS_COLUNAS_CEREBRO], allowlist051("veiculos_flags").permitidas);
  assert.deepEqual(allowlist051("veiculos_flags").bloqueadas, ["observacao_brinde"]);
});

// ───── Pureza (recursiva nos imports de valor) ─────

const RAIZ_SRC = join(process.cwd(), "src");

function resolverImport(de: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(RAIZ_SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(de), spec);
  else return null; // pacote npm: checado pelo regex de proibidos
  for (const cand of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) if (existsSync(cand)) return cand;
  assert.fail(`import não resolvido em ${de}: ${spec}`);
}

/** Imports/re-exports de VALOR (ignora `import type`/`export type`, apagados na compilação). */
function importsDeValor(src: string): string[] {
  const out: string[] = [];
  const re = /^\s*(import|export)\s+(type\s+)?(?:[^"';]*?\s+from\s+)?["']([^"']+)["']/gm;
  for (const m of src.matchAll(re)) if (!m[2]) out.push(m[3]);
  return out;
}

test("módulos puros: sem 'use client', React, zustand, browser ou Supabase — recursivo nos imports", () => {
  const entradas = [
    "lib/data/preparar-datasets.ts",
    "lib/data/mappers/datas.ts",
    "lib/data/mappers/vendas.ts",
    "lib/data/mappers/veiculos.ts",
    "lib/data/mappers/custos.ts",
    "lib/data/mappers/custos-estoque.ts",
    "lib/data/mappers/fipe-batch.ts",
    "lib/data/mappers/cautelar.ts",
    "lib/data/mappers/veiculos-flags.ts",
    "lib/fipe/batch-tipos.ts",
    "lib/inventory/cautelar-tipos.ts",
    // Usados pelo cérebro (cerebro/src/tools): margem canônica, insights e helpers.
    "lib/analytics/insights.ts",
    "lib/analytics/margem.ts",
    "lib/fipe/confianca.ts",
    "lib/inventory/status.ts",
    "lib/inventory/reservado.ts",
    "lib/pricing/classificacao.ts",
  ].map((f) => join(RAIZ_SRC, f));
  const proibidos = [
    /^\s*["']use client["']/m,
    /from ["']react(-dom)?["']/,
    /from ["']zustand["']/,
    /from ["']next(\/[^"']*)?["']/,
    /from ["']@supabase\//,
    /from ["']@\/lib\/supabase\//,
    /from ["']@\/lib\/data\/supabase["']/,
    /from ["']@\/lib\/store\//,
    /\b(window|localStorage|sessionStorage|document)\./,
  ];
  const visitados = new Set<string>();
  const fila = [...entradas];
  while (fila.length > 0) {
    const f = fila.pop() as string;
    if (visitados.has(f)) continue;
    visitados.add(f);
    const src = readFileSync(f, "utf8");
    for (const re of proibidos) assert.ok(!re.test(src), `${f.slice(RAIZ_SRC.length)} viola pureza: ${re}`);
    for (const spec of importsDeValor(src)) {
      const alvo = resolverImport(f, spec);
      if (alvo) fila.push(alvo);
    }
  }
  // Sanidade: a busca desceu além das entradas (lojas-ignoradas, utils/placa…)
  assert.ok(visitados.size > entradas.length);
});
