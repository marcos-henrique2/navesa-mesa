/**
 * Parser do PDF "Custos de Veículos em Estoque" exportado pelo NBS.
 *
 * O PDF é gerado em layout de tabela com 18 colunas. O cabeçalho fica em uma
 * faixa Y fixa de cada página; abaixo vêm linhas de carro (uma por veículo),
 * encerradas por linhas "Total" e "Média" na última página.
 *
 * Estratégia:
 *   1. Carrega o PDF via pdfjs-dist (build legacy — funciona em browser + Node).
 *   2. Em cada página, lê todos os text items (cada um tem x, y, string).
 *   3. Agrupa por linha (tolerância de Y).
 *   4. Identifica linhas de dado pelo padrão: começa com índice numérico
 *      pequeno (1..9999) na coluna #, seguido de modelo (texto), placa
 *      (regex Mercosul/antigo) e números BR.
 *   5. Mapeia cada item da linha para uma das 17 colunas com base na posição X
 *      (faixas calculadas a partir do header da página).
 *
 * Funciona client-side (upload no browser) e server-side (script Node).
 */

// Lazy import — só carrega pdfjs quando o parser é chamado, pra não pesar o bundle
// initial. Usamos o build legacy porque é o único que funciona em todos os ambientes
// (browser moderno, Next.js client, Node 22).
type PdfTextItem = { str: string; transform: number[] };
type PdfPage = { getTextContent: () => Promise<{ items: unknown[] }> };
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage> };
type PdfjsModule = {
  getDocument: (opts: { data: Uint8Array }) => { promise: Promise<PdfDoc> };
  GlobalWorkerOptions: { workerSrc: string };
};

let pdfjsModule: PdfjsModule | null = null;

async function getPdfjs(): Promise<PdfjsModule> {
  if (pdfjsModule) return pdfjsModule;
  const mod = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfjsModule;
  // Em browser: deixa o pdfjs achar o worker via bundler. Em Node, o caller setou workerSrc.
  // Se nada foi setado, deixa o pdfjs cair pro fake worker (mais lento mas funciona).
  if (typeof window !== "undefined" && !mod.GlobalWorkerOptions.workerSrc) {
    // Browser: usa o worker do mesmo pacote via dynamic URL
    try {
      mod.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
        import.meta.url,
      ).href;
    } catch {
      // Bundler não resolveu — pdfjs vai usar fake worker (ok mas lento)
    }
  }
  pdfjsModule = mod;
  return mod;
}

export type CustoEstoqueDetalhado = {
  placa: string;
  modelo: string;
  dias_patio: number;
  nota_fabrica: number;
  revisoes: number;
  forplan: number;
  holdback: number;
  acessorios: number;
  adm: number;
  impostos: number;
  comissoes: number;
  desp_gerais: number;
  custo_total: number;
  tabela: number;        // preço de venda tabela
  lucro_bruto: number;
  bonus: number;
  ganhos_indiretos: number;
};

export type CustosEstoquePdfMeta = {
  arquivo_nome: string;
  empresa: string;        // ex: "NAVESA"
  filial: string;         // ex: "02 NAVESA FORD AEROPORTO"
  cod_empresa: number;    // extraído do prefixo da filial (ex: 2)
  data_impressao: Date | null;
  total_veiculos: number;
};

export type CustosEstoquePdfResult = {
  meta: CustosEstoquePdfMeta;
  itens: CustoEstoqueDetalhado[];
  warnings: string[];
};

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Placa Mercosul (ABC1D23) ou antiga (ABC1234 / ABC-1234). */
const REGEX_PLACA = /^[A-Z]{3}[-]?\d[A-Z\d]\d{2}$/;

/** Normaliza placa removendo hífen (FPJ-6653 → FPJ6653). */
function normalizarPlaca(p: string): string {
  return p.replace(/-/g, "").toUpperCase();
}

/**
 * Parseia número em formato BR: "1.234,56" → 1234.56, "0,00" → 0, "-3.691,39" → -3691.39.
 * Também aceita formato sem separador de milhar.
 */
function parseNumBR(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  // Aceita também valores grudados tipo "33.623,10 2.004.247,57" — mas isso só ocorre em totais.
  // Pra valores individuais, regex estrita:
  if (!/^-?\d{1,3}(\.\d{3})*,\d{2}$|^-?\d+,\d{2}$|^-?\d+(\.\d+)?$/.test(t)) return null;
  const normalized = t.replace(/\./g, "").replace(",", ".");
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}

