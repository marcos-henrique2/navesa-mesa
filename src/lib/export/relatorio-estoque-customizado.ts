/**
 * EXPORT RELATÓRIO DE ESTOQUE CUSTOMIZÁVEL
 *
 * O Marcos escolhe QUAIS colunas exportar (do catálogo `colunas-estoque`), na
 * ordem canônica do catálogo. Opcionalmente adiciona uma coluna "Observações"
 * sempre em branco no fim (pra ele anotar a análise direto no Excel). AutoFilter
 * em TODAS as colunas e cabeçalho/estilo no mesmo espírito do relatório
 * gerencial (cabeçalho NAVESA, header colorido, frozen, zebra, larguras).
 *
 * Recebe veículos JÁ FILTRADOS (loja/marca/busca etc. aplicados na tela) —
 * exporta exatamente o que está visível na tabela, na ordem recebida.
 */

import ExcelJS from "exceljs";
import {
  COLUNAS_ESTOQUE,
  type ColunaEstoque,
  type ColunaFormato,
  type ColunaKey,
  type VeiculoExportavel,
} from "@/lib/export/colunas-estoque";

export type RelatorioEstoqueOpcoes = {
  /** Keys das colunas escolhidas (qualquer ordem; o relatório reordena pro catálogo). */
  colunas: ColunaKey[];
  /** Adiciona coluna "Observações" sempre em branco no fim. */
  incluirObservacoes: boolean;
  /** Nome da loja filtrada na tela (ou "TODAS"). Opcional. */
  filtroLoja?: string;
};

// ─── Constantes visuais (alinhadas ao relatório gerencial) ───────────────────

const COLOR = {
  titleBg: "FF1E40AF",
  titleFg: "FFFFFFFF",
  metaBg: "FFF3F4F6",
  headerBg: "FFE5E7EB",
  zebraBg: "FFFAFAFA",
  borderGray: "FFD1D5DB",
  obsBg: "FFFFFBEB", // amarelo bem claro pra destacar a coluna de anotação
} as const;

const FMT_KM = '#,##0" km"';
const FMT_INT = "#,##0";
const FMT_MONEY_INT = '"R$ "#,##0';

const LARGURA_PADRAO: Record<ColunaFormato, number> = {
  texto: 18,
  numero: 12,
  moeda: 14,
  km: 12,
  ano: 9,
};

/** Largura específica por key (sobrescreve o padrão por formato quando faz sentido). */
const LARGURA_POR_KEY: Partial<Record<ColunaKey, number>> = {
  modelo: 35,
  chassi: 22,
  loja: 22,
  placa: 11,
  descricao_situacao: 16,
  patio: 18,
};

const LARGURA_OBSERVACOES = 40;

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

function numFmtPara(formato: ColunaFormato): string | undefined {
  switch (formato) {
    case "moeda":
      return FMT_MONEY_INT;
    case "km":
      return FMT_KM;
    case "numero":
      return FMT_INT;
    default:
      return undefined;
  }
}

function alinhamentoPara(formato: ColunaFormato): Partial<ExcelJS.Alignment> {
  if (formato === "moeda" || formato === "km" || formato === "numero") {
    return { horizontal: "right", vertical: "middle", indent: 1 };
  }
  if (formato === "ano") {
    return { horizontal: "center", vertical: "middle" };
  }
  return { horizontal: "left", vertical: "middle", indent: 1 };
}

