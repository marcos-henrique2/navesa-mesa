/**
 * Mapeamento puro das linhas brutas de `NBS.VEICULOS_MARKUP_TMP` (devolvidas
 * pelo piloto real de `NBS.PKG_MARKUP_VEIC.CALCULAR_MARKUP_ESTOQUE`, ver
 * calcular-markup-estoque.ts) pras 8 categorias do relatório "Custos de
 * Veículos em Estoque", com a mesma filosofia de bloqueio-por-divergência de
 * `sync-custos-vendidos.ts`/`executar-custos-vendidos.ts`: a reconciliação
 * contra o `custo_total_oficial` (COD_CUSTO=105) decide se o veículo pode ser
 * gravado ou não — divergência ≥ R$ 0,01 bloqueia a gravação e preserva o
 * valor anterior (ver gravarMarkupOficialEmVeiculos).
 *
 * Função pura — sem Oracle, 100% testável.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * TABELA DE CONFIANÇA (estado em 22/10/2026 — validado empiricamente em 4
 * carros diferentes, batendo ao centavo contra relatórios oficiais do NBS
 * nos 4; ver docs/sync-custos-markup-acesso.md pro histórico completo)
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   Categoria do relatório   | COD_CUSTO na TMP           | Confiança
 *   ------------------------ | --------------------------- | -------------------------------
 *   custo_revisoes           | 7  ("Despesas Oficina")     | ✅ confirmado (29.919,13 exato)
 *   custo_forplan            | 10 ("Floor Plan")           | ✅ confirmado (685.114,32 exato)
 *   custo_impostos           | 12 ("Impostos")             | ✅ confirmado (1.045,00 e 3.122,69
 *                             | — NUNCA somar com 15        |    exatos em 2 carros). 15
 *                             |   ("Impostos Usados"), é o |    ("Impostos Usados") é o MESMO
 *                             |   mesmo valor duplicado     |    valor duplicado — ignorado.
 *   custo_comissoes          | 2+3+4 (Vendedor+Gerente+    | ✅ confirmado (1.249,00 exato)
 *                             |   Terceiros)                |
 *   custo_despesas_gerais    | 9 ("Despesas Gerais")       | ✅ confirmado (15.889,84 e 9.587,02
 *                             |                             |    exatos)
 *   (ganhos indiretos,       | 11 ("Ganhos Indiretos") —   | ✅ confirmado (40.000,00 exato,
 *    abatido do total, não é |   SUBTRAÍDO da soma         |    é SUBTRAÍDO)
 *    uma das 8 colunas)      |                             |
 *   custo_adm                | 8  ("Despesas ADM")         | ⚠️ NÃO confirmado — sempre 0 nos
 *                             |                             |    4 testes, só por nome/posição
 *   custo_acessorios         | 1+102 ("Acessorios" +       | ⚠️ NÃO confirmado — sempre 0 nos
 *                             |   "Acessorios (Prop)")      |    4 testes, só por nome/posição
 *   custo_holdback            | nenhuma linha com valor em  | ❌ sem evidência nenhuma — HOLD_BACK
 *                             |   nenhum dos 4 testes        |    na TMP é sempre flag "N", não
 *                             |                             |    um valor. Sempre grava 0.
 *   (bonus, não é uma das 8) | 104 ("Bonus Cliente")       | ⚠️ NÃO confirmado — sempre 0, fora
 *                             |                             |    do mapeamento (não é coluna)
 *
 *   custo_total_oficial = COD_CUSTO=105 ("Custo Atual") — reconcilia EXATAMENTE
 *   com Nota Fiscal(5) + Forplan(10) + Revisões(7) + Despesas Gerais(9) +
 *   Impostos(12) + Comissões(2+3+4) + Despesas ADM(8) + Acessórios(1+102)
 *   − Ganhos Indiretos(11). Nota Fiscal(5) NÃO é uma das 8 colunas do
 *   relatório de custos de estoque — fica de fora do mapeamento abaixo, mas
 *   ENTRA na soma de reconciliação (ver notaFiscal/somaCategorias abaixo).
 *
 *   BUG CORRIGIDO EM 22/10/2026: a soma de reconciliação não incluía a Nota
 *   Fiscal (COD_CUSTO=5) — rodada piloto de produção (100/100 carros) gerou
 *   100/100 divergências, cada uma igual EXATAMENTE ao valor da Nota Fiscal
 *   daquele carro (ex.: chassi 112263, diferença=-R$56.000,00 = Nota Fiscal
 *   exata). A trava de segurança funcionou (zero gravações erradas), mas
 *   bloqueou 100% dos carros. Corrigido somando COD_CUSTO=5 na reconciliação
 *   (sem criar uma 9ª coluna gravada — ver `notaFiscal` no retorno e
 *   `payloadMarkupOficial` em calcular-markup-estoque.ts, que já grava
 *   custo_total = custoTotalOficial diretamente, não a soma das 8 categorias).
 *
 *   Sempre vistos em 0, sem mapeamento conhecido — NÃO entram no somatório,
 *   mas logam aviso separado se algum dia vierem com valor ≠ 0 (ver
 *   CODIGOS_SEM_MAPEAMENTO_CONHECIDO): 101 ("Fav/Fundif"), 103 ("Fretes"),
 *   14 ("ICMS do Frete").
 *
 * ─────────────────────────────────────────────────────────────────────────
 * AMBIGUIDADE DE NOME DE CAMPO NA TMP (não confirmada com dado real ainda)
 * ─────────────────────────────────────────────────────────────────────────
 * Não sabemos com certeza se a TMP devolve o código em `COD_CUSTO` ou
 * `CODIGO_CUSTO`, nem se o valor vem em `VALOR` ou `VALOR_FINAL` — os testes
 * existentes do piloto (tests/sync-nbs-markup-piloto.test.ts) usam exemplos
 * com `COD_CUSTO`/`VALOR`, mas são mocks, não dado real inspecionado. Esta
 * função tenta os dois nomes candidatos pra cada campo (mesmo padrão
 * `achaColuna`/CANDIDATOS de mapear-veiculo.ts) — CONFIRME contra uma linha
 * real de `markup_piloto_debug` antes de confiar em produção; se o nome real
 * for outro, ajuste CAMPOS_CODIGO/CAMPOS_VALOR abaixo.
 */

