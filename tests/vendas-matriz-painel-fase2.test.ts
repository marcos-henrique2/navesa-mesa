/**
 * Painel /vendas-usados-matriz — Fase 2 (abas Vendas, Margens, Vendedores, Evolução).
 *
 * Regras centrais testadas aqui:
 * - Paridade: cada coluna das visões de Margens que existe no Excel = `result` cacheado do
 *   bloco correspondente das abas 4/5/6, centavo a centavo (mesma função, mesmas linhas).
 * - Cross-filter: o filtro que cada cartão/coluna aplica na aba Vendas devolve EXATAMENTE a
 *   quantidade do cartão/coluna.
 * - Reconciliação das 3 visões de margem.
 * - Matriz de vendedor = aba 8 quando o mês de referência é o mesmo.
 * - Séries da evolução, incluindo o corte do mês parcial (= KPI do Resumo).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { gerarVendasMatrizWorkbook } from "@/lib/export/vendas-matriz/gerar-workbook";
import type { ColetarVendasMatrizResult } from "@/lib/export/vendas-matriz/coletar-dados";
import { nomesAbas, type LinhaVendaMatriz } from "@/lib/export/vendas-matriz/tipos";
import { resumirPainelMatriz } from "@/lib/export/vendas-matriz/resumir-painel";
import { calcularMetricasBloco, type MetricasBlocoMargens } from "@/lib/export/vendas-matriz/aba-margens";
import { calcularMatrizMediaVendedor, renderAbaMediaVendedorAtual } from "@/lib/export/vendas-matriz/aba-media-vendedor";
import {
  FILTROS_VAZIOS,
  CHAVE_AUTO_AVALIAR,
  CHAVE_SEM_VENDEDOR,
  chaveVendedor,
  escreverEstadoUrl,
  filtrarVendas,
  lerEstadoUrl,
  ordenarVendas,
  totaisFiltro,
  derivadosVenda,
  type FiltrosVendas,
} from "@/lib/export/vendas-matriz/filtrar-vendas";
import { coberturaCustos, visaoPfPj, visaoRecorrente, visaoTotalOrigem, type VisaoMargens } from "@/lib/export/vendas-matriz/visoes-margens";
import { matrizDoMesSelecionado, ordenarRanking, rankingVendedores } from "@/lib/export/vendas-matriz/vendedores-painel";
import { serieDiaria, serieMensal } from "@/lib/export/vendas-matriz/evolucao";
import { linhaVendaMatriz } from "./_mocks";

const COD = 2;
const PROPRIA = "ESTOQUE AEROPORTO";

function dia(iso: string): Date {
  return new Date(`${iso}T12:00:00-03:00`);
}

const L = (over: Partial<LinhaVendaMatriz>): LinhaVendaMatriz =>
  linhaVendaMatriz({ lojaOrigemNome: PROPRIA, lojaOrigemCodEmpresa: COD, dataVenda: dia("2026-10-10"), ...over });

const OUTRA = { lojaOrigemCodEmpresa: 5, lojaOrigemNome: "LOJA 5" };
const DESCONHECIDA = { lojaOrigemCodEmpresa: null, lojaOrigemNome: "(origem desconhecida)" };

/** Mês com todas as combinações que importam: origem × lojista × cliente_tipo × consignado × Auto Avaliar, centavos e custo nulo. */
const MES: LinhaVendaMatriz[] = [
  L({ placa: "AAA0001", clienteTipo: "PF", lojista: false, valorVenda: 95000.37, nfEntrada: 80000.11, dataVenda: dia("2026-10-01") }),
  L({ placa: "AAA0002", clienteTipo: "PF", lojista: true, ...OUTRA, valorVenda: 70000.05, nfEntrada: 72000, dataVenda: dia("2026-10-02") }),
  L({ placa: "AAA0003", clienteTipo: "PF", consignado: true, valorVenda: 500000, dataVenda: dia("2026-10-02") }),
  L({ placa: "AAA0004", clienteTipo: "PJ", lojista: true, ...DESCONHECIDA, valorVenda: 50000.99, dataVenda: dia("2026-10-05") }),
  L({ placa: "AAA0005", clienteTipo: "PJ", lojista: true, ...OUTRA, valorVenda: 61000.5, comissao: 333.33, impostos: null, dataVenda: dia("2026-10-05") }),
  L({ placa: "AAA0006", clienteTipo: "PJ", lojista: false, vendedorNome: "MOZAINEL CORREA", valorVenda: 40000, adm: null, dataVenda: dia("2026-10-07") }),
  L({ placa: "AAA0007", clienteTipo: null, lojista: null, vendedorNome: "Mozainel Correa", valorVenda: 41000, dataVenda: dia("2026-10-12") }),
  L({ placa: "AAA0008", clienteTipo: null, lojista: null, valorVenda: 88000.1, adm: 120.45, vendedorNome: null, dataVenda: dia("2026-10-15") }),
  L({ placa: "AAA0009", clienteTipo: null, lojista: false, consignado: true, ...OUTRA, valorVenda: 77000, dataVenda: dia("2026-10-15") }),
  L({ placa: "AAA0010", clienteTipo: "PF", lojista: false, ...OUTRA, valorVenda: 30000, nfEntrada: 45000, dataVenda: dia("2026-10-20") }),
  L({ placa: "AAA0011", clienteTipo: "PJ", lojista: false, valorVenda: 120000, nfEntrada: null, valoriza: null, dataVenda: dia("2026-10-28") }),
  L({ placa: "AAA0012", clienteTipo: "PF", lojista: null, ...DESCONHECIDA, valorVenda: 66000, despesaGeral: null, forplan: null, dataVenda: dia("2026-10-30") }),
];

