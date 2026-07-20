import { test } from "node:test";
import assert from "node:assert/strict";
import { findMarca, findModelos, findAno, ANO_DIST_MAX } from "@/lib/fipe/matcher";
import {
  validarPlausibilidadeFipe,
  isFipeConfirmado,
  precoFipeConfiavel,
  contarFipeConfirmada,
  FIPE_SCORE_MIN,
  FIPE_RATIO_MIN,
  FIPE_RATIO_MAX,
  SCORE_MANUAL,
  type BatchFipeItem,
} from "@/lib/fipe/batch";
import type { FipeAno, FipeMarca, FipeModelo } from "@/lib/fipe/types";

// ═══════════════════════════════════════════════════════════════════════════
// FIXTURES — caso real da Ranger Limited+ 2024
// ═══════════════════════════════════════════════════════════════════════════
//
// O bug: a Ranger Limited+ 2024 (custo ~R$ 250k, FIPE real ~R$ 280k) recebeu
// FIPE de R$ 75.042 — o preço de uma Ranger XL 2.5 de geração 2005-2012.
// Duas falhas se somaram:
//   1. `findAno` escolhia o ano "mais próximo" sem limite → 2024 caía em 2012.
//   2. o guard de persistência só checava `precoFipe > 0`.
// Os testes abaixo travam as duas.

const RANGER_CUSTO_TOTAL = 250_000;
const RANGER_FIPE_CONTAMINADA = 75_042;
const RANGER_FIPE_REAL = 280_000;

/** Anos da geração ANTIGA da Ranger — o modelo FIPE em que o 2024 caiu por engano. */
const ANOS_RANGER_GERACAO_ANTIGA: FipeAno[] = [
  { codigo: "2012-3", nome: "2012 Diesel" },
  { codigo: "2011-3", nome: "2011 Diesel" },
  { codigo: "2010-3", nome: "2010 Diesel" },
  { codigo: "2008-3", nome: "2008 Diesel" },
  { codigo: "2005-3", nome: "2005 Diesel" },
];

/** Anos da geração CORRETA (P703), onde o 2024 realmente existe. */
const ANOS_RANGER_ATUAL: FipeAno[] = [
  { codigo: "2025-3", nome: "2025 Diesel" },
  { codigo: "2024-3", nome: "2024 Diesel" },
  { codigo: "2023-3", nome: "2023 Diesel" },
];