export type CategoriaMarkupOficial =
  | "custo_revisoes"
  | "custo_forplan"
  | "custo_impostos"
  | "custo_comissoes"
  | "custo_despesas_gerais"
  | "custo_adm"
  | "custo_acessorios"
  | "custo_holdback";

export const CATEGORIAS_MARKUP_OFICIAL: readonly CategoriaMarkupOficial[] = [
  "custo_revisoes",
  "custo_forplan",
  "custo_impostos",
  "custo_comissoes",
  "custo_despesas_gerais",
  "custo_adm",
  "custo_acessorios",
  "custo_holdback",
];

/** COD_CUSTO -> categoria. custo_holdback fica de propósito sem nenhum código (ver tabela de confiança no topo). */
const COD_CUSTO_POR_CATEGORIA: Record<CategoriaMarkupOficial, readonly number[]> = {
  custo_revisoes: [7],
  custo_forplan: [10],
  custo_impostos: [12],
  custo_comissoes: [2, 3, 4],
  custo_despesas_gerais: [9],
  custo_adm: [8],
  custo_acessorios: [1, 102],
  custo_holdback: [],
};

/** Categorias sem confiança empírica ainda (sempre 0 nos 4 testes) — ver tabela de confiança no topo. */
const CATEGORIAS_SEM_CONFIANCA: ReadonlySet<CategoriaMarkupOficial> = new Set(["custo_adm", "custo_acessorios"]);

const COD_CUSTO_GANHOS_INDIRETOS = 11;
/** Nota Fiscal — NÃO é uma das 8 colunas gravadas, mas ENTRA na soma de reconciliação contra COD_CUSTO=105 (ver cabeçalho do arquivo). */
const COD_CUSTO_NOTA_FISCAL = 5;
const COD_CUSTO_TOTAL_OFICIAL = 105;
/** NUNCA somar em custo_impostos — mesmo valor duplicado de COD_CUSTO=12 (ver tabela de confiança). */
const COD_CUSTO_IMPOSTOS_USADOS_DUPLICADO = 15;

