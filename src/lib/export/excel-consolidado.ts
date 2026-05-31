/**
 * EXPORT EXCEL CONSOLIDADO
 *
 * Gera 1 .xlsx com 4 abas (Resumo, Estoque, Vendas, Custos) para Marcos compartilhar
 * com contador/sócio. Substitui o envio de 3 relatórios brutos do NBS (cada um com 400+
 * colunas) por um único arquivo limpo, com cálculos já aplicados (classe Auto Avaliar,
 * FIPE matched, diagnóstico, margem real).
 *
 * Tudo client-side (workbook gerado em memória, baixado como Blob). Sem dependências
 * novas — usa a mesma `xlsx` (SheetJS) já presente nos parsers.
 */

import * as XLSX from "xlsx";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";
import type { VendaParsed } from "@/lib/parsers/nbs-vendas-xlsx";
import type { CustoDetalhado } from "@/lib/parsers/nbs-custos-xls";
import type { BatchResult } from "@/lib/fipe/batch";
import type { StatusCautelar } from "@/lib/inventory/cautelar";
import type { LojaInfo } from "@/lib/store/inventory";
import {
  classificarVeiculo,
  contarPorModelo,
  CANAL_LABEL,
} from "@/lib/pricing/classificacao";
import {
  computarDiagnosticoLista,
  DIAGNOSTICO_LABEL,
  type DiagnosticoStatus,
} from "@/lib/pricing/diagnostico";
import { calcularMedianasKm } from "@/lib/pricing/medianas";
import { sumarioGlobal, margemPorLoja } from "@/lib/analytics/insights";
import { calcMargemVenda } from "@/lib/analytics/margem";
import { CAUTELAR_LABEL } from "@/lib/inventory/cautelar";

// ═══════════════════════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════════════════════

