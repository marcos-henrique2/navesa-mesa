/**
 * Export XLSX do relatório "Carros em anúncio" (Story 1.2).
 *
 * 1 aba, header fixo (frozen + autofilter), valores numéricos centavo-perfect
 * (numFmt BRL, célula é number — não string formatada). Respeita o filtro ativo:
 * o caller passa a lista já filtrada. Lista vazia → arquivo com aviso "nenhum
 * resultado" (não lança erro). Carro incompleto → margem "indisponível" (nunca R$ 0).
 *
 * Sem cor/semáforo aqui — isso é Story 1.3 (a UI). O export é a foto da tabela 1.2.
 * Usa exceljs (mesma lib do relatorio-repasse-xlsx.ts).
 */

import ExcelJS from "exceljs";
import type { CarroAnuncioItem } from "@/lib/repasses/relatorio-anuncio";

const FMT_BRL = '"R$" #,##0.00;[Red]-"R$" #,##0.00';
const FMT_INT = "#,##0";
const FMT_PCT = "0.0%";
const INDISPONIVEL = "indisponível";

const COR_TITULO_BG = "FF1E3A8A";
const COR_TITULO_FG = "FFFFFFFF";
const COR_HEADER_BG = "FF3B82F6";
const COR_HEADER_FG = "FFFFFFFF";
const COR_ZEBRA = "FFF3F4F6";

const BORDA_FINA: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFD1D5DB" } },
  bottom: { style: "thin", color: { argb: "FFD1D5DB" } },
  left: { style: "thin", color: { argb: "FFD1D5DB" } },
  right: { style: "thin", color: { argb: "FFD1D5DB" } },
};

type Col = { header: string; width: number; fmt?: string };

const COLUNAS: ReadonlyArray<Col> = [
  { header: "#", width: 5 },
  { header: "Placa", width: 11 },
  { header: "Modelo", width: 30 },
  { header: "Ano", width: 11 },
  { header: "KM", width: 11, fmt: FMT_INT },
  { header: "Custo real", width: 14, fmt: FMT_BRL },
  { header: "Valor mínimo", width: 14, fmt: FMT_BRL },
  { header: "Compre por", width: 14, fmt: FMT_BRL },
  { header: "Dias no repasse", width: 14, fmt: FMT_INT },
  { header: "FIPE/Web", width: 14, fmt: FMT_BRL },
  { header: "Interessados", width: 12, fmt: FMT_INT },
  { header: "Margem mín. (R$)", width: 16, fmt: FMT_BRL },
  { header: "Margem mín. (%)", width: 14, fmt: FMT_PCT },
  { header: "Margem compre-por (R$)", width: 20, fmt: FMT_BRL },
  { header: "Margem compre-por (%)", width: 18, fmt: FMT_PCT },
];

const HEADER_ROW = 4;
const DATA_START_ROW = 5;

/** % vem em pontos percentuais (30 = 30%); no Excel FMT_PCT espera fração. */
function pctFrac(v: number | null): number | null {
  return v == null ? null : v / 100;
}

