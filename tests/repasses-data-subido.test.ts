/**
 * Backfill de `data_subido` (migration 027) — consequências observáveis no app.
 *
 * O backfill em si é SQL one-shot; a corretude DELE é conferida pelas queries de
 * verificação no rodapé da migration. O que se testa aqui é o que o código
 * TypeScript precisa fazer certo pra o backfill não virar mentira na tela:
 *
 *   1. `rowToRepasse` traduz a coluna nova sem inventar aproximação onde não há
 *      (inclusive antes da migration ser aplicada, quando a coluna nem vem).
 *   2. `montarItemAnuncio` propaga a flag pro item que a UI renderiza com "~".
 *   3. O clamp do `least(data_subiu, current_date)` tem par no cliente: mesmo se
 *      uma data futura escapar pro banco, "dias em repasse" nunca fica negativo.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rowToRepasse, type RepasseRow } from "@/lib/repasses/queries";
import { montarItemAnuncio, type CarroAnuncioInput } from "@/lib/repasses/relatorio-anuncio";
import { calcularDiasNoRepasse } from "@/lib/repasses/margem-repasse";

function buildRow(over: Partial<RepasseRow> = {}): RepasseRow {
  return {
    id: 1,
    chassi: "9BWZZZ377VT004251",
    placa: "ABC1D23",
    modelo: "RANGER XLT",
    marca: "Ford",
    cor: "Branco",
    ano_modelo: 2022,
    ano_fabricacao: 2021,
    km: 85000,
    loja_origem: 2,
    patio_origem: "AEROPORTO",
    valor_aquisicao: 120000,
    valor_compra_repasse: null,
    valor_minimo: null,
    valor_compre_por: null,
    valor_subiu: 145000,
    data_subiu: "2026-05-01",
    data_subido: "2026-05-01",
    canal: "auto_avaliar",
    status: "subido",
    valor_vendido: null,
    data_vendido: null,
    comprador: null,
    ipva_status: null,
    ipva_responsavel: null,
    documentacao_status: null,
    cautelar_status_manual: null,
    valor_subir: null,
    observacoes: null,
    criado_em: "2026-05-01T12:00:00Z",
    atualizado_em: "2026-05-01T12:00:00Z",
    ...over,
  };
}

function buildInput(over: Partial<CarroAnuncioInput> = {}): CarroAnuncioInput {
  return {
    id: 1,
    placa: "ABC1D23",
    modelo: "RANGER XLT",
    marca: "Ford",
    ano_fabricacao: 2021,
    ano_modelo: 2022,
    km: 85000,
    status: "subido",
    data_subiu: "2026-07-01",
    data_vendido: null,
    valor_minimo: null,
    valor_compre_por: null,
    valor_compra_repasse: null,
    fipe: null,
    gastos: [],
    interessados: 0,
    ...over,
  };
}

describe("rowToRepasse — data_subido_aproximada", () => {
  it("true no banco → true no domínio (registro backfillado)", () => {
    assert.equal(rowToRepasse(buildRow({ data_subido_aproximada: true })).data_subido_aproximada, true);
  });

  it("false no banco → false (data observada)", () => {
    assert.equal(
      rowToRepasse(buildRow({ data_subido_aproximada: false })).data_subido_aproximada,
      false,
    );
  });

  it("coluna ausente (antes da migration 027) → false, nunca undefined", () => {
    const r = rowToRepasse(buildRow());
    assert.equal(r.data_subido_aproximada, false);
    assert.equal(typeof r.data_subido_aproximada, "boolean");
  });

  it("null no banco → false (não vira 'aproximada' por acidente)", () => {
    assert.equal(
      rowToRepasse(buildRow({ data_subido_aproximada: null })).data_subido_aproximada,
      false,
    );
  });

  it("não mexe em data_subido: a flag é metadado, não a data", () => {
    const r = rowToRepasse(buildRow({ data_subido: "2026-05-01", data_subido_aproximada: true }));
    assert.equal(r.data_subido, "2026-05-01");
  });
});

describe("montarItemAnuncio — diasAproximados", () => {
  it("registro backfillado marca os dias como aproximados", () => {
    const it_ = montarItemAnuncio(buildInput({ data_subido_aproximada: true }), "2026-08-04");
    assert.equal(it_.diasAproximados, true);
    assert.equal(it_.diasNoRepasse, 34); // é o "~34 d" do critério de aceite
  });

  it("registro normal não marca aproximação", () => {
    const it_ = montarItemAnuncio(buildInput({ data_subido_aproximada: false }), "2026-08-04");
    assert.equal(it_.diasAproximados, false);
    assert.equal(it_.diasNoRepasse, 34);
  });

  it("campo omitido conta como data observada (compat com chamadas antigas)", () => {
    assert.equal(montarItemAnuncio(buildInput(), "2026-08-04").diasAproximados, false);
  });

  it("a flag não altera o número de dias, só como ele é apresentado", () => {
    const aprox = montarItemAnuncio(buildInput({ data_subido_aproximada: true }), "2026-08-04");
    const exato = montarItemAnuncio(buildInput({ data_subido_aproximada: false }), "2026-08-04");
    assert.equal(aprox.diasNoRepasse, exato.diasNoRepasse);
  });
});

describe("clamp de data futura (par cliente do least(data_subiu, current_date))", () => {
  it("data de subida no futuro não produz dias negativos", () => {
    assert.equal(calcularDiasNoRepasse("2026-08-20", null, "2026-08-04"), 0);
  });

  it("data de subida = hoje → 0 dias", () => {
    assert.equal(calcularDiasNoRepasse("2026-08-04", null, "2026-08-04"), 0);
  });

  it("sem data de origem → null (a linha mostra '—', não 0)", () => {
    assert.equal(calcularDiasNoRepasse(null, null, "2026-08-04"), null);
  });
});
