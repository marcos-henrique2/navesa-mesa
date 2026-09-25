/**
 * VENDAS USADOS MATRIZ — aba 3 (RESUMO): pivot manual.
 *
 * As categorias (lojas de origem e vendedores) são calculadas em JS a partir das
 * linhas da aba 1, mas cada contagem em si é uma fórmula COUNTIF/COUNTIFS de
 * verdade apontando pra aba 1 — nunca um número pré-calculado escrito direto.
 */

import type ExcelJS from "exceljs";
import type { LinhaVendaMatriz } from "./tipos";
import { COL, DATA_START_ROW, FMT_PERCENT, colLetter, escaparAspasFormula, rangeEntreAbas } from "./colunas";

const COLOR_HEADER_BG = "FFF3F4F6";
const COLOR_TITLE_BG = "FFE5E7EB";

function bold(cell: ExcelJS.Cell): void {
  cell.font = { bold: true };
}

export function renderAbaResumo(ws: ExcelJS.Worksheet, nomeAba1: string, linhasAba1: LinhaVendaMatriz[]): void {
  ws.getColumn(COL.B_SEQ).width = 2;
  ws.getColumn(COL.C_LOJA_ORIGEM).width = 32;
  ws.getColumn(COL.D_DESCRICAO).width = 12;
  ws.getColumn(COL.E_COR).width = 10;

  const ultimaLinhaAba1 = DATA_START_ROW + linhasAba1.length - 1;
  const totalLinhas = linhasAba1.length;

  const LABEL_COL = COL.C_LOJA_ORIGEM;
  const QT_COL = COL.D_DESCRICAO;
  const PCT_COL = COL.E_COR;

  let r = 2;

  const renderBloco = (
    titulo: string,
    categorias: string[],
    colunaFonte: number,
  ): void => {
    ws.mergeCells(r, LABEL_COL, r, PCT_COL);
    const tituloCell = ws.getCell(r, LABEL_COL);
    tituloCell.value = titulo;
    tituloCell.font = { bold: true, size: 12 };
    tituloCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_TITLE_BG } };
    r++;

    const headerRow = ws.getRow(r);
    headerRow.getCell(LABEL_COL).value = "Categoria";
    headerRow.getCell(QT_COL).value = "Qtde";
    headerRow.getCell(PCT_COL).value = "%";
    for (const c of [LABEL_COL, QT_COL, PCT_COL]) {
      bold(headerRow.getCell(c));
      headerRow.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_HEADER_BG } };
    }
    r++;

    const rangeFonte = rangeEntreAbas(nomeAba1, colunaFonte, DATA_START_ROW, ultimaLinhaAba1);

    for (const categoria of categorias) {
      const row = ws.getRow(r);
      row.getCell(LABEL_COL).value = categoria;

      const qtdCell = row.getCell(QT_COL);
      const criterio = escaparAspasFormula(categoria);
      const count = linhasAba1.filter((l) =>
        colunaFonte === COL.C_LOJA_ORIGEM ? l.lojaOrigemNome === categoria : (l.vendedorNome ?? "") === categoria,
      ).length;
      qtdCell.value = { formula: `COUNTIF(${rangeFonte},"${criterio}")`, result: count };

      const pctCell = row.getCell(PCT_COL);
      pctCell.value = {
        formula: `IFERROR(${colLetter(QT_COL)}${r}/COUNTA(${rangeFonte}),"")`,
        result: totalLinhas > 0 ? count / totalLinhas : "",
      };
      pctCell.numFmt = FMT_PERCENT;

      r++;
    }
    r += 2; // linha em branco antes do próximo bloco
  };

  const lojas = [...new Set(linhasAba1.map((l) => l.lojaOrigemNome).filter((n) => n.length > 0))].sort();
  const vendedores = [...new Set(linhasAba1.map((l) => l.vendedorNome ?? "").filter((n) => n.length > 0))].sort();

  renderBloco("VENDAS POR LOJA DE ORIGEM", lojas, COL.C_LOJA_ORIGEM);
  renderBloco("VENDAS POR VENDEDOR", vendedores, COL.AG_VENDEDOR);
}
