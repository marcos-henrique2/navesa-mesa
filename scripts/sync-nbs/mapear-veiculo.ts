import type { VeiculoParsed } from "../../src/lib/parsers/nbs-xlsx";
import { parseAnoModelo } from "../../src/lib/parsers/ano-modelo";

/**
 * Mapeamento campo canônico (VeiculoParsed) -> candidatos de nome de coluna no
 * Oracle NBS.VEICULOS, em ordem de prioridade.
 *
 * CONFIRMADOS pela investigação anterior (não são chute):
 *   - COD_EMPRESA, COD_EMPRESA_ATUAL (filtro de loja atual)
 *   - DATA_VENDA (filtro de "em estoque")
 *
 * Os demais são a MELHOR HIPÓTESE seguindo a convenção de nomes já confirmada
 * nesse schema (nomes descritivos, sem abreviação agressiva). Precisam ser
 * validados contra os nomes REAIS assim que a conexão rodar de verdade — o
 * `mapearVeiculo` abaixo não falha se um candidato não existir: ele tenta o
 * próximo da lista e, se nenhum bater, devolve null e registra em `warnings`
 * (campo de saída de `mapearVeiculos`) qual campo canônico ficou sem fonte.
 * Isso deixa a amostra impressa pela Fase 0 já mostrar exatamente o que
 * precisa de ajuste no próximo round, em vez de travar a query inteira com
 * ORA-00904 (coluna inexistente).
 */
const CANDIDATOS: Record<keyof VeiculoParsed, string[]> = {
  cod_empresa: ["COD_EMPRESA"],
  chassi: ["CHASSI", "CHASSI_COMPLETO", "NUM_CHASSI"],
  placa: ["PLACA", "PLACA_USADO"],
  // JOIN_MARCA/JOIN_MODELO vêm do LEFT JOIN em sync-veiculos.ts
  // (NBS.PRODUTOS_MODELOS + NBS.PRODUTOS + NBS.MARCAS, chave composta
  // COD_PRODUTO+COD_MODELO) — confirmado empiricamente, prioridade sobre
  // qualquer coluna de texto direta que nunca bateu em NBS.VEICULOS.
  marca: ["JOIN_MARCA", "MARCA", "DESCRICAO_MARCA", "NOME_MARCA"],
  modelo: ["JOIN_MODELO", "MODELO", "DESCRICAO_MODELO", "NOME_MODELO"],
  // NBS.VEICULOS.ANO_MODELO é VARCHAR2 no formato "AA/AA" (ex: "12/13" =
  // fabricação 2012, modelo 2013) — não existe coluna separada de
  // fabricação. ano_fabricacao E ano_modelo são derivados desse mesmo campo
  // via parseAnoModelo() (ver mapearVeiculo abaixo); a lista abaixo continua
  // documentando os candidatos de coluna canônicos pra ambos.
  ano_fabricacao: ["ANO_FABRICACAO", "ANO_FAB"],
  ano_modelo: ["ANO_MODELO", "ANO_MOD"],
  cor_externa: ["COR_EXTERNA"],
  combustivel: ["COD_COMBUSTIVEL", "COMBUSTIVEL"],
  km: ["KM", "KM_ATUAL", "QUILOMETRAGEM", "KM_USADO"],
  patio: ["PATIO", "DESCRICAO_PATIO", "COD_PATIO"],
  descricao_situacao: ["DESCRICAO_SITUACAO", "SITUACAO", "COD_SITUACAO"],
  preco_venda: ["PRECO_VENDA", "VALOR_VENDA"],
  valor_aquisicao: ["TOTAL_NOTA_FABRICA", "VALOR_AQUISICAO"],
  custo_total: ["CUSTO_TOTAL", "CUSTO_TOTAL_FINAL"],
  dias_patio: ["DIAS_PATIO", "DPT"],
  data_entrada: ["DATA_ENTRADA"],
  // VENDEDOR_QUE_RECEBEU confirmado contra o Oracle real (não estava na
  // lista original de candidatos).
  vendedor_recebeu: ["VENDEDOR_QUE_RECEBEU", "VENDEDOR_RECEBEU", "COD_VENDEDOR_RECEBEU"],
  // COD_PROPOSTA_INTERNET é a ÚNICA coluna certa aqui — confirmado contra o
  // Oracle real (bug de produção, 26/09/2026): COD_PROPOSTA é um campo
  // DIFERENTE (não sinônimo), que usa "0" como valor vazio em vez de NULL.
  // Misturar os dois nessa lista fazia achaColuna() cair pro COD_PROPOSTA
  // sempre que COD_PROPOSTA_INTERNET era NULL (maioria dos casos), e
  // asStr(0) -> "0" passava em `!= null` em estaReservado() — quase todo
  // veículo em estoque aparecia como RESERVADO na tela. Nunca reintroduzir
  // COD_PROPOSTA aqui.
  cod_proposta: ["COD_PROPOSTA_INTERNET"],
};

/** Colunas que são join opcional (loja atual, cor/combustível resolvidos) — não fazem parte do VeiculoParsed cru. */
const CAMPOS_COMPUTADOS = new Set(["loja_atual"]);

