/**
 * VENDAS USADOS MATRIZ — renderer único das abas 1 (todas as vendas do período) e 2
 * (só estoque próprio). Só muda o subconjunto de `linhas` recebido — o layout é idêntico.
 */

import type ExcelJS from "exceljs";
import type { LinhaVendaMatriz } from "./tipos";
import { calcularDerivadosLinha } from "./tipos";
import { COL, ULTIMA_COL, DATA_START_ROW, HEADERS, COL_WIDTHS, FMT_MONEY, FMT_PERCENT, FMT_INT } from "./colunas";

const COLOR_TITLE_BG = "FF374151";
const COLOR_TITLE_FG = "FFFFFFFF";
const COLOR_HEADER_BG = "FFF3F4F6";
const COLOR_BORDER = "FFD1D5DB";

function thinBorder(): Partial<ExcelJS.Borders> {
  const side: Partial<ExcelJS.Border> = { style: "thin", color: { argb: COLOR_BORDER } };
  return { top: side, bottom: side, left: side, right: side, diagonal: { up: false, down: false } };
}

export function renderAbaDetalhe(ws: ExcelJS.Worksheet, titulo: string, linhas: LinhaVendaMatriz[]): void {
  for (let c = 1; c <= ULTIMA_COL; c++) {
    ws.getColumn(c).width = COL_WIDTHS[c] ?? 12;
  }

  // ─── Linha 1 — título mergeado ───
  ws.mergeCells(1, COL.B_SEQ, 1, ULTIMA_COL);
  const row1 = ws.getRow(1);
  row1.height = 26;
  const titleCell = row1.getCell(COL.B_SEQ);
  titleCell.value = titulo;
  titleCell.font = { bold: true, size: 13, color: { argb: COLOR_TITLE_FG } };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_TITLE_BG } };

  // ─── Linha 2 — header ───
  const row2 = ws.getRow(2);
  row2.height = 28;
  for (const [colNumStr, label] of Object.entries(HEADERS)) {
    const colNum = Number(colNumStr);
    const cell = row2.getCell(colNum);
    cell.value = label;
    cell.font = { bold: true, size: 10 };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_HEADER_BG } };
    cell.border = thinBorder();
  }

  // ─── Linhas de dados ───
  let r = DATA_START_ROW;
  for (const [idx, l] of linhas.entries()) {
    const row = ws.getRow(r);
    const { custoReal, lucroBruto, margemLiquida } = calcularDerivadosLinha(l);

    row.getCell(COL.B_SEQ).value = idx + 1;
    row.getCell(COL.B_SEQ).numFmt = FMT_INT;

    row.getCell(COL.C_LOJA_ORIGEM).value = l.lojaOrigemNome;
    row.getCell(COL.D_DESCRICAO).value = l.descricaoVeiculo;
    row.getCell(COL.E_COR).value = l.cor ?? "";
    row.getCell(COL.F_MARCA).value = l.marca ?? "";
    row.getCell(COL.G_PLACA).value = l.placa;
    row.getCell(COL.H_ANO_MODELO).value = l.anoModelo;

    if (l.km != null) {
      row.getCell(COL.I_KM).value = l.km;
      row.getCell(COL.I_KM).numFmt = FMT_INT;
    }
    if (l.diasEstoque != null) {
      row.getCell(COL.J_DIAS).value = l.diasEstoque;
      row.getCell(COL.J_DIAS).numFmt = FMT_INT;
    }
    if (l.nfEntrada != null) row.getCell(COL.K_NF_ENTRADA).value = l.nfEntrada;
    if (l.valoriza != null) row.getCell(COL.L_VALORIZA).value = l.valoriza;

    // M — Custo Real (FÓRMULA = K - L). Só escreve quando há NF de entrada (evita
    // exibir -L como "custo real" — mesma guarda de analise-navesa.ts).
    if (custoReal != null) {
      row.getCell(COL.M_CUSTO_REAL).value = { formula: `K${r}-L${r}`, result: custoReal };
    }

    if (l.valorFipe != null) row.getCell(COL.N_VALOR_FIPE).value = l.valorFipe;
    if (l.valorVenda != null) row.getCell(COL.O_VALOR_VENDA).value = l.valorVenda;

    // P — %FIPE (FÓRMULA = IFERROR(O/N,""))
    if (l.valorFipe != null && l.valorVenda != null) {
      row.getCell(COL.P_PCT_FIPE).value = {
        formula: `IFERROR(O${r}/N${r},"")`,
        result: l.valorFipe > 0 ? l.valorVenda / l.valorFipe : "",
      };
    }

    // Q — Lucro Bruto (FÓRMULA = O - M)
    if (lucroBruto != null) {
      row.getCell(COL.Q_LUCRO_BRUTO).value = { formula: `O${r}-M${r}`, result: lucroBruto };
    }

    // R — % (FÓRMULA = IFERROR(Q/O,""))
    if (lucroBruto != null && l.valorVenda != null && l.valorVenda > 0) {
      row.getCell(COL.R_PCT_LUCRO_BRUTO).value = {
        formula: `IFERROR(Q${r}/O${r},"")`,
        result: lucroBruto / l.valorVenda,
      };
    }

    if (l.despesaGeral != null) row.getCell(COL.S_DESPESA_GERAL).value = l.despesaGeral;
    // T — % (FÓRMULA = IFERROR(S/O,""))
    if (l.despesaGeral != null && l.valorVenda != null && l.valorVenda > 0) {
      row.getCell(COL.T_PCT_DESPESA_GERAL).value = {
        formula: `IFERROR(S${r}/O${r},"")`,
        result: l.despesaGeral / l.valorVenda,
      };
    }

    if (l.forplan != null) row.getCell(COL.U_FPLAN).value = l.forplan;
    // V — % (FÓRMULA = IFERROR(U/O,""))
    if (l.forplan != null && l.valorVenda != null && l.valorVenda > 0) {
      row.getCell(COL.V_PCT_FPLAN).value = {
        formula: `IFERROR(U${r}/O${r},"")`,
        result: l.forplan / l.valorVenda,
      };
    }

    if (l.impostos != null) row.getCell(COL.W_IMPOSTOS).value = l.impostos;
    // X — % (FÓRMULA = IFERROR(W/O,""))
    if (l.impostos != null && l.valorVenda != null && l.valorVenda > 0) {
      row.getCell(COL.X_PCT_IMPOSTOS).value = {
        formula: `IFERROR(W${r}/O${r},"")`,
        result: l.impostos / l.valorVenda,
      };
    }

    if (l.comissao != null) row.getCell(COL.Y_COMISSAO).value = l.comissao;
    // Z — % (FÓRMULA = IFERROR(Y/O,""))
    if (l.comissao != null && l.valorVenda != null && l.valorVenda > 0) {
      row.getCell(COL.Z_PCT_COMISSAO).value = {
        formula: `IFERROR(Y${r}/O${r},"")`,
        result: l.comissao / l.valorVenda,
      };
    }

    // AA — Margem Líquida (FÓRMULA = Q - S - U - W - Y)
    if (margemLiquida != null) {
      row.getCell(COL.AA_MARGEM_LIQUIDA).value = {
        formula: `Q${r}-S${r}-U${r}-W${r}-Y${r}`,
        result: margemLiquida,
      };
    }

    // AB — %Margem (FÓRMULA = IFERROR(AA/O,""))
    if (margemLiquida != null && l.valorVenda != null && l.valorVenda > 0) {
      row.getCell(COL.AB_PCT_MARGEM).value = {
        formula: `IFERROR(AA${r}/O${r},"")`,
        result: margemLiquida / l.valorVenda,
      };
    }

    row.getCell(COL.AC_USADO_TROCA).value = l.usadoNaTroca ? "SIM" : "NÃO";
    row.getCell(COL.AD_FINANCIOU).value = l.financiou === true ? "SIM" : l.financiou === false ? "NÃO" : "";
    row.getCell(COL.AE_CLIENTE).value = l.clienteNome;
    row.getCell(COL.AF_LOJISTA).value = l.lojista === true ? "SIM" : l.lojista === false ? "NÃO" : "";
    row.getCell(COL.AG_VENDEDOR).value = l.vendedorNome ?? "";

    // Formatação numérica + alinhamento + borda em toda a linha
    const moneyCols = [
      COL.K_NF_ENTRADA, COL.L_VALORIZA, COL.M_CUSTO_REAL, COL.N_VALOR_FIPE, COL.O_VALOR_VENDA,
      COL.Q_LUCRO_BRUTO, COL.S_DESPESA_GERAL, COL.U_FPLAN, COL.W_IMPOSTOS, COL.Y_COMISSAO,
      COL.AA_MARGEM_LIQUIDA,
    ];
    const pctCols = [
      COL.P_PCT_FIPE, COL.R_PCT_LUCRO_BRUTO, COL.T_PCT_DESPESA_GERAL, COL.V_PCT_FPLAN,
      COL.X_PCT_IMPOSTOS, COL.Z_PCT_COMISSAO, COL.AB_PCT_MARGEM,
    ];
    for (const c of moneyCols) {
      row.getCell(c).numFmt = FMT_MONEY;
      row.getCell(c).alignment = { horizontal: "right" };
    }
    for (const c of pctCols) {
      row.getCell(c).numFmt = FMT_PERCENT;
      row.getCell(c).alignment = { horizontal: "right" };
    }
    row.getCell(COL.G_PLACA).alignment = { horizontal: "center" };
    row.getCell(COL.H_ANO_MODELO).alignment = { horizontal: "center" };
    row.getCell(COL.AC_USADO_TROCA).alignment = { horizontal: "center" };
    row.getCell(COL.AD_FINANCIOU).alignment = { horizontal: "center" };
    row.getCell(COL.AF_LOJISTA).alignment = { horizontal: "center" };

    for (let c = COL.B_SEQ; c <= ULTIMA_COL; c++) {
      row.getCell(c).border = thinBorder();
    }

    r++;
  }
}
