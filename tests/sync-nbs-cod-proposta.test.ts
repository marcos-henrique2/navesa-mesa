/**
 * Testes de cod_proposta no sync Oracle -> Supabase.
 *
 * Por que existe:
 *   Bug de produção (26/09/2026): a primeira gravação real marcou quase todo
 *   veículo em estoque como RESERVADO. Causa raiz: CANDIDATOS.cod_proposta
 *   misturava COD_PROPOSTA_INTERNET (a coluna certa — mesma semântica do
 *   XLSX original) com COD_PROPOSTA (campo DIFERENTE, que usa "0" como valor
 *   vazio em vez de NULL). Como COD_PROPOSTA_INTERNET é NULL pra maioria dos
 *   veículos, achaColuna() caía pro COD_PROPOSTA, e asStr(0) -> "0" passava
 *   em estaReservado() (`!= null`). Ver mapear-veiculo.ts.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapearVeiculo } from "../scripts/sync-nbs/mapear-veiculo";

describe("mapearVeiculo — cod_proposta via COD_PROPOSTA_INTERNET", () => {
  it("COD_PROPOSTA_INTERNET: null -> cod_proposta: null (não reservado)", () => {
    const { veiculo } = mapearVeiculo({ COD_PROPOSTA_INTERNET: null });
    assert.equal(veiculo.cod_proposta, null);
  });

  it("COD_PROPOSTA_INTERNET: 0 -> cod_proposta: null (não reservado)", () => {
    const { veiculo } = mapearVeiculo({ COD_PROPOSTA_INTERNET: 0 });
    assert.equal(veiculo.cod_proposta, null);
  });

  it("COD_PROPOSTA_INTERNET: 260234179 -> cod_proposta: \"260234179\" (reservado)", () => {
    const { veiculo } = mapearVeiculo({ COD_PROPOSTA_INTERNET: 260234179 });
    assert.equal(veiculo.cod_proposta, "260234179");
  });

  it("COD_PROPOSTA (campo diferente) é ignorado — não deve ser usado como fallback", () => {
    const { veiculo } = mapearVeiculo({ COD_PROPOSTA_INTERNET: null, COD_PROPOSTA: 0 });
    assert.equal(veiculo.cod_proposta, null);
  });
});
