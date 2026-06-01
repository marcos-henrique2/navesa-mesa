/**
 * EXPORT ANÁLISE NAVESA — V2
 *
 * Gera 1 .xlsx no formato "USADOS ANALISE NAVESA" com layout fiel à planilha modelo do
 * Marcos, agora com totalizadores, KPIs, cores condicionais e observações automáticas
 * de recorrência de cliente.
 *
 * V2 muda a biblioteca de xlsx (SheetJS) para `exceljs` — necessário porque SheetJS
 * community não suporta cores/estilos de células. As assinaturas públicas mantêm-se
 * compatíveis, mas agora são assíncronas (`Promise<Blob>`), pois `workbook.xlsx.writeBuffer`
 * é async.
 *
 * Estrutura do arquivo (V4 — header simplificado):
 *   1. Linha 1: título merged (B1:AM1) "USADOS ANÁLISE NAVESA — [LOJA] — PERÍODO [DE a ATÉ]"
 *   2. Linha 2: header único por coluna com descrição inline (wrap)
 *   3. Dados (linha 3+): uma venda por linha, 38 colunas (B..AM)
 *   4. Totalizadores: TOTAL, MÉDIA, QT VENDAS
 *   5. KPIs: bloco visual com indicadores agregados
 */

import ExcelJS from "exceljs";
import type { VendaParsed } from "@/lib/parsers/nbs-vendas-xlsx";
import type { CustoDetalhado } from "@/lib/parsers/nbs-custos-xls";
import { indexarClientes, chaveCliente } from "@/lib/analytics/clientes";

// ═══════════════════════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════════════════════

