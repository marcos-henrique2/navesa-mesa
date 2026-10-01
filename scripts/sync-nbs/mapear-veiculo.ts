import type { VeiculoParsed } from "../../src/lib/parsers/nbs-xlsx";
import { parseAnoModelo } from "../../src/lib/parsers/ano-modelo";
import { buscarValoriza } from "./valoriza";

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
  // COR_EXTERNA em NBS.VEICULOS é só um código numérico (ex: 888, 151662) —
  // não existe tabela de lookup "nome da cor" acessível no schema Oracle
  // usado por esse sync (confirmado via ALL_TABLES LIKE '%COR%', vazio). O
  // valor bruto é traduzido pra nome legível via MAPA_COR em mapearVeiculo()
  // abaixo, mesmo padrão de COD_PATIO/MAPA_PATIO.
  cor_externa: ["COR_EXTERNA"],
  combustivel: ["COD_COMBUSTIVEL", "COMBUSTIVEL"],
  km: ["KM", "KM_ATUAL", "QUILOMETRAGEM", "KM_USADO"],
  // PATIO/DESCRICAO_PATIO não existem de verdade em NBS.VEICULOS (só
  // COD_PATIO resolve) — o valor bruto de COD_PATIO é traduzido pra nome
  // legível via MAPA_PATIO em mapearVeiculo() abaixo.
  patio: ["COD_PATIO"],
  descricao_situacao: ["DESCRICAO_SITUACAO", "SITUACAO", "COD_SITUACAO"],
  // PRECO_VENDA/VALOR_VENDA não existem de verdade em NBS.VEICULOS
  // (confirmado via ALL_TAB_COLUMNS) — a coluna certa é PRECO_TABELA,
  // validada com 100% de cobertura no estoque atual (1.114/1.114 veículos).
  preco_venda: ["PRECO_TABELA"],
  valor_aquisicao: ["TOTAL_NOTA_FABRICA", "VALOR_AQUISICAO"],
  custo_total: ["CUSTO_TOTAL", "CUSTO_TOTAL_FINAL"],
  // DIAS_PATIO/DPT NÃO existem em NBS.VEICULOS (confirmado via
  // ALL_TAB_COLUMNS) — existiam só no Excel manual antigo, como valor
  // pré-calculado pelo próprio NBS. Dias de pátio = dias desde a entrada do
  // carro em qualquer loja (confirmado com o Marcos), então é derivado de
  // DATA_ENTRADA (ver mapearVeiculo abaixo), sem coluna própria — mesma
  // lógica de dias_estoque em mapear-venda.ts.
  dias_patio: [],
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
  // valoriza é derivado (busca em mapaValoriza por CHASSI_RESUMIDO+LOJA_ATUAL,
  // ver mapearVeiculo abaixo) — sem coluna própria em NBS.VEICULOS.
  valoriza: [],
};

/**
 * Colunas que são join opcional (loja atual, cor/combustível resolvidos) ou
 * campos derivados sem coluna própria — não fazem parte do VeiculoParsed cru,
 * então a ausência de coluna correspondente não é reportada em camposSemFonte.
 */
const CAMPOS_COMPUTADOS = new Set(["loja_atual", "dias_patio", "valoriza"]);

/**
 * Mapa estático COD_PATIO (Oracle) -> nome legível do pátio.
 *
 * Origem: NBS.VEICULOS só tem COD_PATIO (numérico); não existe tabela de
 * lookup "nome do pátio" acessível no schema Oracle usado por esse sync
 * (usuário `comissao`) — confirmado investigando ALL_TABLES. O Excel manual
 * antigo trazia o nome em texto, vindo de algum processo interno do NBS sem
 * acesso direto via Oracle.
 *
 * Esse mapa foi construído cruzando um export manual real do estoque (com o
 * nome do pátio em texto) com os COD_PATIO correspondentes no Oracle pros
 * MESMOS veículos, por placa. Bateu 1.090 de 1.133 veículos (96% de match) —
 * validado em 30/09/2026.
 *
 * Se aparecer um COD_PATIO que não está aqui (loja nova, por exemplo),
 * mapearVeiculo() cai pro fallback "Pátio <código> (não mapeado)" e
 * mapearVeiculos() reporta em `warnings` — adicione a entrada aqui quando
 * isso acontecer.
 */
