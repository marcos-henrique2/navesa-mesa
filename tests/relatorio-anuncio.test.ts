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
import type { SnapshotRecente } from "@/lib/pricing/origem-abaixo-do-custo";

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
    // Fonte canônica dos dias em repasse. `data_subiu` (marcação) é só fallback.
    data_subido: "2026-07-01",
    data_subiu: "2026-06-01",
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

  it("sem data_subido nem data_subiu → diasNoRepasse null", () => {
    const it = montarItemAnuncio(carro({ data_subido: null, data_subiu: null }), HOJE);
    assert.equal(it.diasNoRepasse, null);
  });

  it("fipe ausente → null (UI mostra —)", () => {
    assert.equal(montarItemAnuncio(carro(), HOJE).fipe, null);
  });
});

describe("filtrarAnuncio", () => {
  const itens = montarRelatorioAnuncio(
    [
      carro({ id: 1, modelo: "ONIX 1.0", ano_modelo: 2021, ano_fabricacao: 2020, data_subido: "2026-07-20" }), // 12 dias
      carro({ id: 2, modelo: "HB20 1.6", ano_modelo: 2019, ano_fabricacao: 2019, data_subido: "2026-05-01" }), // 92 dias
      carro({ id: 3, modelo: "ONIX PLUS", ano_modelo: 2022, ano_fabricacao: 2021, data_subido: null, data_subiu: null }), // sem dias
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
      carro({ id: 1, valor_compra_repasse: 50_000, gastos: [], valor_minimo: 55_000, valor_compre_por: 60_000, data_subido: "2026-07-25" }),
      // Prejuízo latente: minimo < custo (mas compre_por >= custo)
      carro({ id: 2, valor_compra_repasse: 70_000, gastos: [], valor_minimo: 65_000, valor_compre_por: 75_000, data_subido: "2026-07-25" }),
      // Pior: compre_por < custo (anúncio no prejuízo) — tipo PMK6A00/SCM2G20
      carro({ id: 3, valor_compra_repasse: 80_000, gastos: [], valor_minimo: 70_000, valor_compre_por: 65_000, data_subido: "2026-07-25" }),
      // Envelhecido (>60 dias) e completo saudável
      carro({ id: 4, valor_compra_repasse: 40_000, gastos: [], valor_minimo: 45_000, valor_compre_por: 50_000, data_subido: "2026-05-01" }),
      // Incompleto → NÃO entra em prejuízo
      carro({ id: 5, valor_compra_repasse: null, valor_minimo: 10_000, valor_compre_por: 9_000, data_subido: "2026-07-25" }),
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

describe("calcularAlertas — C16: carro girado sai do prejuízo latente", () => {
  // ⚠️ O DEFEITO QUE ISTO CONSERTA (achado do @quinn-qa, 2026-08-12): o painel
  // "Prejuízo latente" de `/repasses/anuncio` avalia `valor_minimo < custo_real`
  // SEM QUALIFICAÇÃO, sobre TODOS os carros `status='subido'`. A partir do
  // primeiro carro girado com g > 6,6% a placa dele passaria a figurar numa
  // caixa vermelha permanente, para sempre — o Risk #4 verbatim, só que em
  // `/repasses/anuncio` em vez do `/repasses`.
  //
  // PRD2189: compra 80.000 + gastos 6.850 = custo 86.850; girado ⇒ mínimo
  // 85.300 aplicado. `minimo < custo` é VERDADE, e é DESENHO.
  const itens = montarRelatorioAnuncio(
    [
      carro({
        id: 10,
        valor_compra_repasse: 80_000,
        gastos: [6_850],
        valor_minimo: 85_300,
        valor_compre_por: 89_600,
        data_subido: "2026-07-25",
      }),
      // Controle: mesmo predicado, sem registro de decisão nenhum.
      carro({
        id: 11,
        valor_compra_repasse: 70_000,
        gastos: [],
        valor_minimo: 65_000,
        valor_compre_por: 75_000,
        data_subido: "2026-07-25",
      }),
    ],
    HOJE,
  );

  const girado: SnapshotRecente = {
    modo: "girar_rapido",
    minimoAplicado: 85_300,
    custoReal: 86_850,
    aplicadoEmData: "2026-08-12",
  };

  it("sem os snapshots o comportamento é o DE ANTES — os dois entram", () => {
    // Isto é a rede de degradação: se a leitura da 030 falhar, o relatório volta
    // ao que era, nunca quebra.
    const a = calcularAlertas(itens);
    assert.deepEqual(a.prejuizoLatente.map((i) => i.id).sort(), [10, 11]);
  });

  it("com o snapshot de DECISÃO, o carro girado sai da caixa vermelha", () => {
    const a = calcularAlertas(itens, new Map([[10, girado]]));
    assert.deepEqual(a.prejuizoLatente.map((i) => i.id), [11]);
  });

  it("o carro SEM registro de decisão continua vermelho", () => {
    const a = calcularAlertas(itens, new Map([[10, girado]]));
    assert.ok(a.prejuizoLatente.some((i) => i.id === 11));
  });

  it("girado + gasto TARDIO volta pro vermelho — o custo subiu depois da escolha", () => {
    // O snapshot congelou custo 86.850; hoje o custo é outro porque entrou gasto
    // novo. A parte a mais NÃO foi decisão dele.
    const comGastoTardio = montarRelatorioAnuncio(
      [
        carro({
          id: 10,
          valor_compra_repasse: 80_000,
          gastos: [6_850, 1_600],
          valor_minimo: 85_300,
          valor_compre_por: 89_600,
          data_subido: "2026-07-25",
        }),
      ],
      HOJE,
    );
    const a = calcularAlertas(comGastoTardio, new Map([[10, girado]]));
    assert.deepEqual(a.prejuizoLatente.map((i) => i.id), [10]);
  });

  it("o preço sobrescrito pelo import volta pro vermelho (aplicado não bate)", () => {
    const importado = montarRelatorioAnuncio(
      [
        carro({
          id: 10,
          valor_compra_repasse: 80_000,
          gastos: [6_850],
          valor_minimo: 84_000, // o portal mandou outro número
          valor_compre_por: 89_600,
          data_subido: "2026-07-25",
        }),
      ],
      HOJE,
    );
    const a = calcularAlertas(importado, new Map([[10, girado]]));
    assert.deepEqual(a.prejuizoLatente.map((i) => i.id), [10]);
  });

  it("CAMADA DE DADOS: `prejuizoNoAnuncio` não é filtrado pela C16 (≠ o que a tela mostra)", () => {
    // ⚠️ ESTE TESTE COBRE O ARRAY, NÃO O RENDER — e a diferença importa.
    //
    // `prejuizoNoAnuncio` NUNCA é uma caixa própria na tela: ele vira o `Set`
    // `piores` e só REALÇA placas dentro da caixa de `prejuizoLatente`
    // (`RelatorioAnuncio.tsx:222-250`). Antes da C16 o subset se sustentava —
    // todo carro do `prejuizoNoAnuncio` estava também no `prejuizoLatente`.
    // Depois da C16 não se sustenta mais: um carro girado com g > 11,97% sai do
    // `prejuizoLatente` (origem `decisao`) e, por consequência, SOME DO PAINEL,
    // mesmo continuando neste array.
    //
    // DECISÃO DO MARCOS (2026-08-12), opção (b): **some, e está certo que suma.**
    // Se ele girou sabendo que abre mão dos gastos, o compre-por baixo é
    // consequência da MESMA decisão — não é surpresa que mereça alerta. O sinal
    // não sai da tela: a linha do carro na tabela mantém o 🔴 via `it.cor`.
    // O que sai é a caixa de "não deixe passar".
    //
    // Então: este assert protege a camada de dados (o array segue completo, pra
    // quem precisar dele), NÃO o comportamento de tela descrito acima.
    const anuncioNoPrejuizo = montarRelatorioAnuncio(
      [
        carro({
          id: 12,
          valor_compra_repasse: 80_000,
          gastos: [12_000],
          valor_minimo: 85_280,
          valor_compre_por: 89_580,
          data_subido: "2026-07-25",
        }),
      ],
      HOJE,
    );
    const snap: SnapshotRecente = {
      modo: "girar_rapido",
      minimoAplicado: 85_280,
      custoReal: 92_000,
      aplicadoEmData: "2026-08-12",
    };
    const a = calcularAlertas(anuncioNoPrejuizo, new Map([[12, snap]]));
    assert.deepEqual(a.prejuizoNoAnuncio.map((i) => i.id), [12]);
  });
});
