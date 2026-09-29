/**
 * Testes de ano_fabricacao/ano_modelo no sync Oracle -> Supabase.
 *
 * Por que existe:
 *   NBS.VEICULOS.ANO_MODELO é VARCHAR2 no formato "AA/AA" (ex: "12/13" =
 *   fabricação 2012, modelo 2013). O mapeador tratava isso como número
 *   direto (Number("12/13") -> NaN), deixando ano_fabricacao/ano_modelo
 *   SEMPRE null, silenciosamente (achado do Quinn/QA). parseAnoModelo()
 *   reaproveita a mesma regra de pivot de século já validada no parser de
 *   XLSX de vendas.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseAnoModelo } from "@/lib/parsers/ano-modelo";
import { mapearVeiculo } from "../scripts/sync-nbs/mapear-veiculo";
import { mapearVenda } from "../scripts/sync-nbs/mapear-venda";

describe('parseAnoModelo — formato NBS "AA/AA"', () => {
  it('"12/13" -> fabricação 2012, modelo 2013', () => {
    assert.deepEqual(parseAnoModelo("12/13"), { fab: 2012, mod: 2013 });
  });

  it('pivot de século: "55/56" -> 1955/1956 (yy >= 50)', () => {
    assert.deepEqual(parseAnoModelo("55/56"), { fab: 1955, mod: 1956 });
  });

  it('pivot de século: "49/50" -> 2049/1950', () => {
    assert.deepEqual(parseAnoModelo("49/50"), { fab: 2049, mod: 1950 });
  });

  it("formato numérico direto (sem barra) não é reconhecido -> null/null", () => {
    assert.deepEqual(parseAnoModelo(2012), { fab: null, mod: null });
  });

  it("null/undefined/vazio -> null/null", () => {
    assert.deepEqual(parseAnoModelo(null), { fab: null, mod: null });
    assert.deepEqual(parseAnoModelo(undefined), { fab: null, mod: null });
    assert.deepEqual(parseAnoModelo(""), { fab: null, mod: null });
  });
});

describe('mapearVeiculo — ano_fabricacao/ano_modelo via ANO_MODELO "AA/AA"', () => {
  it('row = { ANO_MODELO: "12/13" } resolve ano_fabricacao=2012, ano_modelo=2013', () => {
    const { veiculo, camposSemFonte } = mapearVeiculo({ ANO_MODELO: "12/13" });
    assert.equal(veiculo.ano_fabricacao, 2012);
    assert.equal(veiculo.ano_modelo, 2013);
    assert.ok(!camposSemFonte.includes("ano_fabricacao"));
    assert.ok(!camposSemFonte.includes("ano_modelo"));
  });

  it("sem ANO_MODELO na row, ano_fabricacao/ano_modelo ficam null e entram em camposSemFonte", () => {
    const { veiculo, camposSemFonte } = mapearVeiculo({});
    assert.equal(veiculo.ano_fabricacao, null);
    assert.equal(veiculo.ano_modelo, null);
    assert.ok(camposSemFonte.includes("ano_fabricacao"));
    assert.ok(camposSemFonte.includes("ano_modelo"));
  });
});

describe('mapearVenda — ano_fabricacao/ano_modelo via ANO_MODELO "AA/AA"', () => {
  it('row = { ANO_MODELO: "12/13" } resolve ano_fabricacao=2012, ano_modelo=2013', () => {
    const { venda, camposSemFonte } = mapearVenda({ ANO_MODELO: "12/13" });
    assert.equal(venda.ano_fabricacao, 2012);
    assert.equal(venda.ano_modelo, 2013);
    assert.ok(!camposSemFonte.includes("ano_fabricacao"));
    assert.ok(!camposSemFonte.includes("ano_modelo"));
  });

  it("sem ANO_MODELO na row, ano_fabricacao/ano_modelo ficam null e entram em camposSemFonte", () => {
    const { venda, camposSemFonte } = mapearVenda({});
    assert.equal(venda.ano_fabricacao, null);
    assert.equal(venda.ano_modelo, null);
    assert.ok(camposSemFonte.includes("ano_fabricacao"));
    assert.ok(camposSemFonte.includes("ano_modelo"));
  });
});
