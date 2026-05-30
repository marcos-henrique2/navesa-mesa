import { test } from "node:test";
import assert from "node:assert/strict";
import { calcMargemVenda, agregarMargem } from "@/lib/analytics/margem";
import { venda, custo } from "./_mocks";

test("margem oficial: usa custo_total do relatório de custos", () => {
  const v = venda({ placa: "XYZ1A11", valor_venda: 100000 });
  const custos = { XYZ1A11: custo({ placa: "XYZ1A11", custo_total: 80500, valor_vendido: 100000 }) };
  const m = calcMargemVenda(v, custos);
  assert.equal(m.fonte, "oficial");
  assert.equal(m.valor, 100000);
  assert.equal(m.custo, 80500);
  assert.equal(m.margem, 19500);
  assert.ok(Math.abs(m.margemPct - 19.5) < 0.001);
});

test("margem oficial: usa valor_vendido do custo (não o valor_venda da venda)", () => {
  // NBS é a fonte da verdade do valor vendido
  const v = venda({ placa: "XYZ1A11", valor_venda: 99999 });
  const custos = { XYZ1A11: custo({ placa: "XYZ1A11", custo_total: 80000, valor_vendido: 100000 }) };
  const m = calcMargemVenda(v, custos);
  assert.equal(m.valor, 100000); // do custo, não 99999
  assert.equal(m.margem, 20000);
});

test("fallback: sem custo oficial usa custo_total_final do parser de vendas", () => {
  const v = venda({ placa: "SEMCUSTO", valor_venda: 100000, custo_total_final: 96000 });
  const m = calcMargemVenda(v, {});
  assert.equal(m.fonte, "fallback");
  assert.equal(m.custo, 96000);
  assert.equal(m.margem, 4000);
  assert.equal(m.componentes, null);
});

test("componentes oficiais são expostos corretamente", () => {
  const v = venda({ placa: "P1" });
  const custos = {
    P1: custo({
      placa: "P1",
      nota_fabrica_taxa_icms: 80000,
      forplan: 3000,
      ganhos_indiretos: 5000,
      custo_total: 79000,
      valor_vendido: 100000,
    }),
  };
  const m = calcMargemVenda(v, custos);
  assert.equal(m.componentes?.nota_fabrica, 80000);
  assert.equal(m.componentes?.forplan, 3000);
  assert.equal(m.componentes?.ganhos_indiretos, 5000);
});

test("agregação soma valor, custo e margem de várias vendas", () => {
  const vendas = [
    venda({ placa: "A1" }),
    venda({ placa: "A2" }),
    venda({ placa: "SEM" }), // fallback
  ];
  const custos = {
    A1: custo({ placa: "A1", custo_total: 80000, valor_vendido: 100000 }),
    A2: custo({ placa: "A2", custo_total: 90000, valor_vendido: 120000 }),
  };
  // ajusta a venda SEM pra ter fallback previsível
  vendas[2] = venda({ placa: "SEM", valor_venda: 50000, custo_total_final: 48000 });

  const agg = agregarMargem(vendas, custos);
  assert.equal(agg.qt, 3);
  assert.equal(agg.qtComCustoOficial, 2);
  assert.equal(agg.valor, 100000 + 120000 + 50000); // 270000
  assert.equal(agg.custo, 80000 + 90000 + 48000); // 218000
  assert.equal(agg.margem, 52000);
  // cobertura = 2 oficiais de 3 vendas
  assert.ok(Math.abs(agg.cobertura - 2 / 3) < 0.001);
});

test("agregação acumula ganhos indiretos só dos oficiais", () => {
  const vendas = [venda({ placa: "G1" }), venda({ placa: "G2" })];
  const custos = {
    G1: custo({ placa: "G1", ganhos_indiretos: 5000 }),
    G2: custo({ placa: "G2", ganhos_indiretos: 8000 }),
  };
  const agg = agregarMargem(vendas, custos);
  assert.equal(agg.componentes.ganhos_indiretos, 13000);
});
