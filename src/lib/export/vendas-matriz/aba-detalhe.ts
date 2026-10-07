/**
 * VENDAS USADOS MATRIZ — renderer único das abas 1 (todas as vendas do período) e 2
 * (só estoque próprio). Só muda o subconjunto de `linhas` recebido — o layout é idêntico.
 */

import type ExcelJS from "exceljs";
import type { LinhaVendaMatriz } from "./tipos";
import { calcularDerivadosLinha } from "./tipos";
import {
  COL, ULTIMA_COL, NOTA_ROW, DATA_START_ROW, HEADERS, COL_WIDTHS,
  FMT_MONEY, FMT_PERCENT, FMT_INT, FMT_DECIMAL2, colLetter,
} from "./colunas";
import {
  FONT_DADO, FONT_HEADER_DETALHE, FONT_HEADER_RESUMO_NUMERICO, FONT_NOTA,
  COR_HEADER_DETALHE_BG, COR_HEADER_RESUMO_NUMERICO_BG, COR_DATABAR_MARGEM,
  bordaInferiorFina, bordaInferiorMedia, aplicarBordaBloco, aplicarZebra, comVerticalMiddle,
  condFormatNegativo, condFormatDataBar,
} from "./estilo";
import { somaCampo, mediaCampo } from "./aba-margens";

/**
 * `titulo` não é mais renderizado na planilha (não existe banner de título, igual
 * ao arquivo original) — mantido no parâmetro só por compatibilidade de assinatura
 * com `gerar-workbook.ts`.
 */
