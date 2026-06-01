/**
 * EXPORT CONFERÊNCIA DE ESTOQUE FÍSICO
 *
 * Gera 1 .xlsx desenhado pra impressão: paisagem A4, header repetido em cada
 * página, linhas zebradas, espaço pra marcação manual ("✓ CONFERIDO") e
 * rodapé com campos pra assinatura. Use pra conferência física no pátio.
 *
 * Recebe veículos JÁ FILTRADOS (loja/marca/cautelar/busca etc. aplicados na
 * tela) — exporta exatamente o que está visível na tabela.
 */

import ExcelJS from "exceljs";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";

// ═══════════════════════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════════════════════

export type ConferenciaVeiculo = VeiculoParsed & {
  /** Nome da loja resolvido a partir do mapa de lojas. "—" se desconhecido. */
  empresa_nome: string;
};

export type ConferenciaEstoqueInput = {
  /** Veículos já filtrados (na ordem em que devem aparecer na conferência). */
  veiculos: ConferenciaVeiculo[];
  /** Nome da loja filtrada na tela, ou "TODAS" se filtro = all. */
  filtroLoja: string;
};

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTES VISUAIS
// ═══════════════════════════════════════════════════════════════════════════

const COLOR = {
  titleBg: "FF1F2937",
  titleFg: "FFFFFFFF",
  metaBg: "FFF3F4F6",
  headerBg: "FFE5E7EB",
  zebraBg: "FFFAFAFA",
  totalBg: "FFF3F4F6",
  borderGray: "FFD1D5DB",
} as const;

const FMT_KM = '#,##0" km"';
const FMT_MONEY_INT = '"R$ "#,##0';

// Colunas (A=1)
const COL = {
  A_SEQ: 1,
  B_LOJA: 2,
  C_PLACA: 3,
  D_CHASSI: 4,
  E_VEICULO: 5,
  F_ANO: 6,
  G_KM: 7,
  H_DIAS: 8,
  I_AQUISICAO: 9,
  J_CONFERIDO: 10,
} as const;

const TOTAL_COLS = 10;

const COL_WIDTHS: Record<number, number> = {
  [COL.A_SEQ]: 5,
  [COL.B_LOJA]: 22,
  [COL.C_PLACA]: 10,
  [COL.D_CHASSI]: 22,
  [COL.E_VEICULO]: 35,
  [COL.F_ANO]: 12,
  [COL.G_KM]: 14,
  [COL.H_DIAS]: 12,
  [COL.I_AQUISICAO]: 16,
  [COL.J_CONFERIDO]: 14,
};