export const MAPA_PATIO: Record<string, string> = {
  "5": "AEROPORTO",
  "11": "TRÂNSITO (LOCAL)",
  "17": "CIAASA",
  "21": "ANÁPOLIS",
  "57": "POLARIS",
  "69": "APARECIDA DE GOIÂNIA",
  "76": "T-63",
  "152": "PREPARAÇÃO",
  "159": "GWM RIO VERDE",
  "160": "GWM ANÁPOLIS",
  "161": "GWM RIO VERDE",
  "162": "GWM ANÁPOLIS",
  "163": "CG VU",
  "172": "GAC",
  "173": "GEELY",
  "177": "PENDÊNCIA DOCUMENTAÇÃO",
  "178": "NAVESA NORTE (PORANGATU)",
  "180": "PORANGATU",
  "4": "CAMINHÕES GOIÂNIA",
  "54": "AEROPORTO/ACESSÓRIO",
  "79": "PRO+",
  "111": "OFICINA NAVESA AEROPORTO",
  "139": "AUTO HALL",
  "140": "PÁTIO VALCIMAR",
  "153": "GWM GOIÂNIA",
};

/**
 * Mapa estático COR_EXTERNA (Oracle) -> nome legível da cor.
 *
 * Origem: NBS.VEICULOS só tem COR_EXTERNA (código numérico); não existe
 * tabela de lookup "nome da cor" acessível no schema Oracle usado por esse
 * sync (usuário `comissao`) — confirmado investigando ALL_TABLES (LIKE
 * '%COR%' devolveu vazio).
 *
 * Esse mapa foi construído cruzando um export manual real do estoque (coluna
 * "Cor Externa", com o nome em texto) com os COR_EXTERNA correspondentes no
 * Oracle pros MESMOS veículos, por placa. Bateu 1.089 de 1.132 veículos
 * (96% de match) — 30 códigos distintos no estoque atual — validado em
 * 30/09/2026.
 *
 * Códigos diferentes que mapeiam pro mesmo nome (ex: 14575/1549197195/
 * 8246719 -> "CINZA") são tons específicos de fabricante que o relatório
 * manual já simplificava pro nome genérico — mesma perda de detalhe da fonte
 * original, não é erro nosso.
 *
 * Se aparecer um COR_EXTERNA que não está aqui (cor nova, por exemplo),
 * mapearVeiculo() cai pro fallback "Cor <código> (não mapeada)" e
 * mapearVeiculos() reporta em `warnings` — adicione a entrada aqui quando
 * isso acontecer.
 */
export const MAPA_COR: Record<string, string> = {
  "888": "BRANCO",
  "151662": "PRETO",
  "80": "PRATA",
  "14575": "CINZA",
  "1549197195": "CINZA",
  "8246719": "CINZA",
  "89": "AZUL",
  "84": "VERMELHO",
  "66988": "VERDE",
  "151672": "MARROM",
  "79": "PRETO C/ TETO PRATA",
  "85": "CINZA STING GRAY",
  "94": "DOURADO",
  "67008": "LARANJA",
  "81": "BRANCO POLAR",
  "310": "PRATA",
  "90": "AMARELO",
  "21": "BRANCO ÁRTICO",
  "103": "BRANCA CRISTAL",
  "1549197207": "PRATA",
  "87": "BEGE",
  "88": "PRETA",
  "8246846": "PRETO",
  "8246813": "PRATA",
  "8246731": "AMARELO",
  "1549493807": "CINZA",
  "8246635": "PRATA",
  "8246714": "PRETO",
  "1549543543": "PRETO",
  "151663": "PRATA",
};