export type LookupsVeiculo = {
  /** COD_MODELO (ou equivalente) -> descrição do modelo, via NBS.PRODUTOS_MODELOS (se existir). */
  modeloPorCodigo?: Map<string, string>;
  /** código numérico de cor -> descrição, se existir tabela de domínio. */
  corPorCodigo?: Map<string, string>;
  /** código numérico de combustível -> descrição, se existir tabela de domínio. */
  combustivelPorCodigo?: Map<string, string>;
};

function achaColuna(row: Record<string, unknown>, candidatos: string[]): { valor: unknown; coluna: string } | null {
  for (const c of candidatos) {
    if (Object.prototype.hasOwnProperty.call(row, c) && row[c] !== null && row[c] !== undefined) {
      return { valor: row[c], coluna: c };
    }
  }
  return null;
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

/**
 * Parser dedicado pra códigos onde `0` é usado pelo Oracle como "sem valor"
 * (em vez de NULL) — caso confirmado de COD_PROPOSTA_INTERNET (~25 veículos
 * em estoque têm 0 em vez de NULL). Diferente de asStr(), que só trata
 * null/undefined/string vazia como ausência de valor.
 */
function asStrCodigoPositivo(v: unknown): string | null {
  const n = asNum(v);
  if (n !== null) return n === 0 ? null : asStr(v);
  return asStr(v);
}

function asDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const s = asStr(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export type ResultadoMapeamentoVeiculo = {
  veiculo: VeiculoParsed;
  /** campos canônicos que não bateram com nenhum candidato de coluna na row */
  camposSemFonte: string[];
};

/**
 * Mapeia uma row crua do Oracle (chaves = nomes de coluna, como devolvidas por
 * node-oracledb no modo OUT_FORMAT_OBJECT) para VeiculoParsed.
 */
export function mapearVeiculo(row: Record<string, unknown>, lookups: LookupsVeiculo = {}): ResultadoMapeamentoVeiculo {
  const camposSemFonte: string[] = [];
  const get = (campo: keyof VeiculoParsed) => {
    const achado = achaColuna(row, CANDIDATOS[campo]);
    if (!achado && !CAMPOS_COMPUTADOS.has(campo)) camposSemFonte.push(campo);
    return achado?.valor ?? null;
  };

  const codCor = asStr(get("cor_externa"));
  const cor_externa = (codCor && lookups.corPorCodigo?.get(codCor)) ?? codCor;

  const codComb = asStr(get("combustivel"));
  const combustivel = (codComb && lookups.combustivelPorCodigo?.get(codComb)) ?? codComb;

  // ano_fabricacao/ano_modelo vêm do MESMO campo bruto ("AA/AA") — ver
  // comentário em CANDIDATOS.ano_modelo. Não usa get() porque um único campo
  // bruto alimenta os dois campos canônicos.
  const anoModeloAchado = achaColuna(row, CANDIDATOS.ano_modelo);
  if (!anoModeloAchado) camposSemFonte.push("ano_fabricacao", "ano_modelo");
  const { fab: ano_fabricacao, mod: ano_modelo } = parseAnoModelo(anoModeloAchado?.valor);

  const veiculo: VeiculoParsed = {
    cod_empresa: asInt(get("cod_empresa")) ?? 0,
    chassi: asStr(get("chassi")) ?? "",
    placa: asStr(get("placa")) ?? "",
    marca: asStr(get("marca")),
    modelo: asStr(get("modelo")) ?? "",
    ano_fabricacao,
    ano_modelo,
    cor_externa: cor_externa ? cor_externa.toString().toUpperCase() : null,
    combustivel,
    km: asInt(get("km")),
    patio: asStr(get("patio")) ?? "",
    descricao_situacao: asStr(get("descricao_situacao")),
    preco_venda: asNum(get("preco_venda")),
    valor_aquisicao: asNum(get("valor_aquisicao")),
    custo_total: asNum(get("custo_total")),
    dias_patio: asInt(get("dias_patio")),
    data_entrada: asDate(get("data_entrada")),
    vendedor_recebeu: asStr(get("vendedor_recebeu")),
    cod_proposta: asStrCodigoPositivo(get("cod_proposta")),
  };

  return { veiculo, camposSemFonte };
}

export function mapearVeiculos(
  rows: Record<string, unknown>[],
  lookups: LookupsVeiculo = {},
): { veiculos: VeiculoParsed[]; warnings: string[] } {
  const veiculos: VeiculoParsed[] = [];
  const camposSemFonteVistos = new Set<string>();

  for (const row of rows) {
    const { veiculo, camposSemFonte } = mapearVeiculo(row, lookups);
    veiculos.push(veiculo);
    for (const c of camposSemFonte) camposSemFonteVistos.add(c);
  }

  const warnings =
    camposSemFonteVistos.size > 0
      ? [
          `Campos sem coluna correspondente encontrada em NBS.VEICULOS (candidatos não bateram): ${[...camposSemFonteVistos].join(", ")}. ` +
            `Confira o nome real da coluna e ajuste CANDIDATOS em mapear-veiculo.ts.`,
        ]
      : [];

  return { veiculos, warnings };
}
