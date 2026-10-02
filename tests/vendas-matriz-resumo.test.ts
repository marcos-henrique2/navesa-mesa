/**
 * Testes da aba 3 ("RESUMO VENDAS MATRIZ {MÊS}") — itens 1 e 2 da pendência "Vendas
 * Usados Matriz" (os 4 itens que ficaram de fora do PR #25 de reestilização por serem
 * dado/lógica nova, não estilo).
 *
 * Item 1 — bloco "POR PÁTIO": nova linha "TOTAL CARROS FATURADOS SEM CONSIGNADOS"
 * (destaque amarelo), contando tudo (incl. Auto Avaliar) menos `consignado === true`.
 * Bloco "VENDAS POR DIAS DE ESTOQUE" passa a excluir consignado também — "dias de
 * pátio" não faz sentido pra um carro que nunca foi do estoque da revenda (mesmo
 * raciocínio que já excluía Auto Avaliar ali).
 *
 * Item 2 — bloco "POR VENDEDOR": nova linha de SUBTOTAL "TOTAL CARROS FATURADOS" (bold
 * navy) logo ANTES da linha "MOZAINIEL - AUTO AVALIAR", somando só vendedores humanos.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { renderAbaResumo } from "@/lib/export/vendas-matriz/aba-resumo";
import type { LinhaVendaMatriz } from "@/lib/export/vendas-matriz/tipos";
import { linhaVendaMatriz } from "./_mocks";

const LABEL_COL = 3; // C
const QT_COL = 4; // D
const LOJISTA_COL = 6; // F

function renderizar(linhas: LinhaVendaMatriz[]): ExcelJS.Worksheet {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("RESUMO");
  renderAbaResumo(ws, { nomeAba1: "VENDAS USADOS OUTUBRO MATRIZ", linhasAba1: linhas, nomeMes: "OUTUBRO" });
  return ws;
}

/** Acha a linha cuja célula de rótulo (coluna C) tem exatamente este texto. Lança se não achar. */
function acharLinhaPorLabel(ws: ExcelJS.Worksheet, label: string): ExcelJS.Row {
  let encontrada: ExcelJS.Row | undefined;
  ws.eachRow((row) => {
    if (String(row.getCell(LABEL_COL).value ?? "") === label) encontrada = row;
  });
  if (!encontrada) throw new Error(`Linha "${label}" não encontrada na aba RESUMO`);
  return encontrada;
}

/** Todas as linhas cuja célula de rótulo tem exatamente este texto, na ordem da planilha. */
function acharLinhasPorLabel(ws: ExcelJS.Worksheet, label: string): ExcelJS.Row[] {
  const linhas: ExcelJS.Row[] = [];
  ws.eachRow((row) => {
    if (String(row.getCell(LABEL_COL).value ?? "") === label) linhas.push(row);
  });
  return linhas;
}

function valorCelula(row: ExcelJS.Row, col: number): number | string {
  const v = row.getCell(col).value;
  if (v && typeof v === "object" && "result" in v) return (v as { result: number | string }).result;
  return v as number | string;
}

describe("aba-resumo — item 1: TOTAL CARROS FATURADOS SEM CONSIGNADOS (bloco PÁTIO)", () => {
  const linhas = [
    linhaVendaMatriz({ vendedorNome: "VENDEDOR A", consignado: false }),
    linhaVendaMatriz({ vendedorNome: "VENDEDOR A", consignado: false }),
    linhaVendaMatriz({ vendedorNome: "VENDEDOR B", consignado: true }),
    linhaVendaMatriz({ vendedorNome: "MOZAINEL CORREA", consignado: false }), // Auto Avaliar
  ];

  it("conta tudo (incl. Auto Avaliar) menos consignado=true", () => {
    const ws = renderizar(linhas);
    const row = acharLinhaPorLabel(ws, "TOTAL CARROS FATURADOS SEM CONSIGNADOS");
    assert.equal(valorCelula(row, QT_COL), 3); // 4 linhas - 1 consignada
  });

  it("tem destaque amarelo vivo (fundo + texto preto bold), não o navy do TOTAL geral", () => {
    const ws = renderizar(linhas);
    const row = acharLinhaPorLabel(ws, "TOTAL CARROS FATURADOS SEM CONSIGNADOS");
    const labelCell = row.getCell(LABEL_COL);
    const fill = labelCell.fill as ExcelJS.FillPattern;
    assert.equal(fill.fgColor?.argb, "FFFFFF00");
    assert.equal(labelCell.font?.color?.argb, "FF000000");
  });

  it("aparece logo abaixo da linha TOTAL (geral), dentro do mesmo bloco", () => {
    const ws = renderizar(linhas);
    const totalRows = acharLinhasPorLabel(ws, "TOTAL");
    const totalGeralPatio = totalRows[0]; // primeira ocorrência de "TOTAL" = bloco A (pátio)
    const semConsignadoRow = acharLinhaPorLabel(ws, "TOTAL CARROS FATURADOS SEM CONSIGNADOS");
    assert.equal(semConsignadoRow.number, totalGeralPatio.number + 1);
  });

  it("zero consignados -> mesma contagem do TOTAL geral", () => {
    const semConsignado = linhas.map((l) => ({ ...l, consignado: false }));
    const ws = renderizar(semConsignado);
    const row = acharLinhaPorLabel(ws, "TOTAL CARROS FATURADOS SEM CONSIGNADOS");
    assert.equal(valorCelula(row, QT_COL), 4);
  });
});

