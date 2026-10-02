/**
 * VENDAS USADOS MATRIZ — aba 3 (RESUMO): 4 blocos empilhados, cada um um pivot manual.
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

const LABEL_COL = COL.C_LOJA_ORIGEM;
const QT_COL = COL.D_DESCRICAO;
const PCT_COL = COL.E_COR;
const LOJISTA_COL = COL.F_MARCA;
const LOJISTA_PCT_COL = COL.G_PLACA;

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

  ws.getColumn(COL.B_SEQ).width = 2;
  ws.getColumn(COL.B_SEQ).font = FONT_DADO;
  ws.getColumn(LABEL_COL).width = 32;
  ws.getColumn(LABEL_COL).font = FONT_DADO;
  ws.getColumn(QT_COL).width = 12;
  ws.getColumn(QT_COL).font = FONT_DADO;
  ws.getColumn(PCT_COL).width = 10;
  ws.getColumn(PCT_COL).font = FONT_DADO;
  ws.getColumn(LOJISTA_COL).width = 12;
  ws.getColumn(LOJISTA_COL).font = FONT_DADO;
  ws.getColumn(LOJISTA_PCT_COL).width = 10;
  ws.getColumn(LOJISTA_PCT_COL).font = FONT_DADO;

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

  let r = 2;

  const escreverBanner = (titulo: string, ultimaColBanner: number): void => {
    ws.mergeCells(r, LABEL_COL, r, ultimaColBanner);
    const tituloCell = ws.getCell(r, LABEL_COL);
    tituloCell.value = titulo;
    tituloCell.font = FONT_BANNER_N1;
    tituloCell.alignment = { horizontal: "center", vertical: "middle" };
    tituloCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COR_BANNER_N1_BG } };
    ws.getRow(r).height = ALTURA_BANNER_N1;
    r++;
  };

  const escreverHeader = (colunas: { col: number; label: string }[]): void => {
    const headerRow = ws.getRow(r);
    for (const { col, label } of colunas) {
      const cell = headerRow.getCell(col);
      cell.value = label;
      fonteHeaderNegrito(cell);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COR_HEADER_TABELA_BG } };
      cell.alignment = { vertical: "middle" };
    }
    r++;
  };

  /** Escreve uma linha "categoria | qtde (fórmula) | % (fórmula)" — usado nos blocos A/B/C. Retorna a linha escrita. */
  const escreverLinhaContagem = (
    label: string,
    formulaQtde: string,
    countResult: number,
    formulaDenominador: string,
    denominadorResult: number,
  ): number => {
    const row = ws.getRow(r);
    const labelCell = row.getCell(LABEL_COL);
    labelCell.value = label;
    comVerticalMiddle(labelCell);

    const qtdCell = row.getCell(QT_COL);
    qtdCell.value = { formula: formulaQtde, result: countResult };
    comVerticalMiddle(qtdCell);

    const pctCell = row.getCell(PCT_COL);
    pctCell.value = {
      formula: `IFERROR(${qtdCell.address}/${formulaDenominador},"")`,
      result: denominadorResult > 0 ? countResult / denominadorResult : "",
    };
    pctCell.numFmt = FMT_PERCENT;
    comVerticalMiddle(pctCell);

    const linhaAtual = r;
    r++;
    return linhaAtual;
  };

  /** `semGapDepois` — pula as 2 linhas em branco finais (chamador insere mais linhas antes do gap, ex: Bloco A). */
  const escreverLinhaTotal = (formulaQtde: string, result: number, opts?: { semGapDepois?: boolean }): number => {
    const row = ws.getRow(r);
    const labelCell = row.getCell(LABEL_COL);
    labelCell.value = "TOTAL";
    aplicarFundoTotal(labelCell);
    comVerticalMiddle(labelCell);
    const qtdCell = row.getCell(QT_COL);
    qtdCell.value = { formula: formulaQtde, result };
    aplicarFundoTotal(qtdCell);
    comVerticalMiddle(qtdCell);
    const pctCell = row.getCell(PCT_COL);
    pctCell.value = 1;
    pctCell.numFmt = FMT_PERCENT;
    aplicarFundoTotal(pctCell);
    comVerticalMiddle(pctCell);
    const linhaAtual = r;
    r++;
    if (!opts?.semGapDepois) r += 2; // 2 linhas em branco antes do próximo bloco
    return linhaAtual;
  };

  // ═══════════════════════════════════════════════════════════════════════
  // Bloco A — VENDAS POR PÁTIO (loja de origem) + AUTO AVALIAR à parte
  // ═══════════════════════════════════════════════════════════════════════
  const linhaIniA = r;
  {
    escreverBanner(`VENDAS EM ${nomeMes} NAVESA AEROPORTO (POR PÁTIO)`, PCT_COL);
    escreverHeader([
      { col: LABEL_COL, label: "Pátio" },
      { col: QT_COL, label: "Qtde" },
      { col: PCT_COL, label: "%" },
    ]);

    const semAutoAvaliar = linhasAba1.filter((l) => !isAutoAvaliar(l));
    const lojas = [...new Set(semAutoAvaliar.map((l) => l.lojaOrigemNome).filter((n) => n.length > 0))].sort();

    for (const nomeLoja of lojas) {
      const count = semAutoAvaliar.filter((l) => l.lojaOrigemNome === nomeLoja).length;
      const criterio = escaparAspasFormula(nomeLoja);
      escreverLinhaContagem(
        nomeLoja,
        `COUNTIFS(${rangeLoja},"${criterio}",${rangeVendedor},"${CRITERIO_NAO_AUTO_AVALIAR}")`,
        count,
        totalFormula,
        totalLinhas,
      );
    }

    const countAutoAvaliar = linhasAba1.filter(isAutoAvaliar).length;
    escreverLinhaContagem(
      "AUTO AVALIAR",
      `COUNTIF(${rangeVendedor},"${CRITERIO_AUTO_AVALIAR}")`,
      countAutoAvaliar,
      totalFormula,
      totalLinhas,
    );

    escreverLinhaTotal(totalFormula, totalLinhas, { semGapDepois: true });

    // "TOTAL ... SEM CONSIGNADOS" — item pendente da reestilização (PR #25), destaque
    // amarelo vivo, igual ao relatório original (19.png de referência). Mesmo totalFormula
    // (todas as 103 linhas, incl. Auto Avaliar), só acrescenta o critério consignado="NÃO"
    // na coluna de apoio AH (ver colunas.ts/aba-detalhe.ts). Sem % (igual à imagem — a
    // linha de baixo não tem par "com"/"sem" de percentual, só a contagem).
    const linhaTotalSemConsignado = r;
    {
      const row = ws.getRow(r);
      const labelCell = row.getCell(LABEL_COL);
      labelCell.value = "TOTAL CARROS FATURADOS SEM CONSIGNADOS";
      aplicarFundoDestaqueAmarelo(labelCell);
      comVerticalMiddle(labelCell);
      const qtdSemConsignado = linhasAba1.filter((l) => !l.consignado).length;
      const qtdCell = row.getCell(QT_COL);
      qtdCell.value = { formula: `COUNTIF(${rangeConsignado},"NÃO")`, result: qtdSemConsignado };
      aplicarFundoDestaqueAmarelo(qtdCell);
      comVerticalMiddle(qtdCell);
      r++;
      r += 2; // 2 linhas em branco antes do próximo bloco
    }

    aplicarBordaBloco(ws, linhaIniA, linhaTotalSemConsignado, LABEL_COL, PCT_COL);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Bloco B — VENDAS POR DIAS DE ESTOQUE (exclui Auto Avaliar; % sobre o universo reduzido)
  // ═══════════════════════════════════════════════════════════════════════
  const linhaIniB = r;
  {
    escreverBanner("VENDAS POR DIAS DE ESTOQUE", PCT_COL);
    escreverHeader([
      { col: LABEL_COL, label: "Faixa" },
      { col: QT_COL, label: "Qtde" },
      { col: PCT_COL, label: "%" },
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

    let linhaFimB = r;
    for (const faixa of faixas) {
      const count = semAutoAvaliar.filter(
        (l) => l.diasEstoque! >= faixa.min && (faixa.max === null || l.diasEstoque! <= faixa.max),
      ).length;
      const criteriosDias =
        faixa.max === null
          ? `${rangeDias},">=${faixa.min}"`
          : `${rangeDias},">=${faixa.min}",${rangeDias},"<=${faixa.max}"`;
      linhaFimB = escreverLinhaContagem(
        faixa.label,
        `COUNTIFS(${rangeVendedor},"${CRITERIO_NAO_AUTO_AVALIAR}",${rangeConsignado},"NÃO",${criteriosDias})`,
        count,
        denominadorFormula,
        totalSemAuto,
      );
    }
    aplicarBordaBloco(ws, linhaIniB, linhaFimB, LABEL_COL, PCT_COL);
  }
  r += 2;

  // ═══════════════════════════════════════════════════════════════════════
  // Bloco C — VENDAS POR CANAL DE VENDAS (CLIENTE FINAL / LOJISTA / NÃO INFORMADO / AUTO AVALIAR)
  // ═══════════════════════════════════════════════════════════════════════
  const linhaIniC = r;
  {
    escreverBanner("VENDAS POR CANAL DE VENDAS", PCT_COL);
    escreverHeader([
      { col: LABEL_COL, label: "Canal" },
      { col: QT_COL, label: "Qtde" },
      { col: PCT_COL, label: "%" },
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
      "CLIENTE FINAL",
      `COUNTIFS(${rangeLojista},"NÃO",${rangeVendedor},"${CRITERIO_NAO_AUTO_AVALIAR}")`,
      countClienteFinal,
      totalFormula,
      totalLinhas,
    );

    escreverLinhaContagem(
      "LOJISTA",
      `COUNTIFS(${rangeLojista},"SIM",${rangeVendedor},"${CRITERIO_NAO_AUTO_AVALIAR}")`,
      countLojista,
      totalFormula,
      totalLinhas,
    );

    escreverLinhaContagem(
      "NÃO INFORMADO",
      `COUNTIFS(${rangeLojista},"",${rangeVendedor},"${CRITERIO_NAO_AUTO_AVALIAR}")`,
      countNaoInformado,
      totalFormula,
      totalLinhas,
    );
    escreverLinhaContagem(
      "AUTO AVALIAR",
      `COUNTIF(${rangeVendedor},"${CRITERIO_AUTO_AVALIAR}")`,
      countAutoAvaliar,
      totalFormula,
      totalLinhas,
    );

    const linhaTotalC = escreverLinhaTotal(totalFormula, totalLinhas);
    aplicarBordaBloco(ws, linhaIniC, linhaTotalC, LABEL_COL, PCT_COL);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Bloco D — VENDAS POR VENDEDOR (+ coluna Lojista) — MOZAINEL vira "AUTO AVALIAR"
  // ═══════════════════════════════════════════════════════════════════════
  const linhaIniD = r;
  {
    escreverBanner("VENDAS POR VENDEDOR", LOJISTA_PCT_COL);
    escreverHeader([
      { col: LABEL_COL, label: "Vendedor" },
      { col: QT_COL, label: "Qtde" },
      { col: PCT_COL, label: "%" },
      { col: LOJISTA_COL, label: "Lojista" },
      { col: LOJISTA_PCT_COL, label: "%" },
    ]);

    const semAutoAvaliar = linhasAba1.filter((l) => !isAutoAvaliar(l));
    const vendedores = [...new Set(semAutoAvaliar.map((l) => l.vendedorNome ?? "").filter((n) => n.length > 0))].sort();

    const escreverLinhaVendedor = (label: string, criterioVendedorFormula: string, qtde: number, lojistaQtde: number): void => {
      const row = ws.getRow(r);
      const labelCell = row.getCell(LABEL_COL);
      labelCell.value = label;
      comVerticalMiddle(labelCell);

      const qtdCell = row.getCell(QT_COL);
      qtdCell.value = { formula: criterioVendedorFormula, result: qtde };
      comVerticalMiddle(qtdCell);

      const pctCell = row.getCell(PCT_COL);
      pctCell.value = { formula: `IFERROR(${qtdCell.address}/${totalFormula},"")`, result: totalLinhas > 0 ? qtde / totalLinhas : "" };
      pctCell.numFmt = FMT_PERCENT;
      comVerticalMiddle(pctCell);

      const lojistaCell = row.getCell(LOJISTA_COL);
      const criterioLojistaFormula =
        label === "AUTO AVALIAR"
          ? `COUNTIFS(${rangeVendedor},"${CRITERIO_AUTO_AVALIAR}",${rangeLojista},"SIM")`
          : `COUNTIFS(${rangeVendedor},"${escaparAspasFormula(label)}",${rangeLojista},"SIM")`;
      lojistaCell.value = { formula: criterioLojistaFormula, result: lojistaQtde };
      comVerticalMiddle(lojistaCell);

      const lojistaPctCell = row.getCell(LOJISTA_PCT_COL);
      lojistaPctCell.value = { formula: `IFERROR(${lojistaCell.address}/${qtdCell.address},"")`, result: qtde > 0 ? lojistaQtde / qtde : "" };
      lojistaPctCell.numFmt = FMT_PERCENT;
      comVerticalMiddle(lojistaPctCell);

      r++;
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
      const row = ws.getRow(r);
      const labelCell = row.getCell(LABEL_COL);
      labelCell.value = "TOTAL CARROS FATURADOS";
      aplicarFundoTotal(labelCell);
      comVerticalMiddle(labelCell);
      const qtdCell = row.getCell(QT_COL);
      qtdCell.value = { formula: `COUNTIF(${rangeVendedor},"${CRITERIO_NAO_AUTO_AVALIAR}")`, result: qtdeSemAuto };
      aplicarFundoTotal(qtdCell);
      comVerticalMiddle(qtdCell);
      const pctCell = row.getCell(PCT_COL);
      pctCell.value = { formula: `IFERROR(${qtdCell.address}/${totalFormula},"")`, result: totalLinhas > 0 ? qtdeSemAuto / totalLinhas : "" };
      pctCell.numFmt = FMT_PERCENT;
      aplicarFundoTotal(pctCell);
      comVerticalMiddle(pctCell);
      const lojistaCell = row.getCell(LOJISTA_COL);
      lojistaCell.value = {
        formula: `COUNTIFS(${rangeVendedor},"${CRITERIO_NAO_AUTO_AVALIAR}",${rangeLojista},"SIM")`,
        result: lojistaSemAuto,
      };
      aplicarFundoTotal(lojistaCell);
      comVerticalMiddle(lojistaCell);
      const lojistaPctCell = row.getCell(LOJISTA_PCT_COL);
      lojistaPctCell.value = {
        formula: `IFERROR(${lojistaCell.address}/${qtdCell.address},"")`,
        result: qtdeSemAuto > 0 ? lojistaSemAuto / qtdeSemAuto : "",
      };
      lojistaPctCell.numFmt = FMT_PERCENT;
      aplicarFundoTotal(lojistaPctCell);
      comVerticalMiddle(lojistaPctCell);
      r++;
    }

    const linhasAutoAvaliar = linhasAba1.filter(isAutoAvaliar);
    const qtdeAuto = linhasAutoAvaliar.length;
    const lojistaAuto = linhasAutoAvaliar.filter((l) => l.lojista === true).length;
    escreverLinhaVendedor("AUTO AVALIAR", `COUNTIF(${rangeVendedor},"${CRITERIO_AUTO_AVALIAR}")`, qtdeAuto, lojistaAuto);

    // TOTAL — Qtde = todas as 82, Lojista = total lojista entre todas, % = lojista/qtde.
    const totalLojista = linhasAba1.filter((l) => l.lojista === true).length;
    const row = ws.getRow(r);
    const labelCell = row.getCell(LABEL_COL);
    labelCell.value = "TOTAL";
    aplicarFundoTotal(labelCell);
    comVerticalMiddle(labelCell);
    const qtdCell = row.getCell(QT_COL);
    qtdCell.value = { formula: totalFormula, result: totalLinhas };
    aplicarFundoTotal(qtdCell);
    comVerticalMiddle(qtdCell);
    const pctCell = row.getCell(PCT_COL);
    pctCell.value = 1;
    pctCell.numFmt = FMT_PERCENT;
    aplicarFundoTotal(pctCell);
    comVerticalMiddle(pctCell);
    const lojistaCell = row.getCell(LOJISTA_COL);
    lojistaCell.value = { formula: `COUNTIF(${rangeLojista},"SIM")`, result: totalLojista };
    aplicarFundoTotal(lojistaCell);
    comVerticalMiddle(lojistaCell);
    const lojistaPctCell = row.getCell(LOJISTA_PCT_COL);
    lojistaPctCell.value = { formula: `IFERROR(${lojistaCell.address}/${qtdCell.address},"")`, result: totalLinhas > 0 ? totalLojista / totalLinhas : "" };
    lojistaPctCell.numFmt = FMT_PERCENT;
    aplicarFundoTotal(lojistaPctCell);
    comVerticalMiddle(lojistaPctCell);
    const linhaTotalD = r;
    r++;

    aplicarBordaBloco(ws, linhaIniD, linhaTotalD, LABEL_COL, LOJISTA_PCT_COL);
  }
}
