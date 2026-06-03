/**
 * EXPORT ANÁLISE NAVESA — VERSÃO PDF (RESUMIDA)
 *
 * IMPORTANTE: essa é a versão **resumida** da Análise Navesa.
 * O XLSX completo (analise-navesa.ts) tem 38 colunas — inviável em PDF.
 * Aqui usamos 9 colunas-chave por venda + página de capa com KPIs + página
 * final com bloco "KPIs DA MESA" detalhado.
 *
 * Estrutura:
 *   Página 1 — Capa: KPIs principais (resumo executivo)
 *   Página 2..N — Tabela simplificada (SEQ / Data / Loja / Marca / Modelo / Placa /
 *                Venda / Margem R$ / Margem %)
 *   Última página — KPIs DA MESA detalhado (6 blocos espelhando o XLSX)
 *
 * A versão completa (com todas as 38 colunas, custos detalhados, FIPE, comissão,
 * impostos etc.) continua disponível pelo botão "Exportar XLSX".
 */

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { CellHookData, Color } from "jspdf-autotable";
import type { VendaParsed } from "@/lib/parsers/nbs-vendas-xlsx";
import type { CustoDetalhado } from "@/lib/parsers/nbs-custos-xls";
import { indexarClientes, chaveCliente } from "@/lib/analytics/clientes";

// ═══════════════════════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════════════════════

