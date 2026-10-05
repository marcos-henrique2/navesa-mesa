import type { Connection } from "oracledb";

/**
 * Custos de estoque detalhados (relatório nativo NBS "Custos de Veículos em
 * Estoque") — quebra o CUSTO_TOTAL_FINAL agregado em categorias individuais.
 *
 * ATUALIZADO 05/10/2026 (investigação Dara, ver migration 043): Forplan sem
 * HoldBack e HoldBack NÃO vêm mais daqui — ver
 * supabase/migrations/043_corrige_fonte_forplan_holdback.sql pro motivo
 * completo. Resumo: são colunas DIRETAS em NBS.VEICULOS
 * (CUSTO_FORPLAN_FINAL, HOLD_BACK_FINAL), não um CODIGO_CUSTO em
 * NBS.VEICULOS_CUSTOS_ESPECIFICOS — confirmado batendo ao centavo contra o
 * relatório nativo PDF "Custos de Veículos em Estoque" de 05/10/2026 em 3
 * veículos (AMAROK chassi 163765/empresa 2, RANGER chassi 175371/empresa 2,
 * RANGER chassi 178346/empresa 2). Esse módulo agora só cobre as 4
 * categorias restantes (Impostos, Revisões, Acessórios, Comissões), que
 * continuam vindo de NBS.VEICULOS_CUSTOS_ESPECIFICOS por CODIGO_CUSTO — ver
 * mapear-veiculo.ts pra onde custo_forplan/custo_holdback são lidos agora
 * (direto de NBS.VEICULOS, mesmo padrão de custo_total).
 *
 * Mesma fonte e mesma técnica de valoriza.ts (NBS.VEICULOS_CUSTOS_ESPECIFICOS,
 * filtro só por CODIGO_CUSTO, sem JOIN, cruzamento em memória via Map
 * chassi_resumido+loja). Ver investigação completa original (confiança por
 * categoria, códigos candidatos testados e descartados) em
 * supabase/migrations/040_custos_estoque_detalhado_em_veiculos.sql.
 *
 * ADM e Despesas Gerais ficam FORA deste módulo: nenhum CODIGO_CUSTO foi
 * encontrado pra elas (hipótese: rateio calculado pelo motor do relatório
 * NBS, não um lançamento por veículo) — as colunas no banco são NULLABLE SEM
 * DEFAULT (NULL = "não apurado") e não devem ser escritas por código algum.
 *
 * ⚠️ PERFORMANCE: uma única query com todos os códigos das categorias num
 * IN() gigante contra NBS.VEICULOS_CUSTOS_ESPECIFICOS (55,9 milhões de
 * linhas, sem índice em CODIGO_CUSTO) foi testada e precisou ser CANCELADA
 * depois de 15+ minutos. Rodar uma query por categoria é mais previsível —
 * medido contra o Oracle real em 02/10/2026: 190.196ms (~3,2min) sequencial
 * pras 6 categorias originais (ver carregarMapasCustosDetalhados abaixo) —
 * mesma decisão de valoriza.ts, replicada aqui por categoria em vez de
 * programa de bônus. Com Forplan/HoldBack removidos daqui, agora são só 4
 * categorias/queries.
 */
export const CODIGOS_CUSTO_IMPOSTOS = [
  142, 143, 268, 363, 404, 409, 410, 413, 414, 420, 422, 423, 437, 490, 526, 572, 605, 623, 686, 690,
] as const;

export const CODIGOS_CUSTO_REVISOES = [
  154, 250, 269, 280, 300, 301, 302, 303, 547, 558, 559, 560, 561, 562, 563, 564, 565, 566, 567, 568,
  569, 570, 571, 573, 574, 575, 576, 577, 606, 629, 630, 631, 650,
] as const;

export const CODIGOS_CUSTO_ACESSORIOS = [146, 424, 640] as const;

// 490 ("Imposto Comissão sobre Venda Direta") NÃO entra aqui de propósito —
// está em CODIGOS_CUSTO_IMPOSTOS. Código ambíguo entre as duas categorias;
// decisão (Marcos, 02/10/2026): só em Impostos, pra evitar dupla contagem.
//
// NOTA 05/10/2026: cruzando contra o PDF de hoje, um veículo (RANGER chassi
// 175371/empresa 2) tem Comissões=406,48 no PDF mas NENHUM CODIGO_CUSTO
// desta lista nem combinação óbvia de outros códigos lançados pra esse
// veículo soma esse valor — igual pra uma parte do Impostos do mesmo
// veículo (sobra ~R$343 não explicado pelos códigos 142/143). Achado em
// aberto: Comissões pode ter uma fonte adicional (campo direto em
// NBS.VEICULOS, como Forplan/HoldBack, ou outro CODIGO_CUSTO fora desta
// lista) que não deu tempo de isolar nesta rodada — mantido como baixa
// confiança, não mude sem revalidar.
export const CODIGOS_CUSTO_COMISSOES = [129, 239, 273, 297, 447, 498, 529, 545, 658] as const;

/** Nome da categoria -> campo canônico correspondente em VeiculoParsed. */
export type CategoriaCustoDetalhado = "custo_impostos" | "custo_revisoes" | "custo_acessorios" | "custo_comissoes";

