/**
 * Testes da camada de interesses do lead (interesses.ts).
 *
 * As queries chamam getSupabase() (browser-only) — só testamos os caminhos puros
 * (parsedParaItensRpc, type guards, labels) e as validações que disparam Error
 * ANTES do request. Os caminhos felizes ficam pra e2e.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parsedParaItensRpc,
  criarInteresseOferta,
  updateInteresse,
  isOrigem,
  isTipoCarro,
  ORIGEM_LABEL,
  ORIGEM_BADGE,
  TIPO_CARRO_LABEL,
  type ItemImportacaoRpc,
} from "@/lib/leads/interesses";

describe("parsedParaItensRpc (parser → RPC mapping)", () => {
  it("mapeia 1:1 os campos esperados pelo RPC", () => {
    const parsed: ItemImportacaoRpc[] = [
      {
        nome: "spacecar veiculos",
        cidade_uf: "Uberlândia / MG",
        telefone_whatsapp: "5534992190088",
        telefones_raw: "(34) 992190088",
        email: "x@x.com",
        qtd_visualizacoes: 2,
        data_acesso: "21/06/2026 15:24:20",
      },
    ];
    const itens = parsedParaItensRpc(parsed);
    assert.equal(itens.length, 1);
    assert.deepEqual(itens[0], parsed[0]);
  });

  it("preserva nulls (sem inventar default)", () => {
    const itens = parsedParaItensRpc([
      {
        nome: "Fulano",
        cidade_uf: null,
        telefone_whatsapp: null,
        telefones_raw: null,
        email: null,
        qtd_visualizacoes: 1,
        data_acesso: null,
      },
    ]);
    assert.equal(itens[0].cidade_uf, null);
    assert.equal(itens[0].telefone_whatsapp, null);
    assert.equal(itens[0].email, null);
    assert.equal(itens[0].qtd_visualizacoes, 1);
  });

  it("lista vazia → array vazio", () => {
    assert.deepEqual(parsedParaItensRpc([]), []);
  });
});

describe("type guards isOrigem / isTipoCarro", () => {
  it("isOrigem aceita só 'visualizou' e 'oferta'", () => {
    assert.ok(isOrigem("visualizou"));
    assert.ok(isOrigem("oferta"));
    assert.ok(!isOrigem("outro"));
    assert.ok(!isOrigem(null));
    assert.ok(!isOrigem(1));
  });

  it("isTipoCarro aceita só 'repasse' e 'estoque'", () => {
    assert.ok(isTipoCarro("repasse"));
    assert.ok(isTipoCarro("estoque"));
    assert.ok(!isTipoCarro("carro"));
    assert.ok(!isTipoCarro(undefined));
  });
});

describe("labels pt-BR", () => {
  it("ORIGEM_LABEL e ORIGEM_BADGE cobrem ambas as origens", () => {
    assert.equal(ORIGEM_LABEL.visualizou, "Visualizou");
    assert.equal(ORIGEM_LABEL.oferta, "Ofertado");
    assert.match(ORIGEM_BADGE.visualizou, /Visualizou/);
    assert.match(ORIGEM_BADGE.oferta, /Ofertado/);
  });

  it("TIPO_CARRO_LABEL cobre repasse e estoque", () => {
    assert.equal(TIPO_CARRO_LABEL.repasse, "Repasse");
    assert.equal(TIPO_CARRO_LABEL.estoque, "Estoque");
  });
});

describe("criarInteresseOferta — validação (pré-request)", () => {
  it("rejeita modelo_snapshot vazio", async () => {
    await assert.rejects(
      () =>
        criarInteresseOferta({
          leadId: 1,
          tipo_carro: "repasse",
          repasse_id: 10,
          modelo_snapshot: "   ",
        }),
      /modelo_snapshot/,
    );
  });

  it("repasse exige repasse_id", async () => {
    await assert.rejects(
      () =>
        criarInteresseOferta({
          leadId: 1,
          tipo_carro: "repasse",
          modelo_snapshot: "S10 LTZ 2016",
        }),
      /repasse_id é obrigatório/,
    );
  });

  it("estoque exige chassi", async () => {
    await assert.rejects(
      () =>
        criarInteresseOferta({
          leadId: 1,
          tipo_carro: "estoque",
          modelo_snapshot: "S10 LTZ 2016",
        }),
      /chassi é obrigatório/,
    );
  });
});

describe("updateInteresse — validação (pré-request)", () => {
  it("rejeita patch vazio", async () => {
    await assert.rejects(() => updateInteresse(1, {}), /patch vazio/);
  });

  it("rejeita status_followup fora do enum", async () => {
    await assert.rejects(
      // @ts-expect-error — valor inválido proposital
      () => updateInteresse(1, { status_followup: "xpto" }),
      /status_followup inválido/,
    );
  });
});
