import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapearMarkupOficial } from "../scripts/sync-nbs/mapear-markup-oficial";

/** Linhas de um veículo que reconcilia perfeitamente (mesmo caso do piloto validado). */
function linhasReconciliadas(): Record<string, unknown>[] {
  return [
    { ORDEM: 1, COD_CUSTO: 7, DESCRICAO: "Despesas Oficina", VALOR: 29919.13 }, // revisões
    { ORDEM: 2, COD_CUSTO: 10, DESCRICAO: "Floor Plan", VALOR: 685114.32 }, // forplan
    { ORDEM: 3, COD_CUSTO: 12, DESCRICAO: "Impostos", VALOR: 1045.0 }, // impostos
    { ORDEM: 4, COD_CUSTO: 15, DESCRICAO: "Impostos Usados", VALOR: 1045.0 }, // duplicado — NUNCA somar
    { ORDEM: 5, COD_CUSTO: 2, DESCRICAO: "Comissao Vendedor", VALOR: 800.0 },
    { ORDEM: 6, COD_CUSTO: 3, DESCRICAO: "Comissao Gerente", VALOR: 449.0 },
    { ORDEM: 7, COD_CUSTO: 4, DESCRICAO: "Comissao Terceiros", VALOR: 0 },
    { ORDEM: 8, COD_CUSTO: 9, DESCRICAO: "Despesas Gerais", VALOR: 15889.84 },
    { ORDEM: 9, COD_CUSTO: 11, DESCRICAO: "Ganhos Indiretos", VALOR: 40000.0 },
    { ORDEM: 10, COD_CUSTO: 8, DESCRICAO: "Despesas ADM", VALOR: 0 },
    { ORDEM: 11, COD_CUSTO: 1, DESCRICAO: "Acessorios", VALOR: 0 },
    { ORDEM: 12, COD_CUSTO: 102, DESCRICAO: "Acessorios (Prop)", VALOR: 0 },
    // total oficial = 29919.13+685114.32+1045.00+800.00+449.00+0+15889.84+0+0 - 40000.00
    { ORDEM: 13, COD_CUSTO: 105, DESCRICAO: "Custo Atual", VALOR: 693217.29 },
  ];
}

describe("mapearMarkupOficial — reconciliação", () => {
  it("reconcilia ao centavo: não diverge, mapeia as 8 categorias e ignora COD_CUSTO=15 (duplicado de 12)", () => {
    const r = mapearMarkupOficial(linhasReconciliadas());
    assert.equal(r.divergente, false);
    assert.equal(r.motivoDivergencia, null);
    assert.equal(r.categorias.custo_revisoes, 29919.13);
    assert.equal(r.categorias.custo_forplan, 685114.32);
    assert.equal(r.categorias.custo_impostos, 1045.0, "só COD_CUSTO=12 — 15 é o mesmo valor duplicado, não soma");
    assert.equal(r.categorias.custo_comissoes, 1249.0);
    assert.equal(r.categorias.custo_despesas_gerais, 15889.84);
    assert.equal(r.categorias.custo_adm, 0);
    assert.equal(r.categorias.custo_acessorios, 0);
    assert.equal(r.categorias.custo_holdback, 0, "sem fonte conhecida — sempre 0");
    assert.equal(r.ganhosIndiretos, 40000.0);
    assert.equal(r.custoTotalOficial, 693217.29);
    assert.deepEqual(r.avisos, []);
  });

  it("bloqueia quando a diferença é exatamente R$ 0,01", () => {
    const linhas = linhasReconciliadas().map((l) =>
      (l as Record<string, unknown>).COD_CUSTO === 105 ? { ...l, VALOR: 693217.28 } : l,
    );
    const r = mapearMarkupOficial(linhas);
    assert.equal(r.divergente, true);
    assert.ok(r.motivoDivergencia?.includes("diverge do custo_total_oficial"));
    assert.equal(r.diferencaCentavos, 1);
  });

  it("NÃO bloqueia por ruído de float abaixo de 1 centavo", () => {
    const linhas = linhasReconciliadas().map((l) =>
      (l as Record<string, unknown>).COD_CUSTO === 9 ? { ...l, VALOR: 15889.84 + 1e-9 } : l,
    );
    const r = mapearMarkupOficial(linhas);
    assert.equal(r.divergente, false);
  });

  it("bloqueia (motivo específico) quando COD_CUSTO=105 está ausente", () => {
    const linhas = linhasReconciliadas().filter((l) => (l as Record<string, unknown>).COD_CUSTO !== 105);
    const r = mapearMarkupOficial(linhas);
    assert.equal(r.divergente, true);
    assert.equal(r.custoTotalOficial, null);
    assert.ok(r.motivoDivergencia?.includes("ausente"));
  });

  it("categoria sem confiança (ADM/Acessórios) com valor ≠0 pela primeira vez: ENTRA no somatório e loga aviso específico", () => {
    const linhas = linhasReconciliadas().map((l) => {
      const linha = l as Record<string, unknown>;
      if (linha.COD_CUSTO === 8) return { ...linha, VALOR: 15.0 }; // ADM passa a ter valor
      if (linha.COD_CUSTO === 105) return { ...linha, VALOR: 693232.29 }; // total ajustado (+15)
      return linha;
    });
    const r = mapearMarkupOficial(linhas);
    assert.equal(r.categorias.custo_adm, 15.0);
    assert.equal(r.divergente, false, "ainda reconcilia porque o total foi ajustado de propósito neste teste");
    assert.equal(r.avisos.length, 1);
    assert.ok(r.avisos[0].includes("custo_adm"));
    assert.ok(r.avisos[0].includes("ENTROU no somatório"));
  });

  it("CODIGO_CUSTO sem mapeamento conhecido (101/103/14) com valor ≠0: loga aviso, mas NÃO entra no somatório", () => {
    const linhas = [...linhasReconciliadas(), { ORDEM: 14, COD_CUSTO: 103, DESCRICAO: "Fretes", VALOR: 5.0 }];
    const r = mapearMarkupOficial(linhas);
    assert.equal(r.divergente, false, "103 não é somado — não deveria afetar a reconciliação");
    assert.equal(r.avisos.length, 1);
    assert.ok(r.avisos[0].includes("103"));
    assert.ok(r.avisos[0].includes("NÃO entrou no somatório"));
  });

  it("não loga nada quando todos os códigos sem mapeamento conhecido vêm em 0 (caso normal, validado nos 4 testes)", () => {
    const linhas = [...linhasReconciliadas(), { ORDEM: 14, COD_CUSTO: 101, VALOR: 0 }, { ORDEM: 15, COD_CUSTO: 14, VALOR: 0 }];
    const r = mapearMarkupOficial(linhas);
    assert.deepEqual(r.avisos, []);
  });

  it("aceita CODIGO_CUSTO/VALOR_FINAL como nomes alternativos de campo (ambiguidade de schema não confirmada)", () => {
    const linhas = [
      { ORDEM: 1, CODIGO_CUSTO: 7, VALOR_FINAL: 100 },
      { ORDEM: 2, CODIGO_CUSTO: 105, VALOR_FINAL: 100 },
    ];
    const r = mapearMarkupOficial(linhas);
    assert.equal(r.categorias.custo_revisoes, 100);
    assert.equal(r.custoTotalOficial, 100);
    assert.equal(r.divergente, false);
  });

  it("linhas vazias: todas as categorias 0, total ausente, divergente", () => {
    const r = mapearMarkupOficial([]);
    assert.equal(r.custoTotalOficial, null);
    assert.equal(r.divergente, true);
    for (const v of Object.values(r.categorias)) assert.equal(v, 0);
  });
});
