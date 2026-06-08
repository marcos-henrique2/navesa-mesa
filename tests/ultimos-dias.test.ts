/**
 * Testes do resumo dos últimos N dias.
 *
 * Garante:
 *   - Janela usa a venda mais recente do dataset como referência (não Date.now())
 *   - Janela anterior está correta (N dias imediatamente antes)
 *   - Vendas fora da janela não são contadas
 *   - vsAnterior fica null se janela anterior vazia
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resumoUltimosDias } from "@/lib/analytics/ultimos-dias";
import { venda, custo } from "./_mocks";
import type { CustoDetalhado } from "@/lib/parsers/nbs-custos-xls";

function mapaCustos(...custos: CustoDetalhado[]): Record<string, CustoDetalhado> {
  return Object.fromEntries(custos.map((c) => [c.placa, c]));
}

describe("resumoUltimosDias", () => {
  it("retorna null se não há vendas", () => {
    assert.equal(resumoUltimosDias([], {}, 7), null);
  });

  it("usa data da venda mais recente como fim da janela (não Date.now)", () => {
    const v = venda({ data_venda: new Date(2025, 11, 15) });
    const r = resumoUltimosDias([v], {}, 7);
    assert.ok(r);
    // fim deve ser 15/dez/2025 23:59, não o dia atual
    assert.equal(r.fim.getFullYear(), 2025);
    assert.equal(r.fim.getMonth(), 11);
    assert.equal(r.fim.getDate(), 15);
  });

  it("janela de 7 dias cobre 7 dias inclusivos", () => {
    const v = venda({ data_venda: new Date(2026, 4, 15) });
    const r = resumoUltimosDias([v], {}, 7);
    assert.ok(r);
    // inicio = 15/mai - 6 dias = 09/mai
    assert.equal(r.inicio.getDate(), 9);
    assert.equal(r.inicio.getMonth(), 4);
    // fim = 15/mai
    assert.equal(r.fim.getDate(), 15);
  });

  it("conta apenas vendas dentro da janela", () => {
    const vendas = [
      venda({ placa: "A01", data_venda: new Date(2026, 4, 8) }), // fora (1 dia antes do início)
      venda({ placa: "A02", data_venda: new Date(2026, 4, 10) }), // dentro
      venda({ placa: "A03", data_venda: new Date(2026, 4, 15) }), // dentro (fim)
    ];
    const r = resumoUltimosDias(vendas, {}, 7);
    assert.ok(r);
    assert.equal(r.qt, 2);
  });

  it("calcula faturamento, margem e ticket médio corretos", () => {
    const vendas = [
      venda({ placa: "A01", data_venda: new Date(2026, 4, 10), valor_venda: 100000 }),
      venda({ placa: "A02", data_venda: new Date(2026, 4, 12), valor_venda: 200000 }),
    ];
    const custos = mapaCustos(
      custo({ placa: "A01", custo_total: 90000 }),
      custo({ placa: "A02", custo_total: 170000 }),
    );
    const r = resumoUltimosDias(vendas, custos, 7);
    assert.ok(r);
    assert.equal(r.qt, 2);
    assert.equal(r.faturamento, 300000);
    assert.equal(r.margem, 40000); // (100k-90k) + (200k-170k)
    assert.equal(r.margemPct, 40000 / 300000 * 100);
    assert.equal(r.ticketMedio, 150000);
  });

  it("calcula vsAnterior comparando com janela imediatamente anterior", () => {
    const vendas = [
      // Janela anterior: 02-08 mai
      venda({ placa: "A01", data_venda: new Date(2026, 4, 5), valor_venda: 100000 }),
      // Janela atual: 09-15 mai
      venda({ placa: "B01", data_venda: new Date(2026, 4, 10), valor_venda: 150000 }),
      venda({ placa: "B02", data_venda: new Date(2026, 4, 15), valor_venda: 150000 }),
    ];
    const r = resumoUltimosDias(vendas, {}, 7);
    assert.ok(r);
    assert.ok(r.vsAnterior);
    assert.equal(r.vsAnterior.qt.abs, 1); // 2 - 1
    assert.equal(r.vsAnterior.qt.pct, 100); // dobrou
    assert.equal(r.vsAnterior.faturamento.abs, 200000); // 300k - 100k
  });

  it("vsAnterior fica null se não tem vendas na janela anterior", () => {
    const r = resumoUltimosDias([venda({ data_venda: new Date(2026, 4, 15) })], {}, 7);
    assert.ok(r);
    assert.equal(r.vsAnterior, null);
  });

  it("aceita parâmetro de dias configurável", () => {
    const v = venda({ data_venda: new Date(2026, 4, 30) });
    const r = resumoUltimosDias([v], {}, 30);
    assert.ok(r);
    assert.equal(r.dias, 30);
    // inicio = 30/mai - 29 dias = 01/mai
    assert.equal(r.inicio.getDate(), 1);
  });
});
