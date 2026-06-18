/**
 * Testes da captura do "Cód. Proposta Internet" (col 310) no parser de estoque.
 *
 * Regra: preenchido (≠ vazio, ≠ "----", ≠ "0") → carro RESERVADO (cod_proposta
 * = código). Vazio / "0" / "----" → cod_proposta = null.
 *
 * Monta uma planilha AOA mínima em memória com as colunas que o parser exige
 * (0 cód empresa, 2 modelo, 3 chassi, 13 placa, 22 pátio) + a col 310.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { parseNbsXlsx, type VeiculoParsed } from "@/lib/parsers/nbs-xlsx";
import { estaReservado } from "@/lib/inventory/reservado";

const COL_COD_EMPRESA = 0;
const COL_MODELO = 2;
const COL_CHASSI = 3;
const COL_PLACA = 13;
const COL_PATIO = 22;
const COL_COD_PROPOSTA = 310;

/** Cria uma linha de dados (array esparso) com os campos essenciais preenchidos. */
function linhaDados(over: { placa: string; codProposta?: unknown }): unknown[] {
  const row: unknown[] = new Array(450).fill(null);
  row[COL_COD_EMPRESA] = 2;
  row[COL_MODELO] = "MODELO TESTE";
  row[COL_CHASSI] = `CHASSI${over.placa}`;
  row[COL_PLACA] = over.placa;
  row[COL_PATIO] = "AEROPORTO";
  if (over.codProposta !== undefined) row[COL_COD_PROPOSTA] = over.codProposta;
  return row;
}

/** Monta o buffer XLSX no layout esperado: título(0), data(1), header(2), dados(3+). */
async function parseComLinhas(linhas: unknown[][]): Promise<VeiculoParsed[]> {
  const header: unknown[] = new Array(450).fill(null);
  header[COL_COD_EMPRESA] = "Cód Empresa";
  const aoa: unknown[][] = [
    ["RELATORIO DE ESTOQUE"],
    ["Gerado em 18/06/2026 10:00:00"],
    header,
    ...linhas,
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Estoque");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const { veiculos } = await parseNbsXlsx(buf, "estoque-teste.xlsx");
  return veiculos;
}

describe("nbs-xlsx — captura cod_proposta (col 310)", () => {
  it("col 310 preenchida → cod_proposta = código (reservado)", async () => {
    const veiculos = await parseComLinhas([linhaDados({ placa: "RBV7G98", codProposta: "12345" })]);
    assert.equal(veiculos.length, 1);
    assert.equal(veiculos[0].cod_proposta, "12345");
    assert.equal(estaReservado(veiculos[0]), true);
  });

  it('col 310 = "0" → cod_proposta = null (não reservado)', async () => {
    const veiculos = await parseComLinhas([linhaDados({ placa: "ABC1D23", codProposta: "0" })]);
    assert.equal(veiculos.length, 1);
    assert.equal(veiculos[0].cod_proposta, null);
    assert.equal(estaReservado(veiculos[0]), false);
  });

  it("col 310 vazia → cod_proposta = null", async () => {
    const veiculos = await parseComLinhas([linhaDados({ placa: "DEF2G45" })]);
    assert.equal(veiculos.length, 1);
    assert.equal(veiculos[0].cod_proposta, null);
    assert.equal(estaReservado(veiculos[0]), false);
  });

  it('col 310 = "----" → cod_proposta = null (tratado por asStr)', async () => {
    const veiculos = await parseComLinhas([linhaDados({ placa: "GHI3J67", codProposta: "----" })]);
    assert.equal(veiculos.length, 1);
    assert.equal(veiculos[0].cod_proposta, null);
  });

  it("carro sem proposta continua entrando normalmente no estoque", async () => {
    const veiculos = await parseComLinhas([
      linhaDados({ placa: "RBV7G98", codProposta: "999" }),
      linhaDados({ placa: "SEM0P01" }),
    ]);
    assert.equal(veiculos.length, 2);
    const semProposta = veiculos.find((v) => v.placa === "SEM0P01");
    assert.ok(semProposta, "carro sem proposta deve entrar no estoque");
    assert.equal(semProposta?.cod_proposta, null);
  });
});
