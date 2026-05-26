import * as XLSX from "xlsx";

/**
 * Custos detalhados de UMA venda, vindos do "Relatório de Custos" do NBS.
 * Estrutura validada com relatório de seminovos: 18 colunas, header na linha 5.
 */
export type CustoDetalhado = {
  modelo: string;
  placa: string;
  data_fatura: Date | null;
  data_venda: Date | null;
  dias_patio: number | null;

  // Componentes do custo (já líquidos quando aplicável)
  nota_fabrica_taxa_icms: number;  // [05] aquisição líquida de ICMS
  despesas_oficina: number;         // [06]
  frete_icms_frete: number;         // [07]
  forplan: number;                  // [08]
  impostos: number;                 // [09] PIS + COFINS + ICMS consolidados
  comissoes: number;                // [10]
  ganhos_indiretos: number;         // [11] Bônus de fábrica + Valorização (REDUZ custo)
  adm: number;                      // [12]
  despesas_gerais: number;          // [13]

  // Consolidado oficial NBS
  custo_total: number;              // [14]
  valor_vendido: number;            // [15]
  margem_real: number;              // [16]
  margem_pct: number;               // [17]
};

export type CustosMeta = {
  arquivo_nome: string;
  periodo: string | null;
  data_geracao: Date | null;
  total_vendas: number;
  loja_principal: string | null;
};

export type CustosParseResult = {
  meta: CustosMeta;
  custos: CustoDetalhado[];
  warnings: string[];
};

const COL = {
  modelo: 0,
  placa: 1,
  data_fatura: 2,
  data_venda: 3,
  dias_patio: 4,
  nota_fabrica: 5,
  desp_oficina: 6,
  frete: 7,
  forplan: 8,
  impostos: 9,
  comissoes: 10,
  ganhos_indiretos: 11,
  adm: 12,
  desp_gerais: 13,
  custo_total: 14,
  valor_vendido: 15,
  margem_real: 16,
  margem_pct: 17,
} as const;

function asNum(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v).trim();
  if (!s) return 0;
  const normalized = s.includes(",") && !s.includes(".") ? s.replace(",", ".") : s.replace(/\./g, "").replace(",", ".");
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? n : 0;
}

function asStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function asDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "number") {
    if (v < 1 || v > 100000) return null;
    const date = new Date(Math.round((v - 25569) * 86400 * 1000));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const s = asStr(v);
  if (!s) return null;
  // dd/mm/yyyy
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) {
    return new Date(parseInt(br[3], 10), parseInt(br[2], 10) - 1, parseInt(br[1], 10));
  }
  // ISO
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return new Date(parseInt(iso[1], 10), parseInt(iso[2], 10) - 1, parseInt(iso[3], 10));
  }
  return null;
}

/** Detecta se a linha é um cabeçalho de seção, subtotal ou total (não é dado válido). */
function isHeaderOrTotalRow(row: unknown[]): boolean {
  const first = asStr(row[0])?.toLowerCase() ?? "";
  if (!first) return true;
  if (first.startsWith("total") || first.startsWith("subtotal") || first === "navesa") return true;
  if (first.match(/^\d{2}\s+/)) return true; // ex: "02 NAVESA FORD AEROPORTO" — header de loja
  if (first.startsWith("usados")) return true;
  if (first.startsWith("custos de")) return true;
  if (first.includes("data da impress")) return true;
  // Linha de header de colunas (Modelo, Placa, etc)
  if (first === "modelo") return true;
  return false;
}