function item(over: Partial<BatchFipeItem> = {}): BatchFipeItem {
  return {
    chassi: "9BFXXXXXXXXXXXXXX",
    precoFipe: RANGER_FIPE_REAL,
    match: {
      marcaCod: "22",
      marcaNome: "Ford",
      modeloCod: 8000,
      modeloNome: "Ranger Limited 3.0 V6 Diesel CD 4x4 Aut",
      anoCod: "2024-3",
      anoNome: "2024 Diesel",
    },
    score: 0.92,
    plausibilidadeVerificada: true,
    ...over,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1) findAno — limite de distância de ano
// ═══════════════════════════════════════════════════════════════════════════

test("findAno: ano exato com combustível certo tem precedência", () => {
  const r = findAno(2024, "DIESEL", ANOS_RANGER_ATUAL);
  assert.equal(r?.codigo, "2024-3");
});

test("findAno: ano existe mas combustível diverge → casa pelo ano", () => {
  const r = findAno(2024, "FLEX", ANOS_RANGER_ATUAL);
  assert.equal(r?.nome, "2024 Diesel");
});

test("findAno: distância de 1 ano é aceita (fallback legítimo)", () => {
  // 2022 não existe na lista; 2023 está a 1 ano de distância.
  const r = findAno(2022, "DIESEL", ANOS_RANGER_ATUAL);
  assert.equal(r?.nome, "2023 Diesel");
});

test("findAno: distância > 1 retorna null em vez do ano mais próximo", () => {
  // 2020 está a 3 anos do mais próximo (2023). Antes devolvia "2023 Diesel".
  assert.equal(findAno(2020, "DIESEL", ANOS_RANGER_ATUAL), null);
});

test("REGRESSÃO Ranger 2024: geração 2005-2012 não é mais aceita como match", () => {
  // Este é o caminho exato que produziu a FIPE de R$ 75.042.
  const r = findAno(2024, "DIESEL", ANOS_RANGER_GERACAO_ANTIGA);
  assert.equal(
    r,
    null,
    "Ranger 2024 não pode casar com a geração antiga — foi assim que herdou o preço de R$ 75.042",
  );
});

test("findAno: o limite documentado é 1 ano", () => {
  assert.equal(ANO_DIST_MAX, 1);
  // Fronteira exata: dist == ANO_DIST_MAX passa, dist == ANO_DIST_MAX + 1 não.
  const anos: FipeAno[] = [{ codigo: "2020-1", nome: "2020 Gasolina" }];
  assert.notEqual(findAno(2021, "GASOLINA", anos), null);
  assert.equal(findAno(2022, "GASOLINA", anos), null);
});

test("findAno: lista vazia retorna null", () => {
  assert.equal(findAno(2024, "DIESEL", []), null);
});

test("findAno: sem ano_modelo retorna null em vez de chutar o primeiro da lista", () => {
  // Devolver `fipeAnos[0]` aqui é o mesmo "pega o primeiro" que casou Ranger
  // 2026 com 2012 — e sem sequer a distância de ano pra limitar o erro. Um
  // veículo sem ano_modelo não tem como ser precificado por FIPE; "sem FIPE" é
  // a única resposta honesta.
  assert.equal(findAno(null, "DIESEL", ANOS_RANGER_ATUAL), null);
  assert.equal(findAno(0, "DIESEL", ANOS_RANGER_ATUAL), null);
});

// ═══════════════════════════════════════════════════════════════════════════
// 2) Guard de sanidade — plausibilidade preço FIPE vs custo_total
// ═══════════════════════════════════════════════════════════════════════════

test("guard: FIPE contaminada da Ranger (R$ 75.042 vs custo R$ 250k) é REJEITADA", () => {
  const r = validarPlausibilidadeFipe(RANGER_FIPE_CONTAMINADA, RANGER_CUSTO_TOTAL);
  assert.equal(r.ok, false, "R$ 75.042 é 30% do custo — tem que ser rejeitado");
  assert.equal(r.aplicado, true);
  assert.equal(r.motivo, "abaixo-do-piso");
});

test("guard: FIPE real da Ranger (R$ 280k vs custo R$ 250k) é ACEITA", () => {
  const r = validarPlausibilidadeFipe(RANGER_FIPE_REAL, RANGER_CUSTO_TOTAL);
  assert.equal(r.ok, true);
  assert.equal(r.aplicado, true);
  assert.equal(r.motivo, undefined);
});

test("guard: preço abaixo de 60% do custo é rejeitado", () => {
  const custo = 100_000;
  const r = validarPlausibilidadeFipe(59_999, custo);
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "abaixo-do-piso");
});

test("guard: preço acima de 250% do custo é rejeitado", () => {
  const custo = 100_000;
  const r = validarPlausibilidadeFipe(250_001, custo);
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "acima-do-teto");
});

test("guard: fronteiras exatas (60% e 250% do custo) são aceitas", () => {
  const custo = 100_000;
  assert.equal(validarPlausibilidadeFipe(custo * FIPE_RATIO_MIN, custo).ok, true);
  assert.equal(validarPlausibilidadeFipe(custo * FIPE_RATIO_MAX, custo).ok, true);
});

test("guard: dentro da faixa é aceito", () => {
  const custo = 100_000;
  for (const preco of [70_000, 100_000, 150_000, 240_000]) {
    assert.equal(validarPlausibilidadeFipe(preco, custo).ok, true, `preço ${preco}`);
  }
});