/** Texto puro tipo "1.234,56" sem ser parte de outra coisa. */
function pareceNumero(s: string): boolean {
  return /^-?\d{1,3}(\.\d{3})*,\d{2}$|^-?\d+,\d{2}$/.test(s.trim());
}

type Item = { str: string; x: number; y: number };
type Linha = { y: number; itens: Item[] };

/** Agrupa text items em linhas por proximidade vertical. */
function agruparLinhas(items: Item[], tolY: number = 3): Linha[] {
  const sorted = [...items].sort((a, b) => b.y - a.y);
  const linhas: Linha[] = [];
  for (const it of sorted) {
    const l = linhas.find((x) => Math.abs(x.y - it.y) < tolY);
    if (l) l.itens.push(it);
    else linhas.push({ y: it.y, itens: [it] });
  }
  for (const l of linhas) l.itens.sort((a, b) => a.x - b.x);
  return linhas;
}

/**
 * Mapeamento de coluna por faixa de X. Calibrado empiricamente a partir da
 * análise de cluster (scripts/inspect-pdf-clusters.local.ts), que mostrou
 * que os totais agregados batem CENTAVO a CENTAVO com a linha "Total" do
 * NBS quando usamos essas faixas:
 *
 *   Nota Fábrica:     192-200
 *   Revisões:         239-256  (incluindo o caso "todos 0" que aparece em x=256)
 *   Forplan sem HB:   278-310
 *   HoldBack:         335-345  (sempre 0 no sample)
 *   Acessórios:       380-390  (sempre 0 no sample)
 *   Comissões:        415-420  (sempre 0 no sample — header diz Comissões em x=476 mas dados estão antes)
 *   ADM:              440-460
 *   Impostos:         480-510
 *   Desp.Gerais:      540-575
 *   Custo Total:      605-620
 *   Tabela:           648-660
 *   Lucro Bruto:      700-720
 *   Bônus:            760-770  (sempre 0 no sample)
 *   Ganhos Indiretos: 780-810
 *
 * IMPORTANTE: o header visual do PDF diz "ADM, Impostos, Comissões, Desp.Gerais"
 * nessa ordem (x 404, 437, 476, 518). Mas os VALORES caem em colunas diferentes:
 * descobrimos pelo total agregado que a ordem real é "Comissões=0, ADM, Impostos,
 * Desp.Gerais". Isso é um bug/quirk do NBS (header desalinhado) — confiamos no
 * total agregado que bate, não no header visual.
 */
type ColKey =
  | "nota_fabrica" | "revisoes" | "forplan" | "holdback" | "acessorios"
  | "comissoes" | "adm" | "impostos" | "desp_gerais"
  | "custo_total" | "tabela" | "lucro_bruto" | "bonus" | "ganhos_indiretos";

const FAIXAS: { key: ColKey; xMin: number; xMax: number }[] = [
  { key: "nota_fabrica",     xMin: 185, xMax: 215 },
  { key: "revisoes",         xMin: 235, xMax: 270 },
  { key: "forplan",          xMin: 275, xMax: 315 },
  { key: "holdback",         xMin: 330, xMax: 350 },
  { key: "acessorios",       xMin: 375, xMax: 395 },
  { key: "comissoes",        xMin: 410, xMax: 430 },
  { key: "adm",              xMin: 435, xMax: 470 },
  { key: "impostos",         xMin: 475, xMax: 515 },
  { key: "desp_gerais",      xMin: 530, xMax: 580 },
  { key: "custo_total",      xMin: 600, xMax: 630 },
  { key: "tabela",           xMin: 645, xMax: 670 },
  { key: "lucro_bruto",      xMin: 695, xMax: 725 },
  { key: "bonus",            xMin: 755, xMax: 775 },
  { key: "ganhos_indiretos", xMin: 780, xMax: 815 },
];

function colunaPorX(x: number): ColKey | null {
  for (const f of FAIXAS) {
    if (x >= f.xMin && x <= f.xMax) return f.key;
  }
  return null;
}

/**
 * Encontra a placa numa linha. A placa normalmente aparece como item
 * próprio na faixa x 108-150, mas em alguns casos o NBS concatena
 * modelo + placa num único item (ex: "RANGER XLT 3.0 CD SGF9C59").
 *
 * Retorna { placa, indexNoArray, placaEmbutidaNoModelo, modeloLimpo }
 * ou null se não conseguiu.
 */