function dataGeradaBR(): string {
  const a = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(a.getDate())}/${p(a.getMonth() + 1)}/${a.getFullYear()} ${p(a.getHours())}:${p(a.getMinutes())}`;
}

export async function gerarRelatorioAnuncioXlsx(
  itens: ReadonlyArray<CarroAnuncioItem>,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Navesa Mesa";
  wb.created = new Date();

  const ws = wb.addWorksheet("Carros em anúncio", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ state: "frozen", ySplit: HEADER_ROW }],
  });

  const lastCol = COLUNAS.length;
  for (let i = 0; i < COLUNAS.length; i++) ws.getColumn(i + 1).width = COLUNAS[i]!.width;

  // Cabeçalho (linhas 1-3)
  ws.mergeCells(1, 1, 1, lastCol);
  const titulo = ws.getCell(1, 1);
  titulo.value = "NAVESA — Carros em anúncio (repasse)";
  titulo.font = { name: "Calibri", size: 16, bold: true, color: { argb: COR_TITULO_FG } };
  titulo.alignment = { horizontal: "center", vertical: "middle" };
  titulo.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COR_TITULO_BG } };
  ws.getRow(1).height = 30;

  ws.mergeCells(2, 1, 2, lastCol);
  const sub = ws.getCell(2, 1);
  sub.value = `Gerado em: ${dataGeradaBR()}`;
  sub.font = { name: "Calibri", size: 10, color: { argb: COR_TITULO_FG } };
  sub.alignment = { horizontal: "center", vertical: "middle" };
  sub.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };

  ws.mergeCells(3, 1, 3, lastCol);
  const totais = ws.getCell(3, 1);
  totais.value = `Total: ${itens.length} veículo${itens.length === 1 ? "" : "s"} (respeita o filtro ativo)`;
  totais.font = { name: "Calibri", size: 10, bold: true, color: { argb: COR_TITULO_FG } };
  totais.alignment = { horizontal: "center", vertical: "middle" };
  totais.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };

  // Header da tabela (linha 4)
  const headerRow = ws.getRow(HEADER_ROW);
  for (let i = 0; i < COLUNAS.length; i++) {
    const cell = headerRow.getCell(i + 1);
    cell.value = COLUNAS[i]!.header;
    cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: COR_HEADER_FG } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COR_HEADER_BG } };
    cell.border = BORDA_FINA;
  }
  headerRow.height = 24;

  // Lista vazia → aviso "nenhum resultado" (não é erro).
  if (itens.length === 0) {
    ws.mergeCells(DATA_START_ROW, 1, DATA_START_ROW, lastCol);
    const aviso = ws.getCell(DATA_START_ROW, 1);
    aviso.value = "Nenhum resultado para o filtro atual.";
    aviso.font = { name: "Calibri", size: 12, italic: true, color: { argb: "FF6B7280" } };
    aviso.alignment = { horizontal: "center", vertical: "middle" };
    ws.getRow(DATA_START_ROW).height = 24;
    ws.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: HEADER_ROW, column: lastCol } };
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  itens.forEach((it, idx) => {
    const rowNum = DATA_START_ROW + idx;
    const row = ws.getRow(rowNum);
    const zebra = idx % 2 === 1;

    // Célula incompleta → texto "indisponível" (nunca 0). Célula com dado → number.
    const margemMinVal = it.incompleto ? INDISPONIVEL : (it.margemMinimoValor ?? INDISPONIVEL);
    const margemMinPct = it.incompleto ? INDISPONIVEL : (pctFrac(it.margemMinimoPct) ?? INDISPONIVEL);
    const margemCpVal = it.incompleto ? INDISPONIVEL : (it.margemComPorValor ?? INDISPONIVEL);
    const margemCpPct = it.incompleto ? INDISPONIVEL : (pctFrac(it.margemComPorPct) ?? INDISPONIVEL);

    const valores: Array<string | number | null> = [
      idx + 1,
      it.placa,
      it.modelo,
      it.anoLabel,
      it.km ?? INDISPONIVEL,
      it.custoReal ?? INDISPONIVEL,
      it.valorMinimo ?? INDISPONIVEL,
      it.valorComprePor ?? INDISPONIVEL,
      it.diasNoRepasse ?? "—",
      it.fipe ?? "—",
      it.interessados,
      margemMinVal,
      margemMinPct,
      margemCpVal,
      margemCpPct,
    ];

    for (let i = 0; i < valores.length; i++) {
      const cell = row.getCell(i + 1);
      const v = valores[i];
      cell.value = v ?? "";
      cell.border = BORDA_FINA;
      if (zebra) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COR_ZEBRA } };
      // Aplica numFmt só quando a célula é realmente número.
      const fmt = COLUNAS[i]!.fmt;
      if (fmt && typeof v === "number") cell.numFmt = fmt;
    }
    row.height = 20;
  });

  ws.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: HEADER_ROW, column: lastCol } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