/** `result` cacheado da fórmula. O ExcelJS omite `result` quando ele é 0 (falsy) → lê como 0. */
function resultado(cell: ExcelJS.Cell): unknown {
  const v = cell.value;
  if (v && typeof v === "object" && "formula" in v) return "result" in v && v.result !== undefined ? v.result : 0;
  return v;
}

async function gerar(linhasMes: LinhaVendaMatriz[], extra: Partial<ColetarVendasMatrizResult> = {}): Promise<ExcelJS.Workbook> {
  const dados: ColetarVendasMatrizResult = {
    linhasMes,
    nomeLojaPropria: PROPRIA,
    anoAtual: 2026,
    mesAtualIndex: 10,
    vendasAnoAtual: [],
    ...extra,
  };
  const blob = await gerarVendasMatrizWorkbook(dados, { codEmpresa: COD, mes: 10, ano: 2026 });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await blob.arrayBuffer());
  return wb;
}

/** Rótulo do Excel → campo de `calcularMetricasBloco` (ordem e nomes do `renderBloco`). */
const CAMPOS: [string, keyof MetricasBlocoMargens][] = [
  ["Valor da Venda", "valorVendaTotal"],
  ["Qtde Faturados", "qtdeFaturados"],
  ["Ticket Médio", "ticketMedio"],
  ["KM Média", "kmMedia"],
  ["FIPE Total", "fipeTotal"],
  ["NF Entrada - Valoriza Total", "custoRealTotal"],
  ["Lucro Bruto", "lucroBrutoTotal"],
  ["Despesas Gerais", "despesaGeralTotal"],
  ["F Plan", "forplanTotal"],
  ["Impostos", "impostosTotal"],
  ["Comissão", "comissaoTotal"],
  ["ADM", "admTotal"],
  ["Margem Líquida", "margemLiquidaTotal"],
  ["Dias Estoque Médio", "diasEstoqueMedio"],
];

/** Lê todas as linhas de um bloco da aba (label na coluna `labelCol`, valor na seguinte). */
function lerBloco(ws: ExcelJS.Worksheet, indiceBloco: number): Record<string, unknown> {
  const labelCol = 3 + indiceBloco * 4;
  const out: Record<string, unknown> = {};
  ws.eachRow((row) => {
    const label = String(row.getCell(labelCol).value ?? "");
    if (CAMPOS.some(([l]) => l === label)) out[label] = resultado(row.getCell(labelCol + 1));
  });
  return out;
}

function assertColunaIgualBloco(ws: ExcelJS.Worksheet, indiceBloco: number, m: MetricasBlocoMargens, nome: string) {
  const bloco = lerBloco(ws, indiceBloco);
  for (const [label, campo] of CAMPOS) {
    // Igualdade estrita (mesmo float) — paridade ao centavo e além.
    assert.equal(bloco[label], m[campo], `${nome} · ${label}`);
  }
}

