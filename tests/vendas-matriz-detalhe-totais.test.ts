/**
 * Testes das abas 1/2 ("VENDAS USADOS {MÊS} MATRIZ" / "VENDAS {MÊS} SÓ ESTOQUE") —
 * item 3 da pendência "Vendas Usados Matriz": bloco de totais/médias no rodapé, e
 * coluna de apoio AH (CONSIGNADO) usada pelos SUMIFS/COUNTIFS dos blocos de MARGEM
 * (ver tests/vendas-matriz-margens-consignado.test.ts).
 *
 * Todo valor do bloco de totais é fórmula Excel de verdade (SUM/AVERAGE) com `result`
 * cacheado — os testes conferem o `result` cacheado, que precisa bater com a conta feita
 * em JS a partir das mesmas linhas.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { renderAbaDetalhe } from "@/lib/export/vendas-matriz/aba-detalhe";
import { COL, DATA_START_ROW } from "@/lib/export/vendas-matriz/colunas";
import type { LinhaVendaMatriz } from "@/lib/export/vendas-matriz/tipos";
import { linhaVendaMatriz } from "./_mocks";

function renderizar(linhas: LinhaVendaMatriz[]): ExcelJS.Worksheet {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("DETALHE");
  renderAbaDetalhe(ws, "titulo", linhas);
  return ws;
}

function resultado(ws: ExcelJS.Worksheet, row: number, col: number): unknown {
  const v = ws.getCell(row, col).value;
  if (v && typeof v === "object" && "result" in v) return (v as { result: unknown }).result;
  // exceljs tem uma peculiaridade: ao ler de volta um valor de fórmula cujo `result`
  // escrito era falsy (""/0), a chave `result` some do objeto (fica só `{formula}`) —
  // nesse caso o resultado cacheado era "" (branco) ou 0, não um valor ausente de verdade.
  if (v && typeof v === "object" && "formula" in v) return "";
  return v;
}

/** Acha a linha do header "TOTAIS / MÉDIAS DO PERÍODO" (mergeada em B..H). */
function linhaHeaderTotais(ws: ExcelJS.Worksheet): number {
  let linha = -1;
  ws.eachRow((row, n) => {
    if (String(row.getCell(COL.B_SEQ).value ?? "") === "TOTAIS / MÉDIAS DO PERÍODO") linha = n;
  });
  if (linha === -1) throw new Error('Header "TOTAIS / MÉDIAS DO PERÍODO" não encontrado');
  return linha;
}

describe("aba-detalhe — coluna AH (CONSIGNADO)", () => {
  it("escreve SIM/NÃO conforme l.consignado", () => {
    const linhas = [linhaVendaMatriz({ consignado: false }), linhaVendaMatriz({ consignado: true })];
    const ws = renderizar(linhas);
    assert.equal(ws.getCell(DATA_START_ROW, COL.AH_CONSIGNADO).value, "NÃO");
    assert.equal(ws.getCell(DATA_START_ROW + 1, COL.AH_CONSIGNADO).value, "SIM");
  });

  it("header da coluna AH é CONSIGNADO", () => {
    const ws = renderizar([linhaVendaMatriz()]);
    assert.equal(ws.getCell(2, COL.AH_CONSIGNADO).value, "CONSIGNADO");
  });
});

