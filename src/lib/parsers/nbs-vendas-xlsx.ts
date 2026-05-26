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

const COL = {
  veiculo: 0,
  cor_externa: 2,
  modelo: 3,
  chassi_resumido: 6,
  cod_cliente: 9,
  vendedor_codigo: 12,
  chassi_completo: 15,
  total_nota_fabrica: 19,
  data_faturamento: 24,
  data_entrada: 25,
  placa_usado: 30,
  valor_venda: 32,
  custo_floor_plan: 34,
  ano_modelo: 40,
  preco_venda: 41,
  tipo: 50,
  data_venda: 52,
  margem_pct: 56,
  comissao_final_vendedor: 84,
  custo_total_final: 90,
  cod_empresa_vendedora: 116,
  nome_cliente: 121,
  empresa_vendedora: 130,
  descricao_marca: 132,
  vendedor_recebeu: 138,
  patio: 156,
  despesas_gerais: 165,
  cpf_vendedor: 277,
  nome_vendedor: 278,
  cidade_cliente: 317,
  uf_cliente: 318,
  placa_troca: 341,
  renavam: 47,
  media_dias: 281,
} as const;

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
    // Excel serial date
    const date = new Date(Math.round((v - 25569) * 86400 * 1000));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const s = asStr(v);
  if (!s) return null;
  // ISO 2026-04-29 or 2026-04-29T11:07:55 or 2026-04-29 11:07:55
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2}))?/);
  if (iso) {
    return new Date(
      parseInt(iso[1], 10), parseInt(iso[2], 10) - 1, parseInt(iso[3], 10),
      iso[4] ? parseInt(iso[4], 10) : 0, iso[5] ? parseInt(iso[5], 10) : 0, iso[6] ? parseInt(iso[6], 10) : 0,
    );
  }
  // dd/mm/yyyy
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

  // Validar que é "Veículos vendidos" — não estoque
  const titulo = asStr(rows[0]?.[0])?.toLowerCase() ?? "";
  if (!titulo.includes("vendid")) {
    warnings.push(`Título inesperado: "${titulo}". Pode não ser relatório de vendas.`);
  }

  const dataGeracao = asDate(asStr(rows[1]?.[0])?.match(/(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2})/)?.[1]);

  const dataRows = rows.slice(3);
  const vendas: VendaParsed[] = [];
  const lojasSet = new Set<number>();
  const vendedoresSet = new Set<string>();
  let minData: Date | null = null, maxData: Date | null = null;

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    if (!row) continue;

    const tipo = asStr(row[COL.tipo]);
    if (tipo && !tipo.toUpperCase().startsWith("USADO")) {
      warnings.push(`Linha ${i + 4}: Tipo="${tipo}" (não é Usado). Pulada.`);
      continue;
    }

    const chassi = asStr(row[COL.chassi_completo]);
    const placa = asStr(row[COL.placa_usado]);
    const modelo = asStr(row[COL.modelo]);
    const empresa = parseEmpresaCell(row[COL.empresa_vendedora]);
    const codEmpresa = empresa?.cod ?? asInt(row[COL.cod_empresa_vendedora]);

    if (!chassi || !placa || !modelo || codEmpresa === null) {
      warnings.push(`Linha ${i + 4} ignorada: faltam campos essenciais (chassi/placa/modelo/loja).`);
      continue;
    }

    const { fab, mod } = parseAnoM(row[COL.ano_modelo]);
    const cliente_codigo = asStr(row[COL.cod_cliente]);
    const data_venda = asDate(row[COL.data_venda]);

    if (data_venda) {
      if (!minData || data_venda < minData) minData = data_venda;
      if (!maxData || data_venda > maxData) maxData = data_venda;
    }

    const vendedor_codigo = asStr(row[COL.vendedor_codigo]);
    if (vendedor_codigo) vendedoresSet.add(vendedor_codigo);

    vendas.push({
      chassi,
      placa,
      modelo,
      marca: asStr(row[COL.descricao_marca]),
      ano_fabricacao: fab,
      ano_modelo: mod,
      cor_externa: asStr(row[COL.cor_externa])?.toUpperCase() ?? null,
      renavam: asStr(row[COL.renavam]),

      cod_empresa: codEmpresa,
      empresa_nome: empresa?.nome ?? null,
      patio: asStr(row[COL.patio]),

      vendedor_codigo,
      vendedor_nome: asStr(row[COL.nome_vendedor]),
      vendedor_cpf: asStr(row[COL.cpf_vendedor]),
      vendedor_recebeu: asStr(row[COL.vendedor_recebeu]),

      cliente_codigo,
      cliente_nome: asStr(row[COL.nome_cliente]) ?? "(sem nome)",
      cliente_tipo: detectTipoCliente(cliente_codigo),
      cliente_cidade: asStr(row[COL.cidade_cliente]),
      cliente_uf: asStr(row[COL.uf_cliente]),

      data_venda,
      data_faturamento: asDate(row[COL.data_faturamento]),
      data_entrada: asDate(row[COL.data_entrada]),

      valor_venda: asNum(row[COL.valor_venda]),
      preco_venda_tabela: asNum(row[COL.preco_venda]),
      total_nota_fabrica: asNum(row[COL.total_nota_fabrica]),
      custo_floor_plan: asNum(row[COL.custo_floor_plan]),
      custo_total_final: asNum(row[COL.custo_total_final]),
      despesas_gerais: asNum(row[COL.despesas_gerais]),
      margem_pct: asNum(row[COL.margem_pct]),
      comissao_vendedor: asNum(row[COL.comissao_final_vendedor]),

      dias_estoque: asInt(row[COL.media_dias]),
      placa_troca: asStr(row[COL.placa_troca]),
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
