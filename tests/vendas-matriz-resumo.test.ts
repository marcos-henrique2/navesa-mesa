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

// Layout horizontal (4 blocos lado a lado, cada um com seu próprio grupo de colunas —
// ver mapa de colunas no topo de aba-resumo.ts).
const A_LABEL = 3; // C — Bloco A: VENDAS POR PÁTIO
const A_QT = 4; // D
const B_LABEL = 7; // G — Bloco B: VENDAS POR DIAS DE ESTOQUE
const B_QT = 8; // H
const C_LABEL = 11; // K — Bloco C: VENDAS POR CANAL DE VENDAS
const D_LABEL = 15; // O — Bloco D: VENDAS POR VENDEDOR
const D_QT = 16; // P
const D_LOJISTA = 18; // R

function renderizar(linhas: LinhaVendaMatriz[]): ExcelJS.Worksheet {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("RESUMO");
  renderAbaResumo(ws, { nomeAba1: "VENDAS USADOS OUTUBRO MATRIZ", linhasAba1: linhas, nomeMes: "OUTUBRO" });
  return ws;
}

/** Acha a linha cuja célula de rótulo (na coluna do bloco em questão) tem exatamente este texto. Lança se não achar. */
function acharLinhaPorLabel(ws: ExcelJS.Worksheet, label: string, labelCol: number): ExcelJS.Row {
  let encontrada: ExcelJS.Row | undefined;
  ws.eachRow((row) => {
    if (String(row.getCell(labelCol).value ?? "") === label) encontrada = row;
  });
  if (!encontrada) throw new Error(`Linha "${label}" não encontrada na coluna ${labelCol} da aba RESUMO`);
  return encontrada;
}

/** Todas as linhas cuja célula de rótulo (na coluna do bloco em questão) tem exatamente este texto, na ordem da planilha. */
function acharLinhasPorLabel(ws: ExcelJS.Worksheet, label: string, labelCol: number): ExcelJS.Row[] {
  const linhas: ExcelJS.Row[] = [];
  ws.eachRow((row) => {
    if (String(row.getCell(labelCol).value ?? "") === label) linhas.push(row);
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
    const row = acharLinhaPorLabel(ws, "TOTAL CARROS FATURADOS SEM CONSIGNADOS", A_LABEL);
    assert.equal(valorCelula(row, A_QT), 3); // 4 linhas - 1 consignada
  });

  it("tem destaque amarelo vivo (fundo + texto preto bold), não o navy do TOTAL geral", () => {
    const ws = renderizar(linhas);
    const row = acharLinhaPorLabel(ws, "TOTAL CARROS FATURADOS SEM CONSIGNADOS", A_LABEL);
    const labelCell = row.getCell(A_LABEL);
    const fill = labelCell.fill as ExcelJS.FillPattern;
    assert.equal(fill.fgColor?.argb, "FFFFFF00");
    assert.equal(labelCell.font?.color?.argb, "FF000000");
  });

  it("aparece logo abaixo da linha TOTAL (geral), dentro do mesmo bloco", () => {
    const ws = renderizar(linhas);
    const totalRows = acharLinhasPorLabel(ws, "TOTAL", A_LABEL);
    const totalGeralPatio = totalRows[0]; // única ocorrência de "TOTAL" na coluna do bloco A (pátio)
    const semConsignadoRow = acharLinhaPorLabel(ws, "TOTAL CARROS FATURADOS SEM CONSIGNADOS", A_LABEL);
    assert.equal(semConsignadoRow.number, totalGeralPatio.number + 1);
  });

  it("zero consignados -> mesma contagem do TOTAL geral", () => {
    const semConsignado = linhas.map((l) => ({ ...l, consignado: false }));
    const ws = renderizar(semConsignado);
    const row = acharLinhaPorLabel(ws, "TOTAL CARROS FATURADOS SEM CONSIGNADOS", A_LABEL);
    assert.equal(valorCelula(row, A_QT), 4);
  });
});

