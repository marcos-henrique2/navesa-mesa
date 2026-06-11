/**
 * Testes do helper `mapearErroCriarRepasse`.
 *
 * Cobre a tradução do erro de INSERT em `repasses` pra mensagem amigável.
 * Foco: garantir que o código 23505 (unique_violation — disparado pelo
 * índice parcial `repasses_chassi_subido_uniq` da migration 009) vira a
 * mensagem certa pro Marcos, em pt-BR.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapearErroCriarRepasse } from "@/lib/repasses/erros";

describe("mapearErroCriarRepasse", () => {
  it("traduz erro 23505 (unique_violation) pra mensagem amigável", () => {
    const erro = {
      code: "23505",
      message:
        'duplicate key value violates unique constraint "repasses_chassi_subido_uniq"',
    };
    const msg = mapearErroCriarRepasse(erro);
    assert.equal(msg, "Este carro já tem um repasse ativo. Veja em /repasses.");
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
    assert.equal(msg, "Este carro já tem um repasse ativo. Veja em /repasses.");
  });
});
