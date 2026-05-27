import * as XLSX from "xlsx";

export type VendaParsed = {
  // Identidade
  chassi: string;
  placa: string;
  modelo: string;
  marca: string | null;
  ano_fabricacao: number | null;
  ano_modelo: number | null;
  cor_externa: string | null;
  renavam: string | null;
  km: number | null;

  // Loja
  cod_empresa: number;
  empresa_nome: string | null;
  patio: string | null;

  // Vendedor
  vendedor_codigo: string | null;
  vendedor_nome: string | null;
  vendedor_cpf: string | null;
  vendedor_recebeu: string | null;

  // Cliente
  cliente_codigo: string | null;
  cliente_nome: string;
  cliente_tipo: "PF" | "PJ" | null;
  cliente_cidade: string | null;
  cliente_uf: string | null;

  // Datas
  data_venda: Date | null;
  data_faturamento: Date | null;
  data_entrada: Date | null;

  // Financeiro
  valor_venda: number | null;
  preco_venda_tabela: number | null;
  total_nota_fabrica: number | null;
  custo_floor_plan: number | null;
  custo_total_final: number | null;
  despesas_gerais: number | null;
  margem_pct: number | null;
  comissao_vendedor: number | null;

  // Giro / troca
  dias_estoque: number | null;
  placa_troca: string | null;
};

export type VendasSnapshotMeta = {
  arquivo_nome: string;
  data_geracao: Date | null;
  total_vendas: number;
  total_lojas: number;
  total_vendedores: number;
  periodo_inicio: Date | null;
  periodo_fim: Date | null;
};

export type VendasParseResult = {
  meta: VendasSnapshotMeta;
  vendas: VendaParsed[];
  warnings: string[];
};

/**
 * Mapeamento de campo canônico -> lista de headers possíveis no XLSX do NBS.
 * Quando houver múltiplas colunas com o mesmo nome (ex: "Cor Externa" 3x),
 * usamos a que tiver MAIS células preenchidas na amostra inicial.
 */
const FIELD_HEADERS: Record<string, string[]> = {
  modelo: ["Modelo", "Decrição Modelo", "Descrição Modelo"],
  chassi: ["Chassi Completo"],
  placa: ["Placa Usado", "Placa"],
  valor_venda: ["Valor Venda"],
  preco_venda: ["Preço venda", "Preço Venda"],
  total_nota_fabrica: ["Total Nota Fabrica"],
  custo_floor_plan: ["Custo Floor-Plan Final"],
  custo_total_final: ["Custo Total Final"],
  data_venda: ["Data venda", "Dt.Venda", "Data Venda"],
  data_faturamento: ["Data Faturamento"],
  data_entrada: ["Data Entrada"],
  cod_empresa_vendedora: ["Cód. Empresa Vendedora"],
  empresa_vendedora: ["Empresa Vendedora", "Empresa"],
  patio: ["Pátio", "Patio"],
  vendedor_codigo: ["Vendedor"],
  vendedor_nome: ["Nome Vendedor Completo"],
  vendedor_cpf: ["CPF do Vendedor"],
  vendedor_recebeu: ["Vendedor que Recebeu", "Vendedor quem Recebeu"],
  cliente_codigo: ["Cód. Cliente"],
  cliente_nome: ["Nome Cliente"],
  cliente_cidade: ["Cidade Cliente"],
  cliente_uf: ["UF", "Cliente UF"],
  cor_externa: ["Cor Externa"],
  ano_modelo: ["Ano/Modelo", "Ano/m"],
  renavam: ["Renavam"],
  km: ["KM_USADO", "Quilometragem", "KM"],
  comb: ["Comb"],
  tipo: ["Tipo"],
  marca: ["Descrição Marca", "Marca", "Linha1"],
  media_dias: ["MEDIA_DIAS", "Media dia", "Media Dias"],
  comissao_vendedor: ["Comissão Final Vendedor"],
  despesas_gerais: ["Desp. Gerais", "Desp.Gerais"],
  placa_troca: ["Placa veic. troca", "Placa Veic. Troca"],
  margem_pct: ["Margem%", "Margem Final"],
};

/**
 * Para cada campo, retorna o índice de coluna escolhido (ou -1 se não encontrado).
 * Quando o mesmo header aparece em múltiplas colunas, escolhe a que tem MAIS dados
 * preenchidos numa amostra das primeiras linhas.
 */
