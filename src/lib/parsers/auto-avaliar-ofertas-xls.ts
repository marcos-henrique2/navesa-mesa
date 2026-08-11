/**
 * Parser PURO do `relatorio_VeiculosEmOferta.xls` do Auto Avaliar
 * — Story 2.2 (Fatia 3a).
 *
 * Segue o contrato dos outros parsers de upload deste diretório
 * (`parseX(buf: ArrayBuffer, fileName: string)`), para entrar como mais um modo
 * do `UploadDropzone` ao lado dos quatro do NBS.
 *
 * ⚠️ DIFERENÇA IMPORTANTE em relação aos parsers do NBS: os quatro do NBS
 * terminam num store local do navegador. Este aqui alimenta uma escrita em
 * PRODUÇÃO (Supabase, via RPC) e exige passo de confirmação. Por isso o parser
 * NÃO grava nada e NÃO chama RPC: ele só devolve o payload tipado. Quem chama
 * `sincronizar_repasse_arquivo_auto_avaliar_preview` e depois a de aplicar é a
 * camada de UI/queries.
 *
 * Esta é a SEGUNDA fonte dos valores de repasse. A primeira é o texto colado
 * (`src/lib/repasses/parse-auto-avaliar.ts`), que CRIA o carro. Esta só
 * SINCRONIZA: o arquivo não traz km, cor nem gastos, e só afirma o que enxerga.
 *
 * Formato: apesar da extensão `.xls`, o arquivo é HTML disfarçado (uma
 * `<table>`). O SheetJS lê isso nativamente — nenhum parser de HTML próprio é
 * adicionado ao projeto (AC1).
 *
 * ⚠️ ARMADILHA DO SHEETJS, verificada contra o arquivo real: ao ler a `<table>`,
 * o SheetJS tenta interpretar cada célula como número no padrão en-US.
 * `"240.000,00"` vira o número **240** — três ordens de magnitude a menos, em
 * silêncio. Por isso `sheet_to_json` roda com `raw: false`, que devolve o texto
 * original da célula, e a conversão pt-BR é feita aqui por `parseValorBR`
 * (centavo-perfect). NUNCA trocar para `raw: true`.
 *
 * ⚠️ ENTIDADES HTML: o exportador escapa parte do texto (`Vers&atilde;o` no
 * cabeçalho) e deixa o resto em UTF-8 cru (`AUTOMÁTICO` na mesma linha). O
 * SheetJS não desescapa — sem tratar, a coluna `Versão` simplesmente não casa
 * e some sem avisar. As entidades são resolvidas célula a célula.
 *
 * ⚠️ ENCODING: o nome de uma das lojas tem acento (`NAVESA - GO/AP DE
 * GOIÂNIA`). Bytes decodificados como latin1 viram `GOIIA` e a loja deixa de
 * casar com qualquer coisa. Por isso a decodificação é explícita em UTF-8,
 * com fallback para windows-1252.
 *
 * 100% PURO: sem I/O, sem Date, sem rede, sem banco.
 */

import * as XLSX from "xlsx";
import { parseValorBR } from "@/lib/utils/parse-br";
import { normalizarPlaca } from "@/lib/utils/placa";

// ─── Tipos ───────────────────────────────────────────────────────────────────

/** Conjunto FECHADO de erros fatais de leitura (AC4). */
export type ErroArquivoCodigo =
  | "ARQUIVO_ILEGIVEL"
  | "COLUNA_OBRIGATORIA_AUSENTE"
  | "ARQUIVO_SEM_LINHAS"
  | "ARQUIVO_GRANDE_DEMAIS";

export type ErroArquivo = {
  codigo: ErroArquivoCodigo;
  /** Nome da coluna que faltou — só em `COLUNA_OBRIGATORIA_AUSENTE`. */
  coluna?: string;
  /** Linhas de dados encontradas — só em `ARQUIVO_GRANDE_DEMAIS`. */
  linhas?: number;
};

/** Uma linha de veículo da loja alvo, já normalizada. */
export type LinhaOfertaAA = {
  /** Nº da linha no arquivo (1-based, contando o cabeçalho) — para reportar de volta. */
  linha: number;
  /** Nome da loja como veio no arquivo. */
  loja: string;
  placa_raw: string;
  placa_norm: string;
  marca: string | null;
  modelo: string | null;
  versao: string | null;
  ano_fabricacao: number | null;
  ano_modelo: number | null;
  /** Zero é valor REAL aqui ("sem anúncio ativo"), não ausência (AC3). */
  qtde_anuncios: number | null;
  valor_compra_repasse: number | null;
  valor_minimo: number | null;
  valor_compre_por: number | null;
  valor_maior_oferta: number | null;
  valor_web: number | null;
  valor_fipe: number | null;
  valor_auto_avaliar: number | null;
};

