/**
 * Testes do ranking "Carros pra repassar" (critérios objetivos).
 *
 * Garante:
 *   - 3 critérios disparam inclusão: idade ≥ 10 anos, km ≥ 100.000, dias ≥ 50
 *   - Carro precisa bater AO MENOS 1 critério pra entrar
 *   - Score reflete quantos critérios bateu (50 / 75 / 100) + intensidade
 *   - Ordenação por score desc
 *   - Filtros (excluirPreparacao) funcionam
 *   - Sugestão de preço aumenta desconto conforme nº critérios
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calcularCarrosPraRepassar,
  resumirRepasse,
} from "@/lib/analytics/carros-pra-repassar";
import { veiculo } from "./_mocks";
import type { BatchFipeItem, BatchResult } from "@/lib/fipe/batch";

const ANO_REF = 2026; // ano fixo pra testes determinísticos

/**
 * Monta um `BatchResult` a partir de chassi→preço.
 *
 * Tipado como `BatchFipeItem` de verdade (sem `as unknown as`): o cast antigo
 * escondia que `match` não tinha a forma de `FipeMatch` e deixava o `tsc` passar
 * enquanto o teste quebrava em runtime — foi assim que a exigência de referência
 * da migration 022 só apareceu ao rodar a suíte, não no typecheck.
 */
function fipeItem(chassi: string, precoFipe: number): BatchFipeItem {
  return {
    chassi,
    precoFipe,
    // As TRÊS provas de confiança precisam estar presentes: sem elas o match
    // conta como não confirmado e o cálculo cai no proxy de preço, não na FIPE.
    // A referência entrou na migration 022 — preço de mês desconhecido não
    // alimenta precificação.
    score: 0.9,
    plausibilidadeVerificada: true,
    fipeReferencia: "julho/2026",
    fipeReferenciaCod: 335,
    match: {
      marcaCod: "22",
      marcaNome: "Ford",
      modeloCod: 8000,
      modeloNome: "Modelo Teste",
      anoCod: "2024-3",
      anoNome: "2024 Diesel",
    },
  };
}

function fipeBatch(items: Record<string, number>): BatchResult {
  return {
    timestamp: 0,
    items: Object.fromEntries(
      Object.entries(items).map(([chassi, precoFipe]) => [chassi, fipeItem(chassi, precoFipe)]),
    ),
    erros: [],
    totalGrupos: 0,
    totalVeiculos: Object.keys(items).length,
    persistenciaErro: null,
  };
}