export type LookupsVeiculo = {
  /** COD_MODELO (ou equivalente) -> descrição do modelo, via NBS.PRODUTOS_MODELOS (se existir). */
  modeloPorCodigo?: Map<string, string>;
  /** código numérico de combustível -> descrição, se existir tabela de domínio. */
  combustivelPorCodigo?: Map<string, string>;
  /**
   * chassi_resumido+loja_atual -> soma de bônus/valoriza, construído por
   * carregarMapaValoriza() (ver valoriza.ts) a partir de
   * NBS.VEICULOS_CUSTOS_ESPECIFICOS. Ausente = tratado como Map vazio
   * (buscarValoriza devolve 0 pra tudo).
   */
  mapaValoriza?: Map<string, number>;
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

  const codComb = asStr(get("combustivel"));
  const combustivel = (codComb && lookups.combustivelPorCodigo?.get(codComb)) ?? codComb;

  // ano_fabricacao/ano_modelo vêm do MESMO campo bruto ("AA/AA") — ver
  // comentário em CANDIDATOS.ano_modelo. Não usa get() porque um único campo
  // bruto alimenta os dois campos canônicos.
  const anoModeloAchado = achaColuna(row, CANDIDATOS.ano_modelo);
  if (!anoModeloAchado) camposSemFonte.push("ano_fabricacao", "ano_modelo");
  const { fab: ano_fabricacao, mod: ano_modelo } = parseAnoModelo(anoModeloAchado?.valor);

  // dias_patio = dias desde a entrada do carro em qualquer loja (definição de
  // negócio confirmada) = hoje - data_entrada, em dias corridos. Não existe
  // coluna DIAS_PATIO/DPT em NBS.VEICULOS (só existia no Excel manual antigo,
  // pré-calculada pelo NBS) — mesma lógica de dias_estoque em
  // mapear-venda.ts, mas com "hoje" no lugar de data_venda porque o veículo
  // ainda está em estoque. Sem data_entrada, não dá pra calcular.
  const data_entrada = asDate(get("data_entrada"));
  const dias_patio = data_entrada ? Math.floor((Date.now() - data_entrada.getTime()) / 86_400_000) : null;

  // patio = nome legível traduzido de COD_PATIO via MAPA_PATIO (ver
  // comentário acima). Código desconhecido não trava o sync: cai pro
  // fallback "Pátio <código> (não mapeado)" e é reportado em `warnings` de
  // mapearVeiculos(), pra não mostrar código cru silenciosamente pra sempre.
  const codigoPatio = asStr(get("patio"));
  let patio = "";
  if (codigoPatio) {
    const nomePatio = MAPA_PATIO[codigoPatio];
    if (nomePatio) {
      patio = nomePatio;
    } else {
      patio = `Pátio ${codigoPatio} (não mapeado)`;
      camposSemFonte.push(`patio_nao_mapeado:${codigoPatio}`);
    }
  }

  // cor_externa = nome legível traduzido de COR_EXTERNA via MAPA_COR (ver
  // comentário acima). Código desconhecido não trava o sync: cai pro
  // fallback "Cor <código> (não mapeada)" e é reportado em `warnings` de
  // mapearVeiculos(), pra não mostrar código cru silenciosamente pra sempre.
  const codigoCor = asStr(get("cor_externa"));
  let cor_externa: string | null = null;
  if (codigoCor) {
    const nomeCor = MAPA_COR[codigoCor];
    if (nomeCor) {
      cor_externa = nomeCor;
    } else {
      cor_externa = `Cor ${codigoCor} (não mapeada)`;
      camposSemFonte.push(`cor_nao_mapeada:${codigoCor}`);
    }
  }

  // valoriza = busca no Map (chassi_resumido + loja atual) construído por
  // carregarMapaValoriza() (ver valoriza.ts). CHASSI_RESUMIDO e LOJA_ATUAL
  // (alias COALESCE(NULLIF(COD_EMPRESA_ATUAL,0), COD_EMPRESA), ver
  // SQL_SELECT_VEICULOS em sync-veiculos.ts) vêm direto da row crua — não
  // usa get()/CANDIDATOS porque é chave de junção, não campo de saída.
  const chassiResumido = asStr(row["CHASSI_RESUMIDO"]);
  const lojaAtual = asInt(row["LOJA_ATUAL"]);
  const valoriza = buscarValoriza(lookups.mapaValoriza ?? new Map(), chassiResumido, lojaAtual);

  const veiculo: VeiculoParsed = {
    cod_empresa: asInt(get("cod_empresa")) ?? 0,
    chassi: asStr(get("chassi")) ?? "",
    placa: asStr(get("placa")) ?? "",
    marca: asStr(get("marca")),
    modelo: asStr(get("modelo")) ?? "",
    ano_fabricacao,
    ano_modelo,
    cor_externa,
    combustivel,
    km: asInt(get("km")),
    patio,
    descricao_situacao: asStr(get("descricao_situacao")),
    preco_venda: asNum(get("preco_venda")),
    valor_aquisicao: asNum(get("valor_aquisicao")),
    custo_total: asNum(get("custo_total")),
    dias_patio,
    data_entrada,
    vendedor_recebeu: asStr(get("vendedor_recebeu")),
    cod_proposta: asStrCodigoPositivo(get("cod_proposta")),
    valoriza,
  };

  return { veiculo, camposSemFonte };
}

