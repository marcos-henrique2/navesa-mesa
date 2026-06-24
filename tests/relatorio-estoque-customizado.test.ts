/**
 * Testes do Relatório de Estoque Customizável.
 *
 * O Marcos escolhe QUAIS colunas exportar (do catálogo `colunas-estoque`), na
 * ordem canônica do catálogo, com uma coluna "Observações" opcional sempre em
 * branco (pra ele anotar no Excel) e AutoFilter em TODAS as colunas.
 *
 * Layout (igual em espírito ao gerencial):
 *   - Linha 1: título NAVESA
 *   - Linha 2: meta (data / loja / total)
 *   - Linha 3: header das colunas escolhidas
 *   - Linha 4+: dados (só colunas escolhidas, ordem do catálogo)
 *   - AutoFilter cobrindo o header inteiro + frozen 3 linhas
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { gerarRelatorioEstoqueCustomizado } from "@/lib/export/relatorio-estoque-customizado";
import type { ColunaKey } from "@/lib/export/colunas-estoque";
import { veiculo } from "./_mocks";

async function abrir(blob: Blob): Promise<ExcelJS.Workbook> {
  const ab = await blob.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(ab);
  return wb;
}

const COLS_BASICAS: ColunaKey[] = ["placa", "modelo", "preco_venda"];

describe("gerarRelatorioEstoqueCustomizado", () => {
  it("retorna um Blob não vazio", async () => {
    const blob = await gerarRelatorioEstoqueCustomizado([veiculo()], {
      colunas: COLS_BASICAS,
      incluirObservacoes: false,
    });
    assert.ok(blob instanceof Blob);
    assert.ok(blob.size > 1000);
  });

  it("título linha 1 contém NAVESA e menciona estoque", async () => {
    const blob = await gerarRelatorioEstoqueCustomizado([veiculo()], {
      colunas: COLS_BASICAS,
      incluirObservacoes: false,
    });
    const ws = (await abrir(blob)).worksheets[0]!;
    const titulo = String(ws.getCell("A1").value ?? "");
    assert.match(titulo, /NAVESA/);
    assert.match(titulo, /ESTOQUE/i);
  });

  it("header (linha 3) tem SÓ as colunas escolhidas, na ordem do catálogo", async () => {
    // Pede em ordem trocada — o relatório deve reordenar pra ordem do catálogo
    // (modelo vem antes de preço; placa antes de modelo).
    const blob = await gerarRelatorioEstoqueCustomizado([veiculo()], {
      colunas: ["preco_venda", "modelo", "placa"],
      incluirObservacoes: false,
    });
    const ws = (await abrir(blob)).worksheets[0]!;
    assert.equal(ws.getCell("A3").value, "Placa");
    assert.equal(ws.getCell("B3").value, "Modelo");
    assert.equal(ws.getCell("C3").value, "Preço de venda");
    // 4ª coluna não existe.
    assert.equal(ws.getCell("D3").value ?? "", "");
  });

  it("dados (linha 4) trazem os valores das colunas escolhidas", async () => {
    const blob = await gerarRelatorioEstoqueCustomizado(
      [veiculo({ placa: "ABC1D23", modelo: "RANGER XLT", preco_venda: 145000 })],
      { colunas: COLS_BASICAS, incluirObservacoes: false },
    );
    const ws = (await abrir(blob)).worksheets[0]!;
    assert.equal(ws.getCell("A4").value, "ABC1D23");
    assert.equal(ws.getCell("B4").value, "RANGER XLT");
    assert.equal(ws.getCell("C4").value, 145000);
  });

  it("incluirObservacoes=true adiciona coluna 'Observações' no FIM, vazia nos dados", async () => {
    const blob = await gerarRelatorioEstoqueCustomizado([veiculo()], {
      colunas: COLS_BASICAS,
      incluirObservacoes: true,
    });
    const ws = (await abrir(blob)).worksheets[0]!;
    // 3 colunas escolhidas + Observações na 4ª (D).
    assert.equal(ws.getCell("D3").value, "Observações");
    // Célula de dados da Observações fica vazia.
    assert.equal(ws.getCell("D4").value ?? "", "");
    // Não há 5ª coluna.
    assert.equal(ws.getCell("E3").value ?? "", "");
  });

  it("incluirObservacoes=false NÃO cria coluna Observações", async () => {
    const blob = await gerarRelatorioEstoqueCustomizado([veiculo()], {
      colunas: COLS_BASICAS,
      incluirObservacoes: false,
    });
    const ws = (await abrir(blob)).worksheets[0]!;
    const headers = (ws.getRow(3).values as Array<string | undefined>).map((h) => String(h ?? ""));
    assert.ok(!headers.includes("Observações"), "não deveria ter coluna Observações");
  });

  it("número de colunas do header = nº escolhidas (+1 se Observações)", async () => {
    const semObs = (await abrir(
      await gerarRelatorioEstoqueCustomizado([veiculo()], {
        colunas: ["placa", "modelo", "km", "preco_venda"],
        incluirObservacoes: false,
      }),
    )).worksheets[0]!;
    const headerSem = (semObs.getRow(3).values as unknown[]).filter((c) => c != null && c !== "");
    assert.equal(headerSem.length, 4);

    const comObs = (await abrir(
      await gerarRelatorioEstoqueCustomizado([veiculo()], {
        colunas: ["placa", "modelo", "km", "preco_venda"],
        incluirObservacoes: true,
      }),
    )).worksheets[0]!;
    const headerCom = (comObs.getRow(3).values as unknown[]).filter((c) => c != null && c !== "");
    assert.equal(headerCom.length, 5);
  });

  it("AutoFilter cobre TODAS as colunas, do início ao header inteiro (com Observações)", async () => {
    const blob = await gerarRelatorioEstoqueCustomizado([veiculo()], {
      colunas: ["placa", "modelo", "km"], // 3 + Observações = 4 colunas (A..D)
      incluirObservacoes: true,
    });
    const ws = (await abrir(blob)).worksheets[0]!;
    const af = String(ws.autoFilter ?? "");
    assert.match(af, /A3/, `autoFilter deve começar em A3: ${af}`);
    assert.match(af, /D3/, `autoFilter deve ir até D3 (4 colunas): ${af}`);
  });

  it("AutoFilter sem Observações cobre exatamente as colunas escolhidas", async () => {
    const blob = await gerarRelatorioEstoqueCustomizado([veiculo()], {
      colunas: ["placa", "modelo", "km", "preco_venda", "margem"], // 5 colunas A..E
      incluirObservacoes: false,
    });
    const ws = (await abrir(blob)).worksheets[0]!;
    const af = String(ws.autoFilter ?? "");
    assert.match(af, /A3/, `início A3: ${af}`);
    assert.match(af, /E3/, `fim E3 (5 colunas): ${af}`);
  });

  it("congela as 3 linhas de cabeçalho", async () => {
    const blob = await gerarRelatorioEstoqueCustomizado([veiculo()], {
      colunas: COLS_BASICAS,
      incluirObservacoes: false,
    });
    const ws = (await abrir(blob)).worksheets[0]!;
    const view = (ws.views ?? [])[0];
    assert.ok(view);
    assert.equal(view!.state, "frozen");
    assert.equal(view!.ySplit, 3);
  });

  it("colunas de moeda vêm formatadas como R$ (numFmt BRL)", async () => {
    const blob = await gerarRelatorioEstoqueCustomizado(
      [veiculo({ preco_venda: 110000 })],
      { colunas: ["placa", "preco_venda"], incluirObservacoes: false },
    );
    const ws = (await abrir(blob)).worksheets[0]!;
    assert.match(String(ws.getCell("B4").numFmt ?? ""), /R\$/);
  });

  it("coluna KM vem com sufixo km no numFmt", async () => {
    const blob = await gerarRelatorioEstoqueCustomizado(
      [veiculo({ km: 84000 })],
      { colunas: ["placa", "km"], incluirObservacoes: false },
    );
    const ws = (await abrir(blob)).worksheets[0]!;
    assert.equal(ws.getCell("B4").value, 84000);
    assert.match(String(ws.getCell("B4").numFmt ?? ""), /km/);
  });

  it("respeita exatamente os veículos recebidos (já filtrados) — N linhas de dados", async () => {
    const blob = await gerarRelatorioEstoqueCustomizado(
      [
        veiculo({ placa: "AAA1A11" }),
        veiculo({ placa: "BBB2B22" }),
        veiculo({ placa: "CCC3C33" }),
      ],
      { colunas: ["placa"], incluirObservacoes: false },
    );
    const ws = (await abrir(blob)).worksheets[0]!;
    assert.equal(ws.getCell("A4").value, "AAA1A11");
    assert.equal(ws.getCell("A5").value, "BBB2B22");
    assert.equal(ws.getCell("A6").value, "CCC3C33");
    assert.equal(ws.getCell("A7").value ?? "", "");
  });

  it("filtroLoja aparece na linha de meta quando informado", async () => {
    const blob = await gerarRelatorioEstoqueCustomizado([veiculo()], {
      colunas: COLS_BASICAS,
      incluirObservacoes: false,
      filtroLoja: "MATRIZ",
    });
    const ws = (await abrir(blob)).worksheets[0]!;
    const metaTexto = (ws.getRow(2).values as Array<string | undefined>)
      .map((c) => String(c ?? ""))
      .join(" | ");
    assert.match(metaTexto, /MATRIZ/);
  });

  it("lista vazia: gera mesmo assim com título + header, sem dados", async () => {
    const blob = await gerarRelatorioEstoqueCustomizado([], {
      colunas: COLS_BASICAS,
      incluirObservacoes: false,
    });
    const ws = (await abrir(blob)).worksheets[0]!;
    assert.equal(ws.getCell("A3").value, "Placa");
    assert.equal(ws.getCell("A4").value ?? "", "");
  });

  it("sem colunas escolhidas mas com Observações: gera só a coluna Observações", async () => {
    const blob = await gerarRelatorioEstoqueCustomizado([veiculo()], {
      colunas: [],
      incluirObservacoes: true,
    });
    const ws = (await abrir(blob)).worksheets[0]!;
    assert.equal(ws.getCell("A3").value, "Observações");
    assert.equal(ws.getCell("A4").value ?? "", "");
  });
});
