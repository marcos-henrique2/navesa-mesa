import { normalizarCorNbs } from "@/lib/cores-nbs";
import type { VendaParsed } from "../../src/lib/parsers/nbs-vendas-xlsx";
import { parseAnoModelo } from "../../src/lib/parsers/ano-modelo";
import { buscarValoriza } from "./valoriza";

/**
 * Candidatos de nome de coluna no Oracle NBS.VEICULOS por campo canônico
 * (VendaParsed), em ordem de prioridade. NBS.VENDAS foi descartada (não é
 * tabela de vendas de veículo — ver comentário em sync-vendas.ts); vendas de
 * usado vêm de NBS.VEICULOS com DATA_VENDA preenchida. Mesma lógica de
 * "melhor hipótese + fallback gracioso" de mapear-veiculo.ts — ver comentário
 * lá.
 */
const CANDIDATOS: Record<keyof VendaParsed, string[]> = {
  chassi: ["CHASSI", "CHASSI_COMPLETO", "NUM_CHASSI"],
  placa: ["PLACA", "PLACA_USADO"],
  // JOIN_MODELO/JOIN_MARCA vêm do LEFT JOIN em sync-vendas.ts (mesma lógica
  // de sync-veiculos.ts — ver comentário lá).
  modelo: ["JOIN_MODELO", "MODELO", "DESCRICAO_MODELO"],
  marca: ["JOIN_MARCA", "MARCA", "DESCRICAO_MARCA"],
  // NBS.VEICULOS.ANO_MODELO é VARCHAR2 no formato "AA/AA" (ex: "12/13" =
  // fabricação 2012, modelo 2013) — não existe coluna separada de
  // fabricação. ano_fabricacao E ano_modelo são derivados desse mesmo campo
  // via parseAnoModelo() (ver mapearVenda abaixo); a lista abaixo continua
  // documentando os candidatos de coluna canônicos pra ambos.
  ano_fabricacao: ["ANO_FABRICACAO", "ANO_FAB"],
  ano_modelo: ["ANO_MODELO", "ANO_MOD"],
  cor_externa: ["COR_EXTERNA"],
  renavam: ["RENAVAM"], // não existe em NBS.VEICULOS — fica null (confirmado)
  km: ["KM", "KM_ATUAL", "QUILOMETRAGEM", "KM_USADO"],

  cod_empresa: ["COD_EMPRESA_VENDEDORA", "COD_EMPRESA"],
  // JOIN_EMPRESA_NOME vem do LEFT JOIN em NBS.EMPRESAS por
  // COD_EMPRESA_VENDEDORA (loja que efetivamente vendeu — MESMA coluna de
  // cod_empresa acima), não pela loja de origem/estoque (COD_EMPRESA_ATUAL
  // com fallback pra COD_EMPRESA, usada em LOJA_ATUAL/valoriza). Bug
  // corrigido: antes o JOIN usava a loja de origem, divergindo de
  // cod_empresa em vendas de repasse.
  empresa_nome: ["JOIN_EMPRESA_NOME", "EMPRESA_VENDEDORA", "NOME_EMPRESA"],
  patio: ["PATIO", "DESCRICAO_PATIO"], // sem fonte confirmada — pendência

  vendedor_codigo: ["COD_VENDEDOR", "VENDEDOR"],
  // JOIN_VENDEDOR_NOME/JOIN_VENDEDOR_CPF vêm do LEFT JOIN em
  // NBS.EMPRESAS_USUARIOS (casa por NOME = login curto, ex: "MOZAINIEL").
  vendedor_nome: ["JOIN_VENDEDOR_NOME", "NOME_VENDEDOR", "NOME_VENDEDOR_COMPLETO"],
  vendedor_cpf: ["JOIN_VENDEDOR_CPF", "CPF_VENDEDOR"], // sem fonte confirmada — pendência
  // VENDEDOR_QUE_RECEBEU confirmado contra o Oracle real (não estava na
  // lista original de candidatos).
  vendedor_recebeu: ["VENDEDOR_QUE_RECEBEU", "VENDEDOR_RECEBEU", "COD_VENDEDOR_RECEBEU"],

  cliente_codigo: ["COD_CLIENTE"],
  // JOIN_CLIENTE_NOME/JOIN_CLIENTE_UF vêm do LEFT JOIN em NBS.CLIENTES.
  cliente_nome: ["JOIN_CLIENTE_NOME", "NOME_CLIENTE"],
  cliente_tipo: [], // derivado de cliente_codigo, sem coluna própria
  cliente_cidade: ["CIDADE_CLIENTE"], // sem fonte confirmada — pendência (CLIENTES só tem COD_CID_RES, sem tabela de cidades acessível)
  cliente_uf: ["JOIN_CLIENTE_UF", "UF_CLIENTE", "UF"],

  data_venda: ["DATA_VENDA"],
  data_faturamento: ["DATA_FATURAMENTO"],
  data_entrada: ["DATA_ENTRADA"],

  valor_venda: ["VALOR_VENDIDO", "VALOR_VENDA"],
  preco_venda_tabela: ["PRECO_TABELA", "PRECO_VENDA"],
  total_nota_fabrica: ["TOTAL_NOTA_FABRICA"],
  custo_floor_plan: ["CUSTO_FORPLAN_FINAL", "CUSTO_FLOOR_PLAN_FINAL", "CUSTO_FLOOR_PLAN"],
  custo_total_final: ["CUSTO_TOTAL_FINAL"],
  despesas_gerais: ["DESPESAS_GERAIS", "DESP_GERAIS"], // sem fonte confirmada — pendência
  // Escala conferida na amostra do dry-run: valores tipo 4.11/6.64 batem
  // com margem de usado em % (0-100), não fração (0-1).
  margem_pct: ["MARGEM_FINAL", "MARGEM_PCT", "MARGEM"],
  comissao_vendedor: ["COM_FINAL_VENDEDOR", "COMISSAO_FINAL_VENDEDOR", "COMISSAO_VENDEDOR"],

  dias_estoque: [], // derivado: DATA_VENDA - DATA_ENTRADA em dias (calculado em mapearVenda, sem coluna própria)
  placa_troca: ["PLACA_VEIC_TROCA", "PLACA_TROCA"], // sem fonte confirmada — pendência

  financiado: ["FINANCIADO"],
  financeira: ["FINANCEIRA"], // sem fonte confirmada — pendência

  // valoriza é derivado (busca em mapaValoriza por
  // CHASSI_RESUMIDO+LOJA_ATUAL, ver mapearVenda abaixo) — sem coluna própria
  // em NBS.VEICULOS.
  valoriza: [],

  // CONSIGNATO já vem de graça no `v.*` de SQL_SELECT_VENDAS (sync-vendas.ts)
  // — mesma coluna usada como FILTRO (não como dado) em FILTRO_ESTOQUE de
  // sync-veiculos.ts. 'S'/'N' mapeado pra boolean via asBool() abaixo. Ver
  // doc completo (inclusive achado de NOVO_USADO='C' excluindo consignados
  // do filtro atual de vendas) no campo `consignado` de VendaParsed.
  consignado: ["CONSIGNATO"],
};

