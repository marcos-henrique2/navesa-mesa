/**
 * Testes de participação de vendas por loja (Story 1 — Dashboard).
 *
 * Garante:
 *   - Vazio sem vendas
 *   - % soma 100% (± arredondamento)
 *   - Ordenação desc por %
 *   - cod_empresa fora do cadastro cai no fallback (nome da venda ou "Loja X")
 *   - cod_empresa null vira "Não identificado" — nunca descartado
 *   - 1 loja só => 100%
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calcularParticipacaoLojas, NAO_IDENTIFICADO } from "@/lib/analytics/participacao-lojas";
import { venda } from "./_mocks";
import type { LojaInfo } from "@/lib/store/inventoryStore";

function mapaLojas(...infos: LojaInfo[]): Record<number, LojaInfo> {
  return Object.fromEntries(infos.map((l) => [l.cod_empresa, l]));
}

describe("calcularParticipacaoLojas", () => {
  it("retorna vazio se não há vendas", () => {
    assert.deepEqual(calcularParticipacaoLojas([], {}), []);
  });

  it("uma única loja com vendas mostra 100% sem quebrar", () => {
    const vendas = [
      venda({ placa: "A1", cod_empresa: 2 }),
      venda({ placa: "A2", cod_empresa: 2 }),
    ];
    const r = calcularParticipacaoLojas(vendas, mapaLojas({ cod_empresa: 2, nome: "AEROPORTO", cidade: "GOIANIA" }));
    assert.equal(r.length, 1);
    assert.equal(r[0].qt, 2);
    assert.equal(r[0].pct, 100);
  });

  it("soma dos % de todas as lojas (+ Não identificado) bate 100%", () => {
    const vendas = [
      venda({ placa: "A1", cod_empresa: 2 }),
      venda({ placa: "A2", cod_empresa: 2 }),
      venda({ placa: "B1", cod_empresa: 3 }),
      venda({ placa: "C1", cod_empresa: null as unknown as number }),
    ];
    const r = calcularParticipacaoLojas(vendas, mapaLojas(
      { cod_empresa: 2, nome: "AEROPORTO", cidade: "GOIANIA" },
      { cod_empresa: 3, nome: "SUL", cidade: "GOIANIA" },
    ));
    const somaPct = r.reduce((s, x) => s + x.pct, 0);
    assert.ok(Math.abs(somaPct - 100) < 0.0001, `soma ${somaPct} deveria ser ~100`);
  });

  it("ordena do maior pro menor % (desc)", () => {
    const vendas = [
      venda({ placa: "A1", cod_empresa: 2 }),
      venda({ placa: "B1", cod_empresa: 3 }),
      venda({ placa: "B2", cod_empresa: 3 }),
      venda({ placa: "B3", cod_empresa: 3 }),
    ];
    const r = calcularParticipacaoLojas(vendas, mapaLojas(
      { cod_empresa: 2, nome: "AEROPORTO", cidade: "GOIANIA" },
      { cod_empresa: 3, nome: "SUL", cidade: "GOIANIA" },
    ));
    assert.equal(r[0].cod, 3);
    assert.equal(r[0].qt, 3);
    assert.equal(r[1].cod, 2);
    assert.equal(r[1].qt, 1);
  });

  it("cod_empresa fora do cadastro usa nome da própria venda como fallback", () => {
    const vendas = [venda({ placa: "A1", cod_empresa: 99, empresa_nome: "LOJA NOVA" })];
    const r = calcularParticipacaoLojas(vendas, {});
    assert.equal(r[0].loja, "LOJA NOVA");
  });

  it("cod_empresa fora do cadastro e sem nome na venda cai em 'Loja X'", () => {
    const vendas = [venda({ placa: "A1", cod_empresa: 99, empresa_nome: null as unknown as string })];
    const r = calcularParticipacaoLojas(vendas, {});
    assert.equal(r[0].loja, "Loja 99");
  });

  it("cod_empresa null vira 'Não identificado' e não é descartado", () => {
    const vendas = [
      venda({ placa: "A1", cod_empresa: 2 }),
      venda({ placa: "A2", cod_empresa: null as unknown as number }),
    ];
    const r = calcularParticipacaoLojas(vendas, mapaLojas({ cod_empresa: 2, nome: "AEROPORTO", cidade: "GOIANIA" }));
    const naoIdent = r.find((x) => x.loja === NAO_IDENTIFICADO);
    assert.ok(naoIdent);
    assert.equal(naoIdent.qt, 1);
    assert.equal(naoIdent.cod, null);
    assert.equal(naoIdent.pct, 50);
  });

  it("cadastro de lojas (nome atual) tem prioridade sobre nome vindo da venda", () => {
    const vendas = [venda({ placa: "A1", cod_empresa: 2, empresa_nome: "NOME ANTIGO" })];
    const r = calcularParticipacaoLojas(vendas, mapaLojas({ cod_empresa: 2, nome: "NOME NOVO", cidade: "GOIANIA" }));
    assert.equal(r[0].loja, "NOME NOVO");
  });
});
