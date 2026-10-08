/**
 * Testes de custos de estoque detalhados (relatório nativo NBS "Custos de
 * Veículos em Estoque") no sync Oracle -> Supabase.
 *
 * Por que existe:
 *   `veiculos.custo_total` hoje é um valor AGREGADO vindo direto do Oracle.
 *   A migration 040 (040_custos_estoque_detalhado_em_veiculos.sql) quebrou
 *   esse agregado em 6 colunas individuais (Impostos, Revisões, HoldBack,
 *   Acessórios, Forplan, Comissões).
 *
 *   ATUALIZADO 05/10/2026 (migration 043): Forplan e HoldBack SAÍRAM do
 *   mecanismo de CODIGO_CUSTO coberto por este módulo — são colunas DIRETAS
 *   em NBS.VEICULOS (CUSTO_FORPLAN_FINAL, HOLD_BACK_FINAL), confirmado
 *   batendo ao centavo contra o relatório nativo PDF em 3 veículos. Agora
 *   são lidas em mapear-veiculo.ts pelo mesmo mecanismo de custo_total
 *   (candidato de coluna via get()), não por este módulo. Este módulo (e os
 *   testes abaixo) cobre as 4 categorias de LISTA FIXA que vêm de
 *   NBS.VEICULOS_CUSTOS_ESPECIFICOS filtrada por CODIGO_CUSTO (Impostos,
 *   Revisões, Acessórios, Comissões), somada por chassi_resumido+loja atual
 *   — mesmo padrão de valoriza.ts, rodando UMA QUERY POR CATEGORIA (em vez
 *   de um IN() gigante com todos os códigos juntos: testado com 73 códigos
 *   numa query só e precisou ser cancelado depois de 15+min contra a tabela,
 *   55,9 milhões de linhas, sem índice em CODIGO_CUSTO).
 *
 *   ATUALIZADO 07/10/2026 (migration 048): Despesas Gerais ENTROU neste
 *   módulo também, mas com filtro DIFERENTE — em vez de lista fixa de
 *   CODIGO_CUSTO, é uma subquery por CLASSIFICAÇÃO (CODIGO_CUSTO cujo TIPO=9
 *   em NBS.CUSTOS_ESPECIFICOS). Validado contra 429 veículos reais (2 PDFs,
 *   Navesa+GWM): 99,3% de acerto exato (426/429) — ver
 *   scripts/sync-nbs/custos-estoque-detalhado.ts e migration 048 pro achado
 *   em aberto (2 dos 3 que não bateram erraram pelo mesmo R$500,00).
 *
 *   Ver scripts/sync-nbs/custos-estoque-detalhado.ts e cabeçalhos das
 *   migrations 040/043/048 pra detalhes de confiança por categoria e
 *   códigos candidatos descartados.
 *
 *   `custo_adm` é a ÚNICA coluna da mesma migration 040 (NULLABLE SEM
 *   DEFAULT) que fica FORA deste módulo de propósito: nenhum CODIGO_CUSTO
 *   nem TIPO foi encontrado pra ela (hipótese: rateio calculado pelo motor
 *   do relatório NBS). Não deve ser escrita por código algum nesta rodada —
 *   NULL = "não apurado", diferente de "fato conhecido de custo zero" (0)
 *   das outras categorias (que agora incluem Despesas Gerais).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CODIGOS_CUSTO_IMPOSTOS,
  CODIGOS_CUSTO_ACESSORIOS,
  CODIGOS_CUSTO_COMISSOES,
  CODIGOS_POR_CATEGORIA,
  TIPO_POR_CATEGORIA,
  sqlSelectCustosPorCategoria,
  construirMapaCustoDetalhado,
  buscarCustoDetalhado,
  chaveCustoDetalhado,
  type CategoriaCustoDetalhado,
} from "../scripts/sync-nbs/custos-estoque-detalhado";
import { mapearVeiculo } from "../scripts/sync-nbs/mapear-veiculo";
import { toRow } from "../src/lib/data/veiculos";
import { veiculo } from "./_mocks";

/** As 5 categorias cobertas por este módulo (3 de lista fixa + 2 por TIPO). */
const CATEGORIAS: CategoriaCustoDetalhado[] = [
  "custo_impostos",
  "custo_revisoes",
  "custo_acessorios",
  "custo_comissoes",
  "custo_despesas_gerais",
];

