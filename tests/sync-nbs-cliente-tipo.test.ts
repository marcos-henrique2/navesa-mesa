/**
 * Testes de cliente_tipo (PF/PJ) no sync Oracle -> Supabase.
 *
 * Por que existe:
 *   COD_CLIENTE é NUMBER no NBS (o próprio CPF/CNPJ) e perde zeros à
 *   esquerda — a regra antiga (só tamanho do documento) deixava ~38% das
 *   vendas com cliente_tipo NULL. A fonte agora é NBS.CLIENTES.COD_CLASSE
 *   ('F'/'J', via JOIN_CLIENTE_CLASSE), com fallback por tamanho do documento.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapearVenda, resolverTipoCliente } from "../scripts/sync-nbs/mapear-venda";

describe("resolverTipoCliente", () => {
  it("classe explícita F/J decide, mesmo com documento sem zeros à esquerda", () => {
    assert.equal(resolverTipoCliente("F", "1234567890"), "PF");
    assert.equal(resolverTipoCliente("J", "1234567890123"), "PJ");
    assert.equal(resolverTipoCliente(" j ", null), "PJ");
  });

  it("classe explícita prevalece sobre o tamanho do documento", () => {
    assert.equal(resolverTipoCliente("J", "12345678901"), "PJ");
    assert.equal(resolverTipoCliente("F", "12345678000199"), "PF");
  });

  it("fallback CPF: 11 dígitos -> PF (ignora máscara)", () => {
    assert.equal(resolverTipoCliente(null, "12345678901"), "PF");
    assert.equal(resolverTipoCliente(null, "123.456.789-01"), "PF");
  });

  it("fallback CNPJ: 14 dígitos -> PJ (ignora máscara)", () => {
    assert.equal(resolverTipoCliente(null, "12345678000199"), "PJ");
    assert.equal(resolverTipoCliente(null, "12.345.678/0001-99"), "PJ");
  });

  it("sem classe e documento ausente/inválido -> null", () => {
    assert.equal(resolverTipoCliente(null, null), null);
    assert.equal(resolverTipoCliente(null, ""), null);
    assert.equal(resolverTipoCliente(null, "1234567890"), null); // 10 dígitos: ambíguo
    assert.equal(resolverTipoCliente(null, "1234567890123"), null); // 13 dígitos: ambíguo
    assert.equal(resolverTipoCliente("X", "abc"), null);
  });
});

describe("mapearVenda — cliente_tipo", () => {
  it("usa JOIN_CLIENTE_CLASSE quando COD_CLIENTE numérico perdeu zeros", () => {
    assert.equal(mapearVenda({ COD_CLIENTE: 123456789, JOIN_CLIENTE_CLASSE: "F" }).venda.cliente_tipo, "PF");
    assert.equal(mapearVenda({ COD_CLIENTE: 1234567000199, JOIN_CLIENTE_CLASSE: "J" }).venda.cliente_tipo, "PJ");
  });

  it("sem JOIN_CLIENTE_CLASSE cai no fallback por documento", () => {
    assert.equal(mapearVenda({ COD_CLIENTE: 12345678901 }).venda.cliente_tipo, "PF");
    assert.equal(mapearVenda({ COD_CLIENTE: 12345678000199 }).venda.cliente_tipo, "PJ");
    assert.equal(mapearVenda({ COD_CLIENTE: 123456789 }).venda.cliente_tipo, null);
  });

  it("não reporta cliente_tipo como campo sem fonte", () => {
    assert.ok(!mapearVenda({}).camposSemFonte.includes("cliente_tipo"));
  });
});
