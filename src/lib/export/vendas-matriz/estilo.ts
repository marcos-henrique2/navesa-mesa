/**
 * VENDAS USADOS MATRIZ — estilo visual (cores, bordas, tipografia, alturas).
 *
 * Paleta RESTAURADA pra bater com o relatório original feito à mão pelo Marcos (9
 * screenshots de referência, mês a mês) — ele considerou a estilização anterior
 * ("corporativa", header cinza-claro, verde petróleo/terracota foscos, sem destaque
 * amarelo) desorganizada e pediu pra voltar ao visual dele: azul-marinho forte nos
 * banners/headers/totais, verde e vermelho VIVOS por categoria (própria × outras
 * lojas), e vermelho padrão em número negativo.
 *
 * Isso é estilo PURO — nenhuma fórmula, filtro ou valor calculado muda por causa
 * deste arquivo. Toda cor/tamanho/altura mora aqui; nenhum hex solto deve sobrar
 * nos renderers que importam este arquivo.
 */

import type ExcelJS from "exceljs";

export const FONTE = "Arial";

// ═══════════════════════════════════════════════════════════════════════════
// Paleta ARGB
// ═══════════════════════════════════════════════════════════════════════════

/** Header neutro (sub-cabeçalhos internos da aba RESUMO — "Pátio/Qtde/%" etc). */
export const COR_HEADER_TABELA_BG = "FFDDE3EA";
export const COR_HEADER_TABELA_FG = "FF1B2A41";

/**
 * Header da aba de detalhe (abas 1/2, linha de autofiltro) — azul acinzentado médio,
 * DIFERENTE do azul-marinho dos banners/totais (ver 20.png de referência).
 */
export const COR_HEADER_DETALHE_BG = "FF5B7FA6";
export const COR_HEADER_DETALHE_FG = "FFFFFFFF";

/** Banner categoria nível 1 — título principal de bloco (ex: "VENDIDO TOTAL") e TOTAL geral. */
export const COR_BANNER_N1_BG = "FF1B2A41";
export const COR_BANNER_N1_FG = "FFFFFFFF";

/**
 * Banner categoria nível 2 — sub-bloco (ex: "SOMENTE ESTOQUE PRÓPRIO"). No original do
 * Marcos todo banner de bloco (nível 1 ou 2) tem o MESMO tamanho/peso — sem marcador
 * "▪" nem fonte menor — por isso os valores aqui são idênticos aos de nível 1.
 */
export const COR_BANNER_N2_BG = COR_BANNER_N1_BG;
export const COR_BANNER_N2_FG = COR_BANNER_N1_FG;

/**
 * Par "estoque próprio × repasse outra loja" — verde/vermelho VIVOS (bate com
 * MARGENS/MARGENS VENDAS LOJISTAS/MARGENS VENDAS CLIENTES nas imagens de referência;
 * qual bloco usa qual cor depende da aba — ver nota em `gerar-workbook.ts`).
 */
export const COR_PROPRIO_BG = "FF1DA64A";
export const COR_PROPRIO_FG = "FFFFFFFF";
export const COR_REPASSE_BG = "FFE02424";
export const COR_REPASSE_FG = "FFFFFFFF";

/** Zebra striping (abas 1/2) — linhas pares. */
export const COR_ZEBRA_BG = "FFF2F4F7";

/** Texto padrão de dado (não mais preto puro). */
export const COR_TEXTO_DADO = "FF1F2937";
export const COR_NOTA_FG = "FF808080";

/** Bordas. */
export const COR_BORDA_FINA = "FFE2E5EA";
export const COR_BORDA_BLOCO = "FF1B2A41";

/** Vermelho padrão de número negativo — igual ao relatório original (não mais um tom "sóbrio"). */
export const COR_NEGATIVO = "FFFF0000";

/**
 * Amarelo vivo de destaque — usado em linhas isoladas que chamam atenção pra um recorte
 * específico (ex: "TOTAL ... SEM CONSIGNADOS" na aba RESUMO, linha de vendedor com DELTA
 * negativo na aba MEDIA) — igual ao relatório original do Marcos (19.png/26.png de
 * referência: fundo amarelo vivo + texto preto bold, não um tom pastel).
 */
export const COR_DESTAQUE_AMARELO_BG = "FFFFFF00";
export const COR_DESTAQUE_AMARELO_FG = "FF000000";

