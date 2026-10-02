/**
 * `mapearLinha` (src/lib/export/vendas-matriz/coletar-dados.ts) — montagem da linha
 * bruta (K, L, N, O, S, U, W, Y) que alimenta as abas 1/2 do relatório "Vendas Usados
 * Matriz".
 *
 * Foco: fonte de dado de Valoriza (L), Despesa Geral (S) e F Plan (U) — ver auditoria
 * que motivou esta branch (ganhos_indiretos tinha 27% de erro validado contra o
 * relatório oficial; o sync Oracle agora alimenta vendas.valoriza/despesas_gerais/
 * custo_floor_plan automaticamente).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapearLinha } from "@/lib/export/vendas-matriz/coletar-dados";
import type { CustoDetalhado } from "@/lib/parsers/nbs-custos-xls";
import { venda, custo } from "./_mocks";

const SEM_LOOKUPS = {
  fipePorChassi: new Map<string, { precoFipe: number; confirmado: boolean }>(),
  lojaOrigemPorChassi: new Map<string, number>(),
  nomePorCodEmpresa: new Map<number, string>(),
};

function mapear(v: Parameters<typeof venda>[0], custosPorPlaca: Map<string, CustoDetalhado>) {
  return mapearLinha(
    venda(v),
    custosPorPlaca,
    SEM_LOOKUPS.fipePorChassi,
    SEM_LOOKUPS.lojaOrigemPorChassi,
    SEM_LOOKUPS.nomePorCodEmpresa,
  );
}

describe("mapearLinha — coluna L (Valoriza)", () => {
  it("usa v.valoriza (sync Oracle), nunca custo?.ganhos_indiretos (aproximação antiga)", () => {
    const linha = mapear(
      { placa: "ABC1D23", valoriza: 30_000 },
      new Map([["ABC1D23", custo({ placa: "ABC1D23", ganhos_indiretos: 999_999 })]]),
    );
    assert.equal(linha.valoriza, 30_000);
  });

  it("v.valoriza = 0 (sem bônus) permanece 0, não cai pro custo manual", () => {
    const linha = mapear(
      { placa: "ABC1D23", valoriza: 0 },
      new Map([["ABC1D23", custo({ placa: "ABC1D23", ganhos_indiretos: 5_000 })]]),
    );
    assert.equal(linha.valoriza, 0);
  });

  it("sem upload manual (sem CustoDetalhado pra placa) ainda usa v.valoriza", () => {
    const linha = mapear({ placa: "ABC1D23", valoriza: 12_345 }, new Map());
    assert.equal(linha.valoriza, 12_345);
  });
});

describe("mapearLinha — coluna S (Despesa Geral): upload manual > automático Oracle", () => {
  it("com upload manual do mês: usa custo.despesas_gerais", () => {
    const linha = mapear(
      { placa: "ABC1D23", despesas_gerais: 1_111 },
      new Map([["ABC1D23", custo({ placa: "ABC1D23", despesas_gerais: 2_222 })]]),
    );
    assert.equal(linha.despesaGeral, 2_222);
  });

  it("sem upload manual do mês: cai pro automático v.despesas_gerais", () => {
    const linha = mapear({ placa: "ABC1D23", despesas_gerais: 1_111 }, new Map());
    assert.equal(linha.despesaGeral, 1_111);
  });

  it("sem upload e sem automático: null", () => {
    const linha = mapear({ placa: "ABC1D23", despesas_gerais: null }, new Map());
    assert.equal(linha.despesaGeral, null);
  });
});

describe("mapearLinha — coluna U (F Plan): upload manual > automático Oracle", () => {
  it("com upload manual do mês: usa custo.forplan", () => {
    const linha = mapear(
      { placa: "ABC1D23", custo_floor_plan: 3_000 },
      new Map([["ABC1D23", custo({ placa: "ABC1D23", forplan: 4_000 })]]),
    );
    assert.equal(linha.forplan, 4_000);
  });

  it("sem upload manual do mês: cai pro automático v.custo_floor_plan", () => {
    const linha = mapear({ placa: "ABC1D23", custo_floor_plan: 3_000 }, new Map());
    assert.equal(linha.forplan, 3_000);
  });

  it("sem upload e sem automático: null", () => {
    const linha = mapear({ placa: "ABC1D23", custo_floor_plan: null }, new Map());
    assert.equal(linha.forplan, null);
  });
});

describe("mapearLinha — consignado (propagação pra LinhaVendaMatriz)", () => {
  it("v.consignado = true -> linha.consignado = true", () => {
    const linha = mapear({ placa: "ABC1D23", consignado: true }, new Map());
    assert.equal(linha.consignado, true);
  });

  it("v.consignado = false -> linha.consignado = false", () => {
    const linha = mapear({ placa: "ABC1D23", consignado: false }, new Map());
    assert.equal(linha.consignado, false);
  });
});

describe("mapearLinha — coluna W (Impostos): SEM fonte automática (fora de escopo)", () => {
  it("com upload manual: usa custo.impostos", () => {
    const linha = mapear({ placa: "ABC1D23" }, new Map([["ABC1D23", custo({ placa: "ABC1D23", impostos: 777 })]]));
    assert.equal(linha.impostos, 777);
  });

  it("sem upload manual: fica null (não existe v.impostos pra fallback)", () => {
    const linha = mapear({ placa: "ABC1D23" }, new Map());
    assert.equal(linha.impostos, null);
  });
});