describe("aba-resumo — item 1: bloco DIAS DE ESTOQUE exclui consignado", () => {
  it("venda consignada não entra em nenhuma faixa de dias de estoque", () => {
    const linhas = [
      linhaVendaMatriz({ vendedorNome: "V1", diasEstoque: 10, consignado: false }),
      linhaVendaMatriz({ vendedorNome: "V2", diasEstoque: 15, consignado: true }), // deveria ficar de fora
    ];
    const ws = renderizar(linhas);
    const row030 = acharLinhaPorLabel(ws, "0-30 dias", B_LABEL);
    assert.equal(valorCelula(row030, B_QT), 1, "só a venda não-consignada deve contar na faixa 0-30");
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
    const subtotal = acharLinhasPorLabel(ws, "TOTAL CARROS FATURADOS", D_LABEL)[0];
    assert.equal(valorCelula(subtotal, D_QT), 3); // 3 vendas humanas, 2 Auto Avaliar de fora
  });

  it("aparece ANTES da linha MOZAINIEL - AUTO AVALIAR", () => {
    const ws = renderizar(linhas);
    const subtotal = acharLinhasPorLabel(ws, "TOTAL CARROS FATURADOS", D_LABEL)[0];
    const autoAvaliar = acharLinhaPorLabel(ws, "AUTO AVALIAR", D_LABEL);
    assert.ok(subtotal.number < autoAvaliar.number, "subtotal deve vir antes da linha Auto Avaliar");
  });

  it("TOTAL geral final (depois de Auto Avaliar) continua somando tudo, incl. Auto Avaliar", () => {
    const ws = renderizar(linhas);
    // Bloco D tem seu próprio eixo de linha: só existe um "TOTAL" na coluna do bloco D
    // (o subtotal é rotulado "TOTAL CARROS FATURADOS", não "TOTAL" — sem ambiguidade).
    const totalFinal = acharLinhaPorLabel(ws, "TOTAL", D_LABEL);
    assert.equal(valorCelula(totalFinal, D_QT), 5);
  });

  it("coluna Lojista do subtotal conta só lojista=true entre os vendedores humanos", () => {
    const ws = renderizar(linhas);
    const subtotal = acharLinhasPorLabel(ws, "TOTAL CARROS FATURADOS", D_LABEL)[0];
    assert.equal(valorCelula(subtotal, D_LOJISTA), 1); // só ALEXANDRO CUNHA (lojista=true) entre os humanos
  });
});

describe("aba-resumo — layout horizontal: os 4 blocos ficam lado a lado (mesma linha, colunas diferentes)", () => {
  const linhas = [
    linhaVendaMatriz({ vendedorNome: "VENDEDOR A", lojista: false }),
    linhaVendaMatriz({ vendedorNome: "MOZAINEL CORREA", lojista: true }), // Auto Avaliar
  ];

  it("os 4 banners (linha 2) existem simultaneamente, cada um na coluna do seu bloco", () => {
    const ws = renderizar(linhas);
    assert.equal(ws.getCell(2, A_LABEL).value, "VENDAS EM OUTUBRO NAVESA AEROPORTO (POR PÁTIO)");
    assert.equal(ws.getCell(2, B_LABEL).value, "VENDAS POR DIAS DE ESTOQUE");
    assert.equal(ws.getCell(2, C_LABEL).value, "VENDAS POR CANAL DE VENDAS");
    assert.equal(ws.getCell(2, D_LABEL).value, "VENDAS POR VENDEDOR");
  });

  it("os 4 headers (linha 3) existem simultaneamente, cada um na coluna do seu bloco", () => {
    const ws = renderizar(linhas);
    assert.equal(ws.getCell(3, A_LABEL).value, "Pátio");
    assert.equal(ws.getCell(3, B_LABEL).value, "Faixa");
    assert.equal(ws.getCell(3, C_LABEL).value, "Canal");
    assert.equal(ws.getCell(3, D_LABEL).value, "Vendedor");
  });
});
