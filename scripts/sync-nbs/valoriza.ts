import type { Connection } from "oracledb";

/**
 * "Valoriza" / "Bonus" — bônus que a fábrica/montadora dá quando um carro
 * usado entra no estoque (reduz o custo de aquisição efetivo). Hoje o
 * relatório "Vendas Usados Matriz" usava uma APROXIMAÇÃO ruim
 * (custo?.ganhos_indiretos, campo "Ganhos Indiretos" do NBS — 27% de erro
 * validado pelo Marcos). O valor CERTO vem de NBS.VEICULOS_CUSTOS_ESPECIFICOS
 * (55,9 milhões de linhas — cada linha é um "item de custo" aplicado a um
 * veículo via CHASSI_RESUMIDO+COD_EMPRESA, com CODIGO_CUSTO identificando o
 * tipo de custo).
 *
 * "Programa de bônus/valoriza" usa códigos DIFERENTES por loja:
 *   - CODIGO_CUSTO = 620 ("Ford Valoriza") — lojas 2, 9, 26, 31, 32, 35
 *   - CODIGO_CUSTO = 462 ("Bonus CVP") — lojas 82, 86, 87, 89
 *   - nenhum código — demais lojas (71-Renault, 91-Geely, 3, 52, 54, 61, 93)
 *     genuinamente não têm esse programa (investigado exaustivamente:
 *     custos genéricos/automáticos delas são só operacional normal —
 *     lavagem, pintura, IPVA).
 * Somar os dois códigos juntos elimina a necessidade de decidir qual usar por
 * loja: o código que não se aplica àquela loja simplesmente não tem linha
 * pra aquele chassi, soma dá 0 naturalmente.
 *
 * Validado com match exato: placa SCR3B78 (Bronco Sport Wildtrak, loja 2)
 * tem SUM(VALOR_FINAL) WHERE CODIGO_CUSTO=620 = R$ 30.000, batendo
 * exatamente com o "Bonus" do relatório oficial NBS pra esse carro.
 *
 * ⚠️ PERFORMANCE: NÃO fazer JOIN dessa tabela com a lista de veículos em
 * estoque no SQL — testado e ficou lento (60-150+s) pro JOIN por
 * CHASSI_RESUMIDO+COD_EMPRESA (~1.100 chassis). A query abaixo, filtrando só
 * por CODIGO_CUSTO (sem JOIN), responde em segundos — é uma fração pequena
 * dos 55,9 milhões de linhas. O cruzamento com os veículos é feito em
 * memória via Map (construirMapaValoriza + buscarValoriza), não em SQL.
 */
export const CODIGOS_CUSTO_VALORIZA = [620, 462] as const;

export const SQL_SELECT_CUSTOS_VALORIZA = `
  SELECT CHASSI_RESUMIDO, COD_EMPRESA, VALOR_FINAL
  FROM NBS.VEICULOS_CUSTOS_ESPECIFICOS
  WHERE CODIGO_CUSTO IN (${CODIGOS_CUSTO_VALORIZA.join(", ")})
`;

export type LinhaCustoValoriza = {
  chassiResumido: string;
  codEmpresa: number;
  valorFinal: number;
};

/**
 * Chave de busca do Map de valoriza — mesma regra de "loja atual" usada no
 * resto do projeto (COALESCE(NULLIF(COD_EMPRESA_ATUAL,0), COD_EMPRESA)) já
 * resolvida pelo chamador antes de montar a chave. Função isolada pra
 * garantir que construção do Map e busca usem EXATAMENTE a mesma regra.
 */
export function chaveValoriza(chassiResumido: string, codEmpresa: number): string {
  return `${chassiResumido}|${codEmpresa}`;
}

/**
 * Constrói o Map chassi+empresa -> soma de VALOR_FINAL a partir das linhas
 * cruas de NBS.VEICULOS_CUSTOS_ESPECIFICOS (já filtradas por CODIGO_CUSTO IN
 * (620, 462) na query). Pode haver mais de uma linha por chassi+empresa
 * (uma linha por código de custo aplicável) — soma tudo. Função pura,
 * testável sem Oracle.
 */
export function construirMapaValoriza(linhas: LinhaCustoValoriza[]): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const l of linhas) {
    if (!l.chassiResumido) continue;
    const chave = chaveValoriza(l.chassiResumido, l.codEmpresa);
    mapa.set(chave, (mapa.get(chave) ?? 0) + l.valorFinal);
  }
  return mapa;
}

/**
 * Busca o valoriza de um veículo no Map. Ausência de entrada no Map = fato
 * conhecido (esse chassi+empresa não tem bônus aplicado) => 0, nunca null.
 * chassiResumido/codEmpresa ausentes (dado de origem incompleto) também
 * caem em 0 — não dá pra buscar sem chave, e nesse caso é "não sabemos" na
 * prática, mas o contrato do campo é sempre number, nunca null.
 */
export function buscarValoriza(
  mapa: Map<string, number>,
  chassiResumido: string | null | undefined,
  codEmpresa: number | null | undefined,
): number {
  if (!chassiResumido || codEmpresa === null || codEmpresa === undefined) return 0;
  return mapa.get(chaveValoriza(chassiResumido, codEmpresa)) ?? 0;
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

/**
 * Roda a query (sem JOIN, ver aviso de performance acima) contra o Oracle e
 * monta o Map pronto pra uso em mapearVeiculos/mapearVendas. Único ponto
 * desse módulo que toca o banco — o resto é lógica pura.
 */
export async function carregarMapaValoriza(conn: Connection): Promise<Map<string, number>> {
  const result = await conn.execute(SQL_SELECT_CUSTOS_VALORIZA);
  const rows = (result.rows ?? []) as Record<string, unknown>[];

  const linhas: LinhaCustoValoriza[] = [];
  for (const row of rows) {
    const chassiResumido = asStr(row.CHASSI_RESUMIDO);
    const codEmpresa = asNum(row.COD_EMPRESA);
    if (!chassiResumido) continue;
    linhas.push({ chassiResumido, codEmpresa, valorFinal: asNum(row.VALOR_FINAL) });
  }

  return construirMapaValoriza(linhas);
}
