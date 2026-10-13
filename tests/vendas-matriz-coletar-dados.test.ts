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
import ExcelJS from "exceljs";
import { renderAbaDetalhe } from "@/lib/export/vendas-matriz/aba-detalhe";
import { COL, DATA_START_ROW } from "@/lib/export/vendas-matriz/colunas";
import { mapearLinha, contarComprasPorClienteNoAno } from "@/lib/export/vendas-matriz/coletar-dados";
import type { CustoDetalhado } from "@/lib/parsers/nbs-custos-xls";
import { venda, custo } from "./_mocks";

const SEM_LOOKUPS = {
  fipePorChassi: new Map<string, { precoFipe: number; confirmado: boolean }>(),
  lojaOrigemPorChassi: new Map<string, number>(),
  nomePorCodEmpresa: new Map<number, string>(),
};

function mapear(
  v: Parameters<typeof venda>[0],
  custosPorPlaca: Map<string, CustoDetalhado>,
  comprasPorCliente: Map<string, number> = new Map(),
) {
  return mapearLinha(
    venda(v),
    custosPorPlaca,
    SEM_LOOKUPS.fipePorChassi,
    SEM_LOOKUPS.lojaOrigemPorChassi,
    SEM_LOOKUPS.nomePorCodEmpresa,
    comprasPorCliente,
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


describe("mapearLinha — coluna AF (Lojista): contagem de compras no ano, não mais PJ/PF", () => {
  it("cliente_codigo com mais de 2 compras no ano -> lojista: true", () => {
    const linha = mapear({ cliente_codigo: "11122233344" }, new Map(), new Map([["11122233344", 3]]));
    assert.equal(linha.lojista, true);
  });

  it("cliente_codigo com 2 compras no ano -> lojista: false (limite é 'mais de 2')", () => {
    const linha = mapear({ cliente_codigo: "11122233344" }, new Map(), new Map([["11122233344", 2]]));
    assert.equal(linha.lojista, false);
  });

  it("cliente_codigo com 1 compra no ano -> lojista: false", () => {
    const linha = mapear({ cliente_codigo: "11122233344" }, new Map(), new Map([["11122233344", 1]]));
    assert.equal(linha.lojista, false);
  });

  it("cliente_codigo ausente -> lojista: null (mesmo fallback de antes)", () => {
    const linha = mapear({ cliente_codigo: null }, new Map(), new Map([["11122233344", 10]]));
    assert.equal(linha.lojista, null);
  });

  it("cliente_codigo vazio -> lojista: null", () => {
    const linha = mapear({ cliente_codigo: "" }, new Map(), new Map([["11122233344", 10]]));
    assert.equal(linha.lojista, null);
  });

  it("PJ com só 1 compra no ano agora é NÃO lojista (antes, cliente_tipo='PJ' bastava pra ser SIM)", () => {
    const linha = mapear(
      { cliente_codigo: "11222333000144", cliente_tipo: "PJ" },
      new Map(),
      new Map([["11222333000144", 1]]),
    );
    assert.equal(linha.lojista, false);
  });
});

describe("contarComprasPorClienteNoAno — agrupa por cliente_codigo normalizado, em todas as lojas, só no ano do relatório", () => {
  it("cliente com 3+ compras no ano -> todas as linhas desse cliente ficam lojista: true", () => {
    const vendasCliente = [
      venda({ cliente_codigo: "123.456.789-00", data_venda: new Date("2026-02-01T12:00:00-03:00"), cod_empresa: 2 }),
      venda({ cliente_codigo: "12345678900", data_venda: new Date("2026-05-01T12:00:00-03:00"), cod_empresa: 3 }), // outra loja do grupo
      venda({ cliente_codigo: "12345678900", data_venda: new Date("2026-09-01T12:00:00-03:00"), cod_empresa: 2 }),
    ];
    const comprasPorCliente = contarComprasPorClienteNoAno(vendasCliente, 2026);
    for (const v of vendasCliente) {
      const linha = mapearLinha(
        v,
        new Map(),
        SEM_LOOKUPS.fipePorChassi,
        SEM_LOOKUPS.lojaOrigemPorChassi,
        SEM_LOOKUPS.nomePorCodEmpresa,
        comprasPorCliente,
      );
      assert.equal(linha.lojista, true);
    }
  });

  it("cliente com 1-2 compras no ano -> lojista: false pra todas as linhas", () => {
    const vendasCliente = [
      venda({ cliente_codigo: "98765432100", data_venda: new Date("2026-03-01T12:00:00-03:00") }),
      venda({ cliente_codigo: "98765432100", data_venda: new Date("2026-07-01T12:00:00-03:00") }),
    ];
    const comprasPorCliente = contarComprasPorClienteNoAno(vendasCliente, 2026);
    for (const v of vendasCliente) {
      const linha = mapearLinha(
        v,
        new Map(),
        SEM_LOOKUPS.fipePorChassi,
        SEM_LOOKUPS.lojaOrigemPorChassi,
        SEM_LOOKUPS.nomePorCodEmpresa,
        comprasPorCliente,
      );
      assert.equal(linha.lojista, false);
    }
  });

  it("cliente_codigo ausente -> lojista: null, e não entra na contagem de ninguém", () => {
    const vendasSemCodigo = [
      venda({ cliente_codigo: null, data_venda: new Date("2026-04-01T12:00:00-03:00") }),
      venda({ cliente_codigo: null, data_venda: new Date("2026-04-15T12:00:00-03:00") }),
    ];
    const comprasPorCliente = contarComprasPorClienteNoAno(vendasSemCodigo, 2026);
    assert.equal(comprasPorCliente.size, 0);
    const linha = mapearLinha(
      vendasSemCodigo[0],
      new Map(),
      SEM_LOOKUPS.fipePorChassi,
      SEM_LOOKUPS.lojaOrigemPorChassi,
      SEM_LOOKUPS.nomePorCodEmpresa,
      comprasPorCliente,
    );
    assert.equal(linha.lojista, null);
  });

  it("ignora compras de outro ano na contagem", () => {
    const vendas = [
      venda({ cliente_codigo: "11122233344", data_venda: new Date("2025-12-01T12:00:00-03:00") }),
      venda({ cliente_codigo: "11122233344", data_venda: new Date("2026-01-01T12:00:00-03:00") }),
      venda({ cliente_codigo: "11122233344", data_venda: new Date("2026-02-01T12:00:00-03:00") }),
    ];
    const comprasPorCliente = contarComprasPorClienteNoAno(vendas, 2026);
    assert.equal(comprasPorCliente.get("11122233344"), 2); // só as 2 de 2026
  });

  it("virada do ano em Brasília: 23h30 de 31/12 conta no ano anterior, 00h30 de 01/01 conta no ano seguinte (imune ao timezone do processo)", () => {
    const vendaFimDeAno = venda({ cliente_codigo: "11122233344", data_venda: new Date("2025-12-31T23:30:00-03:00") });
    const vendaInicioDeAno = venda({ cliente_codigo: "11122233344", data_venda: new Date("2026-01-01T00:30:00-03:00") });
    const vendas = [vendaFimDeAno, vendaInicioDeAno];

    const contagem2025 = contarComprasPorClienteNoAno(vendas, 2025);
    assert.equal(contagem2025.get("11122233344"), 1); // só a de 23h30 de 31/12 conta em 2025

    const contagem2026 = contarComprasPorClienteNoAno(vendas, 2026);
    assert.equal(contagem2026.get("11122233344"), 1); // só a de 00h30 de 01/01 conta em 2026
  });
});

describe("mapearLinha — coluna E (Cor)", () => {
  it("corrige os códigos já persistidos sem precisar sincronizar novamente", () => {
    for (const [codigo, nome] of [["8246719", "CINZA"], ["14575", "CINZA"], ["1549197195", "CINZA"], ["888", "BRANCO"], ["151662", "PRETO"]]) {
      assert.equal(mapear({ cor_externa: codigo }, new Map()).cor, nome);
    }
  });

  it("preserva texto e ausências e sinaliza código desconhecido sem inventar cor", () => {
    assert.equal(mapear({ cor_externa: "BRANCO POLAR" }, new Map()).cor, "BRANCO POLAR");
    assert.equal(mapear({ cor_externa: null }, new Map()).cor, null);
    assert.equal(mapear({ cor_externa: "  " }, new Map()).cor, null);
    assert.equal(mapear({ cor_externa: "1549275505" }, new Map()).cor, "Não informada");
    assert.equal(mapear({ cor_externa: "Cor 1549275505 (não mapeada)" }, new Map()).cor, "Não informada");
    assert.equal(mapear({ cor_externa: "Cor 888 (não mapeada)" }, new Map()).cor, "BRANCO");
  });

  it("grava nomes na coluna COR das duas abas de detalhe no XLSX", async () => {
    const linhas = ["8246719", "888", "151662", "1549275505"].map((cor_externa) => mapear({ cor_externa }, new Map()));
    const wb = new ExcelJS.Workbook();
    for (const titulo of ["VENDAS USADOS OUTUBRO MATRIZ", "VENDAS OUTUBRO SÓ ESTOQUE"]) {
      renderAbaDetalhe(wb.addWorksheet(titulo), titulo, linhas);
    }
    const reaberto = new ExcelJS.Workbook();
    await reaberto.xlsx.load(await wb.xlsx.writeBuffer());
    for (const ws of reaberto.worksheets) {
      assert.equal(ws.getCell(2, COL.E_COR).value, "COR");
      assert.deepEqual(linhas.map((_, index) => ws.getCell(DATA_START_ROW + index, COL.E_COR).value), ["CINZA", "BRANCO", "PRETO", "Não informada"]);
    }
  });
});
