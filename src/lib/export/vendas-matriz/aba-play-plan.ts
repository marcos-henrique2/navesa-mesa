/**
 * VENDAS USADOS MATRIZ — aba 9 (PLAY PLAN VENDEDOR INFLUENCER), estática.
 */

import type ExcelJS from "exceljs";
import { PLAY_PLAN_CLIENTE_FINAL, PLAY_PLAN_FATURADOS_LOJA, type TabelaPlayPlan } from "./dados-estaticos-play-plan";
import { FMT_MONEY } from "./colunas";

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
    r++;
  }

  for (let rr = 2; rr <= 5; rr++) {
    ws.getCell(rr, colLabel).font = { bold: true };
  }
}

export function renderAbaPlayPlan(ws: ExcelJS.Worksheet): void {
  ws.getColumn(2).width = 22;
  ws.getColumn(3).width = 18;
  ws.getColumn(5).width = 22;
  ws.getColumn(6).width = 18;

  renderTabela(ws, 2, 3, PLAY_PLAN_CLIENTE_FINAL);
  renderTabela(ws, 5, 6, PLAY_PLAN_FATURADOS_LOJA);
}
