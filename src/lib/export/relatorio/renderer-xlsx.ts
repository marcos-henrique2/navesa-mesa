/**
 * RENDERER XLSX DO MOTOR GENÉRICO
 *
 * Consome a saída pura de `montarRelatorio` (`RelatorioMontado`) e produz o XLSX
 * no mesmo espírito visual do relatório de estoque customizado atual (título
 * NAVESA, linha de meta, header colorido, frozen 3 linhas, zebra, bordas,
 * AutoFilter, larguras por formato), acrescentando as linhas TOTAIS/MÉDIA no fim.
 *
 * Arredondamento acontece SÓ aqui, na exibição (numFmt). Os valores gravados na
 * célula são os CRUS vindos do motor — preserva a precisão centavo-perfect.
 */

import ExcelJS from "exceljs";
import type { ColunaFormato, ValorColuna } from "@/lib/export/relatorio/tipos";
import type {
  ColunaResolvida,
  LinhaAgregacao,
  RelatorioMontado,
} from "@/lib/export/relatorio/motor";

/** Metadados de apresentação (o que o motor não sabe: título/subtítulo/aba). */
export type RenderMetaXLSX = {
  sheetName: string;
  titulo: string;
  linhaMeta: string;
};

const COLOR = {
  titleBg: "FF1E40AF",
  titleFg: "FFFFFFFF",
  metaBg: "FFF3F4F6",
  headerBg: "FFE5E7EB",
  zebraBg: "FFFAFAFA",
  borderGray: "FFD1D5DB",
  brancoBg: "FFFFFBEB",
  totalBg: "FFDBEAFE",
} as const;

const FMT_KM = '#,##0" km"';
const FMT_INT = "#,##0";
const FMT_MONEY_INT = '"R$ "#,##0';
const FMT_PCT = '0.0"%"';

const LARGURA_PADRAO: Record<ColunaFormato, number> = {
  texto: 24,
  numero: 16,
  moeda: 19,
  km: 16,
  ano: 12,
  percentual: 14,
  data: 16,
};
const LARGURA_BRANCO = 54;

function thinBorder(): ExcelJS.Borders {
  const side: Partial<ExcelJS.Border> = { style: "thin", color: { argb: COLOR.borderGray } };
  return { top: side, bottom: side, left: side, right: side, diagonal: { up: false, down: false } } as ExcelJS.Borders;
}

function numFmtPara(formato: ColunaFormato): string | undefined {
  switch (formato) {
    case "moeda":
      return FMT_MONEY_INT;
    case "km":
      return FMT_KM;
    case "numero":
      return FMT_INT;
    case "percentual":
      return FMT_PCT;
    default:
      return undefined;
  }
}

function alinhamentoPara(formato: ColunaFormato): Partial<ExcelJS.Alignment> {
  if (formato === "moeda" || formato === "km" || formato === "numero" || formato === "percentual") {
    return { horizontal: "right", vertical: "middle", indent: 1 };
  }
  if (formato === "ano") return { horizontal: "center", vertical: "middle" };
  return { horizontal: "left", vertical: "middle", indent: 1 };
}

const MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function bufferParaBlob(buf: unknown): Blob {
  if (buf instanceof ArrayBuffer) return new Blob([buf], { type: MIME });
  if (buf instanceof Uint8Array) {
    const copy = new ArrayBuffer(buf.byteLength);
    new Uint8Array(copy).set(buf);
    return new Blob([copy], { type: MIME });
  }
  throw new Error("ExcelJS writeBuffer não retornou ArrayBuffer/Uint8Array");
}

/** Aplica valor + numFmt numa célula de DADO (null → travessão, igual ao atual). */
function preencherCelulaDado(
  cell: ExcelJS.Cell,
  valor: ValorColuna,
  formato: ColunaFormato,
): void {
  if (valor == null) {
    cell.value = "—";
    return;
  }
  cell.value = valor;
  const fmt = numFmtPara(formato);
  if (fmt != null && typeof valor === "number") cell.numFmt = fmt;
}

