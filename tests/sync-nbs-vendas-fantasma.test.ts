/**
 * Testes de limpeza de vendas "fantasma" no sync Oracle -> Supabase.
 *
 * Por que existe:
 *   O sync de vendas (sync-vendas.ts) só faz UPSERT em `vendas` — nunca
 *   DELETE. Quando uma venda é desfeita no NBS (cliente devolve, financiamento
 *   cai, veículo reentra como usado numa troca etc), o chassi some da query
 *   de vendas (janela de 90 dias) mas o registro antigo fica órfão em
 *   `vendas` pra sempre — achado do Marcos testando a tela de conferência:
 *   carros que ele sabia estar em estoque apareciam como "Vendido".
 *
 *   Investigação contra o Oracle real (ver diagnóstico manual) mostrou que a
 *   causa não é só o caminho "oficial" de devolução (DATA_DEV_VENDA) — NBS
 *   também cria uma linha NOVA em NBS.VEICULOS a cada reentrada física do
 *   mesmo chassi (ex: comprado de volta como troca), sem popular
 *   DATA_DEV_VENDA na linha antiga. As 4 placas que o Marcos citou (PRB3H00,
 *   SCW1H38, RBW5A50, RFL0A45) se dividiram exatamente assim: 2 tinham
 *   DATA_DEV_VENDA preenchida, 2 não tinham. A regra confiável não é "por que
 *   foi desfeita", é o invariante de negócio: um chassi não pode estar em
 *   estoque E em `vendas` ao mesmo tempo. Por isso `removerVendasFantasma()`
 *   (gravar.ts) reusa a MESMA lista de estoque atual (já validada, 98,7%
 *   recall / 99,9% precisão) que `syncVeiculos()` grava — qualquer chassi
 *   dela que também esteja em `vendas` é removido.
 *
 *   `sanitizarChassisParaRemocao()` é a parte pura e testável sem Supabase:
 *   prepara a lista de chassis (dedup, trim, descarta vazio/null) antes do
 *   DELETE ... WHERE chassi IN (...).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sanitizarChassisParaRemocao } from "../scripts/sync-nbs/gravar";

describe("sanitizarChassisParaRemocao", () => {
  it("lista simples sem duplicatas -> passa direto", () => {
    const r = sanitizarChassisParaRemocao(["8AFAR23L6HJ431193", "LGWFFUA52RH929204"]);
    assert.deepEqual(r, ["8AFAR23L6HJ431193", "LGWFFUA52RH929204"]);
  });

  it("chassi duplicado -> aparece uma única vez", () => {
    const r = sanitizarChassisParaRemocao(["988675116LKJ99712", "988675116LKJ99712"]);
    assert.deepEqual(r, ["988675116LKJ99712"]);
  });

  it("null/undefined/vazio/só espaço -> descartados", () => {
    const r = sanitizarChassisParaRemocao([null, undefined, "", "   ", "9BWBH6BF0M4004169"]);
    assert.deepEqual(r, ["9BWBH6BF0M4004169"]);
  });

  it("espaço nas bordas -> aparado (trim)", () => {
    const r = sanitizarChassisParaRemocao(["  RFL0A45CHASSI  "]);
    assert.deepEqual(r, ["RFL0A45CHASSI"]);
  });

  it("lista vazia -> array vazio", () => {
    assert.deepEqual(sanitizarChassisParaRemocao([]), []);
  });

  it("mesmo chassi com espaços diferentes ao redor -> ainda deduplica após trim", () => {
    const r = sanitizarChassisParaRemocao(["ABC123", " ABC123 ", "ABC123  "]);
    assert.deepEqual(r, ["ABC123"]);
  });
});
