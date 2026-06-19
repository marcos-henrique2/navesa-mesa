/**
 * Testes do helper puro `calcularMargemReal`.
 *
 * Margem real = Valor vendido − Custo (valor_aquisicao). null se não vendido
 * ou se faltar valor_vendido / valor_aquisicao.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calcularMargemReal } from "@/lib/repasses/margem";

describe("calcularMargemReal", () => {
  it("vendido com margem positiva → valor vendido − custo", () => {
    assert.equal(
      calcularMargemReal({ status: "vendido", valor_vendido: 150_000, valor_aquisicao: 120_000 }),
      30_000,
    );
  });

  it("vendido com margem negativa → resultado negativo (prejuízo)", () => {
    assert.equal(
      calcularMargemReal({ status: "vendido", valor_vendido: 110_000, valor_aquisicao: 120_000 }),
      -10_000,
    );
  });

  it("não vendido → null", () => {
    assert.equal(
      calcularMargemReal({ status: "nao_vendido", valor_vendido: null, valor_aquisicao: 120_000 }),
      null,
    );
  });

  it("status subido (sem desfecho) → null mesmo com valores", () => {
    assert.equal(
      calcularMargemReal({ status: "subido", valor_vendido: 150_000, valor_aquisicao: 120_000 }),
      null,
    );
  });

  it("vendido sem valor_vendido → null", () => {
    assert.equal(
      calcularMargemReal({ status: "vendido", valor_vendido: null, valor_aquisicao: 120_000 }),
      null,
    );
  });

  it("vendido sem valor_aquisicao → null", () => {
    assert.equal(
      calcularMargemReal({ status: "vendido", valor_vendido: 150_000, valor_aquisicao: null }),
      null,
    );
  });

  it("margem com centavos é preservada (centavo-perfect)", () => {
    assert.equal(
      calcularMargemReal({ status: "vendido", valor_vendido: 150_000.5, valor_aquisicao: 120_000.25 }),
      30_000.25,
    );
  });
});
