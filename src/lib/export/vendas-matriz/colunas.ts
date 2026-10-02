/**
 * VENDAS USADOS MATRIZ — mapa de colunas das abas 1/2 (32 colunas, B..AG — A em branco).
 *
 * Números são 1-indexed conforme exceljs (A=1, B=2, …). `M, P, Q, R, T, V, X, Z, AA, AB`
 * são sempre fórmulas — ver `aba-detalhe.ts`.
 */

export const COL = {
  A: 1,
  B_SEQ: 2,
  C_LOJA_ORIGEM: 3,
  D_DESCRICAO: 4,
  E_COR: 5,
  F_MARCA: 6,
  G_PLACA: 7,
  H_ANO_MODELO: 8,
  I_KM: 9,
  J_DIAS: 10,
  K_NF_ENTRADA: 11,
  L_VALORIZA: 12,
  M_CUSTO_REAL: 13,
  N_VALOR_FIPE: 14,
  O_VALOR_VENDA: 15,
  P_PCT_FIPE: 16,
  Q_LUCRO_BRUTO: 17,
  R_PCT_LUCRO_BRUTO: 18,
  S_DESPESA_GERAL: 19,
  T_PCT_DESPESA_GERAL: 20,
  U_FPLAN: 21,
  V_PCT_FPLAN: 22,
  W_IMPOSTOS: 23,
  X_PCT_IMPOSTOS: 24,
  Y_COMISSAO: 25,
  Z_PCT_COMISSAO: 26,
  AA_MARGEM_LIQUIDA: 27,
  AB_PCT_MARGEM: 28,
  AC_USADO_TROCA: 29,
  AD_FINANCIOU: 30,
  AE_CLIENTE: 31,
  AF_LOJISTA: 32,
  AG_VENDEDOR: 33,
} as const;

/** Última coluna com dado (AG) — a largura do título mergeado B..AG usa isso. */
export const ULTIMA_COL = COL.AG_VENDEDOR;

/**
 * Linha 1 = espaçador em branco (baixa, sem título — igual ao arquivo original),
 * linha 2 = header, linha 3 = nota explicativa (só sob a coluna M), dados a
 * partir da linha 4.
 */
export const NOTA_ROW = 3;
export const DATA_START_ROW = 4;

// Fontes, cores, bordas e alturas centralizadas em `estilo.ts` (visual corporativo
// aprovado pelo Marcos) — não redefinir localmente, sempre importar de lá.

export const HEADERS: Record<number, string> = {
  [COL.B_SEQ]: "#",
  [COL.C_LOJA_ORIGEM]: "LOJA DE ORIGEM",
  [COL.D_DESCRICAO]: "DESCRIÇÃO DO VEÍCULO",
  [COL.E_COR]: "COR",
  [COL.F_MARCA]: "MARCA",
  [COL.G_PLACA]: "PLACA",
  [COL.H_ANO_MODELO]: "ANO/MODELO",
  [COL.I_KM]: "KM",
  [COL.J_DIAS]: "DIAS",
  [COL.K_NF_ENTRADA]: "NF ENTRADA",
  [COL.L_VALORIZA]: "VALORIZA",
  [COL.M_CUSTO_REAL]: "CUSTO REAL",
  [COL.N_VALOR_FIPE]: "VALOR FIPE",
  [COL.O_VALOR_VENDA]: "VALOR DA VENDA",
  [COL.P_PCT_FIPE]: "%FIPE",
  [COL.Q_LUCRO_BRUTO]: "LUCRO BRUTO",
  [COL.R_PCT_LUCRO_BRUTO]: "%",
  [COL.S_DESPESA_GERAL]: "DESPESA GERAL",
  [COL.T_PCT_DESPESA_GERAL]: "%",
  [COL.U_FPLAN]: "F PLAN",
  [COL.V_PCT_FPLAN]: "%",
  [COL.W_IMPOSTOS]: "IMPOSTOS",
  [COL.X_PCT_IMPOSTOS]: "%",
  [COL.Y_COMISSAO]: "COMISSÃO",
  [COL.Z_PCT_COMISSAO]: "%",
  [COL.AA_MARGEM_LIQUIDA]: "MARGEM LÍQUIDA",
  [COL.AB_PCT_MARGEM]: "%MARGEM",
  [COL.AC_USADO_TROCA]: "USADO NA TROCA",
  [COL.AD_FINANCIOU]: "FINANCIOU",
  [COL.AE_CLIENTE]: "CLIENTE",
  [COL.AF_LOJISTA]: "LOJISTA",
  [COL.AG_VENDEDOR]: "VENDEDOR",
};

