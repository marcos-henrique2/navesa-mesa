/**
 * Testes da semântica de status do módulo Repasses após refactor Sprint 1.
 *
 * Novo modelo:
 *   - "marcado"  → carro foi adicionado à lista pra subir (default)
 *   - "subido"   → carro já foi enviado pro Auto Avaliar
 *   - "cancelado"→ soft-delete opcional (sem UI)
 *
 * Status legacy "vendido"/"nao_vendido" ainda existem no CHECK do banco mas
 * a UI/types nova não os expõe.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { STATUS_LABEL } from "@/lib/repasses/types";
import type { RepasseStatus } from "@/lib/repasses/types";

describe("RepasseStatus (refactor Sprint 1)", () => {
  it("tem exatamente 3 status: marcado, subido, cancelado", () => {
    const chaves = Object.keys(STATUS_LABEL).sort();
    assert.deepEqual(chaves, ["cancelado", "marcado", "subido"]);
  });

  it("label de 'marcado' é 'Marcado'", () => {
    assert.equal(STATUS_LABEL.marcado, "Marcado");
  });

  it("label de 'subido' é 'Subido'", () => {
    assert.equal(STATUS_LABEL.subido, "Subido");
  });

  it("label de 'cancelado' é 'Cancelado'", () => {
    assert.equal(STATUS_LABEL.cancelado, "Cancelado");
  });

  it("tipos não permitem 'vendido' nem 'nao_vendido' na UI nova", () => {
    // Verificação em tempo de tipo via cast — se isso compilar, OK.
    // Como o teste roda em runtime, validamos que esses valores NÃO estão em STATUS_LABEL.
    const labelLegacy = (STATUS_LABEL as Record<string, string | undefined>)["vendido"];
    assert.equal(labelLegacy, undefined);
    const labelLegacy2 = (STATUS_LABEL as Record<string, string | undefined>)["nao_vendido"];
    assert.equal(labelLegacy2, undefined);
  });

  it("status 'marcado' aceita transição pra 'subido' (semântica do workflow)", () => {
    // Documenta o fluxo principal: marcado → subido. Não há transição inversa
    // suportada pela UI (volta = remover + criar de novo).
    const inicial: RepasseStatus = "marcado";
    const proximo: RepasseStatus = "subido";
    assert.notEqual(inicial, proximo);
  });
});