export type ExportInput = {
  veiculos: VeiculoParsed[];
  vendas: VendaParsed[];
  custosPorPlaca: Record<string, CustoDetalhado>;
  lojas: Record<number, LojaInfo>;
  fipeBatch: BatchResult | null;
  cautelares: Record<string, StatusCautelar>;
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "";
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

function round2(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function round4(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n * 10000) / 10000;
}

function nomeLoja(lojas: Record<number, LojaInfo>, cod: number, fallback?: string | null): string {
  const nome = lojas[cod]?.nome?.trim();
  if (nome) return nome;
  if (fallback?.trim()) return fallback.trim();
  return `Loja ${cod}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// ABA "Resumo" — KPIs + cards de atenção (formato dashboard)
// ═══════════════════════════════════════════════════════════════════════════

type Row = (string | number | null)[];

function montarResumo(input: ExportInput): Row[] {
  const { veiculos, vendas, custosPorPlaca, lojas, fipeBatch, cautelares } = input;
  const hoje = new Date();
  const rows: Row[] = [];

  rows.push(["NAVESA MESA - RELATÓRIO CONSOLIDADO"]);
  rows.push([`Data: ${fmtDate(hoje)}`]);
  rows.push([]);

  // ── SUMÁRIO ──
  rows.push(["== SUMÁRIO =="]);
  if (vendas.length > 0) {
    const s = sumarioGlobal(vendas, custosPorPlaca);
    rows.push(["Total de vendas", s.qt]);
    rows.push(["Faturamento (R$)", round2(s.faturamento)]);
    rows.push(["Custo total (R$)", round2(s.custo)]);
    rows.push(["Margem REAL (R$)", round2(s.margem)]);
    rows.push(["Margem REAL (%)", round2(s.margemPct)]);
    rows.push(["Ganhos Indiretos (bônus) (R$)", round2(s.ganhosIndiretos)]);
    rows.push(["Margem SEM bônus (R$)", round2(s.margemSemBonus)]);
    rows.push(["Depende de bônus?", s.dependeDeBonus ? "SIM (alerta crítico)" : "Não"]);
    rows.push(["Cobertura custo oficial NBS (%)", round2(s.cobertura * 100)]);
  } else {
    rows.push(["(sem vendas carregadas)"]);
  }
  rows.push([]);

  // ── POR LOJA ──
  rows.push(["== POR LOJA =="]);
  if (vendas.length > 0) {
    rows.push(["Loja", "Vendas", "Faturamento (R$)", "Margem (R$)", "Margem (%)", "Ganhos Indiretos (R$)"]);
    for (const l of margemPorLoja(vendas, custosPorPlaca)) {
      rows.push([
        l.loja,
        l.qt,
        round2(l.faturamento),
        round2(l.margem),
        round2(l.margemPct),
        round2(l.ganhosIndiretos),
      ]);
    }
  } else {
    rows.push(["(sem vendas)"]);
  }
  rows.push([]);

  // ── ESTOQUE ATUAL ──
  rows.push(["== ESTOQUE ATUAL =="]);
  if (veiculos.length > 0) {
    const custoTotal = veiculos.reduce((s, v) => s + (v.valor_aquisicao ?? 0), 0);
    const parados60 = veiculos.filter((v) => (v.dias_patio ?? 0) > 60);
    const parados180 = veiculos.filter((v) => (v.dias_patio ?? 0) > 180);
    const custo60 = parados60.reduce((s, v) => s + (v.valor_aquisicao ?? 0), 0);
    const custo180 = parados180.reduce((s, v) => s + (v.valor_aquisicao ?? 0), 0);

    rows.push(["Total de carros", veiculos.length]);
    rows.push(["Capital travado (custo aquisição) (R$)", round2(custoTotal)]);
    rows.push(["Carros parados +60d", parados60.length]);
    rows.push(["Valor parado +60d (R$)", round2(custo60)]);
    rows.push(["Carros parados +180d", parados180.length]);
    rows.push(["Valor parado +180d (R$)", round2(custo180)]);
  } else {
    rows.push(["(sem estoque carregado)"]);
  }
  rows.push([]);

  // ── CARROS EM ATENÇÃO (Diagnóstico) ──
  rows.push(["== CARROS EM ATENÇÃO (Diagnóstico) =="]);
  if (veiculos.length > 0) {
    const contagem = contarPorModelo(veiculos);
    const classesPorChassi = new Map<string, "A" | "B" | "C" | "D" | "E">();
    for (const v of veiculos) {
      const c = classificarVeiculo(v, {
        contagemPorModelo: contagem,
        cautelar: cautelares[v.chassi] ?? null,
      });
      classesPorChassi.set(v.chassi, c.classe);
    }
    const medianas = calcularMedianasKm(veiculos, vendas);
    const fipeRecord: Record<string, number> = {};
    if (fipeBatch) {
      for (const [chassi, item] of Object.entries(fipeBatch.items)) {
        fipeRecord[chassi] = item.precoFipe;
      }
    }
    const diagMap = computarDiagnosticoLista({
      veiculos,
      classesPorChassi,
      fipeBatch: fipeRecord,
      cautelaresPorChassi: cautelares,
      medianasKmPorChave: medianas,
    });

    // "Margem na mesa" só faz sentido onde há prejuízo confirmado ou dinheiro deixado:
    // - subprecificado / subprecificado_grave: desvio negativo do preço esperado
    // - negativo: prejuízo confirmado (preço < custo)
    // Outros status (acima_mercado, parado, coerente, repasse, sem_dados) mostram
    // só a quantidade — a coluna fica vazia.
    const statusComMargemNaMesa = new Set<DiagnosticoStatus>([
      "subprecificado",
      "subprecificado_grave",
      "negativo",
    ]);

    // Contagem por status + soma de desvio (só pros status onde aplica)
    const buckets = new Map<DiagnosticoStatus, { qt: number; soma: number }>();
    for (const r of diagMap.values()) {
      const b = buckets.get(r.status) ?? { qt: 0, soma: 0 };
      b.qt++;
      if (statusComMargemNaMesa.has(r.status)) {
        b.soma += Math.abs(r.desvioReais);
      }
      buckets.set(r.status, b);
    }

    rows.push(["Status", "Quantidade", "Margem na mesa (R$)"]);
    const ordem: DiagnosticoStatus[] = [
      "subprecificado_grave",
      "subprecificado",
      "acima_mercado",
      "negativo",
      "parado",
      "coerente",
      "repasse",
      "sem_dados",
    ];
    for (const status of ordem) {
      const b = buckets.get(status);
      if (!b || b.qt === 0) continue;
      const margemNaMesa = statusComMargemNaMesa.has(status) ? round2(b.soma) : null;
      rows.push([DIAGNOSTICO_LABEL[status], b.qt, margemNaMesa]);
    }
  } else {
    rows.push(["(sem estoque)"]);
  }

  // ── LOJAS CADASTRADAS ──
  rows.push([]);
  rows.push(["== LOJAS CADASTRADAS =="]);
  const lojasList = Object.values(lojas).filter((l) => l.nome.trim()).sort((a, b) => a.cod_empresa - b.cod_empresa);
  if (lojasList.length > 0) {
    rows.push(["Cód", "Nome", "Cidade"]);
    for (const l of lojasList) {
      rows.push([l.cod_empresa, l.nome, l.cidade]);
    }
  } else {
    rows.push(["(nenhuma loja com nome cadastrado)"]);
  }

  return rows;
}

// ═══════════════════════════════════════════════════════════════════════════
// ABA "Estoque"
// ═══════════════════════════════════════════════════════════════════════════

type LinhaEstoque = {
  Loja: string;
  Placa: string;
  Chassi: string;
  Marca: string;
  Modelo: string;
  "Ano Modelo": number | null;
  Cor: string;
  Combustível: string;
  KM: number | null;
  "Pátio": string;
  "Dias Pátio": number | null;
  "Data Entrada": string;
  "Custo Aquisição (R$)": number | null;
  "Custo Total (R$)": number | null;
  "Preço Venda Pedido (R$)": number | null;
  "FIPE (R$)": number | null;
  "vs FIPE (%)": number | null;
  "Classe Auto Avaliar": string;
  Canal: string;
  Cautelar: string;
  "Diagnóstico Status": string;
  "Preço Esperado (R$)": number | null;
};

function montarEstoque(input: ExportInput): LinhaEstoque[] {
  const { veiculos, vendas, custosPorPlaca, lojas, fipeBatch, cautelares } = input;
  if (veiculos.length === 0) return [];

  // Pre-computa: contagem por modelo + classes + medianas + diagnósticos
  const contagem = contarPorModelo(veiculos);
  const classesPorChassi = new Map<string, "A" | "B" | "C" | "D" | "E">();
  const classifsPorChassi = new Map<string, ReturnType<typeof classificarVeiculo>>();
  for (const v of veiculos) {
    const c = classificarVeiculo(v, {
      contagemPorModelo: contagem,
      cautelar: cautelares[v.chassi] ?? null,
    });
    classesPorChassi.set(v.chassi, c.classe);
    classifsPorChassi.set(v.chassi, c);
  }
  const medianas = calcularMedianasKm(veiculos, vendas);
  const fipeRecord: Record<string, number> = {};
  if (fipeBatch) {
    for (const [chassi, item] of Object.entries(fipeBatch.items)) {
      fipeRecord[chassi] = item.precoFipe;
    }
  }
  const diagMap = computarDiagnosticoLista({
    veiculos,
    classesPorChassi,
    fipeBatch: fipeRecord,
    cautelaresPorChassi: cautelares,
    medianasKmPorChave: medianas,
  });

  const out: LinhaEstoque[] = [];
  for (const v of veiculos) {
    const classif = classifsPorChassi.get(v.chassi);
    const diag = diagMap.get(v.chassi);
    const fipeItem = fipeBatch?.items[v.chassi];
    const fipe = fipeItem?.precoFipe ?? null;
    const custo = custosPorPlaca[v.placa];

    let vsFipePct: number | null = null;
    if (fipe != null && v.preco_venda != null && fipe > 0) {
      vsFipePct = round4(((v.preco_venda - fipe) / fipe) * 100);
    }

    const cautelarStatus = cautelares[v.chassi] ?? null;

    out.push({
      Loja: nomeLoja(lojas, v.cod_empresa),
      Placa: v.placa,
      Chassi: v.chassi,
      Marca: v.marca ?? "",
      Modelo: v.modelo,
      "Ano Modelo": v.ano_modelo,
      Cor: v.cor_externa ?? "",
      Combustível: v.combustivel ?? "",
      KM: v.km,
      "Pátio": v.patio,
      "Dias Pátio": v.dias_patio,
      "Data Entrada": fmtDate(v.data_entrada),
      "Custo Aquisição (R$)": round2(v.valor_aquisicao),
      "Custo Total (R$)": round2(v.custo_total ?? custo?.custo_total ?? null),
      "Preço Venda Pedido (R$)": round2(v.preco_venda),
      "FIPE (R$)": round2(fipe),
      "vs FIPE (%)": vsFipePct,
      "Classe Auto Avaliar": classif?.classe ?? "",
      Canal: classif ? CANAL_LABEL[classif.canal] : "",
      Cautelar: cautelarStatus ? CAUTELAR_LABEL[cautelarStatus] : "—",
      "Diagnóstico Status": diag ? DIAGNOSTICO_LABEL[diag.status] : "",
      "Preço Esperado (R$)": round2(diag?.precoEsperado ?? null),
    });
  }

  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// ABA "Vendas"
// ═══════════════════════════════════════════════════════════════════════════

type LinhaVenda = {
  Loja: string;
  "Data Venda": string;
  Placa: string;
  Chassi: string;
  Marca: string;
  Modelo: string;
  "Ano Modelo": number | null;
  KM: number | null;
  Cor: string;
  Cliente: string;
  "Cliente Cidade": string;
  "Cliente UF": string;
  "Cliente Tipo": string;
  Vendedor: string;
  "Vendedor que Recebeu": string;
  "Dias Estoque": number | null;
  "Valor Vendido (R$)": number | null;
  "Preço Tabela (R$)": number | null;
  "Custo Total Final (R$)": number | null;
  "Custo Floor Plan (R$)": number | null;
  "Total Nota Fábrica (R$)": number | null;
  "Margem Real (R$)": number | null;
  "Margem (%)": number | null;
  "Comissão Vendedor (R$)": number | null;
};

function montarVendas(input: ExportInput): LinhaVenda[] {
  const { vendas, custosPorPlaca, lojas } = input;
  const out: LinhaVenda[] = [];

  for (const v of vendas) {
    const custo = custosPorPlaca[v.placa];
    // Usa a equação canônica (mesma de todas as telas) — evita divergir do resto do app
    // se NBS tiver inconsistência entre `custo.margem_real` e `valor_vendido − custo_total`.
    const { margem, margemPct } = calcMargemVenda(v, custosPorPlaca);

    out.push({
      Loja: nomeLoja(lojas, v.cod_empresa, v.empresa_nome),
      "Data Venda": fmtDate(v.data_venda),
      Placa: v.placa,
      Chassi: v.chassi,
      Marca: v.marca ?? "",
      Modelo: v.modelo,
      "Ano Modelo": v.ano_modelo,
      KM: v.km,
      Cor: v.cor_externa ?? "",
      Cliente: v.cliente_nome,
      "Cliente Cidade": v.cliente_cidade ?? "",
      "Cliente UF": v.cliente_uf ?? "",
      "Cliente Tipo": v.cliente_tipo ?? "",
      Vendedor: v.vendedor_nome ?? v.vendedor_codigo ?? "",
      "Vendedor que Recebeu": v.vendedor_recebeu ?? "",
      "Dias Estoque": v.dias_estoque,
      "Valor Vendido (R$)": round2(v.valor_venda),
      "Preço Tabela (R$)": round2(v.preco_venda_tabela),
      "Custo Total Final (R$)": round2(custo?.custo_total ?? v.custo_total_final),
      "Custo Floor Plan (R$)": round2(v.custo_floor_plan),
      "Total Nota Fábrica (R$)": round2(v.total_nota_fabrica),
      "Margem Real (R$)": round2(margem),
      "Margem (%)": round4(margemPct),
      "Comissão Vendedor (R$)": round2(v.comissao_vendedor),
    });
  }

  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// ABA "Custos"
// ═══════════════════════════════════════════════════════════════════════════

type LinhaCusto = {
  Placa: string;
  Modelo: string;
  "Data Fatura": string;
  "Data Venda": string;
  "Dias Pátio": number | null;
  "Nota Fábrica Líquida (R$)": number | null;
  "Despesas Oficina (R$)": number | null;
  "Frete + ICMS Frete (R$)": number | null;
  "Forplan (R$)": number | null;
  "Impostos (R$)": number | null;
  "Comissões (R$)": number | null;
  "Ganhos Indiretos (R$)": number | null;
  "ADM (R$)": number | null;
  "Despesas Gerais (R$)": number | null;
  "Custo Total (R$)": number | null;
  "Valor Vendido (R$)": number | null;
  "Margem Real (R$)": number | null;
  "Margem (%)": number | null;
};

function montarCustos(input: ExportInput): LinhaCusto[] {
  const out: LinhaCusto[] = [];
  for (const c of Object.values(input.custosPorPlaca)) {
    out.push({
      Placa: c.placa,
      Modelo: c.modelo,
      "Data Fatura": fmtDate(c.data_fatura),
      "Data Venda": fmtDate(c.data_venda),
      "Dias Pátio": c.dias_patio,
      "Nota Fábrica Líquida (R$)": round2(c.nota_fabrica_taxa_icms),
      "Despesas Oficina (R$)": round2(c.despesas_oficina),
      "Frete + ICMS Frete (R$)": round2(c.frete_icms_frete),
      "Forplan (R$)": round2(c.forplan),
      "Impostos (R$)": round2(c.impostos),
      "Comissões (R$)": round2(c.comissoes),
      "Ganhos Indiretos (R$)": round2(c.ganhos_indiretos),
      "ADM (R$)": round2(c.adm),
      "Despesas Gerais (R$)": round2(c.despesas_gerais),
      "Custo Total (R$)": round2(c.custo_total),
      "Valor Vendido (R$)": round2(c.valor_vendido),
      "Margem Real (R$)": round2(c.margem_real),
      "Margem (%)": round4(c.margem_pct),
    });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// MONTAGEM DO WORKBOOK
// ═══════════════════════════════════════════════════════════════════════════

/** Define larguras de coluna a partir das chaves da primeira linha. */
function aplicarLarguras(ws: XLSX.WorkSheet, larguras: number[]): void {
  ws["!cols"] = larguras.map((w) => ({ wch: w }));
}

export function gerarExcelConsolidado(input: ExportInput): Blob {
  const wb = XLSX.utils.book_new();

  // Aba 1: Resumo
  const resumoData = montarResumo(input);
  const wsResumo = XLSX.utils.aoa_to_sheet(resumoData);
  aplicarLarguras(wsResumo, [40, 22, 22, 18, 18, 22]);
  XLSX.utils.book_append_sheet(wb, wsResumo, "Resumo");

  // Aba 2: Estoque
  const estoqueData = montarEstoque(input);
  const wsEstoque = XLSX.utils.json_to_sheet(estoqueData);
  aplicarLarguras(wsEstoque, [
    25, // Loja
    10, // Placa
    20, // Chassi
    14, // Marca
    32, // Modelo
    11, // Ano Modelo
    14, // Cor
    14, // Combustível
    10, // KM
    14, // Pátio
    11, // Dias Pátio
    13, // Data Entrada
    18, // Custo Aquisição
    18, // Custo Total
    20, // Preço Venda Pedido
    15, // FIPE
    11, // vs FIPE %
    18, // Classe Auto Avaliar
    11, // Canal
    14, // Cautelar
    22, // Diagnóstico Status
    18, // Preço Esperado
  ]);
  XLSX.utils.book_append_sheet(wb, wsEstoque, "Estoque");

  // Aba 3: Vendas
  const vendasData = montarVendas(input);
  const wsVendas = XLSX.utils.json_to_sheet(vendasData);
  aplicarLarguras(wsVendas, [
    25, // Loja
    12, // Data Venda
    10, // Placa
    20, // Chassi
    14, // Marca
    32, // Modelo
    11, // Ano Modelo
    10, // KM
    14, // Cor
    32, // Cliente
    18, // Cliente Cidade
    8,  // Cliente UF
    11, // Cliente Tipo
    28, // Vendedor
    28, // Vendedor que Recebeu
    11, // Dias Estoque
    18, // Valor Vendido
    18, // Preço Tabela
    20, // Custo Total Final
    18, // Custo Floor Plan
    20, // Total Nota Fábrica
    18, // Margem Real
    11, // Margem %
    20, // Comissão Vendedor
  ]);
  XLSX.utils.book_append_sheet(wb, wsVendas, "Vendas");

  // Aba 4: Custos
  const custosData = montarCustos(input);
  const wsCustos = XLSX.utils.json_to_sheet(custosData);
  aplicarLarguras(wsCustos, [
    10, // Placa
    32, // Modelo
    12, // Data Fatura
    12, // Data Venda
    11, // Dias Pátio
    22, // Nota Fábrica Líquida
    20, // Despesas Oficina
    22, // Frete + ICMS Frete
    14, // Forplan
    14, // Impostos
    14, // Comissões
    20, // Ganhos Indiretos
    12, // ADM
    20, // Despesas Gerais
    18, // Custo Total
    18, // Valor Vendido
    18, // Margem Real
    11, // Margem %
  ]);
  XLSX.utils.book_append_sheet(wb, wsCustos, "Custos");

  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new Blob([buf as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
