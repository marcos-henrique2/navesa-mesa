/**
 * EXPORT RELATÓRIO DE ESTOQUE GERENCIAL — VERSÃO PDF
 *
 * Espelha 100% a estrutura do XLSX (relatorio-gerencial-estoque.ts):
 *   - Paisagem A4
 *   - Header "RELATÓRIO DE ESTOQUE GERENCIAL" + meta (Data, Loja, Total)
 *   - 13 colunas: # / LOJA / PLACA / MARCA / MODELO / ANO / KM / DIAS / PREÇO ENTRADA /
 *     PREÇO VENDA / MARGEM EST. / STATUS / LOCALIZAÇÃO
 *   - Margem com cor condicional (verde/vermelho/neutro)
 *   - Status com cor condicional (disponível/falta doc/bloqueado)
 *   - Localização com cor por categoria (prep, trânsito, oficina, bloqueado)
 *   - Header repete em cada página
 *   - Bloco TOTALIZADORES em página separada (page break antes)
 *   - Footer com nº da página
 */

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { CellHookData, Color } from "jspdf-autotable";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";

// ═══════════════════════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════════════════════

export type RelatorioGerencialPdfVeiculo = VeiculoParsed & {
  /** Nome da loja resolvido a partir do mapa de lojas. null se desconhecido. */
  empresa_nome: string | null;
};