export type AnaliseNavesaInput = {
  /** Vendas filtradas (renderizadas na tela). Vai pras linhas de dados. */
  vendas: VendaParsed[];
  /** Todas as vendas do dataset (não filtradas) — usadas pra contar recorrência. */
  todasVendas: VendaParsed[];
  custosPorPlaca: Record<string, CustoDetalhado>;
  /** Nome da loja filtrada na tela (ou "TODAS" se filtro = all). */
  empresa: string;
  /** Data inicial do filtro (yyyy-mm-dd) — "" se sem filtro. */
  dataDe: string;
  /** Data final do filtro (yyyy-mm-dd) — "" se sem filtro. */
  dataAte: string;
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function fmtDateBR(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1].slice(2)}`;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Cores (ARGB — exceljs usa AARRGGBB)
const COLOR = {
  yellowSoft: "FFFEF3C7",
  redSoftBg: "FFFEE2E2",
  redSoftFg: "FF991B1B",
  greenSoftBg: "FFD1FAE5",
  greenSoftFg: "FF065F46",
  blueSoftBg: "FFDBEAFE",
  grayLight: "FFE5E7EB",
  grayHeader: "FFF3F4F6",
  // V4: faixa de título no topo
  titleBg: "FF374151",
  titleFg: "FFFFFFFF",
} as const;

// Formatos numéricos
const FMT_MONEY = '"R$" #,##0.00';
const FMT_PERCENT = "0.00%";
const FMT_INT = "#,##0";

// ═══════════════════════════════════════════════════════════════════════════
// COLUNAS (1-indexed conforme exceljs — A=1, B=2, …)
// ═══════════════════════════════════════════════════════════════════════════

// Layout: A vazio. Dados começam na coluna B. Última coluna agora é AM (39).
// V6: ordem lógica (valor antes do cálculo). Bloco M..S reordenado:
//   M = CUSTO REAL (entrada - valoriza)        ← era N
//   N = VALOR FIPE                              ← era R
//   O = CUSTO REAL X FIPE %                     ← era M
//   P = VALOR NF VENDA                          ← era O
//   Q = MARGEM BRUTA                            ← era P
//   R = % MARGEM BRUTA                          ← era Q
//   S = VENDA X FIPE %                          (mantém posição)
const COL = {
  A: 1,
  B_SEQ: 2,
  C_VEICULO: 3,
  D_MARCA: 4,
  E_PLACA: 5,
  F_ANOMODELO: 6,
  G_KM: 7,
  H_COR: 8,
  I_VALOR_ENTRADA: 9,
  J_DIAS_PATIO: 10,
  K_CAUTELAR: 11,
  L_VALORIZA: 12,
  M_CUSTO_REAL: 13,
  N_FIPE: 14,
  O_CUSTO_FIPE_PCT: 15,
  P_VALOR_VENDA: 16,
  Q_MARGEM_BRUTA: 17,
  R_PCT_BRUTA: 18,
  S_PCT_FIPE: 19,
  T_OFICINA: 20,
  U_PCT_OFICINA: 21,
  V_FORPLAN: 22,
  W_PCT_FORPLAN: 23,
  X_IMPOSTOS: 24,
  Y_PCT_IMPOSTOS: 25,
  Z_COMISSAO: 26,
  AA_PCT_COMISSAO: 27,
  AB_CUSTO_TOTAL: 28,
  AC_MARGEM_LIQ: 29,
  AD_PCT_LIQ: 30,
  AE_TRADE: 31,
  AF_FINANCIOU: 32,
  AG_DOCUMENTO: 33,
  AH_CLIENTE: 34,
  AI_LOJISTA: 35,
  AJ_VENDEDOR: 36,
  AK_OBSERVACOES: 37,
  AL_LOJA: 38,
  AM_OBS_EXTRA: 39,
} as const;

const TOTAL_COLS = 39;

// ═══════════════════════════════════════════════════════════════════════════
// HEADERS (linha 2) — V4: header único por coluna com descrição inline
// ═══════════════════════════════════════════════════════════════════════════

const HEADERS: Record<number, string> = {
  [COL.B_SEQ]: "SEQ",
  [COL.C_VEICULO]: "VEÍCULO VENDIDO",
  [COL.D_MARCA]: "MARCA",
  [COL.E_PLACA]: "PLACA",
  [COL.F_ANOMODELO]: "ANO/MODELO",
  [COL.G_KM]: "KM",
  [COL.H_COR]: "COR",
  [COL.I_VALOR_ENTRADA]: "VALOR NF ENTRADA",
  [COL.J_DIAS_PATIO]: "DIAS PÁTIO",
  [COL.K_CAUTELAR]: "CAUTELAR",
  [COL.L_VALORIZA]: "VALORIZA (ganhos indiretos)",
  [COL.M_CUSTO_REAL]: "CUSTO REAL (entrada - valoriza)",
  [COL.N_FIPE]: "VALOR FIPE",
  [COL.O_CUSTO_FIPE_PCT]: "CUSTO REAL X FIPE %",
  [COL.P_VALOR_VENDA]: "VALOR NF VENDA",
  [COL.Q_MARGEM_BRUTA]: "MARGEM BRUTA (venda - custo real)",
  [COL.R_PCT_BRUTA]: "% MARGEM BRUTA",
  [COL.S_PCT_FIPE]: "VENDA X FIPE %",
  [COL.T_OFICINA]: "DESPESA GERAL (oficina)",
  [COL.U_PCT_OFICINA]: "% DESPESAS",
  [COL.V_FORPLAN]: "FORPLAN",
  [COL.W_PCT_FORPLAN]: "% FORPLAN",
  [COL.X_IMPOSTOS]: "PIS/COFINS/ICMS (impostos)",
  [COL.Y_PCT_IMPOSTOS]: "% IMPOSTOS",
  [COL.Z_COMISSAO]: "COMISSÃO (vendedor)",
  [COL.AA_PCT_COMISSAO]: "% COMISSÃO",
  [COL.AB_CUSTO_TOTAL]: "CUSTO TOTAL CARRO",
  [COL.AC_MARGEM_LIQ]: "MARGEM LÍQUIDA",
  [COL.AD_PCT_LIQ]: "% MARGEM LÍQUIDA",
  [COL.AE_TRADE]: "TRADE-IN",
  [COL.AF_FINANCIOU]: "FINANCIOU",
  [COL.AG_DOCUMENTO]: "DOCUMENTO",
  [COL.AH_CLIENTE]: "NOME CLIENTE",
  [COL.AI_LOJISTA]: "LOJISTA (auto)",
  [COL.AJ_VENDEDOR]: "NOME VENDEDOR",
  [COL.AK_OBSERVACOES]: "OBSERVAÇÕES (recorrência)",
  [COL.AL_LOJA]: "LOJA",
  [COL.AM_OBS_EXTRA]: "OBS EXTRA",
};

// Larguras de coluna (em "caracteres")
const COL_WIDTHS: Record<number, number> = {
  [COL.A]: 2,
  [COL.B_SEQ]: 5,
  [COL.C_VEICULO]: 28,
  [COL.D_MARCA]: 12,
  [COL.E_PLACA]: 9,
  [COL.F_ANOMODELO]: 11,
  [COL.G_KM]: 9,
  [COL.H_COR]: 12,
  [COL.I_VALOR_ENTRADA]: 14,
  [COL.J_DIAS_PATIO]: 7,
  [COL.K_CAUTELAR]: 14,
  [COL.L_VALORIZA]: 12,
  [COL.M_CUSTO_REAL]: 14,
  [COL.N_FIPE]: 14,
  [COL.O_CUSTO_FIPE_PCT]: 10,
  [COL.P_VALOR_VENDA]: 14,
  [COL.Q_MARGEM_BRUTA]: 14,
  [COL.R_PCT_BRUTA]: 8,
  [COL.S_PCT_FIPE]: 10,
  [COL.T_OFICINA]: 14,
  [COL.U_PCT_OFICINA]: 8,
  [COL.V_FORPLAN]: 12,
  [COL.W_PCT_FORPLAN]: 8,
  [COL.X_IMPOSTOS]: 14,
  [COL.Y_PCT_IMPOSTOS]: 8,
  [COL.Z_COMISSAO]: 12,
  [COL.AA_PCT_COMISSAO]: 8,
  [COL.AB_CUSTO_TOTAL]: 14,
  [COL.AC_MARGEM_LIQ]: 14,
  [COL.AD_PCT_LIQ]: 8,
  [COL.AE_TRADE]: 10,
  [COL.AF_FINANCIOU]: 12,
  [COL.AG_DOCUMENTO]: 14,
  [COL.AH_CLIENTE]: 30,
  [COL.AI_LOJISTA]: 9,
  [COL.AJ_VENDEDOR]: 22,
  [COL.AK_OBSERVACOES]: 24,
  [COL.AL_LOJA]: 22,
  [COL.AM_OBS_EXTRA]: 32,
};

// ═══════════════════════════════════════════════════════════════════════════
// FONTES
// ═══════════════════════════════════════════════════════════════════════════

type ValorAquisicaoSource = (v: VendaParsed, c: CustoDetalhado | undefined) => number | null;

const getValorAquisicao: ValorAquisicaoSource = (v, c) => {
  if (c && c.nota_fabrica_taxa_icms > 0) return c.nota_fabrica_taxa_icms;
  if (v.total_nota_fabrica != null && v.total_nota_fabrica > 0) return v.total_nota_fabrica;
  return null;
};

// ═══════════════════════════════════════════════════════════════════════════
// OBSERVAÇÕES DE RECORRÊNCIA
// ═══════════════════════════════════════════════════════════════════════════

function observacaoRecorrencia(totalCompras: number): string {
  if (totalCompras <= 1) return "";
  return `COMPROU ${totalCompras} CARROS`;
}

// ═══════════════════════════════════════════════════════════════════════════
// DETECÇÃO DE LOJISTA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Regras (qualquer match → "SIM"):
 *   1. PJ com 4+ compras totais no dataset (recorrência típica de revenda).
 *   2. Nome contém termos clássicos de razão social de revenda.
 */
const TERMOS_LOJISTA = [
  "LTDA",
  "VEICULOS",
  "AUTOMOVEIS",
  "AUTOMÓVEIS",
  "MOTORS",
  "COMERCIO",
  "COMÉRCIO",
  "LOCACAO",
  "LOCAÇÃO",
  "RODOCAR",
  "AUTOFINANCE",
  "MULTIMARCAS",
] as const;

type LojistaFlag = "SIM" | "Não" | "Pessoa Física";

function detectarLojista(v: VendaParsed, qtCompras: number): LojistaFlag {
  const nome = (v.cliente_nome ?? "").toUpperCase();
  const nomeIndicaRevenda = TERMOS_LOJISTA.some((t) => nome.includes(t));

  // SIM: lojista real (PJ recorrente OU nome típico de revenda)
  if (nomeIndicaRevenda) return "SIM";
  if (v.cliente_tipo === "PJ" && qtCompras >= 4) return "SIM";

  // "Não": PF com perfil de revendedor informal (compra muito mas não é PJ)
  if (v.cliente_tipo === "PF" && qtCompras >= 4) return "Não";

  // Pessoa Física: consumidor comum (default)
  return "Pessoa Física";
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPRAS POR ANO (pré-cálculo O(n) — evita O(n²) no loop principal)
// ═══════════════════════════════════════════════════════════════════════════

type ComprasPorAno = Map<string /*chaveCliente*/, Map<number /*ano*/, number>>;

function calcularComprasPorAno(todasVendas: VendaParsed[]): ComprasPorAno {
  const map: ComprasPorAno = new Map();
  for (const v of todasVendas) {
    if (!v.data_venda) continue;
    const ano = v.data_venda.getFullYear();
    const chave = chaveCliente(v);
    const anosMap = map.get(chave) ?? new Map<number, number>();
    anosMap.set(ano, (anosMap.get(ano) ?? 0) + 1);
    map.set(chave, anosMap);
  }
  return map;
}

// ═══════════════════════════════════════════════════════════════════════════
// GERAÇÃO
// ═══════════════════════════════════════════════════════════════════════════

export async function gerarAnaliseNavesa({
  vendas,
  todasVendas,
  custosPorPlaca,
  empresa,
  dataDe,
  dataAte,
}: AnaliseNavesaInput): Promise<Blob> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Navesa Mesa";
  workbook.created = new Date();
  const ws = workbook.addWorksheet("USADOS NAVESA");

  // Index global de clientes (sobre TODAS as vendas) pra contar recorrência total
  const clientesIndex = indexarClientes(todasVendas);
  // Compras por (cliente, ano) — pré-calculado O(n) pra alimentar OBS EXTRA (AM) sem O(n²)
  const comprasPorAno = calcularComprasPorAno(todasVendas);

  // ─── Larguras de coluna ───
  for (let c = 1; c <= TOTAL_COLS; c++) {
    ws.getColumn(c).width = COL_WIDTHS[c] ?? 12;
  }

  // ─── V4: Linha 1 — título merged (B1:AM1) ───
  const empresaCell = empresa || "TODAS";
  const periodoTxt =
    dataDe || dataAte
      ? `PERÍODO ${dataDe ? fmtDateBR(dataDe) : "INÍCIO"} A ${dataAte ? fmtDateBR(dataAte) : fmtDateBR(todayISO())}`
      : "TODO PERÍODO";
  const tituloTxt = `USADOS ANÁLISE NAVESA — ${empresaCell} — ${periodoTxt}`;

  ws.mergeCells(1, COL.B_SEQ, 1, COL.AM_OBS_EXTRA);
  const row1 = ws.getRow(1);
  row1.height = 28;
  const titleCell = row1.getCell(COL.B_SEQ);
  titleCell.value = tituloTxt;
  titleCell.font = { bold: true, size: 14, color: { argb: COLOR.titleFg } };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  titleCell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: COLOR.titleBg },
  };

  // ─── V4: Linha 2 — header único por coluna (wrap text) ───
  const row2 = ws.getRow(2);
  row2.height = 32;
  for (const [colNumStr, label] of Object.entries(HEADERS)) {
    const colNum = Number(colNumStr);
    const cell = row2.getCell(colNum);
    cell.value = label;
    cell.font = { bold: true, size: 11 };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLOR.grayHeader },
    };
    cell.border = thinBorder();
  }

  // ─── Linhas de dados (a partir da linha 3) ───
  const DATA_START = 3;
  let dataRowIdx = DATA_START;

  // Acumuladores pra totais e KPIs
  let totValorAquisicao = 0;
  let totGanhosIndiretos = 0;
  let totCustoReal = 0;
  let totValorVenda = 0;
  let totMargemBruta = 0;
  let totDespOficina = 0;
  let totForplan = 0;
  let totImpostos = 0;
  let totComissao = 0;
  let totCustoTotal = 0;
  let totMargemLiq = 0;

  // Acumuladores de % (pra média simples)
  const pctBrutas: number[] = [];
  const pctFipe: number[] = [];
  const pctOficina: number[] = [];
  const pctForplan: number[] = [];
  const pctImpostos: number[] = [];
  const pctComissao: number[] = [];
  const pctLiq: number[] = [];

  // Acumuladores de "sim/não"
  let qtTrade = 0;

  // V5: acumuladores p/ rodapé profissional
  let qtLojistaSim = 0;
  let qtLojistaNao = 0;
  let qtPessoaFisica = 0;
  let qtPJ = 0;
  let qtPF = 0;
  let qtMargemLiqNegativa = 0;
  let qtComCustoDetalhado = 0;
  const diasEstoqueArr: number[] = [];
  let qtDias60Plus = 0;
  let qtDias90Plus = 0;
  // Faturamento por loja/marca + contagem por loja/vendedor/marca/modelo
  const fatPorLoja = new Map<string, number>();
  const qtPorLoja = new Map<string, number>();
  const qtPorVendedor = new Map<string, number>();
  const fatPorMarca = new Map<string, number>();
  const qtPorMarca = new Map<string, number>();
  const qtPorModelo = new Map<string, number>();

  vendas.forEach((v, idx) => {
    const c = custosPorPlaca[v.placa];
    const row = ws.getRow(dataRowIdx);

    // B — SEQ
    row.getCell(COL.B_SEQ).value = idx + 1;
    row.getCell(COL.B_SEQ).numFmt = FMT_INT;
    row.getCell(COL.B_SEQ).alignment = { horizontal: "right" };

    // C — Veículo (sem cor — explicitamente proibido)
    row.getCell(COL.C_VEICULO).value = v.modelo;
    row.getCell(COL.C_VEICULO).alignment = { horizontal: "left" };

    // D — Marca
    row.getCell(COL.D_MARCA).value = v.marca ?? "";
    row.getCell(COL.D_MARCA).alignment = { horizontal: "left" };

    // E — Placa
    row.getCell(COL.E_PLACA).value = v.placa;
    row.getCell(COL.E_PLACA).alignment = { horizontal: "center" };

    // F — Ano/Modelo
    row.getCell(COL.F_ANOMODELO).value =
      v.ano_fabricacao != null && v.ano_modelo != null
        ? `${v.ano_fabricacao}/${v.ano_modelo}`
        : "";
    row.getCell(COL.F_ANOMODELO).alignment = { horizontal: "center" };

    // G — KM (com cor condicional > 150.000)
    if (v.km != null) {
      const gCell = row.getCell(COL.G_KM);
      gCell.value = v.km;
      gCell.numFmt = FMT_INT;
      gCell.alignment = { horizontal: "right" };
      if (v.km > 150000) {
        gCell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: COLOR.yellowSoft },
        };
      }
    }

    // H — Cor
    row.getCell(COL.H_COR).value = v.cor_externa ?? "";
    row.getCell(COL.H_COR).alignment = { horizontal: "left" };

    // I — Valor NF Entrada
    const valorAq = getValorAquisicao(v, c);
    if (valorAq != null) {
      const cell = row.getCell(COL.I_VALOR_ENTRADA);
      cell.value = valorAq;
      cell.numFmt = FMT_MONEY;
      cell.alignment = { horizontal: "right" };
      totValorAquisicao += valorAq;
    }

    // J — Dias pátio (cor condicional > 60)
    if (v.dias_estoque != null) {
      const jCell = row.getCell(COL.J_DIAS_PATIO);
      jCell.value = v.dias_estoque;
      jCell.numFmt = FMT_INT;
      jCell.alignment = { horizontal: "right" };
      if (v.dias_estoque > 60) {
        jCell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: COLOR.yellowSoft },
        };
      }
    }

    // K — Cautelar (manual, vazio)

    // L — Valoriza (ganhos indiretos)
    if (c) {
      const cell = row.getCell(COL.L_VALORIZA);
      cell.value = c.ganhos_indiretos;
      cell.numFmt = FMT_MONEY;
      cell.alignment = { horizontal: "right" };
      totGanhosIndiretos += c.ganhos_indiretos;
    }

    // M — Custo Real (FÓRMULA = I - L; result cacheado)
    // Só escreve a fórmula quando há valor de aquisição — evita exibir custo negativo
    // (-L) e divergência entre soma de células e linha TOTAL.
    if (valorAq != null) {
      const ganhosIndiretosM = c?.ganhos_indiretos ?? 0;
      const custoRealCache = valorAq - ganhosIndiretosM;
      const cell = row.getCell(COL.M_CUSTO_REAL);
      cell.value = {
        formula: `I${dataRowIdx}-L${dataRowIdx}`,
        result: custoRealCache,
      };
      cell.numFmt = FMT_MONEY;
      cell.alignment = { horizontal: "right" };
      totCustoReal += custoRealCache;
    }

    // N — Valor FIPE (vazio, Marcos preenche manualmente)

    // O — Custo Real x FIPE % (FÓRMULA = IFERROR(M/N,""))
    {
      const cell = row.getCell(COL.O_CUSTO_FIPE_PCT);
      cell.value = {
        formula: `IFERROR(M${dataRowIdx}/N${dataRowIdx},"")`,
        result: undefined,
      };
      cell.numFmt = FMT_PERCENT;
      cell.alignment = { horizontal: "right" };
    }

    // P — Valor NF Venda (INPUT — valor direto)
    const valorVenda = v.valor_venda;
    if (valorVenda != null && valorVenda > 0) {
      const cell = row.getCell(COL.P_VALOR_VENDA);
      cell.value = valorVenda;
      cell.numFmt = FMT_MONEY;
      cell.alignment = { horizontal: "right" };
      totValorVenda += valorVenda;
    }

    // Q — Margem Bruta (FÓRMULA = P - M); cor condicional se negativa
    let margemBruta: number | null = null;
    if (valorVenda != null && valorVenda > 0 && valorAq != null) {
      const ganhosIndiretosQ = c?.ganhos_indiretos ?? 0;
      const custoReal = valorAq - ganhosIndiretosQ;
      margemBruta = valorVenda - custoReal;
      const cell = row.getCell(COL.Q_MARGEM_BRUTA);
      cell.value = {
        formula: `P${dataRowIdx}-M${dataRowIdx}`,
        result: margemBruta,
      };
      cell.numFmt = FMT_MONEY;
      cell.alignment = { horizontal: "right" };
      if (margemBruta < 0) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: COLOR.redSoftBg },
        };
        cell.font = { color: { argb: COLOR.redSoftFg } };
      }
      totMargemBruta += margemBruta;

      // R — % margem bruta (FÓRMULA = IFERROR(Q/P,""))
      const pct = margemBruta / valorVenda;
      const rCell = row.getCell(COL.R_PCT_BRUTA);
      rCell.value = {
        formula: `IFERROR(Q${dataRowIdx}/P${dataRowIdx},"")`,
        result: pct,
      };
      rCell.numFmt = FMT_PERCENT;
      rCell.alignment = { horizontal: "right" };
      pctBrutas.push(pct);
    }

    // S — Venda x FIPE % (FÓRMULA = IFERROR(P/N,""))
    {
      const cell = row.getCell(COL.S_PCT_FIPE);
      cell.value = {
        formula: `IFERROR(P${dataRowIdx}/N${dataRowIdx},"")`,
        result: undefined,
      };
      cell.numFmt = FMT_PERCENT;
      cell.alignment = { horizontal: "right" };
    }

    // T — Despesa oficina
    if (c) {
      const tCell = row.getCell(COL.T_OFICINA);
      tCell.value = c.despesas_oficina;
      tCell.numFmt = FMT_MONEY;
      tCell.alignment = { horizontal: "right" };
      totDespOficina += c.despesas_oficina;
      // Médias incluem zeros (despesa=0 mas venda>0) — representam o operacional real.
      // Excluir zeros inflaria médias artificialmente.
      if (valorVenda != null && valorVenda > 0) {
        const pct = c.despesas_oficina / valorVenda;
        const uCell = row.getCell(COL.U_PCT_OFICINA);
        uCell.value = {
          formula: `IFERROR(T${dataRowIdx}/P${dataRowIdx},"")`,
          result: pct,
        };
        uCell.numFmt = FMT_PERCENT;
        uCell.alignment = { horizontal: "right" };
        pctOficina.push(pct);
      }
    }

    // V — Forplan
    if (c) {
      const vCell = row.getCell(COL.V_FORPLAN);
      vCell.value = c.forplan;
      vCell.numFmt = FMT_MONEY;
      vCell.alignment = { horizontal: "right" };
      totForplan += c.forplan;
      if (valorVenda != null && valorVenda > 0) {
        const pct = c.forplan / valorVenda;
        const wCell = row.getCell(COL.W_PCT_FORPLAN);
        wCell.value = {
          formula: `IFERROR(V${dataRowIdx}/P${dataRowIdx},"")`,
          result: pct,
        };
        wCell.numFmt = FMT_PERCENT;
        wCell.alignment = { horizontal: "right" };
        pctForplan.push(pct);
      }
    }

    // X — Impostos
    if (c) {
      const xCell = row.getCell(COL.X_IMPOSTOS);
      xCell.value = c.impostos;
      xCell.numFmt = FMT_MONEY;
      xCell.alignment = { horizontal: "right" };
      totImpostos += c.impostos;
      if (valorVenda != null && valorVenda > 0) {
        const pct = c.impostos / valorVenda;
        const yCell = row.getCell(COL.Y_PCT_IMPOSTOS);
        yCell.value = {
          formula: `IFERROR(X${dataRowIdx}/P${dataRowIdx},"")`,
          result: pct,
        };
        yCell.numFmt = FMT_PERCENT;
        yCell.alignment = { horizontal: "right" };
        pctImpostos.push(pct);
      }
    }

    // Z — Comissão
    const comissao = c ? c.comissoes : v.comissao_vendedor;
    if (comissao != null) {
      const zCell = row.getCell(COL.Z_COMISSAO);
      zCell.value = comissao;
      zCell.numFmt = FMT_MONEY;
      zCell.alignment = { horizontal: "right" };
      totComissao += comissao;
      if (valorVenda != null && valorVenda > 0) {
        const pct = comissao / valorVenda;
        const aaCell = row.getCell(COL.AA_PCT_COMISSAO);
        aaCell.value = {
          formula: `IFERROR(Z${dataRowIdx}/P${dataRowIdx},"")`,
          result: pct,
        };
        aaCell.numFmt = FMT_PERCENT;
        aaCell.alignment = { horizontal: "right" };
        pctComissao.push(pct);
      }
    }

    // AB — Custo Total Carro + AC — Margem Líquida + AD — % Líquida (com cor)
    const oficina = c?.despesas_oficina ?? 0;
    const forplan = c?.forplan ?? 0;
    const impostos = c?.impostos ?? 0;
    const comissaoNum = comissao ?? 0;
    const temAlgumCusto = c != null || comissao != null;
    if (temAlgumCusto) {
      const custoTotal = oficina + forplan + impostos + comissaoNum;
      const abCell = row.getCell(COL.AB_CUSTO_TOTAL);
      abCell.value = {
        formula: `T${dataRowIdx}+V${dataRowIdx}+X${dataRowIdx}+Z${dataRowIdx}`,
        result: custoTotal,
      };
      abCell.numFmt = FMT_MONEY;
      abCell.alignment = { horizontal: "right" };
      totCustoTotal += custoTotal;

      if (valorVenda != null && valorVenda > 0 && valorAq != null && margemBruta != null) {
        const margemLiq = margemBruta - custoTotal;
        const acCell = row.getCell(COL.AC_MARGEM_LIQ);
        acCell.value = {
          formula: `Q${dataRowIdx}-AB${dataRowIdx}`,
          result: margemLiq,
        };
        acCell.numFmt = FMT_MONEY;
        acCell.alignment = { horizontal: "right" };
        totMargemLiq += margemLiq;

        const pct = margemLiq / valorVenda;
        const adCell = row.getCell(COL.AD_PCT_LIQ);
        adCell.value = {
          formula: `IFERROR(AC${dataRowIdx}/P${dataRowIdx},"")`,
          result: pct,
        };
        adCell.numFmt = FMT_PERCENT;
        adCell.alignment = { horizontal: "right" };
        pctLiq.push(pct);

        // Cor condicional na % líquida
        if (pct < 0) {
          adCell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: COLOR.redSoftBg },
          };
          adCell.font = { color: { argb: COLOR.redSoftFg } };
          // Também colore margem líquida $
          acCell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: COLOR.redSoftBg },
          };
          acCell.font = { color: { argb: COLOR.redSoftFg } };
        } else if (pct >= 0.10) {
          adCell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: COLOR.greenSoftBg },
          };
          adCell.font = { color: { argb: COLOR.greenSoftFg } };
          acCell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: COLOR.greenSoftBg },
          };
          acCell.font = { color: { argb: COLOR.greenSoftFg } };
        }
      }
    }

    // AE — Trade-in
    const trade = v.placa_troca ? "SIM" : "NÃO";
    row.getCell(COL.AE_TRADE).value = trade;
    row.getCell(COL.AE_TRADE).alignment = { horizontal: "center" };
    if (v.placa_troca) qtTrade++;

    // AF / AG — manual (vazio)

    // AH — Nome Cliente
    row.getCell(COL.AH_CLIENTE).value = v.cliente_nome;
    row.getCell(COL.AH_CLIENTE).alignment = { horizontal: "left" };

    // AI — Lojista (auto-detectado, 3 valores: "SIM" | "Não" | "Pessoa Física")
    const chaveCli = chaveCliente(v);
    const cli = clientesIndex.get(chaveCli);
    const totalCompras = cli?.totalCompras ?? 1;
    const lojistaFlag = detectarLojista(v, totalCompras);
    const aiCell = row.getCell(COL.AI_LOJISTA);
    aiCell.value = lojistaFlag;
    aiCell.alignment = { horizontal: "center" };
    if (lojistaFlag === "SIM") {
      aiCell.font = { bold: true };
    }

    // AJ — Vendedor
    row.getCell(COL.AJ_VENDEDOR).value = v.vendedor_nome ?? "";
    row.getCell(COL.AJ_VENDEDOR).alignment = { horizontal: "left" };

    // AK — Observações (recorrência automática)
    const obs = observacaoRecorrencia(totalCompras);
    if (obs) {
      row.getCell(COL.AK_OBSERVACOES).value = obs;
      row.getCell(COL.AK_OBSERVACOES).alignment = { horizontal: "left" };
      row.getCell(COL.AK_OBSERVACOES).font = { italic: true, size: 10 };
    }

    // AL — Loja (sem cor — V3 removeu fundo colorido)
    row.getCell(COL.AL_LOJA).value = v.empresa_nome ?? "";
    row.getCell(COL.AL_LOJA).alignment = { horizontal: "left" };

    // AM — Obs Extra (só pra lojista real "SIM"; "Não" e "Pessoa Física" ficam vazios)
    if (lojistaFlag === "SIM" && v.data_venda) {
      const ano = v.data_venda.getFullYear();
      const nAno = comprasPorAno.get(chaveCli)?.get(ano) ?? 0;
      if (nAno > 0) {
        const amCell = row.getCell(COL.AM_OBS_EXTRA);
        amCell.value = `LOJISTA - COMPROU ${nAno} CARROS ${ano}`;
        amCell.alignment = { horizontal: "left" };
        amCell.font = { italic: true, size: 10 };
      }
    }

    // V5: acumular dados pro rodapé profissional
    if (lojistaFlag === "SIM") qtLojistaSim++;
    else if (lojistaFlag === "Não") qtLojistaNao++;
    else qtPessoaFisica++;

    if (v.cliente_tipo === "PJ") qtPJ++;
    else if (v.cliente_tipo === "PF") qtPF++;

    if (c) qtComCustoDetalhado++;

    if (v.dias_estoque != null) {
      diasEstoqueArr.push(v.dias_estoque);
      if (v.dias_estoque > 60) qtDias60Plus++;
      if (v.dias_estoque > 90) qtDias90Plus++;
    }

    // Margem líquida negativa: só conta se conseguimos calcular margemLiq
    const ofic = c?.despesas_oficina ?? 0;
    const frp = c?.forplan ?? 0;
    const imp = c?.impostos ?? 0;
    const cmsn = comissao ?? 0;
    const temCustoCalc = c != null || comissao != null;
    if (
      temCustoCalc &&
      valorVenda != null &&
      valorVenda > 0 &&
      valorAq != null &&
      margemBruta != null
    ) {
      const margemLiqLocal = margemBruta - (ofic + frp + imp + cmsn);
      if (margemLiqLocal < 0) qtMargemLiqNegativa++;
    }

    // Top performers
    const lojaNome = v.empresa_nome ?? "—";
    qtPorLoja.set(lojaNome, (qtPorLoja.get(lojaNome) ?? 0) + 1);
    if (valorVenda != null && valorVenda > 0) {
      fatPorLoja.set(lojaNome, (fatPorLoja.get(lojaNome) ?? 0) + valorVenda);
    }
    const vendedorNome = v.vendedor_nome ?? "—";
    qtPorVendedor.set(vendedorNome, (qtPorVendedor.get(vendedorNome) ?? 0) + 1);
    const marcaNome = v.marca ?? "—";
    qtPorMarca.set(marcaNome, (qtPorMarca.get(marcaNome) ?? 0) + 1);
    if (valorVenda != null && valorVenda > 0) {
      fatPorMarca.set(marcaNome, (fatPorMarca.get(marcaNome) ?? 0) + valorVenda);
    }
    const modeloNome = v.modelo ?? "—";
    qtPorModelo.set(modeloNome, (qtPorModelo.get(modeloNome) ?? 0) + 1);

    // Bordas em todas as células de dados (B..AM)
    for (let c = COL.B_SEQ; c <= COL.AM_OBS_EXTRA; c++) {
      row.getCell(c).border = thinBorder();
    }

    dataRowIdx++;
  });

  // ═══════════════════════════════════════════════════════════════════
  // TOTALIZADORES
  // ═══════════════════════════════════════════════════════════════════
  const TOTAL_ROW = dataRowIdx + 1; // pula 1 linha vazia
  const totRow = ws.getRow(TOTAL_ROW);
  totRow.getCell(COL.B_SEQ).value = "TOTAL";
  totRow.getCell(COL.I_VALOR_ENTRADA).value = totValorAquisicao;
  totRow.getCell(COL.L_VALORIZA).value = totGanhosIndiretos;
  totRow.getCell(COL.M_CUSTO_REAL).value = totCustoReal;
  totRow.getCell(COL.P_VALOR_VENDA).value = totValorVenda;
  totRow.getCell(COL.Q_MARGEM_BRUTA).value = totMargemBruta;
  totRow.getCell(COL.R_PCT_BRUTA).value = totValorVenda > 0 ? totMargemBruta / totValorVenda : 0;
  totRow.getCell(COL.T_OFICINA).value = totDespOficina;
  totRow.getCell(COL.V_FORPLAN).value = totForplan;
  totRow.getCell(COL.X_IMPOSTOS).value = totImpostos;
  totRow.getCell(COL.Z_COMISSAO).value = totComissao;
  totRow.getCell(COL.AB_CUSTO_TOTAL).value = totCustoTotal;
  totRow.getCell(COL.AC_MARGEM_LIQ).value = totMargemLiq;
  totRow.getCell(COL.AD_PCT_LIQ).value = totValorVenda > 0 ? totMargemLiq / totValorVenda : 0;

  // Formatação da linha TOTAL
  const moneyColsTot = [
    COL.I_VALOR_ENTRADA, COL.L_VALORIZA, COL.M_CUSTO_REAL, COL.P_VALOR_VENDA,
    COL.Q_MARGEM_BRUTA, COL.T_OFICINA, COL.V_FORPLAN, COL.X_IMPOSTOS,
    COL.Z_COMISSAO, COL.AB_CUSTO_TOTAL, COL.AC_MARGEM_LIQ,
  ];
  const pctColsTot = [COL.R_PCT_BRUTA, COL.AD_PCT_LIQ];
  for (const c of moneyColsTot) {
    totRow.getCell(c).numFmt = FMT_MONEY;
    totRow.getCell(c).alignment = { horizontal: "right" };
  }
  for (const c of pctColsTot) {
    totRow.getCell(c).numFmt = FMT_PERCENT;
    totRow.getCell(c).alignment = { horizontal: "right" };
  }
  // Background cinza + bold em todas as células de B..AL
  for (let c = COL.B_SEQ; c <= COL.AM_OBS_EXTRA; c++) {
    const cell = totRow.getCell(c);
    cell.font = { bold: true, color: cell.font?.color ?? undefined };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLOR.grayLight },
    };
    cell.border = thinBorder();
  }

  // Linha MÉDIA (médias dos %)
  const MEDIA_ROW = TOTAL_ROW + 1;
  const medRow = ws.getRow(MEDIA_ROW);
  medRow.getCell(COL.B_SEQ).value = "MÉDIA";
  if (pctBrutas.length > 0) medRow.getCell(COL.R_PCT_BRUTA).value = avg(pctBrutas);
  if (pctFipe.length > 0) medRow.getCell(COL.S_PCT_FIPE).value = avg(pctFipe);
  if (pctOficina.length > 0) medRow.getCell(COL.U_PCT_OFICINA).value = avg(pctOficina);
  if (pctForplan.length > 0) medRow.getCell(COL.W_PCT_FORPLAN).value = avg(pctForplan);
  if (pctImpostos.length > 0) medRow.getCell(COL.Y_PCT_IMPOSTOS).value = avg(pctImpostos);
  if (pctComissao.length > 0) medRow.getCell(COL.AA_PCT_COMISSAO).value = avg(pctComissao);
  if (pctLiq.length > 0) medRow.getCell(COL.AD_PCT_LIQ).value = avg(pctLiq);
  for (const c of [COL.R_PCT_BRUTA, COL.S_PCT_FIPE, COL.U_PCT_OFICINA, COL.W_PCT_FORPLAN, COL.Y_PCT_IMPOSTOS, COL.AA_PCT_COMISSAO, COL.AD_PCT_LIQ]) {
    medRow.getCell(c).numFmt = FMT_PERCENT;
    medRow.getCell(c).alignment = { horizontal: "right" };
  }
  for (let c = COL.B_SEQ; c <= COL.AM_OBS_EXTRA; c++) {
    const cell = medRow.getCell(c);
    cell.font = { bold: true, italic: true };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLOR.grayLight },
    };
    cell.border = thinBorder();
  }

  // Linha QT VENDAS
  const QT_ROW = MEDIA_ROW + 1;
  const qtRow = ws.getRow(QT_ROW);
  qtRow.getCell(COL.B_SEQ).value = "QT VENDAS";
  qtRow.getCell(COL.P_VALOR_VENDA).value = vendas.length;
  qtRow.getCell(COL.P_VALOR_VENDA).numFmt = FMT_INT;
  qtRow.getCell(COL.P_VALOR_VENDA).alignment = { horizontal: "right" };
  for (let c = COL.B_SEQ; c <= COL.AM_OBS_EXTRA; c++) {
    const cell = qtRow.getCell(c);
    cell.font = { bold: true };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLOR.grayLight },
    };
    cell.border = thinBorder();
  }

  // ═══════════════════════════════════════════════════════════════════
  // V5: KPIs DA MESA — 6 blocos temáticos em layout 2 colunas
  //   ESQUERDA  (B..G): 1) Totais Gerais  2) Indicadores Médios  3) Dias de Pátio
  //   DIREITA   (I..N): 4) Perfil Clientes  5) Top Performers  6) Alertas
  // ═══════════════════════════════════════════════════════════════════
  const KPI_START = QT_ROW + 3; // pula 2 linhas (QT_ROW+1 vazia, QT_ROW+2 vazia, começa em +3)

  // Colunas dos blocos
  const L_LABEL_A = COL.B_SEQ;   // B
  const L_LABEL_B = COL.C_VEICULO; // C
  const L_VALOR = COL.D_MARCA;    // D
  const L_EXTRA = COL.E_PLACA;    // E
  const L_HEADER_END = COL.F_ANOMODELO; // F (header merged B..F)

  const R_LABEL_A = COL.J_DIAS_PATIO;  // J
  const R_LABEL_B = COL.K_CAUTELAR;    // K
  const R_VALOR = COL.L_VALORIZA;      // L
  const R_EXTRA = COL.O_CUSTO_FIPE_PCT; // M
  const R_HEADER_END = COL.M_CUSTO_REAL; // N (header merged J..N)

  type KpiLine =
    | { kind: "header"; label: string }
    | {
        kind: "line";
        label: string;
        value: number | string | null;
        valueFmt?: "money" | "int";
        extra?: string | null;
      }
    | { kind: "blank" };

  // Helpers de cálculo
  const totalVendas = vendas.length;
  const pct = (n: number, d: number): number => (d > 0 ? n / d : 0);
  const fmtPctStr = (n: number, d: number): string =>
    d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "0.0%";

  // Custo total acumulado: Σ custo_total dos custos_detalhados quando disponível,
  // senão soma valor_aquisicao. Como o loop não somou explicitamente, recalculamos:
  let totCustoAcumulado = 0;
  for (const v of vendas) {
    const cd = custosPorPlaca[v.placa];
    if (cd) totCustoAcumulado += cd.custo_total;
    else {
      const vAq = getValorAquisicao(v, undefined);
      if (vAq != null) totCustoAcumulado += vAq;
    }
  }

  const totDespOperacionais = totDespOficina + totForplan + totImpostos + totComissao;
  const ticketMedio = totalVendas > 0 ? totValorVenda / totalVendas : 0;
  const margemBrutaMedia = totalVendas > 0 ? totMargemBruta / totalVendas : 0;
  const margemLiqMedia = totalVendas > 0 ? totMargemLiq / totalVendas : 0;
  const comissaoMedia = totalVendas > 0 ? totComissao / totalVendas : 0;
  const pctBrutaPond = pct(totMargemBruta, totValorVenda);
  const pctLiqPond = pct(totMargemLiq, totValorVenda);

  const diasMedio =
    diasEstoqueArr.length > 0
      ? diasEstoqueArr.reduce((s, n) => s + n, 0) / diasEstoqueArr.length
      : 0;
  const diasMin = diasEstoqueArr.length > 0 ? Math.min(...diasEstoqueArr) : 0;
  const diasMax = diasEstoqueArr.length > 0 ? Math.max(...diasEstoqueArr) : 0;
  const totDias = diasEstoqueArr.reduce((s, n) => s + n, 0);

  // Top performers — pega chave com maior contagem
  const topBy = (m: Map<string, number>): { nome: string; qt: number } | null => {
    let best: { nome: string; qt: number } | null = null;
    for (const [k, v] of m) {
      if (!best || v > best.qt) best = { nome: k, qt: v };
    }
    return best;
  };
  const topLoja = topBy(qtPorLoja);
  const topVendedor = topBy(qtPorVendedor);
  const topMarca = topBy(qtPorMarca);
  const topModelo = topBy(qtPorModelo);
  const fatTopLoja = topLoja ? (fatPorLoja.get(topLoja.nome) ?? 0) : 0;
  const fatTopMarca = topMarca ? (fatPorMarca.get(topMarca.nome) ?? 0) : 0;

  // ─── Bloco 1: TOTAIS GERAIS ───
  const bloco1: KpiLine[] = [
    { kind: "header", label: "📊 TOTAIS GERAIS" },
    { kind: "line", label: "Total de vendas", value: totalVendas, valueFmt: "int" },
    { kind: "line", label: "Faturamento total", value: totValorVenda, valueFmt: "money" },
    { kind: "line", label: "Custo total acumulado", value: totCustoAcumulado, valueFmt: "money" },
    { kind: "line", label: "Margem bruta total", value: totMargemBruta, valueFmt: "money" },
    { kind: "line", label: "Margem líquida total", value: totMargemLiq, valueFmt: "money" },
    { kind: "line", label: "Ganhos indiretos total", value: totGanhosIndiretos, valueFmt: "money" },
    { kind: "line", label: "Despesas operacionais total", value: totDespOperacionais, valueFmt: "money" },
    { kind: "blank" },
  ];

  // ─── Bloco 2: INDICADORES MÉDIOS ───
  const bloco2: KpiLine[] = [
    { kind: "header", label: "📈 INDICADORES MÉDIOS" },
    { kind: "line", label: "Ticket médio", value: ticketMedio, valueFmt: "money" },
    { kind: "line", label: "Margem bruta média (R$)", value: margemBrutaMedia, valueFmt: "money" },
    { kind: "line", label: "Margem líquida média (R$)", value: margemLiqMedia, valueFmt: "money" },
    { kind: "line", label: "% Margem bruta (ponderada)", value: `${(pctBrutaPond * 100).toFixed(2)}%` },
    { kind: "line", label: "% Margem líquida (ponderada)", value: `${(pctLiqPond * 100).toFixed(2)}%` },
    { kind: "line", label: "Comissão média", value: comissaoMedia, valueFmt: "money" },
    { kind: "blank" },
  ];

  // ─── Bloco 3: DIAS DE PÁTIO ───
  const bloco3: KpiLine[] = [
    { kind: "header", label: "⏱️ DIAS DE PÁTIO" },
    { kind: "line", label: "Total de dias acumulado", value: totDias, valueFmt: "int", extra: "dias" },
    { kind: "line", label: "Dias médio", value: Number(diasMedio.toFixed(1)), valueFmt: "int" },
    { kind: "line", label: "Mínimo / Máximo", value: `${diasMin} / ${diasMax}` },
    {
      kind: "line",
      label: "Vendas com mais de 60 dias",
      value: qtDias60Plus,
      valueFmt: "int",
      extra: fmtPctStr(qtDias60Plus, totalVendas),
    },
    {
      kind: "line",
      label: "Vendas com mais de 90 dias",
      value: qtDias90Plus,
      valueFmt: "int",
      extra: fmtPctStr(qtDias90Plus, totalVendas),
    },
    { kind: "blank" },
  ];

  // ─── Bloco 4: PERFIL DOS CLIENTES ───
  const bloco4: KpiLine[] = [
    { kind: "header", label: "👥 PERFIL DOS CLIENTES" },
    {
      kind: "line",
      label: "Vendas a Lojistas (SIM)",
      value: qtLojistaSim,
      valueFmt: "int",
      extra: fmtPctStr(qtLojistaSim, totalVendas),
    },
    {
      kind: "line",
      label: "PF com perfil de revenda (Não)",
      value: qtLojistaNao,
      valueFmt: "int",
      extra: fmtPctStr(qtLojistaNao, totalVendas),
    },
    {
      kind: "line",
      label: "Pessoa Física comum",
      value: qtPessoaFisica,
      valueFmt: "int",
      extra: fmtPctStr(qtPessoaFisica, totalVendas),
    },
    {
      kind: "line",
      label: "Vendas com Trade-in",
      value: qtTrade,
      valueFmt: "int",
      extra: fmtPctStr(qtTrade, totalVendas),
    },
    {
      kind: "line",
      label: "Vendas PJ",
      value: qtPJ,
      valueFmt: "int",
      extra: fmtPctStr(qtPJ, totalVendas),
    },
    {
      kind: "line",
      label: "Vendas PF",
      value: qtPF,
      valueFmt: "int",
      extra: fmtPctStr(qtPF, totalVendas),
    },
    { kind: "blank" },
  ];

  // ─── Bloco 5: TOP PERFORMERS ───
  const bloco5: KpiLine[] = [
    { kind: "header", label: "🏆 TOP PERFORMERS" },
    {
      kind: "line",
      label: "Loja com mais vendas",
      value: topLoja ? `${topLoja.nome} (${topLoja.qt})` : "—",
      extra: topLoja ? `R$ ${fatTopLoja.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null,
    },
    {
      kind: "line",
      label: "Vendedor com mais vendas",
      value: topVendedor ? `${topVendedor.nome} (${topVendedor.qt})` : "—",
    },
    {
      kind: "line",
      label: "Marca com mais vendas",
      value: topMarca ? `${topMarca.nome} (${topMarca.qt})` : "—",
      extra: topMarca ? `R$ ${fatTopMarca.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null,
    },
    {
      kind: "line",
      label: "Modelo mais vendido",
      value: topModelo ? `${topModelo.nome} (${topModelo.qt})` : "—",
    },
    { kind: "blank" },
  ];

  // ─── Bloco 6: ALERTAS ───
  const bloco6: KpiLine[] = [
    { kind: "header", label: "⚠️ ALERTAS" },
    {
      kind: "line",
      label: "Vendas com margem líquida negativa",
      value: qtMargemLiqNegativa,
      valueFmt: "int",
      extra: fmtPctStr(qtMargemLiqNegativa, totalVendas),
    },
    {
      kind: "line",
      label: "Vendas com mais de 90 dias de pátio",
      value: qtDias90Plus,
      valueFmt: "int",
      extra: fmtPctStr(qtDias90Plus, totalVendas),
    },
    {
      kind: "line",
      label: "Cobertura de custos detalhados",
      value: fmtPctStr(qtComCustoDetalhado, totalVendas),
    },
    { kind: "blank" },
  ];

  const colunaEsq: KpiLine[] = [...bloco1, ...bloco2, ...bloco3];
  const colunaDir: KpiLine[] = [...bloco4, ...bloco5, ...bloco6];
  const maxLinhas = Math.max(colunaEsq.length, colunaDir.length);

  const renderKpiLine = (
    rowIdx: number,
    line: KpiLine,
    cols: {
      labelA: number;
      labelB: number;
      valor: number;
      extra: number;
      headerEnd: number;
    },
  ): void => {
    if (line.kind === "blank") return;
    const r = ws.getRow(rowIdx);
    if (line.kind === "header") {
      ws.mergeCells(rowIdx, cols.labelA, rowIdx, cols.headerEnd);
      const cell = r.getCell(cols.labelA);
      cell.value = line.label;
      cell.font = { bold: true, size: 12, color: { argb: "FF000000" } };
      cell.alignment = { horizontal: "left", vertical: "middle" };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFD1D5DB" },
      };
      cell.border = thinBorder();
      // Aplica border nas células mergeadas
      for (let cc = cols.labelA + 1; cc <= cols.headerEnd; cc++) {
        r.getCell(cc).border = thinBorder();
        r.getCell(cc).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFD1D5DB" },
        };
      }
      r.height = 20;
      return;
    }
    // kind === "line"
    ws.mergeCells(rowIdx, cols.labelA, rowIdx, cols.labelB);
    const labelCell = r.getCell(cols.labelA);
    labelCell.value = line.label;
    labelCell.alignment = { horizontal: "left", vertical: "middle" };
    labelCell.font = { size: 10 };

    const valorCell = r.getCell(cols.valor);
    if (line.value != null) {
      valorCell.value = line.value;
      if (typeof line.value === "number") {
        valorCell.numFmt = line.valueFmt === "int" ? FMT_INT : FMT_MONEY;
      }
      valorCell.alignment = { horizontal: "right", vertical: "middle" };
      valorCell.font = { bold: true, size: 10 };
    }

    if (line.extra != null) {
      const extraCell = r.getCell(cols.extra);
      extraCell.value = line.extra;
      extraCell.alignment = { horizontal: "left", vertical: "middle" };
      extraCell.font = { italic: true, size: 9, color: { argb: "FF6B7280" } };
    }
  };

  for (let i = 0; i < maxLinhas; i++) {
    const rowIdx = KPI_START + i;
    if (i < colunaEsq.length) {
      renderKpiLine(rowIdx, colunaEsq[i], {
        labelA: L_LABEL_A,
        labelB: L_LABEL_B,
        valor: L_VALOR,
        extra: L_EXTRA,
        headerEnd: L_HEADER_END,
      });
    }
    if (i < colunaDir.length) {
      renderKpiLine(rowIdx, colunaDir[i], {
        labelA: R_LABEL_A,
        labelB: R_LABEL_B,
        valor: R_VALOR,
        extra: R_EXTRA,
        headerEnd: R_HEADER_END,
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // Gera Blob (writeBuffer é async)
  // ═══════════════════════════════════════════════════════════════════
  const buf = await workbook.xlsx.writeBuffer();
  // ExcelJS retorna ArrayBuffer no browser; em Node retorna Buffer (Uint8Array).
  // Em ambos os casos extraímos um ArrayBuffer "puro" pro Blob (BlobPart estrito
  // do TS 5.7+ rejeita ArrayBufferLike genérico). Tipagem `unknown` pra evitar `as`.
  const bufUnknown: unknown = buf;
  const MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  if (bufUnknown instanceof ArrayBuffer) {
    return new Blob([bufUnknown], { type: MIME });
  }
  if (bufUnknown instanceof Uint8Array) {
    // Copia o slice exato pra um ArrayBuffer novo (garante tipo ArrayBuffer, não
    // SharedArrayBuffer; e evita carregar bytes além do tamanho lógico do Buffer).
    const copy = new ArrayBuffer(bufUnknown.byteLength);
    new Uint8Array(copy).set(bufUnknown);
    return new Blob([copy], { type: MIME });
  }
  throw new Error("ExcelJS writeBuffer não retornou ArrayBuffer/Uint8Array");
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS DE ESTILO
// ═══════════════════════════════════════════════════════════════════════════

function thinBorder(): Partial<ExcelJS.Borders> {
  const side: Partial<ExcelJS.Border> = { style: "thin", color: { argb: "FFD1D5DB" } };
  // exceljs tipa Borders com diagonal{Up,Down} também — só preenchemos os 4 lados.
  return {
    top: side,
    bottom: side,
    left: side,
    right: side,
    diagonal: { up: false, down: false },
  };
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  let s = 0;
  for (const n of nums) s += n;
  return s / nums.length;
}

// ═══════════════════════════════════════════════════════════════════════════
// DOWNLOAD
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Trigger download no browser. Agora async porque a geração via exceljs é async.
 */
export async function baixarAnaliseNavesa(input: AnaliseNavesaInput): Promise<void> {
  const blob = await gerarAnaliseNavesa(input);
  const url = URL.createObjectURL(blob);
  const sanitize = (s: string): string => s.replace(/[^\d-]/g, "");
  const de = sanitize(input.dataDe) || "inicio";
  const ate = sanitize(input.dataAte) || sanitize(todayISO());
  const fileName = `analise-navesa-${de}-a-${ate}.xlsx`;
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