function achaColuna(row: Record<string, unknown>, candidatos: string[]): unknown {
  for (const c of candidatos) {
    if (Object.prototype.hasOwnProperty.call(row, c) && row[c] !== null && row[c] !== undefined) {
      return row[c];
    }
  }
  return undefined;
}

function asStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function asNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function asInt(v: unknown): number | null {
  const n = asNum(v);
  return n === null ? null : Math.trunc(n);
}

function asDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const s = asStr(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function asBool(v: unknown): boolean | null {
  const s = asStr(v)?.toUpperCase();
  if (!s) return null;
  if (s === "S" || s === "SIM" || s === "1" || s === "TRUE") return true;
  if (s === "N" || s === "NAO" || s === "NÃO" || s === "0" || s === "FALSE") return false;
  return null;
}

function detectTipoCliente(codigo: string | null): "PF" | "PJ" | null {
  if (!codigo) return null;
  const digits = codigo.replace(/\D/g, "");
  if (digits.length === 11) return "PF";
  if (digits.length === 14) return "PJ";
  return null;
}

export type LookupsVenda = {
  /**
   * chassi_resumido+loja_atual -> soma de bônus/valoriza, construído por
   * carregarMapaValoriza() (ver valoriza.ts) a partir de
   * NBS.VEICULOS_CUSTOS_ESPECIFICOS. Ausente = tratado como Map vazio
   * (buscarValoriza devolve 0 pra tudo).
   */
  mapaValoriza?: Map<string, number>;
};

export type ResultadoMapeamentoVenda = {
  venda: VendaParsed;
  camposSemFonte: string[];
};

export function mapearVenda(row: Record<string, unknown>, lookups: LookupsVenda = {}): ResultadoMapeamentoVenda {
  const camposSemFonte: string[] = [];
  const get = (campo: keyof VendaParsed) => {
    const candidatos = CANDIDATOS[campo];
    if (candidatos.length === 0) return undefined; // campo derivado, não é erro
    const v = achaColuna(row, candidatos);
    if (v === undefined) camposSemFonte.push(campo);
    return v;
  };

  const cliente_codigo = asStr(get("cliente_codigo"));

  const data_venda = asDate(get("data_venda"));
  const data_entrada = asDate(get("data_entrada"));
  // dias_estoque não existe como coluna em NBS.VEICULOS — deriva de
  // DATA_VENDA - DATA_ENTRADA em dias (não achamos coluna pronta; nenhum
  // outro ponto do projeto calcula isso a partir de datas, só consome valor
  // já vindo do XLSX MEDIA_DIAS).
  const dias_estoque =
    data_venda && data_entrada
      ? Math.round((data_venda.getTime() - data_entrada.getTime()) / 86_400_000)
      : null;

  // ano_fabricacao/ano_modelo vêm do MESMO campo bruto ("AA/AA") — ver
  // comentário em CANDIDATOS.ano_modelo. Não usa get() porque um único campo
  // bruto alimenta os dois campos canônicos.
  const anoModeloAchado = achaColuna(row, CANDIDATOS.ano_modelo);
  if (anoModeloAchado === undefined) camposSemFonte.push("ano_fabricacao", "ano_modelo");
  const { fab: ano_fabricacao, mod: ano_modelo } = parseAnoModelo(anoModeloAchado);

  // valoriza = busca no Map (chassi_resumido + loja atual) construído por
  // carregarMapaValoriza() (ver valoriza.ts). CHASSI_RESUMIDO e LOJA_ATUAL
  // (alias COALESCE(NULLIF(COD_EMPRESA_ATUAL,0), COD_EMPRESA), ver
  // SQL_SELECT_VENDAS em sync-vendas.ts) vêm direto da row crua — não usa
  // get()/CANDIDATOS porque é chave de junção, não campo de saída.
  const chassiResumido = asStr(row["CHASSI_RESUMIDO"]);
  const lojaAtual = asInt(row["LOJA_ATUAL"]);
  const valoriza = buscarValoriza(lookups.mapaValoriza ?? new Map(), chassiResumido, lojaAtual);

  const codigoCor = asStr(get("cor_externa"));
  const nomeCor = normalizarCorNbs(codigoCor);
  if (codigoCor && !nomeCor) camposSemFonte.push(`cor_nao_mapeada:${codigoCor}`);

  const venda: VendaParsed = {
    chassi: asStr(get("chassi")) ?? "",
    placa: asStr(get("placa")) ?? "",
    modelo: asStr(get("modelo")) ?? "",
    marca: asStr(get("marca")),
    ano_fabricacao,
    ano_modelo,
    cor_externa: nomeCor ?? (codigoCor ? `Cor ${codigoCor} (não mapeada)` : null),
    renavam: asStr(get("renavam")),
    km: asInt(get("km")),

    cod_empresa: asInt(get("cod_empresa")) ?? 0,
    empresa_nome: asStr(get("empresa_nome")),
    patio: asStr(get("patio")),

    vendedor_codigo: asStr(get("vendedor_codigo")),
    vendedor_nome: asStr(get("vendedor_nome")),
    vendedor_cpf: asStr(get("vendedor_cpf")),
    vendedor_recebeu: asStr(get("vendedor_recebeu")),

    cliente_codigo,
    cliente_nome: asStr(get("cliente_nome")) ?? "(sem nome)",
    cliente_tipo: detectTipoCliente(cliente_codigo),
    cliente_cidade: asStr(get("cliente_cidade")),
    cliente_uf: asStr(get("cliente_uf")),

    data_venda,
    data_faturamento: asDate(get("data_faturamento")),
    data_entrada,

    valor_venda: asNum(get("valor_venda")),
    preco_venda_tabela: asNum(get("preco_venda_tabela")),
    total_nota_fabrica: asNum(get("total_nota_fabrica")),
    custo_floor_plan: asNum(get("custo_floor_plan")),
    custo_total_final: asNum(get("custo_total_final")),
    despesas_gerais: asNum(get("despesas_gerais")),
    margem_pct: asNum(get("margem_pct")),
    comissao_vendedor: asNum(get("comissao_vendedor")),

    dias_estoque,
    placa_troca: asStr(get("placa_troca")),

    financiado: asBool(get("financiado")),
    financeira: asStr(get("financeira")),

    valoriza,

    // Sempre boolean (nunca null) — ausência/valor não reconhecido vira
    // `false` (fato conhecido "não é consignado"), não "não sabemos". Ver
    // justificativa completa no campo `consignado` de VendaParsed.
    consignado: asBool(get("consignado")) ?? false,
  };

  return { venda, camposSemFonte };
}

export function mapearVendas(
  rows: Record<string, unknown>[],
  lookups: LookupsVenda = {},
): { vendas: VendaParsed[]; warnings: string[] } {
  const vendas: VendaParsed[] = [];
  const camposSemFonteVistos = new Set<string>();
  const coresNaoMapeadas = new Map<string, number>();

  for (const row of rows) {
    const { venda, camposSemFonte } = mapearVenda(row, lookups);
    vendas.push(venda);
    for (const c of camposSemFonte) {
      const codigo = c.match(/^cor_nao_mapeada:(.+)$/)?.[1];
      if (codigo) coresNaoMapeadas.set(codigo, (coresNaoMapeadas.get(codigo) ?? 0) + 1);
      else camposSemFonteVistos.add(c);
    }
  }

  const warnings =
    camposSemFonteVistos.size > 0
      ? [
          `Campos sem coluna correspondente encontrada em NBS.VEICULOS (candidatos não bateram): ${[...camposSemFonteVistos].join(", ")}. ` +
            `Confira o nome real da coluna e ajuste CANDIDATOS em mapear-venda.ts.`,
        ]
      : [];

  for (const [codigo, qtd] of coresNaoMapeadas) {
    warnings.push(`Código de cor ${codigo} não mapeado (${qtd} venda(s)) — adicionar em MAPA_COR.`);
  }

  return { vendas, warnings };
}