describe("aba-detalhe — fórmulas das colunas calculadas SEMPRE presentes (linha individual)", () => {
  function formula(ws: ExcelJS.Worksheet, row: number, col: number): string {
    const v = ws.getCell(row, col).value;
    if (!v || typeof v !== "object" || !("formula" in v)) {
      throw new Error(`Célula (${row},${col}) não tem fórmula — valor: ${JSON.stringify(v)}`);
    }
    return (v as { formula: string }).formula;
  }

  it("valorFipe null (caso real: FIPE não vem automática pra quase nenhum carro) -> coluna P ainda recebe fórmula, com result \"\"", () => {
    const ws = renderizar([linhaVendaMatriz({ valorFipe: null })]);
    const r = DATA_START_ROW;
    assert.equal(formula(ws, r, COL.P_PCT_FIPE), `IFERROR(O${r}/N${r},"")`);
    assert.equal(resultado(ws, r, COL.P_PCT_FIPE), "");
  });

  it("nfEntrada null (sem NF de entrada ainda) -> M, Q, R, AA, AB todas recebem fórmula, com result \"\"", () => {
    const ws = renderizar([linhaVendaMatriz({ nfEntrada: null })]);
    const r = DATA_START_ROW;
    assert.equal(formula(ws, r, COL.M_CUSTO_REAL), `IF(K${r}="","",K${r}-L${r})`);
    assert.equal(resultado(ws, r, COL.M_CUSTO_REAL), "");
    assert.equal(formula(ws, r, COL.Q_LUCRO_BRUTO), `IF(OR(M${r}="",O${r}=""),"",O${r}-M${r})`);
    assert.equal(resultado(ws, r, COL.Q_LUCRO_BRUTO), "");
    assert.equal(formula(ws, r, COL.R_PCT_LUCRO_BRUTO), `IFERROR(Q${r}/O${r},"")`);
    assert.equal(resultado(ws, r, COL.R_PCT_LUCRO_BRUTO), "");
    assert.equal(formula(ws, r, COL.AA_MARGEM_LIQUIDA), `IF(Q${r}="","",Q${r}-S${r}-U${r}-W${r}-Y${r}-AI${r})`);
    assert.equal(resultado(ws, r, COL.AA_MARGEM_LIQUIDA), "");
    assert.equal(formula(ws, r, COL.AB_PCT_MARGEM), `IFERROR(AA${r}/O${r},"")`);
    assert.equal(resultado(ws, r, COL.AB_PCT_MARGEM), "");
  });

  it("despesaGeral/forplan/impostos/comissao/adm null (custo não apurado) -> T/V/X/Z/AJ recebem fórmula com guard de célula vazia, result \"\"", () => {
    const ws = renderizar([
      linhaVendaMatriz({ despesaGeral: null, forplan: null, impostos: null, comissao: null, adm: null }),
    ]);
    const r = DATA_START_ROW;
    assert.equal(formula(ws, r, COL.T_PCT_DESPESA_GERAL), `IF(S${r}="","",IFERROR(S${r}/O${r},""))`);
    assert.equal(resultado(ws, r, COL.T_PCT_DESPESA_GERAL), "");
    assert.equal(formula(ws, r, COL.V_PCT_FPLAN), `IF(U${r}="","",IFERROR(U${r}/O${r},""))`);
    assert.equal(resultado(ws, r, COL.V_PCT_FPLAN), "");
    assert.equal(formula(ws, r, COL.X_PCT_IMPOSTOS), `IF(W${r}="","",IFERROR(W${r}/O${r},""))`);
    assert.equal(resultado(ws, r, COL.X_PCT_IMPOSTOS), "");
    assert.equal(formula(ws, r, COL.Z_PCT_COMISSAO), `IF(Y${r}="","",IFERROR(Y${r}/O${r},""))`);
    assert.equal(resultado(ws, r, COL.Z_PCT_COMISSAO), "");
    assert.equal(formula(ws, r, COL.AJ_PCT_ADM), `IF(AI${r}="","",IFERROR(AI${r}/O${r},""))`);
    assert.equal(resultado(ws, r, COL.AJ_PCT_ADM), "");
  });

  it("valorVenda null (venda sem valor informado ainda, com custoReal presente) -> Q e AA recebem fórmula, com result \"\" (NUNCA um número negativo tratando a venda vazia como zero — regressão achada em review, 13/10/2026)", () => {
    const ws = renderizar([
      linhaVendaMatriz({ nfEntrada: 80000, valoriza: 1000, valorVenda: null }),
    ]);
    const r = DATA_START_ROW;
    assert.equal(formula(ws, r, COL.Q_LUCRO_BRUTO), `IF(OR(M${r}="",O${r}=""),"",O${r}-M${r})`);
    assert.equal(resultado(ws, r, COL.Q_LUCRO_BRUTO), "");
    assert.equal(formula(ws, r, COL.AA_MARGEM_LIQUIDA), `IF(Q${r}="","",Q${r}-S${r}-U${r}-W${r}-Y${r}-AI${r})`);
    assert.equal(resultado(ws, r, COL.AA_MARGEM_LIQUIDA), "");
  });

  it("linha totalmente preenchida -> fórmulas calculam o result esperado (sanity check de que o guard não quebra o caminho feliz)", () => {
    const ws = renderizar([
      linhaVendaMatriz({
        nfEntrada: 80000, valoriza: 1000, valorFipe: 100000, valorVenda: 95000,
        despesaGeral: 1000, forplan: 2000, impostos: 500, comissao: 400, adm: 0,
      }),
    ]);
    const r = DATA_START_ROW;
    assert.equal(resultado(ws, r, COL.M_CUSTO_REAL), 79000); // 80000-1000
    assert.equal(resultado(ws, r, COL.Q_LUCRO_BRUTO), 16000); // 95000-79000
    assert.equal(resultado(ws, r, COL.AA_MARGEM_LIQUIDA), 12100); // 16000-1000-2000-500-400-0
  });
});

