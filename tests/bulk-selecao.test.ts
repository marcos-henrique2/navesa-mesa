/**
 * Testes da partição do bulk-subir-pra-repasse.
 *
 * Cobre `particionarParaBulkSubir`: dado um set de selecionados + map de
 * chassis em repasse, separa quem é elegível (entra na fila) de quem já
 * tem repasse ativo (ignorado silenciosamente, com toast informativo).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { particionarParaBulkSubir } from "@/lib/repasses/bulk";

type FakeV = { chassi: string; placa: string; modelo: string };

const v = (chassi: string): FakeV => ({
  chassi,
  placa: `P-${chassi}`,
  modelo: `MOD-${chassi}`,
});

describe("particionarParaBulkSubir", () => {
  it("todos elegíveis quando map está vazio", () => {
    const selecionados = [v("AAA"), v("BBB"), v("CCC")];
    const { elegiveis, jaEmRepasse } = particionarParaBulkSubir(
      selecionados,
      new Map(),
    );
    assert.equal(elegiveis.length, 3);
    assert.equal(jaEmRepasse.length, 0);
  });

  it("filtra todos quando todos já estão em repasse", () => {
    const selecionados = [v("AAA"), v("BBB")];
    const map = new Map<string, number>([
      ["AAA", 1],
      ["BBB", 2],
    ]);
    const { elegiveis, jaEmRepasse } = particionarParaBulkSubir(selecionados, map);
    assert.equal(elegiveis.length, 0);
    assert.equal(jaEmRepasse.length, 2);
    assert.deepEqual(
      jaEmRepasse.map((x) => x.chassi),
      ["AAA", "BBB"],
    );
  });

  it("separa elegíveis dos em repasse mantendo ordem original", () => {
    const selecionados = [v("AAA"), v("BBB"), v("CCC"), v("DDD")];
    const map = new Map<string, number>([
      ["BBB", 10],
      ["DDD", 20],
    ]);
    const { elegiveis, jaEmRepasse } = particionarParaBulkSubir(selecionados, map);
    assert.deepEqual(
      elegiveis.map((x) => x.chassi),
      ["AAA", "CCC"],
    );
    assert.deepEqual(
      jaEmRepasse.map((x) => x.chassi),
      ["BBB", "DDD"],
    );
  });

  it("retorna arrays vazios quando seleção é vazia", () => {
    const { elegiveis, jaEmRepasse } = particionarParaBulkSubir([], new Map());
    assert.equal(elegiveis.length, 0);
    assert.equal(jaEmRepasse.length, 0);
  });

  it("preserva tipo genérico dos veículos passados", () => {
    type Rico = { chassi: string; placa: string; modelo: string; extra: number };
    const ricos: Rico[] = [
      { chassi: "AAA", placa: "P1", modelo: "M1", extra: 100 },
      { chassi: "BBB", placa: "P2", modelo: "M2", extra: 200 },
    ];
    const { elegiveis } = particionarParaBulkSubir(
      ricos,
      new Map([["AAA", 1]]),
    );
    assert.equal(elegiveis.length, 1);
    assert.equal(elegiveis[0]?.extra, 200);
  });

  // ─── Q2 (hotfix) — label do botão bulk reflete elegíveis, não total ──────
  it(
    "cenário misto: label do botão usa elegiveis.length, não selecionados.length",
    () => {
      // Marcos seleciona 10 carros; 4 já estão em repasse.
      // Antes do fix, label dizia "Subir 10 pra repasse" (errado).
      // Depois do fix, deve dizer "Subir 6 pra repasse" + sub-texto
      // "4 já em repasse — ignorados".
      const selecionados = [
        v("A1"), v("A2"), v("A3"), v("A4"), v("A5"),
        v("A6"), v("A7"), v("A8"), v("A9"), v("A10"),
      ];
      const emRepasse = new Map<string, number>([
        ["A2", 100], ["A4", 101], ["A6", 102], ["A8", 103],
      ]);

      const previewBulk = particionarParaBulkSubir(selecionados, emRepasse);

      // O label do botão ("Subir N pra repasse") usa previewBulk.elegiveis.length
      assert.equal(
        previewBulk.elegiveis.length,
        6,
        "label deve mostrar 6, não 10 (selecionados.length)",
      );
      // O sub-texto ("X já em repasse — ignorados") usa jaEmRepasse.length
      assert.equal(previewBulk.jaEmRepasse.length, 4);
      assert.equal(selecionados.length, 10); // sanidade
    },
  );

  it("cenário todos elegíveis: botão NÃO mostra sub-texto", () => {
    // Quando jaEmRepasse.length === 0, sub-texto fica oculto.
    const selecionados = [v("A1"), v("A2"), v("A3")];
    const previewBulk = particionarParaBulkSubir(selecionados, new Map());
    assert.equal(previewBulk.elegiveis.length, 3);
    assert.equal(previewBulk.jaEmRepasse.length, 0);
  });
});
