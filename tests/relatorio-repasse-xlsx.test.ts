/**
 * Testes do XLSX profissional de carros pra repasse.
 *
 * O XLSX agora é 1 aba "Carros pra Repasse" com:
 *   - Cabeçalho de 3 linhas (título + data + totais)
 *   - Header da tabela na linha 5
 *   - Dados a partir da linha 6 (snapshot do veículo)
 *   - Colunas IPVA/Doc/Cautelar vazias com data validation (dropdown)
 *   - Coluna Observação vazia + wrap text
 *   - AutoFilter no header
 *   - Frozen header (5 linhas)
 *
 * Sem fórmulas vivas — Marcos vai preencher manualmente no Excel e subir
 * pro Auto Avaliar. Quem cuida de venda/margem é o Auto Avaliar.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { gerarRelatorioRepasseProfissional } from "@/lib/export/relatorio-repasse-xlsx";
import type { Repasse } from "@/lib/repasses/types";

function buildRepasse(over: Partial<Repasse> = {}): Repasse {
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
    preco_atual: 145000,
    data_marcado: "2026-05-01",
    data_subido: null,
    canal: "auto_avaliar",
    status: "marcado",
    criado_em: "2026-05-01T12:00:00Z",
    atualizado_em: "2026-05-01T12:00:00Z",
    ...over,
  };
}

async function abrir(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  await wb.xlsx.load(ab as ArrayBuffer);
  return wb;
}

describe("gerarRelatorioRepasseProfissional", () => {
  it("retorna um Buffer não vazio", async () => {
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse()]);
    assert.ok(Buffer.isBuffer(buf));
    assert.ok(buf.length > 1000);
  });

  it("tem aba principal 'Carros pra Repasse' + aba auxiliar oculta '_Listas'", async () => {
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse()]);
    const wb = await abrir(buf);
    // 2 abas: a principal visível + _Listas oculta (workaround locale BR pra
    // data validation). _Listas fica hidden — Marcos não vê.
    assert.equal(wb.worksheets.length, 2);
    assert.equal(wb.worksheets[0]!.name, "Carros pra Repasse");
    const aux = wb.getWorksheet("_Listas");
    assert.ok(aux, "aba auxiliar _Listas deveria existir");
    assert.equal(aux!.state, "hidden");
  });

  it("cabeçalho linha 1 contém título NAVESA + linha 2 data de geração", async () => {
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse()]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    const titulo = String(ws.getCell("A1").value ?? "");
    assert.match(titulo, /NAVESA/);
    assert.match(titulo, /Repasse/i);

    const dataLinha = String(ws.getCell("A2").value ?? "");
    assert.match(dataLinha, /Gerado em:/);
  });

  it("linha 3 mostra total + capital travado (marcados)", async () => {
    const buf = await gerarRelatorioRepasseProfissional([
      buildRepasse({ id: 1, placa: "AAA1A11", preco_atual: 100_000 }),
      buildRepasse({ id: 2, placa: "BBB2B22", preco_atual: 50_000 }),
    ]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    const linha = String(ws.getCell("A3").value ?? "");
    assert.match(linha, /Total: 2 veículos/);
    assert.match(linha, /Capital travado \(marcados\)/);
    assert.match(linha, /R\$ 150/); // capital travado 150.000,00
  });

  it("Capital travado SÓ soma rows com status='marcado' (subidos não contam)", async () => {
    // Misto: 1 marcado (100k) + 1 subido (50k). Capital travado = 100k só.
    // Subidos já foram pro Auto Avaliar, não estão mais travados — mesmo
    // critério do KPI da tela /repasses.
    const buf = await gerarRelatorioRepasseProfissional([
      buildRepasse({ id: 1, placa: "AAA1A11", preco_atual: 100_000, status: "marcado" }),
      buildRepasse({
        id: 2,
        placa: "BBB2B22",
        preco_atual: 50_000,
        status: "subido",
        data_subido: "2026-05-15",
      }),
    ]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    const linha = String(ws.getCell("A3").value ?? "");
    assert.match(linha, /Total: 2 veículos/);
    assert.match(linha, /Capital travado \(marcados\): R\$ 100/, `linha: ${linha}`);
    assert.doesNotMatch(linha, /R\$ 150/, "não deveria somar o subido no capital travado");
  });

  it("header da tabela está na linha 5", async () => {
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse()]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    assert.equal(ws.getCell("A5").value, "#");
    assert.equal(ws.getCell("B5").value, "Placa");
    assert.equal(ws.getCell("C5").value, "Chassi");
    assert.equal(ws.getCell("O5").value, "IPVA");
    assert.equal(ws.getCell("P5").value, "Doc");
    assert.equal(ws.getCell("Q5").value, "Cautelar");
    assert.equal(ws.getCell("R5").value, "Observação");
  });

  it("dados começam na linha 6 com snapshot do veículo", async () => {
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse()]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    assert.equal(ws.getCell("A6").value, 1);
    assert.equal(ws.getCell("B6").value, "ABC1D23");
    assert.equal(ws.getCell("C6").value, "9BWZZZ377VT004251");
    assert.equal(ws.getCell("D6").value, "Ford");
    assert.equal(ws.getCell("E6").value, "RANGER XLT 3.2");
    assert.equal(ws.getCell("M6").value, 145000); // preço atual
    assert.equal(ws.getCell("N6").value, 120000); // custo (valor aquisição)
  });

  it("IPVA, Doc, Cautelar e Observação ficam VAZIAS no export", async () => {
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse()]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    assert.equal(ws.getCell("O6").value ?? "", "");
    assert.equal(ws.getCell("P6").value ?? "", "");
    assert.equal(ws.getCell("Q6").value ?? "", "");
    assert.equal(ws.getCell("R6").value ?? "", "");
  });

  it("IPVA tem data validation apontando pra range na aba _Listas (BR-safe)", async () => {
    // Inline values com vírgula quebra em Excel locale BR (separador ";").
    // Solução: planilha auxiliar oculta com valores + range absoluto.
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse()]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    const cell = ws.getCell("O6");
    assert.ok(cell.dataValidation, "IPVA deveria ter dataValidation");
    assert.equal(cell.dataValidation!.type, "list");
    const formula = String((cell.dataValidation!.formulae ?? [])[0] ?? "");
    assert.match(formula, /^_Listas!\$A\$1:\$A\$3$/, `esperado range _Listas, recebido: ${formula}`);
  });

  it("Doc tem data validation apontando pra range na aba _Listas", async () => {
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse()]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    const cell = ws.getCell("P6");
    assert.ok(cell.dataValidation);
    const formula = String((cell.dataValidation!.formulae ?? [])[0] ?? "");
    assert.match(formula, /^_Listas!\$B\$1:\$B\$4$/, `esperado range B, recebido: ${formula}`);
  });

  it("Cautelar tem data validation apontando pra range na aba _Listas", async () => {
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse()]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    const cell = ws.getCell("Q6");
    assert.ok(cell.dataValidation);
    const formula = String((cell.dataValidation!.formulae ?? [])[0] ?? "");
    assert.match(formula, /^_Listas!\$C\$1:\$C\$3$/, `esperado range C, recebido: ${formula}`);
  });

  it("aba _Listas existe oculta com opções IPVA/Doc/Cautelar", async () => {
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse()]);
    const wb = await abrir(buf);
    const aux = wb.getWorksheet("_Listas");
    assert.ok(aux, "aba _Listas deveria existir");
    assert.equal(aux!.state, "hidden");
    // Coluna A = IPVA (3 valores)
    assert.equal(aux!.getCell("A1").value, "Pago");
    assert.equal(aux!.getCell("A2").value, "Em aberto");
    assert.equal(aux!.getCell("A3").value, "Não verificado");
    // Coluna B = Doc (4 valores)
    assert.equal(aux!.getCell("B1").value, "OK");
    assert.equal(aux!.getCell("B2").value, "Pendente");
    assert.equal(aux!.getCell("B3").value, "Irregular");
    assert.equal(aux!.getCell("B4").value, "Não verificado");
    // Coluna C = Cautelar (3 valores)
    assert.equal(aux!.getCell("C1").value, "Limpa");
    assert.equal(aux!.getCell("C2").value, "Com restrição");
    assert.equal(aux!.getCell("C3").value, "Não verificada");
  });

  it("aplica AutoFilter no header da tabela", async () => {
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse()]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    assert.ok(ws.autoFilter, "deveria ter autoFilter configurado");
  });

  it("congela linhas do cabeçalho (primeiras 5)", async () => {
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse()]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    const view = (ws.views ?? [])[0];
    assert.ok(view);
    assert.equal(view!.state, "frozen");
    assert.equal(view!.ySplit, 5);
  });

  it("lista vazia: gera mesmo assim com cabeçalho + header, sem linhas de dados", async () => {
    const buf = await gerarRelatorioRepasseProfissional([]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    assert.equal(ws.getCell("A5").value, "#");
    // Linha 6 vazia (não tem dado nenhum)
    assert.equal(ws.getCell("A6").value ?? "", "");
    const linha3 = String(ws.getCell("A3").value ?? "");
    assert.match(linha3, /Total: 0 veículos/);
  });

  it("preço atual e custo vêm formatados como R$ (numFmt BRL)", async () => {
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse()]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    const preco = ws.getCell("M6");
    assert.match(String(preco.numFmt ?? ""), /R\$/);
    const custo = ws.getCell("N6");
    assert.match(String(custo.numFmt ?? ""), /R\$/);
  });

  it("conta dias parado desde data_marcado", async () => {
    // Carro marcado há ~30 dias
    const trintaDiasAtras = new Date();
    trintaDiasAtras.setDate(trintaDiasAtras.getDate() - 30);
    const yyyy = trintaDiasAtras.getFullYear();
    const mm = String(trintaDiasAtras.getMonth() + 1).padStart(2, "0");
    const dd = String(trintaDiasAtras.getDate()).padStart(2, "0");
    const buf = await gerarRelatorioRepasseProfissional([
      buildRepasse({ data_marcado: `${yyyy}-${mm}-${dd}` }),
    ]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    const dias = Number(ws.getCell("L6").value);
    assert.ok(dias >= 29 && dias <= 31, `esperado ~30, recebido ${dias}`);
  });
});
