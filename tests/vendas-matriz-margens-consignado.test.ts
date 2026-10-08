/**
 * Testes de integração (via `gerarVendasMatrizWorkbook`, sem Supabase/Oracle — recebe
 * `ColetarVendasMatrizResult` já pronto) da RESSALVA do item 0 da pendência "Vendas
 * Usados Matriz": @aria-architect aprovou expandir o sync de vendas pra incluir
 * consignados (NOVO_USADO IN ('U','C')), mas com a ressalva de que custo_total_final/
 * margem_pct do Oracle não representam lucro de estoque de verdade pra consignado (a
 * revenda nunca foi dona do carro) — por isso os blocos de MARGEM (abas 4/5/6)
 * continuam excluindo consignado=true, enquanto os blocos de CONTAGEM (aba 1/3)
 * continuam incluindo normalmente.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { gerarVendasMatrizWorkbook } from "@/lib/export/vendas-matriz/gerar-workbook";
import { nomesAbas } from "@/lib/export/vendas-matriz/tipos";
import type { ColetarVendasMatrizResult } from "@/lib/export/vendas-matriz/coletar-dados";
import type { ColetarVendasMatrizInput } from "@/lib/export/vendas-matriz/tipos";
import { linhaVendaMatriz } from "./_mocks";

const INPUT: ColetarVendasMatrizInput = { codEmpresa: 2, mes: 10, ano: 2026 };
const NOMES = nomesAbas(INPUT.mes, INPUT.ano);

function resultado(cell: ExcelJS.Cell): unknown {
  const v = cell.value;
  if (v && typeof v === "object" && "result" in v) return (v as { result: unknown }).result;
  return v;
}

/**
 * Acha a PRIMEIRA linha com este rótulo (coluna C) — aba MARGENS repete "Valor da
 * Venda"/"Qtde Faturados" em 3 blocos lado a lado (TOTAL/SOMENTE ESTOQUE/OUTRAS LOJAS);
 * a 1ª ocorrência é sempre o bloco "VENDIDO TOTAL NAVESA AEROPORTO".
 */
function acharLinhaPorLabel(ws: ExcelJS.Worksheet, label: string): ExcelJS.Row {
  let encontrada: ExcelJS.Row | undefined;
  ws.eachRow((row) => {
    if (encontrada) return;
    if (String(row.getCell(3).value ?? "") === label) encontrada = row; // LABEL_COL = C (aba-margens.ts)
  });
  if (!encontrada) throw new Error(`Linha "${label}" não encontrada`);
  return encontrada;
}

async function gerarWorkbook(linhasMes: ColetarVendasMatrizResult["linhasMes"]): Promise<ExcelJS.Workbook> {
  const dados: ColetarVendasMatrizResult = {
    linhasMes,
    nomeLojaPropria: "ESTOQUE AEROPORTO",
    anoAtual: 2026,
    mesAtualIndex: 10,
    vendasAnoAtual: [],
  };
  const blob = await gerarVendasMatrizWorkbook(dados, INPUT);
  const buf = await blob.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
}

describe("gerar-workbook — ressalva de margem: consignado excluído dos blocos de MARGEM", () => {
  const linhasMes = [
    linhaVendaMatriz({ lojaOrigemNome: "ESTOQUE AEROPORTO", lojaOrigemCodEmpresa: 2, valorVenda: 100000, consignado: false }),
    linhaVendaMatriz({ lojaOrigemNome: "ESTOQUE AEROPORTO", lojaOrigemCodEmpresa: 2, valorVenda: 200000, consignado: false }),
    // consignado: Oracle manda margem/custo que NÃO representam lucro de estoque de
    // verdade — não pode entrar na soma de "Valor da Venda" nem "Qtde Faturados" da aba
    // MARGENS, mesmo valendo R$ 500.000 (se entrasse, distorceria a margem agregada).
    linhaVendaMatriz({ lojaOrigemNome: "ESTOQUE AEROPORTO", lojaOrigemCodEmpresa: 2, valorVenda: 500000, consignado: true }),
  ];

  it("aba MARGENS (bloco VENDIDO TOTAL) exclui a venda consignada da soma de Valor da Venda", async () => {
    const wb = await gerarWorkbook(linhasMes);
    const ws4 = wb.getWorksheet(NOMES.aba4)!;
    const row = acharLinhaPorLabel(ws4, "Valor da Venda");
    assert.equal(resultado(row.getCell(4)), 300000); // 100000+200000, SEM os 500000 consignados
  });

  it("aba MARGENS (bloco VENDIDO TOTAL) exclui a venda consignada da Qtde Faturados", async () => {
    const wb = await gerarWorkbook(linhasMes);
    const ws4 = wb.getWorksheet(NOMES.aba4)!;
    const row = acharLinhaPorLabel(ws4, "Qtde Faturados");
    assert.equal(resultado(row.getCell(4)), 2); // 3 vendas no total, 1 é consignada
  });

  it("aba 1 (detalhe) continua incluindo a venda consignada normalmente (item 0: contagem inclui)", async () => {
    const wb = await gerarWorkbook(linhasMes);
    const ws1 = wb.getWorksheet(NOMES.aba1)!;
    // Linhas de dado = DATA_START_ROW(4)..4+linhasMes.length-1 (6); a linha 7+ já é o bloco
    // de totais/médias do item 3 (header mergeado B..H, que também "pinta" a coluna G por
    // causa do merge — por isso o range é fechado, não um truthy-check solto em G).
    let linhasComPlaca = 0;
    for (let n = 4; n <= 6; n++) {
      if (ws1.getCell(n, 7).value) linhasComPlaca++; // G_PLACA
    }
    assert.equal(linhasComPlaca, 3); // as 3 vendas, incl. a consignada
  });

  it("aba RESUMO (TOTAL CARROS FATURADOS, bloco pátio) continua contando a venda consignada", async () => {
    const wb = await gerarWorkbook(linhasMes);
    const ws3 = wb.getWorksheet(NOMES.aba3)!;
    let totalRow: ExcelJS.Row | undefined;
    ws3.eachRow((row) => {
      if (String(row.getCell(3).value ?? "") === "TOTAL") totalRow = totalRow ?? row; // 1ª ocorrência = bloco pátio
    });
    assert.equal(resultado(totalRow!.getCell(4)), 3);
  });

  it("coluna AH (CONSIGNADO) da aba 1 reflete corretamente SIM/NÃO pra cada linha", async () => {
    const wb = await gerarWorkbook(linhasMes);
    const ws1 = wb.getWorksheet(NOMES.aba1)!;
    assert.equal(ws1.getCell(4, 34).value, "NÃO");
    assert.equal(ws1.getCell(5, 34).value, "NÃO");
    assert.equal(ws1.getCell(6, 34).value, "SIM");
  });
});