export async function parseNbsCustosXls(
  fileBuffer: ArrayBuffer | Buffer,
  fileName: string,
): Promise<CustosParseResult> {
  const warnings: string[] = [];
  const workbook = XLSX.read(fileBuffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Planilha vazia.");

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    blankrows: false,
  });

  // Validar título
  const titulo = asStr(rows[0]?.[0])?.toLowerCase() ?? "";
  if (!titulo.includes("custo")) {
    warnings.push(`Título inesperado: "${titulo}". Esperado conter "custo".`);
  }

  // Metadata
  const periodo = asStr(rows[1]?.[0]);
  const loja = asStr(rows[3]?.[0]);
  const impressaoMatch = asStr(rows[3]?.[10])?.match(/(\d{2}\/\d{2}\/\d{4})/);
  const dataGeracao = impressaoMatch ? asDate(impressaoMatch[1]) : null;

  // Encontrar a linha do header dinamicamente
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    if (asStr(rows[i]?.[0])?.toLowerCase() === "modelo" && asStr(rows[i]?.[1])?.toLowerCase() === "placa") {
      headerRowIdx = i;
      break;
    }
  }
  if (headerRowIdx === -1) {
    throw new Error("Não encontrei a linha de header (procurando 'Modelo' + 'Placa'). Verifique o formato.");
  }

  // Validar que as colunas estão na ordem esperada
  const header = rows[headerRowIdx];
  if (asStr(header[COL.margem_real])?.toLowerCase() !== "margem real") {
    warnings.push(`Coluna 'Margem Real' não está na posição ${COL.margem_real}. Verifique o formato.`);
  }

  const custos: CustoDetalhado[] = [];
  const placasVistas = new Set<string>();

  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    if (isHeaderOrTotalRow(row)) continue;

    const modelo = asStr(row[COL.modelo]);
    const placa = asStr(row[COL.placa]);
    if (!modelo || !placa) continue;

    // Sanity check: linhas válidas devem ter pelo menos Valor Vendido > 0 ou Custo Total > 0
    const valor = asNum(row[COL.valor_vendido]);
    const custoTotal = asNum(row[COL.custo_total]);
    if (valor === 0 && custoTotal === 0) {
      warnings.push(`Linha ${i + 1} (placa ${placa}) ignorada: valor=0 e custo=0`);
      continue;
    }

    if (placasVistas.has(placa)) {
      warnings.push(`Placa duplicada ignorada: ${placa} (linha ${i + 1})`);
      continue;
    }
    placasVistas.add(placa);

    custos.push({
      modelo,
      placa,
      data_fatura: asDate(row[COL.data_fatura]),
      data_venda: asDate(row[COL.data_venda]),
      dias_patio: row[COL.dias_patio] !== null && row[COL.dias_patio] !== undefined
        ? Math.trunc(asNum(row[COL.dias_patio]))
        : null,
      nota_fabrica_taxa_icms: asNum(row[COL.nota_fabrica]),
      despesas_oficina: asNum(row[COL.desp_oficina]),
      frete_icms_frete: asNum(row[COL.frete]),
      forplan: asNum(row[COL.forplan]),
      impostos: asNum(row[COL.impostos]),
      comissoes: asNum(row[COL.comissoes]),
      ganhos_indiretos: asNum(row[COL.ganhos_indiretos]),
      adm: asNum(row[COL.adm]),
      despesas_gerais: asNum(row[COL.desp_gerais]),
      custo_total: custoTotal,
      valor_vendido: valor,
      margem_real: asNum(row[COL.margem_real]),
      margem_pct: asNum(row[COL.margem_pct]),
    });
  }

  return {
    meta: {
      arquivo_nome: fileName,
      periodo: periodo,
      data_geracao: dataGeracao,
      total_vendas: custos.length,
      loja_principal: loja,
    },
    custos,
    warnings,
  };
}

/**
 * Recalcula o custo total a partir dos componentes (para validação contra o NBS).
 * Fórmula oficial: Nota + Oficina + Frete + Forplan + Impostos + Comissões + ADM + Gerais − Ganhos Indiretos
 */
export function recalcularCustoTotal(c: CustoDetalhado): number {
  return c.nota_fabrica_taxa_icms
    + c.despesas_oficina
    + c.frete_icms_frete
    + c.forplan
    + c.impostos
    + c.comissoes
    + c.adm
    + c.despesas_gerais
    - c.ganhos_indiretos;
}
