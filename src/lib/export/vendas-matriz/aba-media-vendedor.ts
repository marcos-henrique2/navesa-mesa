/**
 * VENDAS USADOS MATRIZ — aba 7 (" MÉDIA VENDEDOR 2025", estática/congelada) e aba 8
 * ("MEDIA 2026", real — contagem de vendas por vendedor por mês, calculada).
 */

import type ExcelJS from "exceljs";
import { MEDIA_VENDEDOR_2025, MEDIA_VENDEDOR_2025_TOTAL } from "./dados-estaticos-2025";
import { FMT_INT, FMT_DECIMAL2, colLetter } from "./colunas";
import {
  FONT_DADO, FONT_HEADER_NAVY, COR_BANNER_N1_BG, COR_DESTAQUE_AMARELO_BG,
  aplicarFundoTotal, comVerticalMiddle, condFormatNegativo,
} from "./estilo";
import { FUSO_BRASILIA } from "@/lib/utils/data-local";

// Header e linha TOTAL navy + texto branco (igual ao banner de bloco) — bate com o
// relatório original (26.png/27.png de referência), não o cinza-claro anterior.
const COLOR_HEADER_BG = COR_BANNER_N1_BG;

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
    cell.font = FONT_HEADER_NAVY;
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
    aplicarFundoTotal(cell);
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
 * selecionado no seletor do relatório).
 *
 * REGRA (confirmada com o Marcos, 02/10/2026 — item 4 da pendência "Vendas Usados
 * Matriz", 26.png de referência): só meses FECHADOS entram nesta aba — o mês corrente,
 * em andamento, fica de fora inteiramente (o relatório original nunca mostra o mês
 * atual aqui, só os fechados). Os meses fechados são agrupados em 2 blocos lado a lado:
 *   - Bloco B = os últimos 3 meses fechados.
 *   - Bloco A = todos os outros meses fechados (tudo antes do Bloco B).
 *   - DELTA = média(Bloco B) − média(Bloco A), por vendedor — queda de ritmo recente.
 * Tudo recalculado a partir de `mesAtualIndex` — nunca hardcode qual mês é "o último 3",
 * pra continuar correto conforme o ano avança.
 *
 * Casos de borda (sem dividir por zero, sem quebrar):
 *   - `mesAtualIndex <= 1` (Jan): nenhum mês fechado ainda — a aba só tem o header.
 *   - `mesAtualIndex` entre 2 e 4 (Fev-Abr): 1-3 meses fechados, todos cabem no Bloco B
 *     sozinho — Bloco A fica vazio (não existe) e não há coluna DELTA (nada pra comparar).
 */
export function renderAbaMediaVendedorAtual(
  ws: ExcelJS.Worksheet,
  anoAtual: number,
  mesAtualIndex: number,
  vendasAnoAtual: VendaParaMediaVendedor[],
): void {
  const COL_VENDEDOR = 2;
  ws.getColumn(COL_VENDEDOR).width = 24;
  ws.getColumn(COL_VENDEDOR).font = FONT_DADO;

  const header = ws.getRow(2);
  header.getCell(COL_VENDEDOR).value = `VENDEDOR - ${anoAtual}`;
  header.getCell(COL_VENDEDOR).font = FONT_HEADER_NAVY;
  header.getCell(COL_VENDEDOR).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_HEADER_BG } };
  comVerticalMiddle(header.getCell(COL_VENDEDOR));

  const nFechados = Math.max(0, mesAtualIndex - 1);
  if (nFechados === 0) return; // Jan — nenhum mês fechado, nada além do header.

  const mesesFechados = Array.from({ length: nFechados }, (_, i) => i + 1); // [1..nFechados]
  const nBlocoB = Math.min(3, nFechados);
  const mesesBlocoB = mesesFechados.slice(nFechados - nBlocoB);
  const mesesBlocoA = mesesFechados.slice(0, nFechados - nBlocoB);
  const temBlocoA = mesesBlocoA.length > 0;

  // Matriz vendedor × mês FECHADO (1..nFechados) — mês corrente (mesAtualIndex) excluído.
  const porVendedor = new Map<string, number[]>();
  for (const v of vendasAnoAtual) {
    if (!v.vendedorNome || !v.dataVenda) continue;
    const mes = mesBrasilia(v.dataVenda);
    if (mes < 1 || mes > nFechados) continue;
    const arr = porVendedor.get(v.vendedorNome) ?? new Array<number>(nFechados).fill(0);
    arr[mes - 1]++;
    porVendedor.set(v.vendedorNome, arr);
  }

  const vendedores = [...porVendedor.entries()]
    .map(([vendedor, meses]) => ({ vendedor, meses, total: meses.reduce((s, n) => s + n, 0) }))
    .sort((a, b) => b.total - a.total);

  // ─── Layout de colunas: Bloco A (se existir) + Bloco B + DELTA (só se os 2 blocos existirem) ───
  let colCursor = COL_VENDEDOR + 1;
  let colIniA = -1, colTotalA = -1, colMediaA = -1;
  if (temBlocoA) {
    colIniA = colCursor;
    colCursor += mesesBlocoA.length;
    colTotalA = colCursor++;
    colMediaA = colCursor++;
  }
  const colIniB = colCursor;
  colCursor += mesesBlocoB.length;
  const colTotalB = colCursor++;
  const colMediaB = colCursor++;
  const colDelta = temBlocoA ? colCursor++ : -1;
  const ultimaCol = colCursor - 1;

  for (let c = COL_VENDEDOR + 1; c <= ultimaCol; c++) {
    ws.getColumn(c).width = 7;
    ws.getColumn(c).font = FONT_DADO;
  }
  for (const col of [colTotalA, colMediaA, colTotalB, colMediaB, colDelta]) {
    if (col > 0) ws.getColumn(col).width = 9;
  }

  const escreverHeaderBloco = (meses: number[], colIni: number, colTotal: number, colMedia: number): void => {
    for (let i = 0; i < meses.length; i++) header.getCell(colIni + i).value = NOMES_MESES_ABREV[meses[i] - 1];
    header.getCell(colTotal).value = "TOTAL";
    header.getCell(colMedia).value = "MÉDIA";
  };
  if (temBlocoA) escreverHeaderBloco(mesesBlocoA, colIniA, colTotalA, colMediaA);
  escreverHeaderBloco(mesesBlocoB, colIniB, colTotalB, colMediaB);
  if (colDelta > 0) header.getCell(colDelta).value = "DELTA";
  for (let c = COL_VENDEDOR + 1; c <= ultimaCol; c++) {
    const cell = header.getCell(c);
    cell.font = FONT_HEADER_NAVY;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_HEADER_BG } };
    comVerticalMiddle(cell);
  }

  /** Escreve os meses de um bloco + TOTAL/MÉDIA (fórmula de verdade) numa linha de vendedor. Devolve o total do bloco. */
  const escreverBlocoLinha = (
    row: ExcelJS.Row,
    linha: number,
    mesesDoVendedor: number[],
    meses: number[],
    colIni: number,
    colTotal: number,
    colMedia: number,
  ): number => {
    let total = 0;
    for (let i = 0; i < meses.length; i++) {
      const qtd = mesesDoVendedor[meses[i] - 1];
      total += qtd;
      row.getCell(colIni + i).value = qtd;
      row.getCell(colIni + i).numFmt = FMT_INT;
    }
    const letraIni = colLetter(colIni);
    const letraFim = colLetter(colIni + meses.length - 1);
    row.getCell(colTotal).value = { formula: `SUM(${letraIni}${linha}:${letraFim}${linha})`, result: total };
    row.getCell(colTotal).numFmt = FMT_INT;
    row.getCell(colMedia).value = { formula: `AVERAGE(${letraIni}${linha}:${letraFim}${linha})`, result: total / meses.length };
    row.getCell(colMedia).numFmt = FMT_DECIMAL2;
    return total;
  };

  let r = 3;
  const linhaIniDados = r;
  const deltas: number[] = [];
  for (const linha of vendedores) {
    const row = ws.getRow(r);
    row.getCell(COL_VENDEDOR).value = linha.vendedor;

    let mediaA = 0;
    if (temBlocoA) {
      const totalA = escreverBlocoLinha(row, r, linha.meses, mesesBlocoA, colIniA, colTotalA, colMediaA);
      mediaA = totalA / mesesBlocoA.length;
    }
    const totalB = escreverBlocoLinha(row, r, linha.meses, mesesBlocoB, colIniB, colTotalB, colMediaB);
    // Confirmado com o Marcos em 02/10/2026: divide sempre por 3 (tamanho do bloco),
    // mesmo quando o vendedor tem mês zerado dentro do bloco — não é bug, é intencional.
    const mediaB = totalB / mesesBlocoB.length;

    if (colDelta > 0) {
      const delta = mediaB - mediaA;
      deltas.push(delta);
      const letraMediaA = colLetter(colMediaA);
      const letraMediaB = colLetter(colMediaB);
      const deltaCell = row.getCell(colDelta);
      deltaCell.value = { formula: `${letraMediaB}${r}-${letraMediaA}${r}`, result: delta };
      deltaCell.numFmt = FMT_DECIMAL2;

      // Linha inteira em destaque amarelo quando o ritmo caiu (DELTA < 0) — cor já
      // conhecida em JS no momento da geração (mesmo precedente de `aplicarZebra`), não
      // conditional formatting. O vermelho da célula DELTA em si é CF de verdade (abaixo),
      // igual ao resto do relatório.
      if (delta < 0) {
        for (let c = COL_VENDEDOR; c <= ultimaCol; c++) {
          row.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COR_DESTAQUE_AMARELO_BG } };
        }
      }
    }

    for (let c = COL_VENDEDOR; c <= ultimaCol; c++) comVerticalMiddle(row.getCell(c));
    r++;
  }
  const linhaFimDados = r - 1;
  const temVendedores = linhaFimDados >= linhaIniDados;

  // ─── Linha TOTAL (soma por mês + total geral + média geral, por bloco) ───
  const totalRow = ws.getRow(r);
  totalRow.getCell(COL_VENDEDOR).value = "TOTAL";

  const escreverBlocoTotal = (meses: number[], colIni: number, colTotal: number, colMedia: number): void => {
    let totalGeral = 0;
    for (let i = 0; i < meses.length; i++) {
      const col = colIni + i;
      const letra = colLetter(col);
      const somaMes = vendedores.reduce((s, v) => s + v.meses[meses[i] - 1], 0);
      totalGeral += somaMes;
      const cell = totalRow.getCell(col);
      cell.value = temVendedores ? { formula: `SUM(${letra}${linhaIniDados}:${letra}${linhaFimDados})`, result: somaMes } : 0;
      cell.numFmt = FMT_INT;
    }
    const letraIni = colLetter(colIni);
    const letraFim = colLetter(colIni + meses.length - 1);
    totalRow.getCell(colTotal).value = { formula: `SUM(${letraIni}${r}:${letraFim}${r})`, result: totalGeral };
    totalRow.getCell(colTotal).numFmt = FMT_INT;
    totalRow.getCell(colMedia).value = {
      formula: `AVERAGE(${letraIni}${r}:${letraFim}${r})`,
      result: meses.length > 0 ? totalGeral / meses.length : 0,
    };
    totalRow.getCell(colMedia).numFmt = FMT_DECIMAL2;
  };

  if (temBlocoA) escreverBlocoTotal(mesesBlocoA, colIniA, colTotalA, colMediaA);
  escreverBlocoTotal(mesesBlocoB, colIniB, colTotalB, colMediaB);

  if (colDelta > 0) {
    // TOTAL do DELTA = SOMA dos deltas individuais de cada vendedor, não
    // média(Bloco B)-média(Bloco A) dos totais gerais — confirmado contra o relatório
    // original (26.png: vendedores com delta -17,00/-9,80/-9,00 somam -35,80, exatamente
    // o TOTAL mostrado na coluna DELTA da linha TOTAL).
    const letraDelta = colLetter(colDelta);
    const somaDeltas = deltas.reduce((s, d) => s + d, 0);
    const cell = totalRow.getCell(colDelta);
    cell.value = temVendedores ? { formula: `SUM(${letraDelta}${linhaIniDados}:${letraDelta}${linhaFimDados})`, result: somaDeltas } : 0;
    cell.numFmt = FMT_DECIMAL2;
  }

  for (let c = COL_VENDEDOR; c <= ultimaCol; c++) {
    const cell = totalRow.getCell(c);
    aplicarFundoTotal(cell);
    comVerticalMiddle(cell);
  }

  // Vermelho de negativo na coluna DELTA (linhas de vendedor + linha TOTAL) — CF de
  // verdade, mesmo padrão do resto do relatório (ver estilo.ts).
  if (colDelta > 0 && temVendedores) {
    const letraDelta = colLetter(colDelta);
    condFormatNegativo(ws, `${letraDelta}${linhaIniDados}:${letraDelta}${r}`, 1);
  }
}
