/**
 * VENDAS USADOS MATRIZ — renderer das abas 4 (MARGENS), 5 (MARGENS VENDAS LOJISTAS) e 6
 * (MARGENS VENDAS CLIENTES). Cada aba desenha uma LISTA de blocos empilhados (um banner
 * colorido + o mesmo layout de métricas por bloco), não um bloco único.
 *
 * Toda métrica é SUM/AVERAGE/COUNTA (sem filtro) ou SUMIFS/AVERAGEIFS/COUNTIFS (com um ou
 * mais critérios) apontando pra aba de origem — nunca um total calculado em JS e colado
 * como valor. As % são fórmulas intra-aba (dividem a célula de total pela célula de Valor
 * da Venda já escrita acima, na mesma aba).
 *
 * Filtro por DOIS critérios calculados em JS ao mesmo tempo (ex: Lojista E Loja de
 * Origem) não precisa de coluna auxiliar nova — SUMIFS/COUNTIFS/AVERAGEIFS aceitam vários
 * pares (coluna, critério) direto contra as colunas que já existem na aba de detalhe
 * (AF = Lojista, C = Loja de Origem comparando com o nome da loja própria).
 */

import type ExcelJS from "exceljs";
import type { LinhaVendaMatriz } from "./tipos";
import { calcularDerivadosLinha } from "./tipos";
import {
  COL, DATA_START_ROW, FMT_MONEY, FMT_PERCENT, FMT_INT, colLetter,
  rangeEntreAbas, escaparAspasFormula,
} from "./colunas";
import {
  FONT_DADO, FONT_BANNER_N1, FONT_BANNER_N2, ALTURA_BANNER_N1, ALTURA_BANNER_N2, MARCADOR_N2,
  aplicarBordaBloco, comVerticalMiddle, condFormatNegativoSobrio,
} from "./estilo";

const LABEL_COL = COL.C_LOJA_ORIGEM;
const VALOR_COL = COL.D_DESCRICAO;
const PCT_COL = COL.E_COR;

/** Um par (coluna, critério) pra SUMIFS/COUNTIFS/AVERAGEIFS contra a aba fonte. */
export type CriterioMargens = { col: number; criterio: string };

export type BlocoMargensOpts = {
  titulo: string;
  /** Nível visual do banner — 1 = título principal (navy), 2 = sub-bloco (marcado com "▪"). */
  nivel: 1 | 2;
  /** Cor ARGB do banner (ex: COR_PROPRIO_BG). */
  corBg: string;
  /** Cor ARGB do texto do banner — default branco (herdado da fonte do nível). */
  corFg?: string;
  /** Subconjunto já filtrado em JS (mesmo critério de `criterios`) — só pra cachear o `result` de cada fórmula. */
  linhas: LinhaVendaMatriz[];
  /** Pares (coluna, critério) que reproduzem o filtro de `linhas` em Excel. `[]` = sem filtro (SUM/COUNTA/AVERAGE). */
  criterios: CriterioMargens[];
};

export type AbaMargensOpts = {
  /** Nome da aba de onde vêm os ranges (sempre a aba de detalhe correspondente). */
  nomeAbaFonte: string;
  /** Total de linhas de dados na aba fonte — define o range fixo usado por TODOS os blocos. */
  totalLinhasFonte: number;
  /** Blocos desenhados em sequência, um embaixo do outro. */
  blocos: BlocoMargensOpts[];
};

function somaCampo(linhas: LinhaVendaMatriz[], campo: (l: LinhaVendaMatriz) => number | null): number {
  let total = 0;
  for (const l of linhas) {
    const v = campo(l);
    if (v != null) total += v;
  }
  return total;
}

function mediaCampo(linhas: LinhaVendaMatriz[], campo: (l: LinhaVendaMatriz) => number | null): number {
  const valores = linhas.map(campo).filter((v): v is number => v != null);
  if (valores.length === 0) return 0;
  return valores.reduce((s, v) => s + v, 0) / valores.length;
}

/** Contador de prioridade de conditional formatting compartilhado por toda a aba (worksheet). */
type CfContador = { proxima: number };

