import * as XLSX from "xlsx";

export type VeiculoParsed = {
  cod_empresa: number;
  chassi: string;
  placa: string;
  marca: string | null;
  modelo: string;
  ano_fabricacao: number | null;
  ano_modelo: number | null;
  cor_externa: string | null;
  combustivel: string | null;
  km: number | null;
  patio: string;
  descricao_situacao: string | null;
  preco_venda: number | null;
  valor_aquisicao: number | null;
  custo_total: number | null;
  dias_patio: number | null;
  data_entrada: Date | null;
  vendedor_recebeu: string | null;
  /** Cód. Proposta Internet (col 310). Preenchido = carro tem proposta/reserva ativa. */
  cod_proposta: string | null;
  /**
   * Bônus/"Valoriza" da fábrica (CODIGO_CUSTO 620 "Ford Valoriza" ou 462
   * "Bonus CVP" em NBS.VEICULOS_CUSTOS_ESPECIFICOS, somados por
   * chassi_resumido+loja atual — ver scripts/sync-nbs/valoriza.ts). Sempre
   * `number`, nunca `null`: ausência de bônus é um fato conhecido (zero), não
   * "não sabemos". Só o sync Oracle preenche o valor real; o parser manual de
   * XLSX (parseNbsXlsx) não tem acesso a essa tabela e grava sempre 0.
   */
  valoriza: number;
  /**
   * Categorias do relatório nativo NBS "Custos de Veículos em Estoque" (ver
   * scripts/sync-nbs/custos-estoque-detalhado.ts e migrations 040/048).
   * Mesmo contrato de `valoriza`: sempre `number`, nunca `null` — ausência de
   * custo lançado naquela categoria é fato conhecido (zero). Só o sync
   * Oracle preenche o valor real; o parser manual de XLSX grava sempre 0.
   *
   * NOTA: `custo_adm` (coluna NULLABLE SEM DEFAULT no banco) NÃO tem
   * CODIGO_CUSTO/TIPO mapeado (provável rateio calculado pelo motor do
   * relatório NBS, fora de escopo) — por isso NENHUM sync/parser escreve
   * valor nela (`toRow()` em `lib/data/veiculos.ts` omite de propósito,
   * deixando o Postgres gravar NULL). O campo abaixo é só de LEITURA
   * (export/exibição): `fromRow()` lê o que já está no banco (sempre NULL
   * hoje) sem jamais inventar um 0. Nunca tornar esse campo `number`
   * obrigatório — isso apagaria a distinção "não apurado".
   *
   * `custo_despesas_gerais` DEIXOU de ser "não apurado" em 07/10/2026
   * (migration 048): agora tem fonte automática real — SUM(VALOR_FINAL) de
   * NBS.VEICULOS_CUSTOS_ESPECIFICOS cujo CODIGO_CUSTO tem TIPO=9 em
   * NBS.CUSTOS_ESPECIFICOS (validado 99,3%, 426/429 veículos reais) — por
   * isso virou `number` obrigatório, mesmo padrão computado das demais.
   */
  custo_impostos: number;
  custo_revisoes: number;
  custo_holdback: number;
  custo_acessorios: number;
  custo_forplan: number;
  custo_comissoes: number;
  custo_despesas_gerais: number;
  /** Só leitura — ver NOTA acima. Sempre `null` até existir fórmula de cálculo. */
  custo_adm?: number | null;
};

export type SnapshotMeta = {
  arquivo_nome: string;
  data_geracao: Date | null;
  total_veiculos: number;
  total_lojas: number;
};

export type LojaParsed = {
  cod_empresa: number;
  nome: string;
};

export type ParseResult = {
  meta: SnapshotMeta;
  veiculos: VeiculoParsed[];
  lojas: LojaParsed[];
  warnings: string[];
};

const COL = {
  cod_empresa: 0,
  modelo: 2,
  chassi_completo: 3,
  linha: 4,
  marca_completa: 445,
  preco_venda: 6,
  cor_externa: 7,
  ano_m: 9,
  dpt: 10,
  placa: 13,
  comb: 17,
  patio: 22,
  total_nota_fabrica: 31,
  vendedor_recebeu: 36,
  descricao_situacao: 37,
  custo_total: 46,
  entrada: 50,
  cod_proposta_internet: 310,
  empresa_nome: 401,
  km: 441,
} as const;

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

function asStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === "" || s === "-----" || s === "----") return null;
  return s;
}

function asNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function asInt(v: unknown): number | null {
  const n = asNum(v);
  return n === null ? null : Math.trunc(n);
}

function normalizeCor(cor: string | null): string | null {
  if (!cor) return null;
  const upper = cor.toUpperCase().trim().replace(/\s+/g, " ");
  if (upper === "PRETA") return "PRETO";
  return upper;
}

function parseAnoM(value: unknown): { fab: number | null; mod: number | null } {
  const s = asStr(value);
  if (!s) return { fab: null, mod: null };
  const m = s.match(/^(\d{2})\/(\d{2})$/);
  if (!m) return { fab: null, mod: null };
  const yy = (n: number) => (n >= 50 ? 1900 + n : 2000 + n);
  return { fab: yy(parseInt(m[1], 10)), mod: yy(parseInt(m[2], 10)) };
}

