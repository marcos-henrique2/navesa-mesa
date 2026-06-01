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
// Colunas chave:
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
  M_CUSTO_FIPE_PCT: 13,
  N_CUSTO_REAL: 14,
  O_VALOR_VENDA: 15,
  P_MARGEM_BRUTA: 16,
  Q_PCT_BRUTA: 17,
  R_FIPE: 18,
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
  [COL.M_CUSTO_FIPE_PCT]: "CUSTO REAL X FIPE %",
  [COL.N_CUSTO_REAL]: "CUSTO REAL (entrada - valoriza)",
  [COL.O_VALOR_VENDA]: "VALOR NF VENDA",
  [COL.P_MARGEM_BRUTA]: "MARGEM BRUTA (venda - custo real)",
  [COL.Q_PCT_BRUTA]: "% MARGEM BRUTA",
  [COL.R_FIPE]: "VALOR FIPE",
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
  [COL.M_CUSTO_FIPE_PCT]: 10,
  [COL.N_CUSTO_REAL]: 14,
  [COL.O_VALOR_VENDA]: 14,
  [COL.P_MARGEM_BRUTA]: 14,
  [COL.Q_PCT_BRUTA]: 8,
  [COL.R_FIPE]: 14,
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

function detectarLojista(v: VendaParsed, qtCompras: number): "SIM" | "" {
  if (v.cliente_tipo === "PJ" && qtCompras >= 4) return "SIM";
  const nome = (v.cliente_nome ?? "").toUpperCase();
  if (TERMOS_LOJISTA.some((t) => nome.includes(t))) return "SIM";
  return "";
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

    // M — Custo real x FIPE (vazio, sem FIPE)

    // N — Custo Real
    if (valorAq != null) {
      const ganhosIndiretosN = c?.ganhos_indiretos ?? 0;
      const custoReal = valorAq - ganhosIndiretosN;
      const cell = row.getCell(COL.N_CUSTO_REAL);
      cell.value = custoReal;
      cell.numFmt = FMT_MONEY;
      cell.alignment = { horizontal: "right" };
      totCustoReal += custoReal;
    }

    // O — Valor NF Venda
    const valorVenda = v.valor_venda;
    if (valorVenda != null && valorVenda > 0) {
      const cell = row.getCell(COL.O_VALOR_VENDA);
      cell.value = valorVenda;
      cell.numFmt = FMT_MONEY;
      cell.alignment = { horizontal: "right" };
      totValorVenda += valorVenda;
    }

    // P — Margem Bruta + cor condicional (negativa = vermelho)
    let margemBruta: number | null = null;
    if (valorVenda != null && valorVenda > 0 && valorAq != null) {
      const ganhosIndiretosP = c?.ganhos_indiretos ?? 0;
      const custoReal = valorAq - ganhosIndiretosP;
      margemBruta = valorVenda - custoReal;
      const cell = row.getCell(COL.P_MARGEM_BRUTA);
      cell.value = margemBruta;
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

      // Q — % margem bruta
      const pct = margemBruta / valorVenda;
      const qCell = row.getCell(COL.Q_PCT_BRUTA);
      qCell.value = pct;
      qCell.numFmt = FMT_PERCENT;
      qCell.alignment = { horizontal: "right" };
      pctBrutas.push(pct);
    }

    // R / S — FIPE (vazio)

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
        uCell.value = pct;
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
        wCell.value = pct;
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
        yCell.value = pct;
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
        aaCell.value = pct;
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
      abCell.value = custoTotal;
      abCell.numFmt = FMT_MONEY;
      abCell.alignment = { horizontal: "right" };
      totCustoTotal += custoTotal;

      if (valorVenda != null && valorVenda > 0 && valorAq != null && margemBruta != null) {
        const margemLiq = margemBruta - custoTotal;
        const acCell = row.getCell(COL.AC_MARGEM_LIQ);
        acCell.value = margemLiq;
        acCell.numFmt = FMT_MONEY;
        acCell.alignment = { horizontal: "right" };
        totMargemLiq += margemLiq;

        const pct = margemLiq / valorVenda;
        const adCell = row.getCell(COL.AD_PCT_LIQ);
        adCell.value = pct;
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

    // AI — Lojista (auto-detectado)
    const chaveCli = chaveCliente(v);
    const cli = clientesIndex.get(chaveCli);
    const totalCompras = cli?.totalCompras ?? 1;
    const lojistaFlag = detectarLojista(v, totalCompras);
    if (lojistaFlag) {
      const aiCell = row.getCell(COL.AI_LOJISTA);
      aiCell.value = lojistaFlag;
      aiCell.alignment = { horizontal: "center" };
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

    // AM — Obs Extra (lojista + ano da venda)
    if (lojistaFlag && v.data_venda) {
      const ano = v.data_venda.getFullYear();
      const nAno = comprasPorAno.get(chaveCli)?.get(ano) ?? 0;
      if (nAno > 0) {
        const amCell = row.getCell(COL.AM_OBS_EXTRA);
        amCell.value = `LOJISTA - COMPROU ${nAno} CARROS ${ano}`;
        amCell.alignment = { horizontal: "left" };
        amCell.font = { italic: true, size: 10 };
      }
    }

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
  totRow.getCell(COL.N_CUSTO_REAL).value = totCustoReal;
  totRow.getCell(COL.O_VALOR_VENDA).value = totValorVenda;
  totRow.getCell(COL.P_MARGEM_BRUTA).value = totMargemBruta;
  totRow.getCell(COL.Q_PCT_BRUTA).value = totValorVenda > 0 ? totMargemBruta / totValorVenda : 0;
  totRow.getCell(COL.T_OFICINA).value = totDespOficina;
  totRow.getCell(COL.V_FORPLAN).value = totForplan;
  totRow.getCell(COL.X_IMPOSTOS).value = totImpostos;
  totRow.getCell(COL.Z_COMISSAO).value = totComissao;
  totRow.getCell(COL.AB_CUSTO_TOTAL).value = totCustoTotal;
  totRow.getCell(COL.AC_MARGEM_LIQ).value = totMargemLiq;
  totRow.getCell(COL.AD_PCT_LIQ).value = totValorVenda > 0 ? totMargemLiq / totValorVenda : 0;

  // Formatação da linha TOTAL
  const moneyColsTot = [
    COL.I_VALOR_ENTRADA, COL.L_VALORIZA, COL.N_CUSTO_REAL, COL.O_VALOR_VENDA,
    COL.P_MARGEM_BRUTA, COL.T_OFICINA, COL.V_FORPLAN, COL.X_IMPOSTOS,
    COL.Z_COMISSAO, COL.AB_CUSTO_TOTAL, COL.AC_MARGEM_LIQ,
  ];
  const pctColsTot = [COL.Q_PCT_BRUTA, COL.AD_PCT_LIQ];
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
  if (pctBrutas.length > 0) medRow.getCell(COL.Q_PCT_BRUTA).value = avg(pctBrutas);
  if (pctFipe.length > 0) medRow.getCell(COL.S_PCT_FIPE).value = avg(pctFipe);
  if (pctOficina.length > 0) medRow.getCell(COL.U_PCT_OFICINA).value = avg(pctOficina);
  if (pctForplan.length > 0) medRow.getCell(COL.W_PCT_FORPLAN).value = avg(pctForplan);
  if (pctImpostos.length > 0) medRow.getCell(COL.Y_PCT_IMPOSTOS).value = avg(pctImpostos);
  if (pctComissao.length > 0) medRow.getCell(COL.AA_PCT_COMISSAO).value = avg(pctComissao);
  if (pctLiq.length > 0) medRow.getCell(COL.AD_PCT_LIQ).value = avg(pctLiq);
  for (const c of [COL.Q_PCT_BRUTA, COL.S_PCT_FIPE, COL.U_PCT_OFICINA, COL.W_PCT_FORPLAN, COL.Y_PCT_IMPOSTOS, COL.AA_PCT_COMISSAO, COL.AD_PCT_LIQ]) {
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
  qtRow.getCell(COL.O_VALOR_VENDA).value = vendas.length;
  qtRow.getCell(COL.O_VALOR_VENDA).numFmt = FMT_INT;
  qtRow.getCell(COL.O_VALOR_VENDA).alignment = { horizontal: "right" };
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
  // BLOCO DE KPIs (pula 2 linhas)
  // ═══════════════════════════════════════════════════════════════════
  let kpiRow = QT_ROW + 3;

  // Título do bloco
  const titCell = ws.getRow(kpiRow).getCell(COL.B_SEQ);
  titCell.value = "KPIs DA MESA";
  titCell.font = { bold: true, size: 12 };
  titCell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: COLOR.grayHeader },
  };
  kpiRow++;

  // Helpers locais
  const setKpiLine = (label: string, val: number | string | null, pct: number | null = null, isMoney = true) => {
    const r = ws.getRow(kpiRow);
    r.getCell(COL.B_SEQ).value = label;
    r.getCell(COL.B_SEQ).font = { bold: false };
    r.getCell(COL.B_SEQ).alignment = { horizontal: "left" };
    if (val != null) {
      const valCell = r.getCell(COL.E_PLACA);
      valCell.value = val;
      if (typeof val === "number") {
        valCell.numFmt = isMoney ? FMT_MONEY : FMT_INT;
      }
      valCell.alignment = { horizontal: "right" };
      valCell.font = { bold: true };
    }
    if (pct != null) {
      const pctCell = r.getCell(COL.H_COR);
      pctCell.value = pct;
      pctCell.numFmt = FMT_PERCENT;
      pctCell.alignment = { horizontal: "right" };
      pctCell.font = { bold: true };
    }
    kpiRow++;
  };

  setKpiLine("Total faturamento", totValorVenda);
  setKpiLine(
    "Total margem bruta",
    totMargemBruta,
    totValorVenda > 0 ? totMargemBruta / totValorVenda : 0,
  );
  setKpiLine(
    "Total margem líquida",
    totMargemLiq,
    totValorVenda > 0 ? totMargemLiq / totValorVenda : 0,
  );
  setKpiLine("Total ganhos indiretos", totGanhosIndiretos);
  setKpiLine(
    "Total despesas operac.",
    totDespOficina + totForplan + totImpostos + totComissao,
  );

  // ─── Linhas de FIPE (PREPARADAS, COMENTADAS) ─────────────────────────────
  // TODO(fipe-integration): reabilitar quando integração FIPE estiver completa.
  // Quando integração FIPE estiver completa (cache de valor R$ por chassi/modelo),
  // descomente as 3 linhas abaixo. Hoje só temos o match FIPE (descrição), não o R$.
  //
  // const totFipe = somaFipeProjetada(vendas);  // 88% do valor FIPE
  // setKpiLine("Projetado 88% FIPE", totFipe);
  // setKpiLine("Atual (venda real)", totValorVenda);
  // const dif = totValorVenda - totFipe;
  // setKpiLine("Diferença vs projetado", dif, totFipe > 0 ? dif / totFipe : 0);

  // ─── % Trade-in (qt com troca / qt total) ───
  setKpiLine(
    "% Trade-in",
    null,
    vendas.length > 0 ? qtTrade / vendas.length : 0,
  );
  // Linhas manuais (preenchimento posterior)
  const manualLine = (label: string) => {
    const r = ws.getRow(kpiRow);
    r.getCell(COL.B_SEQ).value = label;
    r.getCell(COL.E_PLACA).value = "manual";
    r.getCell(COL.E_PLACA).font = { italic: true, color: { argb: "FF6B7280" } };
    r.getCell(COL.E_PLACA).alignment = { horizontal: "right" };
    kpiRow++;
  };
  manualLine("% Financiou");
  manualLine("% Cortesia documento");

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

function thinBorder(): ExcelJS.Borders {
  const side: Partial<ExcelJS.Border> = { style: "thin", color: { argb: "FFD1D5DB" } };
  // exceljs tipa Borders com diagonal{Up,Down} também — só preenchemos os 4 lados.
  return {
    top: side,
    bottom: side,
    left: side,
    right: side,
    diagonal: { up: false, down: false },
  } as ExcelJS.Borders;
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
