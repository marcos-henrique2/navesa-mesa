/**
 * VENDAS USADOS MATRIZ — estilo visual (cores, bordas, tipografia, alturas).
 *
 * Especificação da Uma (UX), aprovada pelo Marcos: visual corporativo/profissional,
 * sem grade completa (só as bordas descritas abaixo), zebra striping nas abas 1/2 e
 * borda de bloco navy em cada bloco empilhado (MARGENS/RESUMO) e ao redor da tabela
 * inteira (abas 1/2).
 *
 * Isso é estilo PURO — nenhuma fórmula, filtro ou valor calculado muda por causa
 * deste arquivo. Toda cor/tamanho/altura referenciado pelo handoff da Uma mora
 * aqui; nenhum hex solto deve sobrar nos 6 renderers que importam este arquivo.
 */

import type ExcelJS from "exceljs";

export const FONTE = "Arial";

// ═══════════════════════════════════════════════════════════════════════════
// Paleta ARGB
// ═══════════════════════════════════════════════════════════════════════════

/** Header de tabela (linha de cabeçalho de coluna, abas 1/2 e cabeçalhos internos). */
export const COR_HEADER_TABELA_BG = "FFDDE3EA";
export const COR_HEADER_TABELA_FG = "FF1B2A41";

/** Banner categoria nível 1 — título principal de bloco (ex: "VENDIDO TOTAL"). */
export const COR_BANNER_N1_BG = "FF1B2A41";
export const COR_BANNER_N1_FG = "FFFFFFFF";

/** Banner categoria nível 2 — sub-bloco (ex: "SOMENTE ESTOQUE PRÓPRIO"). */
export const COR_BANNER_N2_BG = "FF3B5470";
export const COR_BANNER_N2_FG = "FFFFFFFF";

/** Par "estoque próprio × repasse outra loja" — troca o verde/vermelho genérico antigo. */
export const COR_PROPRIO_BG = "FF1E6B52";
export const COR_PROPRIO_FG = "FFFFFFFF";
export const COR_REPASSE_BG = "FF8A4B18";
export const COR_REPASSE_FG = "FFFFFFFF";

/** Par "lojista × cliente final". */
export const COR_LOJISTA_BG = "FF4A5D8A";
export const COR_LOJISTA_FG = "FFFFFFFF";
export const COR_CLIENTE_BG = "FF7A6B47";
export const COR_CLIENTE_FG = "FFFFFFFF";

/** Zebra striping (abas 1/2) — linhas pares. */
export const COR_ZEBRA_BG = "FFF2F4F7";

/** Texto padrão de dado (não mais preto puro). */
export const COR_TEXTO_DADO = "FF1F2937";
export const COR_NOTA_FG = "FF808080";

/** Bordas. */
export const COR_BORDA_FINA = "FFE2E5EA";
export const COR_BORDA_BLOCO = "FF1B2A41";

/** Vermelho sóbrio de número negativo (substitui o vermelho vivo anterior). */
export const COR_NEGATIVO = "FFB3261E";

/** Cor da dataBar da Margem Líquida — combina com o par próprio×repasse. */
export const COR_DATABAR_MARGEM = COR_PROPRIO_BG;

// ═══════════════════════════════════════════════════════════════════════════
// Tipografia (Arial em tudo — nunca Calibri)
// ═══════════════════════════════════════════════════════════════════════════

export const FONT_DADO = { name: FONTE, size: 10, color: { argb: COR_TEXTO_DADO } } as const;
export const FONT_HEADER_COLUNA = { name: FONTE, bold: true, size: 10, color: { argb: COR_HEADER_TABELA_FG } } as const;
export const FONT_BANNER_N1 = { name: FONTE, bold: true, size: 13, color: { argb: COR_BANNER_N1_FG } } as const;
export const FONT_BANNER_N2 = { name: FONTE, bold: true, size: 11, color: { argb: COR_BANNER_N2_FG } } as const;
export const FONT_NOTA = { name: FONTE, italic: true, size: 8, color: { argb: COR_NOTA_FG } } as const;

// ═══════════════════════════════════════════════════════════════════════════
// Alturas
// ═══════════════════════════════════════════════════════════════════════════

export const ALTURA_BANNER_N1 = 22;
export const ALTURA_BANNER_N2 = 18;

// ═══════════════════════════════════════════════════════════════════════════
// Marcador — único indicador visual extra (sem emoji), só em sub-bloco nível 2
// ═══════════════════════════════════════════════════════════════════════════

export const MARCADOR_N2 = "▪ ";

// ═══════════════════════════════════════════════════════════════════════════
// Bordas
// ═══════════════════════════════════════════════════════════════════════════

