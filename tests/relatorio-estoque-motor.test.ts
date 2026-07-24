/**
 * Testes da LIGAÇÃO estoque → motor genérico (Fatia A).
 *
 *  - Catálogo do estoque agora carrega `agregacao` (teste puro).
 *  - Não-regressão: o `RelatorioDef` de estoque, renderizado pelo motor novo,
 *    reproduz o XLSX do gerador ATUAL (`gerarRelatorioEstoqueCustomizado`) nas
 *    linhas de título/meta/header/dados — fora as novas linhas TOTAIS/MÉDIA.
 *  - As linhas TOTAIS/MÉDIA aparecem no fim, com soma de dinheiro e média de km.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { COLUNAS_ESTOQUE, getColuna } from "@/lib/export/colunas-estoque";
import { construirDefEstoque, gerarRelatorioEstoque } from "@/lib/export/relatorio/estoque";
import { gerarRelatorioEstoqueCustomizado } from "@/lib/export/relatorio-estoque-customizado";
import type { ColunaKey } from "@/lib/export/colunas-estoque";
import { veiculo } from "./_mocks";

async function abrir(blob: Blob): Promise<ExcelJS.Worksheet> {
  const ab = await blob.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(ab);
  return wb.worksheets[0]!;
}

// ─── Catálogo com agregacao (puro) ───────────────────────────────────────────

describe("colunas-estoque — metadado agregacao", () => {
  it("todas as colunas têm agregacao válida", () => {
    const validas = new Set(["soma", "media", "nenhuma"]);
    for (const c of COLUNAS_ESTOQUE) {
      assert.ok(validas.has(c.agregacao), `agregacao inválida em ${c.key}: ${c.agregacao}`);
    }
  });

  it("dinheiro somável é 'soma'", () => {
    for (const k of ["valor_aquisicao", "custo_total", "preco_venda", "margem"] as ColunaKey[]) {
      assert.equal(getColuna(k)!.agregacao, "soma", `${k} deveria somar`);
    }
  });

  it("km e dias_patio são 'media'", () => {
    assert.equal(getColuna("km")!.agregacao, "media");
    assert.equal(getColuna("dias_patio")!.agregacao, "media");
  });

  it("texto/placa/ano são 'nenhuma'", () => {
    for (const k of ["placa", "modelo", "ano", "ano_fabricacao", "descricao_situacao"] as ColunaKey[]) {
      assert.equal(getColuna(k)!.agregacao, "nenhuma", `${k} não deveria agregar`);
    }
  });
});

// ─── Não-regressão vs gerador atual ──────────────────────────────────────────

const VEICULOS = [
  veiculo({ placa: "AAA1A11", modelo: "RANGER XLT", chassi: "9BFCHASSI0000001", ano_fabricacao: 2021, km: 84000, preco_venda: 145000.5, valor_aquisicao: 120000.25 }),
  veiculo({ placa: "BBB2B22", modelo: "HILUX", chassi: "9BFCHASSI0000002", ano_fabricacao: 2022, km: null, preco_venda: null, valor_aquisicao: 90000.1 }),
  veiculo({ placa: "CCC3C33", modelo: "S10", chassi: "9BFCHASSI0000003", ano_fabricacao: null, km: 30000, preco_venda: 130000, valor_aquisicao: 100000 }),
];

// Inclui colunas de largura customizada (modelo 48, chassi 30, placa 15,
// descricao_situacao 22) e uma de formato `ano` (ano_fabricacao) pra cobrir
// tanto a largura por key quanto o formato `ano`.
const COLS: ColunaKey[] = [
  "placa",
  "modelo",
  "chassi",
  "descricao_situacao",
  "ano_fabricacao",
  "km",
  "valor_aquisicao",
  "preco_venda",
  "margem",
];

describe("não-regressão: novo motor reproduz o export atual (fora TOTAIS/MÉDIA)", () => {
  it("título, meta, header, dados e LARGURAS batem célula a célula com o gerador atual", async () => {
    // Observações + Anotações (2 colunas em branco no fim).
    const opcoes = {
      colunas: COLS,
      incluirObservacoes: true,
      incluirAnotacoes: true,
      filtroLoja: "MATRIZ",
    };
    const atual = await abrir(await gerarRelatorioEstoqueCustomizado(VEICULOS, opcoes));
    const novo = await abrir(await gerarRelatorioEstoque(construirDefEstoque(opcoes), VEICULOS));

    // Título (A1) e meta (A2).
    assert.equal(String(novo.getCell("A1").value), String(atual.getCell("A1").value));
    assert.equal(String(novo.getCell("A2").value), String(atual.getCell("A2").value));

    const nCols = COLS.length + 2; // + Observações + Anotações

    // Larguras de coluna idênticas (o ponto cego que deixou passar a regressão).
    for (let c = 1; c <= nCols; c++) {
      assert.equal(
        novo.getColumn(c).width,
        atual.getColumn(c).width,
        `largura col ${c} (${String(atual.getRow(3).getCell(c).value ?? "")})`,
      );
    }

    // Header (linha 3) idêntico.
    for (let c = 1; c <= nCols; c++) {
      assert.equal(
        String(novo.getRow(3).getCell(c).value ?? ""),
        String(atual.getRow(3).getCell(c).value ?? ""),
        `header col ${c}`,
      );
    }
    // Dados (linhas 4..6) idênticos, incluindo "—" pra nulos e numFmt.
    for (let r = 4; r <= 3 + VEICULOS.length; r++) {
      for (let c = 1; c <= nCols; c++) {
        assert.equal(
          String(novo.getRow(r).getCell(c).value ?? ""),
          String(atual.getRow(r).getCell(c).value ?? ""),
          `dado r${r} c${c}`,
        );
        assert.equal(
          String(novo.getRow(r).getCell(c).numFmt ?? ""),
          String(atual.getRow(r).getCell(c).numFmt ?? ""),
          `numFmt r${r} c${c}`,
        );
      }
    }
  });
});

// ─── Novas linhas TOTAIS/MÉDIA no XLSX ───────────────────────────────────────

describe("XLSX: linhas TOTAIS/MÉDIA acrescentadas no fim", () => {
  // Conjunto local com ordem canônica estável: 1=placa 2=modelo 3=km
  // 4=valor_aquisicao 5=preco_venda 6=margem.
  const COLS_AGG: ColunaKey[] = ["placa", "modelo", "km", "valor_aquisicao", "preco_venda", "margem"];

  it("TOTAIS soma dinheiro (cru) e MÉDIA calcula km, ambas após os dados", async () => {
    const ws = await abrir(
      await gerarRelatorioEstoque(
        construirDefEstoque({ colunas: COLS_AGG, incluirObservacoes: false }),
        VEICULOS,
      ),
    );
    const totRow = 3 + VEICULOS.length + 1; // linha 7
    const medRow = totRow + 1; // linha 8

    // Rótulo na 1ª coluna (placa, 'nenhuma').
    assert.equal(ws.getRow(totRow).getCell(1).value, "TOTAIS");
    assert.equal(ws.getRow(medRow).getCell(1).value, "MÉDIA");

    // Colunas: 1=placa 2=modelo 3=km 4=valor_aquisicao 5=preco_venda 6=margem
    // valor_aquisicao (col 4) = 120000.25 + 90000.10 + 100000 = 310000.35 (cru).
    assert.equal(ws.getRow(totRow).getCell(4).value, 310000.35);
    // preco_venda (col 5) soma ignorando null = 145000.50 + 130000 = 275000.50.
    assert.equal(ws.getRow(totRow).getCell(5).value, 275000.5);
    // km (col 3) é 'media' → BRANCO no TOTAIS.
    assert.equal(ws.getRow(totRow).getCell(3).value ?? "", "");

    // MÉDIA km (col 3) = (84000 + 30000)/2 = 57000 (ignora o null).
    assert.equal(ws.getRow(medRow).getCell(3).value, 57000);
    // valor_aquisicao (col 4) é 'soma' → BRANCO na MÉDIA.
    assert.equal(ws.getRow(medRow).getCell(4).value ?? "", "");
  });

  it("dinheiro somado mantém centavos crus (numFmt arredonda só na exibição)", async () => {
    const ws = await abrir(
      await gerarRelatorioEstoque(
        construirDefEstoque({ colunas: ["placa", "valor_aquisicao"], incluirObservacoes: false }),
        [
          veiculo({ placa: "A", valor_aquisicao: 100.25 }),
          veiculo({ placa: "B", valor_aquisicao: 100.25 }),
          veiculo({ placa: "C", valor_aquisicao: 100.25 }),
        ],
      ),
    );
    const totRow = 3 + 3 + 1;
    // Valor gravado é 300.75 (cru); o numFmt "R$ #,##0" só arredonda na exibição.
    assert.equal(ws.getRow(totRow).getCell(2).value, 300.75);
    assert.match(String(ws.getRow(totRow).getCell(2).numFmt ?? ""), /R\$/);
  });

  it("lista vazia não gera TOTAIS/MÉDIA nem quebra", async () => {
    const ws = await abrir(
      await gerarRelatorioEstoque(
        construirDefEstoque({ colunas: COLS, incluirObservacoes: false }),
        [],
      ),
    );
    assert.equal(ws.getCell("A3").value, "Placa");
    assert.equal(ws.getCell("A4").value ?? "", ""); // sem dados, sem totais
  });

  it("colunas em branco (Observações) não recebem agregação", async () => {
    const ws = await abrir(
      await gerarRelatorioEstoque(
        construirDefEstoque({ colunas: ["placa", "valor_aquisicao"], incluirObservacoes: true }),
        VEICULOS,
      ),
    );
    const totRow = 3 + VEICULOS.length + 1;
    // col 3 = Observações (branco) → vazia na linha de TOTAIS.
    assert.equal(ws.getRow(totRow).getCell(3).value ?? "", "");
  });
});
