/** Ajustes de leitura e impressão; preserva dados, fórmulas e a paleta do modelo. */
import type ExcelJS from "exceljs";
import { COL, DATA_START_ROW } from "@/lib/export/vendas-matriz/colunas";
import {
  COR_BANNER_N1_BG, COR_PROPRIO_BG, COR_REPASSE_BG,
  COR_HEADER_RESUMO_NUMERICO_BG,
} from "@/lib/export/vendas-matriz/estilo";

function larguras(ws: ExcelJS.Worksheet, valores: Record<number, number>): void {
  for (const [coluna, largura] of Object.entries(valores)) ws.getColumn(Number(coluna)).width = largura;
}

function detalhe(ws: ExcelJS.Worksheet): void {
  larguras(ws, { 3: 28, 4: 56, 5: 18, 6: 16, 7: 12, 8: 12, 31: 40, 33: 34 });
  const moedas = [11, 12, 13, 14, 15, 17, 19, 21, 23, 25, 27, 35];
  const percentuais = [16, 18, 20, 22, 24, 26, 28, 36];
  for (const col of moedas) ws.getColumn(col).width = 18;
  for (const col of percentuais) ws.getColumn(col).width = 10;
  ws.getRow(2).height = 38;
  ws.views = [{ state: "frozen", xSplit: 7, ySplit: 3, topLeftCell: "H4", activeCell: "H4", zoomScale: 85, showGridLines: false }];
  ws.eachRow((row, numero) => {
    if (numero < DATA_START_ROW) return;
    const veiculo = typeof row.getCell(COL.B_SEQ).value === "number" && typeof row.getCell(COL.G_PLACA).value === "string";
    if (veiculo) {
      row.height = 32;
      for (const col of [COL.C_LOJA_ORIGEM, COL.D_DESCRICAO, COL.AE_CLIENTE, COL.AG_VENDEDOR]) {
        const cell = row.getCell(col);
        cell.alignment = { ...cell.alignment, wrapText: true, vertical: "middle" };
      }
    } else if (row.getCell(COL.B_SEQ).value === "TOTAIS / MÉDIAS DO PERÍODO") {
      row.height = 38;
      ws.getRow(numero + 1).height = 26;
    }
  });
}

function blocos(ws: ExcelJS.Worksheet): void {
  ws.eachRow((row) => {
    row.height = 22;
    row.eachCell((cell) => {
      if (cell.isMerged && cell.master.address === cell.address && typeof cell.value === "string") {
        cell.font = { ...cell.font, size: Math.max(cell.font?.size ?? 10, 13) };
        cell.alignment = { ...cell.alignment, wrapText: true, vertical: "middle" };
        row.height = 44;
      }
    });
  });
}

/** Aplica a apresentação às nove abas já renderizadas, sem tocar em valores. */
export function aplicarApresentacaoWorkbook(workbook: ExcelJS.Workbook): void {
  const cores = [COR_BANNER_N1_BG, COR_PROPRIO_BG, COR_BANNER_N1_BG, COR_BANNER_N1_BG, COR_REPASSE_BG, COR_PROPRIO_BG, COR_BANNER_N1_BG, COR_BANNER_N1_BG, COR_BANNER_N1_BG];
  workbook.worksheets.forEach((ws, index) => {
    ws.properties.tabColor = { argb: cores[index] ?? COR_BANNER_N1_BG };
    ws.views = [{ state: "normal", showGridLines: false, zoomScale: 95 }];
    const margens = index >= 3 && index <= 5;
    const amplo = index < 2 || index === 7 || margens;
    ws.pageSetup = {
      ...ws.pageSetup, orientation: amplo ? "landscape" : "portrait", paperSize: (amplo ? 8 : 9) as ExcelJS.PaperSize, // OOXML: 8 = A3, ausente no enum do ExcelJS.
      fitToPage: true, fitToWidth: index < 2 ? 3 : 1, fitToHeight: margens ? 1 : 0,
      margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.15, footer: 0.2 },
      printTitlesRow: index < 2 ? "2:3" : index === 6 || index === 7 ? "2:2" : undefined,
    };
    ws.headerFooter = { ...(ws.headerFooter ?? {}), oddFooter: "&L&A&R&P / &N" };
    if (index < 2) {
      detalhe(ws);
      return;
    }
    blocos(ws);
    if (index === 2) larguras(ws, { 3: 48, 4: 16, 5: 12, 6: 16, 7: 12 });
    if (margens) {
      ws.views = [{ state: "normal", showGridLines: false, zoomScale: 85 }];
      for (let inicio = 3; inicio <= ws.columnCount; inicio += 4) {
        larguras(ws, { [inicio]: 42, [inicio + 1]: 22, [inicio + 2]: 12 });
        ws.eachRow((row) => {
          if (row.getCell(inicio).value !== "Margem Líquida") return;
          row.height = 26;
          for (const col of [inicio, inicio + 1, inicio + 2]) {
            const cell = row.getCell(col);
            cell.font = { ...cell.font, bold: true };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COR_HEADER_RESUMO_NUMERICO_BG } };
          }
        });
      }
    }
    if (index === 6) {
      larguras(ws, { 2: 32, 3: 18, 4: 14 });
      ws.getRow(2).height = 38;
    }
    if (index === 7) {
      ws.getColumn(2).width = 34;
      for (let col = 3; col <= ws.columnCount; col++) {
        const titulo = ws.getRow(2).getCell(col).value;
        ws.getColumn(col).width = titulo === "TOTAL" || titulo === "MÉDIA" || titulo === "DELTA" ? 12 : 9;
      }
      ws.getRow(2).height = 38;
      ws.views = [{ state: "frozen", xSplit: 2, ySplit: 2, topLeftCell: "C3", activeCell: "C3", showGridLines: false, zoomScale: 95 }];
    }
    if (index === 8) {
      larguras(ws, { 2: 30, 3: 20, 5: 30, 6: 20 });
      for (let numero = 2; numero <= 5; numero++) {
        const row = ws.getRow(numero);
        row.height = 28;
        row.eachCell((cell) => { cell.alignment = { ...cell.alignment, wrapText: true, vertical: "middle" }; });
      }
    }
    if (index === 6 || index === 7) ws.eachRow((row, numero) => {
      if (numero <= 2 || row.getCell(2).value === "TOTAL") return;
      row.height = 32;
      const nome = row.getCell(2);
      nome.alignment = { ...nome.alignment, wrapText: true, vertical: "middle" };
    });
    // Cabeçalhos de tabelas anuais também precisam acomodar o texto ampliado.
    if (index === 6 || index === 7) ws.getRow(2).eachCell((cell) => {
      cell.alignment = { ...cell.alignment, wrapText: true, vertical: "middle" };
    });
  });
}
