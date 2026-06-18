/**
 * Testes do helper puro `estaReservado` — deriva "Reservado" do cod_proposta.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { estaReservado } from "@/lib/inventory/reservado";
import { veiculo } from "./_mocks";

describe("estaReservado", () => {
  it("retorna true quando cod_proposta tem código", () => {
    assert.equal(estaReservado(veiculo({ cod_proposta: "12345" })), true);
  });

  it("retorna false quando cod_proposta é null", () => {
    assert.equal(estaReservado(veiculo({ cod_proposta: null })), false);
  });

  it("default do mock (sem proposta) não é reservado", () => {
    assert.equal(estaReservado(veiculo()), false);
  });
});