function parseDataEntrada(value: unknown): Date | null {
  const s = asStr(value);
  if (!s) return null;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?$/);
  if (!m) return null;
  const [, dd, mm, yyyy, hh = "0", mi = "0", ss = "0"] = m;
  const date = new Date(
    parseInt(yyyy, 10),
    parseInt(mm, 10) - 1,
    parseInt(dd, 10),
    parseInt(hh, 10),
    parseInt(mi, 10),
    parseInt(ss, 10),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseDataGeracaoFromHeader(line: unknown): Date | null {
  const s = asStr(line);
  if (!s) return null;
  const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  return parseDataEntrada(`${m[1]}/${m[2]}/${m[3]} ${m[4]}:${m[5]}:${m[6]}`);
}

export async function parseNbsXlsx(
  fileBuffer: ArrayBuffer | Buffer,
  fileName: string,
): Promise<ParseResult> {
  const warnings: string[] = [];
  const workbook = XLSX.read(fileBuffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Planilha vazia: nenhuma aba encontrada.");

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    blankrows: false,
  });

  if (rows.length < 4) {
    throw new Error(
      "Estrutura inesperada: faltam linhas. Esperado título (0), data (1), header (2), dados (3+).",
    );
  }

  const dataGeracao = parseDataGeracaoFromHeader(rows[1]?.[0]);
  if (!dataGeracao) warnings.push("Linha 2: não consegui extrair data de geração.");

  const header = rows[2];
  if (asStr(header?.[COL.cod_empresa])?.toLowerCase() !== "cód empresa") {
    warnings.push(
      `Header inesperado na col 0: "${header?.[COL.cod_empresa]}". Esperado "Cód Empresa".`,
    );
  }

  const dataRows = rows.slice(3);
  const veiculos: VeiculoParsed[] = [];
  const lojasMap = new Map<number, string>();

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    if (!row) continue;

    const cod_empresa = asInt(row[COL.cod_empresa]);
    const chassi = asStr(row[COL.chassi_completo]);
    const placa = asStr(row[COL.placa]);
    const modelo = asStr(row[COL.modelo]);
    const patio = asStr(row[COL.patio]);

    if (cod_empresa === null || !chassi || !placa || !modelo || !patio) {
      warnings.push(`Linha ${i + 4} ignorada: faltam campos essenciais.`);
      continue;
    }

    const { fab, mod } = parseAnoM(row[COL.ano_m]);

    // Marca: prefere a coluna 445 (nome completo: 'Chevrolet', 'Ford Autos'…),
    // fallback para col 4 'Linha' (abreviada a 6 chars: 'CHEVRO', 'FORD'…).
    const marcaCompleta = asStr(row[COL.marca_completa]);
    const marcaLinha = asStr(row[COL.linha]);
    const marca = marcaCompleta ?? marcaLinha;

    // Cód. Proposta Internet (col 310): preenchido = carro com proposta/reserva
    // ativa. asStr já trata vazio e "----"; tratamos "0" como sem proposta.
    const codProp = asStr(row[COL.cod_proposta_internet]);
    const cod_proposta = codProp && codProp !== "0" ? codProp : null;

    veiculos.push({
      cod_empresa,
      chassi,
      placa,
      marca,
      modelo,
      ano_fabricacao: fab,
      ano_modelo: mod,
      cor_externa: normalizeCor(asStr(row[COL.cor_externa])),
      combustivel: asStr(row[COL.comb]),
      km: asInt(row[COL.km]),
      patio,
      descricao_situacao: asStr(row[COL.descricao_situacao]),
      preco_venda: asNum(row[COL.preco_venda]),
      valor_aquisicao: asNum(row[COL.total_nota_fabrica]),
      custo_total: asNum(row[COL.custo_total]),
      dias_patio: asInt(row[COL.dpt]),
      data_entrada: parseDataEntrada(row[COL.entrada]),
      vendedor_recebeu: asStr(row[COL.vendedor_recebeu]),
      cod_proposta,
      // Parser manual (XLSX de estoque) não tem acesso a
      // NBS.VEICULOS_CUSTOS_ESPECIFICOS — só o sync Oracle calcula o valor
      // real (ver scripts/sync-nbs/valoriza.ts e custos-estoque-detalhado.ts).
      valoriza: 0,
      custo_impostos: 0,
      custo_revisoes: 0,
      custo_holdback: 0,
      custo_acessorios: 0,
      custo_forplan: 0,
      custo_comissoes: 0,
      custo_despesas_gerais: 0,
    });

    const empresa = parseEmpresaCell(row[COL.empresa_nome]);
    if (empresa && empresa.cod === cod_empresa && !lojasMap.has(empresa.cod)) {
      lojasMap.set(empresa.cod, empresa.nome);
    } else if (!lojasMap.has(cod_empresa)) {
      lojasMap.set(cod_empresa, "");
    }
  }

  const lojas: LojaParsed[] = [...lojasMap.entries()]
    .map(([cod, nome]) => ({ cod_empresa: cod, nome }))
    .sort((a, b) => a.cod_empresa - b.cod_empresa);

  return {
    meta: {
      arquivo_nome: fileName,
      data_geracao: dataGeracao,
      total_veiculos: veiculos.length,
      total_lojas: lojasMap.size,
    },
    veiculos,
    lojas,
    warnings,
  };
}