/** Seleção final na ordem canônica do catálogo (ignora keys desconhecidas/duplicadas). */
function resolverColunas(keys: ColunaKey[]): ColunaEstoque[] {
  const escolhidas = new Set(keys);
  return COLUNAS_ESTOQUE.filter((c) => escolhidas.has(c.key));
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

export async function gerarRelatorioEstoqueCustomizado(
  veiculos: VeiculoExportavel[],
  opcoes: RelatorioEstoqueOpcoes,
): Promise<Blob> {
  const colunas = resolverColunas(opcoes.colunas);
  const totalCols = colunas.length + (opcoes.incluirObservacoes ? 1 : 0);
  // Garante ao menos 1 coluna pro layout não quebrar (Observações ou placeholder).
  const colCount = Math.max(totalCols, 1);
  const obsCol = opcoes.incluirObservacoes ? colunas.length + 1 : null;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Navesa Mesa";
  workbook.created = new Date();
  const ws = workbook.addWorksheet("Estoque");

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
    ws.getColumn(i + 1).width = LARGURA_POR_KEY[c.key] ?? LARGURA_PADRAO[c.formato];
  });
  if (obsCol != null) ws.getColumn(obsCol).width = LARGURA_OBSERVACOES;

  // ─── Linha 1: título ───
  ws.mergeCells(1, 1, 1, colCount);
  const row1 = ws.getRow(1);
  row1.height = 32;
  const titleCell = row1.getCell(1);
  titleCell.value = "NAVESA — RELATÓRIO DE ESTOQUE CUSTOMIZADO";
  titleCell.font = { bold: true, size: 16, color: { argb: COLOR.titleFg } };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.titleBg } };

  // ─── Linha 2: meta ───
  const row2 = ws.getRow(2);
  row2.height = 22;
  const loja = opcoes.filtroLoja?.trim() || "TODAS";
  const metaTexto = `Data: ${fmtDataBR()}   |   Loja: ${loja}   |   Total de veículos: ${veiculos.length}`;
  ws.mergeCells(2, 1, 2, colCount);
  const metaCell = row2.getCell(1);
  metaCell.value = metaTexto;
  metaCell.font = { size: 11, bold: true };
  metaCell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
  metaCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.metaBg } };

  // ─── Linha 3: header das colunas ───
  const row3 = ws.getRow(3);
  row3.height = 28;
  colunas.forEach((c, i) => {
    const cell = row3.getCell(i + 1);
    cell.value = c.label;
    cell.font = { bold: true, size: 11 };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.headerBg } };
    cell.border = thinBorder();
  });
  if (obsCol != null) {
    const cell = row3.getCell(obsCol);
    cell.value = "Observações";
    cell.font = { bold: true, size: 11 };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.headerBg } };
    cell.border = thinBorder();
  }

  // ─── Linhas 4+: dados ───
  const DATA_START = 4;
  veiculos.forEach((v, idx) => {
    const rowNum = DATA_START + idx;
    const row = ws.getRow(rowNum);
    row.height = 22;
    const isZebra = idx % 2 === 1;

    colunas.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      const valor = c.getValor(v);
      if (valor == null) {
        cell.value = "—";
      } else {
        cell.value = valor;
        const fmt = numFmtPara(c.formato);
        if (fmt != null && typeof valor === "number") cell.numFmt = fmt;
      }
      cell.font = { size: 10 };
      cell.alignment = alinhamentoPara(c.formato);
      cell.border = thinBorder();
      if (isZebra) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.zebraBg } };
      }
    });

    if (obsCol != null) {
      const cell = row.getCell(obsCol);
      // Sempre em branco — só borda + fundo de destaque pra anotação no Excel.
      cell.border = thinBorder();
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.obsBg } };
    }
  });

  // ─── AutoFilter cobrindo TODO o header (todas as colunas) ───
  ws.autoFilter = {
    from: { row: 3, column: 1 },
    to: { row: 3, column: colCount },
  };

  const buf = await workbook.xlsx.writeBuffer();
  return bufferParaBlob(buf);
}

// ─── DOWNLOAD (browser) ──────────────────────────────────────────────────────

export async function baixarRelatorioEstoqueCustomizado(
  veiculos: VeiculoExportavel[],
  opcoes: RelatorioEstoqueOpcoes,
): Promise<void> {
  const blob = await gerarRelatorioEstoqueCustomizado(veiculos, opcoes);
  const url = URL.createObjectURL(blob);
  const fileName = `relatorio-estoque-customizado-${todayISO()}.xlsx`;
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
