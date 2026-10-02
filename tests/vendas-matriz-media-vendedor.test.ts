/**
 * Testes da aba 8 ("MEDIA {ano}") — item 4 da pendência "Vendas Usados Matriz".
 *
 * Regra (confirmada com o Marcos, ver aba-media-vendedor.ts): só meses FECHADOS entram
 * nesta aba — o mês corrente (em andamento) fica de fora inteiramente. Os meses
 * fechados são agrupados em Bloco A (todos exceto os últimos 3) + Bloco B (últimos 3
 * fechados), com coluna DELTA = média(Bloco B) - média(Bloco A) por vendedor.
 * Recalcula sozinho a partir de `mesAtualIndex` — nunca hardcode qual mês é "o
 * último 3".
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { renderAbaMediaVendedorAtual, type VendaParaMediaVendedor } from "@/lib/export/vendas-matriz/aba-media-vendedor";

function venda(vendedorNome: string, ano: number, mes1a12: number, dia = 15): VendaParaMediaVendedor {
  return { vendedorNome, dataVenda: new Date(Date.UTC(ano, mes1a12 - 1, dia, 12)) };
}

function renderizar(ano: number, mesAtualIndex: number, vendas: VendaParaMediaVendedor[]): ExcelJS.Worksheet {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("MEDIA");
  renderAbaMediaVendedorAtual(ws, ano, mesAtualIndex, vendas);
  return ws;
}

function resultado(cell: ExcelJS.Cell): unknown {
  const v = cell.value;
  if (v && typeof v === "object" && "result" in v) return (v as { result: unknown }).result;
  return v;
}

/** Última coluna com valor no header (linha 2) — é sempre a coluna DELTA quando existe, senão MÉDIA do bloco B. */
function ultimaColunaHeader(ws: ExcelJS.Worksheet): number {
  let ultima = 0;
  ws.getRow(2).eachCell({ includeEmpty: false }, (_cell, col) => {
    ultima = Math.max(ultima, col);
  });
  return ultima;
}

function acharLinhaVendedor(ws: ExcelJS.Worksheet, nome: string): ExcelJS.Row {
  let encontrada: ExcelJS.Row | undefined;
  ws.eachRow((row) => {
    if (row.getCell(2).value === nome) encontrada = row;
  });
  if (!encontrada) throw new Error(`Vendedor "${nome}" não encontrado`);
  return encontrada;
}

describe("aba-media-vendedor — mês corrente nunca aparece", () => {
  it("venda no mês corrente (mesAtualIndex) é ignorada, só meses fechados contam", () => {
    const vendas = [venda("V1", 2026, 8), venda("V1", 2026, 9)]; // mesAtualIndex=9 -> ago fechado, set é o corrente
    const ws = renderizar(2026, 9, vendas);
    // Só 1..8 fechados, nBlocoB=3 (6,7,8), nBlocoA=5 (1..5) -> header não deve conter "SET"
    let achouSet = false;
    ws.getRow(2).eachCell({ includeEmpty: false }, (cell) => {
      if (cell.value === "SET") achouSet = true;
    });
    assert.equal(achouSet, false);
  });
});