describe("Margens — paridade centavo a centavo com as abas 4/5/6 do Excel", () => {
  it("Total e origem = aba 4 MARGENS (3 blocos), linha por linha do DRE", async () => {
    const wb = await gerar(MES);
    const ws = wb.getWorksheet(nomesAbas(10, 2026).aba4)!;
    const v = visaoTotalOrigem(MES, COD);
    const col = (id: string) => v.colunas.find((c) => c.id === id)!;
    assertColunaIgualBloco(ws, 0, col("total").metricas, "Total");
    assertColunaIgualBloco(ws, 1, col("proprio").metricas, "Próprio");
    assertColunaIgualBloco(ws, 2, col("outras").metricas, "Outras");
    assert.equal(col("total").blocoExcel, "VENDIDO TOTAL NAVESA AEROPORTO");
  });

  it("Comprador recorrente × cliente final = abas 5 e 6, na ordem do Excel", async () => {
    const wb = await gerar(MES);
    const ws5 = wb.getWorksheet(nomesAbas(10, 2026).aba5)!;
    const ws6 = wb.getWorksheet(nomesAbas(10, 2026).aba6)!;
    const v = visaoRecorrente(MES, COD);
    assert.deepEqual(
      v.colunas.map((c) => c.id),
      ["lojistaOutras", "lojistaPropria", "clientePropria", "clienteOutras"],
    );
    assertColunaIgualBloco(ws5, 0, v.colunas[0].metricas, "Lojista outras");
    assertColunaIgualBloco(ws5, 1, v.colunas[1].metricas, "Lojista própria");
    assertColunaIgualBloco(ws6, 0, v.colunas[2].metricas, "Cliente própria");
    assertColunaIgualBloco(ws6, 1, v.colunas[3].metricas, "Cliente outras");
  });

  it("coluna Total da visão PF × PJ = VENDIDO TOTAL do Excel", async () => {
    const wb = await gerar(MES);
    const ws = wb.getWorksheet(nomesAbas(10, 2026).aba4)!;
    assertColunaIgualBloco(ws, 0, visaoPfPj(MES, COD, false).colunas[0].metricas, "PF×PJ Total");
  });

  it("a margem Total da aba Margens = KPI Margem do Resumo (mesma conta)", () => {
    const p = resumirPainelMatriz({ linhasMes: MES, linhasMesAnterior: [], codEmpresa: COD, mes: 10, ano: 2026, hoje: "2026-10-30" });
    const v = visaoTotalOrigem(MES, COD);
    assert.equal(v.colunas[0].metricas.margemLiquidaTotal, p.atual.total.margem);
    assert.equal(v.colunas[0].metricas.valorVendaTotal, p.atual.total.receita);
  });
});

const cent = (v: number): number => Math.round(v * 100);

function assertFecha(v: VisaoMargens) {
  assert.equal(v.somaColunas.qtd + v.foraDaVisao.reduce((s, p) => s + p.qtd, 0), v.totalSemConsig, `${v.chave} qtd`);
  assert.equal(
    cent(v.somaColunas.margem + v.foraDaVisao.reduce((s, p) => s + p.margem, 0)),
    cent(v.margemTotal),
    `${v.chave} margem`,
  );
}

describe("Margens — reconciliação das 3 visões", () => {
  it("Total e origem: Próprio + Outras + Não identificada = Total", () => {
    const v = visaoTotalOrigem(MES, COD);
    assert.ok(v.colunas.some((c) => c.id === "naoIdentificada"));
    assert.equal(v.foraDaVisao.length, 0);
    assertFecha(v);
    assert.equal(v.qtdConsignadas, 2);
  });

  it("coluna Não identificada some quando é 0", () => {
    const sem = MES.filter((l) => l.lojaOrigemCodEmpresa != null);
    assert.ok(!visaoTotalOrigem(sem, COD).colunas.some((c) => c.id === "naoIdentificada"));
  });

  it("PF × PJ: PF + PJ + Auto Avaliar + Não informado = Total (e aberto por origem também)", () => {
    assertFecha(visaoPfPj(MES, COD, false));
    const aberta = visaoPfPj(MES, COD, true);
    assertFecha(aberta);
    assert.ok(aberta.colunas.some((c) => c.id === "pf-naoIdentificada"));
  });

  it("Recorrente: 4 colunas + sem CPF/CNPJ + origem não identificada = Total", () => {
    const v = visaoRecorrente(MES, COD);
    assertFecha(v);
    const [semDoc, naoIdent] = v.foraDaVisao;
    // sem consignado: AAA0007, AAA0008, AAA0012 (lojista null); AAA0004 (não identificada, lojista SIM)
    assert.equal(semDoc.qtd, 3);
    assert.equal(naoIdent.qtd, 1);
  });
});