export function renderAbaDetalhe(ws: ExcelJS.Worksheet, titulo: string, linhas: LinhaVendaMatriz[]): void {
  for (let c = 1; c <= ULTIMA_COL; c++) {
    ws.getColumn(c).width = COL_WIDTHS[c] ?? 12;
    ws.getColumn(c).font = FONT_DADO;
  }

  // ─── Linha 1 — espaçador em branco, baixo, igual ao original ───
  ws.getRow(1).height = 6.6;

  // ─── Linha 2 — header ───
  const row2 = ws.getRow(2);
  row2.height = 28;
  for (const [colNumStr, label] of Object.entries(HEADERS)) {
    const colNum = Number(colNumStr);
    const cell = row2.getCell(colNum);
    cell.value = label;
    cell.font = FONT_HEADER_DETALHE;
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COR_HEADER_DETALHE_BG } };
    cell.border = bordaInferiorMedia();
  }

  // ─── Linha 3 — nota explicativa da fórmula de Custo Real ───
  const row3 = ws.getRow(NOTA_ROW);
  row3.height = 12;
  const notaCell = row3.getCell(COL.M_CUSTO_REAL);
  notaCell.value = "entrada - valoriza";
  notaCell.font = FONT_NOTA;
  notaCell.alignment = { horizontal: "center", vertical: "middle" };

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

    if (l.adm != null) row.getCell(COL.AI_ADM).value = l.adm;
    // AJ — % (FÓRMULA = IFERROR(AI/O,""))
    if (l.adm != null && l.valorVenda != null && l.valorVenda > 0) {
      row.getCell(COL.AJ_PCT_ADM).value = {
        formula: `IFERROR(AI${r}/O${r},"")`,
        result: l.adm / l.valorVenda,
      };
    }

    // AA — Margem Líquida (FÓRMULA = Q - S - U - W - Y - AI)
    if (margemLiquida != null) {
      row.getCell(COL.AA_MARGEM_LIQUIDA).value = {
        formula: `Q${r}-S${r}-U${r}-W${r}-Y${r}-AI${r}`,
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
    // Coluna de apoio pra SUMIFS/COUNTIFS dos blocos de MARGEM excluírem consignado via
    // critério de Excel de verdade (ver ressalva em tipos.ts/gerar-workbook.ts).
    row.getCell(COL.AH_CONSIGNADO).value = l.consignado ? "SIM" : "NÃO";

    // Formatação numérica + alinhamento em toda a linha. Q/AA (Lucro Bruto/Margem
    // Líquida) e R/AB (as % correspondentes) usam o MESMO numFmt das demais — o
    // vermelho de negativo é conditional formatting (aplicado uma vez,
    // pro range inteiro da coluna, depois do loop), não mais seção `[Red]` do numFmt.
    const moneyCols = [
      COL.K_NF_ENTRADA, COL.L_VALORIZA, COL.M_CUSTO_REAL, COL.N_VALOR_FIPE, COL.O_VALOR_VENDA,
      COL.S_DESPESA_GERAL, COL.U_FPLAN, COL.W_IMPOSTOS, COL.Y_COMISSAO, COL.AI_ADM, COL.Q_LUCRO_BRUTO, COL.AA_MARGEM_LIQUIDA,
    ];
    const pctCols = [
      COL.P_PCT_FIPE, COL.T_PCT_DESPESA_GERAL, COL.V_PCT_FPLAN,
      COL.X_PCT_IMPOSTOS, COL.Z_PCT_COMISSAO, COL.AJ_PCT_ADM, COL.R_PCT_LUCRO_BRUTO, COL.AB_PCT_MARGEM,
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
    row.getCell(COL.AH_CONSIGNADO).alignment = { horizontal: "center" };

    // Borda fina só embaixo (sem grade completa), zebra striping e vertical middle
    // padronizado em toda célula com conteúdo — nessa ordem, pra não perder os
    // alinhamentos horizontais já setados acima.
    const numeroLinhaTabela = idx + 1;
    aplicarZebra(ws, r, COL.B_SEQ, ULTIMA_COL, numeroLinhaTabela);
    for (let c = COL.B_SEQ; c <= ULTIMA_COL; c++) {
      const cell = row.getCell(c);
      cell.border = bordaInferiorFina();
      comVerticalMiddle(cell);
    }

    r++;
  }

  const ultimaLinhaDados = r - 1;

  // AutoFilter na linha de header (linha 2) — dá as setinhas de filtro do arquivo original.
  ws.autoFilter = {
    from: { row: 2, column: COL.B_SEQ },
    to: { row: 2, column: ULTIMA_COL },
  };

  // Borda grossa navy ao redor da tabela inteira (header + nota + dados).
  const linhaFimBloco = Math.max(ultimaLinhaDados, NOTA_ROW);
  aplicarBordaBloco(ws, 2, linhaFimBloco, COL.B_SEQ, ULTIMA_COL);

  if (ultimaLinhaDados >= DATA_START_ROW) {
    let prioridade = 1;
    const refColuna = (colNum: number): string => {
      const letra = colLetter(colNum);
      return `${letra}${DATA_START_ROW}:${letra}${ultimaLinhaDados}`;
    };

    // Vermelho de negativo (Lucro Bruto/Margem Líquida e as % correspondentes).
    for (const col of [COL.Q_LUCRO_BRUTO, COL.R_PCT_LUCRO_BRUTO, COL.AA_MARGEM_LIQUIDA, COL.AB_PCT_MARGEM]) {
      condFormatNegativo(ws, refColuna(col), prioridade++);
    }

    // DataBar nativa na coluna Margem Líquida (AA).
    condFormatDataBar(ws, refColuna(COL.AA_MARGEM_LIQUIDA), prioridade++, COR_DATABAR_MARGEM);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Bloco de totais/médias do período — logo abaixo da tabela (21.png de
  // referência). Header 3º tom de azul (periwinkle, ver estilo.ts) + 1 linha
  // de valores, sempre fórmula Excel de verdade (SUM/AVERAGE sobre o range
  // de dados desta mesma aba) — nunca hardcode, mesmo princípio das colunas
  // M/P/Q/R/T/V/X/Z/AA/AB já calculadas por linha acima.
  //
  // KM/DIAS PÁTIO = MÉDIA (um "total" de km não faz sentido). Todo o resto é
  // SOMA. %FIPE X VENDA e as demais % seguem SUM(numerador)/SUM(denominador)
  // — razão das somas, não média das razões por linha — pra não deixar
  // poucos carros caros/baratos distorcerem a % agregada (decisão tomada
  // aqui, documentada pro handoff: não havia como confirmar contra o
  // original porque a imagem de referência estava cortada nessa região).
  // ═══════════════════════════════════════════════════════════════════════
  if (ultimaLinhaDados >= DATA_START_ROW) {
    const rIni = DATA_START_ROW;
    const rFim = ultimaLinhaDados;
    const rHeader = rFim + 2; // 1 linha em branco de respiro antes do bloco
    const rValores = rHeader + 1;

    const headerLabels: { col: number; label: string }[] = [
      { col: COL.I_KM, label: "KM" },
      { col: COL.J_DIAS, label: "DIAS PÁTIO" },
      { col: COL.K_NF_ENTRADA, label: "VALOR ENTRADA" },
      { col: COL.L_VALORIZA, label: "VALORIZA" },
      { col: COL.M_CUSTO_REAL, label: "CUSTO REAL" },
      { col: COL.N_VALOR_FIPE, label: "FIPE" },
      { col: COL.O_VALOR_VENDA, label: "VALOR VENDA" },
      { col: COL.P_PCT_FIPE, label: "%FIPE X VENDA" },
      { col: COL.Q_LUCRO_BRUTO, label: "LUCRO BRUTO" },
      { col: COL.R_PCT_LUCRO_BRUTO, label: "%" },
      { col: COL.S_DESPESA_GERAL, label: "DESPESA GERAL" },
      { col: COL.T_PCT_DESPESA_GERAL, label: "%" },
      { col: COL.U_FPLAN, label: "F PLAN" },
      { col: COL.V_PCT_FPLAN, label: "%" },
      { col: COL.W_IMPOSTOS, label: "IMPOSTOS" },
      { col: COL.X_PCT_IMPOSTOS, label: "%" },
      { col: COL.Y_COMISSAO, label: "COMISSÃO VENDEDOR" },
      { col: COL.Z_PCT_COMISSAO, label: "%" },
      { col: COL.AA_MARGEM_LIQUIDA, label: "MARGEM LÍQUIDA" },
      { col: COL.AB_PCT_MARGEM, label: "%" },
      // ADM — adicionado ao FIM (col. AI/AJ), depois de Margem Líquida na ordem física da
      // planilha, mesmo padrão de AH_CONSIGNADO (ver colunas.ts).
      { col: COL.AI_ADM, label: "ADM" },
      { col: COL.AJ_PCT_ADM, label: "%" },
    ];

    // Rótulo do bloco, mergeado nas colunas sem dado aqui (B..H) — o original (fora de
    // view na imagem de referência) não deixa claro se rotula; sem isso a linha de
    // totais fica "solta" sem contexto, então mantemos um rótulo simples.
    ws.mergeCells(rHeader, COL.B_SEQ, rHeader, COL.H_ANO_MODELO);
    const rotuloCell = ws.getCell(rHeader, COL.B_SEQ);
    rotuloCell.value = "TOTAIS / MÉDIAS DO PERÍODO";
    rotuloCell.font = FONT_HEADER_RESUMO_NUMERICO;
    rotuloCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COR_HEADER_RESUMO_NUMERICO_BG } };
    rotuloCell.alignment = { horizontal: "center", vertical: "middle" };

    const headerRow = ws.getRow(rHeader);
    headerRow.height = 28;
    for (const { col, label } of headerLabels) {
      const cell = headerRow.getCell(col);
      cell.value = label;
      cell.font = FONT_HEADER_RESUMO_NUMERICO;
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COR_HEADER_RESUMO_NUMERICO_BG } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    }

    const kmMedia = mediaCampo(linhas, (l) => l.km);
    const diasMedia = mediaCampo(linhas, (l) => l.diasEstoque);
    const entradaTotal = somaCampo(linhas, (l) => l.nfEntrada);
    const valorizaTotal = somaCampo(linhas, (l) => l.valoriza);
    const custoRealTotal = somaCampo(linhas, (l) => calcularDerivadosLinha(l).custoReal);
    const fipeTotal = somaCampo(linhas, (l) => l.valorFipe);
    const vendaTotal = somaCampo(linhas, (l) => l.valorVenda);
    const lucroBrutoTotal = somaCampo(linhas, (l) => calcularDerivadosLinha(l).lucroBruto);
    const despesaTotal = somaCampo(linhas, (l) => l.despesaGeral);
    const forplanTotal = somaCampo(linhas, (l) => l.forplan);
    const impostosTotal = somaCampo(linhas, (l) => l.impostos);
    const comissaoTotal = somaCampo(linhas, (l) => l.comissao);
    const admTotal = somaCampo(linhas, (l) => l.adm);
    const margemTotal = somaCampo(linhas, (l) => calcularDerivadosLinha(l).margemLiquida);

    const valorRow = ws.getRow(rValores);
    const escreverSoma = (col: number, result: number, fmt: string): void => {
      const letraCol = colLetter(col);
      const cell = valorRow.getCell(col);
      cell.value = { formula: `SUM(${letraCol}${rIni}:${letraCol}${rFim})`, result };
      cell.numFmt = fmt;
      cell.alignment = { horizontal: "right", vertical: "middle" };
      cell.font = FONT_DADO;
    };
    const escreverMedia = (col: number, result: number, fmt: string): void => {
      const letraCol = colLetter(col);
      const cell = valorRow.getCell(col);
      cell.value = { formula: `IFERROR(AVERAGE(${letraCol}${rIni}:${letraCol}${rFim}),0)`, result };
      cell.numFmt = fmt;
      cell.alignment = { horizontal: "right", vertical: "middle" };
      cell.font = FONT_DADO;
    };
    // Razão das somas (SUM/SUM), referenciando as próprias células de SOMA já escritas
    // nesta linha — mesmo padrão intra-linha usado nas colunas P/R/T/V/X/Z/AB por venda.
    const escreverPctDeSomas = (col: number, colNumerador: number, colDenominador: number, result: number | ""): void => {
      const letraNum = colLetter(colNumerador);
      const letraDen = colLetter(colDenominador);
      const cell = valorRow.getCell(col);
      cell.value = { formula: `IFERROR(${letraNum}${rValores}/${letraDen}${rValores},"")`, result };
      cell.numFmt = FMT_PERCENT;
      cell.alignment = { horizontal: "right", vertical: "middle" };
      cell.font = FONT_DADO;
    };

    escreverMedia(COL.I_KM, kmMedia, FMT_INT);
    escreverMedia(COL.J_DIAS, diasMedia, FMT_DECIMAL2);
    escreverSoma(COL.K_NF_ENTRADA, entradaTotal, FMT_MONEY);
    escreverSoma(COL.L_VALORIZA, valorizaTotal, FMT_MONEY);
    escreverSoma(COL.M_CUSTO_REAL, custoRealTotal, FMT_MONEY);
    escreverSoma(COL.N_VALOR_FIPE, fipeTotal, FMT_MONEY);
    escreverSoma(COL.O_VALOR_VENDA, vendaTotal, FMT_MONEY);
    escreverPctDeSomas(COL.P_PCT_FIPE, COL.O_VALOR_VENDA, COL.N_VALOR_FIPE, fipeTotal > 0 ? vendaTotal / fipeTotal : "");
    escreverSoma(COL.Q_LUCRO_BRUTO, lucroBrutoTotal, FMT_MONEY);
    escreverPctDeSomas(COL.R_PCT_LUCRO_BRUTO, COL.Q_LUCRO_BRUTO, COL.O_VALOR_VENDA, vendaTotal > 0 ? lucroBrutoTotal / vendaTotal : "");
    escreverSoma(COL.S_DESPESA_GERAL, despesaTotal, FMT_MONEY);
    escreverPctDeSomas(COL.T_PCT_DESPESA_GERAL, COL.S_DESPESA_GERAL, COL.O_VALOR_VENDA, vendaTotal > 0 ? despesaTotal / vendaTotal : "");
    escreverSoma(COL.U_FPLAN, forplanTotal, FMT_MONEY);
    escreverPctDeSomas(COL.V_PCT_FPLAN, COL.U_FPLAN, COL.O_VALOR_VENDA, vendaTotal > 0 ? forplanTotal / vendaTotal : "");
    escreverSoma(COL.W_IMPOSTOS, impostosTotal, FMT_MONEY);
    escreverPctDeSomas(COL.X_PCT_IMPOSTOS, COL.W_IMPOSTOS, COL.O_VALOR_VENDA, vendaTotal > 0 ? impostosTotal / vendaTotal : "");
    escreverSoma(COL.Y_COMISSAO, comissaoTotal, FMT_MONEY);
    escreverPctDeSomas(COL.Z_PCT_COMISSAO, COL.Y_COMISSAO, COL.O_VALOR_VENDA, vendaTotal > 0 ? comissaoTotal / vendaTotal : "");
    escreverSoma(COL.AA_MARGEM_LIQUIDA, margemTotal, FMT_MONEY);
    escreverPctDeSomas(COL.AB_PCT_MARGEM, COL.AA_MARGEM_LIQUIDA, COL.O_VALOR_VENDA, vendaTotal > 0 ? margemTotal / vendaTotal : "");
    escreverSoma(COL.AI_ADM, admTotal, FMT_MONEY);
    escreverPctDeSomas(COL.AJ_PCT_ADM, COL.AI_ADM, COL.O_VALOR_VENDA, vendaTotal > 0 ? admTotal / vendaTotal : "");

    aplicarBordaBloco(ws, rHeader, rValores, COL.B_SEQ, COL.AJ_PCT_ADM);

    // Vermelho de negativo em Lucro Bruto/Margem Líquida (valor + %) — mesma CF do resto
    // da aba. Offset de prioridade alto pra nunca colidir com as do bloco de dados acima.
    let prioridadeTotais = 1000;
    for (const col of [COL.Q_LUCRO_BRUTO, COL.R_PCT_LUCRO_BRUTO, COL.AA_MARGEM_LIQUIDA, COL.AB_PCT_MARGEM]) {
      condFormatNegativo(ws, `${colLetter(col)}${rValores}`, prioridadeTotais++);
    }
  }
}
