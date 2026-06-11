/**
 * Gerador de planilha XLSX profissional pra carros marcados pra repasse.
 *
 * Caminho B (Sprint nova): Marcos preenche IPVA/Doc/Cautelar/Valor pra subir/
 * Observação INLINE no /repasses. Esse XLSX agora vem PRÉ-PREENCHIDO com o
 * que ele já colocou no sistema. Cells vazias mantêm o dropdown como fallback
 * caso ele queira preencher no Excel.
 *
 * Layout: 1 aba só ("Carros pra Repasse").
 *   - Linhas 1-3: cabeçalho com título, data de geração, total + capital travado
 *   - Linha 5: header da tabela (18 colunas)
 *   - Linha 6+: dados dos carros (snapshot + campos manuais já preenchidos)
 *   - Cells preenchidas: SEM dataValidation, COM cor de fundo de status
 *   - Cells vazias: COM dataValidation apontando pra `_Listas`
 *   - AutoFilter no header + frozen header (5 linhas)
 *
 * Por que `exceljs` e não `xlsx` (SheetJS)?
 *   - Precisa de data validation (dropdowns) por célula
 *   - Estilos de borda/fundo/fonte
 *   - AutoFilter + frozen panes
 */

import ExcelJS from "exceljs";
import {
  CANAL_LABEL,
  CAUTELAR_LABEL,
  DOC_LABEL,
  IPVA_LABEL,
  STATUS_LABEL,
  type CautelarStatus,
  type DocStatus,
  type IpvaStatus,
  type Repasse,
} from "@/lib/repasses/types";

const FMT_BRL = '"R$" #,##0.00;[Red]-"R$" #,##0.00';
const FMT_INT = "#,##0";

const COR_TITULO_BG = "FF1E3A8A"; // azul escuro
const COR_TITULO_FG = "FFFFFFFF";
const COR_HEADER_BG = "FF3B82F6"; // azul Tailwind blue-500
const COR_HEADER_FG = "FFFFFFFF";
const COR_ZEBRA = "FFF3F4F6"; // cinza claro

// Cores de fundo por status preenchido (paleta clara, contraste com texto preto)
const COR_OK = "FFD1FAE5"; // emerald-100
const COR_WARN = "FFFEF3C7"; // amber-100
const COR_BAD = "FFFEE2E2"; // red-100
const COR_NEUTRO = "FFE5E7EB"; // gray-200

const BORDA_FINA: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFD1D5DB" } },
  bottom: { style: "thin", color: { argb: "FFD1D5DB" } },
  left: { style: "thin", color: { argb: "FFD1D5DB" } },
  right: { style: "thin", color: { argb: "FFD1D5DB" } },
};

