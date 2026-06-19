/**
 * Testes do XLSX profissional de carros pra repasse.
 *
 * Após Sprint Caminho B: cells dos campos manuais vêm pré-preenchidas a partir
 * do que Marcos colocou inline no /repasses. Cells vazias mantêm dropdown
 * (fallback caso queira preencher no Excel).
 *
 * As colunas de comparação "Valor Auto Avaliar" + 4 diferenças foram removidas:
 * o "Custo" do NBS JÁ É o valor de referência do Auto Avaliar, então eram
 * redundantes. Depois adicionou-se a coluna "Bônus" (logo após "Valor pra subir",
 * fórmula viva Custo − Valor pra subir). As colunas "Chassi" e "Reservado" foram
 * removidas do XLSX (Reservado segue só na tela /repasses, não no Excel).
 * Depois adicionou-se o desfecho da venda: "Resultado", "Valor vendido" e
 * "Margem real" (fórmula viva = Valor vendido − Custo), antes de "Observação".
 * Total agora: 22 colunas.
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
    valor_vendido: null,
    data_vendido: null,
    comprador: null,
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

  it("header da tabela está na linha 4 com 22 colunas (sem Chassi/Reservado)", async () => {
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse()]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    assert.equal(ws.getCell("A4").value, "#");
    assert.equal(ws.getCell("B4").value, "Placa");
    assert.equal(ws.getCell("C4").value, "Marca");
    assert.equal(ws.getCell("D4").value, "Modelo");
    assert.equal(ws.getCell("L4").value, "Preço atual");
    assert.equal(ws.getCell("M4").value, "Custo");
    assert.equal(ws.getCell("N4").value, "Valor pra subir");
    assert.equal(ws.getCell("O4").value, "Bônus");
    assert.equal(ws.getCell("P4").value, "IPVA");
    assert.equal(ws.getCell("Q4").value, "Doc");
    assert.equal(ws.getCell("R4").value, "Cautelar");
    assert.equal(ws.getCell("S4").value, "Resultado");
    assert.equal(ws.getCell("T4").value, "Valor vendido");
    assert.equal(ws.getCell("U4").value, "Margem real");
    assert.equal(ws.getCell("V4").value, "Observação");
    // Header não contém mais "Chassi" nem "Reservado".
    const headers = ws.getRow(4).values as Array<string | undefined>;
    assert.ok(!headers.includes("Chassi"), "header não deve ter 'Chassi'");
    assert.ok(!headers.includes("Reservado"), "header não deve ter 'Reservado'");
    // 22ª coluna (V) é a última — W deve estar vazia no header.
    assert.equal(ws.getCell("W4").value ?? "", "");
  });

  it("dados começam na linha 5 com snapshot do veículo", async () => {
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse()]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    assert.equal(ws.getCell("A5").value, 1);
    assert.equal(ws.getCell("B5").value, "ABC1D23");
    assert.equal(ws.getCell("C5").value, "Ford");
    assert.equal(ws.getCell("D5").value, "RANGER XLT 3.2");
    assert.equal(ws.getCell("L5").value, 145000); // preço atual
    assert.equal(ws.getCell("M5").value, 120000); // custo (valor aquisição)
  });

  it("repasse SEM campos manuais: Valor pra subir/IPVA/Doc/Cautelar/Obs ficam VAZIOS", async () => {
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse()]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    assert.equal(ws.getCell("N5").value ?? "", ""); // Valor pra subir
    assert.equal(ws.getCell("P5").value ?? "", ""); // IPVA
    assert.equal(ws.getCell("Q5").value ?? "", ""); // Doc
    assert.equal(ws.getCell("R5").value ?? "", ""); // Cautelar
    assert.equal(ws.getCell("V5").value ?? "", ""); // Observação
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
    assert.equal(ws.getCell("N5").value, 138500); // Valor pra subir (numérico)
    assert.equal(ws.getCell("P5").value, "Pago");
    assert.equal(ws.getCell("Q5").value, "OK");
    assert.equal(ws.getCell("R5").value, "Limpa");
    assert.equal(ws.getCell("V5").value, "Pneu dianteiro pra trocar");
  });

  it("cell preenchida NÃO tem dataValidation (já tem dado)", async () => {
    const buf = await gerarRelatorioRepasseProfissional([
      buildRepasse({ ipva_status: "pago" }),
    ]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    const cell = ws.getCell("P5"); // IPVA preenchido
    assert.equal(cell.dataValidation, undefined, "IPVA preenchido não deve ter dropdown");
  });

  it("cell vazia mantém dataValidation pra `_Listas` (fallback Excel)", async () => {
    // Inline values com vírgula quebra em Excel locale BR (separador ";").
    // Solução: planilha auxiliar oculta com valores + range absoluto.
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse()]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    const cell = ws.getCell("P5"); // IPVA vazio
    assert.ok(cell.dataValidation, "IPVA vazio deveria ter dataValidation");
    assert.equal(cell.dataValidation!.type, "list");
    const formula = String((cell.dataValidation!.formulae ?? [])[0] ?? "");
    assert.match(formula, /^_Listas!\$A\$1:\$A\$3$/, `esperado range _Listas, recebido: ${formula}`);
  });

  it("Doc vazio aponta pra range B (4 valores); Cautelar vazia pra C (3 valores)", async () => {
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse()]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    const doc = ws.getCell("Q5");
    assert.ok(doc.dataValidation);
    const fDoc = String((doc.dataValidation!.formulae ?? [])[0] ?? "");
    assert.match(fDoc, /^_Listas!\$B\$1:\$B\$4$/, `Doc: ${fDoc}`);

    const caut = ws.getCell("R5");
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
    const preco = ws.getCell("L5");
    assert.match(String(preco.numFmt ?? ""), /R\$/);
    const custo = ws.getCell("M5");
    assert.match(String(custo.numFmt ?? ""), /R\$/);
  });

  it("Valor pra subir preenchido vem com formato R$ BR", async () => {
    const buf = await gerarRelatorioRepasseProfissional([
      buildRepasse({ valor_subir: 138_500 }),
    ]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    const vs = ws.getCell("N5");
    assert.equal(vs.value, 138500);
    assert.match(String(vs.numFmt ?? ""), /R\$/, "Valor pra subir preenchido precisa ter numFmt R$");
  });

  it("Dias parado usa dias_patio REAL do estoque (via map por chassi)", async () => {
    // Coluna K = "Dias parado". Agora reflete o dias_patio atual do estoque
    // (quanto tempo o carro está parado no pátio), igual à tela /repasses —
    // NÃO dias desde data_marcado.
    const r = buildRepasse({ chassi: "9BWZZZ377VT004251" });
    const map = new Map<string, number | null>([["9BWZZZ377VT004251", 217]]);
    const buf = await gerarRelatorioRepasseProfissional([r], map);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    assert.equal(ws.getCell("K5").value, 217);
  });

  it("Dias parado: chassi sem entrada no map → célula vazia (não quebra)", async () => {
    const r = buildRepasse({ chassi: "9BWZZZ377VT004251" });
    const map = new Map<string, number | null>([["OUTRO_CHASSI", 99]]);
    const buf = await gerarRelatorioRepasseProfissional([r], map);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    assert.equal(ws.getCell("K5").value ?? "", "");
  });

  it("Dias parado: sem map (param undefined) → célula vazia (não quebra)", async () => {
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse()]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    assert.equal(ws.getCell("K5").value ?? "", "");
  });

  it("AutoFilter cobre todas as 22 colunas (V = col 22)", async () => {
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse()]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    // Na releitura o exceljs serializa o autoFilter como string "A4:V4".
    const af = String(ws.autoFilter ?? "");
    assert.match(af, /A4/, `autoFilter deve começar em A4: ${af}`);
    assert.match(af, /V4/, `autoFilter deve ir até V4 (22 colunas): ${af}`);
  });

  // ─── Colunas "Chassi" e "Reservado" removidas do XLSX ───────────────────────

  it("XLSX não tem mais coluna 'Chassi' nem 'Reservado'", async () => {
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse()]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    const headers = (ws.getRow(4).values as Array<string | undefined>).map((h) => String(h ?? ""));
    assert.ok(!headers.includes("Chassi"), "não deve existir coluna 'Chassi' no XLSX");
    assert.ok(!headers.includes("Reservado"), "não deve existir coluna 'Reservado' no XLSX");
  });

  // ─── Coluna "Bônus" (fórmula viva Custo − Valor pra subir) ──────────────────

  it("coluna 'Bônus' existe no header (linha 4, col O)", async () => {
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse()]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    assert.equal(ws.getCell("O4").value, "Bônus");
  });

  it("célula Bônus (O5) tem fórmula viva robusta (ISNUMBER/AND) referenciando Custo (M) e Valor pra subir (N)", async () => {
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse()]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    const cell = ws.getCell("O5");
    const formula = String((cell.value as { formula?: string } | null)?.formula ?? "");
    assert.ok(formula.length > 0, "Bônus deve ser uma fórmula, não valor fixo");
    assert.match(formula, /M5/, `fórmula deve referenciar a coluna Custo (M5): ${formula}`);
    assert.match(formula, /N5/, `fórmula deve referenciar Valor pra subir (N5): ${formula}`);
    // Robustez: usa ISNUMBER + AND pra não dar #VALUE! com célula vazia/texto.
    assert.match(formula, /ISNUMBER\(M5\)/, `fórmula deve checar ISNUMBER do Custo: ${formula}`);
    assert.match(formula, /ISNUMBER\(N5\)/, `fórmula deve checar ISNUMBER do Valor: ${formula}`);
    assert.match(formula, /^IF\(AND\(/, `fórmula deve começar com IF(AND(: ${formula}`);
    assert.match(formula, /M5>N5/, `fórmula só mostra bônus quando Custo > Valor: ${formula}`);
    // Fica vazio quando sem bônus.
    assert.match(formula, /""/, `fórmula deve deixar vazio quando sem bônus: ${formula}`);
    // Texto exato esperado.
    assert.equal(formula, 'IF(AND(ISNUMBER(M5),ISNUMBER(N5),M5>N5),M5-N5,"")');
  });

  it("célula Bônus vem com formato R$ BR", async () => {
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse()]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    assert.match(String(ws.getCell("O5").numFmt ?? ""), /R\$/);
  });

  // ─── Desfecho da venda (Resultado / Valor vendido / Margem real) ────────────

  it("colunas Resultado/Valor vendido/Margem real existem no header (S/T/U)", async () => {
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse()]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    assert.equal(ws.getCell("S4").value, "Resultado");
    assert.equal(ws.getCell("T4").value, "Valor vendido");
    assert.equal(ws.getCell("U4").value, "Margem real");
  });

  it("repasse vendido: Resultado='Vendido', Valor vendido numérico, Margem fórmula viva robusta", async () => {
    const buf = await gerarRelatorioRepasseProfissional([
      buildRepasse({ status: "vendido", valor_vendido: 150_000, valor_aquisicao: 120_000 }),
    ]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    assert.equal(ws.getCell("S5").value, "Vendido");
    assert.equal(ws.getCell("T5").value, 150000);
    assert.match(String(ws.getCell("T5").numFmt ?? ""), /R\$/);
    // Margem real = fórmula viva = Valor vendido (T) − Custo (M), robusta ISNUMBER.
    const formula = String((ws.getCell("U5").value as { formula?: string } | null)?.formula ?? "");
    assert.equal(formula, 'IF(AND(ISNUMBER(T5),ISNUMBER(M5)),T5-M5,"")');
    assert.match(String(ws.getCell("U5").numFmt ?? ""), /R\$/);
  });

  it("repasse não vendido: Resultado='Não vendido', Valor vendido e Margem vazios", async () => {
    const buf = await gerarRelatorioRepasseProfissional([
      buildRepasse({ status: "nao_vendido" }),
    ]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    assert.equal(ws.getCell("S5").value, "Não vendido");
    assert.equal(ws.getCell("T5").value ?? "", "");
    assert.equal(ws.getCell("U5").value ?? "", "");
  });

  it("repasse sem desfecho (marcado): Resultado='—', sem valor/margem", async () => {
    const buf = await gerarRelatorioRepasseProfissional([buildRepasse({ status: "marcado" })]);
    const wb = await abrir(buf);
    const ws = wb.worksheets[0]!;
    assert.equal(ws.getCell("S5").value, "—");
    assert.equal(ws.getCell("T5").value ?? "", "");
    assert.equal(ws.getCell("U5").value ?? "", "");
  });
});
