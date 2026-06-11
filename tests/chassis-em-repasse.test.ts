/**
 * Testes da função pura `buildChassisEmRepasseMap`.
 *
 * Cobre construção do Map a partir de rows do Supabase. A query em si
 * (`listChassisEmRepasse`) não é testada aqui — ela só envelopa a chamada
 * + parsing, sem lógica própria que justifique mock pesado.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildChassisEmRepasseMap,
  type RepasseAtivoRow,
} from "@/lib/repasses/chassis-em-repasse";

describe("buildChassisEmRepasseMap", () => {
  it("retorna map vazio quando rows é vazio", () => {
    const map = buildChassisEmRepasseMap([]);
    assert.equal(map.size, 0);
  });

  it("mapeia 1 row pra Map<chassi, id>", () => {
    const rows: RepasseAtivoRow[] = [{ id: 42, chassi: "ABC123" }];
    const map = buildChassisEmRepasseMap(rows);
    assert.equal(map.size, 1);
    assert.equal(map.get("ABC123"), 42);
  });

  it("mapeia N rows preservando todos os pares", () => {
    const rows: RepasseAtivoRow[] = [
      { id: 1, chassi: "AAA" },
      { id: 2, chassi: "BBB" },
      { id: 3, chassi: "CCC" },
    ];
    const map = buildChassisEmRepasseMap(rows);
    assert.equal(map.size, 3);
    assert.equal(map.get("AAA"), 1);
    assert.equal(map.get("BBB"), 2);
    assert.equal(map.get("CCC"), 3);
  });

  it("em caso de chassi duplicado, o último vence (defensivo)", () => {
    const rows: RepasseAtivoRow[] = [
      { id: 1, chassi: "DUP" },
      { id: 2, chassi: "DUP" },
    ];
    const map = buildChassisEmRepasseMap(rows);
    assert.equal(map.size, 1);
    assert.equal(map.get("DUP"), 2);
  });

  it("chassi inexistente retorna undefined (Map default)", () => {
    const map = buildChassisEmRepasseMap([{ id: 1, chassi: "XYZ" }]);
    assert.equal(map.get("INEXISTENTE"), undefined);
  });
});
