/**
 * `resumirPainelMatriz` (src/lib/export/vendas-matriz/resumir-painel.ts) — números do
 * painel executivo /vendas-usados-matriz. Regra central: painel e Excel saem das mesmas
 * linhas e dos mesmos filtros, então os totais têm que bater centavo a centavo com a aba
 * MARGENS gerada por `gerarVendasMatrizWorkbook`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {
  resumirPainelMatriz,
  definirCorte,
  calcularDelta,
  classificarComprador,
  participacaoMargem,
  type ResumirPainelMatrizInput,
} from "@/lib/export/vendas-matriz/resumir-painel";
import { gerarVendasMatrizWorkbook } from "@/lib/export/vendas-matriz/gerar-workbook";
import type { ColetarVendasMatrizResult } from "@/lib/export/vendas-matriz/coletar-dados";
import { nomesAbas, type LinhaVendaMatriz } from "@/lib/export/vendas-matriz/tipos";
import { linhaVendaMatriz } from "./_mocks";

const COD = 2;
const PROPRIA = "ESTOQUE AEROPORTO";

/** Data em Brasília (meio-dia, longe da virada UTC). */
function dia(iso: string): Date {
  return new Date(`${iso}T12:00:00-03:00`);
}

function painel(over: Partial<ResumirPainelMatrizInput> = {}) {
  return resumirPainelMatriz({
    linhasMes: [],
    linhasMesAnterior: [],
    codEmpresa: COD,
    mes: 9,
    ano: 2026,
    hoje: "2026-10-30",
    ...over,
  });
}

const L = (over: Partial<LinhaVendaMatriz>): LinhaVendaMatriz =>
  linhaVendaMatriz({ lojaOrigemNome: PROPRIA, lojaOrigemCodEmpresa: COD, dataVenda: dia("2026-09-10"), ...over });

/** Mês variado: PF/PJ/null, Auto Avaliar, consignado, 3 origens, margem negativa, centavos. */
const MES_MISTO: LinhaVendaMatriz[] = [
  L({ clienteTipo: "PF", valorVenda: 95000.37, nfEntrada: 80000.11 }),
  L({ clienteTipo: "PF", lojaOrigemCodEmpresa: 5, lojaOrigemNome: "LOJA 5", valorVenda: 70000.05, nfEntrada: 72000 }),
  L({ clienteTipo: "PF", consignado: true, valorVenda: 500000 }),
  L({ clienteTipo: "PJ", lojaOrigemCodEmpresa: null, lojaOrigemNome: "(origem desconhecida)", valorVenda: 50000.99 }),
  L({ clienteTipo: "PJ", lojaOrigemCodEmpresa: 7, lojaOrigemNome: "LOJA 7", valorVenda: 61000.5, comissao: 333.33 }),
  // Auto Avaliar com cliente PJ → conta SÓ como Auto Avaliar
  L({ clienteTipo: "PJ", vendedorNome: "MOZAINEL CORREA", valorVenda: 40000 }),
  L({ clienteTipo: null, vendedorNome: "Mozainel Correa", valorVenda: 41000 }),
  L({ clienteTipo: null, valorVenda: 88000.1, adm: 120.45 }),
  L({ clienteTipo: null, consignado: true, lojaOrigemCodEmpresa: 5, lojaOrigemNome: "LOJA 5", valorVenda: 77000 }),
];

