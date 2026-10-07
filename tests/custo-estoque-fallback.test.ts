/**
 * Testes de `resolverCustoComFallbackManual` — fallback pras 5 categorias de
 * custo de estoque sem fonte automática confiável no Oracle (HoldBack,
 * Acessórios, Comissões, ADM, Despesas Gerais). Ver colunas-estoque.ts e
 * migration 047_investigacao_acessorios_comissoes_adm_despgerais.sql.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolverCustoComFallbackManual,
  resolverCustoImpostosComPrioridadeManual,
} from "@/lib/export/custo-estoque-fallback";

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

/**
 * Testes de `resolverCustoImpostosComPrioridadeManual` — variante EXCLUSIVA
 * de Impostos com prioridade invertida: o manual vence sempre que existir
 * (não-nulo), independente do automático ser ≠0. Ver comentário da função e
 * caso real da placa RBV7G98 (automático=1600, PDF real=2740.80).
 */
describe("resolverCustoImpostosComPrioridadeManual", () => {
  it("manual presente e ≠ automático: manual vence, mesmo com automático ≠0 — caso RBV7G98", () => {
    assert.equal(resolverCustoImpostosComPrioridadeManual(1600, 2740.8), 2740.8);
  });

  it("manual presente e = 0: ainda vence (0), não cai pro automático", () => {
    assert.equal(resolverCustoImpostosComPrioridadeManual(1600, 0), 0);
  });

  it("manual ausente: usa o automático", () => {
    assert.equal(resolverCustoImpostosComPrioridadeManual(1600, null), 1600);
    assert.equal(resolverCustoImpostosComPrioridadeManual(1600, undefined), 1600);
  });

  it("automático e manual ausentes: devolve 0 (categoria sempre-número)", () => {
    assert.equal(resolverCustoImpostosComPrioridadeManual(null, null), 0);
    assert.equal(resolverCustoImpostosComPrioridadeManual(undefined, undefined), 0);
  });
});
