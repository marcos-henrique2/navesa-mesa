/**
 * Testes do helper puro `calcularBonus`.
 *
 * Regra de negócio: bônus de fábrica embutido no custo.
 *   Bônus = Custo (valor_aquisicao) − Valor pra subir (valor_subir).
 *   Ex.: SDK4J01 — custo 155.000, valor pra subir 140.000 → bônus 15.000.
 *   Carros sem bônus: valor pra subir = custo → bônus 0 → retorna null.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calcularBonus } from "@/lib/repasses/bonus";

describe("calcularBonus", () => {
  it("custo > valor pra subir → bônus positivo (caso SDK4J01)", () => {
    assert.equal(calcularBonus({ valor_aquisicao: 155_000, valor_subir: 140_000 }), 15_000);
  });

  it("custo = valor pra subir → null (carro sem bônus)", () => {
    assert.equal(calcularBonus({ valor_aquisicao: 140_000, valor_subir: 140_000 }), null);
  });

  it("custo < valor pra subir → null (resultado negativo não é bônus)", () => {
    assert.equal(calcularBonus({ valor_aquisicao: 130_000, valor_subir: 140_000 }), null);
  });

  it("valor_aquisicao null → null", () => {
    assert.equal(calcularBonus({ valor_aquisicao: null, valor_subir: 140_000 }), null);
  });

  it("valor_subir null → null", () => {
    assert.equal(calcularBonus({ valor_aquisicao: 155_000, valor_subir: null }), null);
  });

  it("ambos null → null", () => {
    assert.equal(calcularBonus({ valor_aquisicao: null, valor_subir: null }), null);
  });

  it("bônus com centavos é preservado (não arredonda)", () => {
    assert.equal(calcularBonus({ valor_aquisicao: 155_000.5, valor_subir: 140_000 }), 15_000.5);
  });
});