/** Só as 3 categorias cujo filtro é lista fixa de CODIGO_CUSTO (CODIGOS_POR_CATEGORIA). */
const CATEGORIAS_LISTA_FIXA: CategoriaCustoDetalhado[] = [
  "custo_impostos",
  "custo_acessorios",
  "custo_comissoes",
];

describe("sqlSelectCustosPorCategoria — uma query por categoria, nunca um IN() combinado", () => {
  it("monta SELECT ... GROUP BY CHASSI_RESUMIDO, COD_EMPRESA contra NBS.VEICULOS_CUSTOS_ESPECIFICOS (todas as 5 categorias)", () => {
    for (const categoria of CATEGORIAS) {
      const sql = sqlSelectCustosPorCategoria(categoria);
      assert.match(sql, /FROM NBS\.VEICULOS_CUSTOS_ESPECIFICOS/);
      assert.match(sql, /GROUP BY CHASSI_RESUMIDO, COD_EMPRESA/);
      assert.match(sql, /SUM\(VALOR_FINAL\) AS TOTAL/);
    }
  });

  it("custo_impostos filtra exatamente os 20 códigos da migration 040 (inclui 490)", () => {
    const sql = sqlSelectCustosPorCategoria("custo_impostos");
    for (const codigo of CODIGOS_CUSTO_IMPOSTOS) {
      assert.match(sql, new RegExp(`\\b${codigo}\\b`));
    }
    assert.equal(CODIGOS_CUSTO_IMPOSTOS.length, 20);
    assert.ok(CODIGOS_CUSTO_IMPOSTOS.includes(490), "490 deve estar em Impostos (decisão: evitar dupla contagem)");
  });

  it("custo_comissoes NÃO inclui 490 (ambíguo, atribuído só a Impostos pra evitar dupla contagem)", () => {
    assert.ok(!CODIGOS_CUSTO_COMISSOES.includes(490 as never));
    const sql = sqlSelectCustosPorCategoria("custo_comissoes");
    assert.ok(!new RegExp(`\\b490\\b`).test(sql));
  });

  it("revisões usam classificação TIPO=7: inclui preparação de entrega e exclui custo de despesas gerais com nome revisão", () => {
    const sql = sqlSelectCustosPorCategoria("custo_revisoes");
    assert.match(sql, /WHERE CODIGO_CUSTO IN \(SELECT CODIGO_CUSTO FROM NBS\.CUSTOS_ESPECIFICOS WHERE TIPO = 7\)/);
    assert.equal(TIPO_POR_CATEGORIA.custo_revisoes, 7);
    assert.ok(!("custo_revisoes" in CODIGOS_POR_CATEGORIA));
    // Casos reais do PDF 08/10/2026: SGN1B62 tem código546/TIPO7,
    // Preparacao de entrega Oficina=358,82; RBV7G98 tem código250/TIPO9,
    // Serviço de Revisão=230,00 em Desp.Gerais, com Revisões=0.
    const lancamentos = [
      { chassiResumido: "187547", codEmpresa: 2, codigo: 546, tipo: 7, total: 358.82 },
      { chassiResumido: "163765", codEmpresa: 2, codigo: 250, tipo: 9, total: 230 },
    ];
    const mapa = construirMapaCustoDetalhado(lancamentos.filter(l => l.tipo === TIPO_POR_CATEGORIA.custo_revisoes));
    assert.equal(buscarCustoDetalhado(mapa, "187547", 2), 358.82);
    assert.equal(buscarCustoDetalhado(mapa, "163765", 2), 0);
  });

  it("custo_acessorios filtra 146, 424 e 640", () => {
    assert.deepEqual([...CODIGOS_CUSTO_ACESSORIOS], [146, 424, 640]);
  });

  it("custo_despesas_gerais (migration 048) usa SUBQUERY por TIPO=9 em NBS.CUSTOS_ESPECIFICOS, NÃO uma lista fixa de CODIGO_CUSTO", () => {
    const sql = sqlSelectCustosPorCategoria("custo_despesas_gerais");
    assert.match(sql, /WHERE CODIGO_CUSTO IN \(SELECT CODIGO_CUSTO FROM NBS\.CUSTOS_ESPECIFICOS WHERE TIPO = 9\)/);
    assert.equal(TIPO_POR_CATEGORIA.custo_despesas_gerais, 9);
    // Não deve ter uma lista de códigos literal (diferente das outras 4) nem entrar em CODIGOS_POR_CATEGORIA.
    assert.ok(!("custo_despesas_gerais" in CODIGOS_POR_CATEGORIA));
  });

  it("CODIGOS_POR_CATEGORIA cobre exatamente as 3 categorias de LISTA FIXA (Revisões e Despesas Gerais usam TIPO)", () => {
    assert.deepEqual(Object.keys(CODIGOS_POR_CATEGORIA).sort(), [...CATEGORIAS_LISTA_FIXA].sort());
  });

  it("CODIGOS_POR_CATEGORIA NÃO tem mais custo_forplan/custo_holdback (migration 043 — colunas diretas)", () => {
    assert.ok(!("custo_forplan" in CODIGOS_POR_CATEGORIA));
    assert.ok(!("custo_holdback" in CODIGOS_POR_CATEGORIA));
  });
});

