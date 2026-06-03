/**
 * EXPORT CONFERÊNCIA DE ESTOQUE FÍSICO — VERSÃO PDF
 *
 * Espelha 100% a estrutura do XLSX (conferencia-estoque.ts):
 *   - Paisagem A4
 *   - Header "CONFERÊNCIA DE ESTOQUE FÍSICO" + meta (Data, Loja, Total)
 *   - 11 colunas: # / LOJA / PLACA / CHASSI / VEÍCULO / ANO / KM / DIAS / AQUISIÇÃO / LOCALIZAÇÃO / ✓ CONFERIDO
 *   - Zebra de linhas
 *   - Header repete em cada página (showHead: "everyPage")
 *   - Rodapé final: Total + linha pra "Conferido por: ___" + "Assinatura: ___ Data: __/__/__"
 *   - Footer com número da página em todas as páginas
 */

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";

// jspdf-autotable injeta `lastAutoTable` na instância do jsPDF via plugin, mas
// a tipagem oficial não expõe esse campo. Augmentamos o módulo aqui (sem `as`).
declare module "jspdf" {
  interface jsPDF {
    lastAutoTable?: { finalY?: number };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════════════════════

export type ConferenciaEstoquePdfVeiculo = VeiculoParsed & {
  /** Nome da loja resolvido a partir do mapa de lojas. "—" se desconhecido. */
  empresa_nome: string;
};

export type ConferenciaEstoquePdfInput = {
  /** Veículos já filtrados (na ordem em que devem aparecer). */
  veiculos: ConferenciaEstoquePdfVeiculo[];
  /** Nome da loja filtrada na tela, ou "TODAS" se filtro = all. */
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

function fmtVeiculo(marca: string | null, modelo: string): string {
  return `${marca ?? ""} ${modelo}`.trim();
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
// GERAÇÃO
// ═══════════════════════════════════════════════════════════════════════════

export async function gerarConferenciaEstoquePdf(
  input: ConferenciaEstoquePdfInput,
): Promise<Blob> {
  const { veiculos, filtroLoja } = input;

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginLR = 10;

  // ─── Header faixa escura ───
  doc.setFillColor(31, 41, 55); // #1F2937 (titleBg do XLSX)
  doc.rect(0, 0, pageWidth, 14, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("CONFERÊNCIA DE ESTOQUE FÍSICO", pageWidth / 2, 9.5, { align: "center" });

  // ─── Meta (Data | Loja | Total) ───
  doc.setFillColor(243, 244, 246); // #F3F4F6 (metaBg)
  doc.rect(0, 14, pageWidth, 8, "F");
  doc.setTextColor(31, 41, 55);
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
  const body: string[][] = veiculos.map((v, idx) => [
    String(idx + 1),
    v.empresa_nome || "—",
    v.placa,
    v.chassi,
    fmtVeiculo(v.marca, v.modelo),
    fmtAno(v.ano_fabricacao, v.ano_modelo),
    fmtKm(v.km),
    v.dias_patio != null ? String(v.dias_patio) : "—",
    fmtMoney(v.valor_aquisicao),
    v.patio?.trim() || "—",
    "", // ✓ CONFERIDO (vazio pra marcação manual)
  ]);

  autoTable(doc, {
    startY: 25,
    margin: { left: marginLR, right: marginLR, top: 25, bottom: 14 },
    head: [
      [
        "#",
        "LOJA",
        "PLACA",
        "CHASSI",
        "VEÍCULO",
        "ANO",
        "KM",
        "DIAS PÁTIO",
        "AQUISIÇÃO",
        "LOCALIZAÇÃO",
        "✓ CONFERIDO",
      ],
    ],
    body,
    showHead: "everyPage",
    theme: "grid",
    styles: {
      fontSize: 8,
      cellPadding: 1.5,
      lineColor: [209, 213, 219], // #D1D5DB
      lineWidth: 0.1,
      textColor: [17, 24, 39],
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [229, 231, 235], // #E5E7EB
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
      1: { halign: "left", cellWidth: 32 },
      2: { halign: "center", cellWidth: 16, font: "courier", fontStyle: "bold" },
      3: { halign: "center", cellWidth: 32, font: "courier", fontSize: 7 },
      4: { halign: "left", cellWidth: 48 },
      5: { halign: "center", cellWidth: 14 },
      6: { halign: "right", cellWidth: 18 },
      7: { halign: "center", cellWidth: 14 },
      8: { halign: "right", cellWidth: 20 },
      9: { halign: "left", cellWidth: 28 },
      10: { halign: "center", cellWidth: 22 },
    },
    didDrawPage: () => {
      // Footer: número da página no rodapé
      const pageStr = `Página ${doc.getCurrentPageInfo().pageNumber}`;
      doc.setFontSize(8);
      doc.setTextColor(107, 114, 128); // #6B7280
      doc.setFont("helvetica", "normal");
      doc.text(pageStr, pageWidth - marginLR, pageHeight - 6, { align: "right" });
      doc.text(
        `Navesa Mesa — Conferência de Estoque — ${fmtDataBR()}`,
        marginLR,
        pageHeight - 6,
      );
    },
  });

  // ─── Rodapé final: Total + linhas de assinatura ───
  // jspdf-autotable injeta `lastAutoTable` (com finalY em mm) na instância — aumentamos o tipo acima.
  const finalY = doc.lastAutoTable?.finalY ?? 30;
  let cursorY = finalY + 8;

  // Se não cabe rodapé na página atual, abre nova
  if (cursorY > pageHeight - 35) {
    doc.addPage();
    cursorY = 25;
  }

  // Linha de total destacada
  doc.setFillColor(243, 244, 246);
  doc.rect(marginLR, cursorY, pageWidth - marginLR * 2, 8, "F");
  doc.setDrawColor(209, 213, 219);
  doc.rect(marginLR, cursorY, pageWidth - marginLR * 2, 8, "S");
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(17, 24, 39);
  doc.text(
    `Total: ${veiculos.length} veículo${veiculos.length === 1 ? "" : "s"}`,
    marginLR + 2,
    cursorY + 5.5,
  );
  cursorY += 16;

  // Conferido por: ____
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(
    "Conferido por: ____________________________________",
    marginLR + 2,
    cursorY,
  );
  cursorY += 10;

  // Assinatura: ____ Data: __/__/____
  doc.text(
    "Assinatura: ______________________________________   Data: ___/___/______",
    marginLR + 2,
    cursorY,
  );

  // ─── Output blob ───
  const ab = doc.output("arraybuffer");
  return new Blob([ab], { type: "application/pdf" });
}

// ═══════════════════════════════════════════════════════════════════════════
// DOWNLOAD (browser)
// ═══════════════════════════════════════════════════════════════════════════

export async function baixarConferenciaEstoquePdf(
  input: ConferenciaEstoquePdfInput,
): Promise<void> {
  const blob = await gerarConferenciaEstoquePdf(input);
  const url = URL.createObjectURL(blob);
  const fileName = `conferencia-estoque-${todayISO()}.pdf`;
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
