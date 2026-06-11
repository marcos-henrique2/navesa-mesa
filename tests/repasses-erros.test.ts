/**
 * Testes do helper `mapearErroCriarRepasse`.
 *
 * Cobre a tradução do erro de INSERT em `repasses` pra mensagem amigável.
 * Foco: garantir que o código 23505 (unique_violation — disparado pelo
 * índice parcial `repasses_chassi_ativo_uniq` da migration 010) vira a
 * mensagem certa pro Marcos, em pt-BR.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  RepasseDuplicadoError,
  criarErroRepasse,
  mapearErroCriarRepasse,
} from "@/lib/repasses/erros";

describe("mapearErroCriarRepasse", () => {
  it("traduz erro 23505 (unique_violation) pra mensagem amigável", () => {
    const erro = {
      code: "23505",
      message:
        'duplicate key value violates unique constraint "repasses_chassi_ativo_uniq"',
    };
    const msg = mapearErroCriarRepasse(erro);
    assert.equal(msg, "Esse carro já está marcado pra subir ou já subiu. Veja em /repasses.");
  });

  it("propaga mensagem original do Supabase quando código não é 23505", () => {
    const erro = { code: "23503", message: "violates foreign key constraint" };
    const msg = mapearErroCriarRepasse(erro);
    assert.equal(
      msg,
      "Falha ao criar repasse: violates foreign key constraint",
    );
  });

  it("usa fallback 'sem dados' quando erro vem sem message", () => {
    const erro = { code: "08006" };
    const msg = mapearErroCriarRepasse(erro);
    assert.equal(msg, "Falha ao criar repasse: sem dados");
  });

  it("trata error null (caso !data sem erro explícito)", () => {
    const msg = mapearErroCriarRepasse(null);
    assert.equal(msg, "Falha ao criar repasse: sem dados");
  });

  it("trata error sem code (defensivo — apenas message)", () => {
    const erro = { message: "Network failure" };
    const msg = mapearErroCriarRepasse(erro);
    assert.equal(msg, "Falha ao criar repasse: Network failure");
  });

  it("23505 vence mesmo se a mensagem original for esquisita", () => {
    // Postgres às vezes manda mensagem em inglês — a tradução não depende dela.
    const erro = { code: "23505", message: "foo bar baz" };
    const msg = mapearErroCriarRepasse(erro);
    assert.equal(msg, "Esse carro já está marcado pra subir ou já subiu. Veja em /repasses.");
  });
});

describe("RepasseDuplicadoError + criarErroRepasse", () => {
  it("RepasseDuplicadoError é Error instance e tem name correto", () => {
    const err = new RepasseDuplicadoError();
    assert.ok(err instanceof Error);
    assert.ok(err instanceof RepasseDuplicadoError);
    assert.equal(err.name, "RepasseDuplicadoError");
    assert.match(err.message, /já está marcado pra subir/);
  });

  it("criarErroRepasse com code=23505 retorna RepasseDuplicadoError (instanceof)", () => {
    const erro = {
      code: "23505",
      message: 'duplicate key value violates unique constraint "repasses_chassi_ativo_uniq"',
    };
    const out = criarErroRepasse(erro);
    assert.ok(out instanceof RepasseDuplicadoError);
    // Caller usa instanceof — sem substring matching frágil.
    assert.equal((out as RepasseDuplicadoError).name, "RepasseDuplicadoError");
  });

  it("criarErroRepasse com code != 23505 retorna Error cru (não duplicado)", () => {
    const erro = { code: "23503", message: "violates foreign key constraint" };
    const out = criarErroRepasse(erro);
    assert.ok(out instanceof Error);
    assert.ok(!(out instanceof RepasseDuplicadoError));
    assert.match(out.message, /violates foreign key constraint/);
  });

  it("criarErroRepasse(null) retorna Error genérico, não duplicado", () => {
    const out = criarErroRepasse(null);
    assert.ok(out instanceof Error);
    assert.ok(!(out instanceof RepasseDuplicadoError));
  });

  it("RepasseDuplicadoError aceita mensagem custom", () => {
    const err = new RepasseDuplicadoError("Custom msg");
    assert.equal(err.message, "Custom msg");
    assert.ok(err instanceof RepasseDuplicadoError);
  });
});
