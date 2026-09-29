/**
 * Testes do núcleo PURO da Conferência Auto Avaliar.
 *
 * Cobre: precedência vendido > estoque > não encontrado, junção de linhas da
 * loja alvo com as de outra loja, e o resumo agregado.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classificarConferencia,
  entradasDoParse,
  type EntradaConferencia,
  type VendaRefConferencia,
} from "@/lib/conferencia-auto-avaliar/classificar";
import type { LinhaOfertaAA, LinhaOutraLoja } from "@/lib/parsers/auto-avaliar-ofertas-xls";

function entrada(over: Partial<EntradaConferencia> & { placa_norm: string }): EntradaConferencia {
  return {
    linha: 2,
    loja: "NAVESA - GO/MATRIZ",
    placa_raw: over.placa_norm,
    marca: "FORD",
    modelo: "RANGER XLS",
    ...over,
  };
}

function venda(over: Partial<VendaRefConferencia> = {}): VendaRefConferencia {
  return {
    valor_venda: 95000,
    data_venda: "2026-09-20",
    cliente_nome: "João da Silva",
    vendedor_nome: "Carlos",
    ...over,
  };
}

describe("classificarConferencia — precedência e status", () => {
  it("achou em vendas → VENDIDO, com os dados da venda", () => {
    const r = classificarConferencia(
      [entrada({ placa_norm: "ABC1D23" })],
      new Map([["ABC1D23", venda()]]),
      new Set<string>(),
    );
    assert.equal(r.itens[0].status, "vendido");
    assert.deepEqual(r.itens[0].venda, venda());
    assert.deepEqual(r.resumo, { total: 1, vendidos: 1, em_estoque: 0, nao_encontrados: 0 });
  });

  it("não achou em vendas, achou em veiculos_atual → EM ESTOQUE, sem dados de venda", () => {
    const r = classificarConferencia(
      [entrada({ placa_norm: "ABC1D23" })],
      new Map<string, VendaRefConferencia>(),
      new Set(["ABC1D23"]),
    );
    assert.equal(r.itens[0].status, "estoque");
    assert.equal(r.itens[0].venda, null);
    assert.deepEqual(r.resumo, { total: 1, vendidos: 0, em_estoque: 1, nao_encontrados: 0 });
  });

  it("não achou em nenhum dos dois → NÃO ENCONTRADO", () => {
    const r = classificarConferencia(
      [entrada({ placa_norm: "ABC1D23" })],
      new Map<string, VendaRefConferencia>(),
      new Set<string>(),
    );
    assert.equal(r.itens[0].status, "nao_encontrado");
    assert.equal(r.itens[0].venda, null);
    assert.deepEqual(r.resumo, { total: 1, vendidos: 0, em_estoque: 0, nao_encontrados: 1 });
  });

  it("vendido tem prioridade sobre estoque (venda é fato mais forte que sync atrasado)", () => {
    const r = classificarConferencia(
      [entrada({ placa_norm: "ABC1D23" })],
      new Map([["ABC1D23", venda()]]),
      new Set(["ABC1D23"]),
    );
    assert.equal(r.itens[0].status, "vendido");
  });

  it("resumo agrega múltiplas linhas nos três baldes", () => {
    const r = classificarConferencia(
      [
        entrada({ placa_norm: "AAA1111" }),
        entrada({ placa_norm: "BBB2222" }),
        entrada({ placa_norm: "CCC3333" }),
        entrada({ placa_norm: "DDD4444" }),
      ],
      new Map([
        ["AAA1111", venda()],
        ["BBB2222", venda()],
      ]),
      new Set(["CCC3333"]),
    );
    assert.deepEqual(r.resumo, { total: 4, vendidos: 2, em_estoque: 1, nao_encontrados: 1 });
  });
});

describe("entradasDoParse — junta loja alvo e outra loja", () => {
  function linhaLojaAlvo(over: Partial<LinhaOfertaAA> & { linha: number; placa_norm: string }): LinhaOfertaAA {
    return {
      loja: "NAVESA - GO/MATRIZ",
      placa_raw: over.placa_norm,
      marca: "FORD",
      modelo: "RANGER XLS",
      versao: "XLS 4X4",
      ano_fabricacao: 2021,
      ano_modelo: 2022,
      qtde_anuncios: 1,
      valor_compra_repasse: 90000,
      valor_minimo: 100000,
      valor_compre_por: 105000,
      valor_maior_oferta: null,
      valor_web: null,
      valor_fipe: null,
      valor_auto_avaliar: null,
      ...over,
    };
  }

  it("junta as duas listas, ordenadas pela ordem original do arquivo", () => {
    const entradas = entradasDoParse({
      linhas: [linhaLojaAlvo({ linha: 3, placa_norm: "AAA1111" })],
      outra_loja: [
        { linha: 2, loja: "NAVESA - GO/AP DE GOIÂNIA", placa_norm: "BBB2222", modelo: "COROLLA" } satisfies LinhaOutraLoja,
      ],
    });
    assert.equal(entradas.length, 2);
    assert.equal(entradas[0].placa_norm, "BBB2222"); // linha 2 vem antes
    assert.equal(entradas[0].loja, "NAVESA - GO/AP DE GOIÂNIA");
    assert.equal(entradas[0].marca, null); // outra_loja não traz marca
    assert.equal(entradas[1].placa_norm, "AAA1111"); // linha 3
    assert.equal(entradas[1].marca, "FORD");
  });

  it("linha de outra loja usa placa_norm como placa_raw (parser não preserva o formato original)", () => {
    const entradas = entradasDoParse({
      linhas: [],
      outra_loja: [{ linha: 1, loja: "OUTRA LOJA", placa_norm: "BBB2222", modelo: null } satisfies LinhaOutraLoja],
    });
    assert.equal(entradas[0].placa_raw, "BBB2222");
  });
});