const HEADERS: Record<number, string> = {
  [COL.A_SEQ]: "#",
  [COL.B_LOJA]: "LOJA",
  [COL.C_PLACA]: "PLACA",
  [COL.D_CHASSI]: "CHASSI",
  [COL.E_VEICULO]: "VEÍCULO",
  [COL.F_ANO]: "ANO",
  [COL.G_KM]: "KM",
  [COL.H_DIAS]: "DIAS PÁTIO",
  [COL.I_AQUISICAO]: "AQUISIÇÃO",
  [COL.J_CONFERIDO]: "✓ CONFERIDO",
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function thinBorder(): ExcelJS.Borders {
  const side: Partial<ExcelJS.Border> = { style: "thin", color: { argb: COLOR.borderGray } };
  return {
    top: side,
    bottom: side,
    left: side,
    right: side,
    diagonal: { up: false, down: false },
  } as ExcelJS.Borders;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtDataBR(): string {
  return new Date().toLocaleDateString("pt-BR");
}

function fmtAno(fab: number | null, mod: number | null): string {
  if (fab != null && mod != null) {
    return fab === mod ? String(mod) : `${fab}/${mod}`;
  }
  if (mod != null) return String(mod);
  if (fab != null) return String(fab);
  return "—";
}

function fmtVeiculo(marca: string | null, modelo: string): string {
  return `${marca ?? ""} ${modelo}`.trim();
}

// ═══════════════════════════════════════════════════════════════════════════
// GERAÇÃO
// ═══════════════════════════════════════════════════════════════════════════

export async function gerarConferenciaEstoque(
  input: ConferenciaEstoqueInput,
): Promise<Blob> {
  const { veiculos, filtroLoja } = input;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Navesa Mesa";
  workbook.created = new Date();
  const ws = workbook.addWorksheet("Conferência Estoque");

  // ─── Configuração de página (paisagem A4, margens 15mm, centralizado) ───
  ws.pageSetup = {
    paperSize: 9, // A4
    orientation: "landscape",
    horizontalCentered: true,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: {
      left: 0.59, // 15mm ≈ 0.59"
      right: 0.59,
      top: 0.59,
      bottom: 0.59,
      header: 0.3,
      footer: 0.3,
    },
    printTitlesRow: "1:3",
  };

  // ─── Larguras de coluna ───
  for (let c = 1; c <= TOTAL_COLS; c++) {
    ws.getColumn(c).width = COL_WIDTHS[c] ?? 12;
  }

  // ─── Linha 1: título ───
  ws.mergeCells(1, COL.A_SEQ, 1, COL.J_CONFERIDO);
  const row1 = ws.getRow(1);
  row1.height = 32;
  const titleCell = row1.getCell(COL.A_SEQ);
  titleCell.value = "CONFERÊNCIA DE ESTOQUE FÍSICO";
  titleCell.font = { bold: true, size: 16, color: { argb: COLOR.titleFg } };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  titleCell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: COLOR.titleBg },
  };

  // ─── Linha 2: meta (Data | Loja | Total) ───
  const row2 = ws.getRow(2);
  row2.height = 22;
  ws.mergeCells(2, COL.A_SEQ, 2, COL.C_PLACA);
  ws.mergeCells(2, COL.D_CHASSI, 2, COL.F_ANO);
  ws.mergeCells(2, COL.G_KM, 2, COL.J_CONFERIDO);

  const metaCells: Array<{ col: number; text: string }> = [
    { col: COL.A_SEQ, text: `Data: ${fmtDataBR()}` },
    { col: COL.D_CHASSI, text: `Loja: ${filtroLoja === "all" ? "TODAS" : filtroLoja}` },
    { col: COL.G_KM, text: `Total de veículos: ${veiculos.length}` },
  ];
  for (const { col, text } of metaCells) {
    const cell = row2.getCell(col);
    cell.value = text;
    cell.font = { size: 11, bold: true };
    cell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLOR.metaBg },
    };
  }

  // ─── Linha 3: header das colunas ───
  const row3 = ws.getRow(3);
  row3.height = 28;
  for (const [colNumStr, label] of Object.entries(HEADERS)) {
    const colNum = Number(colNumStr);
    const cell = row3.getCell(colNum);
    cell.value = label;
    cell.font = { bold: true, size: 11 };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLOR.headerBg },
    };
    cell.border = thinBorder();
  }

  // ─── Linhas 4+: dados ───
  const DATA_START = 4;
  veiculos.forEach((v, idx) => {
    const rowNum = DATA_START + idx;
    const row = ws.getRow(rowNum);
    row.height = 22;

    const isZebra = idx % 2 === 1; // linhas pares (idx ímpar = 2ª, 4ª...) zebradas
    const zebraFill: ExcelJS.FillPattern = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLOR.zebraBg },
    };

    // A — #
    const aCell = row.getCell(COL.A_SEQ);
    aCell.value = idx + 1;
    aCell.numFmt = "0";
    aCell.alignment = { horizontal: "center", vertical: "middle" };
    aCell.font = { size: 10 };

    // B — Loja
    const bCell = row.getCell(COL.B_LOJA);
    bCell.value = v.empresa_nome || "—";
    bCell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
    bCell.font = { size: 10 };

    // C — Placa (monospace)
    const cCell = row.getCell(COL.C_PLACA);
    cCell.value = v.placa;
    cCell.alignment = { horizontal: "center", vertical: "middle" };
    cCell.font = { name: "Consolas", size: 10, bold: true };

    // D — Chassi (monospace, font 9)
    const dCell = row.getCell(COL.D_CHASSI);
    dCell.value = v.chassi;
    dCell.alignment = { horizontal: "center", vertical: "middle" };
    dCell.font = { name: "Consolas", size: 9 };

    // E — Veículo (marca + modelo)
    const eCell = row.getCell(COL.E_VEICULO);
    eCell.value = fmtVeiculo(v.marca, v.modelo);
    eCell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
    eCell.font = { size: 10 };

    // F — Ano
    const fCell = row.getCell(COL.F_ANO);
    fCell.value = fmtAno(v.ano_fabricacao, v.ano_modelo);
    fCell.alignment = { horizontal: "center", vertical: "middle" };
    fCell.font = { size: 10 };

    // G — KM
    const gCell = row.getCell(COL.G_KM);
    if (v.km != null) {
      gCell.value = v.km;
      gCell.numFmt = FMT_KM;
    } else {
      gCell.value = "—";
    }
    gCell.alignment = { horizontal: "right", vertical: "middle", indent: 1 };
    gCell.font = { size: 10 };

    // H — Dias pátio (centro)
    const hCell = row.getCell(COL.H_DIAS);
    if (v.dias_patio != null) {
      hCell.value = v.dias_patio;
    } else {
      hCell.value = "—";
    }
    hCell.alignment = { horizontal: "center", vertical: "middle" };
    hCell.font = { size: 10 };

    // I — Aquisição (R$, sem decimais)
    const iCell = row.getCell(COL.I_AQUISICAO);
    if (v.valor_aquisicao != null) {
      iCell.value = v.valor_aquisicao;
      iCell.numFmt = FMT_MONEY_INT;
    } else {
      iCell.value = "—";
    }
    iCell.alignment = { horizontal: "right", vertical: "middle", indent: 1 };
    iCell.font = { size: 10 };

    // J — Conferido (vazio pra marcação manual)
    const jCell = row.getCell(COL.J_CONFERIDO);
    jCell.value = "";
    jCell.alignment = { horizontal: "center", vertical: "middle" };

    // Aplica bordas + zebra em todas as células
    for (let c = COL.A_SEQ; c <= COL.J_CONFERIDO; c++) {
      const cell = row.getCell(c);
      cell.border = thinBorder();
      if (isZebra) cell.fill = zebraFill;
    }
  });

  // ─── Rodapé: total + linhas pra assinatura ───
  const lastDataRow = DATA_START + veiculos.length - 1;
  const totalRowNum = lastDataRow + 3; // pula 2 linhas vazias

  // Linha de total (merge A:J pra ficar destacado, fundo cinza, bold)
  ws.mergeCells(totalRowNum, COL.A_SEQ, totalRowNum, COL.J_CONFERIDO);
  const totalRow = ws.getRow(totalRowNum);
  totalRow.height = 24;
  const totalCell = totalRow.getCell(COL.A_SEQ);
  totalCell.value = `Total: ${veiculos.length} veículo${veiculos.length === 1 ? "" : "s"}`;
  totalCell.font = { bold: true, size: 11 };
  totalCell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
  totalCell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: COLOR.totalBg },
  };
  totalCell.border = thinBorder();

  // Pula 1 linha → "Conferido por: ____" (merge 5 colunas, A:E)
  const conferidoRowNum = totalRowNum + 2;
  ws.mergeCells(conferidoRowNum, COL.A_SEQ, conferidoRowNum, COL.E_VEICULO);
  const conferidoRow = ws.getRow(conferidoRowNum);
  conferidoRow.height = 26;
  const conferidoCell = conferidoRow.getCell(COL.A_SEQ);
  conferidoCell.value = "Conferido por: ____________________________________";
  conferidoCell.font = { size: 11 };
  conferidoCell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };

  // Pula 1 linha → "Assinatura: ______  Data: __/__/____" (merge 8 colunas, A:H)
  const assinaturaRowNum = conferidoRowNum + 2;
  ws.mergeCells(assinaturaRowNum, COL.A_SEQ, assinaturaRowNum, COL.H_DIAS);
  const assinaturaRow = ws.getRow(assinaturaRowNum);
  assinaturaRow.height = 26;
  const assinaturaCell = assinaturaRow.getCell(COL.A_SEQ);
  assinaturaCell.value =
    "Assinatura: ______________________________________   Data: ___/___/______";
  assinaturaCell.font = { size: 11 };
  assinaturaCell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };

  // ═══════════════════════════════════════════════════════════════════
  // Gera Blob (writeBuffer é async; trata Node Buffer vs ArrayBuffer)
  // ═══════════════════════════════════════════════════════════════════
  const buf = await workbook.xlsx.writeBuffer();
  const bufUnknown: unknown = buf;
  const MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  if (bufUnknown instanceof ArrayBuffer) {
    return new Blob([bufUnknown], { type: MIME });
  }
  if (bufUnknown instanceof Uint8Array) {
    const copy = new ArrayBuffer(bufUnknown.byteLength);
    new Uint8Array(copy).set(bufUnknown);
    return new Blob([copy], { type: MIME });
  }
  throw new Error("ExcelJS writeBuffer não retornou ArrayBuffer/Uint8Array");
}

// ═══════════════════════════════════════════════════════════════════════════
// DOWNLOAD (browser)
// ═══════════════════════════════════════════════════════════════════════════

export async function baixarConferenciaEstoque(
  input: ConferenciaEstoqueInput,
): Promise<void> {
  const blob = await gerarConferenciaEstoque(input);
  const url = URL.createObjectURL(blob);
  const fileName = `conferencia-estoque-${todayISO()}.xlsx`;
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