describe("Cobertura de custos", () => {
  it("conta só vendas sem consignado; completa = os 5 custos lançados; sem NF à parte", () => {
    const c = coberturaCustos(MES);
    assert.equal(c.total, 10);
    // incompletas: AAA0005 (impostos), AAA0006 (adm), AAA0012 (despesa + F Plan)
    assert.equal(c.completas, 7);
    assert.equal(c.porCusto.impostos, 9);
    assert.equal(c.porCusto.adm, 9);
    assert.equal(c.porCusto.despesaGeral, 9);
    assert.equal(c.porCusto.forplan, 9);
    assert.equal(c.porCusto.comissao, 10);
    assert.equal(c.semNfEntrada, 1);
  });

  it("custo não lançado na linha: lista os campos, conta igual ao Excel (zero)", () => {
    const l = MES.find((x) => x.placa === "AAA0012")!;
    assert.deepEqual(derivadosVenda(l).custosNaoLancados, ["despesaGeral", "forplan"]);
    // 66000 − (80000 − 1000) − 0 − 0 − 500 − 400 − 0
    assert.equal(derivadosVenda(l).margemLiquida, 66000 - 79000 - 500 - 400);
  });
});

describe("Cross-filter — a contagem filtrada bate com o número do cartão", () => {
  const p = resumirPainelMatriz({ linhasMes: MES, linhasMesAnterior: [], codEmpresa: COD, mes: 10, ano: 2026, hoje: "2026-10-30" });
  const contar = (f: Partial<FiltrosVendas>) => filtrarVendas(MES, { ...FILTROS_VAZIOS, ...f }, COD).length;

  it("Resumo › KPI Vendas (Ver todas) e origem", () => {
    assert.equal(contar({}), p.atual.total.qtd);
    assert.equal(contar({ origem: "proprio" }), p.atual.origem.proprio.qtd);
    assert.equal(contar({ origem: "outras" }), p.atual.origem.outras.qtd);
    assert.equal(contar({ origem: "naoIdentificada" }), p.atual.origem.naoIdentificada.qtd);
  });

  it("Resumo › cartões PF / PJ / Auto Avaliar / Não informado e split de origem", () => {
    assert.equal(contar({ comprador: ["pf"] }), p.atual.pf.metricas.qtd);
    assert.equal(contar({ comprador: ["pj"] }), p.atual.pj.metricas.qtd);
    assert.equal(contar({ comprador: ["autoAvaliar"] }), p.atual.autoAvaliar.qtd);
    assert.equal(contar({ comprador: ["naoInformado"] }), p.atual.naoInformado.qtd);
    for (const o of ["proprio", "outras", "naoIdentificada"] as const) {
      assert.equal(contar({ comprador: ["pf"], origem: o }), p.atual.pf.origem[o].qtd, `pf ${o}`);
      assert.equal(contar({ comprador: ["pj"], origem: o }), p.atual.pj.origem[o].qtd, `pj ${o}`);
    }
  });

  it("Resumo › N consignadas fora da margem", () => {
    assert.equal(contar({ consig: "so" }), p.atual.total.qtdConsignadas);
    assert.equal(contar({ consig: "sem" }), p.atual.total.qtdComMargem);
  });

  it("Margens › 'Ver vendas' de cada coluna das 3 visões = Qtde Faturados da coluna", () => {
    for (const v of [visaoTotalOrigem(MES, COD), visaoPfPj(MES, COD, false), visaoPfPj(MES, COD, true), visaoRecorrente(MES, COD)]) {
      for (const c of v.colunas) assert.equal(contar(c.filtro), c.metricas.qtdeFaturados, `${v.chave} · ${c.id}`);
    }
  });

  it("Vendedores › barra = vendas do vendedor; Auto Avaliar e sem vendedor por chave própria", () => {
    const r = rankingVendedores(MES, null);
    for (const v of r.vendedores) assert.equal(contar({ vendedor: v.chave }), v.metricas.qtd);
    assert.equal(contar({ vendedor: CHAVE_AUTO_AVALIAR }), r.autoAvaliar?.qtd);
    assert.equal(contar({ vendedor: CHAVE_SEM_VENDEDOR }), r.semVendedor?.qtd);
  });

  it("Evolução › dia = vendas no dia", () => {
    const s = serieDiaria({ linhasMes: MES, linhasMesAnterior: [], mes: 10, ano: 2026, corte: p.corte });
    for (const pt of s.pontos) if (pt.noDiaQtd != null) assert.equal(contar({ dia: pt.dia }), pt.noDiaQtd, `dia ${pt.dia}`);
  });
});