function localizarPlaca(linha: Linha): { placa: string; idx: number; embutida: boolean; modeloRestante: string } | null {
  // Caso 1: item dedicado na faixa Placa
  const idxDedicado = linha.itens.findIndex((it) => it.x >= 108 && it.x <= 160 && REGEX_PLACA.test(it.str.trim().toUpperCase()));
  if (idxDedicado !== -1) {
    return { placa: linha.itens[idxDedicado].str.trim().toUpperCase(), idx: idxDedicado, embutida: false, modeloRestante: "" };
  }
  // Caso 2: placa embutida no fim de algum item de texto na faixa Modelo (x 42-100)
  for (let i = 1; i < linha.itens.length; i++) {
    const it = linha.itens[i];
    if (it.x < 42 || it.x > 105) continue;
    // Última palavra do item: tenta como placa
    const partes = it.str.trim().split(/\s+/);
    if (partes.length < 2) continue;
    const ultima = partes[partes.length - 1].toUpperCase();
    if (REGEX_PLACA.test(ultima)) {
      return { placa: ultima, idx: i, embutida: true, modeloRestante: partes.slice(0, -1).join(" ") };
    }
  }
  return null;
}

/**
 * Detecta linha de dado: tem que começar com índice numérico em x < 40,
 * conter uma placa válida (em item próprio ou embutida no modelo).
 */
function ehLinhaDeDado(linha: Linha): boolean {
  if (linha.itens.length < 8) return false;
  const primeiro = linha.itens[0];
  if (!primeiro || primeiro.x > 40) return false;
  if (!/^\d{1,4}$/.test(primeiro.str.trim())) return false;
  return localizarPlaca(linha) !== null;
}

/**
 * Extrai um CustoEstoqueDetalhado de uma linha já identificada como dado.
 *
 * Estratégia: pra cada valor numérico (BR-format) na linha, determina a coluna
 * pelo X dele usando as faixas calibradas em FAIXAS.
 */
function extrairDado(linha: Linha, warnings: string[]): CustoEstoqueDetalhado | null {
  const loc = localizarPlaca(linha);
  if (!loc) return null;
  const placa = normalizarPlaca(loc.placa);

  // Modelo: tudo entre índice (0) e item-da-placa (loc.idx).
  // Se a placa estava embutida, usa o que sobrou daquele item + items anteriores.
  let modelo: string;
  if (loc.embutida) {
    const antes = linha.itens.slice(1, loc.idx).map((it) => it.str).join(" ").trim();
    modelo = antes ? `${antes} ${loc.modeloRestante}`.trim() : loc.modeloRestante;
  } else {
    modelo = linha.itens.slice(1, loc.idx).map((it) => it.str).join(" ").trim();
  }
  if (!modelo) {
    warnings.push(`Linha y=${linha.y.toFixed(1)} placa=${placa}: modelo vazio, ignorada`);
    return null;
  }

  // Após a placa: primeiro inteiro puro é dias_patio
  const apos = linha.itens.slice(loc.idx + 1);
  let dias_patio = 0;
  let inicioNumeros = 0;
  for (let i = 0; i < apos.length; i++) {
    const s = apos[i].str.trim();
    if (/^\d+$/.test(s) && !pareceNumero(s)) {
      dias_patio = Number.parseInt(s, 10);
      inicioNumeros = i + 1;
      break;
    }
    if (pareceNumero(s)) {
      // dias_patio ausente; começa direto nos valores BR
      inicioNumeros = i;
      break;
    }
  }

  // Atribui cada valor BR à coluna correspondente pela faixa X
  const valores: Partial<Record<ColKey, number>> = {};
  let valoresEncontrados = 0;
  for (let i = inicioNumeros; i < apos.length; i++) {
    const it = apos[i];
    const s = it.str.trim();
    if (!pareceNumero(s)) continue;
    const n = parseNumBR(s);
    if (n === null) continue;
    const col = colunaPorX(it.x);
    if (!col) {
      warnings.push(`Linha y=${linha.y.toFixed(1)} placa=${placa}: valor "${s}" em x=${it.x.toFixed(0)} fora de faixa conhecida`);
      continue;
    }
    if (valores[col] !== undefined) {
      warnings.push(`Linha y=${linha.y.toFixed(1)} placa=${placa}: coluna "${col}" duplicada (existente=${valores[col]}, novo=${n})`);
    }
    valores[col] = n;
    valoresEncontrados++;
  }

  if (valoresEncontrados < 5) {
    warnings.push(`Linha y=${linha.y.toFixed(1)} placa=${placa}: só ${valoresEncontrados} valores válidos, ignorada`);
    return null;
  }

  return {
    placa,
    modelo,
    dias_patio,
    nota_fabrica: valores.nota_fabrica ?? 0,
    revisoes: valores.revisoes ?? 0,
    forplan: valores.forplan ?? 0,
    holdback: valores.holdback ?? 0,
    acessorios: valores.acessorios ?? 0,
    adm: valores.adm ?? 0,
    impostos: valores.impostos ?? 0,
    comissoes: valores.comissoes ?? 0,
    desp_gerais: valores.desp_gerais ?? 0,
    custo_total: valores.custo_total ?? 0,
    tabela: valores.tabela ?? 0,
    lucro_bruto: valores.lucro_bruto ?? 0,
    bonus: valores.bonus ?? 0,
    ganhos_indiretos: valores.ganhos_indiretos ?? 0,
  };
}

