/**
 * VENDAS USADOS MATRIZ — aba 7 (" MÉDIA VENDEDOR 2025", estática/congelada) e aba 8
 * ("MEDIA 2026", real — contagem de vendas por vendedor por mês, calculada).
 */

import type ExcelJS from "exceljs";
import { MEDIA_VENDEDOR_2025, MEDIA_VENDEDOR_2025_TOTAL } from "./dados-estaticos-2025";
import { FMT_INT, colLetter } from "./colunas";
import { FONT_DADO, FONT_HEADER_COLUNA, COR_HEADER_TABELA_BG, COR_ZEBRA_BG, COR_TEXTO_DADO, comVerticalMiddle } from "./estilo";
import { FUSO_BRASILIA } from "@/lib/utils/data-local";

const COLOR_HEADER_BG = COR_HEADER_TABELA_BG;
const COLOR_TOTAL_BG = COR_ZEBRA_BG;

/**
 * Mês (1-12) de uma data no calendário de Brasília — nunca `d.getMonth()` cru, que lê
 * o fuso de quem RODA o código (o navegador do usuário), não o fuso do negócio. Uma
 * venda perto da virada de mês fora de Brasília cairia no mês errado. Mesma técnica de
 * offset explícito usada em `coletar-dados.ts` pros limites de período.
 */
const FMT_MES_BRASILIA = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO_BRASILIA, month: "2-digit" });
function mesBrasilia(d: Date): number {
  return Number(FMT_MES_BRASILIA.format(d));
}

// ═══════════════════════════════════════════════════════════════════════════
// Aba 7 — estática
// ═══════════════════════════════════════════════════════════════════════════

export function renderAbaMediaVendedor2025(ws: ExcelJS.Worksheet): void {
  ws.getColumn(2).width = 24;
  ws.getColumn(3).width = 12;
  ws.getColumn(4).width = 10;
  for (const c of [2, 3, 4]) ws.getColumn(c).font = FONT_DADO;

  const header = ws.getRow(2);
  header.getCell(2).value = "VENDEDOR - 2025";
  header.getCell(3).value = "AGO A DEZ";
  header.getCell(4).value = "MÉDIA";
  for (const c of [2, 3, 4]) {
    const cell = header.getCell(c);
    cell.font = FONT_HEADER_COLUNA;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_HEADER_BG } };
    comVerticalMiddle(cell);
  }

  let r = 3;
  for (const linha of MEDIA_VENDEDOR_2025) {
    const row = ws.getRow(r);
    row.getCell(2).value = linha.vendedor;
    row.getCell(3).value = linha.agoADez;
    row.getCell(3).numFmt = FMT_INT;
    row.getCell(4).value = linha.media;
    for (const c of [2, 3, 4]) comVerticalMiddle(row.getCell(c));
    r++;
  }

  const totalRow = ws.getRow(r);
  totalRow.getCell(2).value = MEDIA_VENDEDOR_2025_TOTAL.vendedor;
  totalRow.getCell(3).value = MEDIA_VENDEDOR_2025_TOTAL.agoADez;
  totalRow.getCell(3).numFmt = FMT_INT;
  totalRow.getCell(4).value = MEDIA_VENDEDOR_2025_TOTAL.media;
  for (const c of [2, 3, 4]) {
    const cell = totalRow.getCell(c);
    cell.font = { name: FONT_DADO.name, bold: true, size: FONT_DADO.size, color: { argb: COR_TEXTO_DADO } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_TOTAL_BG } };
    comVerticalMiddle(cell);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Aba 8 — real, calculada
// ═══════════════════════════════════════════════════════════════════════════

/** Uma venda mínima, só o necessário pra contar por vendedor/mês. */
export type VendaParaMediaVendedor = {
  vendedorNome: string | null;
  dataVenda: Date | null;
};

const NOMES_MESES_ABREV = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];

/**
 * Renderiza a aba 8. `mesAtualIndex` (1-12) é sempre o mês corrente REAL (não o mês
 * selecionado no seletor do relatório) — a aba cobre Jan até esse mês.
 */
