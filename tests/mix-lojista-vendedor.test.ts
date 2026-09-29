import { test } from "node:test";
import assert from "node:assert/strict";
import { mixLojistaPorVendedor } from "@/lib/analytics/insights";
import { detectarLojista, indexarClientes, chaveCliente } from "@/lib/analytics/clientes";
import type { VendaParsed } from "@/lib/parsers/nbs-vendas-xlsx";
import { venda } from "./_mocks";

/** Classifica manualmente usando a MESMA fonte de qtCompras que a produção usa
 * (clientesIndex.totalCompras via indexarClientes sobre o dataset completo), sem
 * duplicar a lógica de detectarLojista/mixLojistaPorVendedor. */
function classificarDireto(vendas: VendaParsed[], v: VendaParsed): "SIM" | "NÃO" {
  const idx = indexarClientes(vendas);
  const totalCompras = idx.get(chaveCliente(v))?.totalCompras ?? 1;
  return detectarLojista(v, totalCompras);
}

test("agrupa por vendedor e cruza com detectarLojista() sem duplicar a lógica", () => {
  const vendas = [
    venda({ placa: "P1", vendedor_nome: "JOAO", cliente_codigo: "C1", cliente_nome: "AUTO VEICULOS LTDA", cliente_tipo: "PJ" }),
    venda({ placa: "P2", vendedor_nome: "JOAO", cliente_codigo: "C2", cliente_nome: "MARIA SILVA", cliente_tipo: "PF" }),
    venda({ placa: "P3", vendedor_nome: "JOAO", cliente_codigo: "C2", cliente_nome: "MARIA SILVA", cliente_tipo: "PF" }),
    venda({ placa: "P4", vendedor_nome: "JOAO", cliente_codigo: "C2", cliente_nome: "MARIA SILVA", cliente_tipo: "PF" }),
    venda({ placa: "P5", vendedor_nome: "JOAO", cliente_codigo: "C2", cliente_nome: "MARIA SILVA", cliente_tipo: "PF" }),
    venda({ placa: "P6", vendedor_nome: "JOAO", cliente_codigo: "C2", cliente_nome: "MARIA SILVA", cliente_tipo: "PF" }),
  ];

  // Confere que a contagem de lojista bate com detectarLojista() chamada direta
  // pra cada venda (sem lógica duplicada) — mesma fonte de qtCompras (indexarClientes).
  const qtLojistaEsperado = vendas.filter((v) => classificarDireto(vendas, v) === "SIM").length;

  const { ranking } = mixLojistaPorVendedor(vendas, { minVendas: 5 });
  assert.equal(ranking.length, 1);
  assert.equal(ranking[0].vendedor, "JOAO");
  assert.equal(ranking[0].qt, 6);
  assert.equal(ranking[0].qtLojista, qtLojistaEsperado);
  assert.equal(ranking[0].qtLojista, 1); // só a venda PJ com nome de revenda
  assert.equal(ranking[0].qtNaoLojista, 5);
  assert.ok(Math.abs(ranking[0].pctLojista - (1 / 6) * 100) < 0.001);
});

test("piso mínimo: vendedor abaixo de minVendas cai em insuficientes, sem % ", () => {
  const vendas = [
    venda({ placa: "P1", vendedor_nome: "ANA" }),
    venda({ placa: "P2", vendedor_nome: "ANA" }),
    venda({ placa: "P3", vendedor_nome: "BETO" }),
    venda({ placa: "P4", vendedor_nome: "BETO" }),
    venda({ placa: "P5", vendedor_nome: "BETO" }),
    venda({ placa: "P6", vendedor_nome: "BETO" }),
    venda({ placa: "P7", vendedor_nome: "BETO" }),
  ];
  const { ranking, insuficientes } = mixLojistaPorVendedor(vendas, { minVendas: 5 });
  assert.equal(ranking.length, 1);
  assert.equal(ranking[0].vendedor, "BETO");
  assert.equal(insuficientes.length, 1);
  assert.deepEqual(insuficientes[0], { vendedor: "ANA", qt: 2 });
});