// ─── Metadata ──────────────────────────────────────────────────────────────

function extrairMeta(linhas: Linha[], arquivoNome: string): Omit<CustosEstoquePdfMeta, "total_veiculos"> {
  let empresa = "";
  let filial = "";
  let dataImpressao: Date | null = null;

  for (const l of linhas) {
    const concat = l.itens.map((i) => i.str).join(" ");
    if (concat.startsWith("Empresa:")) {
      // "Empresa: NAVESA Página: 1"
      const m = concat.match(/Empresa:\s*([A-Z0-9\s]+?)(?:\s+Página:|$)/i);
      if (m) empresa = m[1].trim();
    }
    if (concat.startsWith("Filial:")) {
      // "Filial: 02 NAVESA FORD AEROPORTO Data de Impressão: 03/06/2026"
      const mF = concat.match(/Filial:\s*(\d+\s+[^]+?)(?:\s+Data de Impress|$)/i);
      if (mF) filial = mF[1].trim();
      const mD = concat.match(/Data de Impress[ãa]o:\s*(\d{2})\/(\d{2})\/(\d{4})/i);
      if (mD) dataImpressao = new Date(Number.parseInt(mD[3], 10), Number.parseInt(mD[2], 10) - 1, Number.parseInt(mD[1], 10));
    }
    if (empresa && filial && dataImpressao) break;
  }

  // cod_empresa: primeiro número da filial ("02 NAVESA..." → 2)
  const codMatch = filial.match(/^(\d+)\s/);
  const cod_empresa = codMatch ? Number.parseInt(codMatch[1], 10) : 0;

  return { arquivo_nome: arquivoNome, empresa, filial, cod_empresa, data_impressao: dataImpressao };
}

// ─── Parser principal ──────────────────────────────────────────────────────

export async function parseNbsCustosEstoquePdf(
  fileBuffer: ArrayBuffer,
  fileName: string,
): Promise<CustosEstoquePdfResult> {
  const warnings: string[] = [];
  const pdfjs = await getPdfjs();
  const u8 = new Uint8Array(fileBuffer);
  const doc = await pdfjs.getDocument({ data: u8 }).promise;

  let metaParcial: Omit<CustosEstoquePdfMeta, "total_veiculos"> | null = null;
  const itens: CustoEstoqueDetalhado[] = [];
  const placasVistas = new Set<string>();

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const rawItems: Item[] = [];
    for (const it of tc.items as PdfTextItem[]) {
      if (typeof it.str !== "string") continue;
      const trimmed = it.str.trim();
      if (!trimmed) continue;
      rawItems.push({ str: trimmed, x: it.transform[4], y: it.transform[5] });
    }
    const linhas = agruparLinhas(rawItems);

    // Captura meta na primeira página
    if (p === 1) {
      metaParcial = extrairMeta(linhas, fileName);
    }

    for (const l of linhas) {
      if (!ehLinhaDeDado(l)) continue;
      // Pula totais (a linha "Total" não tem índice numérico, então ehLinhaDeDado falha)
      const dado = extrairDado(l, warnings);
      if (!dado) continue;
      if (placasVistas.has(dado.placa)) {
        warnings.push(`Placa duplicada ignorada: ${dado.placa}`);
        continue;
      }
      placasVistas.add(dado.placa);
      itens.push(dado);
    }
  }

  if (!metaParcial) {
    throw new Error("Não foi possível extrair metadata do PDF (Empresa/Filial). Verifique se é o relatório correto.");
  }

  return {
    meta: { ...metaParcial, total_veiculos: itens.length },
    itens,
    warnings,
  };
}