/** Linha retida no cliente por ser de outra loja — nunca chega à RPC (AC5). */
export type LinhaOutraLoja = {
  linha: number;
  loja: string;
  placa_norm: string;
  modelo: string | null;
};

export type OfertasMeta = {
  arquivo_nome: string;
  /** Linhas de dados lidas, de todas as lojas. */
  total_linhas: number;
  /** Linhas da loja alvo — as únicas que viram payload. */
  total_loja_alvo: number;
  /** Linhas retidas por serem de outra loja. */
  total_outra_loja: number;
  /** Nomes de loja distintos no arquivo — o preview grita com isso quando o filtro zera (R3). */
  lojas_encontradas: string[];
};

/** Item do payload — só o que a RPC usa (§3: superfície mínima). */
export type ItemPayloadSyncArquivo = {
  linha: number;
  /** Placa CRUA: quem normaliza é a RPC, com a mesma expressão do índice (§3.2). */
  placa: string;
  valor_compra_repasse: number | null;
  valor_minimo: number | null;
  valor_compre_por: number | null;
  valor_fipe: number | null;
  valor_web: number | null;
  valor_auto_avaliar: number | null;
  valor_maior_oferta: number | null;
  qtde_anuncios: number | null;
};

export type PayloadSyncArquivo = {
  versao: 1;
  origem: "arquivo_xls";
  linhas: ItemPayloadSyncArquivo[];
};

export type OfertasParseOk = {
  ok: true;
  meta: OfertasMeta;
  /** Linhas da loja alvo, prontas para virar payload. */
  linhas: LinhaOfertaAA[];
  /** Linhas de outra loja, retidas no cliente (AC5). */
  outra_loja: LinhaOutraLoja[];
};

export type OfertasParseErro = { ok: false; erro: ErroArquivo };

export type OfertasParseResult = OfertasParseOk | OfertasParseErro;

// ─── Constantes de domínio ───────────────────────────────────────────────────

/** Única loja sincronizada. As outras aparecem no preview, mas não vão pra RPC (AC5). */
export const LOJA_ALVO = "NAVESA - GO/MATRIZ";

/**
 * Teto de linhas de dados. Igual ao teto da RPC (§3.7) — o cliente falha antes
 * de montar um payload que o banco recusaria. Hoje o arquivo tem ~58 linhas.
 */
export const MAX_LINHAS_ARQUIVO = 2000;

/** Colunas obrigatórias, na ordem em que são reportadas (AC2/AC4). */
const COLUNAS_OBRIGATORIAS = [
  "Loja",
  "Placa",
  "Valor Compra",
  "Valor Anunciado",
  "Valor ComprePor",
] as const;

type ColKey =
  | "loja"
  | "placa"
  | "marca"
  | "modelo"
  | "versao"
  | "ano_fab"
  | "ano_mod"
  | "qtde_anuncios"
  | "valor_compra"
  | "valor_anunciado"
  | "valor_compre_por"
  | "vlr_maior_oferta"
  | "vlr_ref_web"
  | "vlr_ref_fipe"
  | "vlr_ref_auto_avaliar";

/**
 * Rótulo do cabeçalho (já normalizado) → chave canônica.
 * O mapeamento é por NOME, nunca por índice (AC2): o Auto Avaliar pode
 * reordenar colunas sem que isso vire corrupção silenciosa de valor.
 */
const HEADER_MAP: Record<string, ColKey> = {
  "loja": "loja",
  "placa": "placa",
  "marca": "marca",
  "modelo": "modelo",
  "versao": "versao",
  "ano fab": "ano_fab",
  "ano fabricacao": "ano_fab",
  "ano mod": "ano_mod",
  "ano modelo": "ano_mod",
  "qtde anuncios": "qtde_anuncios",
  "qtd anuncios": "qtde_anuncios",
  "valor compra": "valor_compra",
  "valor anunciado": "valor_anunciado",
  "valor comprepor": "valor_compre_por",
  "valor compre por": "valor_compre_por",
  "vlr maior oferta": "vlr_maior_oferta",
  "vlr ref web": "vlr_ref_web",
  "vlr ref fipe": "vlr_ref_fipe",
  "vlr ref autoavaliar": "vlr_ref_auto_avaliar",
  "vlr ref auto avaliar": "vlr_ref_auto_avaliar",
};