/** Formata YYYY-MM-DD pra Date local (sem timezone shift). null vira null. */
function dateOnly(value: string | null): Date | null {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/** Calcula dias entre data_marcado (YYYY-MM-DD) e hoje. */
function diasParado(dataMarcado: string): number | null {
  const d = dateOnly(dataMarcado);
  if (!d) return null;
  const hoje = new Date();
  const ms = hoje.getTime() - d.getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

/**
 * Soma `preco_atual` SÓ dos repasses com status='marcado' — usado pro KPI
 * "capital travado". Subidos já foram pro Auto Avaliar, então não contam
 * como capital travado mesmo se aparecem no export (filtro "Todos").
 *
 * Consistente com o KPI da tela de /repasses.
 *
 * NOTA: continua usando `preco_atual` (snapshot do estoque) e não `valor_subir`
 * (decisão manual mutável). KPI = capital travado real, não palpite.
 */
function somarPrecoAtualMarcados(repasses: ReadonlyArray<Repasse>): number {
  let total = 0;
  for (const r of repasses) {
    if (r.status === "marcado" && r.preco_atual != null) total += r.preco_atual;
  }
  return total;
}

/** Definições de coluna da tabela (header → key → largura). */
const COLUNAS: ReadonlyArray<{ key: string; header: string; width: number }> = [
  { key: "n", header: "#", width: 5 },
  { key: "placa", header: "Placa", width: 11 },
  { key: "chassi", header: "Chassi", width: 22 },
  { key: "marca", header: "Marca", width: 14 },
  { key: "modelo", header: "Modelo", width: 32 },
  { key: "ano_fab", header: "Ano Fab", width: 9 },
  { key: "ano_mod", header: "Ano Mod", width: 9 },
  { key: "km", header: "KM", width: 11 },
  { key: "cor", header: "Cor", width: 12 },
  { key: "loja", header: "Loja", width: 8 },
  { key: "patio", header: "Pátio", width: 14 },
  { key: "dias_parado", header: "Dias parado", width: 11 },
  { key: "preco_atual", header: "Preço atual", width: 14 },
  { key: "custo", header: "Custo", width: 14 },
  { key: "valor_subir", header: "Valor pra subir", width: 15 },
  { key: "ipva", header: "IPVA", width: 16 },
  { key: "doc", header: "Doc", width: 16 },
  { key: "cautelar", header: "Cautelar", width: 16 },
  { key: "observacao", header: "Observação", width: 40 },
];

const COL_VALOR_SUBIR = COLUNAS.findIndex((c) => c.key === "valor_subir") + 1; // 1-based
const COL_IPVA = COLUNAS.findIndex((c) => c.key === "ipva") + 1;
const COL_DOC = COLUNAS.findIndex((c) => c.key === "doc") + 1;
const COL_CAUTELAR = COLUNAS.findIndex((c) => c.key === "cautelar") + 1;
const COL_OBS = COLUNAS.findIndex((c) => c.key === "observacao") + 1;
const COL_PRECO = COLUNAS.findIndex((c) => c.key === "preco_atual") + 1;
const COL_CUSTO = COLUNAS.findIndex((c) => c.key === "custo") + 1;
const COL_KM = COLUNAS.findIndex((c) => c.key === "km") + 1;

const HEADER_ROW = 5;
const DATA_START_ROW = 6;

/**
 * Opções de dropdown pra IPVA / Doc / Cautelar. Mantidas em ranges nomeados
 * numa aba auxiliar oculta (`_Listas`) — workaround pra data validation
 * funcionar em qualquer locale (Excel pt-BR usa `;` como separador, e o
 * `formulae: ['"a,b,c"']` inline quebra).
 *
 * Ordem precisa bater com as constantes IPVA_VALUES/DOC_VALUES/CAUTELAR_VALUES
 * dos types.ts — mas como o XLSX é só pra exibição, mantemos os labels.
 */
const OPCOES_IPVA: ReadonlyArray<string> = ["Pago", "Em aberto", "Não verificado"];
const OPCOES_DOC: ReadonlyArray<string> = ["OK", "Pendente", "Irregular", "Não verificado"];
const OPCOES_CAUTELAR: ReadonlyArray<string> = ["Limpa", "Com restrição", "Não verificada"];

/** Cor de fundo por status preenchido. */
function corIpva(s: IpvaStatus): string {
  switch (s) {
    case "pago":
      return COR_OK;
    case "em_aberto":
      return COR_WARN;
    case "nao_verificado":
      return COR_NEUTRO;
  }
}
function corDoc(s: DocStatus): string {
  switch (s) {
    case "ok":
      return COR_OK;
    case "pendente":
      return COR_WARN;
    case "irregular":
      return COR_BAD;
    case "nao_verificado":
      return COR_NEUTRO;
  }
}
function corCautelar(s: CautelarStatus): string {
  switch (s) {
    case "limpa":
      return COR_OK;
    case "com_restricao":
      return COR_BAD;
    case "nao_verificada":
      return COR_NEUTRO;
  }
}

export async function gerarRelatorioRepasseProfissional(
  repasses: ReadonlyArray<Repasse>,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Navesa Mesa";
  wb.created = new Date();

  const ws = wb.addWorksheet("Carros pra Repasse", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ state: "frozen", ySplit: HEADER_ROW }],
  });

  // Aba auxiliar oculta com listas de valores pras data validations.
  // Mantida oculta — usuário não vê, mas o Excel resolve as referências.
  const aux = wb.addWorksheet("_Listas", { state: "hidden" });
  preencherColuna(aux, 1, OPCOES_IPVA);
  preencherColuna(aux, 2, OPCOES_DOC);
  preencherColuna(aux, 3, OPCOES_CAUTELAR);

  // ─── Larguras das colunas ──────────────────────────────────────────────────
  for (let i = 0; i < COLUNAS.length; i++) {
    ws.getColumn(i + 1).width = COLUNAS[i]!.width;
  }

  const lastCol = COLUNAS.length;
  const totalRegistros = repasses.length;
  const capitalTravado = somarPrecoAtualMarcados(repasses);
  const agora = new Date();
  const dataGeradaBR = `${String(agora.getDate()).padStart(2, "0")}/${String(
    agora.getMonth() + 1,
  ).padStart(2, "0")}/${agora.getFullYear()} ${String(agora.getHours()).padStart(2, "0")}:${String(
    agora.getMinutes(),
  ).padStart(2, "0")}`;

  // ─── Cabeçalho (linhas 1-3) ────────────────────────────────────────────────
  ws.mergeCells(1, 1, 1, lastCol);
  const titulo = ws.getCell(1, 1);
  titulo.value = "NAVESA — Relatório de Carros pra Repasse";
  titulo.font = { name: "Calibri", size: 16, bold: true, color: { argb: COR_TITULO_FG } };
  titulo.alignment = { horizontal: "center", vertical: "middle" };
  titulo.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COR_TITULO_BG } };
  ws.getRow(1).height = 30;

  ws.mergeCells(2, 1, 2, lastCol);
  const sub = ws.getCell(2, 1);
  sub.value = `Gerado em: ${dataGeradaBR}`;
  sub.font = { name: "Calibri", size: 10, color: { argb: COR_TITULO_FG } };
  sub.alignment = { horizontal: "center", vertical: "middle" };
  sub.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
  ws.getRow(2).height = 18;

  ws.mergeCells(3, 1, 3, lastCol);
  const totais = ws.getCell(3, 1);
  totais.value = `Total: ${totalRegistros} veículo${totalRegistros === 1 ? "" : "s"} | Capital travado (marcados): ${formatBRLPlain(capitalTravado)}`;
  totais.font = { name: "Calibri", size: 10, color: { argb: COR_TITULO_FG }, bold: true };
  totais.alignment = { horizontal: "center", vertical: "middle" };
  totais.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
  ws.getRow(3).height = 18;

  // ─── Header da tabela (linha 5) ────────────────────────────────────────────
  const headerRow = ws.getRow(HEADER_ROW);
  for (let i = 0; i < COLUNAS.length; i++) {
    const cell = headerRow.getCell(i + 1);
    cell.value = COLUNAS[i]!.header;
    cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: COR_HEADER_FG } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COR_HEADER_BG } };
    cell.border = BORDA_FINA;
  }
  headerRow.height = 22;

  // ─── Dados (linha 6+) ──────────────────────────────────────────────────────
  // Rastreia quais cells dos campos manuais ficaram VAZIAS → recebem dataValidation.
  // Cells preenchidas: sem validation (já tem dado) + cor de fundo do status.
  const linhasVaziasPorCol: Record<number, number[]> = {
    [COL_IPVA]: [],
    [COL_DOC]: [],
    [COL_CAUTELAR]: [],
  };

  repasses.forEach((r, idx) => {
    const rowNum = DATA_START_ROW + idx;
    const row = ws.getRow(rowNum);
    const zebra = idx % 2 === 1;

    const ipvaLabel = r.ipva_status ? IPVA_LABEL[r.ipva_status] : "";
    const docLabel = r.documentacao_status ? DOC_LABEL[r.documentacao_status] : "";
    const cautelarLabel = r.cautelar_status_manual
      ? CAUTELAR_LABEL[r.cautelar_status_manual]
      : "";

    const valores: Array<string | number | Date | null> = [
      idx + 1,
      r.placa,
      r.chassi,
      r.marca ?? "",
      r.modelo,
      r.ano_fabricacao ?? "",
      r.ano_modelo ?? "",
      r.km ?? "",
      r.cor ?? "",
      r.loja_origem ?? "",
      r.patio_origem ?? "",
      diasParado(r.data_marcado) ?? "",
      r.preco_atual ?? "",
      r.valor_aquisicao ?? "",
      r.valor_subir ?? "",
      ipvaLabel,
      docLabel,
      cautelarLabel,
      r.observacoes ?? "",
    ];

    for (let i = 0; i < valores.length; i++) {
      const cell = row.getCell(i + 1);
      cell.value = valores[i] ?? "";
      cell.border = BORDA_FINA;
      if (zebra) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COR_ZEBRA } };
      }
    }

    row.getCell(COL_PRECO).numFmt = FMT_BRL;
    row.getCell(COL_CUSTO).numFmt = FMT_BRL;
    row.getCell(COL_KM).numFmt = FMT_INT;
    if (r.valor_subir != null) {
      row.getCell(COL_VALOR_SUBIR).numFmt = FMT_BRL;
    }
    row.getCell(COL_OBS).alignment = { wrapText: true, vertical: "top" };
    row.height = 20;

    // Cor de fundo + tracking de cells vazias pros dropdowns.
    if (r.ipva_status) {
      row.getCell(COL_IPVA).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: corIpva(r.ipva_status) },
      };
    } else {
      linhasVaziasPorCol[COL_IPVA]!.push(rowNum);
    }
    if (r.documentacao_status) {
      row.getCell(COL_DOC).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: corDoc(r.documentacao_status) },
      };
    } else {
      linhasVaziasPorCol[COL_DOC]!.push(rowNum);
    }
    if (r.cautelar_status_manual) {
      row.getCell(COL_CAUTELAR).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: corCautelar(r.cautelar_status_manual) },
      };
    } else {
      linhasVaziasPorCol[COL_CAUTELAR]!.push(rowNum);
    }
  });

  const lastDataRow = totalRegistros > 0 ? DATA_START_ROW + totalRegistros - 1 : DATA_START_ROW;

  // ─── Data validation (dropdowns) — SÓ nas cells vazias ─────────────────────
  // Referência range na aba "_Listas" (oculta). Funciona em qualquer locale
  // do Excel — string inline com vírgula quebra em Excel BR (separador ";").
  if (totalRegistros > 0) {
    aplicarValidationEmLinhas(
      ws,
      COL_IPVA,
      linhasVaziasPorCol[COL_IPVA]!,
      rangeListas("A", OPCOES_IPVA.length),
    );
    aplicarValidationEmLinhas(
      ws,
      COL_DOC,
      linhasVaziasPorCol[COL_DOC]!,
      rangeListas("B", OPCOES_DOC.length),
    );
    aplicarValidationEmLinhas(
      ws,
      COL_CAUTELAR,
      linhasVaziasPorCol[COL_CAUTELAR]!,
      rangeListas("C", OPCOES_CAUTELAR.length),
    );
  }

  // ─── AutoFilter ────────────────────────────────────────────────────────────
  ws.autoFilter = {
    from: { row: HEADER_ROW, column: 1 },
    to: { row: HEADER_ROW, column: lastCol },
  };

  // ─── Footer ────────────────────────────────────────────────────────────────
  if (totalRegistros > 0) {
    const footerRow = lastDataRow + 2;
    const footer = ws.getCell(footerRow, 1);
    ws.mergeCells(footerRow, 1, footerRow, lastCol);
    footer.value = `TOTAL: ${totalRegistros} veículo${totalRegistros === 1 ? "" : "s"} | Capital travado (marcados): ${formatBRLPlain(capitalTravado)}`;
    footer.font = { name: "Calibri", size: 11, bold: true };
    footer.alignment = { horizontal: "right", vertical: "middle" };
  }

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Aplica data validation (dropdown) em linhas específicas (não-contíguas).
 *
 * `formula` deve apontar pra um range na aba `_Listas` (ex.: `_Listas!$A$1:$A$3`).
 * Inline values com vírgula quebram em Excel BR — sempre use range.
 */