export type AnaliseNavesaPdfInput = {
  vendas: VendaParsed[];
  todasVendas: VendaParsed[];
  custosPorPlaca: Record<string, CustoDetalhado>;
  empresa: string;
  dataDe: string;
  dataAte: string;
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtDateBR(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1].slice(2)}`;
}

function fmtDateBRFull(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("pt-BR");
}

function fmtMoney(value: number | null | undefined): string {
  if (value == null) return "—";
  return `R$ ${Math.round(value).toLocaleString("pt-BR")}`;
}

function fmtMoneyExact(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtPct(n: number, d: number): string {
  return d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "0.0%";
}

// ═══════════════════════════════════════════════════════════════════════════
// FONTE DE AQUISIÇÃO (espelho do XLSX)
// ═══════════════════════════════════════════════════════════════════════════

function getValorAquisicao(v: VendaParsed, c: CustoDetalhado | undefined): number | null {
  if (c && c.nota_fabrica_taxa_icms > 0) return c.nota_fabrica_taxa_icms;
  if (v.total_nota_fabrica != null && v.total_nota_fabrica > 0) return v.total_nota_fabrica;
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// LOJISTA (espelho do XLSX)
// ═══════════════════════════════════════════════════════════════════════════

const TERMOS_LOJISTA = [
  "LTDA",
  "VEICULOS",
  "AUTOMOVEIS",
  "AUTOMÓVEIS",
  "MOTORS",
  "COMERCIO",
  "COMÉRCIO",
  "LOCACAO",
  "LOCAÇÃO",
  "RODOCAR",
  "AUTOFINANCE",
  "MULTIMARCAS",
] as const;

function detectarLojista(v: VendaParsed, qtCompras: number): boolean {
  const nome = (v.cliente_nome ?? "").toUpperCase();
  if (TERMOS_LOJISTA.some((t) => nome.includes(t))) return true;
  if (v.cliente_tipo === "PJ" && qtCompras >= 4) return true;
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// AGREGAÇÕES — calcula tudo de uma vez (KPIs principais + detalhados)
// ═══════════════════════════════════════════════════════════════════════════

type KpisAgregados = {
  totalVendas: number;
  totValorVenda: number;
  totValorAquisicao: number;
  totGanhosIndiretos: number;
  totCustoReal: number;
  totMargemBruta: number;
  totDespOficina: number;
  totForplan: number;
  totImpostos: number;
  totComissao: number;
  totCustoTotal: number;
  totMargemLiq: number;
  totCustoAcumulado: number;
  ticketMedio: number;
  margemBrutaMedia: number;
  margemLiqMedia: number;
  comissaoMedia: number;
  pctBrutaPond: number;
  pctLiqPond: number;
  // Dias de pátio
  diasMedio: number;
  diasMin: number;
  diasMax: number;
  totDias: number;
  qtDias60Plus: number;
  qtDias90Plus: number;
  // Perfil clientes
  qtLojistaSim: number;
  qtPessoaFisica: number;
  qtTrade: number;
  qtPJ: number;
  qtPF: number;
  // Top performers
  topLoja: { nome: string; qt: number; fat: number } | null;
  topVendedor: { nome: string; qt: number } | null;
  topMarca: { nome: string; qt: number; fat: number } | null;
  topModelo: { nome: string; qt: number } | null;
  // Alertas
  qtMargemLiqNegativa: number;
  qtComCustoDetalhado: number;
};

function calcularAgregados(
  vendas: VendaParsed[],
  todasVendas: VendaParsed[],
  custosPorPlaca: Record<string, CustoDetalhado>,
): KpisAgregados {
  const clientesIndex = indexarClientes(todasVendas);

  let totValorVenda = 0;
  let totValorAquisicao = 0;
  let totGanhosIndiretos = 0;
  let totCustoReal = 0;
  let totMargemBruta = 0;
  let totDespOficina = 0;
  let totForplan = 0;
  let totImpostos = 0;
  let totComissao = 0;
  let totCustoTotal = 0;
  let totMargemLiq = 0;
  let totCustoAcumulado = 0;

  const diasEstoqueArr: number[] = [];
  let qtDias60Plus = 0;
  let qtDias90Plus = 0;

  let qtLojistaSim = 0;
  let qtPessoaFisica = 0;
  let qtTrade = 0;
  let qtPJ = 0;
  let qtPF = 0;
  let qtMargemLiqNegativa = 0;
  let qtComCustoDetalhado = 0;

  const qtPorLoja = new Map<string, number>();
  const fatPorLoja = new Map<string, number>();
  const qtPorVendedor = new Map<string, number>();
  const qtPorMarca = new Map<string, number>();
  const fatPorMarca = new Map<string, number>();
  const qtPorModelo = new Map<string, number>();

  for (const v of vendas) {
    const c = custosPorPlaca[v.placa];
    const valorVenda = v.valor_venda ?? 0;
    const valorAq = getValorAquisicao(v, c);

    if (valorVenda > 0) totValorVenda += valorVenda;
    if (valorAq != null) totValorAquisicao += valorAq;

    const ganhosIndiretos = c?.ganhos_indiretos ?? 0;
    totGanhosIndiretos += ganhosIndiretos;

    if (valorAq != null) {
      const custoReal = valorAq - ganhosIndiretos;
      totCustoReal += custoReal;

      if (valorVenda > 0) {
        const margemBruta = valorVenda - custoReal;
        totMargemBruta += margemBruta;

        if (c != null || v.comissao_vendedor != null) {
          const oficina = c?.despesas_oficina ?? 0;
          const forplan = c?.forplan ?? 0;
          const impostos = c?.impostos ?? 0;
          const comissao = c ? c.comissoes : v.comissao_vendedor ?? 0;
          const custoTotal = oficina + forplan + impostos + comissao;
          totCustoTotal += custoTotal;
          const margemLiq = margemBruta - custoTotal;
          totMargemLiq += margemLiq;
          if (margemLiq < 0) qtMargemLiqNegativa++;
        }
      }
    }

    if (c) {
      totDespOficina += c.despesas_oficina;
      totForplan += c.forplan;
      totImpostos += c.impostos;
      totComissao += c.comissoes;
      totCustoAcumulado += c.custo_total;
      qtComCustoDetalhado++;
    } else {
      if (v.comissao_vendedor != null) totComissao += v.comissao_vendedor;
      if (valorAq != null) totCustoAcumulado += valorAq;
    }

    if (v.dias_estoque != null) {
      diasEstoqueArr.push(v.dias_estoque);
      if (v.dias_estoque > 60) qtDias60Plus++;
      if (v.dias_estoque > 90) qtDias90Plus++;
    }

    // Cliente recorrência → lojista
    const chave = chaveCliente(v);
    const totalCompras = clientesIndex.get(chave)?.totalCompras ?? 1;
    const lojistaFlag = detectarLojista(v, totalCompras);
    if (lojistaFlag) qtLojistaSim++;
    else qtPessoaFisica++;

    if (v.placa_troca) qtTrade++;
    if (v.cliente_tipo === "PJ") qtPJ++;
    else if (v.cliente_tipo === "PF") qtPF++;

    const lojaNome = v.empresa_nome ?? "—";
    qtPorLoja.set(lojaNome, (qtPorLoja.get(lojaNome) ?? 0) + 1);
    if (valorVenda > 0) {
      fatPorLoja.set(lojaNome, (fatPorLoja.get(lojaNome) ?? 0) + valorVenda);
    }
    const vendedorNome = v.vendedor_nome ?? "—";
    qtPorVendedor.set(vendedorNome, (qtPorVendedor.get(vendedorNome) ?? 0) + 1);
    const marcaNome = v.marca ?? "—";
    qtPorMarca.set(marcaNome, (qtPorMarca.get(marcaNome) ?? 0) + 1);
    if (valorVenda > 0) {
      fatPorMarca.set(marcaNome, (fatPorMarca.get(marcaNome) ?? 0) + valorVenda);
    }
    const modeloNome = v.modelo ?? "—";
    qtPorModelo.set(modeloNome, (qtPorModelo.get(modeloNome) ?? 0) + 1);
  }

  const total = vendas.length;
  const diasMedio =
    diasEstoqueArr.length > 0
      ? diasEstoqueArr.reduce((s, n) => s + n, 0) / diasEstoqueArr.length
      : 0;
  const diasMin = diasEstoqueArr.length > 0 ? Math.min(...diasEstoqueArr) : 0;
  const diasMax = diasEstoqueArr.length > 0 ? Math.max(...diasEstoqueArr) : 0;
  const totDias = diasEstoqueArr.reduce((s, n) => s + n, 0);

  const topBy = (m: Map<string, number>): { nome: string; qt: number } | null => {
    let best: { nome: string; qt: number } | null = null;
    for (const [k, val] of m) {
      if (!best || val > best.qt) best = { nome: k, qt: val };
    }
    return best;
  };

  const topLojaBase = topBy(qtPorLoja);
  const topMarcaBase = topBy(qtPorMarca);

  return {
    totalVendas: total,
    totValorVenda,
    totValorAquisicao,
    totGanhosIndiretos,
    totCustoReal,
    totMargemBruta,
    totDespOficina,
    totForplan,
    totImpostos,
    totComissao,
    totCustoTotal,
    totMargemLiq,
    totCustoAcumulado,
    ticketMedio: total > 0 ? totValorVenda / total : 0,
    margemBrutaMedia: total > 0 ? totMargemBruta / total : 0,
    margemLiqMedia: total > 0 ? totMargemLiq / total : 0,
    comissaoMedia: total > 0 ? totComissao / total : 0,
    pctBrutaPond: totValorVenda > 0 ? totMargemBruta / totValorVenda : 0,
    pctLiqPond: totValorVenda > 0 ? totMargemLiq / totValorVenda : 0,
    diasMedio,
    diasMin,
    diasMax,
    totDias,
    qtDias60Plus,
    qtDias90Plus,
    qtLojistaSim,
    qtPessoaFisica,
    qtTrade,
    qtPJ,
    qtPF,
    topLoja: topLojaBase
      ? {
          ...topLojaBase,
          fat: fatPorLoja.get(topLojaBase.nome) ?? 0,
        }
      : null,
    topVendedor: topBy(qtPorVendedor),
    topMarca: topMarcaBase
      ? {
          ...topMarcaBase,
          fat: fatPorMarca.get(topMarcaBase.nome) ?? 0,
        }
      : null,
    topModelo: topBy(qtPorModelo),
    qtMargemLiqNegativa,
    qtComCustoDetalhado,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// GERAÇÃO
// ═══════════════════════════════════════════════════════════════════════════

export async function gerarAnaliseNavesaPdf(input: AnaliseNavesaPdfInput): Promise<Blob> {
  const { vendas, todasVendas, custosPorPlaca, empresa, dataDe, dataAte } = input;
  const kpis = calcularAgregados(vendas, todasVendas, custosPorPlaca);
  const clientesIndex = indexarClientes(todasVendas);

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginLR = 10;

  const empresaTxt = empresa || "TODAS";
  const periodoTxt =
    dataDe || dataAte
      ? `${dataDe ? fmtDateBR(dataDe) : "INÍCIO"} a ${dataAte ? fmtDateBR(dataAte) : fmtDateBR(todayISO())}`
      : "TODO PERÍODO";

  // ═══════════════════════════════════════════════════════════════════════
  // PÁGINA 1 — CAPA com KPIs principais
  // ═══════════════════════════════════════════════════════════════════════

  // Header
  doc.setFillColor(55, 65, 81); // #374151
  doc.rect(0, 0, pageWidth, 14, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("USADOS — ANÁLISE NAVESA", pageWidth / 2, 9.5, { align: "center" });

  // Subheader
  doc.setFillColor(243, 244, 246);
  doc.rect(0, 14, pageWidth, 10, "F");
  doc.setTextColor(17, 24, 39);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text(`Loja: ${empresaTxt}`, marginLR, 20.5);
  doc.text(`Período: ${periodoTxt}`, pageWidth / 2, 20.5, { align: "center" });
  doc.text(`Total de vendas: ${kpis.totalVendas}`, pageWidth - marginLR, 20.5, {
    align: "right",
  });

  // Aviso de versão resumida
  doc.setFontSize(9);
  doc.setFont("helvetica", "italic");
  doc.setTextColor(107, 114, 128);
  doc.text(
    "Versão resumida — para análise detalhada com todas as 38 colunas (custos, FIPE, comissão, impostos), exporte o XLSX.",
    pageWidth / 2,
    29,
    { align: "center" },
  );

  // Título de seção
  let y = 36;
  doc.setFillColor(31, 41, 55);
  doc.rect(marginLR, y, pageWidth - marginLR * 2, 8, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("RESUMO EXECUTIVO", pageWidth / 2, y + 5.5, { align: "center" });
  y += 12;

  // Grid 2x3 de KPI cards (largura útil ~ pageWidth - 2*margin = 277mm → 3 colunas de ~92mm)
  type KpiCard = {
    titulo: string;
    valor: string;
    sub?: string;
    tone?: "default" | "good" | "warn" | "bad";
  };
  const cards: KpiCard[] = [
    { titulo: "Faturamento total", valor: fmtMoneyExact(kpis.totValorVenda) },
    { titulo: "Margem bruta total", valor: fmtMoneyExact(kpis.totMargemBruta) },
    {
      titulo: "Margem líquida total",
      valor: fmtMoneyExact(kpis.totMargemLiq),
      tone: kpis.totMargemLiq < 0 ? "bad" : kpis.totMargemLiq > 0 ? "good" : "default",
    },
    {
      titulo: "Ticket médio",
      valor: fmtMoneyExact(kpis.ticketMedio),
      sub: `${kpis.totalVendas} venda(s)`,
    },
    {
      titulo: "% Margem bruta (pond.)",
      valor: `${(kpis.pctBrutaPond * 100).toFixed(2)}%`,
    },
    {
      titulo: "% Margem líquida (pond.)",
      valor: `${(kpis.pctLiqPond * 100).toFixed(2)}%`,
      tone:
        kpis.pctLiqPond < 0
          ? "bad"
          : kpis.pctLiqPond >= 0.1
            ? "good"
            : "default",
    },
  ];

  const cardW = (pageWidth - marginLR * 2 - 4) / 3; // 2mm de gap entre cards
  const cardH = 28;

  cards.forEach((card, idx) => {
    const col = idx % 3;
    const row = Math.floor(idx / 3);
    const x = marginLR + col * (cardW + 2);
    const yy = y + row * (cardH + 4);

    // Fundo
    let fill: Color = [255, 255, 255];
    let strokeColor: Color = [209, 213, 219];
    let textColor: Color = [17, 24, 39];
    if (card.tone === "good") {
      fill = [209, 250, 229];
      strokeColor = [6, 95, 70];
      textColor = [6, 95, 70];
    } else if (card.tone === "bad") {
      fill = [254, 226, 226];
      strokeColor = [153, 27, 27];
      textColor = [153, 27, 27];
    } else if (card.tone === "warn") {
      fill = [254, 243, 199];
      strokeColor = [146, 64, 14];
      textColor = [146, 64, 14];
    }
    doc.setFillColor(...(fill as [number, number, number]));
    doc.setDrawColor(...(strokeColor as [number, number, number]));
    doc.setLineWidth(0.2);
    doc.rect(x, yy, cardW, cardH, "FD");

    // Título
    doc.setTextColor(107, 114, 128);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(card.titulo, x + 3, yy + 6);

    // Valor
    doc.setTextColor(...(textColor as [number, number, number]));
    doc.setFontSize(15);
    doc.setFont("helvetica", "bold");
    doc.text(card.valor, x + 3, yy + 17);

    // Sub
    if (card.sub) {
      doc.setTextColor(107, 114, 128);
      doc.setFontSize(8);
      doc.setFont("helvetica", "italic");
      doc.text(card.sub, x + 3, yy + 24);
    }
  });

  y += 2 * cardH + 4 + 6;

  // Linha resumo abaixo dos cards
  doc.setTextColor(17, 24, 39);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(
    `Capital travado: ${fmtMoneyExact(kpis.totValorAquisicao)}   |   Ganhos indiretos: ${fmtMoneyExact(kpis.totGanhosIndiretos)}   |   Despesas operacionais: ${fmtMoneyExact(kpis.totDespOficina + kpis.totForplan + kpis.totImpostos + kpis.totComissao)}`,
    pageWidth / 2,
    y,
    { align: "center" },
  );

  // Footer pageNumber na capa
  doc.setFontSize(8);
  doc.setTextColor(107, 114, 128);
  doc.setFont("helvetica", "normal");
  doc.text("Página 1", pageWidth - marginLR, pageHeight - 6, { align: "right" });
  doc.text(`Navesa Mesa — Análise Navesa — ${fmtDateBR(todayISO())}`, marginLR, pageHeight - 6);

  // ═══════════════════════════════════════════════════════════════════════
  // PÁGINA 2..N — Tabela simplificada de vendas
  // ═══════════════════════════════════════════════════════════════════════
  doc.addPage();

  // Header da página de tabela
  doc.setFillColor(55, 65, 81);
  doc.rect(0, 0, pageWidth, 14, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text("VENDAS DETALHADAS", pageWidth / 2, 9.5, { align: "center" });

  doc.setFillColor(243, 244, 246);
  doc.rect(0, 14, pageWidth, 8, "F");
  doc.setTextColor(17, 24, 39);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text(`Loja: ${empresaTxt}  |  Período: ${periodoTxt}`, marginLR, 19.5);
  doc.text(`Total: ${kpis.totalVendas} vendas`, pageWidth - marginLR, 19.5, {
    align: "right",
  });

  // Calcula margem por linha pra colorir
  type LinhaMeta = { margemPct: number | null };
  const linhasMeta: LinhaMeta[] = vendas.map((v) => {
    const c = custosPorPlaca[v.placa];
    const valorVenda = v.valor_venda ?? 0;
    const valorAq = getValorAquisicao(v, c);
    const ganhos = c?.ganhos_indiretos ?? 0;
    if (valorAq == null || valorVenda <= 0) return { margemPct: null };
    const custoReal = valorAq - ganhos;
    const margemBruta = valorVenda - custoReal;
    const oficina = c?.despesas_oficina ?? 0;
    const forplan = c?.forplan ?? 0;
    const impostos = c?.impostos ?? 0;
    const comissao = c ? c.comissoes : v.comissao_vendedor ?? 0;
    if (c == null && v.comissao_vendedor == null) {
      return { margemPct: margemBruta / valorVenda };
    }
    const custoTotal = oficina + forplan + impostos + comissao;
    const margemLiq = margemBruta - custoTotal;
    return { margemPct: margemLiq / valorVenda };
  });

  const body: string[][] = vendas.map((v, idx) => {
    const c = custosPorPlaca[v.placa];
    const valorVenda = v.valor_venda ?? 0;
    const valorAq = getValorAquisicao(v, c);
    const ganhos = c?.ganhos_indiretos ?? 0;
    let margemValor = "—";
    let margemPctStr = "—";
    if (valorAq != null && valorVenda > 0) {
      const custoReal = valorAq - ganhos;
      const margemBruta = valorVenda - custoReal;
      const oficina = c?.despesas_oficina ?? 0;
      const forplan = c?.forplan ?? 0;
      const impostos = c?.impostos ?? 0;
      const comissao = c ? c.comissoes : v.comissao_vendedor ?? 0;
      let margem = margemBruta;
      if (c != null || v.comissao_vendedor != null) {
        margem = margemBruta - (oficina + forplan + impostos + comissao);
      }
      margemValor = fmtMoney(margem);
      margemPctStr = `${((margem / valorVenda) * 100).toFixed(1)}%`;
    }
    return [
      String(idx + 1),
      fmtDateBRFull(v.data_venda),
      v.empresa_nome ?? "—",
      v.marca ?? "—",
      v.modelo,
      v.placa,
      fmtMoney(valorVenda > 0 ? valorVenda : null),
      margemValor,
      margemPctStr,
      v.vendedor_nome ?? "—",
    ];
  });

  autoTable(doc, {
    startY: 25,
    margin: { left: marginLR, right: marginLR, top: 25, bottom: 14 },
    head: [
      [
        "SEQ",
        "DATA",
        "LOJA",
        "MARCA",
        "MODELO",
        "PLACA",
        "VENDA",
        "MARGEM R$",
        "MARGEM %",
        "VENDEDOR",
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
    alternateRowStyles: { fillColor: [250, 250, 250] },
    columnStyles: {
      0: { halign: "center", cellWidth: 10 },
      1: { halign: "center", cellWidth: 18 },
      2: { halign: "left", cellWidth: 26 },
      3: { halign: "left", cellWidth: 18 },
      4: { halign: "left", cellWidth: 60 },
      5: { halign: "center", cellWidth: 18, font: "courier", fontStyle: "bold" },
      6: { halign: "right", cellWidth: 22 },
      7: { halign: "right", cellWidth: 22 },
      8: { halign: "right", cellWidth: 16 },
      9: { halign: "left", cellWidth: 40 },
    },
    didParseCell: (data: CellHookData) => {
      if (data.section !== "body") return;
      const rowIdx = data.row.index;
      const colIdx = data.column.index;
      const meta = linhasMeta[rowIdx];
      if (!meta) return;
      // Colore cols 7 e 8 (Margem R$ e Margem %)
      if ((colIdx === 7 || colIdx === 8) && meta.margemPct != null) {
        if (meta.margemPct < 0) {
          data.cell.styles.fillColor = [254, 226, 226];
          data.cell.styles.textColor = [153, 27, 27];
          data.cell.styles.fontStyle = "bold";
        } else if (meta.margemPct >= 0.1) {
          data.cell.styles.fillColor = [209, 250, 229];
          data.cell.styles.textColor = [6, 95, 70];
          data.cell.styles.fontStyle = "bold";
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
        `Navesa Mesa — Análise Navesa — ${fmtDateBR(todayISO())}`,
        marginLR,
        pageHeight - 6,
      );
    },
  });

  // ═══════════════════════════════════════════════════════════════════════
  // ÚLTIMA PÁGINA — KPIs DA MESA (bloco detalhado)
  // ═══════════════════════════════════════════════════════════════════════
  doc.addPage();

  doc.setFillColor(55, 65, 81);
  doc.rect(0, 0, pageWidth, 14, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("KPIs DA MESA", pageWidth / 2, 9.5, { align: "center" });

  doc.setFillColor(243, 244, 246);
  doc.rect(0, 14, pageWidth, 8, "F");
  doc.setTextColor(17, 24, 39);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text(`Loja: ${empresaTxt}  |  Período: ${periodoTxt}`, marginLR, 19.5);
  doc.text(`Total: ${kpis.totalVendas} vendas`, pageWidth - marginLR, 19.5, {
    align: "right",
  });

  // Bloco de KPIs em 2 colunas (3 sub-blocos esquerda + 3 direita)
  type KpiLinha =
    | { kind: "header"; label: string }
    | { kind: "line"; label: string; valor: string; extra?: string }
    | { kind: "blank" };

  const bloco1: KpiLinha[] = [
    { kind: "header", label: "TOTAIS GERAIS" },
    { kind: "line", label: "Total de vendas", valor: String(kpis.totalVendas) },
    { kind: "line", label: "Faturamento total", valor: fmtMoneyExact(kpis.totValorVenda) },
    {
      kind: "line",
      label: "Custo total acumulado",
      valor: fmtMoneyExact(kpis.totCustoAcumulado),
    },
    { kind: "line", label: "Margem bruta total", valor: fmtMoneyExact(kpis.totMargemBruta) },
    { kind: "line", label: "Margem líquida total", valor: fmtMoneyExact(kpis.totMargemLiq) },
    {
      kind: "line",
      label: "Ganhos indiretos total",
      valor: fmtMoneyExact(kpis.totGanhosIndiretos),
    },
    {
      kind: "line",
      label: "Despesas operacionais total",
      valor: fmtMoneyExact(
        kpis.totDespOficina + kpis.totForplan + kpis.totImpostos + kpis.totComissao,
      ),
    },
    { kind: "blank" },
  ];

  const bloco2: KpiLinha[] = [
    { kind: "header", label: "INDICADORES MÉDIOS" },
    { kind: "line", label: "Ticket médio", valor: fmtMoneyExact(kpis.ticketMedio) },
    {
      kind: "line",
      label: "Margem bruta média (R$)",
      valor: fmtMoneyExact(kpis.margemBrutaMedia),
    },
    {
      kind: "line",
      label: "Margem líquida média (R$)",
      valor: fmtMoneyExact(kpis.margemLiqMedia),
    },
    {
      kind: "line",
      label: "% Margem bruta (pond.)",
      valor: `${(kpis.pctBrutaPond * 100).toFixed(2)}%`,
    },
    {
      kind: "line",
      label: "% Margem líquida (pond.)",
      valor: `${(kpis.pctLiqPond * 100).toFixed(2)}%`,
    },
    { kind: "line", label: "Comissão média", valor: fmtMoneyExact(kpis.comissaoMedia) },
    { kind: "blank" },
  ];

  const bloco3: KpiLinha[] = [
    { kind: "header", label: "DIAS DE PÁTIO" },
    {
      kind: "line",
      label: "Total de dias acumulado",
      valor: `${kpis.totDias.toLocaleString("pt-BR")} dias`,
    },
    { kind: "line", label: "Dias médio", valor: kpis.diasMedio.toFixed(1) },
    { kind: "line", label: "Mínimo / Máximo", valor: `${kpis.diasMin} / ${kpis.diasMax}` },
    {
      kind: "line",
      label: "Vendas com mais de 60 dias",
      valor: String(kpis.qtDias60Plus),
      extra: fmtPct(kpis.qtDias60Plus, kpis.totalVendas),
    },
    {
      kind: "line",
      label: "Vendas com mais de 90 dias",
      valor: String(kpis.qtDias90Plus),
      extra: fmtPct(kpis.qtDias90Plus, kpis.totalVendas),
    },
  ];

  const bloco4: KpiLinha[] = [
    { kind: "header", label: "PERFIL DOS CLIENTES" },
    {
      kind: "line",
      label: "Vendas a Lojistas",
      valor: String(kpis.qtLojistaSim),
      extra: fmtPct(kpis.qtLojistaSim, kpis.totalVendas),
    },
    {
      kind: "line",
      label: "Vendas a Pessoa Física",
      valor: String(kpis.qtPessoaFisica),
      extra: fmtPct(kpis.qtPessoaFisica, kpis.totalVendas),
    },
    {
      kind: "line",
      label: "Vendas com Trade-in",
      valor: String(kpis.qtTrade),
      extra: fmtPct(kpis.qtTrade, kpis.totalVendas),
    },
    {
      kind: "line",
      label: "Vendas PJ",
      valor: String(kpis.qtPJ),
      extra: fmtPct(kpis.qtPJ, kpis.totalVendas),
    },
    {
      kind: "line",
      label: "Vendas PF",
      valor: String(kpis.qtPF),
      extra: fmtPct(kpis.qtPF, kpis.totalVendas),
    },
    { kind: "blank" },
  ];

  const bloco5: KpiLinha[] = [
    { kind: "header", label: "TOP PERFORMERS" },
    {
      kind: "line",
      label: "Loja com mais vendas",
      valor: kpis.topLoja ? `${kpis.topLoja.nome} (${kpis.topLoja.qt})` : "—",
      extra: kpis.topLoja ? fmtMoneyExact(kpis.topLoja.fat) : undefined,
    },
    {
      kind: "line",
      label: "Vendedor com mais vendas",
      valor: kpis.topVendedor ? `${kpis.topVendedor.nome} (${kpis.topVendedor.qt})` : "—",
    },
    {
      kind: "line",
      label: "Marca com mais vendas",
      valor: kpis.topMarca ? `${kpis.topMarca.nome} (${kpis.topMarca.qt})` : "—",
      extra: kpis.topMarca ? fmtMoneyExact(kpis.topMarca.fat) : undefined,
    },
    {
      kind: "line",
      label: "Modelo mais vendido",
      valor: kpis.topModelo ? `${kpis.topModelo.nome} (${kpis.topModelo.qt})` : "—",
    },
    { kind: "blank" },
  ];

  const bloco6: KpiLinha[] = [
    { kind: "header", label: "ALERTAS" },
    {
      kind: "line",
      label: "Vendas com margem líquida negativa",
      valor: String(kpis.qtMargemLiqNegativa),
      extra: fmtPct(kpis.qtMargemLiqNegativa, kpis.totalVendas),
    },
    {
      kind: "line",
      label: "Vendas com mais de 90 dias de pátio",
      valor: String(kpis.qtDias90Plus),
      extra: fmtPct(kpis.qtDias90Plus, kpis.totalVendas),
    },
    {
      kind: "line",
      label: "Cobertura de custos detalhados",
      valor: fmtPct(kpis.qtComCustoDetalhado, kpis.totalVendas),
    },
  ];

  const esquerda = [...bloco1, ...bloco2, ...bloco3];
  const direita = [...bloco4, ...bloco5, ...bloco6];
  const maxLinhas = Math.max(esquerda.length, direita.length);

  // Layout manual: 2 colunas com largura ~ (pageWidth/2 - marginLR - 4)
  const colW = (pageWidth - marginLR * 2 - 6) / 2;
  const startY = 28;
  const lineH = 6;

  const drawLinha = (
    linha: KpiLinha,
    x: number,
    yy: number,
    w: number,
  ): number => {
    if (linha.kind === "blank") return lineH * 0.6;
    if (linha.kind === "header") {
      doc.setFillColor(209, 213, 219);
      doc.rect(x, yy, w, lineH + 1, "F");
      doc.setDrawColor(156, 163, 175);
      doc.setLineWidth(0.1);
      doc.rect(x, yy, w, lineH + 1, "S");
      doc.setTextColor(17, 24, 39);
      doc.setFontSize(10.5);
      doc.setFont("helvetica", "bold");
      doc.text(linha.label, x + 2, yy + 4.8);
      return lineH + 1;
    }
    // line
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(229, 231, 235);
    doc.setLineWidth(0.1);
    doc.rect(x, yy, w, lineH, "S");
    doc.setTextColor(17, 24, 39);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(linha.label, x + 2, yy + 4.2);
    // valor (negrito) + extra (italic em cinza)
    doc.setFont("helvetica", "bold");
    const valorText = linha.valor;
    const extraText = linha.extra ?? "";
    const extraWidth = extraText
      ? doc.getStringUnitWidth(extraText) * 8 * 0.352778
      : 0;
    const valorWidth = doc.getStringUnitWidth(valorText) * 9 * 0.352778;
    const rightEdge = x + w - 2;
    doc.text(valorText, rightEdge - extraWidth - (extraText ? 2 : 0), yy + 4.2, {
      align: "right",
    });
    if (extraText) {
      doc.setFont("helvetica", "italic");
      doc.setTextColor(107, 114, 128);
      doc.setFontSize(8);
      doc.text(extraText, rightEdge, yy + 4.2, { align: "right" });
    }
    // suppress unused warning
    void valorWidth;
    return lineH;
  };

  let yL = startY;
  let yR = startY;
  for (let i = 0; i < maxLinhas; i++) {
    if (i < esquerda.length) {
      const used = drawLinha(esquerda[i], marginLR, yL, colW);
      yL += used;
    }
    if (i < direita.length) {
      const used = drawLinha(direita[i], marginLR + colW + 6, yR, colW);
      yR += used;
    }
  }

  // Footer da última página
  doc.setFontSize(8);
  doc.setTextColor(107, 114, 128);
  doc.setFont("helvetica", "normal");
  doc.text(
    `Página ${doc.getCurrentPageInfo().pageNumber}`,
    pageWidth - marginLR,
    pageHeight - 6,
    { align: "right" },
  );
  doc.text(
    `Navesa Mesa — Análise Navesa — ${fmtDateBR(todayISO())}`,
    marginLR,
    pageHeight - 6,
  );

  // suppress unused
  void clientesIndex;

  const ab = doc.output("arraybuffer");
  return new Blob([ab], { type: "application/pdf" });
}

// ═══════════════════════════════════════════════════════════════════════════
// DOWNLOAD (browser)
// ═══════════════════════════════════════════════════════════════════════════

export async function baixarAnaliseNavesaPdf(input: AnaliseNavesaPdfInput): Promise<void> {
  const blob = await gerarAnaliseNavesaPdf(input);
  const url = URL.createObjectURL(blob);
  const sanitize = (s: string): string => s.replace(/[^\d-]/g, "");
  const de = sanitize(input.dataDe) || "inicio";
  const ate = sanitize(input.dataAte) || sanitize(todayISO());
  const fileName = `analise-navesa-${de}-a-${ate}.pdf`;
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
