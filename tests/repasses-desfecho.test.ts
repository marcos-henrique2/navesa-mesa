/**
 * Testes do desfecho da venda (vendido / não vendido / reverter).
 *
 * Como as funções de query chamam getSupabase() (browser-only), seguimos o
 * mesmo padrão dos testes de updateRepasseCampos: validamos os caminhos puros
 * (validação ANTES do request) e os helpers puros extraídos da lógica de update.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validarValorVendido,
  montarObservacaoNaoVendido,
  PAYLOAD_REVERTER_SUBIDO,
  marcarComoVendido,
  rowToRepasse,
  type RepasseRow,
} from "@/lib/repasses/queries";

function buildRow(over: Partial<RepasseRow> = {}): RepasseRow {
  return {
    id: 1,
    chassi: "9BWZZZ377VT004251",
    placa: "ABC1D23",
    modelo: "RANGER XLT",
    marca: "Ford",
    cor: "Branco",
    ano_modelo: 2022,
    ano_fabricacao: 2021,
    km: 85000,
    loja_origem: 2,
    patio_origem: "AEROPORTO",
    valor_aquisicao: 120000,
    valor_subiu: 145000,
    data_subiu: "2026-05-01",
    data_subido: null,
    canal: "auto_avaliar",
    status: "marcado",
    valor_vendido: null,
    data_vendido: null,
    comprador: null,
    ipva_status: null,
    ipva_responsavel: null,
    documentacao_status: null,
    cautelar_status_manual: null,
    valor_subir: null,
    observacoes: null,
    criado_em: "2026-05-01T12:00:00Z",
    atualizado_em: "2026-05-01T12:00:00Z",
    ...over,
  };
}

describe("validarValorVendido", () => {
  it("aceita número finito ≥ 0", () => {
    assert.equal(validarValorVendido(150_000), 150_000);
    assert.equal(validarValorVendido(0), 0);
  });

  it("rejeita valor negativo", () => {
    assert.throws(() => validarValorVendido(-1), /valor_vendido inválido/);
  });

  it("rejeita NaN", () => {
    assert.throws(() => validarValorVendido(Number.NaN), /valor_vendido inválido/);
  });

  it("rejeita Infinity", () => {
    assert.throws(() => validarValorVendido(Number.POSITIVE_INFINITY), /valor_vendido inválido/);
  });

  it("rejeita não-número", () => {
    assert.throws(
      () => validarValorVendido("150000" as unknown as number),
      /valor_vendido inválido/,
    );
  });
});

describe("marcarComoVendido — validação antes do request", () => {
  it("rejeita valor_vendido negativo antes de tocar no banco", async () => {
    await assert.rejects(
      marcarComoVendido(1, { valor_vendido: -100 }),
      /valor_vendido inválido/,
    );
  });

  it("rejeita valor_vendido NaN antes de tocar no banco", async () => {
    await assert.rejects(
      marcarComoVendido(1, { valor_vendido: Number.NaN }),
      /valor_vendido inválido/,
    );
  });
});

describe("montarObservacaoNaoVendido (concat de motivo)", () => {
  it("motivo vazio/ausente → undefined (não toca observacoes)", () => {
    assert.equal(montarObservacaoNaoVendido("nota antiga", ""), undefined);
    assert.equal(montarObservacaoNaoVendido("nota antiga", null), undefined);
    assert.equal(montarObservacaoNaoVendido("nota antiga", "   "), undefined);
    assert.equal(montarObservacaoNaoVendido(null, undefined), undefined);
  });

  it("sem observação prévia → grava só o motivo", () => {
    assert.equal(montarObservacaoNaoVendido(null, "sem propostas"), "sem propostas");
    assert.equal(montarObservacaoNaoVendido("", "sem propostas"), "sem propostas");
    assert.equal(montarObservacaoNaoVendido("  ", "sem propostas"), "sem propostas");
  });

  it("com observação prévia → anexa preservando o que já existia", () => {
    assert.equal(
      montarObservacaoNaoVendido("pneu pra trocar", "valor baixo"),
      "pneu pra trocar | valor baixo",
    );
  });

  it("trima motivo e observação antes de concatenar", () => {
    assert.equal(
      montarObservacaoNaoVendido("  base  ", "  novo  "),
      "base | novo",
    );
  });
});

describe("PAYLOAD_REVERTER_SUBIDO (zera campos de venda)", () => {
  it("seta status='subido' e zera valor_vendido/data_vendido/comprador", () => {
    assert.deepEqual(PAYLOAD_REVERTER_SUBIDO, {
      status: "subido",
      valor_vendido: null,
      data_vendido: null,
      comprador: null,
    });
  });
});

describe("rowToRepasse (desfecho da venda)", () => {
  it("NÃO converte status 'vendido' em 'marcado' (aceita os 5 status válidos)", () => {
    assert.equal(rowToRepasse(buildRow({ status: "vendido" })).status, "vendido");
    assert.equal(rowToRepasse(buildRow({ status: "nao_vendido" })).status, "nao_vendido");
    assert.equal(rowToRepasse(buildRow({ status: "cancelado" })).status, "cancelado");
    assert.equal(rowToRepasse(buildRow({ status: "subido" })).status, "subido");
  });

  it("status realmente inesperado cai no fallback 'marcado'", () => {
    assert.equal(rowToRepasse(buildRow({ status: "xpto" })).status, "marcado");
  });

  it("mapeia valor_vendido/data_vendido/comprador no retorno", () => {
    const r = rowToRepasse(
      buildRow({
        status: "vendido",
        valor_vendido: 150000,
        data_vendido: "2026-06-10",
        comprador: "João Silva",
      }),
    );
    assert.equal(r.valor_vendido, 150000);
    assert.equal(r.data_vendido, "2026-06-10");
    assert.equal(r.comprador, "João Silva");
  });

  it("normaliza valor_vendido NUMERIC vindo como string → number", () => {
    const r = rowToRepasse(buildRow({ status: "vendido", valor_vendido: "150000.50" }));
    assert.equal(r.valor_vendido, 150000.5);
  });

  it("valor_vendido null permanece null", () => {
    assert.equal(rowToRepasse(buildRow({ valor_vendido: null })).valor_vendido, null);
  });
});