describe("aba-detalhe — item 3: bloco de totais/médias do rodapé", () => {
  const linhas = [
    linhaVendaMatriz({ km: 10000, diasEstoque: 10, nfEntrada: 80000, valoriza: 0, valorFipe: 100000, valorVenda: 90000, despesaGeral: 1000, forplan: 2000, impostos: 500, comissao: 400 }),
    linhaVendaMatriz({ km: 20000, diasEstoque: 30, nfEntrada: 70000, valoriza: 5000, valorFipe: 90000, valorVenda: 85000, despesaGeral: 800, forplan: 1500, impostos: 300, comissao: 350 }),
  ];

  it("KM = MÉDIA (não soma)", () => {
    const ws = renderizar(linhas);
    const rValores = linhaHeaderTotais(ws) + 1;
    assert.equal(resultado(ws, rValores, COL.I_KM), 15000); // (10000+20000)/2
  });

  it("DIAS PÁTIO = MÉDIA (não soma)", () => {
    const ws = renderizar(linhas);
    const rValores = linhaHeaderTotais(ws) + 1;
    assert.equal(resultado(ws, rValores, COL.J_DIAS), 20); // (10+30)/2
  });

  it("VALOR ENTRADA / VALORIZA / FIPE / VALOR VENDA = SOMA", () => {
    const ws = renderizar(linhas);
    const rValores = linhaHeaderTotais(ws) + 1;
    assert.equal(resultado(ws, rValores, COL.K_NF_ENTRADA), 150000);
    assert.equal(resultado(ws, rValores, COL.L_VALORIZA), 5000);
    assert.equal(resultado(ws, rValores, COL.N_VALOR_FIPE), 190000);
    assert.equal(resultado(ws, rValores, COL.O_VALOR_VENDA), 175000);
  });

  it("CUSTO REAL = SOMA de (NF Entrada - Valoriza) por linha", () => {
    const ws = renderizar(linhas);
    const rValores = linhaHeaderTotais(ws) + 1;
    // linha1: 80000-0=80000; linha2: 70000-5000=65000; soma=145000
    assert.equal(resultado(ws, rValores, COL.M_CUSTO_REAL), 145000);
  });

  it("LUCRO BRUTO = SOMA de (Venda - Custo Real) por linha, com % = somaLucro/somaVenda", () => {
    const ws = renderizar(linhas);
    const rValores = linhaHeaderTotais(ws) + 1;
    // linha1: 90000-80000=10000; linha2: 85000-65000=20000; soma=30000
    assert.equal(resultado(ws, rValores, COL.Q_LUCRO_BRUTO), 30000);
    const pct = resultado(ws, rValores, COL.R_PCT_LUCRO_BRUTO) as number;
    assert.ok(Math.abs(pct - 30000 / 175000) < 1e-9);
  });

  it("DESPESA/F PLAN/IMPOSTOS/COMISSÃO = SOMA, cada um com % sobre a soma de Valor Venda", () => {
    const ws = renderizar(linhas);
    const rValores = linhaHeaderTotais(ws) + 1;
    assert.equal(resultado(ws, rValores, COL.S_DESPESA_GERAL), 1800);
    assert.equal(resultado(ws, rValores, COL.U_FPLAN), 3500);
    assert.equal(resultado(ws, rValores, COL.W_IMPOSTOS), 800);
    assert.equal(resultado(ws, rValores, COL.Y_COMISSAO), 750);
    const pctDespesa = resultado(ws, rValores, COL.T_PCT_DESPESA_GERAL) as number;
    assert.ok(Math.abs(pctDespesa - 1800 / 175000) < 1e-9);
  });

  it("MARGEM LÍQUIDA = SOMA de (Lucro Bruto - despesas - fplan - impostos - comissão) por linha", () => {
    const ws = renderizar(linhas);
    const rValores = linhaHeaderTotais(ws) + 1;
    // linha1: 10000-1000-2000-500-400=6100; linha2: 20000-800-1500-300-350=17050; soma=23150
    assert.equal(resultado(ws, rValores, COL.AA_MARGEM_LIQUIDA), 23150);
  });

  it("%FIPE X VENDA = SUM(venda)/SUM(fipe) (razão das somas, não média das razões)", () => {
    const ws = renderizar(linhas);
    const rValores = linhaHeaderTotais(ws) + 1;
    const pct = resultado(ws, rValores, COL.P_PCT_FIPE) as number;
    assert.ok(Math.abs(pct - 175000 / 190000) < 1e-9);
  });

  it("todo valor numérico é fórmula Excel de verdade (SUM/AVERAGE), não valor hardcoded", () => {
    const ws = renderizar(linhas);
    const rValores = linhaHeaderTotais(ws) + 1;
    const cellKm = ws.getCell(rValores, COL.I_KM).value;
    assert.equal(typeof cellKm, "object");
    assert.ok(String((cellKm as { formula: string }).formula).includes("AVERAGE"));
    const cellVenda = ws.getCell(rValores, COL.O_VALOR_VENDA).value;
    assert.ok(String((cellVenda as { formula: string }).formula).startsWith("SUM("));
  });

  it("venda CONSIGNADA entra normalmente na soma de VALOR VENDA e LUCRO BRUTO (diferente das abas de margem, que excluem)", () => {
    const linhasComConsignado = [
      ...linhas,
      linhaVendaMatriz({ consignado: true, nfEntrada: 50000, valoriza: 0, valorFipe: 60000, valorVenda: 55000, despesaGeral: 0, forplan: 0, impostos: 0, comissao: 0 }),
    ];
    const ws = renderizar(linhasComConsignado);
    const rValores = linhaHeaderTotais(ws) + 1;
    // VALOR VENDA: 90000+85000+55000
    assert.equal(resultado(ws, rValores, COL.O_VALOR_VENDA), 230000);
    // LUCRO BRUTO: linha1=10000; linha2=20000; linha consignada=55000-(50000-0)=5000; soma=35000
    assert.equal(resultado(ws, rValores, COL.Q_LUCRO_BRUTO), 35000);
  });

  it("linha com valorVenda null (custoReal presente) não entra na soma de LUCRO BRUTO nem MARGEM LÍQUIDA do rodapé (mesmo comportamento de antes da regressão)", () => {
    const linhasComVendaNula = [
      ...linhas,
      linhaVendaMatriz({ nfEntrada: 60000, valoriza: 0, valorVenda: null, despesaGeral: 0, forplan: 0, impostos: 0, comissao: 0 }),
    ];
    const ws = renderizar(linhasComVendaNula);
    const rValores = linhaHeaderTotais(ws) + 1;
    // Igual ao teste "LUCRO BRUTO = SOMA..." acima: linha1=10000; linha2=20000; soma=30000
    // — a linha nova (valorVenda null) NÃO entra, pois calcularDerivadosLinha().lucroBruto
    // é null pra ela.
    assert.equal(resultado(ws, rValores, COL.Q_LUCRO_BRUTO), 30000);
    assert.equal(resultado(ws, rValores, COL.AA_MARGEM_LIQUIDA), 23150);
  });

  it("sem linhas de dados -> não quebra, bloco de totais não é renderizado", () => {
    const ws = renderizar([]);
    let achouHeader = false;
    ws.eachRow((row) => {
      if (String(row.getCell(COL.B_SEQ).value ?? "") === "TOTAIS / MÉDIAS DO PERÍODO") achouHeader = true;
    });
    assert.equal(achouHeader, false);
  });
});
