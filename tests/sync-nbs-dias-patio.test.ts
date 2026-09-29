/**
 * Testes de dias_patio no sync Oracle -> Supabase.
 *
 * Por que existe:
 *   A tela de estoque do navesa-mesa mostrava "Dias pátio" sempre em branco.
 *   Causa raiz: CANDIDATOS.dias_patio tentava as colunas DIAS_PATIO/DPT, que
 *   não existem em NBS.VEICULOS (confirmado via ALL_TAB_COLUMNS) — existiam
 *   só no Excel manual antigo, como valor pré-calculado pelo NBS. Definição
 *   de negócio confirmada com o Marcos: dias de pátio = dias desde que o
 *   carro entrou em qualquer loja = hoje - DATA_ENTRADA. Ver mapear-veiculo.ts.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapearVeiculo } from "../scripts/sync-nbs/mapear-veiculo";

describe("mapearVeiculo — dias_patio derivado de DATA_ENTRADA", () => {
  it("DATA_ENTRADA X dias atrás -> dias_patio = X", () => {
    const dias = 10;
    const dataEntrada = new Date(Date.now() - dias * 86_400_000);
    const { veiculo } = mapearVeiculo({ DATA_ENTRADA: dataEntrada });
    assert.equal(veiculo.dias_patio, dias);
  });

  it("DATA_ENTRADA null -> dias_patio null (não dá pra calcular)", () => {
    const { veiculo } = mapearVeiculo({ DATA_ENTRADA: null });
    assert.equal(veiculo.dias_patio, null);
  });

  it("DIAS_PATIO/DPT na row são ignorados — coluna não existe em NBS.VEICULOS", () => {
    const dias = 5;
    const dataEntrada = new Date(Date.now() - dias * 86_400_000);
    const { veiculo } = mapearVeiculo({ DATA_ENTRADA: dataEntrada, DIAS_PATIO: 999, DPT: 999 });
    assert.equal(veiculo.dias_patio, dias);
  });
});
