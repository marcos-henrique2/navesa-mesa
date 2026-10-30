/**
 * Backfill restrito de vendas.cliente_tipo: decide SÓ os UPDATEs necessários
 * (nunca insere, nunca apaga tipo existente). Ver
 * scripts/sync-nbs/backfill-cliente-tipo.ts.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  decidirBackfillClienteTipo,
  lerOpcoesBackfill,
  type LinhaSupabaseTipo,
  type TipoCliente,
  type VendaOracleTipo,
} from "../scripts/sync-nbs/decidir-backfill-cliente-tipo";

const ora = (chassi: string, tipo: TipoCliente, clienteCodigo: string | null = null): VendaOracleTipo => ({ chassi, tipo, clienteCodigo });
const sb = (pares: [string, TipoCliente, string?][]) =>
  new Map<string, LinhaSupabaseTipo>(pares.map(([c, tipo, cod]) => [c, { tipo, clienteCodigo: cod ?? null }]));

describe("decidirBackfillClienteTipo", () => {
  it("NULL->PF, NULL->PJ, PF->PJ, PJ->PF geram update; igual não gera", () => {
    const { updates, contagens } = decidirBackfillClienteTipo(
      [ora("A", "PF"), ora("B", "PJ"), ora("C", "PJ"), ora("D", "PF"), ora("E", "PF")],
      sb([["A", null], ["B", null], ["C", "PF"], ["D", "PJ"], ["E", "PF"]]),
    );
    assert.deepEqual(updates, [
      { chassi: "A", cliente_tipo: "PF" },
      { chassi: "B", cliente_tipo: "PJ" },
      { chassi: "C", cliente_tipo: "PJ" },
      { chassi: "D", cliente_tipo: "PF" },
    ]);
    assert.equal(contagens.nullParaPF, 1);
    assert.equal(contagens.nullParaPJ, 1);
    assert.equal(contagens.pfParaPJ, 1);
    assert.equal(contagens.pjParaPF, 1);
    assert.equal(contagens.semMudanca, 1);
  });

  it("chassi inexistente no Supabase nunca vira update (sem insert)", () => {
    const { updates, contagens } = decidirBackfillClienteTipo([ora("X", "PF")], sb([["A", null]]));
    assert.deepEqual(updates, []);
    assert.equal(contagens.inexistentesNoSupabase, 1);
  });

  it("Oracle sem tipo resolvível não apaga tipo existente nem mexe em NULL", () => {
    const { updates, contagens } = decidirBackfillClienteTipo([ora("A", null), ora("B", null)], sb([["A", "PJ"], ["B", null]]));
    assert.deepEqual(updates, []);
    assert.equal(contagens.semTipoResolvivel, 2);
  });

  it("chassi repetido com mesmo tipo conta uma vez", () => {
    const { updates, contagens } = decidirBackfillClienteTipo([ora("A", "PF"), ora("A", "PF")], sb([["A", null]]));
    assert.deepEqual(updates, [{ chassi: "A", cliente_tipo: "PF" }]);
    assert.equal(contagens.lidasOracle, 2);
  });

  it("chassi revendido com tipos diferentes: desempata pelo cliente da linha do Supabase (normalizando zeros/máscara)", () => {
    const { updates, contagens } = decidirBackfillClienteTipo(
      [ora("A", "PF", "123456789"), ora("A", "PJ", "12345678000199")],
      sb([["A", null, "001.234.567-89"]]),
    );
    assert.deepEqual(updates, [{ chassi: "A", cliente_tipo: "PF" }]);
    assert.equal(contagens.chassisAmbiguos, 0);
  });

  it("chassi revendido sem desempate possível: ambíguo, pula", () => {
    const { updates, contagens } = decidirBackfillClienteTipo(
      [ora("A", "PF", "111"), ora("A", "PJ", "222")],
      sb([["A", null, "333"]]),
    );
    assert.deepEqual(updates, []);
    assert.equal(contagens.chassisAmbiguos, 1);
  });
});

describe("lerOpcoesBackfill", () => {
  it("sem argumento: dry-run", () => {
    assert.deepEqual(lerOpcoesBackfill([]), { escrever: false });
  });
  it("--escrever liga a escrita", () => {
    assert.deepEqual(lerOpcoesBackfill(["--escrever"]), { escrever: true });
  });
  it("argumento desconhecido ou repetido é rejeitado", () => {
    assert.throws(() => lerOpcoesBackfill(["--write"]), /Argumento desconhecido/);
    assert.throws(() => lerOpcoesBackfill(["--escrever", "--escrever"]), /apenas uma vez/);
  });
});