function aplicarValidationEmLinhas(
  ws: ExcelJS.Worksheet,
  col: number,
  rows: ReadonlyArray<number>,
  formula: string,
) {
  for (const r of rows) {
    const cell = ws.getCell(r, col);
    cell.dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [formula],
      showErrorMessage: true,
      errorTitle: "Valor inválido",
      error: "Use o dropdown pra selecionar uma opção.",
    };
  }
}

/** Preenche uma coluna (1-based) da aba `_Listas` com os valores. */
function preencherColuna(ws: ExcelJS.Worksheet, col: number, valores: ReadonlyArray<string>) {
  for (let i = 0; i < valores.length; i++) {
    ws.getCell(i + 1, col).value = valores[i] ?? "";
  }
}

/** Monta a fórmula de range absoluto pra aba `_Listas` (ex.: `_Listas!$A$1:$A$3`). */
function rangeListas(coluna: "A" | "B" | "C", n: number): string {
  return `_Listas!$${coluna}$1:$${coluna}$${n}`;
}

/** BRL sem usar Intl (evita locale do Excel) — pro footer/título. */
function formatBRLPlain(value: number): string {
  return `R$ ${value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// ─── Re-exports / debug helpers (mantidos pra simplificar import nos callers) ──

export { STATUS_LABEL, CANAL_LABEL };
