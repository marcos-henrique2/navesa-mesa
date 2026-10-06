/**
 * Testes de `extrairMeta` (nbs-custos-estoque-pdf.ts) — bug real confirmado:
 * cod_empresa gravava 0 em 99,94% dos registros de `custos_estoque_detalhado`
 * desde a primeira carga (03/06/2026).
 *
 * Causa: `extrairMeta` rodava o regex da filial contra UMA linha isolada
 * (bucket de `agruparLinhas`, agrupado por tolerância de Y de 3pt). O pdfjs
 * frequentemente emite o rótulo estático ("Filial:") e o valor dinâmico
 * injetado pelo motor de relatório ("02 NAVESA FORD AEROPORTO...") como text
 * items com baseline (y) ligeiramente diferente — o suficiente pra cair em
 * "linhas" diferentes e o regex nunca ver o número da filial. Sem o PDF real
 * não é possível confirmar o deslocamento exato de Y, mas o teste abaixo
 * reproduz a fragmentação mais plausível (rótulo e valor em y's distintos,
 * fora da tolerância) e prova que a extração robusta (busca no texto da
 * página inteira, não só na linha) resolve o caso — e que, quando a extração
 * falha de verdade, o resultado é `null` com warning, nunca `0` silencioso.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extrairMeta, agruparLinhas, type Item } from "@/lib/parsers/nbs-custos-estoque-pdf";

/** Monta os itens de uma página 1 típica, com o rótulo e o valor da filial em y's configuráveis. */
function montarItensHeader(opts: {
  filialLabelY: number;
  filialValorY: number;
  comFilial?: boolean;
  filialTexto?: string[]; // itens após "Filial:" (já fragmentados como o pdfjs entregaria)
}): Item[] {
  const itens: Item[] = [
    // "Empresa: NAVESA Página: 1" — linha própria, bem acima
    { str: "Empresa:", x: 40, y: 760 },
    { str: "NAVESA", x: 90, y: 760 },
    { str: "Página:", x: 500, y: 760 },
    { str: "1", x: 540, y: 760 },
  ];
  if (opts.comFilial ?? true) {
    itens.push({ str: "Filial:", x: 40, y: opts.filialLabelY });
    const valor = opts.filialTexto ?? [
      "02", "NAVESA", "FORD", "AEROPORTO",
      "Data", "de", "Impressão:", "03/06/2026",
    ];
    let x = 90;
    for (const t of valor) {
      itens.push({ str: t, x, y: opts.filialValorY });
      x += 40;
    }
  }
  return itens;
}

describe("extrairMeta — extração de cod_empresa a partir de 'Filial:'", () => {
  it("caso feliz: rótulo e valor no MESMO y (uma só linha) — cod_empresa=2, sem warning", () => {
    const itens = montarItensHeader({ filialLabelY: 700, filialValorY: 700 });
    const linhas = agruparLinhas(itens);
    const warnings: string[] = [];
    const meta = extrairMeta(linhas, "teste.pdf", warnings);

    assert.equal(meta.cod_empresa, 2);
    assert.equal(meta.filial, "02 NAVESA FORD AEROPORTO");
    assert.equal(meta.empresa, "NAVESA");
    assert.deepEqual(warnings, []);
  });

  it("fragmentação real do pdfjs: rótulo 'Filial:' e valor em y's diferentes (fora da tolerância de 3pt) — ainda extrai cod_empresa=2", () => {
    // y difere em 6pt: agruparLinhas (tolY=3) os separa em DUAS linhas distintas.
    const itens = montarItensHeader({ filialLabelY: 700, filialValorY: 694 });
    const linhas = agruparLinhas(itens);

    // Confirma a premissa do teste: realmente caem em linhas diferentes.
    const linhaDoRotulo = linhas.find((l) => l.itens.some((i) => i.str === "Filial:"));
    const linhaDoValor = linhas.find((l) => l.itens.some((i) => i.str === "02"));
    assert.notEqual(linhaDoRotulo, linhaDoValor, "pré-condição: rótulo e valor devem cair em linhas diferentes");

    const warnings: string[] = [];
    const meta = extrairMeta(linhas, "teste.pdf", warnings);

    assert.equal(meta.cod_empresa, 2);
    assert.equal(meta.filial, "02 NAVESA FORD AEROPORTO");
    assert.deepEqual(warnings, []);
  });

  it("'ã' de 'Impressão' fragmentado em item próprio — ainda extrai cod_empresa e a data", () => {
    const itens = montarItensHeader({
      filialLabelY: 700,
      filialValorY: 700,
      filialTexto: ["02", "NAVESA", "FORD", "AEROPORTO", "Data", "de", "Impress", "ã", "o:", "03/06/2026"],
    });
    const linhas = agruparLinhas(itens);
    const warnings: string[] = [];
    const meta = extrairMeta(linhas, "teste.pdf", warnings);

    assert.equal(meta.cod_empresa, 2);
    assert.deepEqual(warnings, []);
    assert.ok(meta.data_impressao);
    assert.equal(meta.data_impressao?.getFullYear(), 2026);
    assert.equal(meta.data_impressao?.getMonth(), 5); // junho = índice 5
    assert.equal(meta.data_impressao?.getDate(), 3);
  });

  it("'Filial:' ausente do PDF (relatório errado/corrompido) — cod_empresa=null, NUNCA 0, com warning", () => {
    const itens = montarItensHeader({ filialLabelY: 700, filialValorY: 700, comFilial: false });
    const linhas = agruparLinhas(itens);
    const warnings: string[] = [];
    const meta = extrairMeta(linhas, "teste.pdf", warnings);

    assert.equal(meta.cod_empresa, null);
    assert.notEqual(meta.cod_empresa, 0);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /cod_empresa não apurado/);
  });

  it("'Filial:' presente mas sem prefixo numérico (formato inesperado) — cod_empresa=null com warning, nunca 0", () => {
    const itens = montarItensHeader({
      filialLabelY: 700,
      filialValorY: 700,
      filialTexto: ["NAVESA", "FORD", "AEROPORTO", "Data", "de", "Impressão:", "03/06/2026"],
    });
    const linhas = agruparLinhas(itens);
    const warnings: string[] = [];
    const meta = extrairMeta(linhas, "teste.pdf", warnings);

    assert.equal(meta.cod_empresa, null);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /cod_empresa não apurado/);
  });

  it("regressão do bug original: com a fragmentação em linhas diferentes, o comportamento ANTIGO (checar só uma linha via startsWith) teria voltado cod_empresa=0 — a extração robusta não pode repetir isso", () => {
    const itens = montarItensHeader({ filialLabelY: 700, filialValorY: 694 });
    const linhas = agruparLinhas(itens);
    const warnings: string[] = [];
    const meta = extrairMeta(linhas, "teste.pdf", warnings);

    assert.notEqual(meta.cod_empresa, 0);
    assert.equal(meta.cod_empresa, 2);
  });
});
