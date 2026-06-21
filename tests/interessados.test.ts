/**
 * Testes das queries/helpers do mini-CRM de interessados.
 *
 * updateInteressado chama getSupabase() (browser-only), então só testamos os
 * caminhos que disparam Error ANTES do request (defesa em profundidade) — mesmo
 * padrão de repasses-inline-edit.test.ts. Os caminhos felizes ficam pra e2e.
 *
 * contarComStatus, isStatusFollowup e os labels são puros e testados direto.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  contarComStatus,
  isStatusFollowup,
  STATUS_FOLLOWUP_LABEL,
  STATUS_FOLLOWUP_VALUES,
  updateInteressado,
  type RepasseInteressado,
  type StatusFollowup,
} from "@/lib/repasses/interessados";

function interessado(over: Partial<RepasseInteressado> = {}): RepasseInteressado {
  return {
    id: 1,
    repasse_id: 1,
    nome: "LOJA X",
    cidade_uf: "SP",
    telefone_whatsapp: "5511988887777",
    telefones_raw: "(11) 988887777",
    email: "x@x.com",
    qtd_visualizacoes: 1,
    data_acesso: null,
    status_followup: "novo",
    observacao: null,
    data_contato: null,
    criado_em: "2026-06-21T00:00:00.000Z",
    atualizado_em: "2026-06-21T00:00:00.000Z",
    ...over,
  };
}

describe("isStatusFollowup", () => {
  it("aceita só os 6 valores do funil", () => {
    assert.equal(isStatusFollowup("novo"), true);
    assert.equal(isStatusFollowup("contatado"), true);
    assert.equal(isStatusFollowup("respondeu"), true);
    assert.equal(isStatusFollowup("negociando"), true);
    assert.equal(isStatusFollowup("fechou"), true);
    assert.equal(isStatusFollowup("perdido"), true);
    assert.equal(isStatusFollowup("vendido"), false); // status de repasse, não do funil
    assert.equal(isStatusFollowup(""), false);
    assert.equal(isStatusFollowup(null), false);
    assert.equal(isStatusFollowup(42), false);
  });
});

describe("STATUS_FOLLOWUP_LABEL", () => {
  it("tem label pt-BR pros 6 valores e bate com VALUES", () => {
    assert.equal(STATUS_FOLLOWUP_LABEL.novo, "Novo");
    assert.equal(STATUS_FOLLOWUP_LABEL.fechou, "Fechou");
    assert.equal(STATUS_FOLLOWUP_LABEL.perdido, "Perdido");
    assert.deepEqual(
      [...STATUS_FOLLOWUP_VALUES].sort(),
      Object.keys(STATUS_FOLLOWUP_LABEL).sort(),
    );
  });
});

describe("contarComStatus", () => {
  it("conta por status retornando todas as chaves (zeradas quando ausentes)", () => {
    const lista = [
      interessado({ id: 1, status_followup: "novo" }),
      interessado({ id: 2, status_followup: "novo" }),
      interessado({ id: 3, status_followup: "negociando" }),
      interessado({ id: 4, status_followup: "fechou" }),
    ];
    const c = contarComStatus(lista);
    assert.equal(c.novo, 2);
    assert.equal(c.negociando, 1);
    assert.equal(c.fechou, 1);
    assert.equal(c.contatado, 0);
    assert.equal(c.respondeu, 0);
    assert.equal(c.perdido, 0);
  });

  it("lista vazia → tudo zero", () => {
    const c = contarComStatus([]);
    const total = (Object.values(c) as number[]).reduce((a, b) => a + b, 0);
    assert.equal(total, 0);
  });
});

describe("updateInteressado — validação (defesa em profundidade)", () => {
  it("rejeita status_followup fora do enum antes de chamar o banco", async () => {
    await assert.rejects(
      updateInteressado(1, { status_followup: "invalido" as unknown as StatusFollowup }),
      /status_followup inválido/,
    );
  });

  it("rejeita observacao não-string", async () => {
    await assert.rejects(
      updateInteressado(1, { observacao: 42 as unknown as string }),
      /observacao inválido/,
    );
  });

  it("rejeita data_contato não-string", async () => {
    await assert.rejects(
      updateInteressado(1, { data_contato: 42 as unknown as string }),
      /data_contato inválido/,
    );
  });

  it("rejeita patch vazio", async () => {
    await assert.rejects(updateInteressado(1, {}), /patch vazio/);
  });
});