describe("aba-media-vendedor — agrupamento Bloco A / Bloco B", () => {
  it("mesAtualIndex=9: Bloco A = meses 1-5, Bloco B = meses 6-8", () => {
    const ws = renderizar(2026, 9, [venda("V1", 2026, 1)]);
    const meses: string[] = [];
    ws.getRow(2).eachCell({ includeEmpty: false }, (cell) => {
      if (typeof cell.value === "string" && /^[A-Z]{3}$/.test(cell.value)) meses.push(cell.value);
    });
    assert.deepEqual(meses, ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO"]);
  });

  it("mesAtualIndex=1 (Janeiro): nenhum mês fechado, aba só tem o header", () => {
    const ws = renderizar(2026, 1, [venda("V1", 2026, 1)]);
    let linhas = 0;
    ws.eachRow((row, n) => {
      if (n > 2 && row.getCell(2).value) linhas++;
    });
    assert.equal(linhas, 0);
  });

  it("mesAtualIndex=3 (Março): só 2 meses fechados -> tudo cabe no Bloco B, sem Bloco A nem DELTA", () => {
    const vendas = [venda("V1", 2026, 1), venda("V1", 2026, 2)];
    const ws = renderizar(2026, 3, vendas);
    const ultimaCol = ultimaColunaHeader(ws);
    assert.notEqual(ws.getRow(2).getCell(ultimaCol).value, "DELTA", "sem Bloco A não deveria ter coluna DELTA");
    const meses: string[] = [];
    ws.getRow(2).eachCell({ includeEmpty: false }, (cell) => {
      if (typeof cell.value === "string" && /^[A-Z]{3}$/.test(cell.value)) meses.push(cell.value);
    });
    assert.deepEqual(meses, ["JAN", "FEV"]);
  });

  it("mesAtualIndex=5 (Maio): Bloco B pega os 3 últimos fechados (fev-abr), Bloco A fica só com jan", () => {
    const ws = renderizar(2026, 5, [venda("V1", 2026, 1)]);
    const meses: string[] = [];
    ws.getRow(2).eachCell({ includeEmpty: false }, (cell) => {
      if (typeof cell.value === "string" && /^[A-Z]{3}$/.test(cell.value)) meses.push(cell.value);
    });
    assert.deepEqual(meses, ["JAN", "FEV", "MAR", "ABR"]);
  });
});

describe("aba-media-vendedor — DELTA e destaque amarelo", () => {
  const vendas: VendaParaMediaVendedor[] = [];
  // QUEDA: 10 vendas/mês em jan-mai (Bloco A, média=10), 1 venda/mês em jun-ago (Bloco B, média=1) -> delta=-9
  for (let mes = 1; mes <= 5; mes++) for (let i = 0; i < 10; i++) vendas.push(venda("QUEDA", 2026, mes));
  for (let mes = 6; mes <= 8; mes++) vendas.push(venda("QUEDA", 2026, mes));
  // SUBIU: espelho invertido -> delta=+9
  for (let mes = 1; mes <= 5; mes++) vendas.push(venda("SUBIU", 2026, mes));
  for (let mes = 6; mes <= 8; mes++) for (let i = 0; i < 10; i++) vendas.push(venda("SUBIU", 2026, mes));

  it("DELTA negativo quando o ritmo caiu nos últimos 3 meses fechados", () => {
    const ws = renderizar(2026, 9, vendas);
    const ultimaCol = ultimaColunaHeader(ws);
    const row = acharLinhaVendedor(ws, "QUEDA");
    assert.equal(resultado(row.getCell(ultimaCol)), -9);
  });

  it("DELTA positivo quando o ritmo subiu", () => {
    const ws = renderizar(2026, 9, vendas);
    const ultimaCol = ultimaColunaHeader(ws);
    const row = acharLinhaVendedor(ws, "SUBIU");
    assert.equal(resultado(row.getCell(ultimaCol)), 9);
  });

  it("linha inteira em destaque amarelo quando DELTA < 0", () => {
    const ws = renderizar(2026, 9, vendas);
    const row = acharLinhaVendedor(ws, "QUEDA");
    const fill = row.getCell(2).fill as ExcelJS.FillPattern;
    assert.equal(fill.fgColor?.argb, "FFFFFF00");
  });

  it("linha NÃO fica amarela quando DELTA >= 0", () => {
    const ws = renderizar(2026, 9, vendas);
    const row = acharLinhaVendedor(ws, "SUBIU");
    const fill = row.getCell(2).fill;
    assert.notEqual((fill as ExcelJS.FillPattern | undefined)?.fgColor?.argb, "FFFFFF00");
  });

  it("TOTAL do DELTA = SOMA dos deltas individuais (fórmula de verdade), não média dos totais gerais", () => {
    const ws = renderizar(2026, 9, vendas);
    const ultimaCol = ultimaColunaHeader(ws);
    const totalRow = acharLinhaVendedor(ws, "TOTAL");
    const cellValue = totalRow.getCell(ultimaCol).value as { formula?: string; result?: number };
    // -9 (QUEDA) + 9 (SUBIU) = 0. Confere a FÓRMULA (SUM sobre as linhas de vendedor), não
    // o `result` cacheado: quirk conhecido do ExcelJS — quando `result` é exatamente 0, o
    // getter de `cell.value` devolve só `{formula}` sem a chave `result` (confirmado
    // isoladamente contra a lib; `result: 12345` sobrevive normalmente, só o 0 some). O
    // Excel recalcula a fórmula certinho ao abrir o arquivo — não é um bug do renderer.
    assert.ok(cellValue.formula?.startsWith("SUM("), `esperava fórmula SUM(...), veio ${JSON.stringify(cellValue)}`);
    if (cellValue.result !== undefined) assert.equal(cellValue.result, 0);
  });
});

describe("aba-media-vendedor — não divide por zero / não quebra com poucos dados", () => {
  it("mesAtualIndex=2 (só janeiro fechado), sem nenhuma venda -> não lança erro", () => {
    assert.doesNotThrow(() => renderizar(2026, 2, []));
  });

  it("mesAtualIndex=9, sem nenhuma venda -> linha TOTAL com zeros, sem erro", () => {
    const ws = renderizar(2026, 9, []);
    const totalRow = acharLinhaVendedor(ws, "TOTAL");
    const ultimaCol = ultimaColunaHeader(ws);
    assert.equal(resultado(totalRow.getCell(ultimaCol)), 0);
  });
});
