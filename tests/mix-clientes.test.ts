import { test } from "node:test";
import assert from "node:assert/strict";
import { indexarClientes, chaveCliente } from "@/lib/analytics/clientes";
import { calcularMixClientes } from "@/lib/analytics/mix-clientes";
import { detectarLojista } from "@/lib/analytics/clientes";
import { venda } from "./_mocks";

// Cliente B: PJ recorrente (4 compras no dataset COMPLETO, mas só 2 aparecem no filtro da
// tela) — precisa contar como Lojista porque totalCompras vem de todasVendas, não do filtro.
const clienteBRecorrente = [
  venda({ chassi: "B1", placa: "BBB1111", cliente_codigo: "10001", cliente_nome: "REVENDA RECORRENTE PJ", cliente_tipo: "PJ" }),
  venda({ chassi: "B2", placa: "BBB2222", cliente_codigo: "10001", cliente_nome: "REVENDA RECORRENTE PJ", cliente_tipo: "PJ" }),
  venda({ chassi: "B3", placa: "BBB3333", cliente_codigo: "10001", cliente_nome: "REVENDA RECORRENTE PJ", cliente_tipo: "PJ" }),
  venda({ chassi: "B4", placa: "BBB4444", cliente_codigo: "10001", cliente_nome: "REVENDA RECORRENTE PJ", cliente_tipo: "PJ" }),
];

const clienteAPfUnica = venda({ chassi: "A1", placa: "AAA1111", cliente_codigo: "10002", cliente_nome: "JOAO DA SILVA", cliente_tipo: "PF" });

const clienteCPjOcasional = [
  venda({ chassi: "C1", placa: "CCC1111", cliente_codigo: "10003", cliente_nome: "EMPRESA COMPRADORA OCASIONAL SA", cliente_tipo: "PJ" }),
  venda({ chassi: "C2", placa: "CCC2222", cliente_codigo: "10003", cliente_nome: "EMPRESA COMPRADORA OCASIONAL SA", cliente_tipo: "PJ" }),
];

const clienteDNomeRevenda = venda({ chassi: "D1", placa: "DDD1111", cliente_codigo: "10004", cliente_nome: "D AUTOMOVEIS COMERCIO", cliente_tipo: "PF" });

const clienteESemNome = venda({ chassi: "E1", placa: "EEE1111", cliente_codigo: "10005", cliente_nome: "", cliente_tipo: "PJ" });

const todasVendas = [...clienteBRecorrente, clienteAPfUnica, ...clienteCPjOcasional, clienteDNomeRevenda, clienteESemNome];

test("calcularMixClientes: usa totalCompras do dataset COMPLETO (não do filtro) pra classificar recorrência", () => {
  const clientesIndex = indexarClientes(todasVendas);
  // Filtro da tela só mostra 2 das 4 vendas do cliente B recorrente.
  const filtrado = [clienteBRecorrente[0], clienteBRecorrente[1], clienteAPfUnica];
  const mix = calcularMixClientes(filtrado, clientesIndex);

  assert.equal(mix.total, 3);
  assert.equal(mix.lojista, 2); // as 2 vendas do cliente B, que é lojista (4 compras no dataset completo)
  assert.equal(mix.consumidorFinal, 1); // cliente A, PF única
});

test("calcularMixClientes: PJ ocasional (1-3 compras, sem termo de revenda) NÃO é lojista", () => {
  const clientesIndex = indexarClientes(todasVendas);
  const mix = calcularMixClientes(clienteCPjOcasional, clientesIndex);
  assert.equal(mix.total, 2);
  assert.equal(mix.lojista, 0);
  assert.equal(mix.consumidorFinal, 2);
});

test("calcularMixClientes: nome com termo de revenda é lojista mesmo sendo PF e compra única", () => {
  const clientesIndex = indexarClientes(todasVendas);
  const mix = calcularMixClientes([clienteDNomeRevenda], clientesIndex);
  assert.equal(mix.lojista, 1);
  assert.equal(mix.consumidorFinal, 0);
});

test("calcularMixClientes: cliente sem cliente_nome não quebra e cai em Consumidor final", () => {
  const clientesIndex = indexarClientes(todasVendas);
  const mix = calcularMixClientes([clienteESemNome], clientesIndex);
  assert.equal(mix.total, 1);
  assert.equal(mix.lojista, 0);
  assert.equal(mix.consumidorFinal, 1);
});

test("calcularMixClientes: filtro reduz pra 0 vendas => estado vazio consistente (sem NaN)", () => {
  const clientesIndex = indexarClientes(todasVendas);
  const mix = calcularMixClientes([], clientesIndex);
  assert.deepEqual(mix, { lojista: 0, consumidorFinal: 0, total: 0, pctLojista: 0, pctConsumidorFinal: 0 });
});

test("calcularMixClientes: soma das categorias bate exatamente com o total filtrado (AC5)", () => {
  const clientesIndex = indexarClientes(todasVendas);
  const mix = calcularMixClientes(todasVendas, clientesIndex);
  assert.equal(mix.lojista + mix.consumidorFinal, todasVendas.length);
  assert.equal(mix.total, todasVendas.length);
});

test("calcularMixClientes: não reimplementa a regra — bate 1:1 com detectarLojista() chamada diretamente pra cada venda", () => {
  const clientesIndex = indexarClientes(todasVendas);
  let lojistaEsperado = 0;
  let consumidorFinalEsperado = 0;
  for (const v of todasVendas) {
    const totalCompras = clientesIndex.get(chaveCliente(v))?.totalCompras ?? 1;
    if (detectarLojista(v, totalCompras) === "SIM") lojistaEsperado++;
    else consumidorFinalEsperado++;
  }

  const mix = calcularMixClientes(todasVendas, clientesIndex);
  assert.equal(mix.lojista, lojistaEsperado);
  assert.equal(mix.consumidorFinal, consumidorFinalEsperado);
});