export function mapearVeiculos(
  rows: Record<string, unknown>[],
  lookups: LookupsVeiculo = {},
): { veiculos: VeiculoParsed[]; warnings: string[] } {
  const veiculos: VeiculoParsed[] = [];
  const camposSemFonteVistos = new Set<string>();
  const patiosNaoMapeados = new Map<string, number>();
  const coresNaoMapeadas = new Map<string, number>();

  for (const row of rows) {
    const { veiculo, camposSemFonte } = mapearVeiculo(row, lookups);
    veiculos.push(veiculo);
    for (const c of camposSemFonte) {
      const codigoPatioNaoMapeado = c.match(/^patio_nao_mapeado:(.+)$/)?.[1];
      const codigoCorNaoMapeado = c.match(/^cor_nao_mapeada:(.+)$/)?.[1];
      if (codigoPatioNaoMapeado) {
        patiosNaoMapeados.set(codigoPatioNaoMapeado, (patiosNaoMapeados.get(codigoPatioNaoMapeado) ?? 0) + 1);
      } else if (codigoCorNaoMapeado) {
        coresNaoMapeadas.set(codigoCorNaoMapeado, (coresNaoMapeadas.get(codigoCorNaoMapeado) ?? 0) + 1);
      } else {
        camposSemFonteVistos.add(c);
      }
    }
  }

  const warnings: string[] = [];
  if (camposSemFonteVistos.size > 0) {
    warnings.push(
      `Campos sem coluna correspondente encontrada em NBS.VEICULOS (candidatos não bateram): ${[...camposSemFonteVistos].join(", ")}. ` +
        `Confira o nome real da coluna e ajuste CANDIDATOS em mapear-veiculo.ts.`,
    );
  }
  for (const [codigo, qtd] of patiosNaoMapeados) {
    warnings.push(`Código de pátio ${codigo} não mapeado (${qtd} veículo(s)) — adicionar em MAPA_PATIO.`);
  }
  for (const [codigo, qtd] of coresNaoMapeadas) {
    warnings.push(`Código de cor ${codigo} não mapeado (${qtd} veículo(s)) — adicionar em MAPA_COR.`);
  }

  return { veiculos, warnings };
}