/**
 * Header 3º tom de azul (periwinkle claro) — usado no bloco de totais/médias no rodapé
 * das abas de detalhe (abas 1/2), distinto do navy dos banners/totais (COR_BANNER_N1_BG)
 * e do azul acinzentado médio do header de coluna (COR_HEADER_DETALHE_BG). Texto preto
 * bold, igual ao relatório original (21.png de referência).
 */
export const COR_HEADER_RESUMO_NUMERICO_BG = "FFB4C7E7";
export const COR_HEADER_RESUMO_NUMERICO_FG = "FF1B2A41";

/** Cor da dataBar da Margem Líquida — combina com o verde de "estoque próprio". */
export const COR_DATABAR_MARGEM = COR_PROPRIO_BG;

// ═══════════════════════════════════════════════════════════════════════════
// Tipografia (Arial em tudo — nunca Calibri)
// ═══════════════════════════════════════════════════════════════════════════

export const FONT_DADO = { name: FONTE, size: 10, color: { argb: COR_TEXTO_DADO } } as const;
export const FONT_HEADER_COLUNA = { name: FONTE, bold: true, size: 10, color: { argb: COR_HEADER_TABELA_FG } } as const;
export const FONT_HEADER_DETALHE = { name: FONTE, bold: true, size: 10, color: { argb: COR_HEADER_DETALHE_FG } } as const;
/** Header navy + texto branco (aba MÉDIA VENDEDOR) — mesmo navy do banner, tamanho de header de coluna. */
export const FONT_HEADER_NAVY = { name: FONTE, bold: true, size: 10, color: { argb: COR_BANNER_N1_FG } } as const;
export const FONT_BANNER_N1 = { name: FONTE, bold: true, size: 13, color: { argb: COR_BANNER_N1_FG } } as const;
/** Mesmo tamanho de nível 1 — o original não distingue banner de bloco × sub-bloco. */
export const FONT_BANNER_N2 = { name: FONTE, bold: true, size: 13, color: { argb: COR_BANNER_N2_FG } } as const;
export const FONT_NOTA = { name: FONTE, italic: true, size: 8, color: { argb: COR_NOTA_FG } } as const;
/** Header do bloco de totais/médias no rodapé das abas de detalhe — ver COR_HEADER_RESUMO_NUMERICO_BG. */
export const FONT_HEADER_RESUMO_NUMERICO = { name: FONTE, bold: true, size: 9, color: { argb: COR_HEADER_RESUMO_NUMERICO_FG } } as const;

// ═══════════════════════════════════════════════════════════════════════════
// Alturas
// ═══════════════════════════════════════════════════════════════════════════

export const ALTURA_BANNER_N1 = 22;
/** Mesma altura de nível 1 — ver nota em FONT_BANNER_N2. */
export const ALTURA_BANNER_N2 = ALTURA_BANNER_N1;

// ═══════════════════════════════════════════════════════════════════════════
// Marcador — o relatório original NÃO usa bullet/emoji em nenhum banner de bloco.
// ═══════════════════════════════════════════════════════════════════════════

export const MARCADOR_N2 = "";

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
// Linha TOTAL — faixa azul-marinho + texto branco bold (igual ao banner nível 1),
// como no relatório original. Usado em qualquer linha "TOTAL" de tabela simples
// (RESUMO, MÉDIA VENDEDOR) — nunca só bold em cinza.
// ═══════════════════════════════════════════════════════════════════════════

export function aplicarFundoTotal(cell: ExcelJS.Cell): void {
  cell.font = { name: FONTE, bold: true, size: 10, color: { argb: COR_BANNER_N1_FG } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COR_BANNER_N1_BG } };
}

/**
 * Fundo amarelo vivo + texto preto bold — ver COR_DESTAQUE_AMARELO_BG. Aplicado
 * estaticamente (cor já conhecida em JS no momento da geração), não via conditional
 * formatting — mesmo precedente de `aplicarZebra` abaixo.
 */
export function aplicarFundoDestaqueAmarelo(cell: ExcelJS.Cell): void {
  cell.font = { name: FONTE, bold: true, size: 10, color: { argb: COR_DESTAQUE_AMARELO_FG } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COR_DESTAQUE_AMARELO_BG } };
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
 * Vermelho padrão pra número negativo via conditional formatting `cellIs` — o
 * `numFmt` do Excel só aceita as 8 cores nomeadas (`[Red]`, `[Blue]`, …) ou um
 * índice de paleta legado (`[Color n]`), não um ARGB arbitrário; por isso o tom
 * (`COR_NEGATIVO`) só é possível via conditional formatting de verdade.
 */
export function condFormatNegativo(ws: ExcelJS.Worksheet, ref: string, priority: number): void {
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
