/**
 * MOTOR GENÉRICO DE RELATÓRIO (puro / testável)
 *
 * Transforma um `RelatorioDef` + as linhas cruas + o catálogo tipado da fonte
 * numa estrutura pronta pra renderização (`RelatorioMontado`): colunas resolvidas
 * NA ORDEM do `def.colunas`, matriz de células cruas e as linhas de agregação
 * TOTAIS/MÉDIA calculadas pelo metadado `agregacao`.
 *
 * Invariantes (AC da story):
 *  - `getValor` retorna valor CRU; arredondamento só na exibição (renderer).
 *  - Precisão centavo-perfect: soma acumula os números crus (some cru, formata
 *    depois) — nunca soma valores já arredondados.
 *  - Proteção deps→null: coluna com `deps` cujo campo esteja AUSENTE na linha
 *    rende `null` (nunca NaN, nunca crash).
 *  - "nenhuma" → célula em BRANCO nas linhas de agregação (nunca "R$ 0"/"0 km").
 *  - Zero linhas → sem linhas de agregação, sem divisão por zero, sem crash.
 *  - Respeita a ORDEM escolhida no `def.colunas` (não força ordem canônica).
 */

import {
  RELATORIO_DEF_VERSION,
  type ColunaAgregacao,
  type ColunaDef,
  type ColunaFormato,
  type ColunaParams,
  type RelatorioDef,
  type ValorColuna,
} from "@/lib/export/relatorio/tipos";

/** Uma coluna já resolvida (catálogo ou branco) pronta pro renderer. */
export type ColunaResolvida = {
  /** true quando é coluna em branco (sem getter, sempre null nos dados). */
  branco: boolean;
  label: string;
  formato: ColunaFormato;
  agregacao: ColunaAgregacao;
  /** Cor de fundo opcional (só colunas em branco declaram). */
  corFundo?: string;
};

/** Uma linha de agregação (TOTAIS ou MÉDIA) já computada. */
export type LinhaAgregacao = {
  rotulo: string;
  /** Índice da coluna onde o rótulo deve ser escrito (1ª coluna em branco). */
  rotuloColIndex: number;
  /** Valores por coluna (null = célula em branco nessa linha). */
  celulas: readonly ValorColuna[];
};

/** Saída do motor, pronta pra qualquer renderer (XLSX nesta fatia; PDF na C). */
export type RelatorioMontado = {
  colunas: readonly ColunaResolvida[];
  /** Matriz de células cruas: uma linha por registro, alinhada a `colunas`. */
  linhas: readonly (readonly ValorColuna[])[];
  totais: LinhaAgregacao | null;
  media: LinhaAgregacao | null;
};

/** Testa se todos os campos de `deps` existem (propriedade presente) na linha. */
function temTodasDeps<Row>(row: Row, deps: readonly string[] | undefined): boolean {
  if (deps == null || deps.length === 0) return true;
  if (typeof row !== "object" || row === null) return false;
  const obj = row as Record<string, unknown>;
  return deps.every((d) => d in obj);
}

/** Índice da 1ª coluna em branco (agregacao "nenhuma"); fallback 0. */
function indiceRotulo(colunas: readonly ColunaResolvida[]): number {
  const i = colunas.findIndex((c) => c.agregacao === "nenhuma");
  return i >= 0 ? i : 0;
}

/**
 * Monta o relatório. Puro: mesmas entradas → mesma saída. Não toca em I/O.
 *
 * @param catalogo Mapa key→ColunaDef da fonte (contém os getters).
 */
export function montarRelatorio<Row>(
  def: RelatorioDef,
  linhas: readonly Row[],
  catalogo: ReadonlyMap<string, ColunaDef<Row>>,
): RelatorioMontado {
  if (def.schemaVersion !== RELATORIO_DEF_VERSION) {
    throw new Error(
      `RelatorioDef schemaVersion ${def.schemaVersion} incompatível (esperado ${RELATORIO_DEF_VERSION}).`,
    );
  }

  // ─── 1. Resolve colunas NA ORDEM do def.colunas ───
  const colunas: ColunaResolvida[] = [];
  // Guarda o getter/deps por índice pra reusar no cálculo de células.
  const getters: Array<{ def: ColunaDef<Row>; params?: ColunaParams } | null> = [];

  for (const saida of def.colunas) {
    if (saida.tipo === "branco") {
      colunas.push({
        branco: true,
        label: saida.label,
        formato: "texto",
        agregacao: "nenhuma",
        corFundo: saida.corFundo,
      });
      getters.push(null);
      continue;
    }
    const colDef = catalogo.get(saida.key);
    if (colDef == null) {
      throw new Error(`Coluna "${saida.key}" não existe no catálogo da fonte "${def.fonte}".`);
    }
    colunas.push({
      branco: false,
      label: saida.labelOverride ?? colDef.label,
      formato: colDef.formato,
      agregacao: colDef.agregacao,
    });
    getters.push({ def: colDef, params: saida.params });
  }

  // ─── 2. Matriz de células cruas ───
  const matriz: ValorColuna[][] = linhas.map((row) =>
    getters.map((g) => {
      if (g == null) return null; // coluna em branco
      if (!temTodasDeps(row, g.def.deps)) return null; // proteção deps→null
      return g.def.getValor(row, g.params);
    }),
  );

  // ─── 3. Linhas de agregação (só quando há registros) ───
  const temSoma = colunas.some((c) => c.agregacao === "soma");
  const temMedia = colunas.some((c) => c.agregacao === "media");
  const rotuloColIndex = indiceRotulo(colunas);

  const totais =
    def.totais.incluirTotais && linhas.length > 0 && temSoma
      ? montarLinha(colunas, matriz, "soma", "TOTAIS", rotuloColIndex)
      : null;
  const media =
    def.totais.incluirMedia && linhas.length > 0 && temMedia
      ? montarLinha(colunas, matriz, "media", "MÉDIA", rotuloColIndex)
      : null;

  return { colunas, linhas: matriz, totais, media };
}

/**
 * Calcula UMA linha de agregação. Para cada coluna:
 *  - se agregacao === `modo` → computa Σ (soma) ou média dos números não-nulos;
 *  - senão → célula em branco (null).
 * Some cru; sem arredondamento aqui (centavo-perfect). Média ignora nulos e
 * nunca divide por zero (count 0 → null).
 */
function montarLinha(
  colunas: readonly ColunaResolvida[],
  matriz: readonly (readonly ValorColuna[])[],
  modo: "soma" | "media",
  rotulo: string,
  rotuloColIndex: number,
): LinhaAgregacao {
  const celulas: ValorColuna[] = colunas.map((col, c) => {
    if (col.agregacao !== modo) return null;
    let soma = 0;
    let count = 0;
    for (const linha of matriz) {
      const v = linha[c];
      if (typeof v === "number" && Number.isFinite(v)) {
        soma += v;
        count += 1;
      }
    }
    if (modo === "media") return count > 0 ? soma / count : null;
    return soma; // soma dos não-nulos (0 quando nenhum, é uma soma legítima)
  });

  return { rotulo, rotuloColIndex, celulas };
}
