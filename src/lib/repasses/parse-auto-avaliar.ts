/**
 * Parser PURO do export do Auto Avaliar (lista de repasse) — Story 2.1 (Fatia 2).
 *
 * O Marcos seleciona a grade de carros na tela do Auto Avaliar e cola aqui. O
 * export é TAB-separated, mas cada CARRO é um REGISTRO que ocupa VÁRIAS linhas
 * físicas:
 *
 *   NAVESA - GO/MATRIZ (Goiania/GO)  <TAB> Carro          ← linha do Anunciante
 *   11                                                     ← Visualizações
 *   0 <TAB> Não <TAB> Em oferta <TAB> RBU6F30 RANGER ... km: 260739 <TAB>
 *           03/08/2026 <TAB> 93.000,00 <TAB> 104.000,00 / 109.000,00 <TAB>
 *           R$ 112.112,88 AA                               ← Média AA (linha 1/3)
 *   R$ 137.945,00 F                                        ← Média Fipe (2/3)
 *   R$ 139.990,00 W                                        ← Média Web (3/3)
 *
 * Estratégia ROBUSTA (não hard-coded na posição — o export real pode variar):
 *   1. Detecta o CABEÇALHO e mapeia colunas por RÓTULO (regex), não por índice.
 *   2. Agrupa linhas físicas por FRONTEIRA de Anunciante (um registro começa
 *      quando a 1ª célula termina em "(Cidade/UF)").
 *   3. Extrai os campos que consumimos por ÂNCORA de conteúdo (o bloco "Ano Mod."
 *      identifica o Veículo; "X / Y" identifica Mínimo/Compre por; "R$ N AA|F|W"
 *      identifica o bloco de Médias), não por coluna cega.
 *
 * 100% PURO: sem I/O, sem Date.now. O oráculo dos testes é este módulo.
 * Todo valor monetário passa por `parseValorBR` (centavo-perfect).
 */

import { parseValorBR } from "@/lib/utils/parse-br";
import { normalizarPlaca } from "@/lib/utils/placa";

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type RegistroAA = {
  /** Número da linha física (1-based) onde o registro começa. */
  linha: number;
  placa_raw: string;
  placa_norm: string;
  modelo: string | null;
  cor: string | null;
  ano_modelo: number | null;
  km: number | null;
  valor_compra: number | null;
  /** Gastos adicionais ("+ Gastos: R$ X"). 0 quando ausente. */
  gastos: number;
  minimo: number | null;
  compre_por: number | null;
  media_aa: number | null;
  media_fipe: number | null;
  media_web: number | null;
  status_aa: string;
  /** Data de validade normalizada pra ISO (YYYY-MM-DD), ou null. */
  data_validade: string | null;
};

export type AvisoCodigo =
  | "header_nao_reconhecido"
  | "coluna_ausente"
  | "placa_invalida"
  | "valor_ilegivel"
  | "ano_ausente"
  | "km_ausente"
  | "bloco_medias_incompleto"
  | "linha_ignorada";

export type Aviso = {
  /** Linha física (1-based) relacionada ao aviso. 0 = global (ex.: header). */
  linha: number;
  /** Campo/coluna afetado. */
  campo: string;
  /** Valor cru que disparou o aviso (pra o Marcos entender). */
  valor_raw: string;
  codigo: AvisoCodigo;
};

export type ParseResultAA = {
  registros: RegistroAA[];
  avisos: Aviso[];
};

// ─── Mapa de colunas (header → chave canônica) ───────────────────────────────

type ColKey =
  | "anunciante"
  | "tipo"
  | "visualizacoes"
  | "avaliacoes"
  | "autobid"
  | "status"
  | "veiculos"
  | "data_validade"
  | "compra"
  | "minimo_compre"
  | "media"
  | "oferta_final"
  | "comprador"
  | "rentabilidade"
  | "operacoes";

