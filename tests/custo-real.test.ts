/**
 * Testes de `calcularCustoReal` — fórmula ÚNICA compartilhada entre o
 * Relatório de Estoque Customizado (coluna `custo_real`) e o Vendas Usados
 * Matriz (`calcularDerivadosLinha`, campo `custoReal`). Ver colunas-estoque.ts
 * e vendas-matriz/tipos.ts — ambos chamam esta mesma função.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calcularCustoReal } from "@/lib/export/custo-real";

describe("calcularCustoReal", () => {
  it("nfEntrada e valoriza presentes: Entrada − Valoriza", () => {
    assert.equal(calcularCustoReal(90000, 1000), 89000);
  });

  it("valoriza null: trata como 0 (não propaga null)", () => {
    assert.equal(calcularCustoReal(90000, null), 90000);
  });

  it("valoriza 0: resultado é o próprio nfEntrada", () => {
    assert.equal(calcularCustoReal(90000, 0), 90000);
  });

  it("nfEntrada null: retorna null (custo real sem base de entrada não tem sentido)", () => {
    assert.equal(calcularCustoReal(null, 1000), null);
    assert.equal(calcularCustoReal(null, null), null);
  });

  it("mantém centavos crus (sem arredondamento)", () => {
    assert.equal(calcularCustoReal(120000.25, 0.1), 120000.15);
  });
});
