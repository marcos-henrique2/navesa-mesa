import type { Connection } from "oracledb";
import type { VeiculoParsed } from "../../src/lib/parsers/nbs-xlsx";
import { mapearVeiculos, type LookupsVeiculo } from "./mapear-veiculo";
import { carregarMapaValoriza } from "./valoriza";
import { carregarMapasCustosDetalhados } from "./custos-estoque-detalhado";

// Limites de sanidade pra validar o filtro "em estoque hoje". Validado contra
// export real e completo do estoque de SEMINOVOS (`estoque 2.xlsx`, 1.124
// veículos, 16 empresas): DATA_VENDA NULL/sentinela + STATUS='E' +
// CONSIGNATO='N' dá recall 98,7% / precisão 99,9% (1.109 de 1.110
// candidatos batem). Faixa plausível companywide (17 lojas) é bem mais
// estreita que antes — algo entre 900 e 1.300. Fora de [MIN_PLAUSIVEL,
// MAX_PLAUSIVEL] o filtro provavelmente está errado — não seguimos pra
// query completa, só reportamos.
const MIN_PLAUSIVEL = 900;
const MAX_PLAUSIVEL = 1300;

export type ResultadoSyncVeiculos = {
  contagemFiltroEstoque: number;
  filtroPlausivel: boolean;
  veiculos: VeiculoParsed[];
  amostra: VeiculoParsed[];
  lookupsEncontrados: {
    tabelasCombustivelOuCor: string[];
    produtosModelosExiste: boolean;
  };
  /** Tempo real da query de NBS.VEICULOS_CUSTOS_ESPECIFICOS (sem JOIN, ver valoriza.ts) — monitorar performance. */
  tempoMsMapaValoriza: number;
  /** Tempo real das 6 queries sequenciais de custos detalhados (ver custos-estoque-detalhado.ts) — monitorar performance. */
  tempoMsCustosDetalhados: number;
  warnings: string[];
};

/**
 * Query base: veículos "em estoque hoje". O filtro só de DATA_VENDA tem
 * recall ótimo mas precisão péssima (~40%) — traz milhares de "fantasmas"
 * (vendas antigas cujo status nunca foi atualizado). STATUS='E' e
 * CONSIGNATO='N' eliminam quase todos: STATUS captura os fantasmas com
 * STATUS='D'/'T', CONSIGNATO exclui consignados ('S'), que eram a maior
 * parte do resto. Não sabemos por que ~15 veículos reais do ground truth
 * ficam com STATUS='D' em vez de 'E' (perda de ~1,3% de recall) — aceitável
 * por ora, não investigado.
 *
 * NOVO_USADO='U': NBS.VEICULOS mistura estoque de novos e de seminovos —
 * sem esse filtro, STATUS='E'+CONSIGNATO='N' sozinho traz ~2.075 linhas
 * (947 novos + 1.119 usados), quase o dobro do ground truth. Como este
 * projeto (Mesa de Precificação de Seminovos) só lida com usados, e
 * `estoque 2.xlsx` (1.124 veículos) é estoque de seminovos, adicionar
 * NOVO_USADO='U' é obrigatório — dá 1.119, batendo quase exato com o
 * ground truth.
 *
 * Qualificada com `v.` porque a query de leitura completa faz JOIN (ver
 * `SQL_SELECT_VEICULOS` abaixo).
 */
const FILTRO_ESTOQUE = `(v.DATA_VENDA IS NULL OR v.DATA_VENDA = TO_DATE('1899-12-30','YYYY-MM-DD')) AND v.STATUS = 'E' AND v.CONSIGNATO = 'N' AND v.NOVO_USADO = 'U'`;

/**
 * modelo/marca via chave composta (COD_PRODUTO, COD_MODELO) — mesmo JOIN
 * confirmado empiricamente em sync-vendas.ts (COD_MODELO sozinho não é
 * único; campos `_USADO` vêm NULL pra veículo em estoque, não usar).
 */
const SQL_SELECT_VEICULOS = `
  SELECT v.*, COALESCE(NULLIF(v.COD_EMPRESA_ATUAL, 0), v.COD_EMPRESA) AS LOJA_ATUAL,
    pm.DESCRICAO_MODELO AS JOIN_MODELO,
    mca.DESCRICAO_MARCA AS JOIN_MARCA
  FROM NBS.VEICULOS v
  LEFT JOIN NBS.PRODUTOS_MODELOS pm ON pm.COD_PRODUTO = v.COD_PRODUTO AND pm.COD_MODELO = v.COD_MODELO
  LEFT JOIN NBS.PRODUTOS p ON p.COD_PRODUTO = v.COD_PRODUTO
  LEFT JOIN NBS.MARCAS mca ON mca.COD_MARCA = p.COD_MARCA
  WHERE ${FILTRO_ESTOQUE}
`;

async function contarVeiculosEmEstoque(conn: Connection): Promise<number> {
  const result = await conn.execute<{ QTD: number }>(
    `SELECT COUNT(*) AS QTD FROM NBS.VEICULOS v WHERE ${FILTRO_ESTOQUE}`,
  );
  return Number(result.rows?.[0]?.QTD ?? 0);
}

