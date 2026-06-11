/**
 * Gerador de planilha XLSX por repasse (uma planilha = um carro).
 *
 * Por que `exceljs` e não `xlsx` (SheetJS)?
 *   - exceljs suporta fórmulas vivas com referências cruzadas entre abas.
 *     O Marcos precisa editar gastos dentro da própria planilha e ver
 *     breakeven/margem recalcularem sozinhos.
 *   - SheetJS free é usado no resto do projeto pra leitura/escrita simples,
 *     mas não dá pra manter referências de fórmula confiáveis.
 *
 * Estrutura: 4 abas
 *   1. Resumo — identificação, valores e status (B17 = total gastos via SUM Gastos!D:D)
 *   2. Gastos — linhas editáveis com total no rodapé
 *   3. Documentação — checklist com emoji
 *   4. Cálculos — breakeven, margens projetadas, ROI, comissão (referências a Resumo)
 *
 * API node-only: usa Buffer. Pra uso no browser (download), o caller converte
 * Buffer→Uint8Array→Blob (já feito em ExportDropdown e similares no projeto).
 */

import ExcelJS from "exceljs";
import {
  CANAL_LABEL,
  DOC_STATUS_ICON,
  DOC_STATUS_LABEL,
  DOCUMENTO_TIPO_LABEL,
  GASTO_TIPO_LABEL,
  STATUS_LABEL,
} from "@/lib/repasses/types";
import type {
  Repasse,
  RepasseGasto,
  RepasseDocumento,
} from "@/lib/repasses/types";

const FMT_BRL = '"R$" #,##0.00;[Red]-"R$" #,##0.00';
const FMT_PCT = '0.00"%"';
const FMT_DATE = "dd/mm/yyyy";