export function renderAbaMediaVendedorAtual(
  ws: ExcelJS.Worksheet,
  anoAtual: number,
  mesAtualIndex: number,
  vendasAnoAtual: VendaParaMediaVendedor[],
): void {
  // Matriz vendedor × mês (1..mesAtualIndex)
  const porVendedor = new Map<string, number[]>();
  for (const v of vendasAnoAtual) {
    if (!v.vendedorNome || !v.dataVenda) continue;
    const mes = mesBrasilia(v.dataVenda);
    if (mes < 1 || mes > mesAtualIndex) continue;
    const arr = porVendedor.get(v.vendedorNome) ?? new Array<number>(mesAtualIndex).fill(0);
    arr[mes - 1]++;
    porVendedor.set(v.vendedorNome, arr);
  }

  const vendedores = [...porVendedor.entries()]
    .map(([vendedor, meses]) => ({ vendedor, meses, total: meses.reduce((s, n) => s + n, 0) }))
    .sort((a, b) => b.total - a.total);

  const COL_VENDEDOR = 2;
  const COL_MES_INI = 3;
  const COL_TOTAL = COL_MES_INI + mesAtualIndex;
  const COL_MEDIA = COL_TOTAL + 1;

  ws.getColumn(COL_VENDEDOR).width = 24;
  for (let i = 0; i < mesAtualIndex; i++) ws.getColumn(COL_MES_INI + i).width = 7;
  ws.getColumn(COL_TOTAL).width = 9;
  ws.getColumn(COL_MEDIA).width = 9;
  for (let c = COL_VENDEDOR; c <= COL_MEDIA; c++) ws.getColumn(c).font = FONT_DADO;

  const header = ws.getRow(2);
  header.getCell(COL_VENDEDOR).value = `VENDEDOR - ${anoAtual}`;
  for (let i = 0; i < mesAtualIndex; i++) header.getCell(COL_MES_INI + i).value = NOMES_MESES_ABREV[i];
  header.getCell(COL_TOTAL).value = "TOTAL";
  header.getCell(COL_MEDIA).value = "MÉDIA";
  for (let c = COL_VENDEDOR; c <= COL_MEDIA; c++) {
    const cell = header.getCell(c);
    cell.font = FONT_HEADER_COLUNA;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_HEADER_BG } };
    comVerticalMiddle(cell);
  }

  const letraMesIni = colLetter(COL_MES_INI);
  const letraMesFim = colLetter(COL_MES_INI + mesAtualIndex - 1);

  let r = 3;
  const linhaIniDados = r;
  for (const linha of vendedores) {
    const row = ws.getRow(r);
    row.getCell(COL_VENDEDOR).value = linha.vendedor;
    for (let i = 0; i < mesAtualIndex; i++) {
      row.getCell(COL_MES_INI + i).value = linha.meses[i];
      row.getCell(COL_MES_INI + i).numFmt = FMT_INT;
    }
    // TOTAL e MÉDIA — fórmulas de verdade somando/mediando as células da própria linha.
    row.getCell(COL_TOTAL).value = {
      formula: `SUM(${letraMesIni}${r}:${letraMesFim}${r})`,
      result: linha.total,
    };
    row.getCell(COL_TOTAL).numFmt = FMT_INT;
    row.getCell(COL_MEDIA).value = {
      formula: `AVERAGE(${letraMesIni}${r}:${letraMesFim}${r})`,
      result: linha.total / mesAtualIndex,
    };
    for (let c = COL_VENDEDOR; c <= COL_MEDIA; c++) comVerticalMiddle(row.getCell(c));
    r++;
  }
  const linhaFimDados = r - 1;

  // Linha TOTAL (soma por mês + total geral + média geral)
  const totalRow = ws.getRow(r);
  totalRow.getCell(COL_VENDEDOR).value = "TOTAL";
  let totalGeral = 0;
  for (let i = 0; i < mesAtualIndex; i++) {
    const col = COL_MES_INI + i;
    const letra = colLetter(col);
    const somaMes = vendedores.reduce((s, v) => s + v.meses[i], 0);
    totalGeral += somaMes;
    totalRow.getCell(col).value = {
      formula: `SUM(${letra}${linhaIniDados}:${letra}${linhaFimDados})`,
      result: somaMes,
    };
    totalRow.getCell(col).numFmt = FMT_INT;
  }
  totalRow.getCell(COL_TOTAL).value = {
    formula: `SUM(${letraMesIni}${r}:${letraMesFim}${r})`,
    result: totalGeral,
  };
  totalRow.getCell(COL_TOTAL).numFmt = FMT_INT;
  totalRow.getCell(COL_MEDIA).value = {
    formula: `AVERAGE(${letraMesIni}${r}:${letraMesFim}${r})`,
    result: mesAtualIndex > 0 ? totalGeral / mesAtualIndex : 0,
  };
  for (let c = COL_VENDEDOR; c <= COL_MEDIA; c++) {
    const cell = totalRow.getCell(c);
    cell.font = { name: FONT_DADO.name, bold: true, size: FONT_DADO.size, color: { argb: COR_TEXTO_DADO } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_TOTAL_BG } };
    comVerticalMiddle(cell);
  }
}