export type RelatorioGerencialPdfInput = {
  veiculos: RelatorioGerencialPdfVeiculo[];
  filtroLoja: string;
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtDataBR(): string {
  return new Date().toLocaleDateString("pt-BR");
}

function fmtAno(fab: number | null, mod: number | null): string {
  if (fab != null && mod != null) {
    return fab === mod ? String(mod) : `${fab}/${mod}`;
  }
  if (mod != null) return String(mod);
  if (fab != null) return String(fab);
  return "—";
}

function fmtKm(km: number | null): string {
  if (km == null) return "—";
  return `${km.toLocaleString("pt-BR")} km`;
}

function fmtMoney(value: number | null): string {
  if (value == null) return "—";
  return `R$ ${Math.round(value).toLocaleString("pt-BR")}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// CLASSIFICAÇÃO (espelho do XLSX)
// ═══════════════════════════════════════════════════════════════════════════

type MargemTone = "neg" | "good" | "neutral";

function classificarMargem(
  aquisicao: number | null,
  venda: number | null,
): { valor: number | null; tone: MargemTone } {
  if (aquisicao == null || venda == null) return { valor: null, tone: "neutral" };
  const margem = venda - aquisicao;
  if (margem < 0) return { valor: margem, tone: "neg" };
  if (aquisicao > 0 && margem / aquisicao > 0.15) return { valor: margem, tone: "good" };
  return { valor: margem, tone: "neutral" };
}

type StatusTone = "disponivel" | "faltaDoc" | "bloqueado" | "neutro";

function classificarStatus(descricao: string | null): StatusTone {
  if (descricao == null) return "neutro";
  const norm = descricao.trim().toUpperCase();
  if (norm === "DISPONIVEL" || norm === "DISPONÍVEL") return "disponivel";
  if (norm === "FALTA DOCUMENTO") return "faltaDoc";
  if (norm === "BLOQUEADO") return "bloqueado";
  return "neutro";
}

type PatioCategoria = "prep" | "transito" | "oficina" | "bloqueado" | "loja" | "outro";

function categorizarPatio(patio: string | null): PatioCategoria {
  if (patio == null) return "outro";
  const norm = patio.trim().toUpperCase();
  if (norm === "") return "outro";
  if (norm.includes("BLOQUEAD") || norm.includes("PENENCIA")) return "bloqueado";
  if (norm.includes("PREP")) return "prep";
  if (norm.includes("TRANSITO") || norm.includes("TRÂNSITO")) return "transito";
  if (
    norm.includes("OFICINA") ||
    norm.includes("FUNILARIA") ||
    norm.includes("TONICAR") ||
    norm.includes("AUTO HALL") ||
    norm.includes("PRO+") ||
    norm.includes("GEELY") ||
    norm.includes("AF")
  ) {
    return "oficina";
  }
  return "loja";
}

// Cores RGB (espelham os ARGB do XLSX)
const RGB = {
  marginNegBg: [254, 226, 226] as Color,
  marginNegFg: [153, 27, 27] as Color,
  marginGoodBg: [209, 250, 229] as Color,
  marginGoodFg: [6, 95, 70] as Color,
  statusDisponivelBg: [209, 250, 229] as Color,
  statusDisponivelFg: [6, 95, 70] as Color,
  statusFaltaDocBg: [254, 243, 199] as Color,
  statusFaltaDocFg: [146, 64, 14] as Color,
  statusBloqueadoBg: [254, 226, 226] as Color,
  statusBloqueadoFg: [153, 27, 27] as Color,
  patioPrepBg: [254, 243, 199] as Color,
  patioTransitoBg: [219, 234, 254] as Color,
  patioOficinaBg: [255, 237, 213] as Color,
  patioBloqueadoBg: [254, 226, 226] as Color,
  alertFg: [153, 27, 27] as Color,
};

// ═══════════════════════════════════════════════════════════════════════════
// TOTALIZADORES (mesmas regras do XLSX)
// ═══════════════════════════════════════════════════════════════════════════

type Totalizadores = {
  totalVeiculos: number;
  capitalTravado: number;
  valorMercado: number;
  margemPotencial: number;
  margemMediaPct: number | null;
  kmMedio: number | null;
  diasPatioMedio: number | null;
  qtMais60: number;
  pctMais60: number;
  qtMais90: number;
  pctMais90: number;
  qtMargemNeg: number;
  pctMargemNeg: number;
  qtDisponivel: number;
  pctDisponivel: number;
  qtFaltaDoc: number;
  pctFaltaDoc: number;
};

function calcularTotalizadores(veiculos: RelatorioGerencialPdfVeiculo[]): Totalizadores {
  const total = veiculos.length;
  let capital = 0;
  let mercado = 0;
  let margem = 0;
  let countComMargemBase = 0;
  let somaMargemPct = 0;
  let countComKm = 0;
  let somaKm = 0;
  let countComDias = 0;
  let somaDias = 0;
  let qtMais60 = 0;
  let qtMais90 = 0;
  let qtMargemNeg = 0;
  let qtDisponivel = 0;
  let qtFaltaDoc = 0;

  for (const v of veiculos) {
    if (v.valor_aquisicao != null) capital += v.valor_aquisicao;
    if (v.preco_venda != null) mercado += v.preco_venda;
    if (v.valor_aquisicao != null && v.preco_venda != null) {
      const m = v.preco_venda - v.valor_aquisicao;
      margem += m;
      if (v.valor_aquisicao > 0) {
        somaMargemPct += (m / v.valor_aquisicao) * 100;
        countComMargemBase++;
      }
      if (m < 0) qtMargemNeg++;
    }
    if (v.km != null) {
      somaKm += v.km;
      countComKm++;
    }
    if (v.dias_patio != null) {
      somaDias += v.dias_patio;
      countComDias++;
      if (v.dias_patio > 60) qtMais60++;
      if (v.dias_patio > 90) qtMais90++;
    }
    const statusTone = classificarStatus(v.descricao_situacao);
    if (statusTone === "disponivel") qtDisponivel++;
    if (statusTone === "faltaDoc") qtFaltaDoc++;
  }

  const pct = (n: number): number => (total === 0 ? 0 : (n / total) * 100);

  return {
    totalVeiculos: total,
    capitalTravado: capital,
    valorMercado: mercado,
    margemPotencial: margem,
    margemMediaPct: countComMargemBase > 0 ? somaMargemPct / countComMargemBase : null,
    kmMedio: countComKm > 0 ? somaKm / countComKm : null,
    diasPatioMedio: countComDias > 0 ? somaDias / countComDias : null,
    qtMais60,
    pctMais60: pct(qtMais60),
    qtMais90,
    pctMais90: pct(qtMais90),
    qtMargemNeg,
    pctMargemNeg: pct(qtMargemNeg),
    qtDisponivel,
    pctDisponivel: pct(qtDisponivel),
    qtFaltaDoc,
    pctFaltaDoc: pct(qtFaltaDoc),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// GERAÇÃO
// ═══════════════════════════════════════════════════════════════════════════

export async function gerarRelatorioGerencialPdf(
  input: RelatorioGerencialPdfInput,
): Promise<Blob> {
  const { veiculos, filtroLoja } = input;
  const tot = calcularTotalizadores(veiculos);

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginLR = 10;

  // ─── Header faixa azul ───
  doc.setFillColor(30, 64, 175); // #1E40AF
  doc.rect(0, 0, pageWidth, 14, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("RELATÓRIO DE ESTOQUE GERENCIAL", pageWidth / 2, 9.5, { align: "center" });

  // ─── Meta ───
  doc.setFillColor(243, 244, 246);
  doc.rect(0, 14, pageWidth, 8, "F");
  doc.setTextColor(17, 24, 39);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  const metaY = 19.5;
  const segWidth = pageWidth / 3;
  doc.text(`Data: ${fmtDataBR()}`, marginLR, metaY);
  doc.text(
    `Loja: ${filtroLoja === "all" ? "TODAS" : filtroLoja}`,
    segWidth + marginLR,
    metaY,
  );
  doc.text(`Total de veículos: ${veiculos.length}`, segWidth * 2 + marginLR, metaY);

  // ─── Tabela ───
  // Pre-calcula linhas de metadados pra colorir células no didParseCell
  type RowMeta = {
    margemTone: MargemTone;
    statusTone: StatusTone;
    patioCategoria: PatioCategoria;
  };
  const rowsMeta: RowMeta[] = veiculos.map((v) => ({
    margemTone: classificarMargem(v.valor_aquisicao, v.preco_venda).tone,
    statusTone: classificarStatus(v.descricao_situacao),
    patioCategoria: categorizarPatio(v.patio),
  }));

  const body: string[][] = veiculos.map((v, idx) => {
    const margem = classificarMargem(v.valor_aquisicao, v.preco_venda);
    return [
      String(idx + 1),
      v.empresa_nome ?? "—",
      v.placa,
      v.marca ?? "—",
      v.modelo,
      fmtAno(v.ano_fabricacao, v.ano_modelo),
      fmtKm(v.km),
      v.dias_patio != null ? String(v.dias_patio) : "—",
      fmtMoney(v.valor_aquisicao),
      fmtMoney(v.preco_venda),
      margem.valor != null ? fmtMoney(margem.valor) : "—",
      v.descricao_situacao?.trim() || "—",
      v.patio.trim() || "—",
    ];
  });

  autoTable(doc, {
    startY: 25,
    margin: { left: marginLR, right: marginLR, top: 25, bottom: 14 },
    head: [
      [
        "#",
        "LOJA",
        "PLACA",
        "MARCA",
        "MODELO",
        "ANO",
        "KM",
        "DIAS PÁTIO",
        "PREÇO ENTRADA",
        "PREÇO VENDA",
        "MARGEM EST.",
        "STATUS",
        "LOCALIZAÇÃO",
      ],
    ],
    body,
    showHead: "everyPage",
    theme: "grid",
    styles: {
      fontSize: 8,
      cellPadding: 1.4,
      lineColor: [209, 213, 219],
      lineWidth: 0.1,
      textColor: [17, 24, 39],
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [229, 231, 235],
      textColor: [17, 24, 39],
      fontStyle: "bold",
      halign: "center",
      valign: "middle",
      fontSize: 8.5,
    },
    alternateRowStyles: {
      fillColor: [250, 250, 250],
    },
    columnStyles: {
      0: { halign: "center", cellWidth: 8 },
      1: { halign: "left", cellWidth: 28 },
      2: { halign: "center", cellWidth: 16, font: "courier", fontStyle: "bold" },
      3: { halign: "left", cellWidth: 16 },
      4: { halign: "left", cellWidth: 45 },
      5: { halign: "center", cellWidth: 10 },
      6: { halign: "right", cellWidth: 16 },
      7: { halign: "center", cellWidth: 13 },
      8: { halign: "right", cellWidth: 20 },
      9: { halign: "right", cellWidth: 20 },
      10: { halign: "right", cellWidth: 20 },
      11: { halign: "center", cellWidth: 22 },
      12: { halign: "left", cellWidth: 24 },
    },
    didParseCell: (data: CellHookData) => {
      if (data.section !== "body") return;
      const rowIdx = data.row.index;
      const colIdx = data.column.index;
      const meta = rowsMeta[rowIdx];
      if (!meta) return;

      // Coluna 10 = MARGEM
      if (colIdx === 10) {
        if (meta.margemTone === "neg") {
          data.cell.styles.fillColor = RGB.marginNegBg;
          data.cell.styles.textColor = RGB.marginNegFg;
          data.cell.styles.fontStyle = "bold";
        } else if (meta.margemTone === "good") {
          data.cell.styles.fillColor = RGB.marginGoodBg;
          data.cell.styles.textColor = RGB.marginGoodFg;
          data.cell.styles.fontStyle = "bold";
        }
      }

      // Coluna 11 = STATUS
      if (colIdx === 11) {
        if (meta.statusTone === "disponivel") {
          data.cell.styles.fillColor = RGB.statusDisponivelBg;
          data.cell.styles.textColor = RGB.statusDisponivelFg;
          data.cell.styles.fontStyle = "bold";
        } else if (meta.statusTone === "faltaDoc") {
          data.cell.styles.fillColor = RGB.statusFaltaDocBg;
          data.cell.styles.textColor = RGB.statusFaltaDocFg;
          data.cell.styles.fontStyle = "bold";
        } else if (meta.statusTone === "bloqueado") {
          data.cell.styles.fillColor = RGB.statusBloqueadoBg;
          data.cell.styles.textColor = RGB.statusBloqueadoFg;
          data.cell.styles.fontStyle = "bold";
        }
      }

      // Coluna 12 = LOCALIZAÇÃO
      if (colIdx === 12) {
        if (meta.patioCategoria === "prep") {
          data.cell.styles.fillColor = RGB.patioPrepBg;
        } else if (meta.patioCategoria === "transito") {
          data.cell.styles.fillColor = RGB.patioTransitoBg;
        } else if (meta.patioCategoria === "oficina") {
          data.cell.styles.fillColor = RGB.patioOficinaBg;
        } else if (meta.patioCategoria === "bloqueado") {
          data.cell.styles.fillColor = RGB.patioBloqueadoBg;
        }
      }
    },
    didDrawPage: () => {
      const pageStr = `Página ${doc.getCurrentPageInfo().pageNumber}`;
      doc.setFontSize(8);
      doc.setTextColor(107, 114, 128);
      doc.setFont("helvetica", "normal");
      doc.text(pageStr, pageWidth - marginLR, pageHeight - 6, { align: "right" });
      doc.text(
        `Navesa Mesa — Relatório Gerencial — ${fmtDataBR()}`,
        marginLR,
        pageHeight - 6,
      );
    },
  });

  // ─── Bloco TOTALIZADORES em página nova (page break) ───
  doc.addPage();

  // Header da página de totalizadores
  doc.setFillColor(30, 64, 175);
  doc.rect(0, 0, pageWidth, 14, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("TOTALIZADORES", pageWidth / 2, 9.5, { align: "center" });

  doc.setFillColor(243, 244, 246);
  doc.rect(0, 14, pageWidth, 8, "F");
  doc.setTextColor(17, 24, 39);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text(`Data: ${fmtDataBR()}`, marginLR, metaY);
  doc.text(
    `Loja: ${filtroLoja === "all" ? "TODAS" : filtroLoja}`,
    segWidth + marginLR,
    metaY,
  );
  doc.text(`Total de veículos: ${veiculos.length}`, segWidth * 2 + marginLR, metaY);

  type LinhaTotalizador = {
    label: string;
    valor: string;
    alerta?: boolean;
    destaque?: "ok" | "warn";
  };

  const fmtMoneyExact = (v: number): string =>
    `R$ ${Math.round(v).toLocaleString("pt-BR")}`;

  const linhas: LinhaTotalizador[] = [
    { label: "Total de veículos", valor: String(tot.totalVeiculos) },
    {
      label: "Veículos DISPONÍVEIS pra venda",
      valor: `${tot.qtDisponivel} (${tot.pctDisponivel.toFixed(1)}%)`,
      destaque: "ok",
    },
    {
      label: "Veículos com falta de documento",
      valor: `${tot.qtFaltaDoc} (${tot.pctFaltaDoc.toFixed(1)}%)`,
      destaque: "warn",
    },
    { label: "Capital travado (Σ entrada)", valor: fmtMoneyExact(tot.capitalTravado) },
    { label: "Valor de mercado (Σ venda)", valor: fmtMoneyExact(tot.valorMercado) },
    { label: "Margem potencial total", valor: fmtMoneyExact(tot.margemPotencial) },
    {
      label: "Margem média %",
      valor: tot.margemMediaPct != null ? `${tot.margemMediaPct.toFixed(1)}%` : "—",
    },
    {
      label: "KM médio da frota",
      valor:
        tot.kmMedio != null
          ? `${Math.round(tot.kmMedio).toLocaleString("pt-BR")} km`
          : "—",
    },
    {
      label: "Dias pátio médio",
      valor:
        tot.diasPatioMedio != null
          ? `${Math.round(tot.diasPatioMedio).toLocaleString("pt-BR")} dias`
          : "—",
    },
    {
      label: "Veículos com 60+ dias parados (inclui 90+)",
      valor: `${tot.qtMais60} (${tot.pctMais60.toFixed(1)}%)`,
    },
    {
      label: "Veículos com 90+ dias parados",
      valor: `${tot.qtMais90} (${tot.pctMais90.toFixed(1)}%)`,
    },
    {
      label: "Veículos com margem negativa",
      valor: `${tot.qtMargemNeg} (${tot.pctMargemNeg.toFixed(1)}%)`,
      alerta: tot.qtMargemNeg > 0,
    },
  ];

  // Render via autoTable (uma "tabela" só com 2 colunas, sem head)
  type LinhaBodyRaw = { label: string; valor: string };
  const bodyTot: LinhaBodyRaw[] = linhas.map((l) => ({
    label: l.label + (l.alerta ? "  !!" : ""),
    valor: l.valor,
  }));

  autoTable(doc, {
    startY: 28,
    margin: { left: marginLR, right: marginLR, top: 28, bottom: 14 },
    body: bodyTot.map((l) => [l.label, l.valor]),
    theme: "grid",
    showHead: "never",
    styles: {
      fontSize: 11,
      cellPadding: 3,
      lineColor: [209, 213, 219],
      lineWidth: 0.15,
      textColor: [17, 24, 39],
      fontStyle: "bold",
    },
    columnStyles: {
      0: { halign: "left", cellWidth: 180 },
      1: { halign: "right" },
    },
    didParseCell: (data: CellHookData) => {
      const rowIdx = data.row.index;
      const colIdx = data.column.index;
      const linha = linhas[rowIdx];
      if (!linha) return;

      // Label (col 0) com fundo cinza claro
      if (colIdx === 0) {
        data.cell.styles.fillColor = [243, 244, 246];
      }

      // Cor por destaque/alerta
      if (linha.alerta) {
        if (colIdx === 1) data.cell.styles.fillColor = RGB.marginNegBg;
        data.cell.styles.textColor = RGB.alertFg;
      } else if (linha.destaque === "ok") {
        if (colIdx === 1) data.cell.styles.fillColor = RGB.statusDisponivelBg;
        data.cell.styles.textColor = RGB.statusDisponivelFg;
      } else if (linha.destaque === "warn") {
        if (colIdx === 1) data.cell.styles.fillColor = RGB.statusFaltaDocBg;
        data.cell.styles.textColor = RGB.statusFaltaDocFg;
      } else {
        if (colIdx === 1) data.cell.styles.fillColor = [243, 244, 246];
      }
    },
    didDrawPage: () => {
      const pageStr = `Página ${doc.getCurrentPageInfo().pageNumber}`;
      doc.setFontSize(8);
      doc.setTextColor(107, 114, 128);
      doc.setFont("helvetica", "normal");
      doc.text(pageStr, pageWidth - marginLR, pageHeight - 6, { align: "right" });
      doc.text(
        `Navesa Mesa — Relatório Gerencial — ${fmtDataBR()}`,
        marginLR,
        pageHeight - 6,
      );
    },
  });

  const ab = doc.output("arraybuffer");
  return new Blob([ab], { type: "application/pdf" });
}

// ═══════════════════════════════════════════════════════════════════════════
// DOWNLOAD (browser)
// ═══════════════════════════════════════════════════════════════════════════

export async function baixarRelatorioGerencialPdf(
  input: RelatorioGerencialPdfInput,
): Promise<void> {
  const blob = await gerarRelatorioGerencialPdf(input);
  const url = URL.createObjectURL(blob);
  const fileName = `relatorio-gerencial-estoque-${todayISO()}.pdf`;
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
