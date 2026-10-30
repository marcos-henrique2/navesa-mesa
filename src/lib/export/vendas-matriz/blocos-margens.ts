/**
 * VENDAS USADOS MATRIZ — subconjuntos de linhas de cada bloco das abas 2/4/5/6.
 *
 * Função PURA e fonte ÚNICA dos filtros: `gerar-workbook.ts` desenha os blocos do Excel a
 * partir daqui, e o painel (aba Margens) monta as colunas a partir daqui — os dois sempre
 * olham o mesmo subconjunto, na mesma ordem de linha, então os totais batem ao centavo.
 *
 * Regras (ver comentários originais em gerar-workbook.ts):
 * - Origem pela `classificarOrigem` (tipos.ts). "Outras lojas" exclui origem não
 *   identificada; "Só estoque" (aba 2) também.
 * - Todo bloco de MARGEM exclui consignado (ressalva @aria-architect 02/10/2026).
 * - Abas 5/6 (regra `lojista` = mais de 2 compras no ano): `lojista = null` (sem CPF/CNPJ)
 *   fica de fora das duas, de propósito.
 */

import { classificarOrigem, type LinhaVendaMatriz } from "./tipos";

export type BlocosMargens = {
  /** Aba 2 "SÓ ESTOQUE" — origem própria, consignado incluso (é aba de detalhe). */
  aba2: LinhaVendaMatriz[];
  /** Aba 4 — "VENDIDO TOTAL NAVESA AEROPORTO". */
  total: LinhaVendaMatriz[];
  /** Aba 4 — "VENDIDO SOMENTE ESTOQUE NAVESA AEROPORTO". */
  proprio: LinhaVendaMatriz[];
  /** Aba 4 — "VENDIDO NAVESA - ESTOQUES OUTRAS LOJAS". */
  outras: LinhaVendaMatriz[];
  /** Aba 5 — "VENDIDO REPASSE OUTROS ESTOQUES" (lojista = SIM, outras lojas). */
  lojistaOutras: LinhaVendaMatriz[];
  /** Aba 5 — "VENDIDO REPASSE ESTOQUE NAVESA" (lojista = SIM, estoque próprio). */
  lojistaPropria: LinhaVendaMatriz[];
  /** Aba 6 — "VENDIDO CLIENTE FINAL ESTOQUE NAVESA" (lojista = NÃO, estoque próprio). */
  clientePropria: LinhaVendaMatriz[];
  /** Aba 6 — "VENDIDO CLIENTE FINAL OUTROS ESTOQUES" (lojista = NÃO, outras lojas). */
  clienteOutras: LinhaVendaMatriz[];
};

export function separarBlocosMargens(linhasAba1: LinhaVendaMatriz[], codEmpresa: number): BlocosMargens {
  const origem = (l: LinhaVendaMatriz) => classificarOrigem(l, codEmpresa);
  const semConsig = (l: LinhaVendaMatriz) => l.consignado === false;
  return {
    aba2: linhasAba1.filter((l) => origem(l) === "proprio"),
    total: linhasAba1.filter(semConsig),
    proprio: linhasAba1.filter((l) => origem(l) === "proprio" && semConsig(l)),
    outras: linhasAba1.filter((l) => origem(l) === "outras" && semConsig(l)),
    lojistaOutras: linhasAba1.filter((l) => l.lojista === true && origem(l) === "outras" && semConsig(l)),
    lojistaPropria: linhasAba1.filter((l) => l.lojista === true && origem(l) === "proprio" && semConsig(l)),
    clientePropria: linhasAba1.filter((l) => l.lojista === false && origem(l) === "proprio" && semConsig(l)),
    clienteOutras: linhasAba1.filter((l) => l.lojista === false && origem(l) === "outras" && semConsig(l)),
  };
}
