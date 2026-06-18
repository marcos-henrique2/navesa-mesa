/**
 * Testes da busca por placa (helper puro `placaCasa`) e do KPI "Valor pra subir"
 * (`calcularValorPraSubir`) do /repasses.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { placaCasa } from "@/lib/utils/placa";
import { calcularValorPraSubir } from "@/lib/repasses/kpis";
import { repasse } from "./_mocks";

describe("placaCasa — busca tolerante a hífen/espaço/case", () => {
  it("acha 'QKF-2016' buscando 'QKF2016' (sem hífen do lado da busca)", () => {
    assert.equal(placaCasa("QKF-2016", "QKF2016"), true);
  });

  it("acha parcial e case-insensitive: 'qkf' casa com 'QKF-2016'", () => {
    assert.equal(placaCasa("QKF-2016", "qkf"), true);
  });

  it("acha buscando com hífen quando a placa não tem: 'QKF-2016' casa 'QKF2016'", () => {
    assert.equal(placaCasa("QKF2016", "QKF-2016"), true);
    assert.equal(placaCasa("QKF2016", "qkf 2016"), true);
  });

  it("termo vazio casa com tudo (filtro inativo); não-match retorna false", () => {
    assert.equal(placaCasa("QKF-2016", ""), true);
    assert.equal(placaCasa("QKF-2016", "   "), true);
    assert.equal(placaCasa("QKF-2016", "XYZ"), false);
    assert.equal(placaCasa(null, "qkf"), false);
  });
});

describe("calcularValorPraSubir — KPI soma valor_subir dos subidos", () => {
  it("soma só os 'subido' com valor preenchido e conta preenchidos", () => {
    const lista = [
      repasse({ id: 1, status: "subido", valor_subir: 100000 }),
      repasse({ id: 2, status: "subido", valor_subir: 50000 }),
      repasse({ id: 3, status: "subido", valor_subir: null }),
      repasse({ id: 4, status: "marcado", valor_subir: 999999 }), // ignorado
    ];
    const kpi = calcularValorPraSubir(lista);
    assert.equal(kpi.total, 150000);
    assert.equal(kpi.comValor, 2);
    assert.equal(kpi.totalSubidos, 3);
  });

  it("nenhum preenchido → total 0 e contador 0 de N", () => {
    const lista = [
      repasse({ id: 1, status: "subido", valor_subir: null }),
      repasse({ id: 2, status: "subido", valor_subir: null }),
    ];
    const kpi = calcularValorPraSubir(lista);
    assert.equal(kpi.total, 0);
    assert.equal(kpi.comValor, 0);
    assert.equal(kpi.totalSubidos, 2);
  });

  it("lista vazia → tudo zero", () => {
    const kpi = calcularValorPraSubir([]);
    assert.deepEqual(kpi, { total: 0, comValor: 0, totalSubidos: 0 });
  });
});