export function renderRelatorioXLSX(montado: RelatorioMontado, meta: RenderMetaXLSX): Promise<Blob> {
  const { colunas, linhas, totais, media } = montado;
  const colCount = Math.max(colunas.length, 1);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Navesa Mesa";
  workbook.created = new Date();
  const ws = workbook.addWorksheet(meta.sheetName);

  ws.pageSetup = {
    paperSize: 9,
    orientation: "landscape",
    horizontalCentered: true,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.59, right: 0.59, top: 0.59, bottom: 0.59, header: 0.3, footer: 0.3 },
    printTitlesRow: "1:3",
  };
  ws.views = [{ state: "frozen", ySplit: 3 }];

  // ─── Larguras ───
  colunas.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.branco ? LARGURA_BRANCO : LARGURA_PADRAO[c.formato];
  });

  // ─── Linha 1: título ───
  ws.mergeCells(1, 1, 1, colCount);
  const row1 = ws.getRow(1);
  row1.height = 36;
  const titleCell = row1.getCell(1);
  titleCell.value = meta.titulo;
  titleCell.font = { bold: true, size: 18, color: { argb: COLOR.titleFg } };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.titleBg } };

  // ─── Linha 2: meta ───
  const row2 = ws.getRow(2);
  row2.height = 26;
  ws.mergeCells(2, 1, 2, colCount);
  const metaCell = row2.getCell(1);
  metaCell.value = meta.linhaMeta;
  metaCell.font = { size: 14, bold: true };
  metaCell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
  metaCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.metaBg } };

  // ─── Linha 3: header ───
  const row3 = ws.getRow(3);
  row3.height = 34;
  colunas.forEach((c, i) => {
    const cell = row3.getCell(i + 1);
    cell.value = c.label;
    cell.font = { bold: true, size: 15 };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.headerBg } };
    cell.border = thinBorder();
  });

  // ─── Linhas 4+: dados ───
  const DATA_START = 4;
  linhas.forEach((linha, idx) => {
    const row = ws.getRow(DATA_START + idx);
    row.height = 26;
    const isZebra = idx % 2 === 1;
    colunas.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      if (c.branco) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: c.corFundo ?? COLOR.brancoBg } };
      } else {
        preencherCelulaDado(cell, linha[i] ?? null, c.formato);
        if (isZebra) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.zebraBg } };
      }
      cell.font = { size: 14 };
      cell.alignment = alinhamentoPara(c.formato);
      cell.border = thinBorder();
    });
  });

  // ─── Linhas de agregação (TOTAIS / MÉDIA) ───
  let rowNum = DATA_START + linhas.length;
  for (const agg of [totais, media]) {
    if (agg == null) continue;
    escreverLinhaAgregacao(ws.getRow(rowNum), colunas, agg);
    rowNum += 1;
  }

  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: colCount } };

  return workbook.xlsx.writeBuffer().then(bufferParaBlob);
}

/** Escreve uma linha TOTAIS/MÉDIA: rótulo na 1ª coluna em branco + valores. */
function escreverLinhaAgregacao(
  row: ExcelJS.Row,
  colunas: readonly ColunaResolvida[],
  agg: LinhaAgregacao,
): void {
  row.height = 28;
  colunas.forEach((c, i) => {
    const cell = row.getCell(i + 1);
    cell.font = { size: 14, bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.totalBg } };
    cell.border = thinBorder();
    cell.alignment = alinhamentoPara(c.formato);

    if (i === agg.rotuloColIndex) {
      cell.value = agg.rotulo;
      cell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
      return;
    }
    const valor = agg.celulas[i];
    if (valor == null) return; // célula em branco (agregacao "nenhuma"/outro modo)
    cell.value = valor;
    const fmt = numFmtPara(c.formato);
    if (fmt != null && typeof valor === "number") cell.numFmt = fmt;
  });
}