describe("filtrarVendas — busca, margem negativa, combinação", () => {
  const f = (over: Partial<FiltrosVendas>) => filtrarVendas(MES, { ...FILTROS_VAZIOS, ...over }, COD).map((l) => l.placa);

  it("busca ignora caixa/acento e normaliza placa", () => {
    const linhas = [L({ placa: "QGX-1A23", descricaoVeiculo: "RANGER XLS", clienteNome: "João Ação Ltda" })];
    const busca = (q: string) => filtrarVendas(linhas, { ...FILTROS_VAZIOS, q }, COD).length;
    assert.equal(busca("qgx1a"), 1);
    assert.equal(busca("QGX-1A23"), 1);
    assert.equal(busca("joao acao"), 1);
    assert.equal(busca("ranger"), 1);
    assert.equal(busca("onix"), 0);
  });

  it("só margem negativa ignora consignadas e margem desconhecida", () => {
    // AAA0003/AAA0009 (consignadas) e AAA0011 (sem NF → margem desconhecida) ficam fora; AAA0001/AAA0008 são positivas.
    assert.deepEqual(f({ neg: true }), ["AAA0002", "AAA0004", "AAA0005", "AAA0006", "AAA0007", "AAA0010", "AAA0012"]);
  });

  it("lojista (filtro oculto da visão do Excel)", () => {
    assert.deepEqual(f({ lojista: "sim" }), ["AAA0002", "AAA0004", "AAA0005"]);
  });
});

describe("ordenarVendas e totaisFiltro", () => {
  it("padrão data desc; vazios sempre no fim; não muta", () => {
    const copia = [...MES];
    const ord = ordenarVendas(MES, { chave: "data", dir: "desc" }, COD);
    assert.equal(ord[0].placa, "AAA0012");
    assert.deepEqual(MES, copia);
    const porMargem = ordenarVendas(MES, { chave: "margem", dir: "asc" }, COD);
    // consignadas e sem NF (margem null) por último
    assert.deepEqual(porMargem.slice(-3).map((l) => l.placa).sort(), ["AAA0003", "AAA0009", "AAA0011"]);
  });

  it("rodapé sem consignadas; %FIPE só onde há FIPE; Excel com consignadas no tooltip", () => {
    const t = totaisFiltro(MES);
    assert.equal(t.qtd, 12);
    assert.equal(t.qtdConsignadas, 2);
    const sem = MES.filter((l) => !l.consignado);
    const venda = sem.reduce((s, l) => s + (l.valorVenda ?? 0), 0);
    assert.equal(cent(t.venda), cent(venda));
    assert.equal(cent(t.excelComConsig.venda), cent(venda + 500000 + 77000));
    assert.equal(cent(t.margem ?? 0), cent(calcularMetricasBloco(sem).margemLiquidaTotal));
    const comFipe = [L({ valorVenda: 110, valorFipe: 100 }), L({ valorVenda: 50, valorFipe: null })];
    assert.equal(totaisFiltro(comFipe).pctFipe, 1.1);
  });
});

describe("Estado na URL", () => {
  it("ida e volta", () => {
    const e = {
      mes: "2026-10",
      aba: "vendas" as const,
      filtros: { ...FILTROS_VAZIOS, origem: "outras" as const, comprador: ["pj" as const, "autoAvaliar" as const], consig: "sem" as const, neg: true, dia: 14, q: "ranger", vendedor: "JOÃO", lojista: "sim" as const },
    };
    const url = escreverEstadoUrl(e);
    assert.deepEqual(lerEstadoUrl(new URLSearchParams(url)), e);
  });

  it("valores inválidos viram padrão (nunca quebra)", () => {
    const e = lerEstadoUrl(new URLSearchParams("?mes=2026-13&aba=xpto&origem=lua&comprador=pf,zz&consig=talvez&dia=40"));
    assert.equal(e.mes, null);
    assert.equal(e.aba, "resumo");
    assert.equal(e.filtros.origem, null);
    assert.deepEqual(e.filtros.comprador, ["pf"]);
    assert.equal(e.filtros.consig, "todas");
    assert.equal(e.filtros.dia, null);
    assert.equal(escreverEstadoUrl({ mes: null, aba: "resumo", filtros: FILTROS_VAZIOS }), "");
  });
});

