/**
 * Testes das estatísticas de modelo (benchmarking histórico).
 *
 * Garante:
 *   - Filtra vendas pelo modelo normalizado (uppercase + trim + colapsa espaços)
 *   - Retorna stats vazias com qt=0 se não há histórico do modelo
 *   - Calcula médias só sobre dados válidos
 *   - "Mês de referência" usa a data mais recente do dataset (não Date.now)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calcularEstatisticasModelo } from "@/lib/pricing/estatisticas-modelo";
import { venda, custo, veiculo } from "./_mocks";
import type { CustoDetalhado } from "@/lib/parsers/nbs-custos-xls";

function mapaCustos(...custos: CustoDetalhado[]): Record<string, CustoDetalhado> {
  return Object.fromEntries(custos.map((c) => [c.placa, c]));
}

describe("calcularEstatisticasModelo", () => {
  it("retorna 0 vendas se não há histórico do modelo", () => {
    const v = veiculo({ modelo: "MODELO INEDITO" });
    const stats = calcularEstatisticasModelo(v, [], {});
    assert.equal(stats.qtVendidasTotal, 0);
    assert.equal(stats.precoMedioVenda, null);
  });

  it("filtra vendas só do modelo do veículo (case-insensitive)", () => {
    const v = veiculo({ modelo: "STRADA 1.3 FIREFLY" });
    const vendas = [
      venda({ placa: "A01", modelo: "strada 1.3 firefly", data_venda: new Date("2026-05-10") }),
      venda({ placa: "A02", modelo: "STRADA 1.3 FIREFLY", data_venda: new Date("2026-05-12") }),
      venda({ placa: "A03", modelo: "RANGER 2.0", data_venda: new Date("2026-05-15") }),
    ];
    const stats = calcularEstatisticasModelo(v, vendas, {});
    assert.equal(stats.qtVendidasTotal, 2);
  });

  it("normaliza espaços duplos no modelo", () => {
    const v = veiculo({ modelo: "STRADA  1.3" }); // 2 espaços
    const vendas = [venda({ modelo: "STRADA 1.3", data_venda: new Date("2026-05-10") })];
    const stats = calcularEstatisticasModelo(v, vendas, {});
    assert.equal(stats.qtVendidasTotal, 1);
  });

  it("calcula preço médio só sobre vendas com valor > 0", () => {
    const v = veiculo({ modelo: "STRADA" });
    const vendas = [
      venda({ placa: "A01", modelo: "STRADA", data_venda: new Date("2026-05-10"), valor_venda: 100000 }),
      venda({ placa: "A02", modelo: "STRADA", data_venda: new Date("2026-05-12"), valor_venda: 0 }),
      venda({ placa: "A03", modelo: "STRADA", data_venda: new Date("2026-05-15"), valor_venda: 120000 }),
    ];
    const stats = calcularEstatisticasModelo(v, vendas, {});
    assert.equal(stats.precoMedioVenda, 110000); // só 2 contam
  });

  it("calcula margem média usando valor_venda - custo_total_final", () => {
    const v = veiculo({ modelo: "STRADA" });
    const vendas = [
      venda({ modelo: "STRADA", data_venda: new Date("2026-05-10"), valor_venda: 100000, custo_total_final: 90000 }),
      venda({ modelo: "STRADA", data_venda: new Date("2026-05-12"), valor_venda: 200000, custo_total_final: 180000 }),
    ];
    const stats = calcularEstatisticasModelo(v, vendas, {});
    assert.ok(stats.margemMediaPct);
    // venda 1: (100k - 90k) / 100k = 10%
    // venda 2: (200k - 180k) / 200k = 10%
    // média: 10%
    assert.equal(stats.margemMediaPct.toFixed(1), "10.0");
  });

  it("calcula dias médios em estoque arredondado", () => {
    const v = veiculo({ modelo: "STRADA" });
    const vendas = [
      venda({ modelo: "STRADA", data_venda: new Date("2026-05-10"), dias_estoque: 30 }),
      venda({ modelo: "STRADA", data_venda: new Date("2026-05-12"), dias_estoque: 60 }),
      venda({ modelo: "STRADA", data_venda: new Date("2026-05-15"), dias_estoque: 90 }),
    ];
    const stats = calcularEstatisticasModelo(v, vendas, {});
    assert.equal(stats.diasEstoqueMedio, 60);
  });

  it("calcula floor plan médio quando custos detalhados existem", () => {
    const v = veiculo({ modelo: "STRADA" });
    const vendas = [
      venda({ placa: "A01", modelo: "STRADA", data_venda: new Date("2026-05-10") }),
      venda({ placa: "A02", modelo: "STRADA", data_venda: new Date("2026-05-12") }),
    ];
    const custos = mapaCustos(
      custo({ placa: "A01", forplan: 1000 }),
      custo({ placa: "A02", forplan: 3000 }),
    );
    const stats = calcularEstatisticasModelo(v, vendas, custos);
    assert.equal(stats.floorPlanMedio, 2000);
  });

  it("'Mês de referência' é o último mês com vendas (não Date.now)", () => {
    const v = veiculo({ modelo: "STRADA" });
    // Dataset histórico de 2025
    const vendas = [
      venda({ modelo: "STRADA", data_venda: new Date("2025-12-10") }),
      venda({ modelo: "STRADA", data_venda: new Date("2025-12-20") }),
      venda({ modelo: "STRADA", data_venda: new Date("2025-11-15") }),
    ];
    const stats = calcularEstatisticasModelo(v, vendas, {});
    // qtVendidasMesAtual deveria contar dez/2025 (2 vendas), não junho/2026
    assert.equal(stats.qtVendidasMesAtual, 2);
    assert.match(stats.mesReferenciaLabel, /dez\/2025/);
  });
});