test("guard: custo_total null não aplica o guard e não quebra", () => {
  const r = validarPlausibilidadeFipe(RANGER_FIPE_CONTAMINADA, null);
  assert.equal(r.ok, true, "sem custo não dá pra validar — não bloqueia");
  assert.equal(r.aplicado, false, "mas registra que nada foi verificado");
});

test("guard: custo_total zero, undefined e NaN também não aplicam o guard", () => {
  for (const custo of [0, undefined, Number.NaN]) {
    const r = validarPlausibilidadeFipe(50_000, custo);
    assert.equal(r.ok, true, `custo ${String(custo)}`);
    assert.equal(r.aplicado, false, `custo ${String(custo)}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 3) Score — match não confirmado é tratado como ausência de FIPE
// ═══════════════════════════════════════════════════════════════════════════

test("score: acima do mínimo → confirmado", () => {
  assert.equal(isFipeConfirmado(item({ score: 0.92 })), true);
  assert.equal(isFipeConfirmado(item({ score: FIPE_SCORE_MIN })), true);
});

test("score: abaixo do mínimo → NÃO confirmado", () => {
  assert.equal(isFipeConfirmado(item({ score: 0.16 })), false);
  assert.equal(isFipeConfirmado(item({ score: FIPE_SCORE_MIN - 0.001 })), false);
});

test("score: null (linha legada, procedência desconhecida) → NÃO confirmado", () => {
  assert.equal(isFipeConfirmado(item({ score: null })), false);
});

test("score alto SEM plausibilidade verificada → NÃO confirmado", () => {
  // Caminho de vendas: o nome do modelo casa bem, mas o preço nunca foi
  // confrontado com o custo do carro. Score alto sozinho não é prova de preço.
  assert.equal(isFipeConfirmado(item({ score: 0.98, plausibilidadeVerificada: false })), false);
});

test("plausibilidade verificada SEM score suficiente → NÃO confirmado", () => {
  assert.equal(isFipeConfirmado(item({ score: 0.2, plausibilidadeVerificada: true })), false);
});

test("confirmação exige as DUAS provas juntas", () => {
  const casos: [number | null, boolean, boolean][] = [
    [0.9, true, true],
    [0.9, false, false],
    [0.2, true, false],
    [0.2, false, false],
    [null, true, false],
    [null, false, false],
  ];
  for (const [score, verificada, esperado] of casos) {
    assert.equal(
      isFipeConfirmado(item({ score, plausibilidadeVerificada: verificada })),
      esperado,
      `score=${String(score)} verificada=${verificada}`,
    );
  }
});

test("score: override manual vale como confirmado", () => {
  assert.equal(isFipeConfirmado(item({ score: SCORE_MANUAL })), true);
});

test("score: item ausente ou preço zerado → NÃO confirmado", () => {
  assert.equal(isFipeConfirmado(undefined), false);
  assert.equal(isFipeConfirmado(null), false);
  assert.equal(isFipeConfirmado(item({ precoFipe: 0 })), false);
});

test("precoFipeConfiavel: score baixo devolve null, não o número", () => {
  const batch = { items: { ABC: item({ chassi: "ABC", score: 0.3, precoFipe: 75_042 }) } };
  assert.equal(
    precoFipeConfiavel(batch, "ABC"),
    null,
    "consumidor de pricing tem que enxergar 'sem FIPE', nunca o valor não confirmado",
  );
});

test("precoFipeConfiavel: score alto devolve o preço", () => {
  const batch = { items: { ABC: item({ chassi: "ABC", score: 0.9, precoFipe: 280_000 }) } };
  assert.equal(precoFipeConfiavel(batch, "ABC"), 280_000);
});

test("precoFipeConfiavel: score alto mas nunca verificado devolve null", () => {
  const batch = {
    items: {
      ABC: item({ chassi: "ABC", score: 0.95, plausibilidadeVerificada: false, precoFipe: 57_377 }),
    },
  };
  assert.equal(precoFipeConfiavel(batch, "ABC"), null);
});

test("precoFipeConfiavel: chassi inexistente e batch null devolvem null", () => {
  assert.equal(precoFipeConfiavel({ items: {} }, "NAO_EXISTE"), null);
  assert.equal(precoFipeConfiavel(null, "ABC"), null);
});

test("contarFipeConfirmada: cobertura conta só match confiável", () => {
  const batch = {
    items: {
      A: item({ chassi: "A", score: 0.9 }),
      B: item({ chassi: "B", score: 0.2 }),
      C: item({ chassi: "C", score: null }),
      D: item({ chassi: "D", score: SCORE_MANUAL }),
      E: item({ chassi: "E", score: 0.95, plausibilidadeVerificada: false }),
    },
  };
  // O painel antigo diria 5/5 = 100%. A verdade é 2/5.
  assert.equal(contarFipeConfirmada(batch), 2);
  assert.equal(contarFipeConfirmada(null), 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// 4) findMarca / findModelos — cobertura básica do matcher (antes: zero testes)
// ═══════════════════════════════════════════════════════════════════════════

const MARCAS: FipeMarca[] = [
  { codigo: "22", nome: "Ford" },
  { codigo: "23", nome: "GM - Chevrolet" },
  { codigo: "59", nome: "VW - VolksWagen" },
  { codigo: "25", nome: "Honda" },
];

test("findMarca: alias do NBS resolve pro nome exato da FIPE", () => {
  assert.equal(findMarca("CHEVROLET", MARCAS)?.nome, "GM - Chevrolet");
  assert.equal(findMarca("Ford Autos", MARCAS)?.nome, "Ford");
  assert.equal(findMarca("VOLKSWAGEN", MARCAS)?.nome, "VW - VolksWagen");
});

test("findMarca: nome que já bate direto passa sem alias", () => {
  assert.equal(findMarca("Honda", MARCAS)?.codigo, "25");
});

test("findMarca: marca desconhecida retorna null", () => {
  assert.equal(findMarca("Lamborghini", MARCAS), null);
});

const MODELOS_FORD: FipeModelo[] = [
  { codigo: 1, nome: "Ranger XL 2.5 Flex 4x2 CD" },
  { codigo: 2, nome: "Ranger Limited 3.0 V6 Diesel CD 4x4 Aut" },
  { codigo: 3, nome: "Ranger Storm 3.2 Diesel CD 4x4 Aut" },
  { codigo: 4, nome: "Ka SE 1.0 Flex" },
];

test("findModelos: ordena por score e o melhor match fica em primeiro", () => {
  const r = findModelos("RANGER LIMITED 3.0 DIESEL CD 4X4", MODELOS_FORD, 5, "DIESEL");
  assert.ok(r.length > 0, "esperava candidatos");
  assert.equal(r[0].modelo.codigo, 2);
  assert.ok(r[0].score > r[1].score - 1e-9);
});

test("findModelos: o score do vencedor é exposto pro caller poder persistir", () => {
  const r = findModelos("RANGER LIMITED 3.0 DIESEL CD 4X4", MODELOS_FORD, 1, "DIESEL");
  assert.equal(typeof r[0].score, "number");
  assert.ok(Number.isFinite(r[0].score));
});

test("findModelos: match fraco produz score abaixo do limiar de confiança", () => {
  // Modelo sem quase nada em comum com o catálogo Ford: se sobrar algum
  // candidato, ele tem que ficar abaixo do mínimo — nunca ser exibido como certo.
  const r = findModelos("CIVIC TOURING 1.5 TURBO", MODELOS_FORD, 1, "GASOLINA");
  if (r.length > 0) {
    assert.ok(
      r[0].score < FIPE_SCORE_MIN,
      `match espúrio deveria ficar abaixo de ${FIPE_SCORE_MIN}, veio ${r[0].score}`,
    );
    assert.equal(
      isFipeConfirmado(item({ score: r[0].score, plausibilidadeVerificada: true })),
      false,
    );
  }
});

test("findModelos: string vazia não retorna candidatos", () => {
  assert.equal(findModelos("", MODELOS_FORD, 5, null).length, 0);
});