/**
 * Padrões de rótulo, em ORDEM de prioridade. Cada célula do header é atribuída
 * à PRIMEIRA chave (ainda não reivindicada) cujo padrão casar. A ordem importa:
 * "comprador" vem antes de "avaliacoes" pra "Comprador / Ult.Avaliacao" não ser
 * confundido com a coluna "Avaliações"; "tipo" antes de "veiculos" por causa de
 * "Tipo Veículo".
 */
const PADROES_COLUNA: ReadonlyArray<{ key: ColKey; re: RegExp }> = [
  { key: "anunciante", re: /anunciante/i },
  { key: "tipo", re: /tipo/i },
  { key: "visualizacoes", re: /visualiz/i },
  { key: "autobid", re: /autobid/i },
  { key: "status", re: /status/i },
  { key: "veiculos", re: /ve[íi]culos?/i },
  { key: "data_validade", re: /validade/i },
  { key: "compra", re: /compra/i },
  { key: "minimo_compre", re: /m[íi]nimo|compre\s*por/i },
  { key: "media", re: /m[ée]dia/i },
  { key: "oferta_final", re: /oferta/i },
  { key: "comprador", re: /comprador/i },
  { key: "rentabilidade", re: /rentab/i },
  { key: "operacoes", re: /opera[çc]/i },
  { key: "avaliacoes", re: /avalia/i },
];

/** Colunas sem as quais não conseguimos parsear com segurança. */
const COLUNAS_ESSENCIAIS: ReadonlyArray<ColKey> = [
  "anunciante",
  "veiculos",
  "compra",
  "minimo_compre",
  "media",
];

type ColMap = Partial<Record<ColKey, number>>;

// ─── Utilitários de linha ────────────────────────────────────────────────────

/** Quebra em células por TAB (o formato real do export do Auto Avaliar). */
function splitCelulas(linha: string): string[] {
  return linha.split("\t").map((c) => c.trim());
}

/** Uma linha é fronteira de novo registro se a 1ª célula termina em "(Cidade/UF)". */
const RE_ANUNCIANTE = /\([^)]*\/[A-Z]{2}\)\s*$/;
function ehFronteiraAnunciante(linha: string): boolean {
  const primeira = splitCelulas(linha)[0] ?? "";
  return RE_ANUNCIANTE.test(primeira);
}

/** Detecta a linha de cabeçalho: TAB-separated com rótulos-chave reconhecíveis. */
function ehLinhaHeader(linha: string): boolean {
  const celulas = splitCelulas(linha);
  const texto = celulas.join(" ");
  return /anunciante/i.test(texto) && /ve[íi]culos?/i.test(texto);
}

/** Constrói o mapa coluna→índice a partir das células do header. */
function montarColMap(headerCelulas: string[]): ColMap {
  const map: ColMap = {};
  const reivindicadas = new Set<ColKey>();
  headerCelulas.forEach((celula, idx) => {
    for (const { key, re } of PADROES_COLUNA) {
      if (reivindicadas.has(key)) continue;
      if (re.test(celula)) {
        map[key] = idx;
        reivindicadas.add(key);
        break;
      }
    }
  });
  return map;
}

// ─── Extração de sub-campos ──────────────────────────────────────────────────

/** Cores comuns (pt-BR) pra separar cor do modelo no campo Veículo. */
const CORES = new Set([
  "branco",
  "preto",
  "prata",
  "cinza",
  "vermelho",
  "azul",
  "verde",
  "amarelo",
  "marrom",
  "bege",
  "dourado",
  "laranja",
  "vinho",
  "grafite",
  "gelo",
  "rosa",
  "roxo",
]);
/** Modificadores que acompanham a cor ("Cinza Escuro", "Prata Metálico"). */
const MODIF_COR = new Set(["escuro", "claro", "metalico", "metálico", "perolizado", "fosco"]);

