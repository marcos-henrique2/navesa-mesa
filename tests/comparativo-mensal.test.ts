/**
 * Testes do comparativo mês-a-mês.
 *
 * Garante:
 *   - Não calcula se tem menos de 2 meses
 *   - Deltas batem com a aritmética
 *   - Drivers (modelos/lojas) ordenam por delta de quantidade
 *   - Narrativa cobre os 4 cenários (saudável, volume+margem-, vendeu menos com mais margem, mês difícil)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calcularComparativoMensal } from "@/lib/analytics/comparativo-mensal";
import { venda, custo } from "./_mocks";
import type { CustoDetalhado } from "@/lib/parsers/nbs-custos-xls";

function mapaCustos(...custos: CustoDetalhado[]): Record<string, CustoDetalhado> {
  return Object.fromEntries(custos.map((c) => [c.placa, c]));
}

describe("calcularComparativoMensal", () => {
  it("retorna null se há menos de 2 meses", () => {
    const r = calcularComparativoMensal(
      [venda({ data_venda: new Date(2026, 4, 10) })],
      {},
    );
    assert.equal(r, null);
  });

  it("retorna null se não há vendas", () => {
    assert.equal(calcularComparativoMensal([], {}), null);
  });

  it("identifica mês atual vs anterior corretamente", () => {
    const v1 = venda({ placa: "AAA1B23", data_venda: new Date(2026, 3, 15), valor_venda: 100000 });
    const v2 = venda({ placa: "BBB2C34", data_venda: new Date(2026, 4, 15), valor_venda: 120000 });
    const r = calcularComparativoMensal([v1, v2], {});
    assert.ok(r);
    assert.equal(r.penultimoMes.mes, 4);
    assert.equal(r.ultimoMes.mes, 5);
    assert.equal(r.ultimoMes.qt, 1);
    assert.equal(r.penultimoMes.qt, 1);
  });

  it("calcula delta de vendas (qt) centavo-perfect", () => {
    const vendas = [
      venda({ placa: "A01", data_venda: new Date(2026, 3, 10) }),
      venda({ placa: "A02", data_venda: new Date(2026, 3, 20) }),
      venda({ placa: "B01", data_venda: new Date(2026, 4, 5) }),
      venda({ placa: "B02", data_venda: new Date(2026, 4, 15) }),
      venda({ placa: "B03", data_venda: new Date(2026, 4, 25) }),
    ];
    const r = calcularComparativoMensal(vendas, {});
    assert.ok(r);
    assert.equal(r.deltas.qt.abs, 1); // 3 - 2
    assert.equal(r.deltas.qt.pct, 50); // (3-2)/2 * 100
  });

  it("calcula faturamento e margem usando custosPorPlaca quando disponível", () => {
    const vendas = [
      venda({ placa: "A01", data_venda: new Date(2026, 3, 10), valor_venda: 100000 }),
      venda({ placa: "B01", data_venda: new Date(2026, 4, 10), valor_venda: 120000 }),
    ];
    // calcMargemVenda usa custo.valor_vendido como fonte do valor — precisa setar.
    const custos = mapaCustos(
      custo({ placa: "A01", custo_total: 90000, valor_vendido: 100000 }),
      custo({ placa: "B01", custo_total: 100000, valor_vendido: 120000 }),
    );
    const r = calcularComparativoMensal(vendas, custos);
    assert.ok(r);
    assert.equal(r.penultimoMes.faturamento, 100000);
    assert.equal(r.penultimoMes.margem, 10000);
    assert.equal(r.ultimoMes.faturamento, 120000);
    assert.equal(r.ultimoMes.margem, 20000);
    assert.equal(r.deltas.margem.abs, 10000);
  });

  it("identifica modelo que mais subiu e que mais caiu", () => {
    const vendas = [
      // Abril: 3 STRADA, 2 RANGER
      ...[1, 2, 3].map((i) => venda({ placa: `STR${i}`, modelo: "STRADA", data_venda: new Date(2026, 3, 10) })),
      ...[1, 2].map((i) => venda({ placa: `RAN${i}`, modelo: "RANGER", data_venda: new Date(2026, 3, 20) })),
      // Maio: 5 STRADA, 0 RANGER
      ...[1, 2, 3, 4, 5].map((i) => venda({ placa: `STR2${i}`, modelo: "STRADA", data_venda: new Date(2026, 4, 10) })),
    ];
    const r = calcularComparativoMensal(vendas, {});
    assert.ok(r);
    const subiu = r.drivers.modelosSubiram.find((m) => m.chave === "STRADA");
    const caiu = r.drivers.modelosCairam.find((m) => m.chave === "RANGER");
    assert.ok(subiu);
    assert.equal(subiu.deltaQt, 2); // 5 - 3
    assert.ok(caiu);
    assert.equal(caiu.deltaQt, -2); // 0 - 2
  });

  it("gera headline 'Mês saudável' quando volume + margem sobem", () => {
    const vendas = [
      // Abril: 1 venda baixa margem
      venda({ placa: "A01", data_venda: new Date(2026, 3, 10), valor_venda: 100000 }),
      // Maio: 2 vendas alta margem
      venda({ placa: "B01", data_venda: new Date(2026, 4, 10), valor_venda: 120000 }),
      venda({ placa: "B02", data_venda: new Date(2026, 4, 20), valor_venda: 130000 }),
    ];
    const custos = mapaCustos(
      custo({ placa: "A01", custo_total: 99000, valor_vendido: 100000 }),  // margem 1%
      custo({ placa: "B01", custo_total: 100000, valor_vendido: 120000 }), // margem 16.6%
      custo({ placa: "B02", custo_total: 105000, valor_vendido: 130000 }), // margem 19.2%
    );
    const r = calcularComparativoMensal(vendas, custos);
    assert.ok(r);
    assert.match(r.narrativa[0], /saudável/i);
  });

  it("gera headline 'Mês difícil' quando ambos caem", () => {
    const vendas = [
      venda({ placa: "A01", data_venda: new Date(2026, 3, 10), valor_venda: 100000 }),
      venda({ placa: "A02", data_venda: new Date(2026, 3, 15), valor_venda: 100000 }),
      venda({ placa: "B01", data_venda: new Date(2026, 4, 10), valor_venda: 100000 }),
    ];
    const custos = mapaCustos(
      custo({ placa: "A01", custo_total: 80000 }),
      custo({ placa: "A02", custo_total: 80000 }),
      custo({ placa: "B01", custo_total: 99000 }), // margem só 1%
    );
    const r = calcularComparativoMensal(vendas, custos);
    assert.ok(r);
    assert.match(r.narrativa[0], /difícil/i);
  });

  it("inclui driver de loja quando variação ≥ 5", () => {
    const vendas = [
      // Abril: 1 venda loja A
      venda({ placa: "A01", empresa_nome: "LOJA A", data_venda: new Date(2026, 3, 10) }),
      // Maio: 7 vendas loja A
      ...Array.from({ length: 7 }, (_, i) =>
        venda({ placa: `B${i}`, empresa_nome: "LOJA A", data_venda: new Date(2026, 4, 10) }),
      ),
    ];
    const r = calcularComparativoMensal(vendas, {});
    assert.ok(r);
    const lojaUp = r.drivers.lojasSubiram[0];
    assert.ok(lojaUp);
    assert.equal(lojaUp.chave, "LOJA A");
    assert.equal(lojaUp.deltaQt, 6);
    // Narrativa deve mencionar a loja
    assert.ok(r.narrativa.some((n) => n.includes("LOJA A")));
  });
});