describe("construirMapaCustoDetalhado — agregação por chassi_resumido+cod_empresa", () => {
  it("soma múltiplas linhas do MESMO chassi+empresa", () => {
    const mapa = construirMapaCustoDetalhado([
      { chassiResumido: "ABC123", codEmpresa: 2, total: 500 },
      { chassiResumido: "ABC123", codEmpresa: 2, total: 300 },
    ]);
    assert.equal(mapa.get(chaveCustoDetalhado("ABC123", 2)), 800);
  });

  it("mantém chaves separadas pro MESMO chassi em empresas diferentes", () => {
    const mapa = construirMapaCustoDetalhado([
      { chassiResumido: "ABC123", codEmpresa: 2, total: 500 },
      { chassiResumido: "ABC123", codEmpresa: 9, total: 100 },
    ]);
    assert.equal(mapa.get(chaveCustoDetalhado("ABC123", 2)), 500);
    assert.equal(mapa.get(chaveCustoDetalhado("ABC123", 9)), 100);
  });

  it("ignora linha sem chassi_resumido", () => {
    const mapa = construirMapaCustoDetalhado([{ chassiResumido: "", codEmpresa: 2, total: 500 }]);
    assert.equal(mapa.size, 0);
  });

  it("lista vazia -> Map vazio", () => {
    assert.equal(construirMapaCustoDetalhado([]).size, 0);
  });
});