/** Best-effort: procura tabelas de domínio pra combustível/cor e confirma existência de PRODUTOS_MODELOS. */
async function descobrirLookups(conn: Connection): Promise<{ tabelasCombustivelOuCor: string[]; produtosModelosExiste: boolean }> {
  let tabelasCombustivelOuCor: string[] = [];
  let produtosModelosExiste = false;

  try {
    const r = await conn.execute<{ TABLE_NAME: string }>(
      `SELECT table_name FROM all_tables WHERE owner = 'NBS' AND (table_name LIKE '%COMBUST%' OR table_name LIKE '%COR%')`,
    );
    tabelasCombustivelOuCor = (r.rows ?? []).map((row: { TABLE_NAME: string }) => row.TABLE_NAME);
  } catch (err) {
    // Metadata view pode não estar acessível pro usuário `comissao` — não é fatal.
    tabelasCombustivelOuCor = [];
    console.warn(`  (aviso) não consegui consultar all_tables: ${err instanceof Error ? err.message : err}`);
  }

  try {
    const r = await conn.execute(`SELECT COUNT(*) AS QTD FROM NBS.PRODUTOS_MODELOS WHERE ROWNUM <= 1`);
    produtosModelosExiste = (r.rows?.length ?? 0) >= 0; // se não lançou erro, a tabela existe
  } catch {
    produtosModelosExiste = false;
  }

  return { tabelasCombustivelOuCor, produtosModelosExiste };
}

export async function syncVeiculos(conn: Connection): Promise<ResultadoSyncVeiculos> {
  const warnings: string[] = [];

  const contagemFiltroEstoque = await contarVeiculosEmEstoque(conn);
  const filtroPlausivel = contagemFiltroEstoque >= MIN_PLAUSIVEL && contagemFiltroEstoque <= MAX_PLAUSIVEL;

  if (!filtroPlausivel) {
    warnings.push(
      `Filtro "em estoque" (DATA_VENDA NULL/sentinela + STATUS='E' + CONSIGNATO='N') retornou ${contagemFiltroEstoque} linhas — ` +
        `fora da faixa plausível [${MIN_PLAUSIVEL}, ${MAX_PLAUSIVEL}]. ` +
        `NÃO segui pra query completa nem gravação — reporte pro Marcos antes de inventar outro filtro.`,
    );
    const lookupsEncontrados = { tabelasCombustivelOuCor: [], produtosModelosExiste: false };
    return {
      contagemFiltroEstoque,
      filtroPlausivel,
      veiculos: [],
      amostra: [],
      lookupsEncontrados,
      tempoMsMapaValoriza: 0,
      tempoMsCustosDetalhados: 0,
      warnings,
    };
  }

  const lookupsEncontrados = await descobrirLookups(conn);

  // Mapa de bônus/valoriza (NBS.VEICULOS_CUSTOS_ESPECIFICOS, ver valoriza.ts)
  // — query separada, SEM JOIN com veículos (JOIN direto no SQL é lento,
  // 60-150s+ testado). Tempo medido e reportado pra monitorar performance,
  // já que essa query roda a cada sync (a cada 2h).
  const inicioMapaValoriza = Date.now();
  const mapaValoriza = await carregarMapaValoriza(conn);
  const tempoMsMapaValoriza = Date.now() - inicioMapaValoriza;

  // Mapas das 5 categorias de custos detalhados (NBS.VEICULOS_CUSTOS_ESPECIFICOS,
  // ver custos-estoque-detalhado.ts — 4 por lista fixa de CODIGO_CUSTO +
  // Despesas Gerais por TIPO=9 desde 07/10/2026, migration 048) — 5 queries
  // SEQUENCIAIS, uma por categoria (nunca combinar num IN() só: testado e
  // cancelado depois de 15+min; Promise.all também testado e descartado —
  // uma mesma Connection do node-oracledb serializa execute() internamente,
  // então não dava paralelismo real, só 13% de "ganho" nada confiável).
  // ~4min (expectativa) medido contra o Oracle real — desprezível dentro da
  // janela de sync (a cada 2h).
  const inicioCustosDetalhados = Date.now();
  const mapasCustosDetalhados = await carregarMapasCustosDetalhados(conn);
  const tempoMsCustosDetalhados = Date.now() - inicioCustosDetalhados;

  // Lookups de cor/combustível: sem tabela de domínio confirmada ainda, fica
  // como fallback documentado no plano ("código bruto por enquanto").
  const lookups: LookupsVeiculo = { mapaValoriza, mapasCustosDetalhados };

  const result = await conn.execute(SQL_SELECT_VEICULOS);

  const rows = (result.rows ?? []) as Record<string, unknown>[];

  if (rows.length !== contagemFiltroEstoque) {
    warnings.push(
      `Contagem simples (${contagemFiltroEstoque}) difere da query com JOIN (${rows.length}) — algum JOIN pode estar ` +
        `multiplicando linhas (chave não única em NBS.PRODUTOS_MODELOS). Investigue antes de confiar nos dados.`,
    );
  }

  const { veiculos, warnings: warningsMapeamento } = mapearVeiculos(rows, lookups);
  warnings.push(...warningsMapeamento);

  return {
    contagemFiltroEstoque,
    filtroPlausivel,
    veiculos,
    amostra: veiculos.slice(0, 5),
    lookupsEncontrados,
    tempoMsMapaValoriza,
    tempoMsCustosDetalhados,
    warnings,
  };
}