describe("resumirPainelMatriz — reconciliação de compradores", () => {
  it("Total = PF + PJ + Auto Avaliar + Não informado (mês misto)", () => {
    const { atual } = painel({ linhasMes: MES_MISTO });
    assert.equal(atual.total.qtd, MES_MISTO.length);
    assert.equal(atual.pf.metricas.qtd, 3);
    assert.equal(atual.pj.metricas.qtd, 2);
    assert.equal(atual.autoAvaliar.qtd, 2);
    assert.equal(atual.naoInformado.qtd, 2);
    assert.equal(
      atual.pf.metricas.qtd + atual.pj.metricas.qtd + atual.autoAvaliar.qtd + atual.naoInformado.qtd,
      atual.total.qtd,
    );
  });

  it("fecha pra qualquer combinação de vendedor × cliente_tipo × consignado", () => {
    const linhas: LinhaVendaMatriz[] = [];
    for (const vendedorNome of ["FULANO", "MOZAINEL CORREA", null])
      for (const clienteTipo of ["PF", "PJ", null] as const)
        for (const consignado of [false, true]) linhas.push(L({ vendedorNome, clienteTipo, consignado }));
    const { atual } = painel({ linhasMes: linhas });
    const soma = atual.pf.metricas.qtd + atual.pj.metricas.qtd + atual.autoAvaliar.qtd + atual.naoInformado.qtd;
    assert.equal(soma, linhas.length);
    assert.equal(atual.autoAvaliar.qtd, 6);
  });

  it("margem: PF + PJ + Auto Avaliar + Não informado = margem total, ao centavo", () => {
    const { atual } = painel({ linhasMes: MES_MISTO });
    const cent = (v: number | null): number => Math.round((v ?? 0) * 100);
    const soma = cent(atual.pf.metricas.margem) + cent(atual.pj.metricas.margem) + cent(atual.autoAvaliar.margem) + cent(atual.naoInformado.margem);
    assert.equal(soma, cent(atual.total.margem));
    assert.ok(atual.autoAvaliar.margem != null && atual.naoInformado.margem != null);
    // consignado de Não informado fica fora da margem dele
    assert.equal(atual.naoInformado.qtd, 2);
    assert.equal(atual.naoInformado.qtdComMargem, 1);
  });

  it("Auto Avaliar fica fora da margem de PF e PJ", () => {
    const aa = L({ clienteTipo: "PF", vendedorNome: "MOZAINEL CORREA", valorVenda: 999999 });
    const pf = L({ clienteTipo: "PF", valorVenda: 95000 });
    const { atual } = painel({ linhasMes: [aa, pf] });
    assert.equal(atual.pf.metricas.qtd, 1);
    assert.equal(atual.pf.metricas.receita, 95000);
    assert.equal(classificarComprador(aa), "autoAvaliar");
  });
});

describe("resumirPainelMatriz — consignado", () => {
  it("conta no volume, sai de margem/receita/ticket", () => {
    const linhas = [L({ valorVenda: 100000 }), L({ valorVenda: 200000 }), L({ valorVenda: 500000, consignado: true })];
    const { total } = painel({ linhasMes: linhas }).atual;
    assert.equal(total.qtd, 3);
    assert.equal(total.qtdConsignadas, 1);
    assert.equal(total.qtdComMargem, 2);
    assert.equal(total.receita, 300000);
    assert.equal(total.ticket, 150000);
    // nfEntrada 80000 − valoriza 1000 = custo 79000; custos 1000+2000+500+400 = 3900
    assert.equal(total.margem, (100000 - 79000 - 3900) + (200000 - 79000 - 3900));
  });

  it("só consignadas: volume aparece, margem/% /ticket = null", () => {
    const { total } = painel({ linhasMes: [L({ consignado: true }), L({ consignado: true })] }).atual;
    assert.equal(total.qtd, 2);
    assert.equal(total.margem, null);
    assert.equal(total.margemPct, null);
    assert.equal(total.ticket, null);
  });
});

describe("resumirPainelMatriz — origem em 3 parcelas", () => {
  it("próprio / outras / não identificada somam o total (qtd e margem)", () => {
    const { atual } = painel({ linhasMes: MES_MISTO });
    const { proprio, outras, naoIdentificada } = atual.origem;
    assert.equal(proprio.qtd + outras.qtd + naoIdentificada.qtd, atual.total.qtd);
    assert.equal(outras.qtd, 3); // LOJA 5 ×2 (uma consignada) + LOJA 7
    assert.equal(naoIdentificada.qtd, 1);
    assert.equal(outras.qtdConsignadas, 1);
    const somaMargens = (proprio.margem ?? 0) + (outras.margem ?? 0) + (naoIdentificada.margem ?? 0);
    assert.ok(Math.abs(somaMargens - (atual.total.margem ?? 0)) < 1e-6);
  });

  it("split de origem dentro de PF e PJ", () => {
    const { pf, pj } = painel({ linhasMes: MES_MISTO }).atual;
    assert.equal(pf.origem.proprio.qtd, 2);
    assert.equal(pf.origem.outras.qtd, 1);
    assert.equal(pj.origem.outras.qtd, 1);
    assert.equal(pj.origem.naoIdentificada.qtd, 1);
  });
});

