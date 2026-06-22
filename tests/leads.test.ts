/**
 * Testes da camada de Leads (leads.ts).
 *
 * updateLead chama getSupabase() (browser-only), então só testamos os caminhos
 * que disparam Error ANTES do request (defesa em profundidade) — mesmo padrão
 * de repasses-inline-edit.test.ts. Os caminhos felizes ficam pra e2e.
 *
 * isStatusRelacionamento, contarComStatusRelacionamento e os labels são puros.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  contarComStatusRelacionamento,
  isStatusRelacionamento,
  updateLead,
  STATUS_RELACIONAMENTO_LABEL,
  STATUS_RELACIONAMENTO_VALUES,
  type Lead,
  type StatusRelacionamento,
} from "@/lib/leads/leads";

function leadStatus(s: StatusRelacionamento): Pick<Lead, "status_relacionamento"> {
  return { status_relacionamento: s };
}

describe("isStatusRelacionamento", () => {
  it("aceita todos os valores do enum", () => {
    for (const v of STATUS_RELACIONAMENTO_VALUES) {
      assert.ok(isStatusRelacionamento(v));
    }
  });

  it("rejeita valores fora do enum e não-strings", () => {
    assert.ok(!isStatusRelacionamento("vendido"));
    assert.ok(!isStatusRelacionamento(""));
    assert.ok(!isStatusRelacionamento(null));
    assert.ok(!isStatusRelacionamento(42));
    assert.ok(!isStatusRelacionamento(undefined));
  });
});

describe("STATUS_RELACIONAMENTO_LABEL", () => {
  it("tem label pt-BR pra cada status", () => {
    for (const v of STATUS_RELACIONAMENTO_VALUES) {
      assert.equal(typeof STATUS_RELACIONAMENTO_LABEL[v], "string");
      assert.ok(STATUS_RELACIONAMENTO_LABEL[v].length > 0);
    }
    assert.equal(STATUS_RELACIONAMENTO_LABEL.novo, "Novo");
    assert.equal(STATUS_RELACIONAMENTO_LABEL.fechou, "Fechou");
  });
});

describe("contarComStatusRelacionamento", () => {
  it("retorna todas as chaves zeradas pra lista vazia", () => {
    const r = contarComStatusRelacionamento([]);
    assert.deepEqual(r, {
      novo: 0,
      contatado: 0,
      respondeu: 0,
      negociando: 0,
      fechou: 0,
      perdido: 0,
    });
  });

  it("conta corretamente por status", () => {
    const r = contarComStatusRelacionamento([
      leadStatus("novo"),
      leadStatus("novo"),
      leadStatus("negociando"),
      leadStatus("fechou"),
    ]);
    assert.equal(r.novo, 2);
    assert.equal(r.negociando, 1);
    assert.equal(r.fechou, 1);
    assert.equal(r.perdido, 0);
  });
});

describe("updateLead — validação (pré-request)", () => {
  it("rejeita patch vazio", async () => {
    await assert.rejects(() => updateLead(1, {}), /patch vazio/);
  });

  it("rejeita status_relacionamento fora do enum", async () => {
    await assert.rejects(
      // @ts-expect-error — valor inválido proposital
      () => updateLead(1, { status_relacionamento: "qualquer" }),
      /status_relacionamento inválido/,
    );
  });
});
