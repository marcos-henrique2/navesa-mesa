/**
 * Testes da lógica pura da seção "Ordem de exportação" do modal de Relatório
 * de Estoque Customizado (ConfigurarRelatorioEstoqueModal).
 *
 * Cobre: reconciliação (remove tokens ausentes da seleção, anexa no fim os
 * presentes na seleção mas ausentes da ordem — inclusive a migração em bloco
 * de quem já tinha seleção salva antes desta feature), resolução de itens
 * exibíveis (label + tag de grupo/"Branco"), mover item (sem wrap-around) e
 * tradução da ordem pros tokens que `construirDefEstoque` entende.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ariaLabelMoverItem,
  idBrancoDoToken,
  itensOrdemExportacao,
  mensagemItemMovido,
  moverItemOrdem,
  reconciliarOrdemColunas,
  resolverOrdemParaExportacao,
  tokenBranco,
  tokenColuna,
} from "@/lib/export/ordem-colunas-estoque";
import type { ColunaBranco } from "@/lib/export/colunas-branco";
import { COLUNAS_ESTOQUE, type ColunaKey } from "@/lib/export/colunas-estoque";

const branco = (id: string, nome: string): ColunaBranco => ({ id, nome });

describe("tokenColuna / tokenBranco", () => {
  it("tokens têm prefixo distinto e carregam a identidade", () => {
    assert.equal(tokenColuna("placa"), "col:placa");
    assert.equal(tokenBranco("abc-123"), "branco:abc-123");
    assert.equal(idBrancoDoToken(tokenBranco("abc-123")), "abc-123");
  });
});

describe("reconciliarOrdemColunas", () => {
  it("ordem vazia + seleção nova: anexa tudo na ordem do CATÁLOGO (migração em bloco)", () => {
    const next = reconciliarOrdemColunas([], ["margem", "placa", "modelo"], []);
    // Ordem do catálogo: placa < modelo < margem (ver COLUNAS_ESTOQUE).
    assert.deepEqual(next, [tokenColuna("placa"), tokenColuna("modelo"), tokenColuna("margem")]);
  });

  it("remove da ordem qualquer coluna desmarcada", () => {
    const ordemAtual = [tokenColuna("placa"), tokenColuna("modelo"), tokenColuna("km")];
    const next = reconciliarOrdemColunas(ordemAtual, ["placa", "km"], []);
    assert.deepEqual(next, [tokenColuna("placa"), tokenColuna("km")]);
  });

  it("coluna nova marcada entra sempre no FIM, preservando a ordem já existente", () => {
    const ordemAtual = [tokenColuna("modelo"), tokenColuna("placa")]; // ordem customizada pelo usuário
    const next = reconciliarOrdemColunas(ordemAtual, ["modelo", "placa", "km"], []);
    assert.deepEqual(next, [tokenColuna("modelo"), tokenColuna("placa"), tokenColuna("km")]);
  });

  it("desmarcar e remarcar a MESMA coluna faz ela voltar pro FIM (não pra posição antiga)", () => {
    const ordemInicial = [tokenColuna("modelo"), tokenColuna("placa"), tokenColuna("km")];
    // Desmarca "placa".
    const semPlaca = reconciliarOrdemColunas(ordemInicial, ["modelo", "km"], []);
    assert.deepEqual(semPlaca, [tokenColuna("modelo"), tokenColuna("km")]);
    // Remarca "placa" — a reconciliação parte do resultado ANTERIOR (já sem o
    // token), não do array bruto original, por isso ela entra no fim.
    const comPlacaDeNovo = reconciliarOrdemColunas(semPlaca, ["modelo", "km", "placa"], []);
    assert.deepEqual(comPlacaDeNovo, [tokenColuna("modelo"), tokenColuna("km"), tokenColuna("placa")]);
  });

  it("colunas em branco nomeadas entram na ordem; sem nome são ignoradas", () => {
    const b1 = branco("b1", "Observações");
    const b2 = branco("b2", "   "); // sem nome (só espaços)
    const next = reconciliarOrdemColunas([], ["placa"], [b1, b2]);
    assert.deepEqual(next, [tokenColuna("placa"), tokenBranco("b1")]);
  });

  it("branco que perde o nome (fica vazio) some da ordem", () => {
    const b1 = branco("b1", "Observações");
    const ordemAtual = reconciliarOrdemColunas([], ["placa"], [b1]);
    const b1SemNome = branco("b1", "");
    const next = reconciliarOrdemColunas(ordemAtual, ["placa"], [b1SemNome]);
    assert.deepEqual(next, [tokenColuna("placa")]);
  });

  it("branco renomeado (nome não-vazio) mantém a posição — token é o id, não o nome", () => {
    const b1 = branco("b1", "Observações");
    const ordemAtual = reconciliarOrdemColunas([], ["placa"], [b1]);
    const b1Renomeado = branco("b1", "Conferido por");
    const next = reconciliarOrdemColunas(ordemAtual, ["placa"], [b1Renomeado]);
    assert.deepEqual(next, ordemAtual);
  });

  it("é pura: não muta os arrays recebidos", () => {
    const ordemAtual = [tokenColuna("placa")];
    const colunasSel: ColunaKey[] = ["placa", "modelo"];
    const colunasBranco = [branco("b1", "Observações")];
    reconciliarOrdemColunas(ordemAtual, colunasSel, colunasBranco);
    assert.deepEqual(ordemAtual, [tokenColuna("placa")]);
    assert.deepEqual(colunasSel, ["placa", "modelo"]);
    assert.deepEqual(colunasBranco, [branco("b1", "Observações")]);
  });
});

describe("itensOrdemExportacao", () => {
  it("resolve token de coluna pro label + grupo do catálogo", () => {
    const itens = itensOrdemExportacao([tokenColuna("cor_externa")], []);
    assert.equal(itens.length, 1);
    assert.equal(itens[0]!.label, "Cor");
    assert.equal(itens[0]!.tagGrupo, "Identificação");
  });

  it("resolve token de branco pro nome + tag 'Branco'", () => {
    const b1 = branco("b1", "Observações");
    const itens = itensOrdemExportacao([tokenBranco("b1")], [b1]);
    assert.equal(itens.length, 1);
    assert.equal(itens[0]!.label, "Observações");
    assert.equal(itens[0]!.tagGrupo, "Branco");
  });

  it("preserva a sequência dos tokens recebidos", () => {
    const b1 = branco("b1", "Observações");
    const itens = itensOrdemExportacao([tokenColuna("km"), tokenBranco("b1"), tokenColuna("placa")], [b1]);
    assert.deepEqual(itens.map((i) => i.label), ["KM", "Observações", "Placa"]);
  });

  it("token que não resolve (branco removido/sem nome) é omitido, defensivamente", () => {
    const itens = itensOrdemExportacao([tokenColuna("placa"), tokenBranco("fantasma")], []);
    assert.equal(itens.length, 1);
    assert.equal(itens[0]!.label, "Placa");
  });
});

describe("moverItemOrdem", () => {
  const ordem = [tokenColuna("placa"), tokenColuna("modelo"), tokenColuna("km")];

  it("move pra cima troca com o anterior", () => {
    assert.deepEqual(moverItemOrdem(ordem, 1, "cima"), [
      tokenColuna("modelo"),
      tokenColuna("placa"),
      tokenColuna("km"),
    ]);
  });

  it("move pra baixo troca com o próximo", () => {
    assert.deepEqual(moverItemOrdem(ordem, 1, "baixo"), [
      tokenColuna("placa"),
      tokenColuna("km"),
      tokenColuna("modelo"),
    ]);
  });

  it("1º item pra cima é no-op (sem wrap-around)", () => {
    assert.deepEqual(moverItemOrdem(ordem, 0, "cima"), ordem);
  });

  it("último item pra baixo é no-op (sem wrap-around)", () => {
    assert.deepEqual(moverItemOrdem(ordem, 2, "baixo"), ordem);
  });

  it("índice fora da faixa é no-op", () => {
    assert.deepEqual(moverItemOrdem(ordem, 99, "cima"), ordem);
    assert.deepEqual(moverItemOrdem(ordem, -1, "baixo"), ordem);
  });

  it("é pura: não muta o array recebido", () => {
    const original = [...ordem];
    moverItemOrdem(ordem, 1, "cima");
    assert.deepEqual(ordem, original);
  });
});

describe("ariaLabelMoverItem / mensagemItemMovido", () => {
  it("aria-label segue o formato exato pedido pela UX", () => {
    assert.equal(
      ariaLabelMoverItem("Cor", 2, 5, "cima"),
      "Mover Cor para cima (posição 2 de 5)",
    );
    assert.equal(
      ariaLabelMoverItem("Cor", 2, 5, "baixo"),
      "Mover Cor para baixo (posição 2 de 5)",
    );
  });

  it("mensagem do aria-live segue o formato exato pedido pela UX", () => {
    assert.equal(mensagemItemMovido("Cor", 3, 5), "Cor movida para a posição 3 de 5.");
  });
});

describe("resolverOrdemParaExportacao", () => {
  it("tokens de coluna passam direto", () => {
    const next = resolverOrdemParaExportacao([tokenColuna("placa"), tokenColuna("km")], []);
    assert.deepEqual(next, ["col:placa", "col:km"]);
  });

  it("token de branco vira índice (0-based) dentro da lista de NOMEADOS", () => {
    const b1 = branco("b1", "Observações");
    const b2 = branco("b2", "Anotações");
    // colunasBranco na ordem de criação: b1, b2 — índices 0 e 1.
    const next = resolverOrdemParaExportacao([tokenBranco("b2"), tokenColuna("placa"), tokenBranco("b1")], [
      b1,
      b2,
    ]);
    assert.deepEqual(next, ["branco:1", "col:placa", "branco:0"]);
  });

  it("brancos SEM nome não contam pro índice (mesmo filtro de colunasBrancoParaExportar)", () => {
    const b1 = branco("b1", "");
    const b2 = branco("b2", "Observações");
    // b1 é filtrado (sem nome) → b2 fica no índice 0, não 1.
    const next = resolverOrdemParaExportacao([tokenBranco("b2")], [b1, b2]);
    assert.deepEqual(next, ["branco:0"]);
  });

  it("token de branco cujo id não existe mais é omitido", () => {
    const next = resolverOrdemParaExportacao([tokenColuna("placa"), tokenBranco("fantasma")], []);
    assert.deepEqual(next, ["col:placa"]);
  });
});

describe("sanidade: catálogo tem as colunas usadas nos testes acima", () => {
  it("placa/modelo/km/margem/cor_externa existem", () => {
    const keys = new Set(COLUNAS_ESTOQUE.map((c) => c.key));
    for (const k of ["placa", "modelo", "km", "margem", "cor_externa"]) {
      assert.ok(keys.has(k as ColunaKey), `${k} deveria existir no catálogo`);
    }
  });
});
