/**
 * Testes de `consignado` (flag "venda de veículo consignado") no sync
 * Oracle -> Supabase.
 *
 * Por que existe:
 *   O relatório "Vendas Usados Matriz" (PR #25) distingue, no original feito
 *   à mão pelo Marcos, "COM CONSIGNADOS" vs "SEM CONSIGNADOS" em alguns
 *   blocos de resumo. A tabela `vendas` não guardava esse dado — só era
 *   usado como FILTRO (não como valor) no sync de ESTOQUE
 *   (NBS.VEICULOS.CONSIGNATO = 'N' em FILTRO_ESTOQUE, sync-veiculos.ts).
 *
 *   Fonte: NBS.VEICULOS.CONSIGNATO ('S'/'N'), coluna direta — já vem de
 *   graça no `v.*` de SQL_SELECT_VENDAS (sync-vendas.ts), sem precisar de
 *   JOIN nem de entrada nova no SELECT. mapearVenda() é só o mapeamento
 *   row->VendaParsed — não roda a query SQL em si (isso é sync-vendas.ts, só
 *   exercitável contra o Oracle real).
 *
 *   ACHADO IMPORTANTE (validado contra o Oracle real em 02/10/2026, 1.085
 *   vendas/90d 'U' + 23 vendas/90d 'C', total 1.108): vendas de consignado
 *   usam NOVO_USADO='C' em NBS.VEICULOS, não 'U' — separação limpa
 *   confirmada (0 sobreposição). @aria-architect avaliou e aprovou expandir
 *   FILTRO_VENDAS pra NOVO_USADO IN ('U','C') (ver sync-vendas.ts) — agora
 *   `consignado` vem `true` pra vendas de verdade sincronizadas, não só em
 *   teoria. Os testes abaixo cobrem o CONTRATO do mapeamento em si
 *   (CONSIGNATO='S'/'N' -> boolean), que não mudou com a expansão do filtro.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapearVenda } from "../scripts/sync-nbs/mapear-venda";

describe("mapearVenda — consignado (NBS.VEICULOS.CONSIGNATO)", () => {
  it("CONSIGNATO='S' -> consignado true", () => {
    const { venda } = mapearVenda({ CONSIGNATO: "S" });
    assert.equal(venda.consignado, true);
  });

  it("CONSIGNATO='N' -> consignado false", () => {
    const { venda } = mapearVenda({ CONSIGNATO: "N" });
    assert.equal(venda.consignado, false);
  });

  it("CONSIGNATO ausente -> consignado false (fato conhecido, não 'não sabemos') e reportado em camposSemFonte", () => {
    const { venda, camposSemFonte } = mapearVenda({});
    assert.equal(venda.consignado, false);
    assert.ok(camposSemFonte.includes("consignado"));
  });

  it("consignado nunca é null, mesmo sem CONSIGNATO na row", () => {
    const { venda } = mapearVenda({ PLACA_USADO: "ABC1D23" });
    assert.notEqual(venda.consignado, null);
    assert.equal(typeof venda.consignado, "boolean");
  });

  it("mapearVenda não derruba JOINs/outros campos ao processar CONSIGNATO junto (regressão de integração)", () => {
    const { venda } = mapearVenda({
      PLACA_USADO: "SDL8B82",
      COD_EMPRESA: 86,
      COD_EMPRESA_ATUAL: 0,
      COD_EMPRESA_VENDEDORA: 2,
      JOIN_EMPRESA_NOME: "02 NAVESA FORD AEROPORTO",
      CONSIGNATO: "N",
    });
    assert.equal(venda.cod_empresa, 2);
    assert.equal(venda.empresa_nome, "02 NAVESA FORD AEROPORTO");
    assert.equal(venda.consignado, false);
  });
});
