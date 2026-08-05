/**
 * KPI "Margem real" do /repasses — `resumirMargemReal` (src/lib/repasses/kpis.ts).
 *
 * O KPI precisa separar TRÊS coisas que antes viravam o mesmo "R$ 0,00 em verde":
 *   1. não há dado    (nenhum vendido com valor_compra_repasse)  → traço, neutro
 *   2. dado parcial   (parte dos vendidos tem custo)             → alerta
 *   3. dado completo  (todos têm)                                → verde/vermelho
 *
 * Mais o estado 0: a query de repasse_gastos falhou. Aí o custo_real fica sem o
 * Σ gastos e a margem sairia SUPERESTIMADA — indisponível, nunca otimista.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resumirMargemReal } from "@/lib/repasses/kpis";

describe("resumirMargemReal — gastos indisponíveis", () => {
  it("query de gastos falhou → total null mesmo com todos os custos presentes", () => {
    const r = resumirMargemReal([3_700, 1_200, -500], false);
    assert.equal(r.estado, "gastos_indisponiveis");
    assert.equal(r.total, null, "margem sem Σ gastos sairia maior do que é");
    assert.equal(r.vendidos, 3);
    assert.match(r.hint, /falha ao carregar os gastos/);
  });

  it("query falhou e não há venda nenhuma → ainda indisponível", () => {
    const r = resumirMargemReal([], false);
    assert.equal(r.estado, "gastos_indisponiveis");
    assert.equal(r.total, null);
  });
});

describe("resumirMargemReal — sem custo de repasse (produção hoje: 0 de 16)", () => {
  it("nenhum vendido com custo → traço, não R$ 0,00", () => {
    const r = resumirMargemReal(Array(16).fill(null), true);
    assert.equal(r.estado, "sem_custo");
    assert.equal(r.total, null);
    assert.equal(r.comCusto, 0);
    assert.equal(r.vendidos, 16);
    assert.equal(r.hint, "sem custo de repasse em 16 vendidos");
  });

  it("hint no singular com 1 vendido", () => {
    const r = resumirMargemReal([null], true);
    assert.equal(r.hint, "sem custo de repasse em 1 vendido");
  });

  it("sem venda nenhuma → sem_vendas (distinto de sem_custo)", () => {
    const r = resumirMargemReal([], true);
    assert.equal(r.estado, "sem_vendas");
    assert.equal(r.total, null);
    assert.equal(r.hint, "nenhuma venda no recorte");
  });
});

describe("resumirMargemReal — parcial", () => {
  it("soma só os computáveis e avisa o denominador na frase", () => {
    const r = resumirMargemReal([3_700, null, 1_300, null], true);
    assert.equal(r.estado, "parcial");
    assert.equal(r.total, 5_000);
    assert.equal(r.comCusto, 2);
    assert.equal(r.vendidos, 4);
    assert.equal(r.hint, "parcial — só 2 de 4 vendidos têm custo de repasse");
  });

  it("parcial negativo mantém o total negativo (prejuízo do subconjunto)", () => {
    const r = resumirMargemReal([-8_000, null, 1_000], true);
    assert.equal(r.estado, "parcial");
    assert.equal(r.total, -7_000);
  });
});

describe("resumirMargemReal — completo", () => {
  it("todos com custo → total somado e hint sem ressalva", () => {
    const r = resumirMargemReal([3_700, 1_300, -500], true);
    assert.equal(r.estado, "completo");
    assert.equal(r.total, 4_500);
    assert.equal(r.comCusto, 3);
    assert.equal(r.hint, "3 vendidos com custo de repasse");
  });

  it("total zero com dado completo é margem zero de verdade (não é ausência)", () => {
    const r = resumirMargemReal([2_000, -2_000], true);
    assert.equal(r.estado, "completo");
    assert.equal(r.total, 0);
  });

  it("centavo-perfect: soma de margens fracionadas não drifta", () => {
    const r = resumirMargemReal([0.1, 0.2, 3_699.45], true);
    assert.equal(r.total, 3_699.75);
  });
});