describe("aba-resumo — item 1: bloco DIAS DE ESTOQUE exclui consignado", () => {
  it("venda consignada não entra em nenhuma faixa de dias de estoque", () => {
    const linhas = [
      linhaVendaMatriz({ vendedorNome: "V1", diasEstoque: 10, consignado: false }),
      linhaVendaMatriz({ vendedorNome: "V2", diasEstoque: 15, consignado: true }), // deveria ficar de fora
    ];
    const ws = renderizar(linhas);
    const row030 = acharLinhaPorLabel(ws, "0-30 dias");
    assert.equal(valorCelula(row030, QT_COL), 1, "só a venda não-consignada deve contar na faixa 0-30");
  });
});

describe("aba-resumo — item 2: SUBTOTAL antes de MOZAINIEL - AUTO AVALIAR (bloco VENDEDOR)", () => {
  const linhas = [
    linhaVendaMatriz({ vendedorNome: "ALEXANDRO CUNHA", lojista: false }),
    linhaVendaMatriz({ vendedorNome: "ALEXANDRO CUNHA", lojista: true }),
    linhaVendaMatriz({ vendedorNome: "EDNEI ALCANTARA", lojista: false }),
    linhaVendaMatriz({ vendedorNome: "MOZAINEL CORREA", lojista: true }), // Auto Avaliar
    linhaVendaMatriz({ vendedorNome: "MOZAINEL CORREA", lojista: false }), // Auto Avaliar
  ];

  it("soma só vendedores humanos (exclui Auto Avaliar)", () => {
    const ws = renderizar(linhas);
    const subtotal = acharLinhasPorLabel(ws, "TOTAL CARROS FATURADOS")[0];
    assert.equal(valorCelula(subtotal, QT_COL), 3); // 3 vendas humanas, 2 Auto Avaliar de fora
  });

  it("aparece ANTES da linha MOZAINIEL - AUTO AVALIAR", () => {
    const ws = renderizar(linhas);
    const subtotal = acharLinhasPorLabel(ws, "TOTAL CARROS FATURADOS")[0];
    const autoAvaliar = acharLinhaPorLabel(ws, "AUTO AVALIAR");
    assert.ok(subtotal.number < autoAvaliar.number, "subtotal deve vir antes da linha Auto Avaliar");
  });

  it("TOTAL geral final (depois de Auto Avaliar) continua somando tudo, incl. Auto Avaliar", () => {
    const ws = renderizar(linhas);
    // Ordem das linhas "TOTAL" na aba: bloco A (pátio) = índice 0, bloco C (canal) = 1,
    // bloco D (vendedor, o TOTAL final depois de Auto Avaliar) = índice 2.
    const totalFinal = acharLinhasPorLabel(ws, "TOTAL")[2];
    assert.equal(valorCelula(totalFinal, QT_COL), 5);
  });

  it("coluna Lojista do subtotal conta só lojista=true entre os vendedores humanos", () => {
    const ws = renderizar(linhas);
    const subtotal = acharLinhasPorLabel(ws, "TOTAL CARROS FATURADOS")[0];
    assert.equal(valorCelula(subtotal, LOJISTA_COL), 1); // só ALEXANDRO CUNHA (lojista=true) entre os humanos
  });
});
