/**
 * Testes de preco_venda no sync Oracle -> Supabase.
 *
 * Por que existe:
 *   preco_venda (preço de tabela/venda do carro em estoque) vinha sempre
 *   null do sync Oracle. Causa raiz: CANDIDATOS.preco_venda apontava pra
 *   PRECO_VENDA e VALOR_VENDA, nenhuma das duas colunas existe de verdade em
 *   NBS.VEICULOS (confirmado via ALL_TAB_COLUMNS). A coluna certa é
 *   PRECO_TABELA — validada com 100% de cobertura no estoque atual
 *   (1.114/1.114 veículos), valores reais e coerentes (ex: RBN2B89 ->
 *   R$279.900, SCR3B78 -> R$162.800), 01/10/2026. Ver mapear-veiculo.ts.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapearVeiculo } from "../scripts/sync-nbs/mapear-veiculo";

describe("mapearVeiculo — preco_venda via PRECO_TABELA", () => {
  it("PRECO_TABELA preenchido -> preco_venda com o valor numérico", () => {
    const { veiculo } = mapearVeiculo({ PRECO_TABELA: 279900 });
    assert.equal(veiculo.preco_venda, 279900);
  });

  it("PRECO_TABELA ausente -> preco_venda null, reportado como campo sem fonte", () => {
    const { veiculo, camposSemFonte } = mapearVeiculo({});
    assert.equal(veiculo.preco_venda, null);
    assert.ok(camposSemFonte.includes("preco_venda"));
  });

  it("PRECO_VENDA/VALOR_VENDA (colunas antigas, inexistentes de verdade) não são mais usadas como fallback", () => {
    const { veiculo, camposSemFonte } = mapearVeiculo({ PRECO_VENDA: 999, VALOR_VENDA: 888 });
    assert.equal(veiculo.preco_venda, null);
    assert.ok(camposSemFonte.includes("preco_venda"));
  });
});