describe("Vendedores — ranking do mês e matriz da aba 8", () => {
  it("Auto Avaliar e sem vendedor fora do ranking; ranking por vendas desc", () => {
    const r = rankingVendedores(MES, null);
    assert.ok(r.vendedores.every((v) => v.chave !== CHAVE_AUTO_AVALIAR && v.chave !== CHAVE_SEM_VENDEDOR));
    assert.equal(r.autoAvaliar?.qtd, 2);
    assert.equal(r.semVendedor?.qtd, 1);
    assert.equal(r.vendedores.reduce((s, v) => s + v.metricas.qtd, 0) + 2 + 1, MES.length);
    assert.equal(r.vendedores[0].mediaUltimos3, null);
  });

  it("ordenar por margem: sem margem (só consignadas) no fim", () => {
    const linhas = [
      L({ vendedorNome: "A", valorVenda: 90000 }),
      L({ vendedorNome: "B", valorVenda: 99000 }),
      L({ vendedorNome: "C", consignado: true }),
    ];
    const r = rankingVendedores(linhas, null);
    assert.deepEqual(ordenarRanking(r.vendedores, "margem").map((v) => v.nome), ["B", "A", "C"]);
    assert.deepEqual(ordenarRanking(r.vendedores, "vendas").map((v) => v.nome), ["A", "B", "C"]);
  });

  /** Vendas do ano: V1 forte no começo e fraco no fim (delta < 0), V2 só recente, AA presente. */
  function ano(): LinhaVendaMatriz[] {
    const out: LinhaVendaMatriz[] = [];
    const add = (vendedorNome: string | null, mes: number, n: number) => {
      for (let i = 0; i < n; i++) out.push(L({ vendedorNome, dataVenda: dia(`2026-${String(mes).padStart(2, "0")}-1${i % 9}`) }));
    };
    for (let m = 1; m <= 6; m++) add("V1", m, 5);
    for (let m = 7; m <= 9; m++) add("V1", m, 2);
    add("V2", 8, 3);
    add("V2", 9, 4);
    add("MOZAINEL CORREA", 3, 2);
    add(null, 4, 1);
    add("V1", 10, 7); // mês selecionado: não entra nas médias
    return out;
  }

  it("matriz com mês de referência = aba 8 do Excel célula a célula (mês corrente selecionado)", async () => {
    const linhasAno = ano();
    const vendas = linhasAno.map((l) => ({ vendedorNome: l.vendedorNome, dataVenda: l.dataVenda }));
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("MEDIA");
    renderAbaMediaVendedorAtual(ws, 2026, 10, vendas);
    const m = matrizDoMesSelecionado(linhasAno, 10);
    assert.deepEqual(m, calcularMatrizMediaVendedor(10, vendas));
    assert.equal(m.mesesBlocoB.join(), "7,8,9");
    assert.equal(m.mesesBlocoA.join(), "1,2,3,4,5,6");
    // Colunas: B=vendedor, C..H = jan..jun, I=total A, J=média A, K..M = jul..set, N=total B, O=média B, P=delta
    m.vendedores.forEach((v, i) => {
      const row = ws.getRow(3 + i);
      assert.equal(row.getCell(2).value, v.vendedor);
      assert.equal(resultado(row.getCell(9)), v.totalA);
      assert.equal(resultado(row.getCell(10)), v.mediaA);
      assert.equal(resultado(row.getCell(14)), v.totalB);
      assert.equal(resultado(row.getCell(15)), v.mediaB);
      assert.equal(resultado(row.getCell(16)), v.delta);
    });
    assert.equal(resultado(ws.getRow(3 + m.vendedores.length).getCell(16)), m.somaDeltas);
    // MOZAINEL aparece na matriz "como no Excel"
    assert.ok(m.vendedores.some((v) => v.vendedor === "MOZAINEL CORREA"));
  });

  it("ranking com médias: ÷3 mesmo com mês zerado; delta = média B − média A", () => {
    const linhasAno = ano();
    const mesOut = linhasAno.filter((l) => l.dataVenda!.getTime() >= dia("2026-10-01").getTime());
    const r = rankingVendedores(mesOut, matrizDoMesSelecionado(linhasAno, 10));
    const v1 = r.vendedores.find((v) => v.nome === "V1")!;
    assert.equal(v1.mediaUltimos3, 2);
    assert.equal(v1.mediaAnteriores, 5);
    assert.equal(v1.delta, -3);
  });

  it("tabela = união mês × aba 8: quem não vendeu no mês aparece com 0; TOTAL do Delta = Excel", () => {
    const linhasAno = ano();
    const mesOut = linhasAno.filter((l) => l.dataVenda!.getTime() >= dia("2026-10-01").getTime());
    const matriz = matrizDoMesSelecionado(linhasAno, 10);
    const r = rankingVendedores(mesOut, matriz);
    // Ranking do mês: só V1 (único humano que vendeu em outubro)
    assert.deepEqual(r.vendedores.map((v) => v.nome), ["V1"]);
    const v2 = r.tabela.find((v) => v.nome === "V2")!;
    assert.equal(v2.metricas.qtd, 0);
    assert.equal(v2.metricas.margem, null);
    assert.equal(v2.metricas.ticket, null);
    assert.equal(v2.mediaUltimos3, 7 / 3);
    const aa = r.tabela.find((v) => v.leilao)!;
    assert.equal(aa.chave, CHAVE_AUTO_AVALIAR);
    assert.equal(aa.delta, (0 - 2 / 6));
    assert.ok(!r.vendedores.some((v) => v.leilao));
    assert.equal(r.somaDeltas, matriz.somaDeltas);
    assert.equal(cent(r.tabela.reduce((s, v) => s + (v.delta ?? 0), 0)), cent(matriz.somaDeltas ?? 0));
    // Excel: célula TOTAL do DELTA da aba 8
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("MEDIA");
    renderAbaMediaVendedorAtual(ws, 2026, 10, linhasAno.map((l) => ({ vendedorNome: l.vendedorNome, dataVenda: l.dataVenda })));
    assert.equal(resultado(ws.getRow(3 + matriz.vendedores.length).getCell(16)), r.somaDeltas);
  });

  it("mês passado selecionado: médias param no mês anterior a ele (diverge da aba 8 de propósito)", () => {
    const m = matrizDoMesSelecionado(ano(), 5);
    assert.equal(m.nFechados, 4);
    assert.equal(m.mesesBlocoB.join(), "2,3,4");
    assert.equal(m.mesesBlocoA.join(), "1");
    assert.equal(matrizDoMesSelecionado(ano(), 3).temBlocoA, false);
    assert.equal(matrizDoMesSelecionado(ano(), 1).nFechados, 0);
  });

  it("vendedor sem venda nos meses fechados: médias 0 (não null) quando há meses fechados", () => {
    const linhasAno = [...ano(), L({ vendedorNome: "NOVO", dataVenda: dia("2026-10-03") })];
    const mesOut = linhasAno.filter((l) => l.dataVenda!.getTime() >= dia("2026-10-01").getTime());
    const novo = rankingVendedores(mesOut, matrizDoMesSelecionado(linhasAno, 10)).vendedores.find((v) => v.nome === "NOVO")!;
    assert.equal(novo.mediaUltimos3, 0);
    assert.equal(novo.delta, 0);
    assert.equal(chaveVendedor(L({ vendedorNome: "  " })), CHAVE_SEM_VENDEDOR);
  });
});