/** Códigos de custo por categoria, na mesma ordem em que as queries são montadas/rodadas. */
export const CODIGOS_POR_CATEGORIA: Record<CategoriaCustoDetalhado, readonly number[]> = {
  custo_impostos: CODIGOS_CUSTO_IMPOSTOS,
  custo_revisoes: CODIGOS_CUSTO_REVISOES,
  custo_acessorios: CODIGOS_CUSTO_ACESSORIOS,
  custo_comissoes: CODIGOS_CUSTO_COMISSOES,
};

export function sqlSelectCustosPorCategoria(categoria: CategoriaCustoDetalhado): string {
  const codigos = CODIGOS_POR_CATEGORIA[categoria];
  return `
  SELECT CHASSI_RESUMIDO, COD_EMPRESA, SUM(VALOR_FINAL) AS TOTAL
  FROM NBS.VEICULOS_CUSTOS_ESPECIFICOS
  WHERE CODIGO_CUSTO IN (${codigos.join(", ")})
  GROUP BY CHASSI_RESUMIDO, COD_EMPRESA
`;
}

export type LinhaCustoDetalhado = {
  chassiResumido: string;
  codEmpresa: number;
  total: number;
};

/** Mesma regra de chave de valoriza.ts (chaveValoriza) — "loja atual" já resolvida pelo chamador. */
export function chaveCustoDetalhado(chassiResumido: string, codEmpresa: number): string {
  return `${chassiResumido}|${codEmpresa}`;
}

/**
 * Constrói o Map chassi+empresa -> TOTAL a partir das linhas já agregadas
 * (SUM/GROUP BY feito no SQL, diferente de valoriza.ts que soma em memória —
 * aqui cada categoria já vem uma linha por chassi+empresa da própria query).
 * Função pura, testável sem Oracle.
 */
export function construirMapaCustoDetalhado(linhas: LinhaCustoDetalhado[]): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const l of linhas) {
    if (!l.chassiResumido) continue;
    const chave = chaveCustoDetalhado(l.chassiResumido, l.codEmpresa);
    mapa.set(chave, (mapa.get(chave) ?? 0) + l.total);
  }
  return mapa;
}

/**
 * Busca o custo de uma categoria pro veículo no Map. Ausência de entrada =
 * fato conhecido (sem custo lançado nessa categoria) => 0, nunca null —
 * mesmo contrato de buscarValoriza.
 */
export function buscarCustoDetalhado(
  mapa: Map<string, number>,
  chassiResumido: string | null | undefined,
  codEmpresa: number | null | undefined,
): number {
  if (!chassiResumido || codEmpresa === null || codEmpresa === undefined) return 0;
  return mapa.get(chaveCustoDetalhado(chassiResumido, codEmpresa)) ?? 0;
}

function asStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function asNum(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Mapas das 6 categorias, prontos pra uso em mapearVeiculo (um Map por categoria). */
export type MapasCustosDetalhados = Record<CategoriaCustoDetalhado, Map<string, number>>;

/**
 * Roda a query de UMA categoria contra o Oracle e monta o Map pronto pra uso.
 * Único ponto desse módulo que toca o banco pra uma categoria — o resto é
 * lógica pura.
 */
export async function carregarMapaCustoDetalhado(
  conn: Connection,
  categoria: CategoriaCustoDetalhado,
): Promise<Map<string, number>> {
  const result = await conn.execute(sqlSelectCustosPorCategoria(categoria));
  const rows = (result.rows ?? []) as Record<string, unknown>[];

  const linhas: LinhaCustoDetalhado[] = [];
  for (const row of rows) {
    const chassiResumido = asStr(row.CHASSI_RESUMIDO);
    const codEmpresa = asNum(row.COD_EMPRESA);
    if (!chassiResumido) continue;
    linhas.push({ chassiResumido, codEmpresa, total: asNum(row.TOTAL) });
  }

  return construirMapaCustoDetalhado(linhas);
}

/**
 * Roda as 6 queries (uma por categoria) SEQUENCIALMENTE e devolve os 6 Maps
 * prontos.
 *
 * ⚠️ Promise.all NÃO foi usado de propósito, apesar de ter sido testado
 * primeiro: node-oracledb documenta que uma mesma Connection serializa
 * internamente chamadas que "cannot take place concurrently" (ver
 * node_modules/oracledb/lib/connection.js, comentário acima de
 * `Connection.prototype.break`) — execute() é uma delas. Medido contra o
 * Oracle real em 02/10/2026: 6 queries sequenciais = 190.196ms (~3,2min);
 * as MESMAS 6 queries via Promise.all numa única conexão = 166.292ms
 * (~2,8min), só 13% mais rápido — ou seja, o "paralelo" estava sendo
 * serializado por baixo dos panos pelo driver, não rodando de verdade em
 * paralelo (6 conexões simultâneas abertas contra o Oracle reduziriam mais,
 * mas não valem a complexidade/custo extra pra um ganho que nem os 13%
 * medidos garantem de forma confiável — é comportamento interno não
 * documentado como contrato). ~3,2min sequencial já é desprezível dentro da
 * janela de sync (a cada 2h) — mesma decisão de simplicidade de valoriza.ts.
 */
export async function carregarMapasCustosDetalhados(conn: Connection): Promise<MapasCustosDetalhados> {
  const categorias = Object.keys(CODIGOS_POR_CATEGORIA) as CategoriaCustoDetalhado[];
  const mapas: Partial<MapasCustosDetalhados> = {};

  for (const categoria of categorias) {
    mapas[categoria] = await carregarMapaCustoDetalhado(conn, categoria);
  }

  return mapas as MapasCustosDetalhados;
}
