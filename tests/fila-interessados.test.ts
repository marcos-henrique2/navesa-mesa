/**
 * Testes da fila de prioridade dos interessados (lead quente).
 *
 * Cobre: limiar de alta intenção, ordenação (novo + alta intenção no topo,
 * desempate por qtd_visualizacoes desc) e filtros rápidos (chips).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ehAltaIntencao,
  filtrarFilaInteressados,
  LIMIAR_ALTA_INTENCAO,
  ordenarFilaInteressados,
  semContato,
  type ItemFila,
} from "@/lib/leads/fila-interessados";

function item(over: Partial<ItemFila> & { id?: number } = {}): ItemFila & { id: number } {
  return {
    id: over.id ?? 0,
    status_followup: over.status_followup ?? "contatado",
    qtd_visualizacoes: over.qtd_visualizacoes ?? 0,
  };
}

describe("ehAltaIntencao", () => {
  it(`é true a partir de ${LIMIAR_ALTA_INTENCAO} visualizações`, () => {
    assert.equal(ehAltaIntencao(LIMIAR_ALTA_INTENCAO), true);
    assert.equal(ehAltaIntencao(LIMIAR_ALTA_INTENCAO + 5), true);
  });

  it("é false abaixo do limiar", () => {
    assert.equal(ehAltaIntencao(LIMIAR_ALTA_INTENCAO - 1), false);
    assert.equal(ehAltaIntencao(0), false);
  });
});

describe("semContato", () => {
  it("true só pra status 'novo'", () => {
    assert.equal(semContato(item({ status_followup: "novo" })), true);
    assert.equal(semContato(item({ status_followup: "contatado" })), false);
    assert.equal(semContato(item({ status_followup: "fechou" })), false);
  });
});

describe("ordenarFilaInteressados", () => {
  it("coloca 'novo' + alta intenção no topo, depois os demais", () => {
    const lista = [
      item({ id: 1, status_followup: "contatado", qtd_visualizacoes: 9 }), // demais (contatado)
      item({ id: 2, status_followup: "novo", qtd_visualizacoes: 5 }), // quente
      item({ id: 3, status_followup: "novo", qtd_visualizacoes: 1 }), // novo mas baixa intenção → demais
      item({ id: 4, status_followup: "novo", qtd_visualizacoes: 8 }), // quente
    ];
    const ord = ordenarFilaInteressados(lista);
    // Tier 0 (novo + alta): id 4 (8 views) antes de id 2 (5 views).
    assert.deepEqual(
      ord.map((i) => i.id),
      [4, 2, 1, 3],
    );
  });

  it("desempata por qtd_visualizacoes desc dentro do mesmo tier", () => {
    const lista = [
      item({ id: 1, status_followup: "contatado", qtd_visualizacoes: 2 }),
      item({ id: 2, status_followup: "contatado", qtd_visualizacoes: 7 }),
      item({ id: 3, status_followup: "contatado", qtd_visualizacoes: 4 }),
    ];
    const ord = ordenarFilaInteressados(lista);
    assert.deepEqual(
      ord.map((i) => i.id),
      [2, 3, 1],
    );
  });

  it("não muta a lista original", () => {
    const lista = [
      item({ id: 1, qtd_visualizacoes: 1 }),
      item({ id: 2, qtd_visualizacoes: 9 }),
    ];
    const snapshot = lista.map((i) => i.id);
    ordenarFilaInteressados(lista);
    assert.deepEqual(
      lista.map((i) => i.id),
      snapshot,
    );
  });
});

describe("filtrarFilaInteressados", () => {
  const lista = [
    item({ id: 1, status_followup: "novo", qtd_visualizacoes: 5 }),
    item({ id: 2, status_followup: "contatado", qtd_visualizacoes: 5 }),
    item({ id: 3, status_followup: "novo", qtd_visualizacoes: 1 }),
    item({ id: 4, status_followup: "fechou", qtd_visualizacoes: 0 }),
  ];

  it("sem filtro retorna todos", () => {
    assert.equal(filtrarFilaInteressados(lista, {}).length, 4);
  });

  it("filtro alta intenção mantém só >= limiar", () => {
    const r = filtrarFilaInteressados(lista, { altaIntencao: true });
    assert.deepEqual(r.map((i) => i.id), [1, 2]);
  });

  it("filtro sem contato mantém só 'novo'", () => {
    const r = filtrarFilaInteressados(lista, { semContato: true });
    assert.deepEqual(r.map((i) => i.id), [1, 3]);
  });

  it("filtros combinados: alta intenção E sem contato", () => {
    const r = filtrarFilaInteressados(lista, { altaIntencao: true, semContato: true });
    assert.deepEqual(r.map((i) => i.id), [1]);
  });
});