function lookupColumns(
  headerRow: unknown[],
  sampleRows: unknown[][],
): Record<string, number> {
  const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();
  const out: Record<string, number> = {};

  for (const [field, headers] of Object.entries(FIELD_HEADERS)) {
    // Itera aliases EM ORDEM — primeiro alias com pelo menos uma coluna no header vence.
    // Isso permite definir "Descrição Marca" como prioridade sobre "Linha1" (fallback).
    let chosen = -1;
    for (const alias of headers) {
      const target = norm(alias);
      const candidates: number[] = [];
      for (let i = 0; i < headerRow.length; i++) {
        if (norm(headerRow[i]) === target) candidates.push(i);
      }
      if (candidates.length === 0) continue;

      if (candidates.length === 1) {
        chosen = candidates[0];
        break;
      }
      // Múltiplas colunas com o MESMO header — desempata por preenchimento na amostra
      let best = candidates[0];
      let bestFill = -1;
      for (const c of candidates) {
        let fill = 0;
        for (const row of sampleRows) {
          const v = row[c];
          if (v !== null && v !== undefined && v !== "" && v !== 0) fill++;
        }
        if (fill > bestFill) { bestFill = fill; best = c; }
      }
      chosen = best;
      break;
    }
    out[field] = chosen;
  }

  return out;
}

function asStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === "" || s === "-----" || s === "----" || s === "0") return null;
  return s;
}

function asNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (s === "" || s === "-----") return null;
  const normalized = s.includes(",") && !s.includes(".") ? s.replace(",", ".") : s.replace(/\./g, "").replace(",", ".");
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}

function asInt(v: unknown): number | null {
  const n = asNum(v);
  return n === null ? null : Math.trunc(n);
}

function parseAnoM(value: unknown): { fab: number | null; mod: number | null } {
  const s = asStr(value);
  if (!s) return { fab: null, mod: null };
  const m = s.match(/^(\d{2})\/(\d{2})$/);
  if (!m) return { fab: null, mod: null };
  const yy = (n: number) => (n >= 50 ? 1900 + n : 2000 + n);
  return { fab: yy(parseInt(m[1], 10)), mod: yy(parseInt(m[2], 10)) };
}

function asDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "number") {
    // Serial date Excel
    if (v < 1 || v > 100000) return null;
    const date = new Date(Math.round((v - 25569) * 86400 * 1000));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const s = asStr(v);
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2}))?/);
  if (iso) {
    return new Date(
      parseInt(iso[1], 10), parseInt(iso[2], 10) - 1, parseInt(iso[3], 10),
      iso[4] ? parseInt(iso[4], 10) : 0, iso[5] ? parseInt(iso[5], 10) : 0, iso[6] ? parseInt(iso[6], 10) : 0,
    );
  }
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?/);
  if (br) {
    return new Date(
      parseInt(br[3], 10), parseInt(br[2], 10) - 1, parseInt(br[1], 10),
      br[4] ? parseInt(br[4], 10) : 0, br[5] ? parseInt(br[5], 10) : 0, br[6] ? parseInt(br[6], 10) : 0,
    );
  }
  return null;
}

function parseEmpresaCell(value: unknown): { cod: number; nome: string } | null {
  const s = asStr(value);
  if (!s) return null;
  const m = s.match(/^0*(\d+)\s+(.+)$/);
  if (!m) return null;
  const cod = parseInt(m[1], 10);
  const nome = m[2].trim();
  if (!Number.isFinite(cod) || !nome) return null;
  return { cod, nome };
}

function detectTipoCliente(codigo: string | null): "PF" | "PJ" | null {
  if (!codigo) return null;
  const digits = codigo.replace(/\D/g, "");
  if (digits.length === 11) return "PF";
  if (digits.length === 14) return "PJ";
  return null;
}

function get(row: unknown[], cols: Record<string, number>, field: string): unknown {
  const idx = cols[field];
  if (idx === undefined || idx < 0 || idx >= row.length) return null;
  return row[idx];
}