describe("resumirPainelMatriz — paridade centavo a centavo com a aba MARGENS do Excel", () => {
  function resultado(cell: ExcelJS.Cell): unknown {
    const v = cell.value;
    if (v && typeof v === "object" && "result" in v) return (v as { result: unknown }).result;
    return v;
  }

  it("VENDIDO TOTAL / SOMENTE ESTOQUE / OUTRAS LOJAS = total / próprio / outras do painel", async () => {
    const input = { codEmpresa: COD, mes: 9, ano: 2026 };
    const dados: ColetarVendasMatrizResult = {
      linhasMes: MES_MISTO,
      nomeLojaPropria: PROPRIA,
      anoAtual: 2026,
      mesAtualIndex: 10,
      vendasAnoAtual: [],
    };
    const blob = await gerarVendasMatrizWorkbook(dados, input);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());
    const ws = wb.getWorksheet(nomesAbas(9, 2026).aba4)!;

    const linhaDe = (label: string): ExcelJS.Row => {
      let achada: ExcelJS.Row | undefined;
      ws.eachRow((row) => {
        if (!achada && String(row.getCell(3).value ?? "") === label) achada = row;
      });
      assert.ok(achada, `linha ${label}`);
      return achada;
    };
    const rMargem = linhaDe("Margem Líquida");
    const rVenda = linhaDe("Valor da Venda");
    const rQtde = linhaDe("Qtde Faturados");
    const rTicket = linhaDe("Ticket Médio");

    const { atual } = painel({ linhasMes: MES_MISTO });
    // Blocos lado a lado: valor em D (4), H (8), L (12) — ver renderAbaMargens.
    const blocos = [
      { col: 4, m: atual.total },
      { col: 8, m: atual.origem.proprio },
      { col: 12, m: atual.origem.outras },
    ];
    for (const { col, m } of blocos) {
      assert.equal(resultado(rMargem.getCell(col)), m.margem);
      assert.equal(resultado(rVenda.getCell(col)), m.receita);
      assert.equal(resultado(rQtde.getCell(col)), m.qtdComMargem);
      assert.equal(resultado(rTicket.getCell(col)), m.ticket);
    }
  });
});

describe("definirCorte — mês corrente até o mesmo dia", () => {
  it("mês corrente (30/out) → 1–30/set, que é setembro inteiro", () => {
    const c = definirCorte(10, 2026, "2026-10-30");
    assert.equal(c.parcial, true);
    assert.equal(c.diaHoje, 30);
    assert.deepEqual(c.mesAnterior, { mes: 9, ano: 2026 });
    assert.equal(c.diaFimAnterior, 30);
    assert.equal(c.mesAnteriorInteiro, true);
  });

  it("15/out → 1–15/set (parcial)", () => {
    const c = definirCorte(10, 2026, "2026-10-15");
    assert.equal(c.diaFimAnterior, 15);
    assert.equal(c.mesAnteriorInteiro, false);
  });

  it("31/mar → fevereiro inteiro (mês anterior mais curto)", () => {
    const c = definirCorte(3, 2026, "2026-03-31");
    assert.equal(c.diaFimAnterior, 28);
    assert.equal(c.mesAnteriorInteiro, true);
    assert.equal(definirCorte(3, 2028, "2028-03-30").diaFimAnterior, 29); // bissexto
  });

  it("janeiro compara com dezembro do ano anterior", () => {
    assert.deepEqual(definirCorte(1, 2027, "2027-01-10").mesAnterior, { mes: 12, ano: 2026 });
  });

  it("mês fechado → mês inteiro × mês inteiro", () => {
    const c = definirCorte(9, 2026, "2026-10-30");
    assert.equal(c.parcial, false);
    assert.equal(c.diaHoje, null);
    assert.equal(c.diaFimAnterior, 31);
    assert.equal(c.mesAnteriorInteiro, true);
  });

  it("resumirPainelMatriz aplica o corte nas linhas do mês anterior (fuso Brasília)", () => {
    const anterior = [
      L({ dataVenda: dia("2026-09-01") }),
      L({ dataVenda: dia("2026-09-15") }),
      // 15/set 23:30 em Brasília = 16/set 02:30 UTC — ainda é dia 15
      L({ dataVenda: new Date("2026-09-15T23:30:00-03:00") }),
      L({ dataVenda: dia("2026-09-16") }),
      L({ dataVenda: dia("2026-09-30") }),
    ];
    const p = painel({ mes: 10, ano: 2026, hoje: "2026-10-15", linhasMesAnterior: anterior });
    assert.equal(p.anterior.total.qtd, 3);
    const fechado = painel({ mes: 10, ano: 2026, hoje: "2026-11-02", linhasMesAnterior: anterior });
    assert.equal(fechado.anterior.total.qtd, 5);
  });
});