/** Chave canônica de cada coluna obrigatória, para checagem de presença. */
const OBRIGATORIA_KEY: Record<(typeof COLUNAS_OBRIGATORIAS)[number], ColKey> = {
  "Loja": "loja",
  "Placa": "placa",
  "Valor Compra": "valor_compra",
  "Valor Anunciado": "valor_anunciado",
  "Valor ComprePor": "valor_compre_por",
};

// ─── Entidades HTML ──────────────────────────────────────────────────────────

/**
 * Entidades nomeadas que o exportador do Auto Avaliar realmente emite (Latin-1
 * + as cinco de markup). Não é uma tabela HTML completa de propósito: as que
 * faltarem passam adiante como texto, o que é visível, em vez de virar `?`.
 */
const ENTIDADES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  aacute: "á", agrave: "à", acirc: "â", atilde: "ã", auml: "ä",
  ccedil: "ç",
  eacute: "é", egrave: "è", ecirc: "ê", euml: "ë",
  iacute: "í", igrave: "ì", icirc: "î", iuml: "ï",
  ntilde: "ñ",
  oacute: "ó", ograve: "ò", ocirc: "ô", otilde: "õ", ouml: "ö",
  uacute: "ú", ugrave: "ù", ucirc: "û", uuml: "ü",
  ordf: "ª", ordm: "º", deg: "°",
};

/** Versões maiúsculas (`&Atilde;`, `&Ccedil;`…), derivadas das minúsculas. */
const ENTIDADES_MAIUSCULAS: Record<string, string> = Object.fromEntries(
  Object.entries(ENTIDADES)
    .filter(([nome]) => /^[a-z]{1}(acute|grave|circ|tilde|uml|cedil)$/.test(nome))
    .map(([nome, valor]) => [nome[0].toUpperCase() + nome.slice(1), valor.toUpperCase()]),
);

function decodificarEntidades(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (inteiro, corpo: string) => {
    if (corpo[0] === "#") {
      const cod = corpo[1] === "x" || corpo[1] === "X"
        ? Number.parseInt(corpo.slice(2), 16)
        : Number.parseInt(corpo.slice(1), 10);
      return Number.isFinite(cod) && cod > 0 && cod <= 0x10ffff ? String.fromCodePoint(cod) : inteiro;
    }
    return ENTIDADES[corpo] ?? ENTIDADES_MAIUSCULAS[corpo] ?? inteiro;
  });
}

// ─── Normalização de texto ───────────────────────────────────────────────────

/** Combining diacritical marks — o que sobra do `normalize("NFD")`. */
const ACENTOS = /[̀-ͯ]/g;