/** Formata YYYY-MM-DD pra Date local (sem timezone shift). null vira null. */
function dateOnly(value: string | null): Date | null {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/** Adiciona uma linha "label | valor" e retorna o range pra estilizar depois. */
function addLabeledRow(
  ws: ExcelJS.Worksheet,
  row: number,
  label: string,
  value: string | number | Date | null,
  numFmt?: string,
) {
  ws.getCell(`A${row}`).value = label;
  ws.getCell(`A${row}`).font = { bold: true };
  const cell = ws.getCell(`B${row}`);
  cell.value = value;
  if (numFmt) cell.numFmt = numFmt;
}

export async function gerarRelatorioRepasseXlsx(
  repasse: Repasse,
  gastos: ReadonlyArray<RepasseGasto>,
  documentos: ReadonlyArray<RepasseDocumento>,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Navesa Mesa";
  wb.created = new Date();

  // ─── Aba RESUMO ────────────────────────────────────────────────────────────
  const resumo = wb.addWorksheet("Resumo");
  resumo.getColumn("A").width = 28;
  resumo.getColumn("B").width = 32;

  // Título
  resumo.mergeCells("A1:B1");
  resumo.getCell("A1").value = `Repasse — ${repasse.modelo} (${repasse.placa})`;
  resumo.getCell("A1").font = { bold: true, size: 14 };

  // Identificação (A3..B11)
  resumo.getCell("A3").value = "Identificação";
  resumo.getCell("A3").font = { bold: true, size: 11 };
  addLabeledRow(resumo, 4, "Placa", repasse.placa);
  addLabeledRow(resumo, 5, "Modelo", repasse.modelo);
  addLabeledRow(resumo, 6, "Chassi", repasse.chassi);
  addLabeledRow(resumo, 7, "Marca", repasse.marca ?? "—");
  addLabeledRow(resumo, 8, "Cor", repasse.cor ?? "—");
  addLabeledRow(
    resumo,
    9,
    "Ano fab/modelo",
    [repasse.ano_fabricacao, repasse.ano_modelo].filter(Boolean).join("/") || "—",
  );
  addLabeledRow(resumo, 10, "KM", repasse.km ?? "—");
  addLabeledRow(resumo, 11, "Loja origem", repasse.loja_origem ?? "—");

  // Valores (A13..B21) — fórmulas vivas
  resumo.getCell("A13").value = "Valores";
  resumo.getCell("A13").font = { bold: true, size: 11 };

  addLabeledRow(resumo, 14, "Valor de aquisição", repasse.valor_aquisicao ?? 0, FMT_BRL);
  addLabeledRow(resumo, 15, "Valor que subiu", repasse.valor_subiu ?? 0, FMT_BRL);
  addLabeledRow(resumo, 16, "Valor mínimo", repasse.valor_minimo ?? 0, FMT_BRL);

  // Range dinâmico dos gastos: linhas 2..(gastos.length + 1).
  // Se a lista estiver vazia, usa D2:D2 (célula vazia → SUM = 0, válido).
  // Mantém o range exato dos dados pra evitar que a fórmula englobe o rodapé
  // TOTAL (que vai em Math.max(gastos.length + 3, 5)).
  const gastosDataStart = 2;
  const gastosDataEnd = Math.max(gastos.length + 1, gastosDataStart);
  const gastosTotalRow = Math.max(gastos.length + 3, 5);
  const gastosSumRange = `D${gastosDataStart}:D${gastosDataEnd}`;

  // B17 = soma viva da aba Gastos
  resumo.getCell("A17").value = "Total de gastos";
  resumo.getCell("A17").font = { bold: true };
  resumo.getCell("B17").value = { formula: `SUM(Gastos!${gastosSumRange})` };
  resumo.getCell("B17").numFmt = FMT_BRL;

  // B18 = aquisição + gastos
  resumo.getCell("A18").value = "Custo total (aquisição + gastos)";
  resumo.getCell("A18").font = { bold: true };
  resumo.getCell("B18").value = { formula: "B14+B17" };
  resumo.getCell("B18").numFmt = FMT_BRL;

  addLabeledRow(resumo, 19, "Valor vendido", repasse.valor_vendido ?? "", FMT_BRL);

  // B20 = margem real (R$) condicional
  resumo.getCell("A20").value = "Margem real (R$)";
  resumo.getCell("A20").font = { bold: true };
  resumo.getCell("B20").value = { formula: 'IF(B19="","",B19-B18)' };
  resumo.getCell("B20").numFmt = FMT_BRL;

  // B21 = margem %
  // Protege contra valor_vendido = 0 (divisão por zero → #DIV/0!),
  // espelhando calcularMargemPct em [calc.ts:59](src/lib/repasses/calc.ts#L59).
  resumo.getCell("A21").value = "Margem (%)";
  resumo.getCell("A21").font = { bold: true };
  resumo.getCell("B21").value = { formula: 'IF(OR(B19="",B19=0),"",B20/B19*100)' };
  resumo.getCell("B21").numFmt = FMT_PCT;

  // Status (A23..B27)
  resumo.getCell("A23").value = "Status";
  resumo.getCell("A23").font = { bold: true, size: 11 };
  addLabeledRow(resumo, 24, "Status", STATUS_LABEL[repasse.status]);
  addLabeledRow(
    resumo,
    25,
    "Documentação",
    DOC_STATUS_LABEL[repasse.documentacao_status],
  );
  addLabeledRow(resumo, 26, "Canal", CANAL_LABEL[repasse.canal] ?? repasse.canal);
  addLabeledRow(resumo, 27, "Data subiu", dateOnly(repasse.data_subiu), FMT_DATE);
  addLabeledRow(resumo, 28, "Data vendido", dateOnly(repasse.data_vendido), FMT_DATE);

  // ─── Aba GASTOS ────────────────────────────────────────────────────────────
  const ws = wb.addWorksheet("Gastos");
  ws.columns = [
    { header: "#", key: "n", width: 6 },
    { header: "Tipo", key: "tipo", width: 18 },
    { header: "Descrição", key: "descricao", width: 36 },
    { header: "Valor (R$)", key: "valor", width: 14 },
    { header: "Data", key: "data", width: 12 },
    { header: "Observação", key: "observacao", width: 32 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE5E7EB" },
  };

  gastos.forEach((g, i) => {
    const r = ws.addRow({
      n: i + 1,
      tipo: GASTO_TIPO_LABEL[g.tipo],
      descricao: g.descricao,
      valor: g.valor,
      data: dateOnly(g.data),
      observacao: g.observacao ?? "",
    });
    r.getCell("valor").numFmt = FMT_BRL;
    r.getCell("data").numFmt = FMT_DATE;
  });

  // Total no rodapé — usa range dinâmico baseado em gastos.length pra evitar
  // truncar com ≥100 linhas e evitar que a fórmula englobe a própria célula TOTAL.
  // Invariante: gastosDataEnd < gastosTotalRow (sempre).
  const totalRow = ws.getRow(gastosTotalRow);
  totalRow.getCell(3).value = "TOTAL";
  totalRow.getCell(3).font = { bold: true };
  totalRow.getCell(3).alignment = { horizontal: "right" };
  totalRow.getCell(4).value = { formula: `SUM(${gastosSumRange})` };
  totalRow.getCell(4).font = { bold: true };
  totalRow.getCell(4).numFmt = FMT_BRL;

  // ─── Aba DOCUMENTAÇÃO ──────────────────────────────────────────────────────
  const wd = wb.addWorksheet("Documentação");
  wd.columns = [
    { header: "Item", key: "item", width: 22 },
    { header: "Status", key: "status", width: 16 },
    { header: "Observação", key: "obs", width: 36 },
    { header: "Data verificação", key: "data", width: 18 },
  ];
  wd.getRow(1).font = { bold: true };
  wd.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE5E7EB" },
  };

  for (const doc of documentos) {
    const r = wd.addRow({
      item: DOCUMENTO_TIPO_LABEL[doc.tipo],
      status: `${DOC_STATUS_ICON[doc.status]} ${DOC_STATUS_LABEL[doc.status]}`,
      obs: doc.observacao ?? "",
      data: dateOnly(doc.data_verificacao),
    });
    r.getCell("data").numFmt = FMT_DATE;
  }

  // ─── Aba CÁLCULOS ──────────────────────────────────────────────────────────
  const wc = wb.addWorksheet("Cálculos");
  wc.getColumn("A").width = 36;
  wc.getColumn("B").width = 22;

  wc.getCell("A1").value = "Cenários e indicadores";
  wc.getCell("A1").font = { bold: true, size: 12 };

  wc.getCell("A3").value = "Breakeven (custo total)";
  wc.getCell("B3").value = { formula: "Resumo!B18" };
  wc.getCell("B3").numFmt = FMT_BRL;

  wc.getCell("A4").value = "Margem se vender pelo subido";
  wc.getCell("B4").value = { formula: "Resumo!B15-Resumo!B18" };
  wc.getCell("B4").numFmt = FMT_BRL;

  wc.getCell("A5").value = "Margem se vender pelo mínimo";
  wc.getCell("B5").value = { formula: "Resumo!B16-Resumo!B18" };
  wc.getCell("B5").numFmt = FMT_BRL;

  wc.getCell("A6").value = "ROI sobre aquisição (%)";
  wc.getCell("B6").value = {
    formula: 'IF(Resumo!B14=0,"",B3/Resumo!B14*100)',
  };
  wc.getCell("B6").numFmt = FMT_PCT;

  wc.getCell("A7").value = "Comissão estimada (5% do valor subido)";
  wc.getCell("B7").value = { formula: "Resumo!B15*0.05" };
  wc.getCell("B7").numFmt = FMT_BRL;

  // ─── Serialização ─────────────────────────────────────────────────────────
  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

// ─── Export consolidado de uma lista de repasses (1 aba) ──────────────────────

export type RepasseConsolidadoRow = {
  repasse: Repasse;
  totalGastos: number;
  custoTotal: number | null;
  margemReal: number | null;
  margemPct: number | null;
};

export async function gerarConsolidadoRepassesXlsx(
  rows: ReadonlyArray<RepasseConsolidadoRow>,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Navesa Mesa";
  wb.created = new Date();

  const ws = wb.addWorksheet("Repasses");
  ws.columns = [
    { header: "Placa", key: "placa", width: 12 },
    { header: "Modelo", key: "modelo", width: 30 },
    { header: "Marca", key: "marca", width: 14 },
    { header: "Ano modelo", key: "ano", width: 12 },
    { header: "KM", key: "km", width: 12 },
    { header: "Subido em", key: "subido_em", width: 14 },
    { header: "Canal", key: "canal", width: 14 },
    { header: "Aquisição", key: "aquisicao", width: 14 },
    { header: "Subiu por", key: "subiu", width: 14 },
    { header: "Mínimo", key: "minimo", width: 14 },
    { header: "Gastos", key: "gastos", width: 14 },
    { header: "Custo total", key: "custo", width: 14 },
    { header: "Vendido por", key: "vendido", width: 14 },
    { header: "Margem (R$)", key: "margem", width: 14 },
    { header: "Margem (%)", key: "margem_pct", width: 12 },
    { header: "Status", key: "status", width: 16 },
    { header: "Documentação", key: "doc", width: 16 },
  ];

  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE5E7EB" },
  };

  for (const { repasse, totalGastos, custoTotal, margemReal, margemPct } of rows) {
    const r = ws.addRow({
      placa: repasse.placa,
      modelo: repasse.modelo,
      marca: repasse.marca ?? "",
      ano: repasse.ano_modelo ?? "",
      km: repasse.km ?? "",
      subido_em: dateOnly(repasse.data_subiu),
      canal: CANAL_LABEL[repasse.canal] ?? repasse.canal,
      aquisicao: repasse.valor_aquisicao ?? "",
      subiu: repasse.valor_subiu ?? "",
      minimo: repasse.valor_minimo ?? "",
      gastos: totalGastos,
      custo: custoTotal ?? "",
      vendido: repasse.valor_vendido ?? "",
      margem: margemReal ?? "",
      margem_pct: margemPct ?? "",
      status: STATUS_LABEL[repasse.status],
      doc: DOC_STATUS_LABEL[repasse.documentacao_status],
    });
    for (const key of ["aquisicao", "subiu", "minimo", "gastos", "custo", "vendido", "margem"] as const) {
      r.getCell(key).numFmt = FMT_BRL;
    }
    r.getCell("margem_pct").numFmt = FMT_PCT;
    r.getCell("subido_em").numFmt = FMT_DATE;
  }

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