describe("gerar-workbook — sem consignados: abas de margem e contagem batem", () => {
  it("nenhuma venda consignada -> MARGENS e RESUMO contam o mesmo total", async () => {
    const linhasMes = [
      linhaVendaMatriz({ lojaOrigemNome: "ESTOQUE AEROPORTO", lojaOrigemCodEmpresa: 2, valorVenda: 100000, consignado: false }),
      linhaVendaMatriz({ lojaOrigemNome: "ESTOQUE AEROPORTO", lojaOrigemCodEmpresa: 2, valorVenda: 200000, consignado: false }),
    ];
    const wb = await gerarWorkbook(linhasMes);
    const ws4 = wb.getWorksheet(NOMES.aba4)!;
    const row = acharLinhaPorLabel(ws4, "Qtde Faturados");
    assert.equal(resultado(row.getCell(4)), 2);
  });
});

describe("margens horizontais — referências independentes por bloco", () => {
  it("ticket e percentuais usam a venda do próprio bloco nas três abas", async () => {
    const wb = await gerarWorkbook([
      linhaVendaMatriz({ valorVenda: 100000, lojista: false }),
      linhaVendaMatriz({ valorVenda: 200000, lojista: true }),
      linhaVendaMatriz({ valorVenda: 300000, lojista: true, lojaOrigemNome: "OUTRA LOJA", lojaOrigemCodEmpresa: 3 }),
      linhaVendaMatriz({ valorVenda: 400000, lojista: false, lojaOrigemNome: "OUTRA LOJA", lojaOrigemCodEmpresa: 3 }),
    ]);
    assert.equal(wb.worksheets.length, 9);
    const casos: Array<[string, string, string, number, number]> = [
      [NOMES.aba4, "D", "E", 1000000, 4],
      [NOMES.aba4, "H", "I", 300000, 2],
      [NOMES.aba4, "L", "M", 700000, 2],
      [NOMES.aba5, "D", "E", 300000, 1],
      [NOMES.aba5, "H", "I", 200000, 1],
      [NOMES.aba6, "D", "E", 100000, 1],
      [NOMES.aba6, "H", "I", 400000, 1],
    ];
    for (const [nome, valor, percentual, venda, quantidade] of casos) {
      const ws = wb.getWorksheet(nome)!;
      assert.equal(resultado(ws.getCell(`${valor}3`)), venda);
      assert.equal(resultado(ws.getCell(`${valor}4`)), quantidade);
      assert.equal(ws.getCell(`${valor}5`).formula, `IFERROR(${valor}3/${valor}4,0)`);
      assert.equal(resultado(ws.getCell(`${valor}5`)), quantidade ? venda / quantidade : 0);
      assert.equal(ws.getCell(`${percentual}15`).formula, `IFERROR(${valor}15/$${valor}$3,"")`);
      const margem = Number(resultado(ws.getCell(`${valor}15`)));
      assert.equal(resultado(ws.getCell(`${percentual}15`)), venda ? margem / venda : "");
      assert.equal(ws.getCell(`${valor}19`).value, null);
    }
  });
});
