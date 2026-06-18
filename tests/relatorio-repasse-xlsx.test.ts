/**
 * Testes do XLSX profissional de carros pra repasse.
 *
 * Após Sprint Caminho B: cells dos campos manuais vêm pré-preenchidas a partir
 * do que Marcos colocou inline no /repasses. Cells vazias mantêm dropdown
 * (fallback caso queira preencher no Excel). Nova coluna "Valor pra subir"
 * entre Custo e IPVA — total 18 colunas (era 17).
 *
 * Layout: 1 aba "Carros pra Repasse" com:
 *   - Cabeçalho de 3 linhas (título + data + totais)
 *   - Header da tabela na linha 5
 *   - Dados a partir da linha 6 (snapshot + campos manuais)
 *   - Cells preenchidas: sem dataValidation, com cor de fundo de status
 *   - Cells vazias: com dataValidation apontando pra `_Listas`
 *   - AutoFilter + frozen 5 linhas
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

  it("header da tabela está na linha 5 com 24 colunas (5 novas de comparação Auto Avaliar)", async () => {
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse()]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    assert.equal(ws.getCell("A5").value, "#");
    assert.equal(ws.getCell("B5").value, "Placa");
    assert.equal(ws.getCell("C5").value, "Chassi");
    assert.equal(ws.getCell("M5").value, "Preço atual");
    assert.equal(ws.getCell("N5").value, "Custo");
    assert.equal(ws.getCell("O5").value, "Valor Auto Avaliar");
    assert.equal(ws.getCell("P5").value, "Dif. vs Custo (R$)");
    assert.equal(ws.getCell("Q5").value, "Dif. vs Custo (%)");
    assert.equal(ws.getCell("R5").value, "Dif. vs Preço (R$)");
    assert.equal(ws.getCell("S5").value, "Dif. vs Preço (%)");
    assert.equal(ws.getCell("T5").value, "Valor pra subir");
    assert.equal(ws.getCell("U5").value, "IPVA");
    assert.equal(ws.getCell("V5").value, "Doc");
    assert.equal(ws.getCell("W5").value, "Cautelar");
    assert.equal(ws.getCell("X5").value, "Observação");
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

  it("repasse SEM campos manuais: IPVA/Doc/Cautelar/Obs/Valor pra subir ficam VAZIOS", async () => {
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse()]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    assert.equal(ws.getCell("T6").value ?? "", ""); // Valor pra subir
    assert.equal(ws.getCell("U6").value ?? "", ""); // IPVA
    assert.equal(ws.getCell("V6").value ?? "", ""); // Doc
    assert.equal(ws.getCell("W6").value ?? "", ""); // Cautelar
    assert.equal(ws.getCell("X6").value ?? "", ""); // Observação
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
    assert.equal(ws.getCell("T6").value, 138500); // Valor pra subir (numérico)
    assert.equal(ws.getCell("U6").value, "Pago");
    assert.equal(ws.getCell("V6").value, "OK");
    assert.equal(ws.getCell("W6").value, "Limpa");
    assert.equal(ws.getCell("X6").value, "Pneu dianteiro pra trocar");
  });

  it("cell preenchida NÃO tem dataValidation (já tem dado)", async () => {
    const buf = await gerarRelatorioRepasseProfissional([
      buildRepasse({ ipva_status: "pago" }),
    ]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    const cell = ws.getCell("U6"); // IPVA preenchido
    assert.equal(cell.dataValidation, undefined, "IPVA preenchido não deve ter dropdown");
  });

  it("cell vazia mantém dataValidation pra `_Listas` (fallback Excel)", async () => {
    // Inline values com vírgula quebra em Excel locale BR (separador ";").
    // Solução: planilha auxiliar oculta com valores + range absoluto.
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse()]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    const cell = ws.getCell("U6"); // IPVA vazio
    assert.ok(cell.dataValidation, "IPVA vazio deveria ter dataValidation");
    assert.equal(cell.dataValidation!.type, "list");
    const formula = String((cell.dataValidation!.formulae ?? [])[0] ?? "");
    assert.match(formula, /^_Listas!\$A\$1:\$A\$3$/, `esperado range _Listas, recebido: ${formula}`);
  });

  it("Doc vazio aponta pra range B (4 valores); Cautelar vazia pra C (3 valores)", async () => {
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse()]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    const doc = ws.getCell("V6");
    assert.ok(doc.dataValidation);
    const fDoc = String((doc.dataValidation!.formulae ?? [])[0] ?? "");
    assert.match(fDoc, /^_Listas!\$B\$1:\$B\$4$/, `Doc: ${fDoc}`);

    const caut = ws.getCell("W6");
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

  it("Valor pra subir preenchido vem com formato R$ BR", async () => {
    const buf = await gerarRelatorioRepasseProfissional([
      buildRepasse({ valor_subir: 138_500 }),
    ]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    const vs = ws.getCell("T6");
    assert.equal(vs.value, 138500);
    assert.match(String(vs.numFmt ?? ""), /R\$/, "Valor pra subir preenchido precisa ter numFmt R$");
  });

  it("Dias parado usa dias_patio REAL do estoque (via map por chassi)", async () => {
    // Coluna L = "Dias parado". Agora reflete o dias_patio atual do estoque
    // (quanto tempo o carro está parado no pátio), igual à tela /repasses —
    // NÃO dias desde data_marcado.
    const r = buildRepasse({ chassi: "9BWZZZ377VT004251" });
    const map = new Map<string, number | null>([["9BWZZZ377VT004251", 217]]);
    const buf = await gerarRelatorioRepasseProfissional([r], map);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    assert.equal(ws.getCell("L6").value, 217);
  });

  it("Dias parado: chassi sem entrada no map → célula vazia (não quebra)", async () => {
    const r = buildRepasse({ chassi: "9BWZZZ377VT004251" });
    const map = new Map<string, number | null>([["OUTRO_CHASSI", 99]]);
    const buf = await gerarRelatorioRepasseProfissional([r], map);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    assert.equal(ws.getCell("L6").value ?? "", "");
  });

  it("Dias parado: sem map (param undefined) → célula vazia (não quebra)", async () => {
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse()]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    assert.equal(ws.getCell("L6").value ?? "", "");
  });

  // ─── Colunas de comparação NBS vs Auto Avaliar (5 novas) ───────────────────

  it("header tem as 5 colunas novas na ordem certa (O→S)", async () => {
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse()]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    assert.equal(ws.getCell("O5").value, "Valor Auto Avaliar");
    assert.equal(ws.getCell("P5").value, "Dif. vs Custo (R$)");
    assert.equal(ws.getCell("Q5").value, "Dif. vs Custo (%)");
    assert.equal(ws.getCell("R5").value, "Dif. vs Preço (R$)");
    assert.equal(ws.getCell("S5").value, "Dif. vs Preço (%)");
  });

  it("'Valor Auto Avaliar' vem VAZIA (manual) com formato R$", async () => {
    const buf = await gerarRelatorioRepasseProfissional([
      buildRepasse({ valor_aquisicao: 120_000, preco_atual: 145_000 }),
    ]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    const aa = ws.getCell("O6");
    assert.equal(aa.value ?? "", "", "Valor Auto Avaliar não pode vir pré-preenchido");
    assert.match(String(aa.numFmt ?? ""), /R\$/, "Valor Auto Avaliar precisa ter numFmt R$");
    assert.equal(aa.dataValidation, undefined, "não deve ter dropdown");
  });

  it("as 4 células de diferença contêm FÓRMULA (objeto .formula), não valor fixo", async () => {
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse()]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    for (const ref of ["P6", "Q6", "R6", "S6"]) {
      const cell = ws.getCell(ref);
      const val = cell.value as { formula?: string } | null;
      assert.ok(
        val && typeof val === "object" && typeof val.formula === "string",
        `${ref} deveria conter uma fórmula, recebido: ${JSON.stringify(cell.value)}`,
      );
    }
  });

  it("Dif. vs Custo (R$) referencia Valor Auto Avaliar (O) e Custo (N) com proteção de vazio", async () => {
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse()]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    const f = (ws.getCell("P6").value as { formula: string }).formula;
    // Referencia AA (O6) e Custo (N6), trata vazio (IF(...="",""))
    assert.match(f, /\$O6/, `fórmula deve referenciar Valor Auto Avaliar (O6): ${f}`);
    assert.match(f, /\$N6/, `fórmula deve referenciar Custo (N6): ${f}`);
    assert.match(f, /=""/, `fórmula deve tratar Valor Auto Avaliar vazio: ${f}`);
    assert.equal(f, 'IF($O6="","",$O6-$N6)');
  });

  it("Dif. vs Custo (%) referencia Custo + tem proteção contra divisão por zero", async () => {
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse()]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    const f = (ws.getCell("Q6").value as { formula: string }).formula;
    assert.match(f, /\$O6/, `% deve referenciar Valor Auto Avaliar (O6): ${f}`);
    assert.match(f, /\$N6/, `% deve referenciar Custo (N6): ${f}`);
    assert.match(f, /OR\(/, `% deve usar OR(...) pra proteção: ${f}`);
    assert.match(f, /\$N6=0/, `% deve proteger divisão por zero (Custo=0): ${f}`);
    assert.match(f, /\*100/, `% deve multiplicar por 100: ${f}`);
    assert.equal(f, 'IF(OR($O6="",$N6="",$N6=0),"",($O6-$N6)/$N6*100)');
  });

  it("Dif. vs Preço referencia Preço atual (M); R$ e % com proteções", async () => {
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse()]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    const fRs = (ws.getCell("R6").value as { formula: string }).formula;
    const fPct = (ws.getCell("S6").value as { formula: string }).formula;
    assert.equal(fRs, 'IF($O6="","",$O6-$M6)');
    assert.equal(fPct, 'IF(OR($O6="",$M6="",$M6=0),"",($O6-$M6)/$M6*100)');
  });

  it("fórmulas apontam pra linha certa em múltiplas linhas (offset do header)", async () => {
    const buf = await gerarRelatorioRepasseProfissional([
      buildRepasse({ id: 1, placa: "AAA1A11" }),
      buildRepasse({ id: 2, placa: "BBB2B22" }),
      buildRepasse({ id: 3, placa: "CCC3C33" }),
    ]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    // Linha 6 = primeiro carro, linha 8 = terceiro
    assert.equal((ws.getCell("P6").value as { formula: string }).formula, 'IF($O6="","",$O6-$N6)');
    assert.equal((ws.getCell("P8").value as { formula: string }).formula, 'IF($O8="","",$O8-$N8)');
    assert.equal(
      (ws.getCell("S8").value as { formula: string }).formula,
      'IF(OR($O8="",$M8="",$M8=0),"",($O8-$M8)/$M8*100)',
    );
  });

  it("colunas % têm numFmt percentual com sinal", async () => {
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse()]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    assert.match(String(ws.getCell("Q6").numFmt ?? ""), /%/, "Dif vs Custo % precisa de numFmt %");
    assert.match(String(ws.getCell("S6").numFmt ?? ""), /%/, "Dif vs Preço % precisa de numFmt %");
    assert.match(String(ws.getCell("P6").numFmt ?? ""), /R\$/, "Dif vs Custo R$ precisa de numFmt R$");
    assert.match(String(ws.getCell("R6").numFmt ?? ""), /R\$/, "Dif vs Preço R$ precisa de numFmt R$");
  });

  it("legenda na linha 4 explica a convenção da diferença", async () => {
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse()]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    const legenda = String(ws.getCell("A4").value ?? "");
    assert.match(legenda, /Auto Avaliar/);
    assert.match(legenda, /Positivo/i);
    assert.match(legenda, /ABAIXO|ACIMA/);
  });

  it("AutoFilter cobre todas as 24 colunas (inclui as novas; X=col 24)", async () => {
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse()]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    // Na releitura o exceljs serializa o autoFilter como string "A5:X5".
    const af = String(ws.autoFilter ?? "");
    assert.match(af, /A5/, `autoFilter deve começar em A5: ${af}`);
    assert.match(af, /X5/, `autoFilter deve ir até X5 (24 colunas): ${af}`);
  });
});
