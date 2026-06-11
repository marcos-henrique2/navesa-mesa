/**
 * Testes do parser BR-tolerante de valor monetário.
 *
 * Por que existe:
 *   A versão anterior do parser (embutida em RepassesLista) parseava "1.000"
 *   como 1 (não 1000), perdendo 3 ordens de magnitude. Esses testes garantem
 *   que entradas ambíguas sejam rejeitadas (null) em vez de adivinhadas
 *   erradas — precisão financeira centavo-perfect é regra do projeto.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseValorBR } from "@/lib/utils/parse-br";

describe("parseValorBR — formato BR canônico", () => {
  it('"1.000" trata ponto como milhar → 1000', () => {
    assert.equal(parseValorBR("1.000"), 1000);
  });

  it('"1,000" trata vírgula como milhar (BR tolerante) → 1000', () => {
    assert.equal(parseValorBR("1,000"), 1000);
  });

  it('"1.234.567,89" formato BR completo → 1234567.89', () => {
    assert.equal(parseValorBR("1.234.567,89"), 1234567.89);
  });

  it('"R$ 138.500,00" com prefixo e espaços → 138500.00', () => {
    assert.equal(parseValorBR("R$ 138.500,00"), 138500);
  });

  it('"138500" sem separador → 138500', () => {
    assert.equal(parseValorBR("138500"), 138500);
  });

  it('"0" zero é válido', () => {
    assert.equal(parseValorBR("0"), 0);
  });
});

describe("parseValorBR — decimal", () => {
  it('"1.5" trata ponto como decimal → 1.5', () => {
    assert.equal(parseValorBR("1.5"), 1.5);
  });

  it('"1,5" trata vírgula como decimal → 1.5', () => {
    assert.equal(parseValorBR("1,5"), 1.5);
  });

  it('"12.34" decimal de 2 casas com ponto → 12.34', () => {
    assert.equal(parseValorBR("12.34"), 12.34);
  });

  it('"12,34" decimal de 2 casas com vírgula → 12.34', () => {
    assert.equal(parseValorBR("12,34"), 12.34);
  });

  it('"1234,56" decimal sem milhar → 1234.56', () => {
    assert.equal(parseValorBR("1234,56"), 1234.56);
  });
});

describe("parseValorBR — rejeitar ambiguidades e lixo", () => {
  it('"" string vazia → null', () => {
    assert.equal(parseValorBR(""), null);
  });

  it('"   " só espaços → null', () => {
    assert.equal(parseValorBR("   "), null);
  });

  it('"abc" texto puro → null', () => {
    assert.equal(parseValorBR("abc"), null);
  });

  it('"12e10" notação científica → null', () => {
    assert.equal(parseValorBR("12e10"), null);
  });

  it('"1.5e3" notação científica disfarçada → null', () => {
    assert.equal(parseValorBR("1.5e3"), null);
  });

  it('"12,34,56" 3 grupos ambíguos → null', () => {
    assert.equal(parseValorBR("12,34,56"), null);
  });

  it('"1.000,5.0" mistura inválida → null', () => {
    assert.equal(parseValorBR("1.000,5.0"), null);
  });

  it('"-100" negativo → null (não aceita pra valor de subida)', () => {
    assert.equal(parseValorBR("-100"), null);
  });

  it('"1,234.56" formato US (ponto decimal depois de vírgula milhar) → null', () => {
    // No contexto BR, vírgula tem que ser SEMPRE depois do último ponto.
    assert.equal(parseValorBR("1,234.56"), null);
  });

  it('"100." sufixo de separador sem dígitos → null', () => {
    assert.equal(parseValorBR("100."), null);
  });

  it('".50" prefixo sem dígitos → null', () => {
    assert.equal(parseValorBR(".50"), null);
  });

  it('"1.23.45" grupos de milhar de tamanho errado → null', () => {
    assert.equal(parseValorBR("1.23.45"), null);
  });
});