describe("Evolução — dia a dia com corte do mês parcial", () => {
  const anterior = [
    L({ dataVenda: dia("2026-09-01") }),
    L({ dataVenda: dia("2026-09-15") }),
    L({ dataVenda: new Date("2026-09-15T23:30:00-03:00") }), // ainda dia 15 em Brasília
    L({ dataVenda: dia("2026-09-16") }),
    L({ dataVenda: dia("2026-09-30"), consignado: true }),
  ];
  const atual = [
    L({ dataVenda: dia("2026-10-01") }),
    L({ dataVenda: dia("2026-10-14") }),
    L({ dataVenda: dia("2026-10-14"), consignado: true }),
    L({ dataVenda: dia("2026-10-15") }),
  ];

  it("parcial (hoje 15/10): acumulado no corte = KPI; anterior dividido no dia 15", () => {
    const p = resumirPainelMatriz({ linhasMes: atual, linhasMesAnterior: anterior, codEmpresa: COD, mes: 10, ano: 2026, hoje: "2026-10-15" });
    const s = serieDiaria({ linhasMes: atual, linhasMesAnterior: anterior, mes: 10, ano: 2026, corte: p.corte });
    assert.equal(s.pontos.length, 31);
    assert.equal(s.diaCorte, 15);
    assert.equal(s.qtdAtual, p.atual.total.qtd);
    assert.equal(s.qtdAnterior, p.anterior.total.qtd);
    assert.equal(s.qtdAnterior, 3);
    assert.equal(cent(s.margemAtual), cent(p.atual.total.margem ?? 0));
    assert.equal(cent(s.margemAnterior), cent(p.anterior.total.margem ?? 0));
    assert.equal(s.pontos[15].acumQtd, null); // dia 16: depois de hoje
    assert.equal(s.pontos[14].antAteCorteQtd, 3);
    assert.equal(s.pontos[14].antDepoisQtd, 3); // junção dos dois trechos
    assert.equal(s.pontos[15].antAteCorteQtd, null);
    assert.equal(s.pontos[29].antDepoisQtd, 5);
    assert.equal(s.pontos[30].antQtd, null); // setembro não tem dia 31
    assert.equal(s.pontos[13].noDiaQtd, 2);
    // consignada conta em vendas mas não na margem do dia
    const margemDia14 = s.pontos[13].noDiaMargem;
    assert.equal(margemDia14, 95000 - 79000 - 3900);
  });

  it("mês fechado: as duas linhas vão até o fim, sem trecho 'depois'", () => {
    const p = resumirPainelMatriz({ linhasMes: atual, linhasMesAnterior: anterior, codEmpresa: COD, mes: 10, ano: 2026, hoje: "2026-11-02" });
    const s = serieDiaria({ linhasMes: atual, linhasMesAnterior: anterior, mes: 10, ano: 2026, corte: p.corte });
    assert.equal(s.parcial, false);
    assert.equal(s.pontos[30].acumQtd, 4);
    assert.ok(s.pontos.every((pt) => pt.antDepoisQtd == null));
    assert.equal(s.qtdAnterior, 5);
    assert.equal(s.qtdAnterior, p.anterior.total.qtd);
  });
});

