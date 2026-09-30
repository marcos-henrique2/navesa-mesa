/**
 * Teste de regressão do bug empresa_nome != cod_empresa em vendas de
 * repasse.
 *
 * Por que existe:
 *   cod_empresa (mapear-venda.ts) já resolvia via COD_EMPRESA_VENDEDORA —
 *   a loja que efetivamente vendeu o carro. Mas o JOIN de NBS.EMPRESAS em
 *   sync-vendas.ts usava COALESCE(COD_EMPRESA_ATUAL, COD_EMPRESA) — a loja
 *   de ORIGEM/estoque do veículo — pra preencher JOIN_EMPRESA_NOME. Em
 *   vendas de repasse (carro pertencia a uma loja, foi vendido por outra —
 *   43,4% de uma amostra de 1057 vendas/90 dias), cod_empresa mostrava a
 *   loja vendedora certa enquanto empresa_nome mostrava o nome da loja de
 *   origem, errado.
 *
 *   Corrigido trocando a chave do JOIN pra COD_EMPRESA_VENDEDORA (mesma
 *   coluna que já alimenta cod_empresa). Validado contra o Oracle real nas
 *   3 placas abaixo (SDL8B82, SDK2B96, RCI3H10) — todas repasse pra loja 2
 *   (NAVESA FORD AEROPORTO), origem em lojas diferentes (86-GWM,
 *   26-Anápolis, 82-GAC).
 *
 *   mapearVenda() é só o mapeamento row->VendaParsed — não roda a query SQL
 *   em si (isso é sync-vendas.ts, só exercitável contra o Oracle real). O
 *   que dá pra testar aqui, sem Oracle, é o contrato: cod_empresa e
 *   empresa_nome devem vir da MESMA coluna/JOIN (COD_EMPRESA_VENDEDORA),
 *   nunca de COD_EMPRESA_ATUAL/COD_EMPRESA (loja de origem).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapearVenda } from "../scripts/sync-nbs/mapear-venda";

describe("mapearVenda — cod_empresa/empresa_nome consistentes (bug de repasse)", () => {
  it("caso real SDL8B82: cod_empresa e empresa_nome resolvem pra loja vendedora (2), não pra origem (86)", () => {
    const { venda } = mapearVenda({
      PLACA_USADO: "SDL8B82",
      COD_EMPRESA: 86,
      COD_EMPRESA_ATUAL: 0,
      COD_EMPRESA_VENDEDORA: 2,
      // Simula o resultado do LEFT JOIN em NBS.EMPRESAS por
      // COD_EMPRESA_VENDEDORA (ver SQL_SELECT_VENDAS em sync-vendas.ts) —
      // nome real confirmado contra o Oracle.
      JOIN_EMPRESA_NOME: "02 NAVESA FORD AEROPORTO",
    });
    assert.equal(venda.cod_empresa, 2);
    assert.equal(venda.empresa_nome, "02 NAVESA FORD AEROPORTO");
  });

  it("cod_empresa usa COD_EMPRESA_VENDEDORA mesmo quando difere da loja de origem (COD_EMPRESA_ATUAL/COD_EMPRESA)", () => {
    const { venda } = mapearVenda({
      COD_EMPRESA: 82,
      COD_EMPRESA_ATUAL: 0,
      COD_EMPRESA_VENDEDORA: 2,
      JOIN_EMPRESA_NOME: "02 NAVESA FORD AEROPORTO",
    });
    assert.equal(venda.cod_empresa, 2);
    assert.notEqual(venda.cod_empresa, 82);
  });

  it("empresa_nome nunca cai pro nome da loja de origem quando JOIN_EMPRESA_NOME (loja vendedora) está presente", () => {
    const { venda } = mapearVenda({
      COD_EMPRESA: 26,
      COD_EMPRESA_ATUAL: 0,
      COD_EMPRESA_VENDEDORA: 2,
      JOIN_EMPRESA_NOME: "02 NAVESA FORD AEROPORTO",
      // Coluna hipotética de fallback (não usada quando JOIN_EMPRESA_NOME existe).
      NOME_EMPRESA: "26 NAVESA FORD ANAPOLIS",
    });
    assert.equal(venda.empresa_nome, "02 NAVESA FORD AEROPORTO");
    assert.notEqual(venda.empresa_nome, "26 NAVESA FORD ANAPOLIS");
  });
});
