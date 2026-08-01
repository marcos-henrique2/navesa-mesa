/**
 * Testes da camada pura do relatório "Carros em anúncio" (Story 1.2 + alertas 1.3).
 * Composição de item, filtros e alertas — sem Supabase.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calcularAlertas,
  filtrarAnuncio,
  montarItemAnuncio,
  montarRelatorioAnuncio,
  type CarroAnuncioInput,
} from "@/lib/repasses/relatorio-anuncio";

const HOJE = "2026-08-01";

function carro(over: Partial<CarroAnuncioInput> = {}): CarroAnuncioInput {
  return {
    id: 1,
    placa: "ABC1D23",
    modelo: "ONIX 1.0",
    marca: "CHEVROLET",
    ano_fabricacao: 2020,
    ano_modelo: 2021,
    km: 45_000,
    status: "subido",
    data_subiu: "2026-07-01",
    data_vendido: null,
    valor_minimo: 60_000,
    valor_compre_por: 68_000,
    valor_compra_repasse: 55_000,
    fipe: null,
    gastos: [1_000, 500],
    interessados: 0,
    ...over,
  };
}

describe("montarItemAnuncio", () => {
  it("carro completo: custo_real = compra + gastos, margens e cor verde", () => {
    const it = montarItemAnuncio(carro(), HOJE);
    assert.equal(it.custoReal, 56_500); // 55.000 + 1.000 + 500
    assert.equal(it.incompleto, false);
    assert.equal(it.cor, "verde"); // compre_por(68k) >= custo(56,5k)
    assert.equal(it.margemMinimoValor, 3_500); // 60.000 − 56.500
    assert.equal(it.margemComPorValor, 11_500); // 68.000 − 56.500
    assert.equal(it.diasNoRepasse, 31);
    assert.equal(it.anoLabel, "2020/2021");
  });

  it("% de margem sempre sobre custo_real", () => {
    const it = montarItemAnuncio(
      carro({ valor_compra_repasse: 100_000, gastos: [], valor_minimo: 110_000, valor_compre_por: 130_000 }),
      HOJE,
    );
    assert.equal(it.custoReal, 100_000);
    assert.equal(it.margemMinimoPct, 10);
    assert.equal(it.margemComPorPct, 30);
  });

  it("compre_por < custo → badge vermelho (anúncio no prejuízo)", () => {
    const it = montarItemAnuncio(
      carro({ valor_compra_repasse: 70_000, gastos: [], valor_minimo: 65_000, valor_compre_por: 60_000 }),
      HOJE,
    );
    assert.equal(it.cor, "vermelho");
  });

  it("incompleto (compra nula) → cor neutro, margens null, NÃO cai pra valor_aquisicao", () => {
    const it = montarItemAnuncio(carro({ valor_compra_repasse: null }), HOJE);
    assert.equal(it.incompleto, true);
    assert.equal(it.custoReal, null);
    assert.equal(it.cor, "neutro");
    assert.equal(it.margemMinimoValor, null);
    assert.equal(it.margemComPorValor, null);
    assert.equal(it.margemMinimoPct, null);
  });

  it("incompleto (minimo nulo) → neutro", () => {
    const it = montarItemAnuncio(carro({ valor_minimo: null }), HOJE);
    assert.equal(it.incompleto, true);
    assert.equal(it.cor, "neutro");
  });

  it("incompleto (compre_por nulo) → neutro", () => {
    const it = montarItemAnuncio(carro({ valor_compre_por: null }), HOJE);
    assert.equal(it.incompleto, true);
    assert.equal(it.cor, "neutro");
  });

  it("data_subiu nula → diasNoRepasse null", () => {
    const it = montarItemAnuncio(carro({ data_subiu: null }), HOJE);
    assert.equal(it.diasNoRepasse, null);
  });

  it("fipe ausente → null (UI mostra —)", () => {
    assert.equal(montarItemAnuncio(carro(), HOJE).fipe, null);
  });
});

describe("filtrarAnuncio", () => {
  const itens = montarRelatorioAnuncio(
    [
      carro({ id: 1, modelo: "ONIX 1.0", ano_modelo: 2021, ano_fabricacao: 2020, data_subiu: "2026-07-20" }), // 12 dias
      carro({ id: 2, modelo: "HB20 1.6", ano_modelo: 2019, ano_fabricacao: 2019, data_subiu: "2026-05-01" }), // 92 dias
      carro({ id: 3, modelo: "ONIX PLUS", ano_modelo: 2022, ano_fabricacao: 2021, data_subiu: null }), // sem dias
    ],
    HOJE,
  );

  it("diasMin exclui os abaixo do limite e os sem data", () => {
    const r = filtrarAnuncio(itens, { diasMin: 30 });
    assert.deepEqual(r.map((i) => i.id), [2]);
  });

  it("modelo é substring case-insensitive", () => {
    const r = filtrarAnuncio(itens, { modelo: "onix" });
    assert.deepEqual(r.map((i) => i.id), [1, 3]);
  });

  it("ano casa com fabricação OU modelo", () => {
    assert.deepEqual(filtrarAnuncio(itens, { ano: 2021 }).map((i) => i.id), [1, 3]);
    assert.deepEqual(filtrarAnuncio(itens, { ano: 2019 }).map((i) => i.id), [2]);
  });

  it("filtros combinados (AND)", () => {
    const r = filtrarAnuncio(itens, { modelo: "onix", ano: 2021 });
    assert.deepEqual(r.map((i) => i.id), [1, 3]);
  });

  it("sem filtro → tudo", () => {
    assert.equal(filtrarAnuncio(itens, {}).length, 3);
  });
});

describe("calcularAlertas", () => {
  const itens = montarRelatorioAnuncio(
    [
      // Saudável
      carro({ id: 1, valor_compra_repasse: 50_000, gastos: [], valor_minimo: 55_000, valor_compre_por: 60_000, data_subiu: "2026-07-25" }),
      // Prejuízo latente: minimo < custo (mas compre_por >= custo)
      carro({ id: 2, valor_compra_repasse: 70_000, gastos: [], valor_minimo: 65_000, valor_compre_por: 75_000, data_subiu: "2026-07-25" }),
      // Pior: compre_por < custo (anúncio no prejuízo) — tipo PMK6A00/SCM2G20
      carro({ id: 3, valor_compra_repasse: 80_000, gastos: [], valor_minimo: 70_000, valor_compre_por: 65_000, data_subiu: "2026-07-25" }),
      // Envelhecido (>60 dias) e completo saudável
      carro({ id: 4, valor_compra_repasse: 40_000, gastos: [], valor_minimo: 45_000, valor_compre_por: 50_000, data_subiu: "2026-05-01" }),
      // Incompleto → NÃO entra em prejuízo
      carro({ id: 5, valor_compra_repasse: null, valor_minimo: 10_000, valor_compre_por: 9_000, data_subiu: "2026-07-25" }),
    ],
    HOJE,
  );
  const a = calcularAlertas(itens);

  it("prejuízo latente = minimo < custo (inclui o do anúncio no prejuízo, exclui incompleto)", () => {
    assert.deepEqual(a.prejuizoLatente.map((i) => i.id).sort(), [2, 3]);
  });

  it("prejuízo no anúncio = compre_por < custo (os piores)", () => {
    assert.deepEqual(a.prejuizoNoAnuncio.map((i) => i.id), [3]);
  });

  it("envelhecimento = dias > 60", () => {
    assert.deepEqual(a.envelhecimento.map((i) => i.id), [4]);
  });

  it("incompleto nunca entra em prejuízo", () => {
    assert.ok(!a.prejuizoLatente.some((i) => i.id === 5));
    assert.ok(!a.prejuizoNoAnuncio.some((i) => i.id === 5));
  });
});