/** Fina, entre linhas de dado consecutivas — só a borda inferior (sem grade nas colunas). */
export function bordaInferiorFina(): Partial<ExcelJS.Borders> {
  return { bottom: { style: "thin", color: { argb: COR_BORDA_FINA } } };
}

/** Média, fechando a linha de cabeçalho por baixo (separa header de dados). */
export function bordaInferiorMedia(): Partial<ExcelJS.Borders> {
  return { bottom: { style: "medium", color: { argb: COR_BORDA_BLOCO } } };
}

/**
 * Contorna por fora o retângulo [linhaIni..linhaFim] × [colIni..colFim] com borda
 * grossa navy — usado tanto pra "tabela inteira" (abas 1/2) quanto pra cada bloco
 * empilhado (MARGENS/RESUMO). Só sobrescreve o lado externo de cada célula de
 * borda (top/bottom/left/right conforme a posição) — preserva qualquer borda
 * fina/média já aplicada nos outros lados da mesma célula.
 */
export function aplicarBordaBloco(
  ws: ExcelJS.Worksheet,
  linhaIni: number,
  linhaFim: number,
  colIni: number,
  colFim: number,
): void {
  const lado: Partial<ExcelJS.Border> = { style: "thick", color: { argb: COR_BORDA_BLOCO } };
  for (let r = linhaIni; r <= linhaFim; r++) {
    for (let c = colIni; c <= colFim; c++) {
      const cell = ws.getCell(r, c);
      const atual = cell.border ?? {};
      const novo: Partial<ExcelJS.Borders> = { ...atual };
      if (r === linhaIni) novo.top = lado;
      if (r === linhaFim) novo.bottom = lado;
      if (c === colIni) novo.left = lado;
      if (c === colFim) novo.right = lado;
      cell.border = novo;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Alinhamento vertical padrão
// ═══════════════════════════════════════════════════════════════════════════

/** Funde `vertical: "middle"` num alignment já existente, sem perder horizontal/wrapText. */
export function comVerticalMiddle(cell: ExcelJS.Cell): void {
  cell.alignment = { ...cell.alignment, vertical: "middle" };
}

// ═══════════════════════════════════════════════════════════════════════════
// Zebra striping
// ═══════════════════════════════════════════════════════════════════════════

/** Aplica o fundo zebra na linha inteira quando `numeroLinhaTabela` (1-based) é par. */
export function aplicarZebra(
  ws: ExcelJS.Worksheet,
  linha: number,
  colIni: number,
  colFim: number,
  numeroLinhaTabela: number,
): void {
  if (numeroLinhaTabela % 2 !== 0) return;
  for (let c = colIni; c <= colFim; c++) {
    ws.getCell(linha, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COR_ZEBRA_BG } };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Conditional formatting
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Vermelho sóbrio pra número negativo via conditional formatting `cellIs` — o
 * `numFmt` do Excel só aceita as 8 cores nomeadas (`[Red]`, `[Blue]`, …) ou um
 * índice de paleta legado (`[Color n]`), não um ARGB arbitrário; por isso o tom
 * customizado (`COR_NEGATIVO`) só é possível via conditional formatting de verdade.
 */
export function condFormatNegativoSobrio(ws: ExcelJS.Worksheet, ref: string, priority: number): void {
  ws.addConditionalFormatting({
    ref,
    rules: [
      {
        type: "cellIs",
        operator: "lessThan",
        formulae: [0],
        priority,
        style: { font: { color: { argb: COR_NEGATIVO } } },
      },
    ],
  });
}

/**
 * Os typings do ExcelJS 4.4 (`DataBarRuleType`) não declaram `color`, mas o
 * xform de escrita (`lib/xlsx/xform/sheet/cf/databar-xform.js`) lê e grava
 * `model.color` normalmente — o campo existe em runtime, só falta no `.d.ts`.
 * Este tipo local só completa o typing pra não precisar de `any`.
 */
type DataBarRuleComCor = ExcelJS.DataBarRuleType & { color?: Partial<ExcelJS.Color> };

/** DataBar nativa do ExcelJS (barra de progresso dentro da célula) — não é iconSet nem semáforo. */
export function condFormatDataBar(ws: ExcelJS.Worksheet, ref: string, priority: number, corArgb: string): void {
  const regra: DataBarRuleComCor = {
    type: "dataBar",
    minLength: 0,
    maxLength: 100,
    showValue: true,
    gradient: false,
    cfvo: [{ type: "min" }, { type: "max" }],
    color: { argb: corArgb },
    priority,
  };
  ws.addConditionalFormatting({ ref, rules: [regra as unknown as ExcelJS.DataBarRuleType] });
}
