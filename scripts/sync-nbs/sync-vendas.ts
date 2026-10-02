import type { Connection } from "oracledb";
import type { VendaParsed } from "../../src/lib/parsers/nbs-vendas-xlsx";
import { mapearVendas, type LookupsVenda } from "./mapear-venda";
import { carregarMapaValoriza } from "./valoriza";

const JANELA_DIAS = 90;

// Limites de sanidade pra validar a janela de vendas. NBS.VENDAS foi
// descartada: 3.598.237 linhas no total e DATA_FATURAMENTO NULL em 100%
// delas — é tabela de outro domínio do ERP, não vendas de veículo. As
// vendas de usado estão dentro da própria NBS.VEICULOS: DATA_VENDA
// preenchida (não nula, não a sentinela 1899-12-30) + NOVO_USADO IN ('U','C')
// marca uma linha como veículo usado (ou consignado) vendido naquela data.
//
// Filtro expandido em 02/10/2026 (decisão @aria-architect, ver migration 042
// e o ACHADO documentado abaixo em SQL_SELECT_VENDAS): antes só NOVO_USADO='U'
// (1.085 vendas/90d). Validado contra o Oracle real: NOVO_USADO='C' (consignado)
// soma +23 vendas/90d, 100% com CONSIGNATO='S' (as 'U' são 100% CONSIGNATO='N' —
// separação limpa, sem sobreposição) — total combinado 1.108 vendas/90d. Faixa
// de sanidade [500, 1500] continua válida pro volume combinado, sem precisar
// mudar os limites.
const MIN_PLAUSIVEL = 500;
const MAX_PLAUSIVEL = 1500;

/**
 * Query base: vendas de usado (ou consignado) na janela — DATA_VENDA
 * preenchida (real, não sentinela) e NOVO_USADO IN ('U','C'), dentro de
 * NBS.VEICULOS. Qualificada com `v.` porque a query de leitura completa faz
 * JOIN (ver `sqlSelectVendas` abaixo) e alguma tabela joinada poderia, em
 * teoria, ter coluna homônima.
 */
const FILTRO_VENDAS = `v.DATA_VENDA IS NOT NULL AND v.DATA_VENDA <> TO_DATE('1899-12-30','YYYY-MM-DD') AND v.NOVO_USADO IN ('U','C') AND v.DATA_VENDA >= (SYSDATE - ${JANELA_DIAS})`;

/**
 * JOINs confirmados empiricamente contra o Oracle real (8 vendas reais
 * testadas, casos MOZAINIEL/AVIEIRA86 e RBN0A59 validados um a um):
 *
 * - modelo/marca: chave composta (COD_PRODUTO, COD_MODELO) — COD_MODELO
 *   sozinho NÃO é único (colide entre marcas diferentes). Os campos
 *   `_USADO` (COD_PRODUTO_USADO/COD_MODELO_USADO) vêm NULL pro veículo
 *   vendido — servem pra registrar veículo de troca numa venda de carro
 *   NOVO, não o veículo em si. Usar SEM sufixo.
 * - vendedor_nome/cpf: NBS.EMPRESAS_USUARIOS não tem coluna LOGIN/USUARIO —
 *   o login curto (ex: "MOZAINIEL") casa com a própria coluna NOME. Sem
 *   filtro de COD_EMPRESA no join (funcionário pode ter empresa "casa"
 *   diferente da loja do carro).
 * - empresa_nome: NBS.EMPRESAS via COD_EMPRESA_VENDEDORA — a loja que
 *   efetivamente vendeu o carro, MESMA coluna que já alimenta cod_empresa
 *   (ver mapear-venda.ts). NÃO usa COALESCE(COD_EMPRESA_ATUAL, COD_EMPRESA)
 *   (regra de "loja de origem/estoque" usada em sync-veiculos.ts e na chave
 *   LOJA_ATUAL do valoriza abaixo) — bug confirmado contra o Oracle real
 *   (RCI3H10, SDK2B96, SDL8B82): em vendas de repasse (43,4% da amostra de
 *   1057 vendas/90 dias), a loja de origem difere da loja vendedora, e
 *   empresa_nome mostrava o nome da loja ERRADA enquanto cod_empresa já
 *   mostrava a loja certa. COD_EMPRESA_VENDEDORA nunca vem nulo/zero
 *   (testado em 1057 linhas) — sem necessidade de COALESCE/NULLIF aqui.
 * - cliente_nome/uf: NBS.CLIENTES. cliente_cidade fica de fora — CLIENTES só
 *   tem COD_CID_RES (código) e não há tabela de cidades acessível pro
 *   usuário `comissao`.
 * - consignado: NÃO precisou de JOIN nem de entrada nova no SELECT — v.*
 *   já traz CONSIGNATO (coluna direta de NBS.VEICULOS, mesma usada como
 *   FILTRO_ESTOQUE em sync-veiculos.ts). Mapeado em mapear-venda.ts.
 *   ACHADO (validado contra o Oracle real em 02/10/2026, 1.108 vendas/90d
 *   combinadas 'U'+'C'): vendas de consignado usam NOVO_USADO='C', não 'U' —
 *   separação limpa confirmada (0 sobreposição: 'U' é 100% CONSIGNATO='N',
 *   'C' é 100% CONSIGNATO='S'). @aria-architect avaliou e aprovou expandir
 *   FILTRO_VENDAS pra NOVO_USADO IN ('U','C') (feito abaixo) — COM UMA
 *   RESSALVA DE SEMÂNTICA: pra vendas consignadas, `custo_total_final`/
 *   `margem_pct` vindos do Oracle não representam lucro de estoque de
 *   verdade (a revenda nunca foi dona do carro) — por isso os blocos de
 *   MARGEM do relatório "Vendas Usados Matriz" (aba-margens.ts e cia)
 *   continuam excluindo `consignado === true` explicitamente, mesmo com o
 *   filtro do sync expandido (ver nota em aba-margens.ts/gerar-workbook.ts).
 *   Os blocos de CONTAGEM (aba RESUMO) incluem consignados normalmente.
 *
 * Todas as colunas joinadas usam alias `JOIN_*` pra nunca colidir com nomes
 * de coluna reais de NBS.VEICULOS (selecionada via `v.*`).
 */
