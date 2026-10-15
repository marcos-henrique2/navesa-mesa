/**
 * VENDAS USADOS MATRIZ — aba 3 (RESUMO): 4 blocos lado a lado (horizontal), cada um um
 * pivot manual com seu próprio grupo de colunas e seu próprio eixo vertical (cada bloco
 * começa na linha 2, independente da altura dos outros).
 *
 * Mapa de colunas por bloco (cada bloco tem 1 coluna de "respiro"/gap à direita, exceto o D):
 * - Bloco A (VENDAS POR PÁTIO):          C/D/E   (3/4/5)
 * - Gap:                                  F       (6)
 * - Bloco B (VENDAS POR DIAS DE ESTOQUE): G/H/I   (7/8/9)
 * - Gap:                                  J       (10)
 * - Bloco C (VENDAS POR CANAL DE VENDAS): K/L/M   (11/12/13)
 * - Gap:                                  N       (14)
 * - Bloco D (VENDAS POR VENDEDOR):        O/P/Q/R/S (15/16/17/18/19) — label/qtde/%/lojista/%lojista
 *
 * As categorias (lojas, faixas de dias, canal de vendas, vendedores) são calculadas em JS
 * a partir das linhas da aba 1, mas cada contagem em si é uma fórmula COUNTIF/COUNTIFS de
 * verdade apontando pra aba 1 — nunca um número pré-calculado escrito direto.
 *
 * Decisões de "critério do autor" tomadas aqui (documentadas no handoff):
 * - Bloco B (dias de estoque) EXCLUI as linhas Auto Avaliar (venda de leilão não tem
 *   "tempo de pátio" com o mesmo sentido de uma venda normal) — a % de cada faixa é sobre
 *   o universo reduzido (só linhas não-Auto-Avaliar), não sobre as 82 totais.
 * - Blocos A, C e D usam como denominador da % o total de 82 linhas (COUNTA da aba 1) —
 *   incluindo Auto Avaliar como uma categoria própria nesses três.
 *
 * Estilo: cada um dos 4 blocos é tratado como banner nível 1 (navy, sem sub-blocos
 * aninhados) — mesmo tom usado no bloco "VENDIDO TOTAL" da aba MARGENS.
 */

import type ExcelJS from "exceljs";
import type { LinhaVendaMatriz } from "./tipos";
import { isAutoAvaliar, CRITERIO_AUTO_AVALIAR, CRITERIO_NAO_AUTO_AVALIAR } from "./tipos";
import { COL, DATA_START_ROW, FMT_PERCENT, escaparAspasFormula, rangeEntreAbas } from "./colunas";
import {
  FONT_DADO, FONT_HEADER_COLUNA, FONT_BANNER_N1, ALTURA_BANNER_N1,
  COR_BANNER_N1_BG, COR_HEADER_TABELA_BG,
  aplicarBordaBloco, aplicarFundoTotal, aplicarFundoDestaqueAmarelo, comVerticalMiddle,
} from "./estilo";

// Bloco A — VENDAS POR PÁTIO (3 colunas: label/qtde/%)
const A_LABEL = 3; // C
const A_QT = 4; // D
const A_PCT = 5; // E
// Gap: coluna F (6)

// Bloco B — VENDAS POR DIAS DE ESTOQUE (3 colunas: label/qtde/%)
const B_LABEL = 7; // G
const B_QT = 8; // H
const B_PCT = 9; // I
// Gap: coluna J (10)

// Bloco C — VENDAS POR CANAL DE VENDAS (3 colunas: label/qtde/%)
const C_LABEL = 11; // K
const C_QT = 12; // L
const C_PCT = 13; // M
// Gap: coluna N (14)

// Bloco D — VENDAS POR VENDEDOR (5 colunas: label/qtde/%/lojista/%lojista) — o mais largo
const D_LABEL = 15; // O
const D_QT = 16; // P
const D_PCT = 17; // Q
const D_LOJISTA = 18; // R
const D_LOJISTA_PCT = 19; // S

