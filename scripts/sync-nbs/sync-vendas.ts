import type { Connection } from "oracledb";
import type { VendaParsed } from "../../src/lib/parsers/nbs-vendas-xlsx";
import { mapearVendas } from "./mapear-venda";

const JANELA_DIAS = 90;

// Limites de sanidade pra validar a janela de vendas. NBS.VENDAS foi
// descartada: 3.598.237 linhas no total e DATA_FATURAMENTO NULL em 100%
// delas — é tabela de outro domínio do ERP, não vendas de veículo. As
// vendas de usado estão dentro da própria NBS.VEICULOS: DATA_VENDA
// preenchida (não nula, não a sentinela 1899-12-30) + NOVO_USADO='U' marca
// uma linha como veículo usado vendido naquela data. Validado: 1.049 vendas
// de usados nos últimos 90 dias em todas as lojas — escala plausível bate
// com o volume real do negócio (~56/mês só na loja 2/Aeroporto).
const MIN_PLAUSIVEL = 500;
const MAX_PLAUSIVEL = 1500;

/**
 * Query base: vendas de usado na janela — DATA_VENDA preenchida (real, não
 * sentinela) e NOVO_USADO='U', dentro de NBS.VEICULOS. Qualificada com `v.`
 * porque a query de leitura completa faz JOIN (ver `sqlSelectVendas` abaixo)
 * e alguma tabela joinada poderia, em teoria, ter coluna homônima.
 */
const FILTRO_VENDAS = `v.DATA_VENDA IS NOT NULL AND v.DATA_VENDA <> TO_DATE('1899-12-30','YYYY-MM-DD') AND v.NOVO_USADO = 'U' AND v.DATA_VENDA >= (SYSDATE - ${JANELA_DIAS})`;

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
 * - empresa_nome: NBS.EMPRESAS, mesma regra de loja atual usada no filtro
 *   de estoque (COD_EMPRESA_ATUAL com fallback pra COD_EMPRESA).
 * - cliente_nome/uf: NBS.CLIENTES. cliente_cidade fica de fora — CLIENTES só
 *   tem COD_CID_RES (código) e não há tabela de cidades acessível pro
 *   usuário `comissao`.
 *
 * Todas as colunas joinadas usam alias `JOIN_*` pra nunca colidir com nomes
 * de coluna reais de NBS.VEICULOS (selecionada via `v.*`).
 */
const SQL_SELECT_VENDAS = `
  SELECT v.*,
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
  LEFT JOIN NBS.EMPRESAS emp ON emp.COD_EMPRESA = COALESCE(NULLIF(v.COD_EMPRESA_ATUAL, 0), v.COD_EMPRESA)
  LEFT JOIN NBS.CLIENTES cli ON cli.COD_CLIENTE = v.COD_CLIENTE
  WHERE ${FILTRO_VENDAS}
`;

export type ResultadoSyncVendas = {
  contagemJanela: number;
  filtroPlausivel: boolean;
  vendas: VendaParsed[];
  amostra: VendaParsed[];
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

  const result = await conn.execute(SQL_SELECT_VENDAS);

  const rows = (result.rows ?? []) as Record<string, unknown>[];

  if (rows.length !== contagemJanela) {
    warnings.push(
      `Contagem simples (${contagemJanela}) difere da query com JOIN (${rows.length}) — algum JOIN pode estar ` +
        `multiplicando linhas (chave não única em NBS.PRODUTOS_MODELOS, NBS.EMPRESAS_USUARIOS, NBS.EMPRESAS ou NBS.CLIENTES). Investigue antes de confiar nos dados.`,
    );
  }

  const { vendas, warnings: warningsMapeamento } = mapearVendas(rows);
  warnings.push(...warningsMapeamento);

  return {
    contagemJanela,
    filtroPlausivel,
    vendas,
    amostra: vendas.slice(0, 5),
    warnings,
  };
}
