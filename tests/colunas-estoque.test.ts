/**
 * Testes do catálogo de colunas exportáveis do estoque.
 *
 * O catálogo é PURO: cada coluna sabe seu label pt-BR, formato e como extrair
 * o valor de um VeiculoParsed (getter). A coluna "Observações" é especial —
 * sempre em branco (sem getter), só entra no XLSX quando o usuário pede.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  COLUNAS_ESTOQUE,
  COLUNAS_DEFAULT,
  GRUPOS_ESTOQUE,
  getColuna,
  normalizarBusca,
  colunaCorrespondeABusca,
  grupoAbrePorDefault,
  gruposAbertosPorDefault,
  type ColunaKey,
  type GrupoColuna,
} from "@/lib/export/colunas-estoque";
import { veiculo } from "./_mocks";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";

describe("colunas-estoque (catálogo)", () => {
  it("expõe lista não vazia de colunas com keys únicas", () => {
    assert.ok(COLUNAS_ESTOQUE.length >= 10, "deveria ter pelo menos 10 colunas");
    const keys = COLUNAS_ESTOQUE.map((c) => c.key);
    assert.equal(new Set(keys).size, keys.length, "keys devem ser únicas");
  });

  it("toda coluna tem key, label pt-BR não vazio e formato válido", () => {
    const formatosValidos = new Set(["texto", "numero", "moeda", "km", "ano"]);
    for (const c of COLUNAS_ESTOQUE) {
      assert.ok(c.key.length > 0, "key vazia");
      assert.ok(c.label.trim().length > 0, `label vazio em ${c.key}`);
      assert.ok(formatosValidos.has(c.formato), `formato inválido em ${c.key}: ${c.formato}`);
    }
  });

  it("getColuna resolve coluna por key e undefined pra key inexistente", () => {
    const placa = getColuna("placa");
    assert.ok(placa);
    assert.equal(placa!.label, "Placa");
    assert.equal(getColuna("nao_existe" as ColunaKey), undefined);
  });

  it("getter da placa retorna a placa do veículo", () => {
    const col = getColuna("placa");
    const v = veiculo({ placa: "XYZ9Z99" });
    assert.equal(col!.getValor(v), "XYZ9Z99");
  });

  it("getter de campos numéricos (km, preço, custo) retorna o número cru", () => {
    const v = veiculo({ km: 84000, preco_venda: 110000, valor_aquisicao: 90000 });
    assert.equal(getColuna("km")!.getValor(v), 84000);
    assert.equal(getColuna("preco_venda")!.getValor(v), 110000);
    assert.equal(getColuna("valor_aquisicao")!.getValor(v), 90000);
  });

  it("getter de margem deriva preco_venda - valor_aquisicao", () => {
    const v = veiculo({ preco_venda: 110000, valor_aquisicao: 90000 });
    assert.equal(getColuna("margem")!.getValor(v), 20000);
  });

  it("getter de margem retorna null quando falta preço ou aquisição", () => {
    assert.equal(getColuna("margem")!.getValor(veiculo({ preco_venda: null })), null);
    assert.equal(getColuna("margem")!.getValor(veiculo({ valor_aquisicao: null })), null);
  });

  it("getter de ano combina fabricação/modelo em texto pt-BR", () => {
    const col = getColuna("ano");
    assert.equal(col!.getValor(veiculo({ ano_fabricacao: 2021, ano_modelo: 2022 })), "2021/2022");
    assert.equal(col!.getValor(veiculo({ ano_fabricacao: 2022, ano_modelo: 2022 })), "2022");
    assert.equal(col!.getValor(veiculo({ ano_fabricacao: null, ano_modelo: null })), null);
  });

  it("getter de campos opcionais nulos retorna null (não string vazia)", () => {
    assert.equal(getColuna("marca")!.getValor(veiculo({ marca: null })), null);
    assert.equal(getColuna("cor_externa")!.getValor(veiculo({ cor_externa: null })), null);
    assert.equal(getColuna("dias_patio")!.getValor(veiculo({ dias_patio: null })), null);
  });

  it("COLUNAS_DEFAULT contém as colunas de partida e todas existem no catálogo", () => {
    const esperadas: ColunaKey[] = [
      "placa",
      "marca",
      "modelo",
      "ano",
      "km",
      "dias_patio",
      "valor_aquisicao",
      "preco_venda",
      "margem",
    ];
    for (const k of esperadas) {
      assert.ok(COLUNAS_DEFAULT.includes(k), `default deveria incluir ${k}`);
      assert.ok(getColuna(k), `default ${k} deveria existir no catálogo`);
    }
  });

  it("NÃO existe coluna 'observacoes' no catálogo (é tratada à parte, sem getter)", () => {
    assert.equal(getColuna("observacoes" as ColunaKey), undefined);
  });

  it("tem exatamente 25 colunas (16 originais + 9 novas de custos/valoriza)", () => {
    assert.equal(COLUNAS_ESTOQUE.length, 25);
  });

  it("as 9 colunas novas existem, no formato moeda/soma e lêem o campo certo", () => {
    const casos: [ColunaKey, string, number | null][] = [
      ["valoriza", "Valoriza (bônus fábrica)", 123],
      ["custo_revisoes", "Revisões", 456],
      ["custo_forplan", "Forplan", 10],
      ["custo_holdback", "HoldBack", 11],
      ["custo_acessorios", "Acessórios", 12],
      ["custo_impostos", "Impostos", 13],
      ["custo_comissoes", "Comissões", 14],
    ];
    for (const [key, label, valor] of casos) {
      const col = getColuna(key);
      assert.ok(col, `coluna ${key} deveria existir`);
      assert.equal(col!.label, label);
      assert.equal(col!.formato, "moeda");
      assert.equal(col!.agregacao, "soma");
      assert.equal(col!.getValor(veiculo({ [key]: valor } as unknown as Partial<VeiculoParsed>)), valor);
    }

    const adm = getColuna("custo_adm");
    assert.ok(adm);
    assert.equal(adm!.label, "ADM");
    assert.equal(adm!.getValor(veiculo({ custo_adm: null })), null);
    assert.equal(adm!.getValor(veiculo({ custo_adm: 99 })), 99);

    const despesas = getColuna("custo_despesas_gerais");
    assert.ok(despesas);
    assert.equal(despesas!.label, "Despesas Gerais");
    assert.equal(despesas!.getValor(veiculo({ custo_despesas_gerais: null })), null);
    assert.equal(despesas!.getValor(veiculo({ custo_despesas_gerais: 77 })), 77);
  });

  it("cada coluna pertence a um dos 5 grupos, nos agrupamentos esperados", () => {
    const esperado: Record<ColunaKey, GrupoColuna> = {
      placa: "identificacao",
      chassi: "identificacao",
      marca: "identificacao",
      modelo: "identificacao",
      ano: "identificacao",
      km: "identificacao",
      cor_externa: "identificacao",
      combustivel: "identificacao",
      loja: "localizacao_status",
      dias_patio: "localizacao_status",
      descricao_situacao: "localizacao_status",
      patio: "localizacao_status",
      valor_aquisicao: "custos",
      valoriza: "custos",
      custo_total: "custos",
      custo_impostos: "custos_detalhados",
      custo_revisoes: "custos_detalhados",
      custo_forplan: "custos_detalhados",
      custo_holdback: "custos_detalhados",
      custo_acessorios: "custos_detalhados",
      custo_comissoes: "custos_detalhados",
      custo_adm: "custos_detalhados",
      custo_despesas_gerais: "custos_detalhados",
      preco_venda: "venda_margem",
      margem: "venda_margem",
      // keys do contrato genérico que não existem como coluna própria aqui:
      ano_fabricacao: "identificacao",
      ano_modelo: "identificacao",
    };
    for (const c of COLUNAS_ESTOQUE) {
      assert.equal(c.grupo, esperado[c.key], `grupo errado em ${c.key}`);
    }
    assert.equal(new Set(COLUNAS_ESTOQUE.map((c) => c.grupo)).size, GRUPOS_ESTOQUE.length);
  });

  it("confiança baixa só nas 3 colunas de custo Oracle pouco confirmadas", () => {
    // custo_forplan SAIU dessa lista em 05/10/2026: fonte corrigida pra
    // NBS.VEICULOS.CUSTO_FORPLAN_FINAL (coluna direta), confirmada ao
    // centavo contra o relatório nativo PDF em 3 veículos — ver migration 043.
    const esperadoBaixa: ColunaKey[] = ["custo_holdback", "custo_acessorios", "custo_comissoes"];
    for (const key of esperadoBaixa) {
      assert.equal(getColuna(key)!.confianca, "baixa", `${key} deveria ser confiança baixa`);
    }
  });

  it("confiança 'não apurado' só em custo_adm e custo_despesas_gerais", () => {
    assert.equal(getColuna("custo_adm")!.confianca, "nao_apurado");
    assert.equal(getColuna("custo_despesas_gerais")!.confianca, "nao_apurado");
  });

  it("custo_impostos, custo_revisoes e custo_forplan NÃO têm indicador de confiança", () => {
    assert.equal(getColuna("custo_impostos")!.confianca, undefined);
    assert.equal(getColuna("custo_revisoes")!.confianca, undefined);
    assert.equal(getColuna("custo_forplan")!.confianca, undefined);
  });

  it("nenhuma outra coluna tem indicador de confiança além das 5 esperadas", () => {
    const comConfianca = COLUNAS_ESTOQUE.filter((c) => c.confianca != null).map((c) => c.key).sort();
    assert.deepEqual(
      comConfianca,
      ["custo_acessorios", "custo_adm", "custo_comissoes", "custo_despesas_gerais", "custo_holdback"].sort(),
    );
  });
});

describe("normalizarBusca / colunaCorrespondeABusca (busca do modal)", () => {
  it("remove acentos e ignora caixa", () => {
    assert.equal(normalizarBusca("Comissões"), "comissoes");
    assert.equal(normalizarBusca("LOCALIZAÇÃO"), "localizacao");
    assert.equal(normalizarBusca("Forplan"), "forplan");
  });

  it("termo vazio (ou só espaços) sempre corresponde", () => {
    const col = getColuna("custo_forplan")!;
    assert.equal(colunaCorrespondeABusca(col, ""), true);
    assert.equal(colunaCorrespondeABusca(col, "   "), true);
  });

  it("corresponde ao label ignorando acento/caixa, em qualquer posição", () => {
    const col = getColuna("custo_comissoes")!; // label "Comissões"
    assert.equal(colunaCorrespondeABusca(col, "comissoes"), true);
    assert.equal(colunaCorrespondeABusca(col, "COMISSÕES"), true);
    assert.equal(colunaCorrespondeABusca(col, "miss"), true);
    assert.equal(colunaCorrespondeABusca(col, "xyz"), false);
  });

  it("não corresponde a termo que não aparece no label", () => {
    const col = getColuna("placa")!;
    assert.equal(colunaCorrespondeABusca(col, "chassi"), false);
  });
});

describe("expand/collapse padrão dos grupos (sem busca)", () => {
  it("abre os grupos com ≥1 coluna em COLUNAS_DEFAULT; deixa 'custos_detalhados' fechado", () => {
    const abertos = gruposAbertosPorDefault();
    assert.ok(abertos.has("identificacao"));
    assert.ok(abertos.has("localizacao_status"));
    assert.ok(abertos.has("custos"));
    assert.ok(abertos.has("venda_margem"));
    assert.ok(!abertos.has("custos_detalhados"));
  });

  it("grupoAbrePorDefault reflete exatamente se alguma default pertence ao grupo", () => {
    assert.equal(grupoAbrePorDefault("identificacao"), true); // placa, marca, modelo, ano, km
    assert.equal(grupoAbrePorDefault("custos_detalhados"), false); // nenhuma default
  });

  it("com uma lista de defaults customizada, só os grupos tocados abrem", () => {
    const abertos = gruposAbertosPorDefault(["custo_forplan"]);
    assert.deepEqual([...abertos], ["custos_detalhados"]);
  });

  it("com defaults vazio, nenhum grupo abre sozinho", () => {
    const abertos = gruposAbertosPorDefault([]);
    assert.equal(abertos.size, 0);
  });
});
