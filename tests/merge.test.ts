import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeVendas, mergeCustos } from "@/lib/store/merge";
import type { VendasParseResult } from "@/lib/parsers/nbs-vendas-xlsx";
import type { CustosParseResult } from "@/lib/parsers/nbs-custos-xls";
import { venda, custo } from "./_mocks";

function vendasResult(vendas: ReturnType<typeof venda>[], ini: string, fim: string): VendasParseResult {
  return {
    meta: {
      arquivo_nome: "teste.xlsx",
      data_geracao: new Date(),
      total_vendas: vendas.length,
      total_lojas: 1,
      total_vendedores: 1,
      periodo_inicio: new Date(ini),
      periodo_fim: new Date(fim),
    },
    vendas,
    warnings: [],
  };
}

test("primeiro upload (estado vazio) traz tudo como novo", () => {
  const r = vendasResult([venda({ placa: "A1", data_venda: new Date("2026-05-10") })], "2026-05-01", "2026-05-31");
  const m = mergeVendas([], null, r);
  assert.equal(m.vendas.length, 1);
  assert.equal(m.delta.novas, 1);
  assert.equal(m.delta.substituidas, 0);
  assert.equal(m.delta.mantidas, 0);
});

test("re-upload do mesmo período substitui as vendas de dentro", () => {
  const existentes = [venda({ placa: "A1", data_venda: new Date("2026-05-10") })];
  const metaExist = vendasResult(existentes, "2026-05-01", "2026-05-31").meta;
  const novo = vendasResult([venda({ placa: "A2", data_venda: new Date("2026-05-15") })], "2026-05-01", "2026-05-31");
  const m = mergeVendas(existentes, metaExist, novo);
  assert.equal(m.vendas.length, 1); // A1 (maio) descartada, A2 (maio) entra
  assert.equal(m.delta.substituidas, 1);
  assert.equal(m.delta.mantidas, 0);
  assert.equal(m.vendas[0].placa, "A2");
});

test("upload de subconjunto mantém histórico fora do período", () => {
  // existente: jan a maio (2 vendas: jan e maio)
  const existentes = [
    venda({ placa: "JAN", data_venda: new Date("2026-01-15") }),
    venda({ placa: "MAI", data_venda: new Date("2026-05-15") }),
  ];
  const metaExist = vendasResult(existentes, "2026-01-01", "2026-05-31").meta;
  // novo: só maio (substitui maio, mantém janeiro)
  const novo = vendasResult([venda({ placa: "MAI2", data_venda: new Date("2026-05-20") })], "2026-05-01", "2026-05-31");
  const m = mergeVendas(existentes, metaExist, novo);
  assert.equal(m.vendas.length, 2); // JAN mantida + MAI2 nova (MAI substituída)
  assert.equal(m.delta.substituidas, 1); // MAI
  assert.equal(m.delta.mantidas, 1); // JAN
  const placas = m.vendas.map((v) => v.placa).sort();
  assert.deepEqual(placas, ["JAN", "MAI2"]);
});

test("período acumulado expande pra cobrir antigo + novo", () => {
  const existentes = [venda({ placa: "MAI", data_venda: new Date("2026-05-15") })];
  const metaExist = vendasResult(existentes, "2026-05-01", "2026-05-31").meta;
  const novo = vendasResult([venda({ placa: "ABR", data_venda: new Date("2026-04-10") })], "2026-04-01", "2026-04-30");
  const m = mergeVendas(existentes, metaExist, novo);
  assert.equal(m.vendas.length, 2);
  // período acumulado deve ir de abril a maio
  assert.ok(m.meta.periodo_inicio!.getTime() <= new Date("2026-04-10").getTime());
  assert.ok(m.meta.periodo_fim!.getTime() >= new Date("2026-05-15").getTime());
});

// ─── CUSTOS ───

function custosResult(custos: ReturnType<typeof custo>[]): CustosParseResult {
  return {
    meta: { arquivo_nome: "c.xls", periodo: null, data_geracao: new Date(), total_vendas: custos.length },
    custos,
    warnings: [],
  };
}

test("mergeCustos: adiciona novas placas e substitui existentes, mantém o resto", () => {
  const existentes = {
    P1: custo({ placa: "P1", custo_total: 80000 }),
    P2: custo({ placa: "P2", custo_total: 90000 }),
  };
  const novo = custosResult([
    custo({ placa: "P2", custo_total: 85000 }), // substitui
    custo({ placa: "P3", custo_total: 70000 }), // nova
  ]);
  const m = mergeCustos(existentes, null, novo);
  assert.equal(Object.keys(m.custosPorPlaca).length, 3); // P1, P2, P3
  assert.equal(m.custosPorPlaca.P2.custo_total, 85000); // atualizado
  assert.equal(m.custosPorPlaca.P1.custo_total, 80000); // mantido
  assert.equal(m.delta.novos, 1);
  assert.equal(m.delta.substituidos, 1);
});
