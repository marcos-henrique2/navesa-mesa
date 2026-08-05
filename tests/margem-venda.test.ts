/**
 * Margem REAL do repasse vendido — `src/lib/repasses/margem-venda.ts`.
 *
 * REGRA DE OURO: custo_real = valor_compra_repasse + Σ repasse_gastos.
 * `valor_aquisicao` é custo de VAREJO (NBS) e NUNCA entra na margem de repasse.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calcularCustoRealRepasse,
  calcularMargemVenda,
  classificarMargemVenda,
} from "@/lib/repasses/margem-venda";
import { repasse } from "./_mocks";

describe("calcularMargemVenda", () => {
  it("com gastos: desconta compra de repasse + todos os gastos", () => {
    const r = repasse({
      status: "vendido",
      valor_vendido: 98_000,
      valor_compra_repasse: 92_000,
      valor_aquisicao: 120_000,
    });
    // custo_real = 92.000 + 1.500 + 800 = 94.300 → margem = 3.700
    assert.equal(calcularCustoRealRepasse(r, [1_500, 800]), 94_300);
    assert.equal(calcularMargemVenda(r, [1_500, 800]), 3_700);
  });

  it("sem gastos: custo_real é o próprio valor_compra_repasse", () => {
    const r = repasse({
      status: "vendido",
      valor_vendido: 98_000,
      valor_compra_repasse: 92_000,
      valor_aquisicao: 120_000,
    });
    assert.equal(calcularCustoRealRepasse(r, []), 92_000);
    assert.equal(calcularMargemVenda(r), 6_000);
  });

  it("gastos nulos/inválidos contam como zero (não invalidam a margem)", () => {
    const r = repasse({ status: "vendido", valor_vendido: 98_000, valor_compra_repasse: 92_000 });
    assert.equal(calcularMargemVenda(r, [null, 1_000, undefined]), 5_000);
  });

  it("DIVERGÊNCIA: a fórmula antiga (valor_aquisicao) marcava prejuízo onde há lucro", () => {
    const r = repasse({
      status: "vendido",
      valor_vendido: 98_000,
      valor_aquisicao: 120_000, // custo de VAREJO — fórmula antiga usava isto
      valor_compra_repasse: 92_000,
    });
    const gastos = [1_500, 800];

    const antiga = r.valor_vendido! - r.valor_aquisicao!; // −22.000 (falso prejuízo)
    const nova = calcularMargemVenda(r, gastos); // +3.700 (lucro real)

    assert.equal(antiga, -22_000);
    assert.equal(nova, 3_700);
    assert.ok(antiga < 0 && nova! > 0, "antiga acusa prejuízo, nova mostra lucro");
    assert.equal(nova! - antiga, 25_700); // erro embutido na fórmula antiga
  });

  it("centavo-perfect: soma de gastos com centavos não drifta", () => {
    const r = repasse({
      status: "vendido",
      valor_vendido: 98_000.05,
      valor_compra_repasse: 92_000.1,
    });
    assert.equal(calcularCustoRealRepasse(r, [1_500.2, 800.3]), 94_300.6);
    assert.equal(calcularMargemVenda(r, [1_500.2, 800.3]), 3_699.45);
  });

  it("sem valor_compra_repasse → null (NUNCA cai pra valor_aquisicao)", () => {
    const r = repasse({
      status: "vendido",
      valor_vendido: 98_000,
      valor_aquisicao: 120_000,
      valor_compra_repasse: null,
    });
    assert.equal(calcularCustoRealRepasse(r, [1_500]), null);
    assert.equal(calcularMargemVenda(r, [1_500]), null);
  });

  it("não vendido → null mesmo com todos os valores", () => {
    const r = repasse({
      status: "nao_vendido",
      valor_vendido: 98_000,
      valor_compra_repasse: 92_000,
    });
    assert.equal(calcularMargemVenda(r), null);
  });

  it("status subido (sem desfecho) → null", () => {
    const r = repasse({ status: "subido", valor_vendido: 98_000, valor_compra_repasse: 92_000 });
    assert.equal(calcularMargemVenda(r), null);
  });

  it("vendido sem valor_vendido → null", () => {
    const r = repasse({ status: "vendido", valor_vendido: null, valor_compra_repasse: 92_000 });
    assert.equal(calcularMargemVenda(r), null);
  });

  it("margem negativa real (venda abaixo do custo de repasse)", () => {
    const r = repasse({ status: "vendido", valor_vendido: 90_000, valor_compra_repasse: 92_000 });
    assert.equal(calcularMargemVenda(r, [1_000]), -3_000);
  });
});

describe("classificarMargemVenda", () => {
  /** custo_real = 92.000 + 1.500 + 800 = 94.300; mínimo 95.000; compre-por 99.000. */
  const gastos = [1_500, 800];
  const base = { valor_compra_repasse: 92_000, valor_minimo: 95_000, valor_compre_por: 99_000 };

  it("venda abaixo do custo_real → vermelho (prejuízo)", () => {
    const r = repasse({ ...base, status: "vendido", valor_vendido: 93_000 });
    assert.equal(classificarMargemVenda(r, gastos).cor, "vermelho");
  });

  it("venda acima do custo mas abaixo do mínimo → laranja", () => {
    const r = repasse({ ...base, status: "vendido", valor_vendido: 94_500 });
    assert.equal(classificarMargemVenda(r, gastos).cor, "laranja");
  });

  it("venda entre mínimo e compre-por → amarelo", () => {
    const r = repasse({ ...base, status: "vendido", valor_vendido: 98_000 });
    assert.equal(classificarMargemVenda(r, gastos).cor, "amarelo");
  });

  it("venda no compre-por ou acima → verde", () => {
    const r = repasse({ ...base, status: "vendido", valor_vendido: 99_500 });
    assert.equal(classificarMargemVenda(r, gastos).cor, "verde");
  });

  it("dados incompletos → neutro e completo=false", () => {
    const r = repasse({
      status: "vendido",
      valor_vendido: 98_000,
      valor_aquisicao: 120_000,
      valor_compra_repasse: null,
      valor_minimo: 95_000,
      valor_compre_por: 99_000,
    });
    assert.deepEqual(classificarMargemVenda(r, gastos), { cor: "neutro", completo: false });
  });

  it("não vendido → neutro (sem desfecho, sem cor)", () => {
    const r = repasse({ ...base, status: "subido", valor_vendido: null });
    assert.deepEqual(classificarMargemVenda(r, gastos), { cor: "neutro", completo: false });
  });
});
