/**
 * MIX PF × LOJISTA — Story 2 (Análise de Vendas).
 *
 * "Lojista" aqui é o resultado de `detectarLojista()` (lib/export/analise-navesa.ts) —
 * a MESMA função usada no export Excel oficial que o Marcos já confia — e NÃO
 * simplesmente `cliente_tipo === "PJ"`. `clientesIndex` deve vir de
 * `indexarClientes(todasVendas)` (dataset COMPLETO, não o filtrado da tela), senão a
 * recorrência (totalCompras) conta errado e diverge do Excel.
 */

import type { VendaParsed } from "@/lib/parsers/nbs-vendas-xlsx";
import type { ClienteAgregado } from "@/lib/analytics/clientes";
import { chaveCliente, detectarLojista } from "@/lib/analytics/clientes";

export type MixClientesResumo = {
  lojista: number;
  consumidorFinal: number;
  total: number;
  pctLojista: number;
  pctConsumidorFinal: number;
};

export function calcularMixClientes(
  vendas: VendaParsed[],
  clientesIndex: Map<string, ClienteAgregado>,
): MixClientesResumo {
  let lojista = 0;
  let consumidorFinal = 0;
  for (const v of vendas) {
    const totalCompras = clientesIndex.get(chaveCliente(v))?.totalCompras ?? 1;
    // Decisão de UX (AC2 da story): PJ ocasional (1-3 compras, não-lojista) entra junto
    // com PF em "Consumidor final" — só 2 categorias, pra não duplicar o conceito já
    // coberto pelo filtro "Tipo" (PF/PJ) existente na tela, que é outra classificação.
    if (detectarLojista(v, totalCompras) === "SIM") lojista++;
    else consumidorFinal++;
  }
  const total = lojista + consumidorFinal;
  return {
    lojista,
    consumidorFinal,
    total,
    pctLojista: total > 0 ? (lojista / total) * 100 : 0,
    pctConsumidorFinal: total > 0 ? (consumidorFinal / total) * 100 : 0,
  };
}