export const COL_WIDTHS: Record<number, number> = {
  [COL.A]: 2,
  // B..J medidos direto no arquivo original (VENDAS USADOS MATRIZ - AGOSTO 2026.xlsx).
  [COL.B_SEQ]: 7.4,
  [COL.C_LOJA_ORIGEM]: 18.3,
  [COL.D_DESCRICAO]: 63.7,
  [COL.E_COR]: 13.6,
  [COL.F_MARCA]: 13.6,
  [COL.G_PLACA]: 11.2,
  [COL.H_ANO_MODELO]: 10.4,
  [COL.I_KM]: 9.9,
  [COL.J_DIAS]: 8.4,
  [COL.K_NF_ENTRADA]: 13,
  [COL.L_VALORIZA]: 12,
  [COL.M_CUSTO_REAL]: 13,
  [COL.N_VALOR_FIPE]: 13,
  [COL.O_VALOR_VENDA]: 13,
  [COL.P_PCT_FIPE]: 9,
  [COL.Q_LUCRO_BRUTO]: 13,
  [COL.R_PCT_LUCRO_BRUTO]: 8,
  [COL.S_DESPESA_GERAL]: 13,
  [COL.T_PCT_DESPESA_GERAL]: 8,
  [COL.U_FPLAN]: 12,
  [COL.V_PCT_FPLAN]: 8,
  [COL.W_IMPOSTOS]: 12,
  [COL.X_PCT_IMPOSTOS]: 8,
  [COL.Y_COMISSAO]: 12,
  [COL.Z_PCT_COMISSAO]: 8,
  [COL.AA_MARGEM_LIQUIDA]: 13,
  [COL.AB_PCT_MARGEM]: 9,
  [COL.AC_USADO_TROCA]: 11,
  [COL.AD_FINANCIOU]: 10,
  [COL.AE_CLIENTE]: 28,
  [COL.AF_LOJISTA]: 9,
  [COL.AG_VENDEDOR]: 22,
};

// Formatos numéricos (mesma convenção de analise-navesa.ts)
export const FMT_MONEY = '"R$" #,##0.00';
export const FMT_PERCENT = "0.00%";
export const FMT_INT = "#,##0";

// Negativo em vermelho (Lucro Bruto/Margem Líquida e as % correspondentes) agora é
// conditional formatting de verdade (`condFormatNegativoSobrio` em `estilo.ts`), não
// mais seção `[Red]` do numFmt — o tom sóbrio pedido (COR_NEGATIVO) é um ARGB
// customizado, e `[Red]` só aceita as 8 cores nomeadas do Excel.

/** Converte número de coluna (1-indexed) pra letra de coluna Excel (1→A, 27→AA, …). */
export function colLetter(colNum: number): string {
  let n = colNum;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Mapa pronto letra-de-coluna pra cada campo — evita recomputar colLetter em todo lugar. */
export const LETRA: Record<keyof typeof COL, string> = Object.fromEntries(
  Object.entries(COL).map(([k, v]) => [k, colLetter(v)]),
) as Record<keyof typeof COL, string>;

/**
 * Escapa aspas duplas pra uso seguro dentro de um literal string de fórmula Excel
 * (`"algo"` → `""algo""` quando o próprio texto já contém `"`).
 */
export function escaparAspasFormula(s: string): string {
  return s.replace(/"/g, '""');
}

/**
 * Monta uma referência de range entre abas, sempre com aspas simples no nome da aba
 * (o nome quase sempre tem espaço) e `$` fixando linha/coluna — ex:
 * `'VENDAS USADOS SETEMBRO MATRIZ'!$O$3:$O$85`.
 */
export function rangeEntreAbas(nomeAba: string, colNum: number, linhaIni: number, linhaFim: number): string {
  const letra = colLetter(colNum);
  return `'${nomeAba}'!$${letra}$${linhaIni}:$${letra}$${linhaFim}`;
}