describe("buscarCustoDetalhado — regras gerais (mesmo contrato de buscarValoriza)", () => {
  it("chassi+empresa sem linha no Map -> 0 (fato conhecido: sem custo lançado), nunca null/undefined", () => {
    const mapa = construirMapaCustoDetalhado([{ chassiResumido: "XYZ999", codEmpresa: 2, total: 1500 }]);
    assert.equal(buscarCustoDetalhado(mapa, "OUTRO_CHASSI", 2), 0);
  });

  it("mesmo chassi em loja diferente da que tem o custo lançado -> 0 (chave não bate)", () => {
    const mapa = construirMapaCustoDetalhado([{ chassiResumido: "XYZ999", codEmpresa: 2, total: 1500 }]);
    assert.equal(buscarCustoDetalhado(mapa, "XYZ999", 9), 0);
  });

  it("chassi_resumido ausente (null/undefined) -> 0, não lança erro", () => {
    const mapa = construirMapaCustoDetalhado([]);
    assert.equal(buscarCustoDetalhado(mapa, null, 2), 0);
    assert.equal(buscarCustoDetalhado(mapa, undefined, 2), 0);
  });

  it("cod_empresa ausente (null/undefined) -> 0, não lança erro", () => {
    const mapa = construirMapaCustoDetalhado([{ chassiResumido: "ABC", codEmpresa: 2, total: 100 }]);
    assert.equal(buscarCustoDetalhado(mapa, "ABC", null), 0);
    assert.equal(buscarCustoDetalhado(mapa, "ABC", undefined), 0);
  });

  it("Map vazio (categoria zerada pra esse veículo) -> sempre 0", () => {
    const mapa = new Map<string, number>();
    assert.equal(buscarCustoDetalhado(mapa, "QUALQUER", 2), 0);
  });

  it("match exato (SCR3B78, loja 2, R$ 541 de impostos)", () => {
    const mapa = construirMapaCustoDetalhado([{ chassiResumido: "SCR3B78", codEmpresa: 2, total: 541 }]);
    assert.equal(buscarCustoDetalhado(mapa, "SCR3B78", 2), 541);
  });
});

describe("mapearVeiculo — 5 categorias via mapasCustosDetalhados (CHASSI_RESUMIDO + LOJA_ATUAL da row)", () => {
  it("row com CHASSI_RESUMIDO/LOJA_ATUAL presentes nos Maps -> todas as 5 categorias preenchidas", () => {
    const mapasCustosDetalhados = Object.fromEntries(
      CATEGORIAS.map((categoria, i) => [
        categoria,
        construirMapaCustoDetalhado([{ chassiResumido: "SCR3B78", codEmpresa: 2, total: (i + 1) * 100 }]),
      ]),
    ) as Record<CategoriaCustoDetalhado, Map<string, number>>;

    const { veiculo: v } = mapearVeiculo({ CHASSI_RESUMIDO: "SCR3B78", LOJA_ATUAL: 2 }, { mapasCustosDetalhados });

    assert.equal(v.custo_impostos, 100);
    assert.equal(v.custo_revisoes, 200);
    assert.equal(v.custo_acessorios, 300);
    assert.equal(v.custo_comissoes, 400);
    assert.equal(v.custo_despesas_gerais, 500);
  });

  it("row sem entrada correspondente nos Maps -> todas as 5 categorias 0 (não null)", () => {
    const mapasCustosDetalhados = Object.fromEntries(
      CATEGORIAS.map((categoria) => [
        categoria,
        construirMapaCustoDetalhado([{ chassiResumido: "OUTRO", codEmpresa: 2, total: 9999 }]),
      ]),
    ) as Record<CategoriaCustoDetalhado, Map<string, number>>;

    const { veiculo: v } = mapearVeiculo({ CHASSI_RESUMIDO: "SCR3B78", LOJA_ATUAL: 2 }, { mapasCustosDetalhados });

    for (const categoria of CATEGORIAS) {
      assert.equal(v[categoria], 0, `${categoria} deveria ser 0, não null/undefined`);
    }
  });

  it("sem mapasCustosDetalhados nos lookups (não fornecido) -> todas as 5 categorias 0, não lança erro", () => {
    const { veiculo: v } = mapearVeiculo({ CHASSI_RESUMIDO: "SCR3B78", LOJA_ATUAL: 2 });
    for (const categoria of CATEGORIAS) assert.equal(v[categoria], 0);
  });

  it("nenhuma das 5 categorias é reportada em camposSemFonte (são campos computados, não colunas diretas)", () => {
    const { camposSemFonte } = mapearVeiculo({});
    for (const categoria of CATEGORIAS) assert.ok(!camposSemFonte.includes(categoria));
  });

  it("mapearVeiculo NUNCA seta custo_adm (nem no retorno, nem em camposSemFonte) — única categoria ainda fora de escopo", () => {
    const { veiculo: v, camposSemFonte } = mapearVeiculo({ CHASSI_RESUMIDO: "SCR3B78", LOJA_ATUAL: 2 });
    assert.ok(!("custo_adm" in v), "VeiculoParsed não deve ter campo custo_adm — fora de escopo, sem CODIGO_CUSTO/TIPO mapeado");
    assert.ok(!camposSemFonte.includes("custo_adm"));
  });
});