export function renderAbaMargens(ws: ExcelJS.Worksheet, opts: AbaMargensOpts): void {
  const { nomeAbaFonte, totalLinhasFonte, blocos } = opts;

  ws.getColumn(LABEL_COL).width = 30;
  ws.getColumn(LABEL_COL).font = FONT_DADO;
  ws.getColumn(VALOR_COL).width = 16;
  ws.getColumn(VALOR_COL).font = FONT_DADO;
  ws.getColumn(PCT_COL).width = 10;
  ws.getColumn(PCT_COL).font = FONT_DADO;

  const cf: CfContador = { proxima: 1 };
  let r = 1;
  for (const bloco of blocos) {
    r = renderBloco(ws, r, nomeAbaFonte, totalLinhasFonte, bloco, cf);
  }
}

function renderBloco(
  ws: ExcelJS.Worksheet,
  rowInicial: number,
  nomeAbaFonte: string,
  totalLinhasFonte: number,
  bloco: BlocoMargensOpts,
  cf: CfContador,
): number {
  let r = rowInicial;
  const linhaBanner = r;
  const ultimaLinhaFonte = Math.max(DATA_START_ROW, DATA_START_ROW + totalLinhasFonte - 1);

  ws.mergeCells(r, LABEL_COL, r, PCT_COL);
  const rowTitulo = ws.getRow(r);
  rowTitulo.height = bloco.nivel === 1 ? ALTURA_BANNER_N1 : ALTURA_BANNER_N2;
  const titleCell = rowTitulo.getCell(LABEL_COL);
  titleCell.value = bloco.nivel === 2 ? `${MARCADOR_N2}${bloco.titulo}` : bloco.titulo;
  const fonteBase = bloco.nivel === 1 ? FONT_BANNER_N1 : FONT_BANNER_N2;
  titleCell.font = bloco.corFg ? { ...fonteBase, color: { argb: bloco.corFg } } : fonteBase;
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bloco.corBg } };
  r += 2; // banner + 1 linha em branco

  const rangeAlvo = (col: number): string => rangeEntreAbas(nomeAbaFonte, col, DATA_START_ROW, ultimaLinhaFonte);
  const paresCriterios = (): string =>
    bloco.criterios
      .map((c) => `${rangeAlvo(c.col)},"${escaparAspasFormula(c.criterio)}"`)
      .join(",");

  const fSum = (col: number): string =>
    bloco.criterios.length === 0 ? `SUM(${rangeAlvo(col)})` : `SUMIFS(${rangeAlvo(col)},${paresCriterios()})`;
  const fCount = (): string =>
    bloco.criterios.length === 0 ? `COUNTA(${rangeAlvo(COL.G_PLACA)})` : `COUNTIFS(${paresCriterios()})`;
  const fAvg = (col: number): string =>
    bloco.criterios.length === 0
      ? `IFERROR(AVERAGE(${rangeAlvo(col)}),0)`
      : `IFERROR(AVERAGEIFS(${rangeAlvo(col)},${paresCriterios()}),0)`;

  const linha = (
    label: string,
    formula: string,
    result: number,
    fmt: string,
    opts2?: { comPct?: boolean; pctResult?: number | ""; pctFmt?: string },
  ): number => {
    const row = ws.getRow(r);
    const labelCell = row.getCell(LABEL_COL);
    labelCell.value = label;
    comVerticalMiddle(labelCell);
    const valorCell = row.getCell(VALOR_COL);
    valorCell.value = { formula, result };
    valorCell.numFmt = fmt;
    valorCell.alignment = { horizontal: "right", vertical: "middle" };
    if (opts2?.comPct) {
      const pctCell = row.getCell(PCT_COL);
      pctCell.value = {
        formula: `IFERROR(${valorCell.address}/$D$${rValorVenda},"")`,
        result: opts2.pctResult ?? "",
      };
      pctCell.numFmt = opts2.pctFmt ?? FMT_PERCENT;
      comVerticalMiddle(pctCell);
    }
    const linhaAtual = r;
    r++;
    return linhaAtual;
  };

  const { linhas } = bloco;
  const valorVendaTotal = somaCampo(linhas, (l) => l.valorVenda);
  const qtdeFaturados = linhas.length;
  const kmMedia = mediaCampo(linhas, (l) => l.km);
  const fipeTotal = somaCampo(linhas, (l) => l.valorFipe);
  const custoRealTotal = somaCampo(linhas, (l) => calcularDerivadosLinha(l).custoReal);
  const lucroBrutoTotal = somaCampo(linhas, (l) => calcularDerivadosLinha(l).lucroBruto);
  const despesaGeralTotal = somaCampo(linhas, (l) => l.despesaGeral);
  const forplanTotal = somaCampo(linhas, (l) => l.forplan);
  const impostosTotal = somaCampo(linhas, (l) => l.impostos);
  const comissaoTotal = somaCampo(linhas, (l) => l.comissao);
  const margemLiquidaTotal = somaCampo(linhas, (l) => calcularDerivadosLinha(l).margemLiquida);
  const diasEstoqueMedio = mediaCampo(linhas, (l) => l.diasEstoque);

  const pct = (n: number): number | "" => (valorVendaTotal > 0 ? n / valorVendaTotal : "");

  const rValorVenda = r; // linha do "Valor da Venda" — referência fixa pra todas as % do bloco
  linha("Valor da Venda", fSum(COL.O_VALOR_VENDA), valorVendaTotal, FMT_MONEY);
  linha("Qtde Faturados", fCount(), qtdeFaturados, FMT_INT);

  // Ticket Médio — referência intra-aba (Valor da Venda / Qtde Faturados), evita
  // recalcular a mesma regra com AVERAGEIFS (que trataria linha sem valor de venda
  // diferente de linha sem venda registrada).
  {
    const row = ws.getRow(r);
    const labelCell = row.getCell(LABEL_COL);
    labelCell.value = "Ticket Médio";
    comVerticalMiddle(labelCell);
    const cell = row.getCell(VALOR_COL);
    cell.value = { formula: `IFERROR(D${rValorVenda}/D${rValorVenda + 1},0)`, result: qtdeFaturados > 0 ? valorVendaTotal / qtdeFaturados : 0 };
    cell.numFmt = FMT_MONEY;
    cell.alignment = { horizontal: "right", vertical: "middle" };
    r++;
  }

  linha("KM Média", fAvg(COL.I_KM), kmMedia, FMT_INT);
  linha("FIPE Total", fSum(COL.N_VALOR_FIPE), fipeTotal, FMT_MONEY);
  linha("NF Entrada - Valoriza Total", fSum(COL.M_CUSTO_REAL), custoRealTotal, FMT_MONEY, { comPct: true, pctResult: pct(custoRealTotal) });
  const rLucroBruto = linha("Lucro Bruto", fSum(COL.Q_LUCRO_BRUTO), lucroBrutoTotal, FMT_MONEY, { comPct: true, pctResult: pct(lucroBrutoTotal) });
  linha("Despesas Gerais", fSum(COL.S_DESPESA_GERAL), despesaGeralTotal, FMT_MONEY, { comPct: true, pctResult: pct(despesaGeralTotal) });
  linha("F Plan", fSum(COL.U_FPLAN), forplanTotal, FMT_MONEY, { comPct: true, pctResult: pct(forplanTotal) });
  linha("Impostos", fSum(COL.W_IMPOSTOS), impostosTotal, FMT_MONEY, { comPct: true, pctResult: pct(impostosTotal) });
  linha("Comissão", fSum(COL.Y_COMISSAO), comissaoTotal, FMT_MONEY, { comPct: true, pctResult: pct(comissaoTotal) });
  const rMargemLiquida = linha("Margem Líquida", fSum(COL.AA_MARGEM_LIQUIDA), margemLiquidaTotal, FMT_MONEY, { comPct: true, pctResult: pct(margemLiquidaTotal) });
  linha("Dias Estoque Médio", fAvg(COL.J_DIAS), diasEstoqueMedio, FMT_INT);

  // Vermelho sóbrio de negativo em Lucro Bruto/Margem Líquida (valor + %) — conditional
  // formatting de verdade, não seção `[Red]` do numFmt (ver nota em estilo.ts).
  const letraValor = colLetter(VALOR_COL);
  const letraPct = colLetter(PCT_COL);
  condFormatNegativoSobrio(ws, `${letraValor}${rLucroBruto}`, cf.proxima++);
  condFormatNegativoSobrio(ws, `${letraPct}${rLucroBruto}`, cf.proxima++);
  condFormatNegativoSobrio(ws, `${letraValor}${rMargemLiquida}`, cf.proxima++);
  condFormatNegativoSobrio(ws, `${letraPct}${rMargemLiquida}`, cf.proxima++);

  // Borda grossa navy contornando o bloco por fora (banner + linhas de métrica).
  aplicarBordaBloco(ws, linhaBanner, r - 1, LABEL_COL, PCT_COL);

  return r + 2; // 2 linhas em branco antes do próximo bloco
}
