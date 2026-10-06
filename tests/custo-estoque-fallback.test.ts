/**
 * Testes de `resolverCustoComFallbackManual` — fallback pras 5 categorias de
 * custo de estoque sem fonte automática confiável no Oracle (HoldBack,
 * Acessórios, Comissões, ADM, Despesas Gerais). Ver colunas-estoque.ts e
 * migration 047_investigacao_acessorios_comissoes_adm_despgerais.sql.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolverCustoComFallbackManual } from "@/lib/export/custo-estoque-fallback";

describe("resolverCustoComFallbackManual", () => {
  it("automático não-zero prevalece, mesmo com manual presente", () => {
    assert.equal(resolverCustoComFallbackManual(200, 150), 200);
  });

  it("automático zerado + manual presente: usa o manual (fallback)", () => {
    assert.equal(resolverCustoComFallbackManual(0, 150), 150);
  });

  it("automático null + manual presente: usa o manual (fallback) — caso ADM/Despesas Gerais", () => {
    assert.equal(resolverCustoComFallbackManual(null, 80), 80);
    assert.equal(resolverCustoComFallbackManual(undefined, 80), 80);
  });

  it("automático zerado + sem manual: mantém 0 (padrão das categorias sempre-número)", () => {
    assert.equal(resolverCustoComFallbackManual(0, null), 0);
    assert.equal(resolverCustoComFallbackManual(0, undefined), 0);
  });

  it("automático null + sem manual: mantém null (padrão 'não apurado')", () => {
    assert.equal(resolverCustoComFallbackManual(null, null), null);
    assert.equal(resolverCustoComFallbackManual(undefined, undefined), null);
  });

  it("manual zero não é tratado como 'ausente' — ainda é um valor válido de fallback", () => {
    assert.equal(resolverCustoComFallbackManual(0, 0), 0);
    assert.equal(resolverCustoComFallbackManual(null, 0), 0);
  });
});
