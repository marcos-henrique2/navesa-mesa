/**
 * EXPORT RELATÓRIO DE ESTOQUE GERENCIAL
 *
 * Visão executiva pro gerente da concessionária — diferente da Conferência
 * (que é pra checklist físico no pátio). Esse aqui é corporativo/analítico:
 * dados por veículo + bloco TOTALIZADORES no rodapé com capital travado,
 * margens, KM médio, dias parados e alertas.
 *
 * Recebe veículos JÁ FILTRADOS (loja/marca/cautelar/busca etc. aplicados na
 * tela) — exporta exatamente o que está visível na tabela.
 */

import ExcelJS from "exceljs";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";

// ═══════════════════════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════════════════════

export type RelatorioGerencialVeiculo = VeiculoParsed & {
  /** Nome da loja resolvido a partir do mapa de lojas. null se desconhecido. */
  empresa_nome: string | null;
};

export type RelatorioGerencialInput = {
  /** Veículos já filtrados (na ordem em que devem aparecer no relatório). */
  veiculos: RelatorioGerencialVeiculo[];
  /** Nome da loja filtrada na tela, ou "TODAS" se filtro = all. */
  filtroLoja: string;
};

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTES VISUAIS
// ═══════════════════════════════════════════════════════════════════════════

const COLOR = {
  titleBg: "FF1E40AF", // azul escuro (corporativo)
  titleFg: "FFFFFFFF",
  metaBg: "FFF3F4F6",
  headerBg: "FFE5E7EB",
  zebraBg: "FFFAFAFA",
  totalBg: "FFF3F4F6",
  borderGray: "FFD1D5DB",
  // margem
  marginNegBg: "FFFEE2E2",
  marginNegFg: "FF991B1B",
  marginGoodBg: "FFD1FAE5",
  marginGoodFg: "FF065F46",
  // status
  statusDisponivelBg: "FFD1FAE5",
  statusDisponivelFg: "FF065F46",
  statusFaltaDocBg: "FFFEF3C7",
  statusFaltaDocFg: "FF92400E",
  statusBloqueadoBg: "FFFEE2E2",
  statusBloqueadoFg: "FF991B1B",
  // localização (categorias de pátio)
  patioPrepBg: "FFFEF3C7",
  patioTransitoBg: "FFDBEAFE",
  patioOficinaBg: "FFFFEDD5",
  patioBloqueadoBg: "FFFEE2E2",
  // alerta no rodapé
  alertFg: "FF991B1B",
} as const;

const FMT_KM = '#,##0" km"';
const FMT_INT = "#,##0";
const FMT_MONEY_INT = '"R$ "#,##0';
const FMT_PCT = '0.0"%"';

// Colunas (A=1)
const COL = {
  A_SEQ: 1,
  B_LOJA: 2,
  C_PLACA: 3,
  D_MARCA: 4,
  E_MODELO: 5,
  F_ANO: 6,
  G_KM: 7,
  H_DIAS: 8,
  I_AQUISICAO: 9,
  J_VENDA: 10,
  K_MARGEM: 11,
  L_STATUS: 12,
  M_LOCAL: 13,
} as const;

const TOTAL_COLS = 13;

const COL_WIDTHS: Record<number, number> = {
  [COL.A_SEQ]: 6,
  [COL.B_LOJA]: 30,
  [COL.C_PLACA]: 14,
  [COL.D_MARCA]: 16,
  [COL.E_MODELO]: 48,
  [COL.F_ANO]: 10,
  [COL.G_KM]: 15,
  [COL.H_DIAS]: 14,
  [COL.I_AQUISICAO]: 19,
  [COL.J_VENDA]: 19,
  [COL.K_MARGEM]: 19,
  [COL.L_STATUS]: 22,
  [COL.M_LOCAL]: 24,
};

