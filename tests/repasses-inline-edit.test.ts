/**
 * Testes do inline edit dos campos manuais (Caminho B).
 *
 * Cobre:
 *   - Type guards isIpvaStatus / isDocStatus / isCautelarStatus
 *   - Constantes de labels (IPVA_LABEL, DOC_LABEL, CAUTELAR_LABEL)
 *   - Validação de updateRepasseCampos: rejeita valores fora do enum,
 *     rejeita valor_subir negativo/NaN/Infinity, patch vazio.
 *
 * Como updateRepasseCampos chama getSupabase() (browser-only),
 * só testamos os caminhos que disparam Error ANTES do request — defesa em
 * profundidade. Os caminhos felizes ficam pra teste e2e/manual no /repasses.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CAUTELAR_LABEL,
  CAUTELAR_VALUES,
  DOC_LABEL,
  DOC_VALUES,
  IPVA_LABEL,
  IPVA_VALUES,
  isCautelarStatus,
  isDocStatus,
  isIpvaStatus,
} from "@/lib/repasses/types";
import { updateRepasseCampos } from "@/lib/repasses/queries";

describe("Type guards de status manuais", () => {
  it("isIpvaStatus aceita só pago/em_aberto/nao_verificado", () => {
    assert.equal(isIpvaStatus("pago"), true);
    assert.equal(isIpvaStatus("em_aberto"), true);
    assert.equal(isIpvaStatus("nao_verificado"), true);
    assert.equal(isIpvaStatus("invalido"), false);
    assert.equal(isIpvaStatus(""), false);
    assert.equal(isIpvaStatus(null), false);
    assert.equal(isIpvaStatus(undefined), false);
    assert.equal(isIpvaStatus(42), false);
  });

  it("isDocStatus aceita só ok/pendente/irregular/nao_verificado", () => {
    assert.equal(isDocStatus("ok"), true);
    assert.equal(isDocStatus("pendente"), true);
    assert.equal(isDocStatus("irregular"), true);
    assert.equal(isDocStatus("nao_verificado"), true);
    assert.equal(isDocStatus("OK"), false); // case-sensitive
    assert.equal(isDocStatus("vendido"), false); // status legacy de outra dimensão
    assert.equal(isDocStatus(null), false);
  });

  it("isCautelarStatus aceita só limpa/com_restricao/nao_verificada", () => {
    assert.equal(isCautelarStatus("limpa"), true);
    assert.equal(isCautelarStatus("com_restricao"), true);
    assert.equal(isCautelarStatus("nao_verificada"), true);
    assert.equal(isCautelarStatus("aprovado"), false); // valor do sistema cautelar, não manual
    assert.equal(isCautelarStatus("reprovado"), false);
    assert.equal(isCautelarStatus(null), false);
  });
});

describe("Labels pt-BR", () => {
  it("IPVA_LABEL tem labels pros 3 valores", () => {
    assert.equal(IPVA_LABEL.pago, "Pago");
    assert.equal(IPVA_LABEL.em_aberto, "Em aberto");
    assert.equal(IPVA_LABEL.nao_verificado, "Não verificado");
  });

  it("DOC_LABEL tem labels pros 4 valores", () => {
    assert.equal(DOC_LABEL.ok, "OK");
    assert.equal(DOC_LABEL.pendente, "Pendente");
    assert.equal(DOC_LABEL.irregular, "Irregular");
    assert.equal(DOC_LABEL.nao_verificado, "Não verificado");
  });

  it("CAUTELAR_LABEL tem labels pros 3 valores", () => {
    assert.equal(CAUTELAR_LABEL.limpa, "Limpa");
    assert.equal(CAUTELAR_LABEL.com_restricao, "Com restrição");
    assert.equal(CAUTELAR_LABEL.nao_verificada, "Não verificada");
  });

  it("VALUES arrays batem com chaves dos LABEL records", () => {
    assert.deepEqual([...IPVA_VALUES].sort(), Object.keys(IPVA_LABEL).sort());
    assert.deepEqual([...DOC_VALUES].sort(), Object.keys(DOC_LABEL).sort());
    assert.deepEqual([...CAUTELAR_VALUES].sort(), Object.keys(CAUTELAR_LABEL).sort());
  });
});

describe("updateRepasseCampos — validação (defesa em profundidade)", () => {
  it("rejeita ipva_status fora do enum antes de chamar o banco", async () => {
    await assert.rejects(
      updateRepasseCampos(1, {
        ipva_status: "invalido" as unknown as "pago",
      }),
      /ipva_status inválido/,
    );
  });

  it("rejeita documentacao_status fora do enum", async () => {
    await assert.rejects(
      updateRepasseCampos(1, {
        documentacao_status: "vendido" as unknown as "ok",
      }),
      /documentacao_status inválido/,
    );
  });

  it("rejeita cautelar_status_manual fora do enum (não confunde com cautelar do sistema)", async () => {
    // 'aprovado' é valor do StatusCautelar do sistema, não do manual.
    await assert.rejects(
      updateRepasseCampos(1, {
        cautelar_status_manual: "aprovado" as unknown as "limpa",
      }),
      /cautelar_status_manual inválido/,
    );
  });

  it("rejeita valor_subir negativo", async () => {
    await assert.rejects(updateRepasseCampos(1, { valor_subir: -100 }), /valor_subir inválido/);
  });

  it("rejeita valor_subir NaN", async () => {
    await assert.rejects(
      updateRepasseCampos(1, { valor_subir: Number.NaN }),
      /valor_subir inválido/,
    );
  });

  it("rejeita valor_subir Infinity", async () => {
    await assert.rejects(
      updateRepasseCampos(1, { valor_subir: Number.POSITIVE_INFINITY }),
      /valor_subir inválido/,
    );
  });

  it("rejeita valor_auto_avaliar negativo", async () => {
    await assert.rejects(
      updateRepasseCampos(1, { valor_auto_avaliar: -1 }),
      /valor_auto_avaliar inválido/,
    );
  });

  it("rejeita valor_auto_avaliar NaN (lixo)", async () => {
    await assert.rejects(
      updateRepasseCampos(1, { valor_auto_avaliar: Number.NaN }),
      /valor_auto_avaliar inválido/,
    );
  });

  it("rejeita valor_auto_avaliar Infinity (lixo)", async () => {
    await assert.rejects(
      updateRepasseCampos(1, { valor_auto_avaliar: Number.POSITIVE_INFINITY }),
      /valor_auto_avaliar inválido/,
    );
  });

  it("aceita valor_auto_avaliar null pra limpar (passa da validação)", async () => {
    // null é válido — limpa o campo. Não pode ser barrado pela validação;
    // o erro que sobra é o do getSupabase() (browser-only em ambiente Node).
    await assert.rejects(
      updateRepasseCampos(1, { valor_auto_avaliar: null }),
      (err: Error) => !/valor_auto_avaliar inválido/.test(err.message),
    );
  });

  it("aceita valor_auto_avaliar >= 0 (passa da validação)", async () => {
    // 0 e positivos são válidos. Erro restante é do getSupabase(), não da validação.
    await assert.rejects(
      updateRepasseCampos(1, { valor_auto_avaliar: 0 }),
      (err: Error) => !/valor_auto_avaliar inválido/.test(err.message),
    );
  });

  it("rejeita observacoes não-string (defensivo)", async () => {
    await assert.rejects(
      updateRepasseCampos(1, {
        observacoes: 42 as unknown as string,
      }),
      /observacoes inválido/,
    );
  });

  it("rejeita patch vazio (chamada sem efeito)", async () => {
    await assert.rejects(updateRepasseCampos(1, {}), /patch vazio/);
  });
});
