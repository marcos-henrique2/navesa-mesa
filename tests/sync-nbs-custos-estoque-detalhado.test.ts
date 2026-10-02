/**
 * Testes de custos de estoque detalhados (6 categorias do relatório nativo
 * NBS "Custos de Veículos em Estoque") no sync Oracle -> Supabase.
 *
 * Por que existe:
 *   `veiculos.custo_total` hoje é um valor AGREGADO vindo direto do Oracle.
 *   Esta migration (040_custos_estoque_detalhado_em_veiculos.sql) quebra esse
 *   agregado em 6 categorias individuais (Impostos, Revisões, HoldBack,
 *   Acessórios, Forplan, Comissões), cada uma vinda de
 *   NBS.VEICULOS_CUSTOS_ESPECIFICOS filtrada por um conjunto de CODIGO_CUSTO
 *   diferente, somada por chassi_resumido+loja atual — mesmo padrão de
 *   valoriza.ts, mas rodando UMA QUERY POR CATEGORIA (6 no total) em vez de
 *   um IN() gigante com todos os códigos juntos: testado com 73 códigos numa
 *   query só e precisou ser cancelado depois de 15+min contra a tabela
 *   (55,9 milhões de linhas, sem índice em CODIGO_CUSTO). Ver
 *   scripts/sync-nbs/custos-estoque-detalhado.ts e cabeçalho da migration 040
 *   pra detalhes de confiança por categoria e códigos candidatos descartados.
 *
 *   `custo_adm` e `custo_despesas_gerais` são OUTRAS 2 colunas da mesma
 *   migration (NULLABLE SEM DEFAULT) que ficam FORA deste módulo de
 *   propósito: nenhum CODIGO_CUSTO foi encontrado pra elas (hipótese: rateio
 *   calculado pelo motor do relatório NBS). Não devem ser escritas por código
 *   algum nesta rodada — NULL = "não apurado", diferente de "fato conhecido
 *   de custo zero" (0) das outras 6 categorias.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CODIGOS_CUSTO_IMPOSTOS,
  CODIGOS_CUSTO_REVISOES,
  CODIGOS_CUSTO_HOLDBACK,
  CODIGOS_CUSTO_ACESSORIOS,
  CODIGOS_CUSTO_FORPLAN,
  CODIGOS_CUSTO_COMISSOES,
  CODIGOS_POR_CATEGORIA,
  sqlSelectCustosPorCategoria,
  construirMapaCustoDetalhado,
  buscarCustoDetalhado,
  chaveCustoDetalhado,
  type CategoriaCustoDetalhado,
} from "../scripts/sync-nbs/custos-estoque-detalhado";
import { mapearVeiculo } from "../scripts/sync-nbs/mapear-veiculo";
import { toRow } from "../src/lib/data/veiculos";
import { veiculo } from "./_mocks";

const CATEGORIAS: CategoriaCustoDetalhado[] = [
  "custo_impostos",
  "custo_revisoes",
  "custo_holdback",
  "custo_acessorios",
  "custo_forplan",
  "custo_comissoes",
];

describe("sqlSelectCustosPorCategoria — uma query por categoria, nunca um IN() combinado", () => {
  it("monta SELECT ... GROUP BY CHASSI_RESUMIDO, COD_EMPRESA contra NBS.VEICULOS_CUSTOS_ESPECIFICOS", () => {
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

  it("custo_revisoes filtra os 33 códigos de confiança média da migration 040", () => {
    assert.equal(CODIGOS_CUSTO_REVISOES.length, 33);
    const sql = sqlSelectCustosPorCategoria("custo_revisoes");
    for (const codigo of CODIGOS_CUSTO_REVISOES) assert.match(sql, new RegExp(`\\b${codigo}\\b`));
  });

  it("custo_holdback filtra 144 e 681", () => {
    assert.deepEqual([...CODIGOS_CUSTO_HOLDBACK], [144, 681]);
  });

  it("custo_acessorios filtra 146, 424 e 640", () => {
    assert.deepEqual([...CODIGOS_CUSTO_ACESSORIOS], [146, 424, 640]);
  });

  it("custo_forplan filtra só o candidato único 133 (\"Foorplan\", typo do NBS)", () => {
    assert.deepEqual([...CODIGOS_CUSTO_FORPLAN], [133]);
  });

  it("CODIGOS_POR_CATEGORIA cobre exatamente as 6 categorias implementadas (não ADM/Despesas Gerais)", () => {
    assert.deepEqual(Object.keys(CODIGOS_POR_CATEGORIA).sort(), [...CATEGORIAS].sort());
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

describe("mapearVeiculo — 6 categorias via mapasCustosDetalhados (CHASSI_RESUMIDO + LOJA_ATUAL da row)", () => {
  it("row com CHASSI_RESUMIDO/LOJA_ATUAL presentes nos Maps -> todas as 6 categorias preenchidas", () => {
    const mapasCustosDetalhados = Object.fromEntries(
      CATEGORIAS.map((categoria, i) => [
        categoria,
        construirMapaCustoDetalhado([{ chassiResumido: "SCR3B78", codEmpresa: 2, total: (i + 1) * 100 }]),
      ]),
    ) as Record<CategoriaCustoDetalhado, Map<string, number>>;

    const { veiculo: v } = mapearVeiculo({ CHASSI_RESUMIDO: "SCR3B78", LOJA_ATUAL: 2 }, { mapasCustosDetalhados });

    assert.equal(v.custo_impostos, 100);
    assert.equal(v.custo_revisoes, 200);
    assert.equal(v.custo_holdback, 300);
    assert.equal(v.custo_acessorios, 400);
    assert.equal(v.custo_forplan, 500);
    assert.equal(v.custo_comissoes, 600);
  });

  it("row sem entrada correspondente nos Maps -> todas as 6 categorias 0 (não null)", () => {
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

  it("sem mapasCustosDetalhados nos lookups (não fornecido) -> todas as 6 categorias 0, não lança erro", () => {
    const { veiculo: v } = mapearVeiculo({ CHASSI_RESUMIDO: "SCR3B78", LOJA_ATUAL: 2 });
    for (const categoria of CATEGORIAS) assert.equal(v[categoria], 0);
  });

  it("nenhuma das 6 categorias é reportada em camposSemFonte (são campos computados, não colunas diretas)", () => {
    const { camposSemFonte } = mapearVeiculo({});
    for (const categoria of CATEGORIAS) assert.ok(!camposSemFonte.includes(categoria));
  });

  it("mapearVeiculo NUNCA seta custo_adm nem custo_despesas_gerais (nem no retorno, nem em camposSemFonte)", () => {
    const { veiculo: v, camposSemFonte } = mapearVeiculo({ CHASSI_RESUMIDO: "SCR3B78", LOJA_ATUAL: 2 });
    assert.ok(!("custo_adm" in v), "VeiculoParsed não deve ter campo custo_adm — fora de escopo, sem CODIGO_CUSTO mapeado");
    assert.ok(
      !("custo_despesas_gerais" in v),
      "VeiculoParsed não deve ter campo custo_despesas_gerais — fora de escopo, sem CODIGO_CUSTO mapeado",
    );
    assert.ok(!camposSemFonte.includes("custo_adm"));
    assert.ok(!camposSemFonte.includes("custo_despesas_gerais"));
  });
});

describe("toRow (src/lib/data/veiculos.ts) — payload do upsert/insert nunca grava custo_adm/custo_despesas_gerais", () => {
  it("payload inclui as 6 categorias implementadas com o valor do VeiculoParsed", () => {
    const v = veiculo({
      custo_impostos: 541,
      custo_revisoes: 230,
      custo_holdback: 0,
      custo_acessorios: 0,
      custo_forplan: 0,
      custo_comissoes: 0,
    });
    const row = toRow(v, 1);
    assert.equal(row.custo_impostos, 541);
    assert.equal(row.custo_revisoes, 230);
    assert.equal(row.custo_holdback, 0);
    assert.equal(row.custo_acessorios, 0);
    assert.equal(row.custo_forplan, 0);
    assert.equal(row.custo_comissoes, 0);
  });

  it("payload NUNCA inclui a chave custo_adm (nem como 0, nem como qualquer valor) — fica NULL no banco", () => {
    const row = toRow(veiculo(), 1);
    assert.ok(!("custo_adm" in row), "toRow não deve incluir custo_adm no payload — coluna NULLABLE SEM DEFAULT");
  });

  it("payload NUNCA inclui a chave custo_despesas_gerais (nem como 0, nem como qualquer valor) — fica NULL no banco", () => {
    const row = toRow(veiculo(), 1);
    assert.ok(
      !("custo_despesas_gerais" in row),
      "toRow não deve incluir custo_despesas_gerais no payload — coluna NULLABLE SEM DEFAULT",
    );
  });
});