/** Vistos sempre em 0 nos 4 testes, sem categoria conhecida — logar aviso separado se vierem ≠0 um dia. */
const CODIGOS_SEM_MAPEAMENTO_CONHECIDO: readonly { codigo: number; nome: string }[] = [
  { codigo: 101, nome: "Fav/Fundif" },
  { codigo: 103, nome: "Fretes" },
  { codigo: 14, nome: "ICMS do Frete" },
];

const CAMPOS_CODIGO = ["COD_CUSTO", "CODIGO_CUSTO"] as const;
const CAMPOS_VALOR = ["VALOR", "VALOR_FINAL"] as const;

function asNum(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function achaCampo(row: Record<string, unknown>, candidatos: readonly string[]): unknown {
  for (const c of candidatos) {
    if (Object.prototype.hasOwnProperty.call(row, c) && row[c] !== null && row[c] !== undefined) return row[c];
  }
  return undefined;
}

function extrairCodigo(linha: Record<string, unknown>): number | null {
  const bruto = achaCampo(linha, CAMPOS_CODIGO);
  if (bruto === undefined) return null;
  const n = asNum(bruto);
  return Number.isInteger(n) ? n : Math.trunc(n);
}

function extrairValor(linha: Record<string, unknown>): number {
  return asNum(achaCampo(linha, CAMPOS_VALOR));
}

/** Arredonda pra centavos (inteiro) — evita ruído de float na comparação/soma, mesmo padrão `centavos()` de sync-custos-vendidos.ts. */
function paraCentavos(valorReais: number): number {
  return Math.round(valorReais * 100);
}

function somarPorCodigos(linhas: readonly Record<string, unknown>[], codigos: readonly number[]): { somaCentavos: number; encontrado: boolean } {
  if (codigos.length === 0) return { somaCentavos: 0, encontrado: false };
  let somaCentavos = 0;
  let encontrado = false;
  for (const linha of linhas) {
    const codigo = extrairCodigo(linha);
    if (codigo !== null && codigos.includes(codigo)) {
      somaCentavos += paraCentavos(extrairValor(linha));
      encontrado = true;
    }
  }
  return { somaCentavos, encontrado };
}

export type ResultadoMapeamentoMarkup = {
  /** As 8 categorias do relatório, em reais, já arredondadas a centavo. custo_holdback é sempre 0 (sem fonte conhecida). */
  categorias: Record<CategoriaMarkupOficial, number>;
  /** COD_CUSTO=11, em reais — abatido da soma na reconciliação (não é uma das 8 colunas). */
  ganhosIndiretos: number;
  /** COD_CUSTO=5 ("Nota Fiscal"), em reais — SOMADO na reconciliação (não é uma das 8 colunas gravadas; já rastreado separadamente via valor_aquisicao). */
  notaFiscal: number;
  /** COD_CUSTO=105 ("Custo Atual") em reais, ou null se a linha não veio (procedure incompleta). */
  custoTotalOficial: number | null;
  /** Soma das 8 categorias + notaFiscal − ganhosIndiretos, em reais. */
  somaCategorias: number;
  /** somaCategorias − custoTotalOficial, em centavos (inteiro) — 0 quando custoTotalOficial é null (nada a comparar). */
  diferencaCentavos: number;
  /** true quando a diferença é ≥ R$ 0,01 OU custoTotalOficial está ausente — bloqueia gravação (ver gravarMarkupOficialEmVeiculos). */
  divergente: boolean;
  /** Motivo legível da divergência, ou null quando reconciliou. */
  motivoDivergencia: string | null;
  /**
   * Avisos não-bloqueantes: categoria historicamente "sem confiança" (ADM/
   * Acessórios) apareceu com valor ≠0 pela primeira vez (ainda assim ENTRA no
   * somatório — é o nome mais plausível disponível), ou CODIGO_CUSTO sem
   * mapeamento conhecido (101/103/14) apareceu com valor ≠0 (não entra no
   * somatório — caso não tratado, investigar).
   */
  avisos: string[];
};

/**
 * Mapeia as linhas brutas de UM veículo (VEICULOS_MARKUP_TMP) pras 8
 * categorias + reconciliação contra custo_total_oficial. Pura — testável sem
 * Oracle.
 */
export function mapearMarkupOficial(linhas: readonly Record<string, unknown>[]): ResultadoMapeamentoMarkup {
  const avisos: string[] = [];
  const categorias = {} as Record<CategoriaMarkupOficial, number>;
  let somaCategoriasCentavos = 0;

  for (const categoria of CATEGORIAS_MARKUP_OFICIAL) {
    const codigos = COD_CUSTO_POR_CATEGORIA[categoria];
    const { somaCentavos } = somarPorCodigos(linhas, codigos);
    categorias[categoria] = somaCentavos / 100;
    somaCategoriasCentavos += somaCentavos;

    if (CATEGORIAS_SEM_CONFIANCA.has(categoria) && somaCentavos !== 0) {
      avisos.push(
        `categoria ${categoria} (historicamente sempre 0 nos testes validados) veio com valor R$ ${(somaCentavos / 100).toFixed(2)} — ` +
          `ENTROU no somatório (é o nome mais plausível disponível), mas confira o mapeamento de COD_CUSTO antes de confiar.`,
      );
    }
  }

  const ganhosIndiretosCentavos = somarPorCodigos(linhas, [COD_CUSTO_GANHOS_INDIRETOS]).somaCentavos;
  somaCategoriasCentavos -= ganhosIndiretosCentavos;

  // Nota Fiscal (COD_CUSTO=5) NÃO é uma das 8 colunas gravadas (ver
  // payloadMarkupOficial em calcular-markup-estoque.ts), mas ENTRA na soma
  // de reconciliação contra custo_total_oficial — bug corrigido em
  // 22/10/2026 (ver histórico no cabeçalho do arquivo).
  const notaFiscalCentavos = somarPorCodigos(linhas, [COD_CUSTO_NOTA_FISCAL]).somaCentavos;
  somaCategoriasCentavos += notaFiscalCentavos;

  // 15 ("Impostos Usados") é o MESMO valor duplicado de 12 — nunca somar.
  // Checagem defensiva (não entra em categorias.custo_impostos, ver
  // COD_CUSTO_POR_CATEGORIA acima) — sem aviso: comportamento esperado e
  // documentado, não um caso não tratado.
  void COD_CUSTO_IMPOSTOS_USADOS_DUPLICADO;

  for (const { codigo, nome } of CODIGOS_SEM_MAPEAMENTO_CONHECIDO) {
    const { somaCentavos, encontrado } = somarPorCodigos(linhas, [codigo]);
    if (encontrado && somaCentavos !== 0) {
      avisos.push(
        `COD_CUSTO ${codigo} ("${nome}", sem mapeamento conhecido) veio com valor R$ ${(somaCentavos / 100).toFixed(2)} — ` +
          `NÃO entrou no somatório; caso não tratado, investigar antes de ignorar.`,
      );
    }
  }

  const totalOficial = somarPorCodigos(linhas, [COD_CUSTO_TOTAL_OFICIAL]);
  const custoTotalOficial = totalOficial.encontrado ? totalOficial.somaCentavos / 100 : null;

  let divergente: boolean;
  let motivoDivergencia: string | null;
  let diferencaCentavos: number;

  if (!totalOficial.encontrado) {
    divergente = true;
    diferencaCentavos = 0;
    motivoDivergencia = `COD_CUSTO=${COD_CUSTO_TOTAL_OFICIAL} (custo_total_oficial) ausente nas linhas retornadas pela procedure — reconciliação impossível.`;
  } else {
    diferencaCentavos = somaCategoriasCentavos - totalOficial.somaCentavos;
    divergente = Math.abs(diferencaCentavos) >= 1;
    motivoDivergencia = divergente
      ? `soma das 8 categorias (R$ ${(somaCategoriasCentavos / 100).toFixed(2)}) diverge do custo_total_oficial ` +
        `(R$ ${(totalOficial.somaCentavos / 100).toFixed(2)}) em R$ ${(diferencaCentavos / 100).toFixed(2)}.`
      : null;
  }

  return {
    categorias,
    ganhosIndiretos: ganhosIndiretosCentavos / 100,
    notaFiscal: notaFiscalCentavos / 100,
    custoTotalOficial,
    somaCategorias: somaCategoriasCentavos / 100,
    diferencaCentavos,
    divergente,
    motivoDivergencia,
    avisos,
  };
}
