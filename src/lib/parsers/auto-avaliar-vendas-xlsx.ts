/**
 * Parser PURO do relatório **"Vendas Concluídas"** do Auto Avaliar.
 *
 * É a TERCEIRA fonte do Auto Avaliar, e a única que registra VENDA:
 *   • `parse-auto-avaliar.ts`        — texto colado, CRIA carro no ar.
 *   • `auto-avaliar-ofertas-xls.ts`  — .xls de ofertas, SÓ atualiza valor.
 *   • este                           — .xlsx de vendas, MARCA VENDIDO e cria o
 *                                      carro que nunca passou pelo sistema.
 *
 * Segue o contrato dos outros parsers de upload (`parseX(buf, fileName)`) e,
 * como o de ofertas, NÃO grava nada e NÃO chama RPC: devolve payload tipado.
 * Quem chama `importar_vendas_concluidas_auto_avaliar_preview` e depois a de
 * aplicar é a camada de UI/queries.
 *
 * ⚠️ FORMATO — DIFERENTE DO IRMÃO. O "Veículos em Oferta" é HTML disfarçado de
 * `.xls`. Este é XLSX DE VERDADE (ZIP + XML), então é lido de `ArrayBuffer` com
 * `type: "array"`, não de texto. Não há entidade HTML pra desescapar e não há
 * decisão de encoding: o XLSX carrega UTF-8 no próprio container.
 *
 * ⚠️ LINHA 1 É TÍTULO ("Dados Vendas Concluidas"), o CABEÇALHO É A LINHA 2 e os
 * dados começam na 3. A detecção de cabeçalho varre as primeiras linhas
 * procurando "Placa" + "Data Venda", em vez de assumir índice fixo.
 *
 * ⚠️ ÚLTIMA LINHA É RODAPÉ DE TOTAIS: vem sem placa e sem chassi, com
 * "R$ 1.736.691,00" nas colunas de dinheiro. Se ela entrasse no lote viraria uma
 * venda fantasma de 1,7 milhão. Linha sem placa E sem chassi é descartada antes
 * de qualquer classificação, e contada em `meta.total_sem_identificacao`.
 *
 * ⚠️ `Gastos Previstos` NÃO PASSA PELO PARSER pt-BR — leia `gastoObservado`.
 *
 * ⚠️ `Lucro R$` / `Lucro %` são IGNORADOS de propósito. Medido no arquivo real,
 * `Lucro R$` = Vendido − Compra em todas as linhas: os GASTOS não entram. O
 * sistema calcula margem por `custo_real = valor_compra_repasse + Σ gastos`, que
 * é o número certo. Importar o lucro do relatório seria gravar uma margem que já
 * sabemos errada. As colunas nem são mapeadas.
 *
 * ⚠️ `Valor TAC` é SOMADO E EXIBIDO, nunca gravado (decisão do dono do negócio:
 * TAC não é custo do carro). A soma é 100% cliente — `montarPayloadVendas` não
 * tem chave `tac`, então nem um payload adulterado leva TAC ao banco.
 *
 * Comprador, CNPJ/CPF, telefone e cidade do comprador não são lidos: PII de
 * terceiro, e o projeto já pagou o preço disso uma vez (migration 026).
 *
 * 100% PURO: sem I/O, sem Date, sem rede, sem banco.
 */

import * as XLSX from "xlsx";
import { parseValorBR } from "@/lib/utils/parse-br";
import { normalizarPlaca } from "@/lib/utils/placa";

// ─── Tipos ───────────────────────────────────────────────────────────────────

/** Conjunto FECHADO de erros fatais de leitura. */
export type ErroVendasCodigo =
  | "ARQUIVO_ILEGIVEL"
  | "COLUNA_OBRIGATORIA_AUSENTE"
  | "ARQUIVO_SEM_LINHAS"
  | "ARQUIVO_GRANDE_DEMAIS";

