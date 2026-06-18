/**
 * Testes do XLSX profissional de carros pra repasse.
 *
 * Após Sprint Caminho B: cells dos campos manuais vêm pré-preenchidas a partir
 * do que Marcos colocou inline no /repasses. Cells vazias mantêm dropdown
 * (fallback caso queira preencher no Excel).
 *
 * As colunas de comparação "Valor Auto Avaliar" + 4 diferenças foram removidas:
 * o "Custo" do NBS JÁ É o valor de referência do Auto Avaliar, então eram
 * redundantes. Depois adicionou-se a coluna "Reservado" (logo após Placa).
 * Total agora: 20 colunas.
 *
 * Layout: 1 aba "Carros pra Repasse" com:
 *   - Cabeçalho de 3 linhas (título + data + totais)
 *   - Header da tabela na linha 4
 *   - Dados a partir da linha 5 (snapshot + campos manuais)
 *   - Cells preenchidas: sem dataValidation, com cor de fundo de status
 *   - Cells vazias: com dataValidation apontando pra `_Listas`
 *   - AutoFilter + frozen 4 linhas
 *
 * Quem cuida de venda/margem é o Auto Avaliar.
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
    ipva_status: null,
    documentacao_status: null,
    cautelar_status_manual: null,
    valor_subir: null,
    observacoes: null,
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

  it("header da tabela está na linha 4 com 20 colunas", async () => {
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse()]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    assert.equal(ws.getCell("A4").value, "#");
    assert.equal(ws.getCell("B4").value, "Placa");
    assert.equal(ws.getCell("C4").value, "Reservado");
    assert.equal(ws.getCell("D4").value, "Chassi");
    assert.equal(ws.getCell("N4").value, "Preço atual");
    assert.equal(ws.getCell("O4").value, "Custo");
    assert.equal(ws.getCell("P4").value, "Valor pra subir");
    assert.equal(ws.getCell("Q4").value, "IPVA");
    assert.equal(ws.getCell("R4").value, "Doc");
    assert.equal(ws.getCell("S4").value, "Cautelar");
    assert.equal(ws.getCell("T4").value, "Observação");
    // 20ª coluna (T) é a última — U deve estar vazia no header.
    assert.equal(ws.getCell("U4").value ?? "", "");
  });

  it("dados começam na linha 5 com snapshot do veículo", async () => {
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse()]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    assert.equal(ws.getCell("A5").value, 1);
    assert.equal(ws.getCell("B5").value, "ABC1D23");
    assert.equal(ws.getCell("D5").value, "9BWZZZ377VT004251");
    assert.equal(ws.getCell("E5").value, "Ford");
    assert.equal(ws.getCell("F5").value, "RANGER XLT 3.2");
    assert.equal(ws.getCell("N5").value, 145000); // preço atual
    assert.equal(ws.getCell("O5").value, 120000); // custo (valor aquisição)
  });

  it("repasse SEM campos manuais: Valor pra subir/IPVA/Doc/Cautelar/Obs ficam VAZIOS", async () => {
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse()]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    assert.equal(ws.getCell("P5").value ?? "", ""); // Valor pra subir
    assert.equal(ws.getCell("Q5").value ?? "", ""); // IPVA
    assert.equal(ws.getCell("R5").value ?? "", ""); // Doc
    assert.equal(ws.getCell("S5").value ?? "", ""); // Cautelar
    assert.equal(ws.getCell("T5").value ?? "", ""); // Observação
  });

  it("repasse COM campos manuais preenchidos: cells vêm com os labels pt-BR", async () => {
    const buf = await gerarRelatorioRepasseProfissional([
      buildRepasse({
        ipva_status: "pago",
        documentacao_status: "ok",
        cautelar_status_manual: "limpa",
        valor_subir: 138_500,
        observacoes: "Pneu dianteiro pra trocar",
      }),
    ]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    assert.equal(ws.getCell("P5").value, 138500); // Valor pra subir (numérico)
    assert.equal(ws.getCell("Q5").value, "Pago");
    assert.equal(ws.getCell("R5").value, "OK");
    assert.equal(ws.getCell("S5").value, "Limpa");
    assert.equal(ws.getCell("T5").value, "Pneu dianteiro pra trocar");
  });

  it("cell preenchida NÃO tem dataValidation (já tem dado)", async () => {
    const buf = await gerarRelatorioRepasseProfissional([
      buildRepasse({ ipva_status: "pago" }),
    ]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    const cell = ws.getCell("Q5"); // IPVA preenchido
    assert.equal(cell.dataValidation, undefined, "IPVA preenchido não deve ter dropdown");
  });

  it("cell vazia mantém dataValidation pra `_Listas` (fallback Excel)", async () => {
    // Inline values com vírgula quebra em Excel locale BR (separador ";").
    // Solução: planilha auxiliar oculta com valores + range absoluto.
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse()]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    const cell = ws.getCell("Q5"); // IPVA vazio
    assert.ok(cell.dataValidation, "IPVA vazio deveria ter dataValidation");
    assert.equal(cell.dataValidation!.type, "list");
    const formula = String((cell.dataValidation!.formulae ?? [])[0] ?? "");
    assert.match(formula, /^_Listas!\$A\$1:\$A\$3$/, `esperado range _Listas, recebido: ${formula}`);
  });

  it("Doc vazio aponta pra range B (4 valores); Cautelar vazia pra C (3 valores)", async () => {
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse()]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    const doc = ws.getCell("R5");
    assert.ok(doc.dataValidation);
    const fDoc = String((doc.dataValidation!.formulae ?? [])[0] ?? "");
    assert.match(fDoc, /^_Listas!\$B\$1:\$B\$4$/, `Doc: ${fDoc}`);

    const caut = ws.getCell("S5");
    assert.ok(caut.dataValidation);
    const fCaut = String((caut.dataValidation!.formulae ?? [])[0] ?? "");
    assert.match(fCaut, /^_Listas!\$C\$1:\$C\$3$/, `Cautelar: ${fCaut}`);
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

  it("congela linhas do cabeçalho (primeiras 4)", async () => {
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse()]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    const view = (ws.views ?? [])[0];
    assert.ok(view);
    assert.equal(view!.state, "frozen");
    assert.equal(view!.ySplit, 4);
  });

  it("lista vazia: gera mesmo assim com cabeçalho + header, sem linhas de dados", async () => {
    const buf = await gerarRelatorioRepasseProfissional([]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    assert.equal(ws.getCell("A4").value, "#");
    // Linha 5 vazia (não tem dado nenhum)
    assert.equal(ws.getCell("A5").value ?? "", "");
    const linha3 = String(ws.getCell("A3").value ?? "");
    assert.match(linha3, /Total: 0 veículos/);
  });

  it("preço atual e custo vêm formatados como R$ (numFmt BRL)", async () => {
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse()]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    const preco = ws.getCell("N5");
    assert.match(String(preco.numFmt ?? ""), /R\$/);
    const custo = ws.getCell("O5");
    assert.match(String(custo.numFmt ?? ""), /R\$/);
  });

  it("Valor pra subir preenchido vem com formato R$ BR", async () => {
    const buf = await gerarRelatorioRepasseProfissional([
      buildRepasse({ valor_subir: 138_500 }),
    ]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    const vs = ws.getCell("P5");
    assert.equal(vs.value, 138500);
    assert.match(String(vs.numFmt ?? ""), /R\$/, "Valor pra subir preenchido precisa ter numFmt R$");
  });

  it("Dias parado usa dias_patio REAL do estoque (via map por chassi)", async () => {
    // Coluna M = "Dias parado". Agora reflete o dias_patio atual do estoque
    // (quanto tempo o carro está parado no pátio), igual à tela /repasses —
    // NÃO dias desde data_marcado.
    const r = buildRepasse({ chassi: "9BWZZZ377VT004251" });
    const map = new Map<string, number | null>([["9BWZZZ377VT004251", 217]]);
    const buf = await gerarRelatorioRepasseProfissional([r], map);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    assert.equal(ws.getCell("M5").value, 217);
  });

  it("Dias parado: chassi sem entrada no map → célula vazia (não quebra)", async () => {
    const r = buildRepasse({ chassi: "9BWZZZ377VT004251" });
    const map = new Map<string, number | null>([["OUTRO_CHASSI", 99]]);
    const buf = await gerarRelatorioRepasseProfissional([r], map);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    assert.equal(ws.getCell("M5").value ?? "", "");
  });

  it("Dias parado: sem map (param undefined) → célula vazia (não quebra)", async () => {
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse()]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    assert.equal(ws.getCell("M5").value ?? "", "");
  });

  it("AutoFilter cobre todas as 20 colunas (T = col 20)", async () => {
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse()]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    // Na releitura o exceljs serializa o autoFilter como string "A4:T4".
    const af = String(ws.autoFilter ?? "");
    assert.match(af, /A4/, `autoFilter deve começar em A4: ${af}`);
    assert.match(af, /T4/, `autoFilter deve ir até T4 (20 colunas): ${af}`);
  });

  // ─── Coluna "Reservado" (aviso pra não subir no Auto Avaliar) ───────────────

  it("coluna 'Reservado' existe no header (linha 4, col C)", async () => {
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse()]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    assert.equal(ws.getCell("C4").value, "Reservado");
  });

  it("célula Reservado = 'RESERVADO' quando o chassi está no map como true", async () => {
    const r = buildRepasse({ chassi: "9BWZZZ377VT004251" });
    const reservadoMap = new Map<string, boolean>([["9BWZZZ377VT004251", true]]);
    const buf = await gerarRelatorioRepasseProfissional([r], undefined, reservadoMap);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    assert.equal(ws.getCell("C5").value, "RESERVADO");
  });

  it("célula Reservado VAZIA quando chassi no map como false", async () => {
    const r = buildRepasse({ chassi: "9BWZZZ377VT004251" });
    const reservadoMap = new Map<string, boolean>([["9BWZZZ377VT004251", false]]);
    const buf = await gerarRelatorioRepasseProfissional([r], undefined, reservadoMap);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    assert.equal(ws.getCell("C5").value ?? "", "");
  });

  it("célula Reservado VAZIA quando chassi ausente do map", async () => {
    const r = buildRepasse({ chassi: "9BWZZZ377VT004251" });
    const reservadoMap = new Map<string, boolean>([["OUTRO_CHASSI", true]]);
    const buf = await gerarRelatorioRepasseProfissional([r], undefined, reservadoMap);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    assert.equal(ws.getCell("C5").value ?? "", "");
  });

  it("param reservadoPorChassi undefined → coluna Reservado vazia (não quebra)", async () => {
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse()]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    assert.equal(ws.getCell("C5").value ?? "", "");
  });

  it("célula RESERVADO vem com destaque forte (fonte negrito + fundo vermelho)", async () => {
    const r = buildRepasse({ chassi: "9BWZZZ377VT004251" });
    const reservadoMap = new Map<string, boolean>([["9BWZZZ377VT004251", true]]);
    const buf = await gerarRelatorioRepasseProfissional([r], undefined, reservadoMap);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    const cell = ws.getCell("C5");
    assert.equal(cell.font?.bold, true, "RESERVADO deve estar em negrito");
    const fill = cell.fill as ExcelJS.FillPattern | undefined;
    assert.equal(fill?.pattern, "solid", "RESERVADO deve ter fundo sólido");
    assert.match(
      String(fill?.fgColor?.argb ?? ""),
      /DC2626/i,
      "fundo da célula RESERVADO deve ser vermelho (red-600)",
    );
  });
});
