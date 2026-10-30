/**
 * Faixa de sanidade do sync de vendas: [500, 1500] pra janela padrão de 90
 * dias; com período explícito (`desde`) escala pela mesma densidade/dia.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { faixaPlausivel } from "../scripts/sync-nbs/sync-vendas";

describe("faixaPlausivel", () => {
  it("sem desde: faixa original de 90 dias", () => {
    assert.deepEqual(faixaPlausivel(undefined), { min: 500, max: 1500 });
  });

  it("desde 90 dias atrás: mesma faixa", () => {
    assert.deepEqual(faixaPlausivel("2026-08-01", new Date("2026-10-30T00:00:00")), { min: 500, max: 1500 });
  });

  it("desde 01/01: escala proporcional (302 dias)", () => {
    assert.deepEqual(faixaPlausivel("2026-01-01", new Date("2026-10-30T00:00:00")), { min: 1677, max: 5034 });
  });
});