describe("calcularDelta", () => {
  it("percentual + absoluto", () => {
    assert.deepEqual(calcularDelta(110, 100, "valor"), { tipo: "percentual", abs: 10, pct: 10 });
    assert.deepEqual(calcularDelta(-50, -100, "valor"), { tipo: "percentual", abs: 50, pct: 50 });
  });

  it("margem % em pontos percentuais, nunca % de %", () => {
    const d = calcularDelta(0.062, 0.05, "pontos");
    assert.equal(d?.tipo, "pontos");
    assert.ok(d?.tipo === "pontos" && Math.abs(d.pp - 1.2) < 1e-9);
  });

  it("base zero → só absoluto (sem +∞%)", () => {
    assert.deepEqual(calcularDelta(5, 0, "valor"), { tipo: "absoluto", abs: 5 });
  });

  it("base ausente → semBase; atual ausente → null", () => {
    assert.deepEqual(calcularDelta(5, null, "valor"), { tipo: "semBase" });
    assert.deepEqual(calcularDelta(0.05, null, "pontos"), { tipo: "semBase" });
    assert.equal(calcularDelta(null, 10, "valor"), null);
  });

  it("mês anterior sem venda nenhuma → métricas de margem do anterior são null", () => {
    const p = painel({ linhasMes: [L({})] });
    assert.equal(p.anterior.total.qtd, 0);
    assert.equal(p.anterior.total.margem, null);
    assert.deepEqual(calcularDelta(p.atual.total.margem, p.anterior.total.margem, "valor"), { tipo: "semBase" });
  });
});

describe("participacaoMargem (modo Margem R$ da origem)", () => {
  it("todos positivos → % do total somando 100, barra ÷ max", () => {
    const p = participacaoMargem([300, 100, null]);
    assert.equal(p.sinal, "positivo");
    assert.deepEqual(p.participacoes, [75, 25, null]);
    assert.equal(p.larguras[0], 100);
    assert.ok(Math.abs(p.larguras[1] - 100 / 3) < 1e-9);
    assert.equal(p.larguras[2], 0);
  });

  it("todos negativos → % do prejuízo (positivo, soma 100)", () => {
    const p = participacaoMargem([-692688.47, -433057.11]);
    assert.equal(p.sinal, "negativo");
    const [a, b] = p.participacoes as number[];
    assert.ok(a > 0 && b > 0 && Math.abs(a + b - 100) < 1e-9);
    assert.equal(p.larguras[0], 100);
  });

  it("sinais mistos → sem participação; barra continua ÷ max|margem|", () => {
    const p = participacaoMargem([500, -250, 100]);
    assert.equal(p.sinal, "misto");
    assert.deepEqual(p.participacoes, [null, null, null]);
    assert.deepEqual(p.larguras, [100, 50, 20]);
  });

  it("sem margem conhecida → vazio", () => {
    assert.equal(participacaoMargem([null, null]).sinal, "vazio");
  });
});
