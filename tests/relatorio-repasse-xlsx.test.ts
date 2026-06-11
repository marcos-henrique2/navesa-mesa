/**
 * Testes da geração de relatório XLSX por repasse.
 *
 * Verifica:
 *   - As 4 abas existem (Resumo, Gastos, Documentação, Cálculos)
 *   - B17 da Resumo tem fórmula SUM dinâmica apontando pra aba Gastos (não valor fixo)
 *   - B18 = B14 + B17 (custo total)
 *   - B20 condicional com IF
 *   - B21 (margem %) protege contra divisão por zero (valor_vendido = 0)
 *   - Aba Gastos lista os gastos passados + linha total com SUM dinâmica
 *   - Rodapé TOTAL em row 5 mesmo quando gastos = [] (sem erro de fórmula)
 *   - Aba Cálculos referencia Resumo!B14/B15/B16/B18
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { gerarRelatorioRepasseXlsx } from "@/lib/export/relatorio-repasse-xlsx";
import type { Repasse, RepasseGasto, RepasseDocumento } from "@/lib/repasses/types";

function buildRepasse(): Repasse {
  return {
    id: 42,
    chassi: "9BWZZZ377VT004251",
    placa: "ABC1D23",
    modelo: "RANGER XLT 3.2",
    marca: "Ford",
    cor: "Branco",
    ano_modelo: 2022,
    ano_fabricacao: 2021,
    km: 85000,
    loja_origem: 2,
    patio_origem: "AEROPORTO",
    valor_aquisicao: 120000,
    valor_subiu: 145000,
    valor_minimo: 138000,
    valor_vendido: null,
    data_subiu: "2026-05-01",
    data_vendido: null,
    canal: "auto_avaliar",
    status: "subido",
    documentacao_status: "pendente",
    descricao: null,
    opcionais: null,
    comprador: null,
    observacoes: null,
    criado_em: "2026-05-01T12:00:00Z",
    atualizado_em: "2026-05-01T12:00:00Z",
  };
}

function buildGastos(): RepasseGasto[] {
  return [
    {
      id: 1,
      repasse_id: 42,
      tipo: "documentacao",
      descricao: "Transferência",
      valor: 350,
      data: "2026-05-02",
      observacao: null,
      criado_em: "",
    },
    {
      id: 2,
      repasse_id: 42,
      tipo: "vistoria",
      descricao: "Vistoria DETRAN",
      valor: 180,
      data: "2026-05-03",
      observacao: null,
      criado_em: "",
    },
  ];
}

function buildDocs(): RepasseDocumento[] {
  return [
    {
      id: 1,
      repasse_id: 42,
      tipo: "crv",
      status: "ok",
      observacao: null,
      data_verificacao: "2026-05-02",
      criado_em: "",
      atualizado_em: "",
    },
    {
      id: 2,
      repasse_id: 42,
      tipo: "ipva",
      status: "pendente",
      observacao: "aguardando 2ª parcela",
      data_verificacao: null,
      criado_em: "",
      atualizado_em: "",
    },
  ];
}

async function abrir(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  // exceljs.load aceita ArrayBuffer | Buffer (typing legado); cast pra evitar
  // mismatch entre Buffer<ArrayBufferLike> do Node 22 e o ArrayBuffer esperado.
  const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  await wb.xlsx.load(ab as ArrayBuffer);
  return wb;
}

describe("gerarRelatorioRepasseXlsx", () => {
  it("retorna um Buffer não vazio", async () => {
    const buf = await gerarRelatorioRepasseXlsx(buildRepasse(), buildGastos(), buildDocs());
    assert.ok(Buffer.isBuffer(buf));
    assert.ok(buf.length > 1000);
  });

  it("contém as 4 abas: Resumo, Gastos, Documentação, Cálculos", async () => {
    const buf = await gerarRelatorioRepasseXlsx(buildRepasse(), buildGastos(), buildDocs());
    const wb = await abrir(buf);
    const nomes = wb.worksheets.map((w) => w.name);
    assert.deepEqual(nomes, ["Resumo", "Gastos", "Documentação", "Cálculos"]);
  });

  it("Resumo!B17 tem fórmula SUM dinâmica apontando pra Gastos — não valor fixo", async () => {
    const buf = await gerarRelatorioRepasseXlsx(buildRepasse(), buildGastos(), buildDocs());
    const wb = await abrir(buf);
    const ws = wb.getWorksheet("Resumo");
    assert.ok(ws);
    const cell = ws.getCell("B17");
    // exceljs serializa fórmulas como { formula: "..." }
    const value = cell.value as { formula?: string } | unknown;
    assert.ok(
      value && typeof value === "object" && "formula" in value,
      "B17 deveria ser uma célula de fórmula",
    );
    // Range dinâmico: com 2 gastos vira D2:D3 (linhas 2..gastos.length+1)
    assert.match((value as { formula: string }).formula, /SUM\(Gastos!D2:D3\)/);
  });

  it("Resumo!B18 = B14 + B17 (custo total via fórmula)", async () => {
    const buf = await gerarRelatorioRepasseXlsx(buildRepasse(), buildGastos(), buildDocs());
    const wb = await abrir(buf);
    const ws = wb.getWorksheet("Resumo")!;
    const cell = ws.getCell("B18");
    const value = cell.value as { formula?: string };
    assert.ok(value.formula);
    assert.match(value.formula, /B14\s*\+\s*B17/);
  });

  it("Resumo!B20 (margem real) é condicional via IF", async () => {
    const buf = await gerarRelatorioRepasseXlsx(buildRepasse(), buildGastos(), buildDocs());
    const wb = await abrir(buf);
    const ws = wb.getWorksheet("Resumo")!;
    const cell = ws.getCell("B20");
    const value = cell.value as { formula?: string };
    assert.ok(value.formula);
    assert.match(value.formula, /^IF\(B19=/);
  });

  it("aba Gastos contém uma linha por gasto + linha TOTAL com SUM dinâmico", async () => {
    const buf = await gerarRelatorioRepasseXlsx(buildRepasse(), buildGastos(), buildDocs());
    const wb = await abrir(buf);
    const ws = wb.getWorksheet("Gastos")!;
    // Header em row 1, gastos em rows 2 e 3
    assert.equal(ws.getCell("C2").value, "Transferência");
    assert.equal(ws.getCell("D2").value, 350);
    assert.equal(ws.getCell("C3").value, "Vistoria DETRAN");

    // Total — procura por uma célula com fórmula SUM em col D.
    // Range dinâmico: 2 gastos → D2:D3 (não engloba a row TOTAL).
    let achouTotal = false;
    ws.eachRow((row) => {
      const v = row.getCell(4).value as { formula?: string } | unknown;
      if (v && typeof v === "object" && "formula" in v && /SUM\(D2:D3\)/.test((v as { formula: string }).formula)) {
        achouTotal = true;
      }
    });
    assert.ok(achouTotal, "deveria haver linha TOTAL com SUM(D2:D3) na aba Gastos");
  });

  it("aba Cálculos referencia Resumo (breakeven, margens, ROI)", async () => {
    const buf = await gerarRelatorioRepasseXlsx(buildRepasse(), buildGastos(), buildDocs());
    const wb = await abrir(buf);
    const ws = wb.getWorksheet("Cálculos")!;

    const b3 = ws.getCell("B3").value as { formula?: string };
    assert.match(b3.formula ?? "", /Resumo!B18/);

    const b4 = ws.getCell("B4").value as { formula?: string };
    assert.match(b4.formula ?? "", /Resumo!B15-Resumo!B18/);

    const b5 = ws.getCell("B5").value as { formula?: string };
    assert.match(b5.formula ?? "", /Resumo!B16-Resumo!B18/);

    const b7 = ws.getCell("B7").value as { formula?: string };
    assert.match(b7.formula ?? "", /Resumo!B15\s*\*\s*0\.05/);
  });

  it("gastos vazios: rodapé TOTAL na linha 5 com SUM(D2:D2) — sem erro de fórmula", async () => {
    // Regressão F1: range hardcoded SUM(D2:D100) englobaria a row TOTAL quando
    // gastos = []. Agora com range dinâmico, garantimos que dataEnd < totalRow
    // (2 < 5) mesmo no caso vazio.
    const buf = await gerarRelatorioRepasseXlsx(buildRepasse(), [], buildDocs());
    const wb = await abrir(buf);
    const ws = wb.getWorksheet("Gastos")!;

    // TOTAL deve aparecer em row 5 (gastos.length + 3 = 3, clampado pra 5)
    assert.equal(ws.getCell("C5").value, "TOTAL");
    const total = ws.getCell("D5").value as { formula?: string };
    assert.ok(total.formula, "D5 deveria ter fórmula SUM");
    assert.match(total.formula, /SUM\(D2:D2\)/);

    // E B17 da Resumo idem: SUM(Gastos!D2:D2)
    const resumo = wb.getWorksheet("Resumo")!;
    const b17 = resumo.getCell("B17").value as { formula?: string };
    assert.match(b17.formula ?? "", /SUM\(Gastos!D2:D2\)/);
  });

  it("Resumo!B21 (margem %) protege contra divisão por zero quando valor_vendido = 0", async () => {
    // Regressão F2: fórmula original IF(B19="","",B20/B19*100) gerava #DIV/0!
    // quando o usuário digitava 0 em valor_vendido. Agora usa OR(B19="",B19=0).
    const repasse = { ...buildRepasse(), valor_vendido: 0 };
    const buf = await gerarRelatorioRepasseXlsx(repasse, buildGastos(), buildDocs());
    const wb = await abrir(buf);
    const ws = wb.getWorksheet("Resumo")!;
    const b21 = ws.getCell("B21").value as { formula?: string };
    assert.ok(b21.formula, "B21 deveria ser fórmula");
    assert.match(b21.formula, /OR\(B19="",\s*B19=0\)/);
  });

  it("aba Documentação lista cada documento com emoji + label", async () => {
    const buf = await gerarRelatorioRepasseXlsx(buildRepasse(), buildGastos(), buildDocs());
    const wb = await abrir(buf);
    const ws = wb.getWorksheet("Documentação")!;
    // row 1 = header
    assert.equal(ws.getCell("A2").value, "CRV");
    assert.match(String(ws.getCell("B2").value), /✅/);
    assert.equal(ws.getCell("A3").value, "IPVA");
    assert.match(String(ws.getCell("B3").value), /⏳/);
  });
});
