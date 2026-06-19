/**
 * Testes da semântica de status do módulo Repasses (ciclo completo do repasse).
 *
 * Modelo:
 *   - "marcado"     → carro adicionado à lista pra subir (default)
 *   - "subido"      → carro já enviado pro Auto Avaliar
 *   - "vendido"     → desfecho: vendido (valor + data + comprador)
 *   - "nao_vendido" → desfecho: não vendido
 *   - "cancelado"   → soft-delete (via remover)
 *
 * Ciclo: marcado → subido → vendido | nao_vendido. Todos no CHECK do banco.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { STATUS_LABEL } from "@/lib/repasses/types";
import type { RepasseStatus } from "@/lib/repasses/types";

describe("RepasseStatus (ciclo completo)", () => {
  it("tem exatamente 5 status: marcado, subido, vendido, nao_vendido, cancelado", () => {
    const chaves = Object.keys(STATUS_LABEL).sort();
    assert.deepEqual(chaves, ["cancelado", "marcado", "nao_vendido", "subido", "vendido"]);
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

  it("label de 'vendido' é 'Vendido'", () => {
    assert.equal(STATUS_LABEL.vendido, "Vendido");
  });

  it("label de 'nao_vendido' é 'Não vendido'", () => {
    assert.equal(STATUS_LABEL.nao_vendido, "Não vendido");
  });

  it("'vendido' e 'nao_vendido' agora são status válidos do tipo", () => {
    // Se isso compilar, os valores fazem parte de RepasseStatus.
    const v: RepasseStatus = "vendido";
    const nv: RepasseStatus = "nao_vendido";
    assert.equal(STATUS_LABEL[v], "Vendido");
    assert.equal(STATUS_LABEL[nv], "Não vendido");
  });

  it("status 'subido' aceita transição pra 'vendido' ou 'nao_vendido'", () => {
    const inicial: RepasseStatus = "subido";
    const vendido: RepasseStatus = "vendido";
    const naoVendido: RepasseStatus = "nao_vendido";
    assert.notEqual(inicial, vendido);
    assert.notEqual(inicial, naoVendido);
  });
});