export async function parseNbsVendasXlsx(
  fileBuffer: ArrayBuffer | Buffer,
  fileName: string,
): Promise<VendasParseResult> {
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

  if (rows.length < 4) {
    throw new Error("Estrutura inesperada: faltam linhas. Esperado título (0), data (1), header (2), dados (3+).");
  }

  const titulo = asStr(rows[0]?.[0])?.toLowerCase() ?? "";
  if (!titulo.includes("vendid")) {
    warnings.push(`Título inesperado: "${titulo}". Pode não ser relatório de vendas.`);
  }

  const dataGeracao = asDate(asStr(rows[1]?.[0])?.match(/(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2})/)?.[1]);

  const headerRow = rows[2];
  const dataRows = rows.slice(3);

  // Mapear colunas usando header + amostra das primeiras 30 linhas pra resolver duplicatas
  const sample = dataRows.slice(0, 30);
  const cols = lookupColumns(headerRow, sample);

  // Validar colunas essenciais
  const essenciais = ["chassi", "placa", "modelo"];
  for (const e of essenciais) {
    if (cols[e] < 0) {
      throw new Error(`Coluna essencial não encontrada no XLSX: "${e}". Headers procurados: ${FIELD_HEADERS[e].join(" | ")}`);
    }
  }

  const vendas: VendaParsed[] = [];
  const lojasSet = new Set<number>();
  const vendedoresSet = new Set<string>();
  let minData: Date | null = null, maxData: Date | null = null;

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    if (!row) continue;

    const tipo = asStr(get(row, cols, "tipo"));
    if (tipo && !tipo.toUpperCase().startsWith("USADO")) {
      warnings.push(`Linha ${i + 4}: Tipo="${tipo}" (não é Usado). Pulada.`);
      continue;
    }

    const chassi = asStr(get(row, cols, "chassi"));
    const placa = asStr(get(row, cols, "placa"));
    const modelo = asStr(get(row, cols, "modelo"));
    const empresa = parseEmpresaCell(get(row, cols, "empresa_vendedora"));
    const codEmpresa = empresa?.cod ?? asInt(get(row, cols, "cod_empresa_vendedora"));

    if (!chassi || !placa || !modelo || codEmpresa === null) {
      warnings.push(`Linha ${i + 4} ignorada: faltam campos essenciais.`);
      continue;
    }

    const { fab, mod } = parseAnoM(get(row, cols, "ano_modelo"));
    const cliente_codigo = asStr(get(row, cols, "cliente_codigo"));
    const data_venda = asDate(get(row, cols, "data_venda"));

    if (data_venda) {
      if (!minData || data_venda < minData) minData = data_venda;
      if (!maxData || data_venda > maxData) maxData = data_venda;
    }

    const vendedor_codigo = asStr(get(row, cols, "vendedor_codigo"));
    if (vendedor_codigo) vendedoresSet.add(vendedor_codigo);

    vendas.push({
      chassi,
      placa,
      modelo,
      marca: asStr(get(row, cols, "marca")),
      ano_fabricacao: fab,
      ano_modelo: mod,
      cor_externa: asStr(get(row, cols, "cor_externa"))?.toUpperCase() ?? null,
      renavam: asStr(get(row, cols, "renavam")),
      km: asInt(get(row, cols, "km")),

      cod_empresa: codEmpresa,
      empresa_nome: empresa?.nome ?? null,
      patio: asStr(get(row, cols, "patio")),

      vendedor_codigo,
      vendedor_nome: asStr(get(row, cols, "vendedor_nome")),
      vendedor_cpf: asStr(get(row, cols, "vendedor_cpf")),
      vendedor_recebeu: asStr(get(row, cols, "vendedor_recebeu")),

      cliente_codigo,
      cliente_nome: asStr(get(row, cols, "cliente_nome")) ?? "(sem nome)",
      cliente_tipo: detectTipoCliente(cliente_codigo),
      cliente_cidade: asStr(get(row, cols, "cliente_cidade")),
      cliente_uf: asStr(get(row, cols, "cliente_uf")),

      data_venda,
      data_faturamento: asDate(get(row, cols, "data_faturamento")),
      data_entrada: asDate(get(row, cols, "data_entrada")),

      valor_venda: asNum(get(row, cols, "valor_venda")),
      preco_venda_tabela: asNum(get(row, cols, "preco_venda")),
      total_nota_fabrica: asNum(get(row, cols, "total_nota_fabrica")),
      custo_floor_plan: asNum(get(row, cols, "custo_floor_plan")),
      custo_total_final: asNum(get(row, cols, "custo_total_final")),
      despesas_gerais: asNum(get(row, cols, "despesas_gerais")),
      margem_pct: asNum(get(row, cols, "margem_pct")),
      comissao_vendedor: asNum(get(row, cols, "comissao_vendedor")),

      dias_estoque: asInt(get(row, cols, "media_dias")),
      placa_troca: asStr(get(row, cols, "placa_troca")),
    });

    lojasSet.add(codEmpresa);
  }

  return {
    meta: {
      arquivo_nome: fileName,
      data_geracao: dataGeracao,
      total_vendas: vendas.length,
      total_lojas: lojasSet.size,
      total_vendedores: vendedoresSet.size,
      periodo_inicio: minData,
      periodo_fim: maxData,
    },
    vendas,
    warnings,
  };
}