export type ErroVendas = {
  codigo: ErroVendasCodigo;
  /** Nome da coluna que faltou — só em `COLUNA_OBRIGATORIA_AUSENTE`. */
  coluna?: string;
  /** Linhas de dados encontradas — só em `ARQUIVO_GRANDE_DEMAIS`. */
  linhas?: number;
};

/** Uma venda da loja alvo, já normalizada. */
export type LinhaVendaAA = {
  /** Nº da linha no arquivo (1-based, contando título e cabeçalho). */
  linha: number;
  loja: string;
  placa_raw: string;
  placa_norm: string;
  chassi: string | null;
  modelo: string | null;
  /** YYYY-MM-DD (o horário do relatório é descartado). */
  data_publicacao: string | null;
  data_venda: string | null;
  valor_compra: number | null;
  valor_vendido: number | null;
  /** Zero vira `null`: "o relatório não informou gasto", nunca "o gasto é zero". */
  gastos: number | null;
  /** Só exibição. NUNCA entra no payload — ver o cabeçalho deste arquivo. */
  valor_tac: number | null;
};

/** Linha retida no cliente por ser de outra loja — nunca chega à RPC. */
export type LinhaVendaOutraLoja = {
  linha: number;
  loja: string;
  placa_norm: string;
  modelo: string | null;
  data_venda: string | null;
  valor_vendido: number | null;
};

export type VendasMeta = {
  arquivo_nome: string;
  /** Linhas de dados com identificação, de todas as lojas. */
  total_linhas: number;
  total_loja_alvo: number;
  total_outra_loja: number;
  /** Linhas descartadas por não terem placa nem chassi — o rodapé de totais mora aqui. */
  total_sem_identificacao: number;
  lojas_encontradas: string[];
  /**
   * Soma do "Valor TAC" das linhas da loja alvo. Existe para o preview conseguir
   * dizer o TAMANHO desse dinheiro, que hoje não aparece em lugar nenhum do
   * sistema. Informativo: nada disso é gravado.
   */
  total_tac: number;
  /** Quantas linhas da loja alvo trouxeram TAC — o denominador do aviso. */
  linhas_com_tac: number;
};

/** Item do payload — só o que a RPC usa (superfície mínima). */
export type ItemPayloadVendas = {
  linha: number;
  /** Placa CRUA: quem normaliza é a RPC, com a mesma expressão do índice. */
  placa: string;
  chassi: string | null;
  modelo: string | null;
  data_publicacao: string | null;
  data_venda: string | null;
  valor_compra: number | null;
  valor_vendido: number | null;
  gastos: number | null;
};

export type PayloadVendas = {
  versao: 1;
  origem: "arquivo_vendas_xlsx";
  linhas: ItemPayloadVendas[];
};

export type VendasParseOk = {
  ok: true;
  meta: VendasMeta;
  linhas: LinhaVendaAA[];
  outra_loja: LinhaVendaOutraLoja[];
};

export type VendasParseErro = { ok: false; erro: ErroVendas };

export type VendasParseResult = VendasParseOk | VendasParseErro;

// ─── Constantes de domínio ───────────────────────────────────────────────────

/** Mesma régua do import de ofertas: só a Matriz. O resto vai pra lista visível. */
export const LOJA_ALVO_VENDAS = "NAVESA - GO/MATRIZ";

/**
 * Teto de linhas de dados. Igual ao teto da RPC — o cliente falha antes de montar
 * um payload que o banco recusaria. Hoje o arquivo tem 17 vendas.
 */
export const MAX_LINHAS_VENDAS = 2000;

/** Colunas obrigatórias, na ordem em que são reportadas. */
const COLUNAS_OBRIGATORIAS = ["Anunciante", "Placa", "Data Venda", "Valor Vendido"] as const;

type ColKey =
  | "anunciante"
  | "placa"
  | "chassi"
  | "veiculos"
  | "data_publicacao"
  | "data_venda"
  | "valor_compra"
  | "valor_vendido"
  | "gastos_previstos"
  | "valor_tac";

