/**
 * Testes dos cálculos financeiros de Repasses (funções puras).
 *
 * Cobre:
 *   - calcularTotalGastos: vazio, 1 item, vários, decimais com round
 *   - calcularCustoTotal: sem aquisição vira null; com aquisição soma certo
 *   - calcularMargemReal: sem venda → null; com venda → R$; margem negativa
 *   - calcularMargemPct: divisão por zero → null; valor correto
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calcularTotalGastos,
  calcularCustoTotal,
  calcularMargemReal,
  calcularMargemPct,
} from "@/lib/repasses/calc";
import type { Repasse, RepasseGasto } from "@/lib/repasses/types";

function gasto(valor: number): RepasseGasto {
  return {
    id: 0,
    repasse_id: 0,
    tipo: "outro",
    descricao: "x",
    valor,
    data: "2026-01-01",
    observacao: null,
    criado_em: "",
  };
}

function repasse(over: Partial<Repasse> = {}): Repasse {
  return {
    id: 1,
    chassi: "X",
    placa: "AAA1234",
    modelo: "Y",
    marca: null,
    cor: null,
    ano_modelo: null,
    ano_fabricacao: null,
    km: null,
    loja_origem: null,
    patio_origem: null,
    valor_aquisicao: null,
    valor_subiu: null,
    valor_minimo: null,
    valor_vendido: null,
    data_subiu: "2026-01-01",
    data_vendido: null,
    canal: "auto_avaliar",
    status: "subido",
    documentacao_status: "pendente",
    descricao: null,
    opcionais: null,
    comprador: null,
    observacoes: null,
    criado_em: "",
    atualizado_em: "",
    ...over,
  };
}

describe("calcularTotalGastos", () => {
  it("retorna 0 quando não há gastos", () => {
    assert.equal(calcularTotalGastos([]), 0);
  });

  it("soma um gasto único", () => {
    assert.equal(calcularTotalGastos([gasto(150.5)]), 150.5);
  });

  it("soma vários gastos", () => {
    assert.equal(
      calcularTotalGastos([gasto(100), gasto(50.25), gasto(25.75)]),
      176,
    );
  });

  it("arredonda pra centavos sem float bug", () => {
    // 0.1 + 0.2 em JS = 0.30000000000000004
    assert.equal(calcularTotalGastos([gasto(0.1), gasto(0.2)]), 0.3);
  });
});

describe("calcularCustoTotal", () => {
  it("retorna null quando valor_aquisicao é null", () => {
    assert.equal(calcularCustoTotal(repasse({ valor_aquisicao: null }), []), null);
  });

  it("aquisicao + gastos quando ambos presentes", () => {
    const r = repasse({ valor_aquisicao: 50000 });
    assert.equal(calcularCustoTotal(r, [gasto(1500), gasto(800)]), 52300);
  });

  it("aquisicao sem gastos = aquisicao", () => {
    const r = repasse({ valor_aquisicao: 50000 });
    assert.equal(calcularCustoTotal(r, []), 50000);
  });
});

describe("calcularMargemReal", () => {
  it("retorna null quando não há valor_vendido", () => {
    const r = repasse({ valor_aquisicao: 50000, valor_vendido: null });
    assert.equal(calcularMargemReal(r, []), null);
  });

  it("retorna null quando falta valor_aquisicao (custo não computável)", () => {
    const r = repasse({ valor_aquisicao: null, valor_vendido: 60000 });
    assert.equal(calcularMargemReal(r, []), null);
  });

  it("calcula margem positiva (lucro)", () => {
    const r = repasse({ valor_aquisicao: 50000, valor_vendido: 60000 });
    assert.equal(calcularMargemReal(r, [gasto(2000)]), 8000);
  });

  it("calcula margem negativa (prejuízo)", () => {
    const r = repasse({ valor_aquisicao: 50000, valor_vendido: 48000 });
    assert.equal(calcularMargemReal(r, [gasto(1000)]), -3000);
  });
});

describe("calcularMargemPct", () => {
  it("retorna null quando valor_vendido = 0 (divisão por zero)", () => {
    const r = repasse({ valor_aquisicao: 50000, valor_vendido: 0 });
    assert.equal(calcularMargemPct(r, []), null);
  });

  it("retorna null quando valor_vendido é null", () => {
    const r = repasse({ valor_aquisicao: 50000, valor_vendido: null });
    assert.equal(calcularMargemPct(r, []), null);
  });

  it("calcula percentual sobre valor vendido", () => {
    const r = repasse({ valor_aquisicao: 50000, valor_vendido: 60000 });
    // (60000 - (50000 + 2000)) / 60000 * 100 = 8000/60000*100 ≈ 13.33%
    const pct = calcularMargemPct(r, [gasto(2000)]);
    assert.ok(pct != null);
    assert.equal(pct, 13.33);
  });

  it("retorna percentual negativo em prejuízo", () => {
    const r = repasse({ valor_aquisicao: 50000, valor_vendido: 48000 });
    const pct = calcularMargemPct(r, [gasto(1000)]);
    assert.ok(pct != null);
    assert.equal(pct, -6.25);
  });
});
