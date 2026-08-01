/**
 * Export PDF do relatório "Carros em anúncio" (Story 1.2).
 *
 * Paisagem A4, paginado (showHead: "everyPage"), valores formatados em BRL
 * centavo-perfect. Respeita o filtro ativo (caller passa a lista já filtrada).
 * Lista vazia → PDF com aviso "nenhum resultado" (não lança erro). Carro
 * incompleto → margem "indisponível" (nunca R$ 0).
 *
 * jsPDF + jspdf-autotable (mesma stack do relatorio-gerencial-estoque-pdf.ts).
 */

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { CarroAnuncioItem } from "@/lib/repasses/relatorio-anuncio";

const INDISPONIVEL = "indisponível";

function fmtDataBR(): string {
  const a = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(a.getDate())}/${p(a.getMonth() + 1)}/${a.getFullYear()} ${p(a.getHours())}:${p(a.getMinutes())}`;
}

/** BRL centavo-perfect sem depender de locale exótico. */
function fmtBRL(v: number | null): string {
  if (v == null) return INDISPONIVEL;
  return `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(v: number | null): string {
  if (v == null) return INDISPONIVEL;
  return `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function fmtInt(v: number | null): string {
  return v == null ? "—" : v.toLocaleString("pt-BR");
}

export function gerarRelatorioAnuncioPdf(itens: ReadonlyArray<CarroAnuncioItem>): Blob {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginLR = 8;

  // Faixa de título
  doc.setFillColor(30, 64, 175);
  doc.rect(0, 0, pageWidth, 14, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("CARROS EM ANÚNCIO — REPASSE", pageWidth / 2, 9.5, { align: "center" });

  // Meta
  doc.setFillColor(243, 244, 246);
  doc.rect(0, 14, pageWidth, 8, "F");
  doc.setTextColor(17, 24, 39);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text(`Gerado em: ${fmtDataBR()}`, marginLR, 19.5);
  doc.text(`Total: ${itens.length} veículo${itens.length === 1 ? "" : "s"}`, pageWidth / 2, 19.5, {
    align: "center",
  });
  doc.text("Respeita o filtro ativo", pageWidth - marginLR, 19.5, { align: "right" });

  if (itens.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(12);
    doc.setTextColor(107, 114, 128);
    doc.text("Nenhum resultado para o filtro atual.", pageWidth / 2, 40, { align: "center" });
    return doc.output("blob");
  }

  const body: string[][] = itens.map((it, idx) => [
    String(idx + 1),
    it.placa,
    it.modelo,
    it.anoLabel,
    fmtInt(it.km),
    fmtBRL(it.custoReal),
    fmtBRL(it.valorMinimo),
    fmtBRL(it.valorComprePor),
    it.diasNoRepasse == null ? "—" : String(it.diasNoRepasse),
    fmtBRL(it.fipe),
    String(it.interessados),
    it.incompleto ? INDISPONIVEL : fmtBRL(it.margemMinimoValor),
    it.incompleto ? INDISPONIVEL : fmtPct(it.margemMinimoPct),
    it.incompleto ? INDISPONIVEL : fmtBRL(it.margemComPorValor),
    it.incompleto ? INDISPONIVEL : fmtPct(it.margemComPorPct),
  ]);

  autoTable(doc, {
    startY: 25,
    margin: { left: marginLR, right: marginLR, top: 25, bottom: 12 },
    head: [
      [
        "#",
        "PLACA",
        "MODELO",
        "ANO",
        "KM",
        "CUSTO REAL",
        "MÍNIMO",
        "COMPRE POR",
        "DIAS",
        "FIPE/WEB",
        "INTER.",
        "MARG. MÍN R$",
        "MÍN %",
        "MARG. C/POR R$",
        "C/POR %",
      ],
    ],
    body,
    showHead: "everyPage",
    theme: "grid",
    styles: {
      fontSize: 7.5,
      cellPadding: 1.2,
      lineColor: [209, 213, 219],
      lineWidth: 0.1,
      textColor: [17, 24, 39],
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [59, 130, 246],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      halign: "center",
      valign: "middle",
      fontSize: 7.5,
    },
    alternateRowStyles: { fillColor: [243, 244, 246] },
    columnStyles: {
      0: { halign: "center", cellWidth: 7 },
      1: { halign: "center", cellWidth: 18, font: "courier", fontStyle: "bold" },
      2: { halign: "left", cellWidth: 40 },
      3: { halign: "center", cellWidth: 16 },
      4: { halign: "right", cellWidth: 16 },
      5: { halign: "right", cellWidth: 22 },
      6: { halign: "right", cellWidth: 22 },
      7: { halign: "right", cellWidth: 22 },
      8: { halign: "center", cellWidth: 12 },
      9: { halign: "right", cellWidth: 20 },
      10: { halign: "center", cellWidth: 13 },
      11: { halign: "right", cellWidth: 24 },
      12: { halign: "right", cellWidth: 15 },
      13: { halign: "right", cellWidth: 26 },
      14: { halign: "right", cellWidth: 15 },
    },
  });

  return doc.output("blob");
}