const RE_ANO = /ano\s*mod\.?\s*(\d{4})/i;
const RE_KM = /km:?\s*([\d.]+)/i;
const RE_DATA = /^(\d{2})\/(\d{2})\/(\d{4})$/;
/** "104.000,00 / 109.000,00" — dois valores numéricos separados por barra. */
const RE_MINIMO_COMPRE = /^[\d.,\s]+\/[\d.,\s]+$/;
/** "R$ 112.112,88 AA" — valor monetário com rótulo AA|F|W no fim. */
const RE_MEDIA = /^R?\$?\s*([\d.,]+)\s*(AA|F|W)$/i;

type VeiculoExtraido = {
  placa_raw: string;
  modelo: string | null;
  cor: string | null;
  ano_modelo: number | null;
  km: number | null;
  temAno: boolean;
  temKm: boolean;
};

/** Extrai placa/modelo/cor/ano/km do campo Veículo. */
function extrairVeiculo(cell: string): VeiculoExtraido {
  const tokens = cell.trim().split(/\s+/);
  const placa_raw = tokens[0] ?? "";

  const mAno = RE_ANO.exec(cell);
  const ano_modelo = mAno ? Number.parseInt(mAno[1], 10) : null;

  const mKm = RE_KM.exec(cell);
  const km = mKm ? Number.parseInt(mKm[1].replace(/\./g, ""), 10) : null;

  // Texto do modelo/cor = tudo entre a placa e o "Ano Mod." (ou o fim).
  const semPlaca = cell.slice(cell.indexOf(placa_raw) + placa_raw.length);
  const idxAno = semPlaca.search(/ano\s*mod/i);
  const miolo = (idxAno >= 0 ? semPlaca.slice(0, idxAno) : semPlaca).trim();

  let modelo: string | null = miolo || null;
  let cor: string | null = null;
  if (miolo) {
    const palavras = miolo.split(/\s+/);
    const ultima = palavras[palavras.length - 1] ?? "";
    let corPalavras = 0;
    // "Cinza Escuro" / "Prata Metálico": o modificador segue a cor.
    if (MODIF_COR.has(ultima.toLowerCase()) && palavras.length >= 2) {
      const anterior = palavras[palavras.length - 2] ?? "";
      if (CORES.has(anterior.toLowerCase())) {
        cor = `${anterior} ${ultima}`;
        corPalavras = 2;
      }
    }
    if (corPalavras === 0 && CORES.has(ultima.toLowerCase())) {
      cor = ultima;
      corPalavras = 1;
    }
    if (corPalavras > 0) {
      modelo = palavras.slice(0, palavras.length - corPalavras).join(" ") || null;
    }
  }

  return {
    placa_raw,
    modelo,
    cor,
    ano_modelo,
    km,
    temAno: mAno != null,
    temKm: mKm != null,
  };
}

/** Placa válida (BR antiga LLLNNNN ou Mercosul LLLNLNN) após normalização. */
function placaValida(norm: string): boolean {
  return /^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(norm);
}

