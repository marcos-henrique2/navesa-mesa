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
  getColuna,
  type ColunaKey,
} from "@/lib/export/colunas-estoque";
import { veiculo } from "./_mocks";

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
});