test("ranking ordena desc por % Lojista", () => {
  const vendas = [
    // CARLOS: 5 vendas, 1 lojista (20%)
    venda({ placa: "P1", vendedor_nome: "CARLOS", cliente_codigo: "L1", cliente_nome: "REVENDA MOTORS LTDA", cliente_tipo: "PJ" }),
    venda({ placa: "P2", vendedor_nome: "CARLOS", cliente_codigo: "L2", cliente_nome: "PESSOA UM" }),
    venda({ placa: "P3", vendedor_nome: "CARLOS", cliente_codigo: "L3", cliente_nome: "PESSOA DOIS" }),
    venda({ placa: "P4", vendedor_nome: "CARLOS", cliente_codigo: "L4", cliente_nome: "PESSOA TRES" }),
    venda({ placa: "P5", vendedor_nome: "CARLOS", cliente_codigo: "L5", cliente_nome: "PESSOA QUATRO" }),
    // DIEGO: 5 vendas, 5 lojista (100%)
    venda({ placa: "P6", vendedor_nome: "DIEGO", cliente_codigo: "L6", cliente_nome: "COMERCIO DE VEICULOS LTDA", cliente_tipo: "PJ" }),
    venda({ placa: "P7", vendedor_nome: "DIEGO", cliente_codigo: "L7", cliente_nome: "AUTOMOVEIS LTDA", cliente_tipo: "PJ" }),
    venda({ placa: "P8", vendedor_nome: "DIEGO", cliente_codigo: "L8", cliente_nome: "MULTIMARCAS LTDA", cliente_tipo: "PJ" }),
    venda({ placa: "P9", vendedor_nome: "DIEGO", cliente_codigo: "L9", cliente_nome: "RODOCAR LTDA", cliente_tipo: "PJ" }),
    venda({ placa: "P10", vendedor_nome: "DIEGO", cliente_codigo: "L10", cliente_nome: "AUTOFINANCE LTDA", cliente_tipo: "PJ" }),
  ];
  const { ranking } = mixLojistaPorVendedor(vendas, { minVendas: 5 });
  assert.equal(ranking[0].vendedor, "DIEGO");
  assert.equal(ranking[0].pctLojista, 100);
  assert.equal(ranking[1].vendedor, "CARLOS");
  assert.equal(ranking[1].pctLojista, 20);
});

test("fallback de nome do vendedor: usa vendedor_codigo, senão '—' (nunca 'Sem vendedor')", () => {
  const vendas = [
    venda({ placa: "P1", vendedor_nome: null, vendedor_codigo: "V99" }),
    venda({ placa: "P2", vendedor_nome: null, vendedor_codigo: null }),
    venda({ placa: "P3", vendedor_nome: null, vendedor_codigo: null }),
  ];
  const { insuficientes } = mixLojistaPorVendedor(vendas, { minVendas: 5 });
  const nomes = insuficientes.map((v) => v.vendedor);
  assert.ok(nomes.includes("V99"));
  assert.ok(nomes.includes("—"));
  assert.ok(!nomes.some((n) => n.toLowerCase().includes("sem vendedor")));
});

test("vendedor 100% lojista ou 100% não-lojista não quebra (sem NaN)", () => {
  const soLojista = Array.from({ length: 5 }, (_, i) =>
    venda({ placa: `L${i}`, vendedor_nome: "SOLOJISTA", cliente_codigo: `LJ${i}`, cliente_nome: "REVENDA LTDA", cliente_tipo: "PJ" }),
  );
  const soFinal = Array.from({ length: 5 }, (_, i) =>
    venda({ placa: `F${i}`, vendedor_nome: "SOFINAL", cliente_codigo: `CF${i}`, cliente_nome: `PESSOA ${i}` }),
  );
  const { ranking } = mixLojistaPorVendedor([...soLojista, ...soFinal], { minVendas: 5 });
  const lojista = ranking.find((r) => r.vendedor === "SOLOJISTA")!;
  const final = ranking.find((r) => r.vendedor === "SOFINAL")!;
  assert.equal(lojista.pctLojista, 100);
  assert.equal(final.pctLojista, 0);
});