/** "DD/MM/YYYY" → "YYYY-MM-DD" (ou null se não casar). */
function dataParaISO(cell: string): string | null {
  const m = RE_DATA.exec(cell.trim());
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

// ─── Parser principal ────────────────────────────────────────────────────────

export function parseAutoAvaliar(texto: string): ParseResultAA {
  const avisos: Aviso[] = [];
  const registros: RegistroAA[] = [];

  if (!texto || !texto.trim()) {
    return { registros, avisos };
  }

  const linhas = texto.split(/\r?\n/);

  // ── 1. Header ──────────────────────────────────────────────────────────────
  const headerIdx = linhas.findIndex((l) => l.trim() !== "" && ehLinhaHeader(l));
  if (headerIdx < 0) {
    avisos.push({
      linha: 0,
      campo: "header",
      valor_raw: linhas.find((l) => l.trim() !== "")?.slice(0, 80) ?? "",
      codigo: "header_nao_reconhecido",
    });
    return { registros, avisos };
  }

  // O CABEÇALHO real do Auto Avaliar ENVELOPA em várias linhas físicas (igual as
  // linhas de dado): "R$ Mínimo /" ⏎ "Compre por", "Comprador /" ⏎ "Ult.Avaliacao",
  // e "Média_Fipe/Web" cai só na 2ª linha física. Reassembla o header juntando as
  // células de todas as linhas físicas ATÉ a fronteira do 1º registro (Anunciante).
  // Mapear por rótulo (não posição) já tolera as células quebradas.
  let headerEnd = headerIdx + 1;
  const headerCelulas: string[] = [...splitCelulas(linhas[headerIdx])];
  while (headerEnd < linhas.length && !ehFronteiraAnunciante(linhas[headerEnd])) {
    if (linhas[headerEnd].trim() !== "") {
      headerCelulas.push(...splitCelulas(linhas[headerEnd]));
    }
    headerEnd++;
  }

  const colMap = montarColMap(headerCelulas);
  const faltando = COLUNAS_ESSENCIAIS.filter((k) => colMap[k] === undefined);
  if (faltando.length > 0) {
    for (const k of faltando) {
      avisos.push({ linha: headerIdx + 1, campo: k, valor_raw: "", codigo: "coluna_ausente" });
    }
    avisos.push({
      linha: headerIdx + 1,
      campo: "header",
      valor_raw: headerCelulas.join(" | ").slice(0, 120),
      codigo: "header_nao_reconhecido",
    });
    return { registros, avisos };
  }

  // ── 2. Segmentação por fronteira de Anunciante ──────────────────────────────
  // Começa em headerEnd (1ª linha do 1º registro) — as linhas de continuação do
  // header já foram consumidas acima, não viram "linha_ignorada".
  type Bloco = { linha: number; celulas: string[] };
  const blocos: Bloco[] = [];
  let atual: Bloco | null = null;

  for (let i = headerEnd; i < linhas.length; i++) {
    const raw = linhas[i];
    if (raw.trim() === "") continue;

    if (ehFronteiraAnunciante(raw)) {
      atual = { linha: i + 1, celulas: [] };
      blocos.push(atual);
      atual.celulas.push(...splitCelulas(raw));
    } else if (atual) {
      atual.celulas.push(...splitCelulas(raw));
    } else {
      // Linha antes do primeiro registro (e não é header) → ignorada.
      avisos.push({
        linha: i + 1,
        campo: "linha",
        valor_raw: raw.slice(0, 80),
        codigo: "linha_ignorada",
      });
    }
  }

  // ── 3. Extração por bloco ───────────────────────────────────────────────────
  for (const bloco of blocos) {
    const reg = extrairRegistro(bloco.linha, bloco.celulas, avisos);
    if (reg) registros.push(reg);
  }

  return { registros, avisos };
}

/**
 * Extrai um `RegistroAA` das células de um bloco. Retorna null (e emite aviso)
 * quando não há placa válida.
 */
function extrairRegistro(
  linha: number,
  celulasBloco: string[],
  avisos: Aviso[],
): RegistroAA | null {
  // 3a. Separa o bloco de Médias (células "R$ N AA|F|W") do resto.
  const medias: { aa: number | null; fipe: number | null; web: number | null } = {
    aa: null,
    fipe: null,
    web: null,
  };
  let qtdMedias = 0;
  const cells: string[] = [];
  for (const c of celulasBloco) {
    const m = RE_MEDIA.exec(c);
    if (m) {
      const valor = parseValorBR(m[1]);
      const rotulo = m[2].toUpperCase();
      if (rotulo === "AA") medias.aa = valor;
      else if (rotulo === "F") medias.fipe = valor;
      else if (rotulo === "W") medias.web = valor;
      qtdMedias++;
    } else {
      cells.push(c);
    }
  }
  if (qtdMedias !== 3) {
    avisos.push({
      linha,
      campo: "media",
      valor_raw: `${qtdMedias} de 3 (AA/F/W)`,
      codigo: "bloco_medias_incompleto",
    });
  }

  // 3b. Âncoras de conteúdo.
  const viVeiculo = cells.findIndex((c) => RE_ANO.test(c) || placaValida(normalizarPlaca(c.split(/\s+/)[0] ?? "")));
  if (viVeiculo < 0) {
    avisos.push({ linha, campo: "veiculos", valor_raw: "", codigo: "coluna_ausente" });
    return null;
  }

  const veiculo = extrairVeiculo(cells[viVeiculo]);
  const placa_norm = normalizarPlaca(veiculo.placa_raw);
  if (!placaValida(placa_norm)) {
    avisos.push({
      linha,
      campo: "placa",
      valor_raw: veiculo.placa_raw,
      codigo: "placa_invalida",
    });
    return null;
  }

  if (!veiculo.temAno) {
    avisos.push({ linha, campo: "ano_modelo", valor_raw: cells[viVeiculo], codigo: "ano_ausente" });
  }
  if (!veiculo.temKm) {
    avisos.push({ linha, campo: "km", valor_raw: cells[viVeiculo], codigo: "km_ausente" });
  }

  // Status: célula imediatamente anterior ao Veículo (coluna Status).
  const status_aa = viVeiculo > 0 ? cells[viVeiculo - 1] ?? "" : "";

  // Data Validade: célula com formato DD/MM/YYYY.
  const dataCell = cells.find((c) => RE_DATA.test(c.trim()));
  const data_validade = dataCell ? dataParaISO(dataCell) : null;

  // Mínimo / Compre por: célula "X / Y".
  const minIdx = cells.findIndex((c) => RE_MINIMO_COMPRE.test(c.trim()));
  let minimo: number | null = null;
  let compre_por: number | null = null;
  if (minIdx >= 0) {
    const [rawMin, rawCompre] = cells[minIdx].split(/\s*\/\s*/);
    minimo = parseValorBR(rawMin ?? "");
    compre_por = parseValorBR(rawCompre ?? "");
    if ((rawMin && minimo === null) || (rawCompre && compre_por === null)) {
      avisos.push({
        linha,
        campo: "minimo_compre",
        valor_raw: cells[minIdx],
        codigo: "valor_ilegivel",
      });
    }
  } else {
    avisos.push({ linha, campo: "minimo_compre", valor_raw: "", codigo: "coluna_ausente" });
  }

  // R$ Compra (+ Gastos): a célula monetária imediatamente antes de Mínimo/Compre.
  let valor_compra: number | null = null;
  let gastos = 0;
  if (minIdx > 0) {
    const compraCell = cells[minIdx - 1] ?? "";
    const [antesGastos, aposGastos] = compraCell.split(/gastos:?/i);
    valor_compra = parseValorBR((antesGastos ?? "").trim());
    if (antesGastos && antesGastos.trim() && valor_compra === null) {
      avisos.push({ linha, campo: "compra", valor_raw: compraCell, codigo: "valor_ilegivel" });
    }
    if (aposGastos != null && aposGastos.trim() !== "") {
      const g = parseValorBR(aposGastos.trim());
      if (g === null) {
        avisos.push({ linha, campo: "gastos", valor_raw: compraCell, codigo: "valor_ilegivel" });
      } else {
        gastos = g;
      }
    }
  }

  return {
    linha,
    placa_raw: veiculo.placa_raw,
    placa_norm,
    modelo: veiculo.modelo,
    cor: veiculo.cor,
    ano_modelo: veiculo.ano_modelo,
    km: veiculo.km,
    valor_compra,
    gastos,
    minimo,
    compre_por,
    media_aa: medias.aa,
    media_fipe: medias.fipe,
    media_web: medias.web,
    status_aa,
    data_validade,
  };
}