describe("calcularCarrosPraRepassar — critérios objetivos", () => {
  it("retorna lista vazia se não há veículos", () => {
    const r = calcularCarrosPraRepassar([], null, {}, { anoReferencia: ANO_REF });
    assert.deepEqual(r, []);
  });

  it("não inclui carro novo + poucos km + pouco tempo parado", () => {
    const v = veiculo({
      ano_modelo: 2024,
      ano_fabricacao: 2024,
      km: 30_000,
      dias_patio: 20,
    });
    const r = calcularCarrosPraRepassar([v], null, {}, { anoReferencia: ANO_REF });
    assert.equal(r.length, 0);
  });

  it("inclui carro só pela idade (≥10 anos)", () => {
    const v = veiculo({
      chassi: "VELHO",
      ano_modelo: 2014, // 12 anos em 2026
      ano_fabricacao: 2014,
      km: 50_000,
      dias_patio: 10,
    });
    const r = calcularCarrosPraRepassar([v], null, {}, { anoReferencia: ANO_REF });
    assert.equal(r.length, 1);
    assert.ok(r[0].motivos.some((m) => m.tipo === "idade"));
  });

  it("inclui carro só pela quilometragem (≥100.000)", () => {
    const v = veiculo({
      chassi: "RODADO",
      ano_modelo: 2022,
      ano_fabricacao: 2022,
      km: 120_000,
      dias_patio: 15,
    });
    const r = calcularCarrosPraRepassar([v], null, {}, { anoReferencia: ANO_REF });
    assert.equal(r.length, 1);
    assert.ok(r[0].motivos.some((m) => m.tipo === "km"));
  });

  it("inclui carro só pelos dias parado (≥50)", () => {
    const v = veiculo({
      chassi: "PARADO",
      ano_modelo: 2024,
      ano_fabricacao: 2024,
      km: 5_000,
      dias_patio: 75,
    });
    const r = calcularCarrosPraRepassar([v], null, {}, { anoReferencia: ANO_REF });
    assert.equal(r.length, 1);
    assert.ok(r[0].motivos.some((m) => m.tipo === "parado"));
  });

  it("carro com 1 critério tem score base 50", () => {
    const v = veiculo({
      chassi: "X",
      ano_modelo: 2014, // idade 12
      ano_fabricacao: 2014,
      km: 50_000,
      dias_patio: 10,
    });
    const r = calcularCarrosPraRepassar([v], null, {}, { anoReferencia: ANO_REF });
    assert.equal(r[0].motivos.length, 1);
    assert.ok(r[0].score >= 50 && r[0].score < 75, `score esperado 50-74, recebido ${r[0].score}`);
  });

  it("carro com 2 critérios tem score base 75", () => {
    const v = veiculo({
      chassi: "X",
      ano_modelo: 2014, // idade 12 → critério 1
      ano_fabricacao: 2014,
      km: 110_000, // critério 2
      dias_patio: 10,
    });
    const r = calcularCarrosPraRepassar([v], null, {}, { anoReferencia: ANO_REF });
    assert.equal(r[0].motivos.length, 2);
    assert.ok(r[0].score >= 75 && r[0].score < 100, `score esperado 75-99, recebido ${r[0].score}`);
  });

  it("carro com 3 critérios tem score 100", () => {
    const v = veiculo({
      chassi: "X",
      ano_modelo: 2014, // idade 12
      ano_fabricacao: 2014,
      km: 150_000,
      dias_patio: 80,
    });
    const r = calcularCarrosPraRepassar([v], null, {}, { anoReferencia: ANO_REF });
    assert.equal(r[0].motivos.length, 3);
    assert.equal(r[0].score, 100);
  });

  it("ordena por score desc (mais critérios primeiro)", () => {
    const carros = [
      veiculo({ chassi: "A", ano_modelo: 2024, ano_fabricacao: 2024, km: 30_000, dias_patio: 60 }), // só dias
      veiculo({ chassi: "B", ano_modelo: 2010, ano_fabricacao: 2010, km: 150_000, dias_patio: 80 }), // 3
      veiculo({ chassi: "C", ano_modelo: 2014, ano_fabricacao: 2014, km: 50_000, dias_patio: 60 }), // 2 (idade + dias)
    ];
    const r = calcularCarrosPraRepassar(carros, null, {}, { anoReferencia: ANO_REF });
    assert.equal(r[0].chassi, "B"); // 3 critérios
    assert.equal(r[1].chassi, "C"); // 2 critérios
    assert.equal(r[2].chassi, "A"); // 1 critério
  });

  it("exclui carros em PREPARAÇÃO por padrão", () => {
    const v = veiculo({
      ano_modelo: 2010, // batendo idade
      ano_fabricacao: 2010,
      km: 150_000,
      dias_patio: 80,
      patio: "PREPARACAO",
    });
    const r = calcularCarrosPraRepassar([v], null, {}, { anoReferencia: ANO_REF });
    assert.equal(r.length, 0);
  });

  it("inclui preparação se excluirPreparacao=false", () => {
    const v = veiculo({
      ano_modelo: 2010,
      ano_fabricacao: 2010,
      km: 150_000,
      dias_patio: 80,
      patio: "PREPARACAO",
    });
    const r = calcularCarrosPraRepassar([v], null, {}, {
      anoReferencia: ANO_REF,
      excluirPreparacao: false,
    });
    assert.equal(r.length, 1);
  });

  it("motivo 'idade' tem o número de anos correto", () => {
    const v = veiculo({
      chassi: "X",
      ano_modelo: 2012,
      ano_fabricacao: 2012,
      km: 50_000,
      dias_patio: 10,
    });
    const r = calcularCarrosPraRepassar([v], null, {}, { anoReferencia: ANO_REF });
    const m = r[0].motivos.find((m) => m.tipo === "idade");
    assert.ok(m && m.tipo === "idade");
    assert.equal(m.anos, 14); // 2026 - 2012
  });

  it("motivo 'km' devolve a quilometragem exata", () => {
    const v = veiculo({
      chassi: "X",
      ano_modelo: 2024,
      ano_fabricacao: 2024,
      km: 135_500,
      dias_patio: 10,
    });
    const r = calcularCarrosPraRepassar([v], null, {}, { anoReferencia: ANO_REF });
    const m = r[0].motivos.find((m) => m.tipo === "km");
    assert.ok(m && m.tipo === "km");
    assert.equal(m.km, 135_500);
  });

  it("motivo 'parado' devolve os dias de pátio", () => {
    const v = veiculo({
      chassi: "X",
      ano_modelo: 2024,
      ano_fabricacao: 2024,
      km: 5_000,
      dias_patio: 120,
    });
    const r = calcularCarrosPraRepassar([v], null, {}, { anoReferencia: ANO_REF });
    const m = r[0].motivos.find((m) => m.tipo === "parado");
    assert.ok(m && m.tipo === "parado");
    assert.equal(m.dias, 120);
  });

  it("preço sugerido usa FIPE como base", () => {
    const v = veiculo({
      chassi: "X",
      ano_modelo: 2014,
      ano_fabricacao: 2014,
      km: 50_000,
      dias_patio: 10,
      preco_venda: 100_000,
    });
    const fipe = fipeBatch({ X: 80_000 });
    const r = calcularCarrosPraRepassar([v], fipe, {}, { anoReferencia: ANO_REF });
    assert.ok(r[0].precoSugerido);
    // 1 critério → desconto 5% sobre FIPE = 76.000 (teto)
    assert.equal(r[0].precoSugerido.teto, 76_000);
  });

  it("preço sugerido aplica desconto maior se mais critérios batem", () => {
    const v3 = veiculo({
      chassi: "TRES",
      ano_modelo: 2014,
      ano_fabricacao: 2014,
      km: 150_000,
      dias_patio: 80,
      preco_venda: 100_000,
    });
    const v1 = veiculo({
      chassi: "UM",
      ano_modelo: 2014,
      ano_fabricacao: 2014,
      km: 50_000,
      dias_patio: 10,
      preco_venda: 100_000,
    });
    const fipe = fipeBatch({ TRES: 80_000, UM: 80_000 });
    const r3 = calcularCarrosPraRepassar([v3], fipe, {}, { anoReferencia: ANO_REF });
    const r1 = calcularCarrosPraRepassar([v1], fipe, {}, { anoReferencia: ANO_REF });
    assert.ok(r3[0].precoSugerido && r1[0].precoSugerido);
    // 3 critérios = desconto 15%, 1 critério = 5%
    assert.ok(r3[0].precoSugerido.teto < r1[0].precoSugerido.teto, "teto com 3 critérios deve ser menor");
  });

  it("ignora carros sem ano de fabricação nem modelo (não dá pra calcular idade)", () => {
    const v = veiculo({
      ano_modelo: null,
      ano_fabricacao: null,
      km: 50_000,
      dias_patio: 10,
    });
    const r = calcularCarrosPraRepassar([v], null, {}, { anoReferencia: ANO_REF });
    assert.equal(r.length, 0); // nenhum critério bate
  });
});