describe("mapearVeiculo — custo_forplan/custo_holdback via coluna DIRETA (migration 043, não mais mapasCustosDetalhados)", () => {
  it("lê CUSTO_FORPLAN_FINAL e HOLD_BACK_FINAL direto da row (mesmo padrão de custo_total)", () => {
    const { veiculo: v } = mapearVeiculo({ CUSTO_FORPLAN_FINAL: 9667.36, HOLD_BACK_FINAL: 0 });
    assert.equal(v.custo_forplan, 9667.36);
    assert.equal(v.custo_holdback, 0);
  });

  it("CUSTO_FORPLAN_FINAL/HOLD_BACK_FINAL ausentes ou NULL (carro sem fechamento ainda) -> 0, nunca null", () => {
    const { veiculo: v1 } = mapearVeiculo({});
    assert.equal(v1.custo_forplan, 0);
    assert.equal(v1.custo_holdback, 0);

    const { veiculo: v2 } = mapearVeiculo({ CUSTO_FORPLAN_FINAL: null, HOLD_BACK_FINAL: null });
    assert.equal(v2.custo_forplan, 0);
    assert.equal(v2.custo_holdback, 0);
  });

  it("mapasCustosDetalhados não afeta mais custo_forplan/custo_holdback (só as 5 categorias via CODIGO_CUSTO/TIPO)", () => {
    const mapasCustosDetalhados = {
      custo_forplan: construirMapaCustoDetalhado([{ chassiResumido: "SCR3B78", codEmpresa: 2, total: 99999 }]),
    } as unknown as Record<CategoriaCustoDetalhado, Map<string, number>>;

    const { veiculo: v } = mapearVeiculo(
      { CHASSI_RESUMIDO: "SCR3B78", LOJA_ATUAL: 2, CUSTO_FORPLAN_FINAL: 123.45 },
      { mapasCustosDetalhados },
    );
    // Se ainda lesse do Map, daria 99999 — tem que vir da coluna direta (123.45).
    assert.equal(v.custo_forplan, 123.45);
  });
});

describe("toRow (src/lib/data/veiculos.ts) — payload do upsert/insert nunca grava custo_adm", () => {
  it("payload inclui as 7 colunas de custo detalhado com o valor do VeiculoParsed (4 via CODIGO_CUSTO lista fixa + 1 via TIPO + 2 via coluna direta)", () => {
    const v = veiculo({
      custo_impostos: 541,
      custo_revisoes: 230,
      custo_holdback: 0,
      custo_acessorios: 0,
      custo_forplan: 0,
      custo_comissoes: 0,
      custo_despesas_gerais: 1988,
    });
    const row = toRow(v, 1);
    assert.equal(row.custo_impostos, 541);
    assert.equal(row.custo_revisoes, 230);
    assert.equal(row.custo_holdback, 0);
    assert.equal(row.custo_acessorios, 0);
    assert.equal(row.custo_forplan, 0);
    assert.equal(row.custo_comissoes, 0);
    assert.equal(row.custo_despesas_gerais, 1988);
  });

  it("payload NUNCA inclui a chave custo_adm (nem como 0, nem como qualquer valor) — fica NULL no banco", () => {
    const row = toRow(veiculo(), 1);
    assert.ok(!("custo_adm" in row), "toRow não deve incluir custo_adm no payload — coluna NULLABLE SEM DEFAULT");
  });
});