/**
 * Rótulo do cabeçalho (já normalizado) → chave canônica.
 * Mapeamento por NOME, nunca por índice: o Auto Avaliar pode reordenar colunas
 * sem que isso vire corrupção silenciosa de valor.
 *
 * `Lucro R$`, `Lucro %`, `Comprador`, `CNPJ/CPF`, `Telefones` e `Cidade/UF` estão
 * ausentes DE PROPÓSITO — ver o cabeçalho do arquivo.
 */
const HEADER_MAP: Record<string, ColKey> = {
  "anunciante": "anunciante",
  "placa": "placa",
  "chassi": "chassi",
  "veiculos": "veiculos",
  "veiculo": "veiculos",
  "data publicacao": "data_publicacao",
  "data venda": "data_venda",
  "valor compra": "valor_compra",
  "valor vendido": "valor_vendido",
  "gastos previstos": "gastos_previstos",
  "valor tac": "valor_tac",
};

const OBRIGATORIA_KEY: Record<(typeof COLUNAS_OBRIGATORIAS)[number], ColKey> = {
  "Anunciante": "anunciante",
  "Placa": "placa",
  "Data Venda": "data_venda",
  "Valor Vendido": "valor_vendido",
};

// ─── Normalização de texto ───────────────────────────────────────────────────

/** Combining diacritical marks — o que sobra do `normalize("NFD")`. */
const ACENTOS = /[̀-ͯ]/g;

