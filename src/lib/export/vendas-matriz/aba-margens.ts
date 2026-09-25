/**
 * VENDAS USADOS MATRIZ — renderer único das abas 4 (MARGENS, sem filtro — totais sobre a
 * aba 1 inteira), 5 (MARGENS VENDAS LOJISTAS, aba 2 filtrada por Lojista=SIM) e 6
 * (MARGENS VENDAS CLIENTES, aba 2 filtrada por Lojista=NÃO).
 *
 * Toda métrica é SUM/AVERAGE/COUNT (sem filtro) ou SUMIF/AVERAGEIF/COUNTIF (com filtro)
 * apontando pra aba de origem — nunca um total calculado em JS e colado como valor.
 * As % são fórmulas intra-aba (dividem a célula de total pela célula de Valor da Venda
 * já escrita acima, na mesma aba) — também são "fórmulas de verdade", só não precisam
 * cruzar de aba porque os dois lados já estão na mesma planilha.
 */

import type ExcelJS from "exceljs";
import type { LinhaVendaMatriz } from "./tipos";
import { calcularDerivadosLinha } from "./tipos";
import { COL, DATA_START_ROW, FMT_MONEY, FMT_PERCENT, FMT_INT, rangeEntreAbas } from "./colunas";

const COLOR_TITLE_BG = "FF374151";
const COLOR_TITLE_FG = "FFFFFFFF";
const LABEL_COL = COL.C_LOJA_ORIGEM;
const VALOR_COL = COL.D_DESCRICAO;
const PCT_COL = COL.E_COR;

export type FiltroLojistaMargens = "sim" | "nao" | undefined;

export type AbaMargensOpts = {
  titulo: string;
  /** Nome da aba de onde vêm os ranges (aba1 pra "sem filtro", aba2 pras filtradas). */
  nomeAbaFonte: string;
  /** Linhas da aba de origem — usadas só pra cachear o `result` de cada fórmula. */
  linhasFonte: LinhaVendaMatriz[];
  /** `undefined` = sem filtro (aba 4). "sim"/"nao" = filtra por Lojista (abas 5/6). */
  filtroLojista: FiltroLojistaMargens;
};

function subconjunto(linhas: LinhaVendaMatriz[], filtro: FiltroLojistaMargens): LinhaVendaMatriz[] {
  if (filtro === undefined) return linhas;
  const alvo = filtro === "sim";
  return linhas.filter((l) => l.lojista === alvo);
}

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