const HEADERS: Record<number, string> = {
  [COL.A_SEQ]: "#",
  [COL.B_LOJA]: "LOJA",
  [COL.C_PLACA]: "PLACA",
  [COL.D_MARCA]: "MARCA",
  [COL.E_MODELO]: "MODELO",
  [COL.F_ANO]: "ANO",
  [COL.G_KM]: "KM",
  [COL.H_DIAS]: "DIAS PÁTIO",
  [COL.I_AQUISICAO]: "PREÇO ENTRADA",
  [COL.J_VENDA]: "PREÇO VENDA",
  [COL.K_MARGEM]: "MARGEM EST.",
  [COL.L_STATUS]: "STATUS",
  [COL.M_LOCAL]: "LOCALIZAÇÃO",
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

type MargemTone = "neg" | "good" | "neutral";

function classificarMargem(aquisicao: number | null, venda: number | null): {
  valor: number | null;
  tone: MargemTone;
} {
  if (aquisicao == null || venda == null) return { valor: null, tone: "neutral" };
  const margem = venda - aquisicao;
  if (margem < 0) return { valor: margem, tone: "neg" };
  if (aquisicao > 0 && margem / aquisicao > 0.15) return { valor: margem, tone: "good" };
  return { valor: margem, tone: "neutral" };
}

type StatusTone = "disponivel" | "faltaDoc" | "bloqueado" | "neutro";

function classificarStatus(descricao: string | null): StatusTone {
  if (descricao == null) return "neutro";
  const norm = descricao.trim().toUpperCase();
  if (norm === "DISPONIVEL" || norm === "DISPONÍVEL") return "disponivel";
  if (norm === "FALTA DOCUMENTO") return "faltaDoc";
  if (norm === "BLOQUEADO") return "bloqueado";
  return "neutro";
}

type PatioCategoria = "prep" | "transito" | "oficina" | "bloqueado" | "loja" | "outro";

function categorizarPatio(patio: string | null): PatioCategoria {
  if (patio == null) return "outro";
  const norm = patio.trim().toUpperCase();
  if (norm === "") return "outro";
  if (norm.includes("BLOQUEAD") || norm.includes("PENENCIA")) return "bloqueado";
  if (norm.includes("PREP")) return "prep";
  if (norm.includes("TRANSITO") || norm.includes("TRÂNSITO")) return "transito";
  if (
    norm.includes("OFICINA") ||
    norm.includes("FUNILARIA") ||
    norm.includes("TONICAR") ||
    norm.includes("AUTO HALL") ||
    norm.includes("PRO+") ||
    norm.includes("GEELY") ||
    norm.includes("AF")
  ) {
    return "oficina";
  }
  return "loja";
}

// ═══════════════════════════════════════════════════════════════════════════
// AGREGAÇÕES (totalizadores)
// ═══════════════════════════════════════════════════════════════════════════

type Totalizadores = {
  totalVeiculos: number;
  capitalTravado: number;
  valorMercado: number;
  margemPotencial: number;
  margemMediaPct: number | null;
  kmMedio: number | null;
  diasPatioMedio: number | null;
  qtMais60: number;
  pctMais60: number;
  qtMais90: number;
  pctMais90: number;
  qtMargemNeg: number;
  pctMargemNeg: number;
  qtDisponivel: number;
  pctDisponivel: number;
  qtFaltaDoc: number;
  pctFaltaDoc: number;
};

function calcularTotalizadores(veiculos: RelatorioGerencialVeiculo[]): Totalizadores {
  const total = veiculos.length;
  let capital = 0;
  let mercado = 0;
  let margem = 0;
  let countComMargemBase = 0;
  let somaMargemPct = 0;
  let countComKm = 0;
  let somaKm = 0;
  let countComDias = 0;
  let somaDias = 0;
  let qtMais60 = 0;
  let qtMais90 = 0;
  let qtMargemNeg = 0;
  let qtDisponivel = 0;
  let qtFaltaDoc = 0;

  for (const v of veiculos) {
    if (v.valor_aquisicao != null) capital += v.valor_aquisicao;
    if (v.preco_venda != null) mercado += v.preco_venda;
    if (v.valor_aquisicao != null && v.preco_venda != null) {
      const m = v.preco_venda - v.valor_aquisicao;
      margem += m;
      if (v.valor_aquisicao > 0) {
        somaMargemPct += (m / v.valor_aquisicao) * 100;
        countComMargemBase++;
      }
      if (m < 0) qtMargemNeg++;
    }
    if (v.km != null) {
      somaKm += v.km;
      countComKm++;
    }
    if (v.dias_patio != null) {
      somaDias += v.dias_patio;
      countComDias++;
      if (v.dias_patio > 60) qtMais60++;
      if (v.dias_patio > 90) qtMais90++;
    }
    const statusTone = classificarStatus(v.descricao_situacao);
    if (statusTone === "disponivel") qtDisponivel++;
    if (statusTone === "faltaDoc") qtFaltaDoc++;
  }

  const pct = (n: number): number => (total === 0 ? 0 : (n / total) * 100);

  return {
    totalVeiculos: total,
    capitalTravado: capital,
    valorMercado: mercado,
    margemPotencial: margem,
    margemMediaPct: countComMargemBase > 0 ? somaMargemPct / countComMargemBase : null,
    kmMedio: countComKm > 0 ? somaKm / countComKm : null,
    diasPatioMedio: countComDias > 0 ? somaDias / countComDias : null,
    qtMais60,
    pctMais60: pct(qtMais60),
    qtMais90,
    pctMais90: pct(qtMais90),
    qtMargemNeg,
    pctMargemNeg: pct(qtMargemNeg),
    qtDisponivel,
    pctDisponivel: pct(qtDisponivel),
    qtFaltaDoc,
    pctFaltaDoc: pct(qtFaltaDoc),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// GERAÇÃO
// ═══════════════════════════════════════════════════════════════════════════

export async function gerarRelatorioGerencial(
  input: RelatorioGerencialInput,
): Promise<Blob> {
  const { veiculos, filtroLoja } = input;
  const tot = calcularTotalizadores(veiculos);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Navesa Mesa";
  workbook.created = new Date();
  const ws = workbook.addWorksheet("Relatório Gerencial");

  // ─── Configuração de página (paisagem A4, margens 15mm, centralizado) ───
  ws.pageSetup = {
    paperSize: 9, // A4
    orientation: "landscape",
    horizontalCentered: true,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: {
      left: 0.59,
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
  ws.mergeCells(1, COL.A_SEQ, 1, COL.M_LOCAL);
  const row1 = ws.getRow(1);
  row1.height = 36;
  const titleCell = row1.getCell(COL.A_SEQ);
  titleCell.value = "RELATÓRIO DE ESTOQUE GERENCIAL";
  titleCell.font = { bold: true, size: 18, color: { argb: COLOR.titleFg } };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  titleCell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: COLOR.titleBg },
  };

  // ─── Linha 2: meta (Data | Loja | Total) ───
  const row2 = ws.getRow(2);
  row2.height = 26;
  ws.mergeCells(2, COL.A_SEQ, 2, COL.C_PLACA);
  ws.mergeCells(2, COL.D_MARCA, 2, COL.H_DIAS);
  ws.mergeCells(2, COL.I_AQUISICAO, 2, COL.M_LOCAL);

  const metaCells: Array<{ col: number; text: string }> = [
    { col: COL.A_SEQ, text: `Data: ${fmtDataBR()}` },
    { col: COL.D_MARCA, text: `Loja: ${filtroLoja === "all" ? "TODAS" : filtroLoja}` },
    { col: COL.I_AQUISICAO, text: `Total de veículos: ${veiculos.length}` },
  ];
  for (const { col, text } of metaCells) {
    const cell = row2.getCell(col);
    cell.value = text;
    cell.font = { size: 14, bold: true };
    cell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLOR.metaBg },
    };
  }

  // ─── Linha 3: header das colunas ───
  const row3 = ws.getRow(3);
  row3.height = 34;
  for (const [colNumStr, label] of Object.entries(HEADERS)) {
    const colNum = Number(colNumStr);
    const cell = row3.getCell(colNum);
    cell.value = label;
    cell.font = { bold: true, size: 15 };
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
    row.height = 26;

    const isZebra = idx % 2 === 1;
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
    aCell.font = { size: 14 };

    // B — Loja
    const bCell = row.getCell(COL.B_LOJA);
    bCell.value = v.empresa_nome ?? "—";
    bCell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
    bCell.font = { size: 14 };

    // C — Placa (monospace)
    const cCell = row.getCell(COL.C_PLACA);
    cCell.value = v.placa;
    cCell.alignment = { horizontal: "center", vertical: "middle" };
    cCell.font = { name: "Consolas", size: 14, bold: true };

    // D — Marca
    const dCell = row.getCell(COL.D_MARCA);
    dCell.value = v.marca ?? "—";
    dCell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
    dCell.font = { size: 14 };

    // E — Modelo
    const eCell = row.getCell(COL.E_MODELO);
    eCell.value = v.modelo;
    eCell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
    eCell.font = { size: 14 };

    // F — Ano (centro)
    const fCell = row.getCell(COL.F_ANO);
    fCell.value = fmtAno(v.ano_fabricacao, v.ano_modelo);
    fCell.alignment = { horizontal: "center", vertical: "middle" };
    fCell.font = { size: 14 };

    // G — KM
    const gCell = row.getCell(COL.G_KM);
    if (v.km != null) {
      gCell.value = v.km;
      gCell.numFmt = FMT_KM;
    } else {
      gCell.value = "—";
    }
    gCell.alignment = { horizontal: "right", vertical: "middle", indent: 1 };
    gCell.font = { size: 14 };

    // H — Dias pátio
    const hCell = row.getCell(COL.H_DIAS);
    if (v.dias_patio != null) {
      hCell.value = v.dias_patio;
      hCell.numFmt = FMT_INT;
    } else {
      hCell.value = "—";
    }
    hCell.alignment = { horizontal: "center", vertical: "middle" };
    hCell.font = { size: 14 };

    // I — Preço entrada (aquisição)
    const iCell = row.getCell(COL.I_AQUISICAO);
    if (v.valor_aquisicao != null) {
      iCell.value = v.valor_aquisicao;
      iCell.numFmt = FMT_MONEY_INT;
    } else {
      iCell.value = "—";
    }
    iCell.alignment = { horizontal: "right", vertical: "middle", indent: 1 };
    iCell.font = { size: 14 };

    // J — Preço venda
    const jCell = row.getCell(COL.J_VENDA);
    if (v.preco_venda != null) {
      jCell.value = v.preco_venda;
      jCell.numFmt = FMT_MONEY_INT;
    } else {
      jCell.value = "—";
    }
    jCell.alignment = { horizontal: "right", vertical: "middle", indent: 1 };
    jCell.font = { size: 14 };

    // K — Margem estimada (com cor condicional)
    const kCell = row.getCell(COL.K_MARGEM);
    const margem = classificarMargem(v.valor_aquisicao, v.preco_venda);
    if (margem.valor != null) {
      kCell.value = margem.valor;
      kCell.numFmt = FMT_MONEY_INT;
    } else {
      kCell.value = "—";
    }
    kCell.alignment = { horizontal: "right", vertical: "middle", indent: 1 };
    if (margem.tone === "neg") {
      kCell.font = { size: 14, bold: true, color: { argb: COLOR.marginNegFg } };
      kCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: COLOR.marginNegBg },
      };
    } else if (margem.tone === "good") {
      kCell.font = { size: 14, bold: true, color: { argb: COLOR.marginGoodFg } };
      kCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: COLOR.marginGoodBg },
      };
    } else {
      kCell.font = { size: 14 };
    }

    // L — Status (descrição da situação, com cor condicional)
    const lCell = row.getCell(COL.L_STATUS);
    const statusTone = classificarStatus(v.descricao_situacao);
    lCell.value = v.descricao_situacao?.trim() || "—";
    lCell.alignment = { horizontal: "center", vertical: "middle" };
    if (statusTone === "disponivel") {
      lCell.font = { size: 14, bold: true, color: { argb: COLOR.statusDisponivelFg } };
      lCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: COLOR.statusDisponivelBg },
      };
    } else if (statusTone === "faltaDoc") {
      lCell.font = { size: 14, bold: true, color: { argb: COLOR.statusFaltaDocFg } };
      lCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: COLOR.statusFaltaDocBg },
      };
    } else if (statusTone === "bloqueado") {
      lCell.font = { size: 14, bold: true, color: { argb: COLOR.statusBloqueadoFg } };
      lCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: COLOR.statusBloqueadoBg },
      };
    } else {
      lCell.font = { size: 14 };
    }

    // M — Localização (pátio, com cor condicional por categoria)
    const mCell = row.getCell(COL.M_LOCAL);
    const patioCategoria = categorizarPatio(v.patio);
    mCell.value = v.patio.trim() || "—";
    mCell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
    mCell.font = { size: 14 };
    if (patioCategoria === "prep") {
      mCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: COLOR.patioPrepBg },
      };
    } else if (patioCategoria === "transito") {
      mCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: COLOR.patioTransitoBg },
      };
    } else if (patioCategoria === "oficina") {
      mCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: COLOR.patioOficinaBg },
      };
    } else if (patioCategoria === "bloqueado") {
      mCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: COLOR.patioBloqueadoBg },
      };
    }

    // Bordas + zebra (não sobrescreve fill de margem/status/local quando colorido)
    const margemTemFill = margem.tone !== "neutral";
    const statusTemFill = statusTone !== "neutro";
    const localTemFill = patioCategoria !== "loja" && patioCategoria !== "outro";
    for (let c: number = COL.A_SEQ; c <= COL.M_LOCAL; c++) {
      const cell = row.getCell(c);
      cell.border = thinBorder();
      if (isZebra) {
        if (c === COL.K_MARGEM && margemTemFill) continue;
        if (c === COL.L_STATUS && statusTemFill) continue;
        if (c === COL.M_LOCAL && localTemFill) continue;
        cell.fill = zebraFill;
      }
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // RODAPÉ: BLOCO TOTALIZADORES
  // ═══════════════════════════════════════════════════════════════════

  const lastDataRow = DATA_START + veiculos.length - 1;

  // Page break antes dos totalizadores — começam em página nova,
  // sem header de tabela repetido em cima (que confunde leitura)
  if (veiculos.length > 0) {
    ws.getRow(lastDataRow).addPageBreak();
  }

  let cursor = lastDataRow + 3; // pula 2 linhas vazias

  // Cabeçalho do bloco
  ws.mergeCells(cursor, COL.A_SEQ, cursor, COL.M_LOCAL);
  const blockHeaderRow = ws.getRow(cursor);
  blockHeaderRow.height = 30;
  const blockHeaderCell = blockHeaderRow.getCell(COL.A_SEQ);
  blockHeaderCell.value = "TOTALIZADORES";
  blockHeaderCell.font = { bold: true, size: 16, color: { argb: COLOR.titleFg } };
  blockHeaderCell.alignment = { horizontal: "center", vertical: "middle" };
  blockHeaderCell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: COLOR.titleBg },
  };
  blockHeaderCell.border = thinBorder();
  cursor++;

  type LinhaTotalizador = {
    label: string;
    valor: string | number;
    numFmt?: string;
    alerta?: boolean;
    destaque?: "ok" | "warn";
  };

  const linhas: LinhaTotalizador[] = [
    { label: "Total de veículos", valor: tot.totalVeiculos, numFmt: FMT_INT },
    {
      label: "Veículos DISPONÍVEIS pra venda",
      valor: `${tot.qtDisponivel} (${tot.pctDisponivel.toFixed(1)}%)`,
      destaque: "ok",
    },
    {
      label: "Veículos com falta de documento",
      valor: `${tot.qtFaltaDoc} (${tot.pctFaltaDoc.toFixed(1)}%)`,
      destaque: "warn",
    },
    { label: "Capital travado (Σ entrada)", valor: tot.capitalTravado, numFmt: FMT_MONEY_INT },
    { label: "Valor de mercado (Σ venda)", valor: tot.valorMercado, numFmt: FMT_MONEY_INT },
    { label: "Margem potencial total", valor: tot.margemPotencial, numFmt: FMT_MONEY_INT },
    {
      label: "Margem média %",
      valor: tot.margemMediaPct ?? "—",
      numFmt: tot.margemMediaPct != null ? FMT_PCT : undefined,
    },
    {
      label: "KM médio da frota",
      valor: tot.kmMedio != null ? Math.round(tot.kmMedio) : "—",
      numFmt: tot.kmMedio != null ? FMT_KM : undefined,
    },
    {
      label: "Dias pátio médio",
      valor: tot.diasPatioMedio != null ? Math.round(tot.diasPatioMedio) : "—",
      numFmt: tot.diasPatioMedio != null ? '#,##0" dias"' : undefined,
    },
    {
      label: "Veículos com 60+ dias parados (inclui 90+)",
      valor: `${tot.qtMais60} (${tot.pctMais60.toFixed(1)}%)`,
    },
    {
      label: "Veículos com 90+ dias parados",
      valor: `${tot.qtMais90} (${tot.pctMais90.toFixed(1)}%)`,
    },
    {
      label: "Veículos com margem negativa",
      valor: `${tot.qtMargemNeg} (${tot.pctMargemNeg.toFixed(1)}%)`,
      alerta: tot.qtMargemNeg > 0,
    },
  ];

  for (const linha of linhas) {
    const r = ws.getRow(cursor);
    r.height = 26;

    // Cor do texto e fundo do valor (alerta vermelho > destaque ok/warn > neutro)
    const labelColor = linha.alerta
      ? { argb: COLOR.alertFg }
      : linha.destaque === "ok"
        ? { argb: COLOR.statusDisponivelFg }
        : linha.destaque === "warn"
          ? { argb: COLOR.statusFaltaDocFg }
          : undefined;
    const valorBgArgb = linha.alerta
      ? COLOR.marginNegBg
      : linha.destaque === "ok"
        ? COLOR.statusDisponivelBg
        : linha.destaque === "warn"
          ? COLOR.statusFaltaDocBg
          : COLOR.totalBg;

    // Label: B..H merged
    ws.mergeCells(cursor, COL.B_LOJA, cursor, COL.H_DIAS);
    const labelCell = r.getCell(COL.B_LOJA);
    labelCell.value = linha.label + (linha.alerta ? "  ⚠" : "");
    labelCell.font = {
      bold: true,
      size: 14,
      color: labelColor,
    };
    labelCell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
    labelCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLOR.totalBg },
    };
    labelCell.border = thinBorder();

    // Valor: I..M merged
    ws.mergeCells(cursor, COL.I_AQUISICAO, cursor, COL.M_LOCAL);
    const valorCell = r.getCell(COL.I_AQUISICAO);
    valorCell.value = linha.valor;
    if (linha.numFmt) valorCell.numFmt = linha.numFmt;
    valorCell.font = {
      bold: true,
      size: 14,
      color: labelColor,
    };
    valorCell.alignment = { horizontal: "right", vertical: "middle", indent: 1 };
    valorCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: valorBgArgb },
    };
    valorCell.border = thinBorder();

    // Coluna A vazia (mantém alinhamento visual)
    const aBlank = r.getCell(COL.A_SEQ);
    aBlank.border = thinBorder();
    aBlank.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLOR.totalBg },
    };

    cursor++;
  }

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

export async function baixarRelatorioGerencial(
  input: RelatorioGerencialInput,
): Promise<void> {
  const blob = await gerarRelatorioGerencial(input);
  const url = URL.createObjectURL(blob);
  const fileName = `relatorio-gerencial-estoque-${todayISO()}.xlsx`;
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