function normalizarRotulo(s: string): string {
  return s
    .normalize("NFD")
    .replace(ACENTOS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizarLoja(s: string): string {
  return s
    .normalize("NFD")
    .replace(ACENTOS, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

const LOJA_ALVO_NORM = normalizarLoja(LOJA_ALVO_VENDAS);

// ─── Conversão de célula ─────────────────────────────────────────────────────

/**
 * Texto da célula. Tolerante ao tipo: o SheetJS devolve string, number, boolean
 * ou null dependendo de como a célula foi gravada. Sem `any` — checagem
 * explícita, e célula estranha não aborta o lote.
 */
function celulaTexto(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return "";
  return "";
}

function celulaTextoOuNull(v: unknown): string | null {
  const s = celulaTexto(v);
  return s === "" ? null : s;
}

/** Arredonda a 2 casas — mata o artefato de float que viraria diff falso. */
function arredondar2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Valor monetário pt-BR observado. ZERO É AUSÊNCIA (`0,00`, vazio, `-`, `N/A`
 * viram `null`), como no parser de ofertas: um zero que atravessa apagaria dado
 * bom do outro lado.
 *
 * Vale para `Valor Compra`, `Valor Vendido` e `Valor TAC`, que vêm como TEXTO
 * pt-BR no arquivo real (`"125.000,00"`, `"R$ 999,00"`) — `parseValorBR` já tira
 * o prefixo `R$`.
 */
function valorObservadoBR(v: unknown): number | null {
  const s = celulaTexto(v);
  if (s === "") return null;
  const n = parseValorBR(s);
  if (n === null) return null;
  const r = arredondar2(n);
  return r === 0 ? null : r;
}

/**
 * ⚠️ `Gastos Previstos` — A ARMADILHA QUE JÁ MORDEU UMA VEZ, NOS DOIS SENTIDOS.
 *
 * Diferente de todas as outras colunas de dinheiro deste arquivo, esta é uma
 * célula NUMÉRICA de verdade no XLSX. Por isso ela é lida do VALOR BRUTO da
 * célula (`raw: true`), não do texto formatado — ver `lerPlanilha`. O branch de
 * `number` abaixo é, portanto, o caminho REAL do arquivo; os de string são
 * fallback para o dia em que o exportador mudar.
 *
 * Ler o texto formatado seria errado nos dois sentidos, e nenhum dos dois dá
 * sintoma:
 *   • pt-BR ingênuo: `"1250.0"` tratado como milhar viraria 12500 — custo 10×
 *     maior. Foi o erro que aconteceu de verdade.
 *   • número puro ingênuo: se o Auto Avaliar passar a formatar a coluna com
 *     separador de milhar e sem decimais, `"12.500"` (doze mil e quinhentos)
 *     viraria 12,50 — custo 1000× MENOR, e portanto MARGEM SUPERESTIMADA. É o
 *     mesmo erro com o sinal invertido, e o pior dos dois: erro de custo pra
 *     baixo passa despercebido porque o número final parece bom.
 * Ler o bruto tira a decisão da mão da heurística: o formato de exibição da
 * célula deixa de poder mudar o custo.
 *
 * Regra aqui, sem adivinhação:
 *   • `number` → usa direto (é o caminho real do arquivo).
 *   • string COM vírgula → é pt-BR de verdade (`"1.250,00"`), aí sim `parseValorBR`.
 *   • string SEM vírgula → número puro estilo JS: `.` é DECIMAL, sempre.
 *   • qualquer outra coisa, negativo ou zero → `null` ("não informou").
 *
 * Zero vira `null` de propósito: 12 das 17 linhas do arquivo real vêm com 0, e a
 * soma de gastos do relatório (R$ 13.350) nem bate com a do sistema (R$ 8.800).
 * "0" aqui significa "o relatório não informou", não "o gasto foi zerado" — e a
 * RPC usa essa ausência pra NUNCA apagar gasto já lançado.
 */
export function gastoObservado(v: unknown): number | null {
  let n: number | null = null;

  if (typeof v === "number") {
    n = Number.isFinite(v) ? v : null;
  } else if (typeof v === "string") {
    const s = v.trim().replace(/^R\$\s*/i, "").replace(/\s+/g, "");
    if (s === "") return null;
    if (s.includes(",")) {
      n = parseValorBR(s);
    } else if (/^-?\d+(\.\d+)?$/.test(s)) {
      // Número puro: o ponto é DECIMAL. `Number` faz exatamente isso e nada mais.
      n = Number(s);
    } else {
      n = null;
    }
  }

  if (n === null || !Number.isFinite(n) || n < 0) return null;
  const r = arredondar2(n);
  return r === 0 ? null : r;
}

/**
 * Data de calendário observada. O relatório traz `DD/MM/AAAA HH:MM:SS` e é
 * exportado no horário de Brasília, então o DIA já vem certo: o horário é
 * simplesmente cortado, sem nenhuma conversão de fuso (converter aqui é como se
 * transforma uma venda das 20h de terça numa venda de quarta).
 *
 * Devolve `YYYY-MM-DD`, que é o único formato que a RPC aceita. Data impossível
 * (`32/13/2026`) vira `null` em vez de adivinhar.
 */
export function dataObservada(v: unknown): string | null {
  const s = celulaTexto(v);
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if (!m) return null;
  const [, dd, mm, aaaa] = m;
  const dia = Number(dd);
  const mes = Number(mm);
  const ano = Number(aaaa);
  if (mes < 1 || mes > 12 || dia < 1 || ano < 2000 || ano > 2100) return null;
  // Valida o dia CONTRA O MÊS: 31/02 não existe e não pode virar 03/03.
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  if (dia > ultimoDia) return null;
  return `${aaaa}-${mm}-${dd}`;
}

/** Chassi canônico: maiúsculas, só alfanumérico. Vazio vira `null`. */
function chassiObservado(v: unknown): string | null {
  const s = celulaTexto(v).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s === "" ? null : s;
}

// ─── Leitura da planilha ─────────────────────────────────────────────────────

function paraBytes(entrada: ArrayBuffer | Uint8Array): Uint8Array {
  return entrada instanceof Uint8Array ? entrada : new Uint8Array(entrada);
}

/**
 * As DUAS leituras da mesma planilha, indexadas igual.
 *
 * `texto` (`raw: false`) devolve o texto FORMATADO da célula — que é o que se
 * quer para as colunas de dinheiro pt-BR (`"125.000,00"`) e para as datas
 * (`"DD/MM/AAAA HH:MM:SS"`), ambas gravadas como texto no arquivo real.
 *
 * `bruto` (`raw: true`) devolve o VALOR da célula sem passar pelo formato. Existe
 * por causa de UMA coluna: `Gastos Previstos`, a única numérica de verdade do
 * relatório. Lê-la do texto formatado deixaria o custo do carro na mão do formato
 * de exibição da planilha — ver a caixa em `gastoObservado`.
 *
 * As duas usam as MESMAS opções fora do `raw`, então os índices de linha e coluna
 * coincidem célula a célula. É por isso que a leitura é feita por dois
 * `sheet_to_json` e não por endereço (`encode_cell`): endereço absoluto só
 * coincidiria com o índice da matriz se o range da planilha começasse em A1, o
 * que não é garantido.
 *
 * `blankrows: true` preserva o índice físico da linha, que é o que reportamos de
 * volta pro usuário conferir no Excel.
 */
type Planilha = { texto: unknown[][]; bruto: unknown[][] };

function lerPlanilha(bytes: Uint8Array): Planilha | null {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(bytes, { type: "array" });
  } catch {
    return null;
  }
  const nome = wb.SheetNames[0];
  const sheet = nome ? wb.Sheets[nome] : undefined;
  if (!sheet) return null;
  const comuns = { header: 1, defval: null, blankrows: true } as const;
  return {
    texto: XLSX.utils.sheet_to_json<unknown[]>(sheet, { ...comuns, raw: false }),
    bruto: XLSX.utils.sheet_to_json<unknown[]>(sheet, { ...comuns, raw: true }),
  };
}

function linhaVazia(row: unknown[] | undefined): boolean {
  return !row || row.every((c) => celulaTexto(c) === "");
}

// ─── Parser ──────────────────────────────────────────────────────────────────

/**
 * Lê o relatório "Vendas Concluídas" e devolve as vendas normalizadas, já
 * separadas entre a loja alvo e as demais.
 *
 * Nunca lança: todo caminho de falha vira `{ ok: false, erro }` com código do
 * conjunto fechado. O código do erro é contrato testado — uma `Error` com string
 * o perderia.
 */
export function parseAutoAvaliarVendasXlsx(
  fileBuffer: ArrayBuffer | Uint8Array,
  fileName: string,
): VendasParseResult {
  const planilha = lerPlanilha(paraBytes(fileBuffer));
  if (!planilha) return { ok: false, erro: { codigo: "ARQUIVO_ILEGIVEL" } };
  const matriz = planilha.texto;

  const naoVazias = matriz.filter((r) => !linhaVazia(r));
  if (naoVazias.length === 0) return { ok: false, erro: { codigo: "ARQUIVO_ILEGIVEL" } };

  // Guarda de tamanho antes de qualquer trabalho por linha.
  if (naoVazias.length - 1 > MAX_LINHAS_VENDAS) {
    return { ok: false, erro: { codigo: "ARQUIVO_GRANDE_DEMAIS", linhas: naoVazias.length - 1 } };
  }

  // Cabeçalho: das 10 primeiras linhas não-vazias, a que RECONHECE MAIS colunas.
  //
  // NÃO é índice fixo. A linha 1 é o título "Dados Vendas Concluidas" hoje, mas amarrar
  // "cabeçalho = linha 2" quebraria em silêncio se o exportador ganhasse outra linha de
  // preâmbulo.
  //
  // E não é "a primeira que tenha Placa E Data Venda", que era o desenho óbvio: quando
  // uma dessas duas some do arquivo, a busca falha, cai na linha do TÍTULO e o erro
  // reportado vira "não encontrei a coluna «Anunciante»" — apontando a coluna errada.
  // Pontuar resolve os dois casos: a linha do cabeçalho continua vencendo mesmo com uma
  // coluna faltando, e é ELA que responde qual coluna sumiu.
  let candidataIdx = -1;
  let melhorScore = 0;
  let examinadas = 0;
  for (let i = 0; i < matriz.length && examinadas < 10; i++) {
    if (linhaVazia(matriz[i])) continue;
    examinadas++;
    const score = new Set(
      matriz[i].map((c) => HEADER_MAP[normalizarRotulo(celulaTexto(c))]).filter(Boolean),
    ).size;
    if (score > melhorScore) {
      melhorScore = score;
      candidataIdx = i;
    }
  }
  // Nenhuma coluna conhecida em lugar nenhum: não é o relatório, é outra coisa (ou lixo
  // binário que o SheetJS aceitou ler). "Não consegui ler" é mais honesto aqui do que
  // acusar a ausência de uma coluna específica.
  if (candidataIdx === -1) return { ok: false, erro: { codigo: "ARQUIVO_ILEGIVEL" } };
  const header = matriz[candidataIdx] ?? [];

  const col = new Map<ColKey, number>();
  header.forEach((c, i) => {
    const key = HEADER_MAP[normalizarRotulo(celulaTexto(c))];
    if (key && !col.has(key)) col.set(key, i);
  });

  for (const nome of COLUNAS_OBRIGATORIAS) {
    if (!col.has(OBRIGATORIA_KEY[nome])) {
      return { ok: false, erro: { codigo: "COLUNA_OBRIGATORIA_AUSENTE", coluna: nome } };
    }
  }

  const at = (row: unknown[], key: ColKey): unknown => {
    const i = col.get(key);
    return i === undefined ? null : row[i];
  };

  /** Valor CRU da célula, sem passar pelo formato de exibição. Só para gastos. */
  const atBruto = (idxLinha: number, key: ColKey): unknown => {
    const i = col.get(key);
    const row = planilha.bruto[idxLinha];
    return i === undefined || !row ? null : row[i];
  };

  const linhas: LinhaVendaAA[] = [];
  const outra_loja: LinhaVendaOutraLoja[] = [];
  const lojas = new Set<string>();
  let sem_identificacao = 0;
  let total_tac = 0;
  let linhas_com_tac = 0;

  for (let i = candidataIdx + 1; i < matriz.length; i++) {
    const row = matriz[i];
    if (linhaVazia(row)) continue;

    const placa_raw = celulaTexto(at(row, "placa"));
    const placa_norm = normalizarPlaca(placa_raw);
    const chassi = chassiObservado(at(row, "chassi"));

    // RODAPÉ DE TOTAIS: a última linha do relatório vem sem placa e sem chassi, mas COM
    // "R$ 1.736.691,00" nas colunas de dinheiro. Se ela seguisse adiante, o preview
    // ofereceria uma venda fantasma de 1,7 milhão. Não é "ignorada" no sentido de erro —
    // é uma linha que não descreve carro nenhum, então sai da contagem de vendas e vira
    // só um número em `meta`.
    if (placa_norm === "" && chassi === null) {
      sem_identificacao++;
      continue;
    }

    const loja = celulaTexto(at(row, "anunciante"));
    const modelo = celulaTextoOuNull(at(row, "veiculos"));
    const data_venda = dataObservada(at(row, "data_venda"));
    const valor_vendido = valorObservadoBR(at(row, "valor_vendido"));
    if (loja !== "") lojas.add(loja);

    // Nº da linha como o usuário conta no Excel (1-based).
    const linha = i + 1;

    if (normalizarLoja(loja) !== LOJA_ALVO_NORM) {
      outra_loja.push({ linha, loja, placa_norm, modelo, data_venda, valor_vendido });
      continue;
    }

    const valor_tac = valorObservadoBR(at(row, "valor_tac"));
    if (valor_tac !== null) {
      total_tac += valor_tac;
      linhas_com_tac++;
    }

    linhas.push({
      linha,
      loja,
      placa_raw,
      placa_norm,
      chassi,
      modelo,
      data_publicacao: dataObservada(at(row, "data_publicacao")),
      data_venda,
      valor_compra: valorObservadoBR(at(row, "valor_compra")),
      valor_vendido,
      // Lido do valor BRUTO da célula (não do texto formatado) e fora do parser
      // pt-BR — ver a caixa em `gastoObservado`.
      gastos: gastoObservado(atBruto(i, "gastos_previstos")),
      valor_tac,
    });
  }

  const total_linhas = linhas.length + outra_loja.length;
  if (total_linhas === 0) return { ok: false, erro: { codigo: "ARQUIVO_SEM_LINHAS" } };

  return {
    ok: true,
    meta: {
      arquivo_nome: fileName,
      total_linhas,
      total_loja_alvo: linhas.length,
      total_outra_loja: outra_loja.length,
      total_sem_identificacao: sem_identificacao,
      lojas_encontradas: [...lojas],
      total_tac: arredondar2(total_tac),
      linhas_com_tac,
    },
    linhas,
    outra_loja,
  };
}

/**
 * Monta o payload da RPC a partir das linhas da loja alvo.
 *
 * Só as 9 chaves do contrato entram. `valor_tac` e `loja` ficam de fora — e a
 * ausência de `valor_tac` aqui é a garantia ESTRUTURAL de que o TAC não é
 * gravado: não existe chave para a RPC ler, então nem um payload adulterado
 * consegue pedir isso. Lucro e dados do comprador nem chegaram a ser lidos.
 *
 * Placa e chassi vão CRUS: quem normaliza é a RPC, com a mesma expressão do
 * índice funcional.
 */
export function montarPayloadVendas(linhas: ReadonlyArray<LinhaVendaAA>): PayloadVendas {
  return {
    versao: 1,
    origem: "arquivo_vendas_xlsx",
    linhas: linhas.map((l) => ({
      linha: l.linha,
      placa: l.placa_raw,
      chassi: l.chassi,
      modelo: l.modelo,
      data_publicacao: l.data_publicacao,
      data_venda: l.data_venda,
      valor_compra: l.valor_compra,
      valor_vendido: l.valor_vendido,
      gastos: l.gastos,
    })),
  };
}

// ─── Mensagens (pt-BR) ───────────────────────────────────────────────────────

/**
 * Rótulos dos erros fatais. A tela renderiza a partir daqui — nunca monta string
 * solta no componente. O texto é detalhe de UI e pode ser reescrito sem quebrar
 * teste: os testes asseguram o CÓDIGO.
 */
export const ROTULO_ERRO_VENDAS: Record<ErroVendasCodigo, string> = {
  ARQUIVO_ILEGIVEL:
    "Não consegui ler esse arquivo. Baixe de novo o relatório 'Vendas Concluídas' no Auto Avaliar e tente outra vez.",
  COLUNA_OBRIGATORIA_AUSENTE:
    "Esse arquivo não parece ser o relatório 'Vendas Concluídas' — não encontrei a coluna «{nome}».",
  ARQUIVO_SEM_LINHAS: "O arquivo está vazio — nenhuma venda.",
  ARQUIVO_GRANDE_DEMAIS: "Arquivo grande demais ({n} linhas). O esperado são algumas dezenas.",
};

/** Mensagem pt-BR pronta para exibir, com os buracos do rótulo preenchidos. */
export function mensagemErroVendas(erro: ErroVendas): string {
  return ROTULO_ERRO_VENDAS[erro.codigo]
    .replace("{nome}", erro.coluna ?? "")
    .replace("{n}", String(erro.linhas ?? 0));
}
