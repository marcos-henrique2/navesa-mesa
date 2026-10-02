/**
 * VENDAS USADOS MATRIZ — aba 9 (PLAY PLAN VENDEDOR INFLUENCER), estática.
 */

import type ExcelJS from "exceljs";
import { PLAY_PLAN_CLIENTE_FINAL, PLAY_PLAN_FATURADOS_LOJA, type TabelaPlayPlan } from "./dados-estaticos-play-plan";
import { FMT_MONEY } from "./colunas";
import { FONT_DADO, FONT_HEADER_NAVY, COR_BANNER_N1_BG, aplicarBordaBloco, comVerticalMiddle } from "./estilo";

/** Linha em que termina o header navy (SALÁRIO FIXO..VÁRIAVEL) de cada tabela. */
const ULTIMA_LINHA_HEADER = 5;

function renderTabela(ws: ExcelJS.Worksheet, colLabel: number, colValor: number, tabela: TabelaPlayPlan): void {
  ws.getCell(2, colLabel).value = "SALÁRIO FIXO";
  ws.getCell(2, colValor).value = tabela.salarioFixo;
  ws.getCell(2, colValor).numFmt = FMT_MONEY;

  ws.getCell(3, colLabel).value = tabela.volumeLabel;
  ws.getCell(3, colValor).value = "PREMIO FIXO";

  ws.getCell(4, colLabel).value = tabela.clienteLabel;
  ws.getCell(4, colValor).value = "SEM DSR";

  ws.getCell(5, colLabel).value = "VÁRIAVEL";
  ws.getCell(5, colValor).value = "VIDE TABELA ABAIXO";

  let r = 6;
  for (const faixa of tabela.faixas) {
    ws.getCell(r, colLabel).value = faixa.faixa;
    ws.getCell(r, colValor).value = faixa.premio;
    ws.getCell(r, colValor).numFmt = FMT_MONEY;
    // Dados bold, igual ao relatório original (27.png de referência).
    ws.getCell(r, colLabel).font = { ...FONT_DADO, bold: true };
    ws.getCell(r, colValor).font = { ...FONT_DADO, bold: true };
    comVerticalMiddle(ws.getCell(r, colLabel));
    comVerticalMiddle(ws.getCell(r, colValor));
    r++;
  }
  const linhaFimDados = r - 1;

  // Header navy + texto branco nas 4 linhas (SALÁRIO FIXO..VÁRIAVEL), nas duas colunas
  // (label e valor) — bate com o banner navy sólido do relatório original.
  for (let rr = 2; rr <= ULTIMA_LINHA_HEADER; rr++) {
    for (const c of [colLabel, colValor]) {
      const cell = ws.getCell(rr, c);
      cell.font = FONT_HEADER_NAVY;
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COR_BANNER_N1_BG } };
      comVerticalMiddle(cell);
    }
  }

  // Borda fina ao redor da tabela inteira (header + dados) — grade completa, igual ao original.
  aplicarBordaBloco(ws, 2, linhaFimDados, colLabel, colValor);
}

export function renderAbaPlayPlan(ws: ExcelJS.Worksheet): void {
  ws.getColumn(2).width = 22;
  ws.getColumn(3).width = 18;
  ws.getColumn(5).width = 22;
  ws.getColumn(6).width = 18;
  for (const c of [2, 3, 5, 6]) ws.getColumn(c).font = FONT_DADO;

  renderTabela(ws, 2, 3, PLAY_PLAN_CLIENTE_FINAL);
  renderTabela(ws, 5, 6, PLAY_PLAN_FATURADOS_LOJA);
}