const SQL_SELECT_VENDAS = `
  SELECT v.*,
    COALESCE(NULLIF(v.COD_EMPRESA_ATUAL, 0), v.COD_EMPRESA) AS LOJA_ATUAL,
    pm.DESCRICAO_MODELO AS JOIN_MODELO,
    mca.DESCRICAO_MARCA AS JOIN_MARCA,
    eu.NOME_COMPLETO AS JOIN_VENDEDOR_NOME,
    eu.CPF AS JOIN_VENDEDOR_CPF,
    emp.NOME AS JOIN_EMPRESA_NOME,
    cli.NOME AS JOIN_CLIENTE_NOME,
    COALESCE(cli.UF_RES, cli.UF_COM) AS JOIN_CLIENTE_UF
  FROM NBS.VEICULOS v
  LEFT JOIN NBS.PRODUTOS_MODELOS pm ON pm.COD_PRODUTO = v.COD_PRODUTO AND pm.COD_MODELO = v.COD_MODELO
  LEFT JOIN NBS.PRODUTOS p ON p.COD_PRODUTO = v.COD_PRODUTO
  LEFT JOIN NBS.MARCAS mca ON mca.COD_MARCA = p.COD_MARCA
  LEFT JOIN NBS.EMPRESAS_USUARIOS eu ON eu.NOME = v.VENDEDOR
  LEFT JOIN NBS.EMPRESAS emp ON emp.COD_EMPRESA = v.COD_EMPRESA_VENDEDORA
  LEFT JOIN NBS.CLIENTES cli ON cli.COD_CLIENTE = v.COD_CLIENTE
  WHERE ${FILTRO_VENDAS}
`;

export type ResultadoSyncVendas = {
  contagemJanela: number;
  filtroPlausivel: boolean;
  vendas: VendaParsed[];
  amostra: VendaParsed[];
  /** Tempo real da query de NBS.VEICULOS_CUSTOS_ESPECIFICOS (sem JOIN, ver valoriza.ts) — monitorar performance. */
  tempoMsMapaValoriza: number;
  warnings: string[];
};

async function contarVendasNaJanela(conn: Connection): Promise<number> {
  const result = await conn.execute<{ QTD: number }>(
    `SELECT COUNT(*) AS QTD FROM NBS.VEICULOS v WHERE ${FILTRO_VENDAS}`,
  );
  return Number(result.rows?.[0]?.QTD ?? 0);
}

export async function syncVendas(conn: Connection): Promise<ResultadoSyncVendas> {
  const warnings: string[] = [];

  const contagemJanela = await contarVendasNaJanela(conn);
  const filtroPlausivel = contagemJanela >= MIN_PLAUSIVEL && contagemJanela <= MAX_PLAUSIVEL;

  if (!filtroPlausivel) {
    warnings.push(
      `Janela de ${JANELA_DIAS} dias em NBS.VEICULOS (DATA_VENDA real + NOVO_USADO='U') retornou ${contagemJanela} linhas — ` +
        `fora da faixa plausível [${MIN_PLAUSIVEL}, ${MAX_PLAUSIVEL}]. Reporte pro Marcos antes de inventar outro filtro.`,
    );
  }

  // Mapa de bônus/valoriza (NBS.VEICULOS_CUSTOS_ESPECIFICOS, ver valoriza.ts)
  // — query separada, SEM JOIN com vendas (JOIN direto no SQL é lento,
  // 60-150s+ testado). Tempo medido e reportado pra monitorar performance,
  // já que essa query roda a cada sync (a cada 2h).
  const inicioMapaValoriza = Date.now();
  const mapaValoriza = await carregarMapaValoriza(conn);
  const tempoMsMapaValoriza = Date.now() - inicioMapaValoriza;
  const lookups: LookupsVenda = { mapaValoriza };

  const result = await conn.execute(SQL_SELECT_VENDAS);

  const rows = (result.rows ?? []) as Record<string, unknown>[];

  if (rows.length !== contagemJanela) {
    warnings.push(
      `Contagem simples (${contagemJanela}) difere da query com JOIN (${rows.length}) — algum JOIN pode estar ` +
        `multiplicando linhas (chave não única em NBS.PRODUTOS_MODELOS, NBS.EMPRESAS_USUARIOS, NBS.EMPRESAS ou NBS.CLIENTES). Investigue antes de confiar nos dados.`,
    );
  }

  const { vendas, warnings: warningsMapeamento } = mapearVendas(rows, lookups);
  warnings.push(...warningsMapeamento);

  return {
    contagemJanela,
    filtroPlausivel,
    vendas,
    amostra: vendas.slice(0, 5),
    tempoMsMapaValoriza,
    warnings,
  };
}
