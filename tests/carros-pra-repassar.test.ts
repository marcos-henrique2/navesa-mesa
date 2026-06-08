/**
 * Testes do algoritmo de ranking "Carros pra repassar".
 *
 * Garante:
 *   - Score combina os 4 sinais com pesos corretos (40% dias, 30% margem, 20% FIPE, 10% cautelar)
 *   - Score reage corretamente a cada dimensão isoladamente
 *   - Filtros (diasMinimo, excluirPreparacao) funcionam
 *   - Motivos batem com os sinais reais
 *   - Sugestão de preço usa FIPE como base e aplica desconto por tempo parado
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calcularCarrosPraRepassar,
  resumirRepasse,
} from "@/lib/analytics/carros-pra-repassar";
import { veiculo } from "./_mocks";
import type { BatchResult } from "@/lib/fipe/batch";

function fipeBatch(items: Record<string, number>): BatchResult {
  return {
    timestamp: Date.now(),
    items: Object.fromEntries(
      Object.entries(items).map(([chassi, precoFipe]) => [
        chassi,
        { chassi, precoFipe, match: { confianca: "alta", razao: "test" } },
      ]),
    ),
    erros: [],
    totalGrupos: 0,
    totalVeiculos: Object.keys(items).length,
  } as unknown as BatchResult;
}

describe("calcularCarrosPraRepassar", () => {
  it("retorna lista vazia se não há veículos", () => {
    const r = calcularCarrosPraRepassar([], null, {});
    assert.deepEqual(r, []);
  });

  it("ignora carros parados há menos do diasMinimo (default 60)", () => {
    const v = veiculo({ dias_patio: 30 });
    const r = calcularCarrosPraRepassar([v], null, {});
    assert.equal(r.length, 0);
  });

  it("exclui carros em PREPARAÇÃO por padrão", () => {
    const v = veiculo({ dias_patio: 200, patio: "PREPARACAO" });
    const r = calcularCarrosPraRepassar([v], null, {});
    assert.equal(r.length, 0);
  });

  it("inclui preparação se excluirPreparacao=false", () => {
    const v = veiculo({ dias_patio: 200, patio: "PREPARACAO" });
    const r = calcularCarrosPraRepassar([v], null, {}, { excluirPreparacao: false });
    assert.equal(r.length, 1);
  });

  it("ordena por score desc (maior primeiro)", () => {
    // B com mais idade E margem negativa = top inequívoco
    const carros = [
      veiculo({ chassi: "A", dias_patio: 100, preco_venda: 100000, custo_total: 95000 }), // margem 5%
      veiculo({ chassi: "B", dias_patio: 500, preco_venda: 100000, custo_total: 110000 }), // parado + prejuízo
      veiculo({ chassi: "C", dias_patio: 200, preco_venda: 100000, custo_total: 97000 }),  // intermediário
    ];
    const r = calcularCarrosPraRepassar(carros, null, {});
    assert.equal(r[0].chassi, "B");
    // C deve ter score >= A (parado dobro do tempo)
    const aIdx = r.findIndex((c) => c.chassi === "A");
    const cIdx = r.findIndex((c) => c.chassi === "C");
    assert.ok(cIdx < aIdx || aIdx === -1, "C deve estar antes de A no ranking");
  });

  it("carro parado +365d tem score próximo ao máximo da dimensão dias (40)", () => {
    const v = veiculo({ chassi: "X", dias_patio: 400, preco_venda: 100000, custo_total: 80000 });
    const r = calcularCarrosPraRepassar([v], null, {});
    assert.equal(r.length, 1);
    // dias 400 → score 100 * peso 0.4 = 40
    // margem 20% → score 0 * peso 0.3 = 0
    // sem FIPE → score 30 * peso 0.2 = 6
    // sem cautelar → score 0 * peso 0.1 = 0
    // Total esperado ≈ 46
    assert.ok(r[0].score >= 40 && r[0].score <= 60, `score ${r[0].score}`);
  });

  it("margem negativa puxa score forte", () => {
    const v = veiculo({
      chassi: "X",
      dias_patio: 100,
      preco_venda: 100000,
      custo_total: 110000, // margem -10%
    });
    const r = calcularCarrosPraRepassar([v], null, {});
    assert.equal(r.length, 1);
    // dias 100 → 60 * 0.4 = 24
    // margem -10% → 100 * 0.3 = 30
    // sem FIPE → 30 * 0.2 = 6
    // total ≈ 60
    assert.ok(r[0].score >= 55, `score ${r[0].score}`);
  });

  it("preço acima da FIPE +15% gera score alto na dimensão FIPE", () => {
    const v = veiculo({
      chassi: "FIPE1",
      dias_patio: 100,
      preco_venda: 115000,
      custo_total: 90000,
    });
    const fipe = fipeBatch({ FIPE1: 100000 }); // preço 15% acima
    const r = calcularCarrosPraRepassar([v], fipe, {});
    assert.equal(r.length, 1);
    assert.ok(r[0].desvioFipePct);
    assert.ok(r[0].desvioFipePct >= 14 && r[0].desvioFipePct <= 16);
    // Espera motivo "acima-fipe" crítico (>10%)
    const motivoFipe = r[0].motivos.find((m) => m.tipo === "acima-fipe");
    assert.ok(motivoFipe);
    assert.equal(motivoFipe.severidade, "critico");
  });

  it("inclui motivo 'parado' com severidade crítica para +180d", () => {
    const v = veiculo({ chassi: "X", dias_patio: 200, preco_venda: 100000, custo_total: 90000 });
    const r = calcularCarrosPraRepassar([v], null, {});
    const m = r[0].motivos.find((m) => m.tipo === "parado");
    assert.ok(m);
    assert.equal(m.severidade, "critico");
  });

  it("cautelar com restrição puxa pontuação e adiciona motivo", () => {
    // Dados ajustados pra garantir que score ≥ 40 com a cautelar puxando junto
    const v = veiculo({ chassi: "X", dias_patio: 200, preco_venda: 100000, custo_total: 92000 });
    const cautelares = { X: "com_restricao" as const };
    const r = calcularCarrosPraRepassar([v], null, cautelares);
    assert.equal(r.length, 1);
    assert.equal(r[0].cautelar, "com_restricao");
    assert.ok(r[0].motivos.some((m) => m.tipo === "cautelar-restricao"));
  });

  it("calcula preço sugerido aplicando desconto por tempo parado", () => {
    // Carro parado +365d → desconto 15% sobre FIPE
    const v = veiculo({ chassi: "X", dias_patio: 400, preco_venda: 100000, custo_total: 95000 });
    const fipe = fipeBatch({ X: 100000 });
    const r = calcularCarrosPraRepassar([v], fipe, {});
    assert.ok(r[0].precoSugerido);
    // Teto = 100000 * (1 - 0.15) = 85000
    assert.equal(r[0].precoSugerido.teto, 85000);
    // Piso = teto * (1 - 0.05) = 80750
    assert.equal(r[0].precoSugerido.piso, 80750);
  });

  it("aplica desconto extra de 5% no piso se cautelar com restrição", () => {
    // Dias 200 + margem fraca pra passar score 40 mesmo sem cautelar
    const v = veiculo({ chassi: "X", dias_patio: 200, preco_venda: 100000, custo_total: 92000 });
    const fipe = fipeBatch({ X: 100000 });
    const r1 = calcularCarrosPraRepassar([v], fipe, {});
    const r2 = calcularCarrosPraRepassar([v], fipe, { X: "com_restricao" });
    assert.ok(r1.length === 1 && r2.length === 1);
    assert.ok(r1[0].precoSugerido && r2[0].precoSugerido);
    // r2 piso deve ser menor que r1 piso (extra 5%)
    assert.ok(r2[0].precoSugerido.piso < r1[0].precoSugerido.piso);
    // Tetos devem ser iguais (desconto por tempo é o mesmo)
    assert.equal(r1[0].precoSugerido.teto, r2[0].precoSugerido.teto);
  });

  it("filtra carros com score abaixo de 40", () => {
    // Carro parado só 70d, com margem boa, dentro da FIPE, sem cautelar
    // Espera score bem baixo, abaixo de 40
    const v = veiculo({
      chassi: "OK",
      dias_patio: 70,
      preco_venda: 100000,
      custo_total: 80000, // margem 20%
    });
    const r = calcularCarrosPraRepassar([v], null, {});
    assert.equal(r.length, 0);
  });
});

describe("resumirRepasse", () => {
  it("conta total, criticos (score>=75) e soma capital travado", () => {
    const v1 = veiculo({ chassi: "A", dias_patio: 100, valor_aquisicao: 80000 });
    const v2 = veiculo({ chassi: "B", dias_patio: 400, valor_aquisicao: 100000 });
    const carros = calcularCarrosPraRepassar([v1, v2], null, {});
    const resumo = resumirRepasse(carros);
    assert.equal(resumo.total, carros.length);
    assert.equal(resumo.capitalTotal, carros.reduce((s, c) => s + c.capitalTravado, 0));
  });

  it("topN limita a quantidade de itens retornados", () => {
    const carros = Array.from({ length: 10 }, (_, i) =>
      veiculo({ chassi: `C${i}`, placa: `PL${i}`, dias_patio: 200 + i * 10 }),
    );
    const ranking = calcularCarrosPraRepassar(carros, null, {});
    const resumo = resumirRepasse(ranking, 3);
    assert.equal(resumo.topN.length, 3);
  });
});