describe("resumirRepasse", () => {
  it("conta total, capital travado e críticos (3 critérios)", () => {
    const v3 = veiculo({
      chassi: "A",
      ano_modelo: 2010,
      ano_fabricacao: 2010,
      km: 150_000,
      dias_patio: 80,
      valor_aquisicao: 80_000,
    });
    const v1 = veiculo({
      chassi: "B",
      ano_modelo: 2024,
      ano_fabricacao: 2024,
      km: 110_000,
      dias_patio: 10,
      valor_aquisicao: 100_000,
    });
    const r = calcularCarrosPraRepassar([v3, v1], null, {}, { anoReferencia: ANO_REF });
    const resumo = resumirRepasse(r);
    assert.equal(resumo.total, 2);
    assert.equal(resumo.capitalTotal, 180_000);
    assert.equal(resumo.criticos, 1); // só v3 bate os 3
  });

  it("topN limita a quantidade retornada", () => {
    const carros = Array.from({ length: 10 }, (_, i) =>
      veiculo({
        chassi: `C${i}`,
        placa: `PL${i}`,
        ano_modelo: 2010 + i,
        ano_fabricacao: 2010 + i,
        km: 50_000,
        dias_patio: 60 + i,
      }),
    );
    const r = calcularCarrosPraRepassar(carros, null, {}, { anoReferencia: ANO_REF });
    const resumo = resumirRepasse(r, 3);
    assert.equal(resumo.topN.length, 3);
  });
});
