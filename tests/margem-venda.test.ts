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
  classificarMargemVendaValores,
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

  // Regressão: com custo de repasse mas SEM mínimo/compre-por, o semáforo cheio
  // não é classificável — mas prejuízo não depende de limiar. Antes saía neutro
  // (cinza) mostrando −R$ 5.000,00 com tooltip "Dados incompletos".
  it("prejuízo sem mínimo/compre-por → vermelho, mesmo com semáforo parcial", () => {
    const r = repasse({
      status: "vendido",
      valor_vendido: 87_000,
      valor_compra_repasse: 92_000,
      valor_minimo: null,
      valor_compre_por: null,
    });
    assert.equal(calcularMargemVenda(r), -5_000);
    assert.deepEqual(classificarMargemVenda(r), { cor: "vermelho", completo: false });
  });

  it("prejuízo só por causa dos gastos, sem limiares → vermelho", () => {
    const r = repasse({
      status: "vendido",
      valor_vendido: 92_500,
      valor_compra_repasse: 92_000,
      valor_minimo: null,
      valor_compre_por: null,
    });
    // Sem gastos daria +500 (neutro); com 1.500 de gasto vira −1.000 (vermelho).
    assert.deepEqual(classificarMargemVenda(r), { cor: "neutro", completo: false });
    assert.equal(calcularMargemVenda(r, [1_500]), -1_000);
    assert.deepEqual(classificarMargemVenda(r, [1_500]), { cor: "vermelho", completo: false });
  });

  it("lucro sem mínimo/compre-por continua neutro (não dá pra dizer se é bom)", () => {
    const r = repasse({
      status: "vendido",
      valor_vendido: 98_000,
      valor_compra_repasse: 92_000,
      valor_minimo: null,
      valor_compre_por: null,
    });
    assert.equal(calcularMargemVenda(r), 6_000);
    assert.deepEqual(classificarMargemVenda(r), { cor: "neutro", completo: false });
  });

  it("margem exatamente zero sem limiares → neutro (não é prejuízo)", () => {
    const r = repasse({
      status: "vendido",
      valor_vendido: 92_000,
      valor_compra_repasse: 92_000,
      valor_minimo: null,
      valor_compre_por: null,
    });
    assert.equal(calcularMargemVenda(r), 0);
    assert.deepEqual(classificarMargemVenda(r), { cor: "neutro", completo: false });
  });

  it("sem valor_compra_repasse segue neutro (não há custo pra comparar)", () => {
    const r = repasse({
      status: "vendido",
      valor_vendido: 50_000,
      valor_aquisicao: 120_000,
      valor_compra_repasse: null,
      valor_minimo: null,
      valor_compre_por: null,
    });
    assert.deepEqual(classificarMargemVenda(r), { cor: "neutro", completo: false });
  });
});

// A prévia ao vivo do MarcarVendidoModal classifica VALORES crus (o valor ainda
// está sendo digitado, o repasse ainda não é "vendido"), então ela chama esta
// função direto. Antes chamava o núcleo `classificarMargem` e o mesmo carro saía
// cinza no modal e vermelho na coluna "Resultado" logo depois de confirmar.
describe("classificarMargemVendaValores — prévia ao vivo do modal de venda", () => {
  /** custo_real = 92.000 + 1.500 + 800 = 94.300; mínimo 95.000; compre-por 99.000. */
  const CUSTO = 94_300;
  const MIN = 95_000;
  const CP = 99_000;

  it("semáforo cheio: as 4 faixas seguem o núcleo canônico", () => {
    assert.equal(classificarMargemVendaValores(93_000, CUSTO, MIN, CP).cor, "vermelho");
    assert.equal(classificarMargemVendaValores(94_500, CUSTO, MIN, CP).cor, "laranja");
    assert.equal(classificarMargemVendaValores(98_000, CUSTO, MIN, CP).cor, "amarelo");
    assert.equal(classificarMargemVendaValores(99_500, CUSTO, MIN, CP).cor, "verde");
  });

  it("prejuízo sem mínimo/compre-por → vermelho, nunca cinza neutro", () => {
    assert.deepEqual(classificarMargemVendaValores(87_000, 92_000, null, null), {
      cor: "vermelho",
      completo: false,
    });
  });

  it("lucro sem mínimo/compre-por continua neutro (não dá pra dizer se é bom)", () => {
    assert.deepEqual(classificarMargemVendaValores(98_000, 92_000, null, null), {
      cor: "neutro",
      completo: false,
    });
  });

  it("margem exatamente zero sem limiares → neutro (não é prejuízo)", () => {
    assert.deepEqual(classificarMargemVendaValores(92_000, 92_000, null, null), {
      cor: "neutro",
      completo: false,
    });
  });

  it("valor ainda não digitado (null) → neutro", () => {
    assert.deepEqual(classificarMargemVendaValores(null, 92_000, MIN, CP), {
      cor: "neutro",
      completo: false,
    });
  });

  it("sem custo_real → neutro, mesmo com valor bem abaixo (não há custo pra comparar)", () => {
    assert.deepEqual(classificarMargemVendaValores(50_000, null, null, null), {
      cor: "neutro",
      completo: false,
    });
  });

  // O bug do MEDIUM-2: modal e coluna "Resultado" tinham que concordar no MESMO
  // carro. Aqui a prévia do modal (valores crus) e o resultado pós-venda (repasse
  // salvo) são comparados lado a lado.
  it("prévia do modal e coluna Resultado dão a MESMA cor no mesmo carro", () => {
    const semLimiares = {
      valor_compra_repasse: 92_000,
      valor_minimo: null,
      valor_compre_por: null,
    };
    const gastos = [1_500];
    // custo_real = 93.500; venda 88.500 → −5.000 de prejuízo.
    const custoReal = calcularCustoRealRepasse(semLimiares, gastos);
    assert.equal(custoReal, 93_500);

    const previaModal = classificarMargemVendaValores(
      88_500,
      custoReal,
      semLimiares.valor_minimo,
      semLimiares.valor_compre_por,
    );
    const colunaResultado = classificarMargemVenda(
      repasse({ ...semLimiares, status: "vendido", valor_vendido: 88_500 }),
      gastos,
    );

    assert.deepEqual(previaModal, { cor: "vermelho", completo: false });
    assert.deepEqual(previaModal, colunaResultado);
  });
});