/** Linha inicial comum a todos os 4 blocos — cada um usa seu próprio eixo vertical a partir daqui. */
const LINHA_INICIAL = 2;

function fonteHeaderNegrito(cell: ExcelJS.Cell): void {
  cell.font = FONT_HEADER_COLUNA;
}

export type AbaResumoOpts = {
  nomeAba1: string;
  linhasAba1: LinhaVendaMatriz[];
  /** Nome do mês por extenso (ex: "AGOSTO") — pro título do bloco A. */
  nomeMes: string;
};

export function renderAbaResumo(ws: ExcelJS.Worksheet, opts: AbaResumoOpts): void {
  const { nomeAba1, linhasAba1, nomeMes } = opts;

  const configurarColunaDado = (col: number, width: number): void => {
    ws.getColumn(col).width = width;
    ws.getColumn(col).font = FONT_DADO;
  };

  ws.getColumn(COL.B_SEQ).width = 2;
  ws.getColumn(COL.B_SEQ).font = FONT_DADO;

  for (const [labelCol, qtCol, pctCol] of [
    [A_LABEL, A_QT, A_PCT],
    [B_LABEL, B_QT, B_PCT],
    [C_LABEL, C_QT, C_PCT],
    [D_LABEL, D_QT, D_PCT],
  ]) {
    configurarColunaDado(labelCol, 32);
    configurarColunaDado(qtCol, 12);
    configurarColunaDado(pctCol, 10);
  }
  configurarColunaDado(D_LOJISTA, 12);
  configurarColunaDado(D_LOJISTA_PCT, 10);

  // Colunas de respiro/gap entre blocos.
  ws.getColumn(6).width = 3;
  ws.getColumn(10).width = 3;
  ws.getColumn(14).width = 3;

  const ultimaLinhaAba1 = Math.max(DATA_START_ROW, DATA_START_ROW + linhasAba1.length - 1);
  const totalLinhas = linhasAba1.length;

  const rangeCol = (col: number): string => rangeEntreAbas(nomeAba1, col, DATA_START_ROW, ultimaLinhaAba1);
  const rangeLoja = rangeCol(COL.C_LOJA_ORIGEM);
  const rangeVendedor = rangeCol(COL.AG_VENDEDOR);
  const rangeLojista = rangeCol(COL.AF_LOJISTA);
  const rangeDias = rangeCol(COL.J_DIAS);
  const rangePlaca = rangeCol(COL.G_PLACA);
  const rangeConsignado = rangeCol(COL.AH_CONSIGNADO);
  const totalFormula = `COUNTA(${rangePlaca})`;

  /** Cada bloco tem seu próprio contador de linha, independente dos outros 3. */
  type RowRef = { r: number };

  const escreverBanner = (rowRef: RowRef, labelCol: number, ultimaColBanner: number, titulo: string): void => {
    const linha = rowRef.r;
    ws.mergeCells(linha, labelCol, linha, ultimaColBanner);
    const tituloCell = ws.getCell(linha, labelCol);
    tituloCell.value = titulo;
    tituloCell.font = FONT_BANNER_N1;
    tituloCell.alignment = { horizontal: "center", vertical: "middle" };
    tituloCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COR_BANNER_N1_BG } };
    ws.getRow(linha).height = ALTURA_BANNER_N1;
    rowRef.r++;
  };

  const escreverHeader = (rowRef: RowRef, colunas: { col: number; label: string }[]): void => {
    const headerRow = ws.getRow(rowRef.r);
    for (const { col, label } of colunas) {
      const cell = headerRow.getCell(col);
      cell.value = label;
      fonteHeaderNegrito(cell);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COR_HEADER_TABELA_BG } };
      cell.alignment = { vertical: "middle" };
    }
    rowRef.r++;
  };

  /** Escreve uma linha "categoria | qtde (fórmula) | % (fórmula)" — usado nos blocos A/B/C. Retorna a linha escrita. */
  const escreverLinhaContagem = (
    rowRef: RowRef,
    labelCol: number,
    qtCol: number,
    pctCol: number,
    label: string,
    formulaQtde: string,
    countResult: number,
    formulaDenominador: string,
    denominadorResult: number,
  ): number => {
    const row = ws.getRow(rowRef.r);
    const labelCell = row.getCell(labelCol);
    labelCell.value = label;
    comVerticalMiddle(labelCell);

    const qtdCell = row.getCell(qtCol);
    qtdCell.value = { formula: formulaQtde, result: countResult };
    comVerticalMiddle(qtdCell);

    const pctCell = row.getCell(pctCol);
    pctCell.value = {
      formula: `IFERROR(${qtdCell.address}/${formulaDenominador},"")`,
      result: denominadorResult > 0 ? countResult / denominadorResult : "",
    };
    pctCell.numFmt = FMT_PERCENT;
    comVerticalMiddle(pctCell);

    const linhaAtual = rowRef.r;
    rowRef.r++;
    return linhaAtual;
  };

  /** `semGapDepois` — pula as 2 linhas em branco finais (chamador insere mais linhas antes do gap, ex: Bloco A). */
  const escreverLinhaTotal = (
    rowRef: RowRef,
    labelCol: number,
    qtCol: number,
    pctCol: number,
    formulaQtde: string,
    result: number,
    opts?: { semGapDepois?: boolean },
  ): number => {
    const row = ws.getRow(rowRef.r);
    const labelCell = row.getCell(labelCol);
    labelCell.value = "TOTAL";
    aplicarFundoTotal(labelCell);
    comVerticalMiddle(labelCell);
    const qtdCell = row.getCell(qtCol);
    qtdCell.value = { formula: formulaQtde, result };
    aplicarFundoTotal(qtdCell);
    comVerticalMiddle(qtdCell);
    const pctCell = row.getCell(pctCol);
    pctCell.value = 1;
    pctCell.numFmt = FMT_PERCENT;
    aplicarFundoTotal(pctCell);
    comVerticalMiddle(pctCell);
    const linhaAtual = rowRef.r;
    rowRef.r++;
    if (!opts?.semGapDepois) rowRef.r += 2; // 2 linhas em branco antes do próximo bloco (vertical, dentro do próprio bloco)
    return linhaAtual;
  };

  // ═══════════════════════════════════════════════════════════════════════
  // Bloco A — VENDAS POR PÁTIO (loja de origem) + AUTO AVALIAR à parte
  // ═══════════════════════════════════════════════════════════════════════
  const rowRefA: RowRef = { r: LINHA_INICIAL };
  const linhaIniA = rowRefA.r;
  {
    escreverBanner(rowRefA, A_LABEL, A_PCT, `VENDAS EM ${nomeMes} NAVESA AEROPORTO (POR PÁTIO)`);
    escreverHeader(rowRefA, [
      { col: A_LABEL, label: "Pátio" },
      { col: A_QT, label: "Qtde" },
      { col: A_PCT, label: "%" },
    ]);

    const semAutoAvaliar = linhasAba1.filter((l) => !isAutoAvaliar(l));
    const lojas = [...new Set(semAutoAvaliar.map((l) => l.lojaOrigemNome).filter((n) => n.length > 0))].sort();

    for (const nomeLoja of lojas) {
      const count = semAutoAvaliar.filter((l) => l.lojaOrigemNome === nomeLoja).length;
      const criterio = escaparAspasFormula(nomeLoja);
      escreverLinhaContagem(
        rowRefA,
        A_LABEL,
        A_QT,
        A_PCT,
        nomeLoja,
        `COUNTIFS(${rangeLoja},"${criterio}",${rangeVendedor},"${CRITERIO_NAO_AUTO_AVALIAR}")`,
        count,
        totalFormula,
        totalLinhas,
      );
    }

    const countAutoAvaliar = linhasAba1.filter(isAutoAvaliar).length;
    escreverLinhaContagem(
      rowRefA,
      A_LABEL,
      A_QT,
      A_PCT,
      "AUTO AVALIAR",
      `COUNTIF(${rangeVendedor},"${CRITERIO_AUTO_AVALIAR}")`,
      countAutoAvaliar,
      totalFormula,
      totalLinhas,
    );

    escreverLinhaTotal(rowRefA, A_LABEL, A_QT, A_PCT, totalFormula, totalLinhas, { semGapDepois: true });

    // "TOTAL ... SEM CONSIGNADOS" — item pendente da reestilização (PR #25), destaque
    // amarelo vivo, igual ao relatório original (19.png de referência). Mesmo totalFormula
    // (todas as 103 linhas, incl. Auto Avaliar), só acrescenta o critério consignado="NÃO"
    // na coluna de apoio AH (ver colunas.ts/aba-detalhe.ts). Sem % (igual à imagem — a
    // linha de baixo não tem par "com"/"sem" de percentual, só a contagem).
    const linhaTotalSemConsignado = rowRefA.r;
    {
      const row = ws.getRow(rowRefA.r);
      const labelCell = row.getCell(A_LABEL);
      labelCell.value = "TOTAL CARROS FATURADOS SEM CONSIGNADOS";
      aplicarFundoDestaqueAmarelo(labelCell);
      comVerticalMiddle(labelCell);
      const qtdSemConsignado = linhasAba1.filter((l) => !l.consignado).length;
      const qtdCell = row.getCell(A_QT);
      qtdCell.value = { formula: `COUNTIF(${rangeConsignado},"NÃO")`, result: qtdSemConsignado };
      aplicarFundoDestaqueAmarelo(qtdCell);
      comVerticalMiddle(qtdCell);
      rowRefA.r++;
      rowRefA.r += 2; // 2 linhas em branco antes do próximo bloco
    }

    aplicarBordaBloco(ws, linhaIniA, linhaTotalSemConsignado, A_LABEL, A_PCT);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Bloco B — VENDAS POR DIAS DE ESTOQUE (exclui Auto Avaliar; % sobre o universo reduzido)
  // ═══════════════════════════════════════════════════════════════════════
  const rowRefB: RowRef = { r: LINHA_INICIAL };
  const linhaIniB = rowRefB.r;
  {
    escreverBanner(rowRefB, B_LABEL, B_PCT, "VENDAS POR DIAS DE ESTOQUE");
    escreverHeader(rowRefB, [
      { col: B_LABEL, label: "Faixa" },
      { col: B_QT, label: "Qtde" },
      { col: B_PCT, label: "%" },
    ]);

    // Exclui consignado também (item pendente da reestilização, PR #25) — o nome do bloco
    // no relatório original é "VENDAS POR DIAS DE ESTOQUE ... ( SEM CONSIGNADOS )"
    // (19.png de referência): "dias de pátio" não faz sentido pra consignado (o carro
    // nunca foi do estoque da revenda), mesmo raciocínio que já exclui Auto Avaliar aqui.
    const semAutoAvaliar = linhasAba1.filter((l) => !isAutoAvaliar(l) && l.diasEstoque != null && !l.consignado);
    const totalSemAuto = semAutoAvaliar.length;
    // Denominador precisa excluir linhas sem Dias preenchido (critério "<>") — senão os
    // numeradores das 3 faixas (que só contam linhas com diasEstoque != null) somam menos
    // de 100% do denominador quando o Excel recalcula.
    const denominadorFormula = `COUNTIFS(${rangeVendedor},"${CRITERIO_NAO_AUTO_AVALIAR}",${rangeDias},"<>",${rangeConsignado},"NÃO")`;

    const faixas: { label: string; min: number; max: number | null }[] = [
      { label: "0-30 dias", min: 0, max: 30 },
      { label: "31-60 dias", min: 31, max: 60 },
      { label: "61+ dias", min: 61, max: null },
    ];

    let linhaFimB = rowRefB.r;
    for (const faixa of faixas) {
      const count = semAutoAvaliar.filter(
        (l) => l.diasEstoque! >= faixa.min && (faixa.max === null || l.diasEstoque! <= faixa.max),
      ).length;
      const criteriosDias =
        faixa.max === null
          ? `${rangeDias},">=${faixa.min}"`
          : `${rangeDias},">=${faixa.min}",${rangeDias},"<=${faixa.max}"`;
      linhaFimB = escreverLinhaContagem(
        rowRefB,
        B_LABEL,
        B_QT,
        B_PCT,
        faixa.label,
        `COUNTIFS(${rangeVendedor},"${CRITERIO_NAO_AUTO_AVALIAR}",${rangeConsignado},"NÃO",${criteriosDias})`,
        count,
        denominadorFormula,
        totalSemAuto,
      );
    }
    aplicarBordaBloco(ws, linhaIniB, linhaFimB, B_LABEL, B_PCT);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Bloco C — VENDAS POR CANAL DE VENDAS (CLIENTE FINAL / LOJISTA / NÃO INFORMADO / AUTO AVALIAR)
  // ═══════════════════════════════════════════════════════════════════════
  const rowRefC: RowRef = { r: LINHA_INICIAL };
  const linhaIniC = rowRefC.r;
  {
    escreverBanner(rowRefC, C_LABEL, C_PCT, "VENDAS POR CANAL DE VENDAS");
    escreverHeader(rowRefC, [
      { col: C_LABEL, label: "Canal" },
      { col: C_QT, label: "Qtde" },
      { col: C_PCT, label: "%" },
    ]);

    const countClienteFinal = linhasAba1.filter((l) => l.lojista === false && !isAutoAvaliar(l)).length;
    const countLojista = linhasAba1.filter((l) => l.lojista === true && !isAutoAvaliar(l)).length;
    // `lojista === null` (tipo de cliente desconhecido, não é Auto Avaliar) precisa de
    // categoria própria — senão essas linhas não caem em CLIENTE FINAL (AF="NÃO") nem em
    // LOJISTA (AF="SIM") e o bloco não fecha 100% do total.
    const countNaoInformado = linhasAba1.filter((l) => l.lojista === null && !isAutoAvaliar(l)).length;
    const countAutoAvaliar = linhasAba1.filter(isAutoAvaliar).length;

    // Cliente final / Lojista — linhas normais, sem destaque de cor no rótulo (o
    // relatório original do Marcos não colore essas duas linhas; só o header navy do
    // bloco e o TOTAL final se destacam, como em todos os outros blocos do RESUMO).
    escreverLinhaContagem(
      rowRefC,
      C_LABEL,
      C_QT,
      C_PCT,
      "CLIENTE FINAL",
      `COUNTIFS(${rangeLojista},"NÃO",${rangeVendedor},"${CRITERIO_NAO_AUTO_AVALIAR}")`,
      countClienteFinal,
      totalFormula,
      totalLinhas,
    );

    escreverLinhaContagem(
      rowRefC,
      C_LABEL,
      C_QT,
      C_PCT,
      "LOJISTA",
      `COUNTIFS(${rangeLojista},"SIM",${rangeVendedor},"${CRITERIO_NAO_AUTO_AVALIAR}")`,
      countLojista,
      totalFormula,
      totalLinhas,
    );

    escreverLinhaContagem(
      rowRefC,
      C_LABEL,
      C_QT,
      C_PCT,
      "NÃO INFORMADO",
      `COUNTIFS(${rangeLojista},"",${rangeVendedor},"${CRITERIO_NAO_AUTO_AVALIAR}")`,
      countNaoInformado,
      totalFormula,
      totalLinhas,
    );
    escreverLinhaContagem(
      rowRefC,
      C_LABEL,
      C_QT,
      C_PCT,
      "AUTO AVALIAR",
      `COUNTIF(${rangeVendedor},"${CRITERIO_AUTO_AVALIAR}")`,
      countAutoAvaliar,
      totalFormula,
      totalLinhas,
    );

    const linhaTotalC = escreverLinhaTotal(rowRefC, C_LABEL, C_QT, C_PCT, totalFormula, totalLinhas);
    aplicarBordaBloco(ws, linhaIniC, linhaTotalC, C_LABEL, C_PCT);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Bloco D — VENDAS POR VENDEDOR (+ coluna Lojista) — MOZAINEL vira "AUTO AVALIAR"
  // ═══════════════════════════════════════════════════════════════════════
  const rowRefD: RowRef = { r: LINHA_INICIAL };
  const linhaIniD = rowRefD.r;
  {
    escreverBanner(rowRefD, D_LABEL, D_LOJISTA_PCT, "VENDAS POR VENDEDOR");
    escreverHeader(rowRefD, [
      { col: D_LABEL, label: "Vendedor" },
      { col: D_QT, label: "Qtde" },
      { col: D_PCT, label: "%" },
      { col: D_LOJISTA, label: "Lojista" },
      { col: D_LOJISTA_PCT, label: "%" },
    ]);

    const semAutoAvaliar = linhasAba1.filter((l) => !isAutoAvaliar(l));
    const vendedores = [...new Set(semAutoAvaliar.map((l) => l.vendedorNome ?? "").filter((n) => n.length > 0))].sort();

    const escreverLinhaVendedor = (label: string, criterioVendedorFormula: string, qtde: number, lojistaQtde: number): void => {
      const row = ws.getRow(rowRefD.r);
      const labelCell = row.getCell(D_LABEL);
      labelCell.value = label;
      comVerticalMiddle(labelCell);

      const qtdCell = row.getCell(D_QT);
      qtdCell.value = { formula: criterioVendedorFormula, result: qtde };
      comVerticalMiddle(qtdCell);

      const pctCell = row.getCell(D_PCT);
      pctCell.value = { formula: `IFERROR(${qtdCell.address}/${totalFormula},"")`, result: totalLinhas > 0 ? qtde / totalLinhas : "" };
      pctCell.numFmt = FMT_PERCENT;
      comVerticalMiddle(pctCell);

      const lojistaCell = row.getCell(D_LOJISTA);
      const criterioLojistaFormula =
        label === "AUTO AVALIAR"
          ? `COUNTIFS(${rangeVendedor},"${CRITERIO_AUTO_AVALIAR}",${rangeLojista},"SIM")`
          : `COUNTIFS(${rangeVendedor},"${escaparAspasFormula(label)}",${rangeLojista},"SIM")`;
      lojistaCell.value = { formula: criterioLojistaFormula, result: lojistaQtde };
      comVerticalMiddle(lojistaCell);

      const lojistaPctCell = row.getCell(D_LOJISTA_PCT);
      lojistaPctCell.value = { formula: `IFERROR(${lojistaCell.address}/${qtdCell.address},"")`, result: qtde > 0 ? lojistaQtde / qtde : "" };
      lojistaPctCell.numFmt = FMT_PERCENT;
      comVerticalMiddle(lojistaPctCell);

      rowRefD.r++;
    };

    for (const vendedor of vendedores) {
      const linhasVendedor = semAutoAvaliar.filter((l) => (l.vendedorNome ?? "") === vendedor);
      const qtde = linhasVendedor.length;
      const lojistaQtde = linhasVendedor.filter((l) => l.lojista === true).length;
      escreverLinhaVendedor(
        vendedor,
        `COUNTIF(${rangeVendedor},"${escaparAspasFormula(vendedor)}")`,
        qtde,
        lojistaQtde,
      );
    }

    // SUBTOTAL "TOTAL CARROS FATURADOS" — todos os vendedores humanos, ANTES da linha
    // Auto Avaliar (item pendente da reestilização, PR #25; 20.png de referência: mesmo
    // estilo bold navy do TOTAL final, não o amarelo das linhas "sem consignados"). %
    // sobre o total GERAL (todas as 103, incl. Auto Avaliar) — mesmo denominador que as
    // linhas de vendedor individuais usam logo acima.
    {
      const qtdeSemAuto = semAutoAvaliar.length;
      const lojistaSemAuto = semAutoAvaliar.filter((l) => l.lojista === true).length;
      const row = ws.getRow(rowRefD.r);
      const labelCell = row.getCell(D_LABEL);
      labelCell.value = "TOTAL CARROS FATURADOS";
      aplicarFundoTotal(labelCell);
      comVerticalMiddle(labelCell);
      const qtdCell = row.getCell(D_QT);
      qtdCell.value = { formula: `COUNTIF(${rangeVendedor},"${CRITERIO_NAO_AUTO_AVALIAR}")`, result: qtdeSemAuto };
      aplicarFundoTotal(qtdCell);
      comVerticalMiddle(qtdCell);
      const pctCell = row.getCell(D_PCT);
      pctCell.value = { formula: `IFERROR(${qtdCell.address}/${totalFormula},"")`, result: totalLinhas > 0 ? qtdeSemAuto / totalLinhas : "" };
      pctCell.numFmt = FMT_PERCENT;
      aplicarFundoTotal(pctCell);
      comVerticalMiddle(pctCell);
      const lojistaCell = row.getCell(D_LOJISTA);
      lojistaCell.value = {
        formula: `COUNTIFS(${rangeVendedor},"${CRITERIO_NAO_AUTO_AVALIAR}",${rangeLojista},"SIM")`,
        result: lojistaSemAuto,
      };
      aplicarFundoTotal(lojistaCell);
      comVerticalMiddle(lojistaCell);
      const lojistaPctCell = row.getCell(D_LOJISTA_PCT);
      lojistaPctCell.value = {
        formula: `IFERROR(${lojistaCell.address}/${qtdCell.address},"")`,
        result: qtdeSemAuto > 0 ? lojistaSemAuto / qtdeSemAuto : "",
      };
      lojistaPctCell.numFmt = FMT_PERCENT;
      aplicarFundoTotal(lojistaPctCell);
      comVerticalMiddle(lojistaPctCell);
      rowRefD.r++;
    }

    const linhasAutoAvaliar = linhasAba1.filter(isAutoAvaliar);
    const qtdeAuto = linhasAutoAvaliar.length;
    const lojistaAuto = linhasAutoAvaliar.filter((l) => l.lojista === true).length;
    escreverLinhaVendedor("AUTO AVALIAR", `COUNTIF(${rangeVendedor},"${CRITERIO_AUTO_AVALIAR}")`, qtdeAuto, lojistaAuto);

    // TOTAL — Qtde = todas as 82, Lojista = total lojista entre todas, % = lojista/qtde.
    const totalLojista = linhasAba1.filter((l) => l.lojista === true).length;
    const row = ws.getRow(rowRefD.r);
    const labelCell = row.getCell(D_LABEL);
    labelCell.value = "TOTAL";
    aplicarFundoTotal(labelCell);
    comVerticalMiddle(labelCell);
    const qtdCell = row.getCell(D_QT);
    qtdCell.value = { formula: totalFormula, result: totalLinhas };
    aplicarFundoTotal(qtdCell);
    comVerticalMiddle(qtdCell);
    const pctCell = row.getCell(D_PCT);
    pctCell.value = 1;
    pctCell.numFmt = FMT_PERCENT;
    aplicarFundoTotal(pctCell);
    comVerticalMiddle(pctCell);
    const lojistaCell = row.getCell(D_LOJISTA);
    lojistaCell.value = { formula: `COUNTIF(${rangeLojista},"SIM")`, result: totalLojista };
    aplicarFundoTotal(lojistaCell);
    comVerticalMiddle(lojistaCell);
    const lojistaPctCell = row.getCell(D_LOJISTA_PCT);
    lojistaPctCell.value = { formula: `IFERROR(${lojistaCell.address}/${qtdCell.address},"")`, result: totalLinhas > 0 ? totalLojista / totalLinhas : "" };
    lojistaPctCell.numFmt = FMT_PERCENT;
    aplicarFundoTotal(lojistaPctCell);
    comVerticalMiddle(lojistaPctCell);
    const linhaTotalD = rowRefD.r;
    rowRefD.r++;

    aplicarBordaBloco(ws, linhaIniD, linhaTotalD, D_LABEL, D_LOJISTA_PCT);
  }
}