export function renderAbaMargens(ws: ExcelJS.Worksheet, opts: AbaMargensOpts): void {
  const { titulo, nomeAbaFonte, linhasFonte, filtroLojista } = opts;

  ws.getColumn(LABEL_COL).width = 30;
  ws.getColumn(VALOR_COL).width = 16;
  ws.getColumn(PCT_COL).width = 10;

  ws.mergeCells(1, LABEL_COL, 1, PCT_COL);
  const row1 = ws.getRow(1);
  row1.height = 24;
  const titleCell = row1.getCell(LABEL_COL);
  titleCell.value = titulo;
  titleCell.font = { bold: true, size: 13, color: { argb: COLOR_TITLE_FG } };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_TITLE_BG } };

  const ultimaLinhaFonte = DATA_START_ROW + linhasFonte.length - 1;
  const subset = subconjunto(linhasFonte, filtroLojista);

  const rangeFonte = (col: number): string => rangeEntreAbas(nomeAbaFonte, col, DATA_START_ROW, ultimaLinhaFonte);
  const rangeCriterio = rangeEntreAbas(nomeAbaFonte, COL.AF_LOJISTA, DATA_START_ROW, ultimaLinhaFonte);
  const criterioTxt = filtroLojista === "sim" ? "SIM" : "NÃO";

  // Fórmula de valor total: SUM/COUNT direto (aba4) ou SUMIF/COUNTIF por Lojista (abas 5/6).
  const fSum = (col: number): string =>
    filtroLojista === undefined
      ? `SUM(${rangeFonte(col)})`
      : `SUMIF(${rangeCriterio},"${criterioTxt}",${rangeFonte(col)})`;
  const fCount = (col: number): string =>
    filtroLojista === undefined ? `COUNTA(${rangeFonte(col)})` : `COUNTIF(${rangeCriterio},"${criterioTxt}")`;
  const fAvg = (col: number): string =>
    filtroLojista === undefined
      ? `IFERROR(AVERAGE(${rangeFonte(col)}),0)`
      : `IFERROR(AVERAGEIF(${rangeCriterio},"${criterioTxt}",${rangeFonte(col)}),0)`;

  let r = 3;
  const linha = (
    label: string,
    formula: string,
    result: number,
    fmt: string,
    opts2?: { comPct?: boolean; pctResult?: number | "" },
  ): number => {
    const row = ws.getRow(r);
    row.getCell(LABEL_COL).value = label;
    const valorCell = row.getCell(VALOR_COL);
    valorCell.value = { formula, result };
    valorCell.numFmt = fmt;
    valorCell.alignment = { horizontal: "right" };
    if (opts2?.comPct) {
      const pctCell = row.getCell(PCT_COL);
      pctCell.value = {
        formula: `IFERROR(${valorCell.address}/$D$3,"")`,
        result: opts2.pctResult ?? "",
      };
      pctCell.numFmt = FMT_PERCENT;
    }
    const linhaAtual = r;
    r++;
    return linhaAtual;
  };

  const valorVendaTotal = somaCampo(subset, (l) => l.valorVenda);
  const qtdeFaturados = subset.length;
  const kmMedia = mediaCampo(subset, (l) => l.km);
  const fipeTotal = somaCampo(subset, (l) => l.valorFipe);
  const custoRealTotal = somaCampo(subset, (l) => calcularDerivadosLinha(l).custoReal);
  const lucroBrutoTotal = somaCampo(subset, (l) => calcularDerivadosLinha(l).lucroBruto);
  const despesaGeralTotal = somaCampo(subset, (l) => l.despesaGeral);
  const forplanTotal = somaCampo(subset, (l) => l.forplan);
  const impostosTotal = somaCampo(subset, (l) => l.impostos);
  const comissaoTotal = somaCampo(subset, (l) => l.comissao);
  const margemLiquidaTotal = somaCampo(subset, (l) => calcularDerivadosLinha(l).margemLiquida);
  const diasEstoqueMedio = mediaCampo(subset, (l) => l.diasEstoque);

  const pct = (n: number): number | "" => (valorVendaTotal > 0 ? n / valorVendaTotal : "");

  const rValorVenda = linha("Valor da Venda", fSum(COL.O_VALOR_VENDA), valorVendaTotal, FMT_MONEY);
  linha("Qtde Faturados", fCount(COL.G_PLACA), qtdeFaturados, FMT_INT);

  // Ticket Médio — referência intra-aba (Valor da Venda / Qtde Faturados), evita
  // recalcular a mesma regra com AVERAGEIF (que trataria linha sem valor de venda
  // diferente de linha sem venda registrada).
  {
    const row = ws.getRow(r);
    row.getCell(LABEL_COL).value = "Ticket Médio";
    const cell = row.getCell(VALOR_COL);
    cell.value = { formula: `IFERROR(D${rValorVenda}/D${rValorVenda + 1},0)`, result: qtdeFaturados > 0 ? valorVendaTotal / qtdeFaturados : 0 };
    cell.numFmt = FMT_MONEY;
    cell.alignment = { horizontal: "right" };
    r++;
  }

  linha("KM Média", fAvg(COL.I_KM), kmMedia, FMT_INT);
  linha("FIPE Total", fSum(COL.N_VALOR_FIPE), fipeTotal, FMT_MONEY);
  linha("NF Entrada - Valoriza Total", fSum(COL.M_CUSTO_REAL), custoRealTotal, FMT_MONEY, { comPct: true, pctResult: pct(custoRealTotal) });
  linha("Lucro Bruto", fSum(COL.Q_LUCRO_BRUTO), lucroBrutoTotal, FMT_MONEY, { comPct: true, pctResult: pct(lucroBrutoTotal) });
  linha("Despesas Gerais", fSum(COL.S_DESPESA_GERAL), despesaGeralTotal, FMT_MONEY, { comPct: true, pctResult: pct(despesaGeralTotal) });
  linha("F Plan", fSum(COL.U_FPLAN), forplanTotal, FMT_MONEY, { comPct: true, pctResult: pct(forplanTotal) });
  linha("Impostos", fSum(COL.W_IMPOSTOS), impostosTotal, FMT_MONEY, { comPct: true, pctResult: pct(impostosTotal) });
  linha("Comissão", fSum(COL.Y_COMISSAO), comissaoTotal, FMT_MONEY, { comPct: true, pctResult: pct(comissaoTotal) });
  linha("Margem Líquida", fSum(COL.AA_MARGEM_LIQUIDA), margemLiquidaTotal, FMT_MONEY, { comPct: true, pctResult: pct(margemLiquidaTotal) });
  linha("Dias Estoque Médio", fAvg(COL.J_DIAS), diasEstoqueMedio, FMT_INT);
}