describe("Evolução — mês a mês no ano", () => {
  const linhasAno = [
    L({ dataVenda: dia("2026-01-10") }),
    L({ dataVenda: dia("2026-01-11"), ...OUTRA, clienteTipo: "PJ" }),
    L({ dataVenda: dia("2026-02-10"), consignado: true }),
    L({ dataVenda: dia("2026-03-31") }),
    L({ dataVenda: new Date("2026-03-31T23:30:00-03:00") }), // 01/04 UTC, ainda março em Brasília
    L({ dataVenda: dia("2026-04-05"), vendedorNome: "MOZAINEL CORREA" }),
  ];

  it("jan até o mês selecionado; mês do fuso de Brasília; parcial marcado; média só de meses fechados anteriores", () => {
    const s = serieMensal({ linhasAno, codEmpresa: COD, ano: 2026, ateMes: 4, hoje: "2026-04-20" });
    assert.deepEqual(s.meses.map((m) => m.total.qtd), [2, 1, 2, 1]);
    assert.equal(s.meses[3].parcial, true);
    assert.equal(s.meses[3].selecionado, true);
    assert.deepEqual(s.media?.meses, [1, 2, 3]);
    assert.equal(s.media?.qtd, 5 / 3);
    // fevereiro só consignado: margem null, conta 0 na média
    assert.equal(s.meses[1].total.margem, null);
    assert.equal(s.meses[0].origem.outras.qtd, 1);
    assert.equal(s.meses[0].comprador.pj.qtd, 1);
    assert.equal(s.meses[3].comprador.autoAvaliar.qtd, 1);
  });

  it("mês do ano = mesmos números do Resumo daquele mês", () => {
    const s = serieMensal({ linhasAno, codEmpresa: COD, ano: 2026, ateMes: 3, hoje: "2026-10-30" });
    const marco = linhasAno.filter((l) => l.dataVenda!.getTime() >= dia("2026-03-01").getTime() && l.dataVenda!.getTime() < dia("2026-04-02").getTime() && l.vendedorNome !== "MOZAINEL CORREA");
    const p = resumirPainelMatriz({ linhasMes: marco, linhasMesAnterior: [], codEmpresa: COD, mes: 3, ano: 2026, hoje: "2026-10-30" });
    assert.deepEqual(s.meses[2].total, p.atual.total);
    assert.equal(s.meses[2].parcial, false);
    assert.deepEqual(s.media?.meses, [1, 2]);
  });

  it("janeiro: sem meses fechados pra comparar", () => {
    assert.equal(serieMensal({ linhasAno, codEmpresa: COD, ano: 2026, ateMes: 1, hoje: "2026-01-20" }).media, null);
  });
});