/** Sem acento, sem caixa, sem pontuação, espaços colapsados. */
function normalizarRotulo(s: string): string {
  return s
    .normalize("NFD")
    .replace(ACENTOS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Nome de loja comparável: sem acento, sem caixa, espaços colapsados (R3). */
function normalizarLoja(s: string): string {
  return s
    .normalize("NFD")
    .replace(ACENTOS, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

const LOJA_ALVO_NORM = normalizarLoja(LOJA_ALVO);

// ─── Conversão de célula ─────────────────────────────────────────────────────

/**
 * Texto da célula, com entidades resolvidas. Tolerante ao tipo: o SheetJS pode
 * devolver string, number, boolean ou null dependendo de como interpretou a
 * `<td>`. Sem `any` — checagem de tipo explícita (AC3: célula estranha não
 * aborta o lote).
 */
function celulaTexto(v: unknown): string {
  if (typeof v === "string") return decodificarEntidades(v).trim();
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  return "";
}

function celulaTextoOuNull(v: unknown): string | null {
  const s = celulaTexto(v);
  return s === "" ? null : s;
}

/** Arredonda a 2 casas — mata o artefato de float que viraria diff falso (§4.1). */
function arredondar2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Valor monetário observado. ZERO É AUSÊNCIA: `0,00`, `R$ 0,00`, vazio, `-` e
 * `N/A` viram `null` ("o arquivo não observou esse valor") — nunca o número 0,
 * que apagaria dado bom via COALESCE do lado do banco (AC3/AC8).
 */
function valorObservado(v: unknown): number | null {
  const s = celulaTexto(v);
  if (s === "") return null;
  const n = parseValorBR(s);
  if (n === null) return null;
  const r = arredondar2(n);
  return r === 0 ? null : r;
}

/**
 * Contagem observada. Aqui ZERO É VALOR REAL ("está sem anúncio ativo") — a
 * regra de zero-é-ausência vale só para dinheiro (AC3). Negativo e lixo → null.
 */
function qtdeObservada(v: unknown): number | null {
  const s = celulaTexto(v).replace(/\./g, "");
  if (s === "" || !/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

/** Ano de 4 dígitos, ou null. */
function anoObservado(v: unknown): number | null {
  const s = celulaTexto(v);
  return /^\d{4}$/.test(s) ? Number(s) : null;
}

// ─── Leitura da planilha ─────────────────────────────────────────────────────

/**
 * Decodifica bytes como UTF-8. Se os bytes não forem UTF-8 válido, cai para
 * windows-1252 — mais tolerante que devolver `GOI�NIA` e perder a loja de
 * Aparecida no filtro.
 */
function decodificar(bytes: Uint8Array): string {
  let texto: string;
  try {
    texto = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    texto = new TextDecoder("windows-1252").decode(bytes);
  }
  // Remove BOM — o SheetJS não gosta de sniffar `<html>` com BOM na frente.
  return texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
}

function paraTexto(entrada: ArrayBuffer | Uint8Array | string): string {
  if (typeof entrada === "string") return entrada;
  const bytes = entrada instanceof Uint8Array ? entrada : new Uint8Array(entrada);
  return decodificar(bytes);
}

/** Matriz de células da primeira planilha, ou `null` se nada legível. */
function lerMatriz(texto: string): unknown[][] | null {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(texto, { type: "string" });
  } catch {
    return null;
  }
  const nome = wb.SheetNames[0];
  const sheet = nome ? wb.Sheets[nome] : undefined;
  if (!sheet) return null;
  // `raw: false` é obrigatório — ver a armadilha documentada no topo do arquivo.
  // `blankrows: true` preserva o índice físico da linha, que é o que reportamos.
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    blankrows: true,
    raw: false,
  });
}

function linhaVazia(row: unknown[] | undefined): boolean {
  return !row || row.every((c) => celulaTexto(c) === "");
}

// ─── Parser ──────────────────────────────────────────────────────────────────

/**
 * Lê o `relatorio_VeiculosEmOferta.xls` e devolve as linhas normalizadas, já
 * separadas entre a loja alvo e as demais (AC5).
 *
 * Nunca lança: todo caminho de falha vira `{ ok: false, erro }` com código do
 * conjunto fechado da AC4. Diferente dos parsers do NBS, que sinalizam erro por
 * exceção — aqui o código do erro é contrato testado, e uma `Error` com string
 * o perderia.
 */
export function parseAutoAvaliarOfertasXls(
  fileBuffer: ArrayBuffer | Uint8Array | string,
  fileName: string,
): OfertasParseResult {
  const matriz = lerMatriz(paraTexto(fileBuffer));
  if (!matriz) return { ok: false, erro: { codigo: "ARQUIVO_ILEGIVEL" } };

  const naoVazias = matriz.filter((r) => !linhaVazia(r));
  if (naoVazias.length === 0) return { ok: false, erro: { codigo: "ARQUIVO_ILEGIVEL" } };

  // Guarda de tamanho antes de qualquer trabalho por linha (R10 / §3.7).
  if (naoVazias.length - 1 > MAX_LINHAS_ARQUIVO) {
    return { ok: false, erro: { codigo: "ARQUIVO_GRANDE_DEMAIS", linhas: naoVazias.length - 1 } };
  }

  // Cabeçalho: primeira linha (nas 10 primeiras não-vazias) que tenha Loja E
  // Placa. Se nenhuma tiver, cai na primeira não-vazia para poder NOMEAR o que
  // faltou em vez de devolver um "arquivo ilegível" sem pista.
  let headerIdx = -1;
  let primeiraNaoVazia = -1;
  let examinadas = 0;
  for (let i = 0; i < matriz.length && examinadas < 10; i++) {
    if (linhaVazia(matriz[i])) continue;
    if (primeiraNaoVazia === -1) primeiraNaoVazia = i;
    examinadas++;
    const chaves = new Set(
      matriz[i].map((c) => HEADER_MAP[normalizarRotulo(celulaTexto(c))]).filter(Boolean),
    );
    if (chaves.has("loja") && chaves.has("placa")) {
      headerIdx = i;
      break;
    }
  }
  const candidataIdx = headerIdx >= 0 ? headerIdx : primeiraNaoVazia;
  const header = matriz[candidataIdx] ?? [];

  // Mapa chave canônica → índice de coluna.
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

  const linhas: LinhaOfertaAA[] = [];
  const outra_loja: LinhaOutraLoja[] = [];
  const lojas = new Set<string>();

  for (let i = candidataIdx + 1; i < matriz.length; i++) {
    const row = matriz[i];
    if (linhaVazia(row)) continue;

    const loja = celulaTexto(at(row, "loja"));
    const placa_raw = celulaTexto(at(row, "placa"));
    const modelo = celulaTextoOuNull(at(row, "modelo"));
    if (loja !== "") lojas.add(loja);

    // Nº da linha como o usuário conta no arquivo (1-based, cabeçalho incluso).
    const linha = i + 1;

    if (normalizarLoja(loja) !== LOJA_ALVO_NORM) {
      outra_loja.push({ linha, loja, placa_norm: normalizarPlaca(placa_raw), modelo });
      continue;
    }

    linhas.push({
      linha,
      loja,
      placa_raw,
      placa_norm: normalizarPlaca(placa_raw),
      marca: celulaTextoOuNull(at(row, "marca")),
      modelo,
      versao: celulaTextoOuNull(at(row, "versao")),
      ano_fabricacao: anoObservado(at(row, "ano_fab")),
      ano_modelo: anoObservado(at(row, "ano_mod")),
      qtde_anuncios: qtdeObservada(at(row, "qtde_anuncios")),
      valor_compra_repasse: valorObservado(at(row, "valor_compra")),
      valor_minimo: valorObservado(at(row, "valor_anunciado")),
      valor_compre_por: valorObservado(at(row, "valor_compre_por")),
      valor_maior_oferta: valorObservado(at(row, "vlr_maior_oferta")),
      valor_web: valorObservado(at(row, "vlr_ref_web")),
      valor_fipe: valorObservado(at(row, "vlr_ref_fipe")),
      valor_auto_avaliar: valorObservado(at(row, "vlr_ref_auto_avaliar")),
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
      lojas_encontradas: [...lojas],
    },
    linhas,
    outra_loja,
  };
}

/**
 * Monta o payload da RPC a partir das linhas da loja alvo (§3).
 *
 * Só as 9 chaves do contrato entram — `marca`, `modelo`, `versao` e `loja` são
 * informação de tela e não têm por que trafegar para o banco. A placa vai CRUA:
 * quem normaliza é a RPC, com a mesma expressão do índice funcional.
 *
 * Não monta nada sobre o que o arquivo NÃO tem: repasse que existe no sistema e
 * sumiu do arquivo (o relatório é um retrato móvel — carro entra e sai entre
 * downloads) simplesmente não aparece aqui, e ausência não é afirmação (AC17).
 */
export function montarPayloadSyncArquivo(linhas: LinhaOfertaAA[]): PayloadSyncArquivo {
  return {
    versao: 1,
    origem: "arquivo_xls",
    linhas: linhas.map((l) => ({
      linha: l.linha,
      placa: l.placa_raw,
      valor_compra_repasse: l.valor_compra_repasse,
      valor_minimo: l.valor_minimo,
      valor_compre_por: l.valor_compre_por,
      valor_fipe: l.valor_fipe,
      valor_web: l.valor_web,
      valor_auto_avaliar: l.valor_auto_avaliar,
      valor_maior_oferta: l.valor_maior_oferta,
      qtde_anuncios: l.qtde_anuncios,
    })),
  };
}

// ─── Mensagens (pt-BR) ───────────────────────────────────────────────────────

/**
 * Rótulos dos erros fatais. A tela renderiza a partir daqui — nunca monta
 * string solta no componente (AC4). O texto é detalhe de UI e pode ser
 * reescrito pelo @uma-ux sem quebrar teste: os testes asseguram o CÓDIGO.
 */
export const ROTULO_ERRO_ARQUIVO: Record<ErroArquivoCodigo, string> = {
  ARQUIVO_ILEGIVEL:
    "Não consegui ler esse arquivo. Baixe de novo o relatório 'Veículos em Oferta' no Auto Avaliar e tente outra vez.",
  COLUNA_OBRIGATORIA_AUSENTE:
    "Esse arquivo não parece ser o relatório 'Veículos em Oferta' — não encontrei a coluna «{nome}».",
  ARQUIVO_SEM_LINHAS: "O arquivo está vazio — só tem o cabeçalho, nenhum veículo.",
  ARQUIVO_GRANDE_DEMAIS: "Arquivo grande demais ({n} linhas). O esperado é algo em torno de 60.",
};

/** Mensagem pt-BR pronta para exibir, com os buracos do rótulo preenchidos. */
export function mensagemErroArquivo(erro: ErroArquivo): string {
  return ROTULO_ERRO_ARQUIVO[erro.codigo]
    .replace("{nome}", erro.coluna ?? "")
    .replace("{n}", String(erro.linhas ?? 0));
}
