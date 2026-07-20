/**
 * INSIGHTS — Agregações operacionais sobre vendas + custos + estoque.
 *
 * Funções puras, deterministicas. Consumidas pela página /insights
 * e pelo chat IA como contexto. Não dependem de React.
 *
 * Cada função recebe os datasets crus e retorna estruturas serializáveis
 * (arrays/objetos/numbers) — sem Date, sem Map, sem class — pra poder
 * enviar pra API do chat sem perda.
 */

import type { VendaParsed } from "@/lib/parsers/nbs-vendas-xlsx";
import type { CustoDetalhado } from "@/lib/parsers/nbs-custos-xls";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";
import type { BatchResult } from "@/lib/fipe/batch";
import { calcularDesvioFipe, precoFipeConfiavel } from "@/lib/fipe/batch";
import { calcMargemVenda } from "./margem";
import { classificarVeiculo } from "@/lib/pricing/classificacao";
import type { StatusCautelar } from "@/lib/inventory/cautelar";

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

type CustosMap = Record<string, CustoDetalhado>;

function pctSafe(num: number, den: number): number {
  return den > 0 ? (num / den) * 100 : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// A) SUMÁRIO GLOBAL — KPIs principais + dependência de Ganhos Indiretos
// ─────────────────────────────────────────────────────────────────────────────

export type SumarioGlobal = {
  qt: number;
  faturamento: number;
  custo: number;
  margem: number;
  margemPct: number;
  ganhosIndiretos: number;
  /** Margem se cortassem os bônus de fábrica. */
  margemSemBonus: number;
  /** True se a operação depende dos bônus pra ser positiva. */
  dependeDeBonus: boolean;
  cobertura: number;
};

export function sumarioGlobal(
  vendas: VendaParsed[],
  custosPorPlaca: CustosMap,
): SumarioGlobal {
  let valor = 0,
    custo = 0,
    ganhos = 0,
    comOficial = 0;
  for (const v of vendas) {
    const m = calcMargemVenda(v, custosPorPlaca);
    valor += m.valor;
    custo += m.custo;
    if (m.fonte === "oficial" && m.componentes) {
      comOficial++;
      ganhos += m.componentes.ganhos_indiretos;
    }
  }
  const margem = valor - custo;
  return {
    qt: vendas.length,
    faturamento: valor,
    custo,
    margem,
    margemPct: pctSafe(margem, valor),
    ganhosIndiretos: ganhos,
    margemSemBonus: margem - ganhos,
    dependeDeBonus: ganhos > margem,
    cobertura: vendas.length > 0 ? comOficial / vendas.length : 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// B) MARGEM POR LOJA
// ─────────────────────────────────────────────────────────────────────────────

export type MargemPorLoja = {
  loja: string;
  qt: number;
  faturamento: number;
  custo: number;
  margem: number;
  margemPct: number;
  ganhosIndiretos: number;
  giroMedio: number;
};

export function margemPorLoja(
  vendas: VendaParsed[],
  custosPorPlaca: CustosMap,
): MargemPorLoja[] {
  const map = new Map<
    string,
    {
      qt: number;
      valor: number;
      custo: number;
      margem: number;
      ganhos: number;
      diasSoma: number;
      diasN: number;
    }
  >();
  for (const v of vendas) {
    const k = v.empresa_nome || `Loja ${v.cod_empresa}`;
    if (!map.has(k))
      map.set(k, { qt: 0, valor: 0, custo: 0, margem: 0, ganhos: 0, diasSoma: 0, diasN: 0 });
    const r = map.get(k)!;
    const m = calcMargemVenda(v, custosPorPlaca);
    r.qt++;
    r.valor += m.valor;
    r.custo += m.custo;
    r.margem += m.margem;
    if (m.componentes) r.ganhos += m.componentes.ganhos_indiretos;
    if (v.dias_estoque != null) {
      r.diasSoma += v.dias_estoque;
      r.diasN++;
    }
  }
  return [...map.entries()]
    .map(([loja, r]) => ({
      loja,
      qt: r.qt,
      faturamento: r.valor,
      custo: r.custo,
      margem: r.margem,
      margemPct: pctSafe(r.margem, r.valor),
      ganhosIndiretos: r.ganhos,
      giroMedio: r.diasN > 0 ? r.diasSoma / r.diasN : 0,
    }))
    .sort((a, b) => b.margem - a.margem);
}

// ─────────────────────────────────────────────────────────────────────────────
// C) MARGEM POR MARCA
// ─────────────────────────────────────────────────────────────────────────────

export type MargemPorMarca = {
  marca: string;
  qt: number;
  faturamento: number;
  margem: number;
  margemPct: number;
  ganhosIndiretos: number;
};

export function margemPorMarca(
  vendas: VendaParsed[],
  custosPorPlaca: CustosMap,
): MargemPorMarca[] {
  const map = new Map<
    string,
    { qt: number; valor: number; margem: number; ganhos: number }
  >();
  for (const v of vendas) {
    const k = (v.marca ?? "—").toUpperCase();
    if (!map.has(k)) map.set(k, { qt: 0, valor: 0, margem: 0, ganhos: 0 });
    const r = map.get(k)!;
    const m = calcMargemVenda(v, custosPorPlaca);
    r.qt++;
    r.valor += m.valor;
    r.margem += m.margem;
    if (m.componentes) r.ganhos += m.componentes.ganhos_indiretos;
  }
  return [...map.entries()]
    .map(([marca, r]) => ({
      marca,
      qt: r.qt,
      faturamento: r.valor,
      margem: r.margem,
      margemPct: pctSafe(r.margem, r.valor),
      ganhosIndiretos: r.ganhos,
    }))
    .sort((a, b) => b.qt - a.qt);
}

// ─────────────────────────────────────────────────────────────────────────────
// D) GIRO (dias_estoque) vs MARGEM — buckets
// ─────────────────────────────────────────────────────────────────────────────

export type GiroBucket = {
  faixa: string;
  diasMin: number;
  diasMax: number;
  qt: number;
  faturamento: number;
  margem: number;
  margemPct: number;
  margemPorUnidade: number;
};

const BUCKETS: { label: string; min: number; max: number }[] = [
  { label: "0-15 dias", min: 0, max: 15 },
  { label: "16-30 dias", min: 16, max: 30 },
  { label: "31-60 dias", min: 31, max: 60 },
  { label: "61-90 dias", min: 61, max: 90 },
  { label: "91-180 dias", min: 91, max: 180 },
  { label: "180+ dias", min: 181, max: Number.POSITIVE_INFINITY },
];

export function giroVsMargem(
  vendas: VendaParsed[],
  custosPorPlaca: CustosMap,
): GiroBucket[] {
  const acc = BUCKETS.map((b) => ({
    ...b,
    qt: 0,
    valor: 0,
    margem: 0,
  }));
  for (const v of vendas) {
    if (v.dias_estoque == null) continue;
    const m = calcMargemVenda(v, custosPorPlaca);
    for (const b of acc) {
      if (v.dias_estoque >= b.min && v.dias_estoque <= b.max) {
        b.qt++;
        b.valor += m.valor;
        b.margem += m.margem;
        break;
      }
    }
  }
  return acc.map((b) => ({
    faixa: b.label,
    diasMin: b.min,
    diasMax: b.max === Number.POSITIVE_INFINITY ? -1 : b.max,
    qt: b.qt,
    faturamento: b.valor,
    margem: b.margem,
    margemPct: pctSafe(b.margem, b.valor),
    margemPorUnidade: b.qt > 0 ? b.margem / b.qt : 0,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// E) MODELOS — top + piores margens
// ─────────────────────────────────────────────────────────────────────────────

export type MargemPorModelo = {
  modelo: string;
  qt: number;
  faturamento: number;
  margem: number;
  margemPct: number;
};

export function margemPorModelo(
  vendas: VendaParsed[],
  custosPorPlaca: CustosMap,
  opts: { minVendas?: number } = {},
): MargemPorModelo[] {
  const minQt = opts.minVendas ?? 3;
  const map = new Map<string, { qt: number; valor: number; margem: number }>();
  for (const v of vendas) {
    const k = (v.modelo ?? "—").trim().toUpperCase();
    if (!map.has(k)) map.set(k, { qt: 0, valor: 0, margem: 0 });
    const r = map.get(k)!;
    const m = calcMargemVenda(v, custosPorPlaca);
    r.qt++;
    r.valor += m.valor;
    r.margem += m.margem;
  }
  return [...map.entries()]
    .filter(([, r]) => r.qt >= minQt)
    .map(([modelo, r]) => ({
      modelo,
      qt: r.qt,
      faturamento: r.valor,
      margem: r.margem,
      margemPct: pctSafe(r.margem, r.valor),
    }))
    .sort((a, b) => a.margem - b.margem); // ascending: piores primeiro
}

// ─────────────────────────────────────────────────────────────────────────────
// F) TROCAS vs SEM TROCAS
// ─────────────────────────────────────────────────────────────────────────────

export type TrocasResumo = {
  comTroca: {
    qt: number;
    faturamento: number;
    margem: number;
    margemPct: number;
    margemPorUnidade: number;
    ticketMedio: number;
    ganhosIndiretos: number;
  };
  semTroca: {
    qt: number;
    faturamento: number;
    margem: number;
    margemPct: number;
    margemPorUnidade: number;
    ticketMedio: number;
    ganhosIndiretos: number;
  };
};

export function trocasVsSem(
  vendas: VendaParsed[],
  custosPorPlaca: CustosMap,
): TrocasResumo {
  const grupos = {
    troca: { qt: 0, valor: 0, margem: 0, ganhos: 0 },
    sem: { qt: 0, valor: 0, margem: 0, ganhos: 0 },
  };
  for (const v of vendas) {
    const g = v.placa_troca ? grupos.troca : grupos.sem;
    const m = calcMargemVenda(v, custosPorPlaca);
    g.qt++;
    g.valor += m.valor;
    g.margem += m.margem;
    if (m.componentes) g.ganhos += m.componentes.ganhos_indiretos;
  }
  const build = (g: typeof grupos.troca) => ({
    qt: g.qt,
    faturamento: g.valor,
    margem: g.margem,
    margemPct: pctSafe(g.margem, g.valor),
    margemPorUnidade: g.qt > 0 ? g.margem / g.qt : 0,
    ticketMedio: g.qt > 0 ? g.valor / g.qt : 0,
    ganhosIndiretos: g.ganhos,
  });
  return { comTroca: build(grupos.troca), semTroca: build(grupos.sem) };
}

// ─────────────────────────────────────────────────────────────────────────────
// G) VENDEDORES
// ─────────────────────────────────────────────────────────────────────────────

export type MargemPorVendedor = {
  vendedor: string;
  qt: number;
  faturamento: number;
  margem: number;
  margemPct: number;
  comissao: number;
};

export function margemPorVendedor(
  vendas: VendaParsed[],
  custosPorPlaca: CustosMap,
  opts: { minVendas?: number } = {},
): MargemPorVendedor[] {
  const minQt = opts.minVendas ?? 1;
  const map = new Map<
    string,
    { qt: number; valor: number; margem: number; comissao: number }
  >();
  for (const v of vendas) {
    const k = v.vendedor_nome || v.vendedor_codigo || "—";
    if (!map.has(k)) map.set(k, { qt: 0, valor: 0, margem: 0, comissao: 0 });
    const r = map.get(k)!;
    const m = calcMargemVenda(v, custosPorPlaca);
    r.qt++;
    r.valor += m.valor;
    r.margem += m.margem;
    r.comissao += v.comissao_vendedor ?? 0;
  }
  return [...map.entries()]
    .filter(([, r]) => r.qt >= minQt)
    .map(([vendedor, r]) => ({
      vendedor,
      qt: r.qt,
      faturamento: r.valor,
      margem: r.margem,
      margemPct: pctSafe(r.margem, r.valor),
      comissao: r.comissao,
    }))
    .sort((a, b) => b.margem - a.margem);
}

// ─────────────────────────────────────────────────────────────────────────────
// H) OUTLIERS — vendas individuais com maior lucro/prejuízo
// ─────────────────────────────────────────────────────────────────────────────

export type VendaOutlier = {
  placa: string;
  modelo: string;
  marca: string | null;
  valor: number;
  margem: number;
  margemPct: number;
  loja: string | null;
  vendedor: string | null;
};

export function outliers(
  vendas: VendaParsed[],
  custosPorPlaca: CustosMap,
  opts: { top?: number; modo?: "lucro" | "prejuizo" } = {},
): VendaOutlier[] {
  const top = opts.top ?? 10;
  const modo = opts.modo ?? "lucro";
  const lista = vendas.map((v) => {
    const m = calcMargemVenda(v, custosPorPlaca);
    return {
      placa: v.placa,
      modelo: v.modelo,
      marca: v.marca,
      valor: m.valor,
      margem: m.margem,
      margemPct: m.margemPct,
      loja: v.empresa_nome,
      vendedor: v.vendedor_nome,
    };
  });
  lista.sort((a, b) => (modo === "lucro" ? b.margem - a.margem : a.margem - b.margem));
  return lista.slice(0, top);
}

// ─────────────────────────────────────────────────────────────────────────────
// I) ESTOQUE EM RISCO — carros parados de modelos com histórico negativo
// ─────────────────────────────────────────────────────────────────────────────

export type EstoqueRiscoItem = {
  placa: string;
  modelo: string;
  marca: string | null;
  preco: number;
  margemHistoricaMedia: number;
  vendasHistoricas: number;
  diasNoPatio: number | null;
};

export type EstoqueRiscoResumo = {
  totalCarros: number;
  comHistorico: number;
  semHistorico: number;
  qtEmRisco: number;
  valorEmRisco: number;
  qtSeguro: number;
  valorSeguro: number;
  itens: EstoqueRiscoItem[];
};

export function estoqueEmRisco(
  veiculos: VeiculoParsed[],
  vendas: VendaParsed[],
  custosPorPlaca: CustosMap,
  opts: { topPiores?: number } = {},
): EstoqueRiscoResumo {
  const topPiores = opts.topPiores ?? 20;

  // Histórico médio de margem por modelo (normalizado uppercase)
  const hist = new Map<string, { qt: number; somaMargem: number }>();
  for (const v of vendas) {
    const k = (v.modelo ?? "—").trim().toUpperCase();
    if (!hist.has(k)) hist.set(k, { qt: 0, somaMargem: 0 });
    const r = hist.get(k)!;
    const m = calcMargemVenda(v, custosPorPlaca);
    r.qt++;
    r.somaMargem += m.margem;
  }

  let comHist = 0,
    semHist = 0,
    qtRisco = 0,
    valorRisco = 0,
    qtSeguro = 0,
    valorSeguro = 0;
  const itens: EstoqueRiscoItem[] = [];

  for (const veh of veiculos) {
    const k = (veh.modelo ?? "—").trim().toUpperCase();
    const h = hist.get(k);
    if (!h || h.qt === 0) {
      semHist++;
      continue;
    }
    comHist++;
    const media = h.somaMargem / h.qt;
    const custo = veh.valor_aquisicao ?? 0; // capital travado = custo de fábrica
    if (media < 0) {
      qtRisco++;
      valorRisco += custo;
      itens.push({
        placa: veh.placa ?? "—",
        modelo: veh.modelo ?? "—",
        marca: veh.marca ?? null,
        preco: veh.preco_venda ?? 0, // exibe preço pedido na lista
        margemHistoricaMedia: media,
        vendasHistoricas: h.qt,
        diasNoPatio: veh.dias_patio ?? null,
      });
    } else {
      qtSeguro++;
      valorSeguro += custo;
    }
  }

  itens.sort((a, b) => a.margemHistoricaMedia - b.margemHistoricaMedia);

  return {
    totalCarros: veiculos.length,
    comHistorico: comHist,
    semHistorico: semHist,
    qtEmRisco: qtRisco,
    valorEmRisco: valorRisco,
    qtSeguro,
    valorSeguro,
    itens: itens.slice(0, topPiores),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// J) CLIENTES RECORRENTES
// ─────────────────────────────────────────────────────────────────────────────

export type ClienteRecorrente = {
  nome: string;
  codigo: string | null;
  tipo: "PF" | "PJ" | "?";
  qt: number;
  faturamento: number;
  margem: number;
};

export function clientesRecorrentes(
  vendas: VendaParsed[],
  custosPorPlaca: CustosMap,
  opts: { minCompras?: number } = {},
): ClienteRecorrente[] {
  const min = opts.minCompras ?? 2;
  const map = new Map<
    string,
    { nome: string; codigo: string | null; tipo: "PF" | "PJ" | "?"; qt: number; valor: number; margem: number }
  >();
  for (const v of vendas) {
    const k = v.cliente_codigo?.trim() || `__sem_doc__${v.cliente_nome ?? ""}`;
    if (!map.has(k)) {
      map.set(k, {
        nome: v.cliente_nome ?? "?",
        codigo: v.cliente_codigo,
        tipo: v.cliente_tipo ?? "?",
        qt: 0,
        valor: 0,
        margem: 0,
      });
    }
    const r = map.get(k)!;
    const m = calcMargemVenda(v, custosPorPlaca);
    r.qt++;
    r.valor += m.valor;
    r.margem += m.margem;
  }
  return [...map.values()]
    .filter((c) => c.qt >= min)
    .map((c) => ({
      nome: c.nome,
      codigo: c.codigo,
      tipo: c.tipo,
      qt: c.qt,
      faturamento: c.valor,
      margem: c.margem,
    }))
    .sort((a, b) => b.qt - a.qt);
}

// ─────────────────────────────────────────────────────────────────────────────
// K) CROSS-TABS — Loja × Modelo, Loja × Marca, Loja × Vendedor
// ─────────────────────────────────────────────────────────────────────────────

export type TopItemPorLoja = {
  loja: string;
  totalVendasLoja: number;
  itens: { nome: string; qt: number; faturamento: number; margem: number; margemPct: number }[];
};

function topPorLojaGen(
  vendas: VendaParsed[],
  custosPorPlaca: CustosMap,
  pickKey: (v: VendaParsed) => string,
  topPorLoja: number,
): TopItemPorLoja[] {
  // map[loja][item] = { qt, valor, margem }
  const data = new Map<
    string,
    { total: number; por: Map<string, { qt: number; valor: number; margem: number }> }
  >();
  for (const v of vendas) {
    const loja = v.empresa_nome || `Loja ${v.cod_empresa}`;
    const item = pickKey(v);
    if (!data.has(loja)) data.set(loja, { total: 0, por: new Map() });
    const d = data.get(loja)!;
    d.total++;
    if (!d.por.has(item)) d.por.set(item, { qt: 0, valor: 0, margem: 0 });
    const r = d.por.get(item)!;
    const m = calcMargemVenda(v, custosPorPlaca);
    r.qt++;
    r.valor += m.valor;
    r.margem += m.margem;
  }
  return [...data.entries()]
    .map(([loja, d]) => ({
      loja,
      totalVendasLoja: d.total,
      itens: [...d.por.entries()]
        .map(([nome, r]) => ({
          nome,
          qt: r.qt,
          faturamento: r.valor,
          margem: r.margem,
          margemPct: pctSafe(r.margem, r.valor),
        }))
        .sort((a, b) => b.qt - a.qt)
        .slice(0, topPorLoja),
    }))
    .sort((a, b) => b.totalVendasLoja - a.totalVendasLoja);
}

export function topModelosPorLoja(
  vendas: VendaParsed[],
  custosPorPlaca: CustosMap,
  opts: { topPorLoja?: number } = {},
): TopItemPorLoja[] {
  return topPorLojaGen(vendas, custosPorPlaca, (v) => (v.modelo ?? "—").trim().toUpperCase(), opts.topPorLoja ?? 5);
}

export function topMarcasPorLoja(
  vendas: VendaParsed[],
  custosPorPlaca: CustosMap,
  opts: { topPorLoja?: number } = {},
): TopItemPorLoja[] {
  return topPorLojaGen(vendas, custosPorPlaca, (v) => (v.marca ?? "—").trim().toUpperCase(), opts.topPorLoja ?? 5);
}

export function topVendedoresPorLoja(
  vendas: VendaParsed[],
  custosPorPlaca: CustosMap,
  opts: { topPorLoja?: number } = {},
): TopItemPorLoja[] {
  return topPorLojaGen(
    vendas,
    custosPorPlaca,
    (v) => v.vendedor_nome || v.vendedor_codigo || "—",
    opts.topPorLoja ?? 5,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// L) ONDE CADA MODELO É VENDIDO — útil pra "onde a Ranger XLT mais vende?"
// ─────────────────────────────────────────────────────────────────────────────

export type LojasPorModelo = {
  modelo: string;
  totalVendido: number;
  lojas: { loja: string; qt: number; faturamento: number; margem: number; margemPct: number }[];
};

export function lojasPorModelo(
  vendas: VendaParsed[],
  custosPorPlaca: CustosMap,
  opts: { minVendasModelo?: number; topModelos?: number; topLojasPorModelo?: number } = {},
): LojasPorModelo[] {
  const minMod = opts.minVendasModelo ?? 5;
  const topModelos = opts.topModelos ?? 20;
  const topLojas = opts.topLojasPorModelo ?? 5;

  const data = new Map<string, { total: number; por: Map<string, { qt: number; valor: number; margem: number }> }>();
  for (const v of vendas) {
    const modelo = (v.modelo ?? "—").trim().toUpperCase();
    const loja = v.empresa_nome || `Loja ${v.cod_empresa}`;
    if (!data.has(modelo)) data.set(modelo, { total: 0, por: new Map() });
    const d = data.get(modelo)!;
    d.total++;
    if (!d.por.has(loja)) d.por.set(loja, { qt: 0, valor: 0, margem: 0 });
    const r = d.por.get(loja)!;
    const m = calcMargemVenda(v, custosPorPlaca);
    r.qt++;
    r.valor += m.valor;
    r.margem += m.margem;
  }

  return [...data.entries()]
    .filter(([, d]) => d.total >= minMod)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, topModelos)
    .map(([modelo, d]) => ({
      modelo,
      totalVendido: d.total,
      lojas: [...d.por.entries()]
        .map(([loja, r]) => ({
          loja,
          qt: r.qt,
          faturamento: r.valor,
          margem: r.margem,
          margemPct: pctSafe(r.margem, r.valor),
        }))
        .sort((a, b) => b.qt - a.qt)
        .slice(0, topLojas),
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// M) TENDÊNCIA TEMPORAL — vendas por mês
// ─────────────────────────────────────────────────────────────────────────────

export type VendasPorMes = {
  ano: number;
  mes: number;
  rotulo: string;
  qt: number;
  faturamento: number;
  margem: number;
  margemPct: number;
  ticketMedio: number;
};

export function vendasPorMes(vendas: VendaParsed[], custosPorPlaca: CustosMap): VendasPorMes[] {
  const map = new Map<string, { ano: number; mes: number; qt: number; valor: number; margem: number }>();
  for (const v of vendas) {
    if (!v.data_venda) continue;
    const d = new Date(v.data_venda);
    const ano = d.getFullYear();
    const mes = d.getMonth() + 1;
    const k = `${ano}-${String(mes).padStart(2, "0")}`;
    if (!map.has(k)) map.set(k, { ano, mes, qt: 0, valor: 0, margem: 0 });
    const r = map.get(k)!;
    const m = calcMargemVenda(v, custosPorPlaca);
    r.qt++;
    r.valor += m.valor;
    r.margem += m.margem;
  }
  const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return [...map.values()]
    .sort((a, b) => (a.ano - b.ano) * 100 + (a.mes - b.mes))
    .map((r) => ({
      ano: r.ano,
      mes: r.mes,
      rotulo: `${MESES[r.mes - 1]}/${r.ano}`,
      qt: r.qt,
      faturamento: r.valor,
      margem: r.margem,
      margemPct: pctSafe(r.margem, r.valor),
      ticketMedio: r.qt > 0 ? r.valor / r.qt : 0,
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// N) DEMOGRAFIA — UF, PF×PJ, idade do veículo, KM
// ─────────────────────────────────────────────────────────────────────────────

export type VendasPorUF = {
  uf: string;
  qt: number;
  faturamento: number;
  margem: number;
  margemPct: number;
};

export function vendasPorUF(vendas: VendaParsed[], custosPorPlaca: CustosMap): VendasPorUF[] {
  const map = new Map<string, { qt: number; valor: number; margem: number }>();
  for (const v of vendas) {
    const uf = (v.cliente_uf ?? "—").toUpperCase();
    if (!map.has(uf)) map.set(uf, { qt: 0, valor: 0, margem: 0 });
    const r = map.get(uf)!;
    const m = calcMargemVenda(v, custosPorPlaca);
    r.qt++;
    r.valor += m.valor;
    r.margem += m.margem;
  }
  return [...map.entries()]
    .map(([uf, r]) => ({
      uf,
      qt: r.qt,
      faturamento: r.valor,
      margem: r.margem,
      margemPct: pctSafe(r.margem, r.valor),
    }))
    .sort((a, b) => b.qt - a.qt);
}

export type ResumoPFPJ = {
  pf: { qt: number; faturamento: number; margem: number; margemPct: number; ticketMedio: number };
  pj: { qt: number; faturamento: number; margem: number; margemPct: number; ticketMedio: number };
  semDoc: { qt: number; faturamento: number; margem: number; margemPct: number };
};

export function pfVsPj(vendas: VendaParsed[], custosPorPlaca: CustosMap): ResumoPFPJ {
  const buckets = {
    pf: { qt: 0, valor: 0, margem: 0 },
    pj: { qt: 0, valor: 0, margem: 0 },
    semDoc: { qt: 0, valor: 0, margem: 0 },
  };
  for (const v of vendas) {
    const m = calcMargemVenda(v, custosPorPlaca);
    const b = v.cliente_tipo === "PF" ? buckets.pf : v.cliente_tipo === "PJ" ? buckets.pj : buckets.semDoc;
    b.qt++;
    b.valor += m.valor;
    b.margem += m.margem;
  }
  return {
    pf: {
      qt: buckets.pf.qt,
      faturamento: buckets.pf.valor,
      margem: buckets.pf.margem,
      margemPct: pctSafe(buckets.pf.margem, buckets.pf.valor),
      ticketMedio: buckets.pf.qt > 0 ? buckets.pf.valor / buckets.pf.qt : 0,
    },
    pj: {
      qt: buckets.pj.qt,
      faturamento: buckets.pj.valor,
      margem: buckets.pj.margem,
      margemPct: pctSafe(buckets.pj.margem, buckets.pj.valor),
      ticketMedio: buckets.pj.qt > 0 ? buckets.pj.valor / buckets.pj.qt : 0,
    },
    semDoc: {
      qt: buckets.semDoc.qt,
      faturamento: buckets.semDoc.valor,
      margem: buckets.semDoc.margem,
      margemPct: pctSafe(buckets.semDoc.margem, buckets.semDoc.valor),
    },
  };
}

export type IdadeVeiculoBucket = {
  faixa: string;
  anosMin: number;
  anosMax: number;
  qt: number;
  faturamento: number;
  margem: number;
  margemPct: number;
  ticketMedio: number;
};

export function idadeVeiculoVsMargem(
  vendas: VendaParsed[],
  custosPorPlaca: CustosMap,
  anoReferencia: number = new Date().getFullYear(),
): IdadeVeiculoBucket[] {
  const FAIXAS: { label: string; min: number; max: number }[] = [
    { label: "0–2 anos (seminovo)", min: 0, max: 2 },
    { label: "3–5 anos", min: 3, max: 5 },
    { label: "6–8 anos", min: 6, max: 8 },
    { label: "9–12 anos", min: 9, max: 12 },
    { label: "13+ anos (usadão)", min: 13, max: 999 },
  ];
  const acc = FAIXAS.map((f) => ({ ...f, qt: 0, valor: 0, margem: 0 }));
  for (const v of vendas) {
    if (v.ano_fabricacao == null) continue;
    const idade = anoReferencia - v.ano_fabricacao;
    const m = calcMargemVenda(v, custosPorPlaca);
    for (const f of acc) {
      if (idade >= f.min && idade <= f.max) {
        f.qt++;
        f.valor += m.valor;
        f.margem += m.margem;
        break;
      }
    }
  }
  return acc.map((f) => ({
    faixa: f.label,
    anosMin: f.min,
    anosMax: f.max === 999 ? -1 : f.max,
    qt: f.qt,
    faturamento: f.valor,
    margem: f.margem,
    margemPct: pctSafe(f.margem, f.valor),
    ticketMedio: f.qt > 0 ? f.valor / f.qt : 0,
  }));
}

export type KmBucket = {
  faixa: string;
  qt: number;
  faturamento: number;
  margem: number;
  margemPct: number;
  ticketMedio: number;
};

export function kmVsMargem(vendas: VendaParsed[], custosPorPlaca: CustosMap): KmBucket[] {
  const FAIXAS: { label: string; min: number; max: number }[] = [
    { label: "0–20.000 km", min: 0, max: 20000 },
    { label: "20.001–50.000 km", min: 20001, max: 50000 },
    { label: "50.001–100.000 km", min: 50001, max: 100000 },
    { label: "100.001–150.000 km", min: 100001, max: 150000 },
    { label: "150.001+ km", min: 150001, max: Number.POSITIVE_INFINITY },
  ];
  const acc = FAIXAS.map((f) => ({ ...f, qt: 0, valor: 0, margem: 0 }));
  for (const v of vendas) {
    if (v.km == null) continue;
    const m = calcMargemVenda(v, custosPorPlaca);
    for (const f of acc) {
      if (v.km >= f.min && v.km <= f.max) {
        f.qt++;
        f.valor += m.valor;
        f.margem += m.margem;
        break;
      }
    }
  }
  return acc.map((f) => ({
    faixa: f.label,
    qt: f.qt,
    faturamento: f.valor,
    margem: f.margem,
    margemPct: pctSafe(f.margem, f.valor),
    ticketMedio: f.qt > 0 ? f.valor / f.qt : 0,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// O) ESTOQUE ATUAL — distribuição por loja e por marca
// ─────────────────────────────────────────────────────────────────────────────

export type EstoquePorLoja = {
  loja: string;
  qt: number;
  valorEmEstoque: number;
  diasPatioMedio: number;
  /** Carros parados há mais de 60 dias — alerta. */
  qtAcimaDe60Dias: number;
};

export function estoquePorLoja(veiculos: VeiculoParsed[], lojaNomePorCod: Record<number, string> = {}): EstoquePorLoja[] {
  const map = new Map<
    string,
    { qt: number; valor: number; diasSoma: number; diasN: number; over60: number }
  >();
  for (const v of veiculos) {
    const nome = lojaNomePorCod[v.cod_empresa] || `Loja ${v.cod_empresa}`;
    if (!map.has(nome)) map.set(nome, { qt: 0, valor: 0, diasSoma: 0, diasN: 0, over60: 0 });
    const r = map.get(nome)!;
    r.qt++;
    r.valor += v.valor_aquisicao ?? 0; // custo de fábrica (capital travado)
    if (v.dias_patio != null) {
      r.diasSoma += v.dias_patio;
      r.diasN++;
      if (v.dias_patio > 60) r.over60++;
    }
  }
  return [...map.entries()]
    .map(([loja, r]) => ({
      loja,
      qt: r.qt,
      valorEmEstoque: r.valor,
      diasPatioMedio: r.diasN > 0 ? r.diasSoma / r.diasN : 0,
      qtAcimaDe60Dias: r.over60,
    }))
    .sort((a, b) => b.qt - a.qt);
}

export type EstoquePorMarca = {
  marca: string;
  qt: number;
  valorEmEstoque: number;
  diasPatioMedio: number;
};

export function estoquePorMarca(veiculos: VeiculoParsed[]): EstoquePorMarca[] {
  const map = new Map<string, { qt: number; valor: number; diasSoma: number; diasN: number }>();
  for (const v of veiculos) {
    const marca = (v.marca ?? "—").toUpperCase();
    if (!map.has(marca)) map.set(marca, { qt: 0, valor: 0, diasSoma: 0, diasN: 0 });
    const r = map.get(marca)!;
    r.qt++;
    r.valor += v.valor_aquisicao ?? 0; // custo de fábrica (capital travado)
    if (v.dias_patio != null) {
      r.diasSoma += v.dias_patio;
      r.diasN++;
    }
  }
  return [...map.entries()]
    .map(([marca, r]) => ({
      marca,
      qt: r.qt,
      valorEmEstoque: r.valor,
      diasPatioMedio: r.diasN > 0 ? r.diasSoma / r.diasN : 0,
    }))
    .sort((a, b) => b.qt - a.qt);
}

// ─────────────────────────────────────────────────────────────────────────────
// O') CLASSIFICAÇÃO Auto Avaliar — distribuição A-E do estoque atual
// ─────────────────────────────────────────────────────────────────────────────

export type DistribuicaoClasses = {
  classes: { classe: "A" | "B" | "C" | "D" | "E"; qt: number; valor: number; canal: "showroom" | "repasse" }[];
  totalShowroom: { qt: number; valor: number };
  totalRepasse: { qt: number; valor: number };
  rebaixadosPorEstoque: number;
};

export function distribuicaoClasses(
  veiculos: VeiculoParsed[],
): DistribuicaoClasses {
  // Import dinâmico evita ciclo de imports
  // (classificacao não depende de insights, mas insights importa coisa que pode acabar dependendo dele)
  // Como aqui é função pura síncrona, vamos importar diretamente no topo:
  // (movido pro import do arquivo)
  const contagem = new Map<string, number>();
  for (const v of veiculos) {
    const k = (v.modelo ?? "").trim().toUpperCase();
    contagem.set(k, (contagem.get(k) ?? 0) + 1);
  }

  const classes = {
    A: { qt: 0, valor: 0 },
    B: { qt: 0, valor: 0 },
    C: { qt: 0, valor: 0 },
    D: { qt: 0, valor: 0 },
    E: { qt: 0, valor: 0 },
  } as Record<"A" | "B" | "C" | "D" | "E", { qt: number; valor: number }>;
  let totalShowroomQt = 0, totalShowroomRs = 0;
  let totalRepasseQt = 0, totalRepasseRs = 0;
  let rebaixados = 0;

  for (const v of veiculos) {
    const c = classificarVeiculo(v, { contagemPorModelo: contagem });
    const custo = v.valor_aquisicao ?? 0; // custo de fábrica (capital travado)
    classes[c.classe].qt++;
    classes[c.classe].valor += custo;
    if (c.canal === "showroom") {
      totalShowroomQt++;
      totalShowroomRs += custo;
    } else {
      totalRepasseQt++;
      totalRepasseRs += custo;
    }
    if (c.rebaixadoPorEstoque) rebaixados++;
  }

  return {
    classes: (["A", "B", "C", "D", "E"] as const).map((k) => ({
      classe: k,
      qt: classes[k].qt,
      valor: classes[k].valor,
      // canal "natural" da classe (não considera rebaixamento)
      canal: k === "A" || k === "B" ? "showroom" : "repasse",
    })),
    totalShowroom: { qt: totalShowroomQt, valor: totalShowroomRs },
    totalRepasse: { qt: totalRepasseQt, valor: totalRepasseRs },
    rebaixadosPorEstoque: rebaixados,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// O'') ALERTAS OPERACIONAIS — cards de "ação imediata" pro dashboard
// ─────────────────────────────────────────────────────────────────────────────

export type SeveridadeAlerta = "critico" | "atencao" | "info";

/** Ação de drill-down: aplica filtros no sessionStorage e navega pra rota. */
export type AcaoAlerta = {
  /** Rota destino */
  rota: "/veiculos" | "/vendas";
  /** Filtros a aplicar antes de navegar. Chaves SEM prefixo (será adicionado). */
  filtros: Record<string, string>;
  /** Label do botão (default: "Ver detalhes") */
  label?: string;
};

export type Alerta = {
  id: string;
  severidade: SeveridadeAlerta;
  icone: string;
  titulo: string;
  detalhe: string;
  /** Drill-down opcional: aplica filtros e navega. */
  acao?: AcaoAlerta;
};

/**
 * Gera lista de alertas operacionais baseados no estado atual.
 *
 * Cada alerta tem severidade:
 *   - critico: dinheiro sangrando (perda real ou risco grande)
 *   - atencao: precisa olhar, mas não urgente
 *   - info: FYI
 */
export function gerarAlertas(
  vendas: VendaParsed[],
  custosPorPlaca: CustosMap,
  veiculos: VeiculoParsed[],
  fipeBatch: BatchResult | null = null,
  cautelares: Record<string, StatusCautelar> = {},
): Alerta[] {
  const alertas: Alerta[] = [];
  if (vendas.length === 0 && veiculos.length === 0) return alertas;

  // 1) Dependência de Ganhos Indiretos
  if (vendas.length > 0) {
    const sumario = sumarioGlobal(vendas, custosPorPlaca);
    if (sumario.dependeDeBonus) {
      alertas.push({
        id: "depende-bonus",
        severidade: "critico",
        icone: "🚨",
        titulo: `Sem bônus de fábrica, operação está no prejuízo`,
        detalhe: `Margem atual R$ ${fmtBR(sumario.margem)} é menor que os R$ ${fmtBR(sumario.ganhosIndiretos)} em bônus. Sem eles, prejuízo de R$ ${fmtBR(Math.abs(sumario.margemSemBonus))}.`,
      });
    }
  }

  // 2) Carros parados há mais de 180 dias no estoque
  if (veiculos.length > 0) {
    const parados180 = veiculos.filter((v) => (v.dias_patio ?? 0) > 180);
    if (parados180.length > 0) {
      const valor = parados180.reduce((s, v) => s + (v.valor_aquisicao ?? 0), 0); // custo travado
      alertas.push({
        id: "parados-180d",
        severidade: "critico",
        icone: "⏰",
        titulo: `${parados180.length} carros parados há mais de 180 dias`,
        detalhe: `R$ ${fmtBR(valor)} em exposição. Histórico mostra que carros nessa faixa fecham com margem média de -20%. Considere leilão/repasse urgente.`,
        acao: {
          rota: "/veiculos",
          filtros: { diasMin: "180" },
          label: "Ver carros parados",
        },
      });
    }
  }

  // 3) Estoque atual em modelos com histórico negativo
  if (vendas.length > 0 && veiculos.length > 0) {
    const risco = estoqueEmRisco(veiculos, vendas, custosPorPlaca, { topPiores: 0 });
    if (risco.qtEmRisco > 0 && risco.valorEmRisco > 1000) {
      alertas.push({
        id: "estoque-risco",
        severidade: risco.valorEmRisco > 10_000_000 ? "critico" : "atencao",
        icone: "🔴",
        titulo: `${risco.qtEmRisco} carros em modelos com histórico de prejuízo`,
        detalhe: `R$ ${fmtBR(risco.valorEmRisco)} em estoque ativo. Esses modelos já fecharam vendas com margem negativa nesse período.`,
      });
    }
  }

  // 4) Lojas com margem negativa
  if (vendas.length > 0) {
    const lojas = margemPorLoja(vendas, custosPorPlaca);
    for (const l of lojas) {
      if (l.margem < -50_000 && l.qt >= 20) {
        alertas.push({
          id: `loja-neg-${l.loja}`,
          severidade: l.margem < -200_000 ? "critico" : "atencao",
          icone: "🏬",
          titulo: `${l.loja}: ${fmtBR(l.margem)} de prejuízo`,
          detalhe: `${l.qt} vendas com margem ${l.margemPct.toFixed(2)}%. Investigar precificação.`,
          acao: {
            rota: "/vendas",
            filtros: { filtroLoja: l.loja },
            label: "Ver vendas da loja",
          },
        });
      }
    }
  }

  // 5) Vendedores com margem muito negativa
  if (vendas.length > 0) {
    const vendedoresPiores = margemPorVendedor(vendas, custosPorPlaca, { minVendas: 10 })
      .filter((v) => v.margem < -50_000)
      .slice(-3); // os 3 piores
    for (const v of vendedoresPiores) {
      alertas.push({
        id: `vendedor-neg-${v.vendedor}`,
        severidade: "atencao",
        icone: "👤",
        titulo: `${v.vendedor}: ${v.margemPct.toFixed(2)}% em ${v.qt} vendas`,
        detalhe: `Vendendo com margem ${v.margemPct.toFixed(2)}% — perda média de R$ ${fmtBR(Math.abs(v.margem / v.qt))} por venda. Investigar política de desconto.`,
        acao: {
          rota: "/vendas",
          filtros: { filtroVendedor: v.vendedor },
          label: "Ver vendas do vendedor",
        },
      });
    }
  }

  // 6) Concentração de modelos no estoque (mesmo modelo em quantidade alta)
  if (veiculos.length > 0) {
    const contagem = new Map<string, { qt: number; valor: number; modelo: string }>();
    for (const v of veiculos) {
      const k = (v.modelo ?? "").trim().toUpperCase();
      const c = contagem.get(k) ?? { qt: 0, valor: 0, modelo: v.modelo ?? "—" };
      c.qt++;
      c.valor += v.valor_aquisicao ?? 0; // custo travado
      contagem.set(k, c);
    }
    const concentrados = [...contagem.values()].filter((c) => c.qt >= 10).sort((a, b) => b.qt - a.qt).slice(0, 3);
    for (const c of concentrados) {
      alertas.push({
        id: `modelo-concentrado-${c.modelo}`,
        severidade: "info",
        icone: "📦",
        titulo: `${c.qt} unidades de ${c.modelo} no estoque`,
        detalhe: `R$ ${fmtBR(c.valor)} concentrados. A política Auto Avaliar recomenda repasse pra modelos com ≥5 unidades.`,
        acao: {
          rota: "/veiculos",
          filtros: { search: c.modelo },
          label: "Ver unidades",
        },
      });
    }
  }

  // 7) Carros acima da FIPE (>5%) — risco de não vender
  if (fipeBatch && veiculos.length > 0) {
    let qtAcima5 = 0, valorAcima5 = 0;
    let qtAcima10 = 0, valorAcima10 = 0;
    for (const v of veiculos) {
      const precoFipe = precoFipeConfiavel(fipeBatch, v.chassi);
      if (precoFipe == null) continue;
      const d = calcularDesvioFipe(v.preco_venda, precoFipe);
      if (!d) continue;
      if (d.pct > 10) {
        qtAcima10++;
        valorAcima10 += v.preco_venda ?? 0;
      } else if (d.pct > 5) {
        qtAcima5++;
        valorAcima5 += v.preco_venda ?? 0;
      }
    }
    if (qtAcima10 > 0) {
      alertas.push({
        id: "fipe-acima-10",
        severidade: "critico",
        icone: "📈",
        titulo: `${qtAcima10} carros pedindo mais de 10% acima da FIPE`,
        detalhe: `R$ ${fmtBR(valorAcima10)} em estoque com preço acima do mercado. Risco real de não vender ou ficar muito tempo parado.`,
        acao: {
          rota: "/veiculos",
          filtros: { filtroFipe: "acima" },
          label: "Ver carros acima da FIPE",
        },
      });
    }
    if (qtAcima5 > 0) {
      alertas.push({
        id: "fipe-acima-5",
        severidade: "atencao",
        icone: "📊",
        titulo: `${qtAcima5} carros pedindo entre 5% e 10% acima da FIPE`,
        detalhe: `R$ ${fmtBR(valorAcima5)} levemente acima do mercado. Considere revisar precificação.`,
        acao: {
          rota: "/veiculos",
          filtros: { filtroFipe: "acima" },
          label: "Ver carros acima da FIPE",
        },
      });
    }
  }

  // 8) Cautelar — carros sem laudo informado
  if (veiculos.length > 0) {
    const totalCautelares = Object.keys(cautelares).length;
    const semCautelar = veiculos.length - totalCautelares;
    let reprovados = 0, comRestricao = 0;
    for (const v of veiculos) {
      const c = cautelares[v.chassi];
      if (c === "reprovado") reprovados++;
      else if (c === "com_restricao") comRestricao++;
    }
    if (reprovados > 0) {
      alertas.push({
        id: "cautelar-reprovados",
        severidade: "critico",
        icone: "🔴",
        titulo: `${reprovados} carros com cautelar REPROVADA no estoque`,
        detalhe: `Esses carros são classe E — só repasse via leilão. Considere remover do show room.`,
        acao: {
          rota: "/veiculos",
          filtros: { filtroCautelar: "reprovado" },
          label: "Ver carros reprovados",
        },
      });
    }
    if (comRestricao > 0) {
      alertas.push({
        id: "cautelar-restricao",
        severidade: "atencao",
        icone: "⚠️",
        titulo: `${comRestricao} carros com cautelar COM RESTRIÇÃO`,
        detalhe: `Carros que precisam de atenção na precificação. Foram rebaixados 1 classe na política Auto Avaliar.`,
      });
    }
    if (semCautelar > veiculos.length * 0.5 && veiculos.length > 0) {
      alertas.push({
        id: "cautelar-faltando",
        severidade: "info",
        icone: "📋",
        titulo: `${semCautelar} carros sem laudo cautelar informado`,
        detalhe: `${((semCautelar / veiculos.length) * 100).toFixed(0)}% do estoque sem laudo. Preencher melhora a classificação automática.`,
      });
    }
  }

  // 9) Cobertura de custos baixa
  if (vendas.length > 0) {
    const sumario = sumarioGlobal(vendas, custosPorPlaca);
    if (sumario.cobertura < 0.95) {
      alertas.push({
        id: "cobertura-baixa",
        severidade: "atencao",
        icone: "📋",
        titulo: `Cobertura de custos NBS abaixo de 95%`,
        detalhe: `Apenas ${(sumario.cobertura * 100).toFixed(1)}% das vendas têm custo oficial cruzado. O resto usa estimativa. Suba o relatório de custos atualizado.`,
      });
    }
  }

  // 10) Carros parados entre 90 e 180 dias — aviso precoce
  //     Antes que o cenário "180d" (que já tem alerta crítico) aconteça.
  if (veiculos.length > 0) {
    const parados90 = veiculos.filter((v) => {
      const d = v.dias_patio ?? 0;
      return d > 90 && d <= 180;
    });
    if (parados90.length >= 5) {
      const valor = parados90.reduce((s, v) => s + (v.valor_aquisicao ?? 0), 0);
      alertas.push({
        id: "parados-90d",
        severidade: "atencao",
        icone: "⌛",
        titulo: `${parados90.length} carros parados entre 90 e 180 dias`,
        detalhe: `R$ ${fmtBR(valor)} de capital comprometido. Se não rodar, viram alerta crítico em poucas semanas. Considere revisar preço ou repassar agora.`,
        acao: {
          rota: "/veiculos",
          filtros: { diasMin: "90", diasMax: "180" },
          label: "Ver carros parados",
        },
      });
    }
  }

  // 11) Carros parados há mais de 365 dias — catastrófico
  //     Floor plan já consumiu boa parte da margem teórica.
  if (veiculos.length > 0) {
    const parados365 = veiculos.filter((v) => (v.dias_patio ?? 0) > 365);
    if (parados365.length > 0) {
      const valor = parados365.reduce((s, v) => s + (v.valor_aquisicao ?? 0), 0);
      alertas.push({
        id: "parados-365d",
        severidade: "critico",
        icone: "💀",
        titulo: `${parados365.length} carros parados há MAIS DE 1 ANO`,
        detalhe: `R$ ${fmtBR(valor)} preso há 12+ meses. Floor plan acumulado já comeu a margem. Decisão urgente: leilão, baixa, ou repasse direto.`,
        acao: {
          rota: "/veiculos",
          filtros: { diasMin: "365" },
          label: "Ver fantasmas do estoque",
        },
      });
    }
  }

  // 12) Carros muito abaixo da FIPE — subprecificados, perdendo margem
  //     Se vender nesse preço, vai dar lucro, mas menor do que poderia.
  if (fipeBatch?.items && veiculos.length > 0) {
    let qtMuitoAbaixo = 0;
    let valorMuitoAbaixo = 0;
    for (const v of veiculos) {
      const precoFipe = precoFipeConfiavel(fipeBatch, v.chassi);
      if (precoFipe == null || !v.preco_venda || v.preco_venda <= 0) continue;
      const desvio = ((v.preco_venda - precoFipe) / precoFipe) * 100;
      if (desvio < -10) {
        qtMuitoAbaixo++;
        // Valor "perdido": diferença entre FIPE-5% (preço razoável) e preço atual
        const precoRazoavel = precoFipe * 0.95;
        valorMuitoAbaixo += Math.max(0, precoRazoavel - v.preco_venda);
      }
    }
    if (qtMuitoAbaixo >= 5) {
      alertas.push({
        id: "subprecificado-fipe",
        severidade: qtMuitoAbaixo >= 20 ? "critico" : "atencao",
        icone: "📉",
        titulo: `${qtMuitoAbaixo} carros mais de 10% ABAIXO da FIPE`,
        detalhe: `Vão vender rápido, mas com margem ${valorMuitoAbaixo > 0 ? `~R$ ${fmtBR(valorMuitoAbaixo)} menor` : "comprimida"}. Revisar se vale subir preço.`,
        acao: {
          rota: "/veiculos",
          filtros: { filtroFipe: "abaixo" },
          label: "Ver subprecificados",
        },
      });
    }
  }

  // 13) Risco de prejuízo iminente
  //     Carros com margem teórica fina (<5%) E parados >90d
  //     → quando finalmente venderem, podem virar prejuízo
  if (veiculos.length > 0) {
    const emRiscoPrejuizo = veiculos.filter((v) => {
      if (v.preco_venda == null || v.custo_total == null || v.preco_venda <= 0) return false;
      if ((v.dias_patio ?? 0) <= 90) return false;
      const margem = (v.preco_venda - v.custo_total) / v.preco_venda;
      return margem < 0.05;
    });
    if (emRiscoPrejuizo.length > 0) {
      const valor = emRiscoPrejuizo.reduce((s, v) => s + (v.custo_total ?? 0), 0);
      alertas.push({
        id: "risco-prejuizo-iminente",
        severidade: "critico",
        icone: "💸",
        titulo: `${emRiscoPrejuizo.length} carros com margem fina E parados +90d`,
        detalhe: `R$ ${fmtBR(valor)} em risco. Margem teórica já está em <5% e o capital travado segue consumindo. Quando vender, vai estar no prejuízo.`,
        acao: {
          rota: "/veiculos",
          filtros: { diasMin: "90" },
          label: "Ver carros em risco",
        },
      });
    }
  }

  // Ordenação: críticos primeiro, depois atenção, depois info
  const ordem = { critico: 0, atencao: 1, info: 2 };
  return alertas.sort((a, b) => ordem[a.severidade] - ordem[b.severidade]);
}

function fmtBR(n: number): string {
  return Math.round(n).toLocaleString("pt-BR");
}

// ─────────────────────────────────────────────────────────────────────────────
// O''') ANÁLISES FIPE — desvios, carros acima/abaixo, oportunidades
// ─────────────────────────────────────────────────────────────────────────────

export type FipeOutlier = {
  placa: string;
  modelo: string;
  marca: string | null;
  precoVenda: number;
  precoFipe: number;
  desvioPct: number;
  desvioReais: number;
  diasPatio: number | null;
  loja: string | null;
};

export type FipeAnaliseEstoque = {
  totalAnalisados: number;
  semFipe: number;
  acima10Pct: { qt: number; valor: number };
  acima5a10Pct: { qt: number; valor: number };
  proximoFipe: { qt: number; valor: number };
  abaixo5a10Pct: { qt: number; valor: number };
  abaixo10Pct: { qt: number; valor: number };
  topAcima: FipeOutlier[];
  topAbaixo: FipeOutlier[];
};

export function fipeAnaliseEstoque(
  veiculos: VeiculoParsed[],
  fipeBatch: BatchResult | null,
): FipeAnaliseEstoque | null {
  if (!fipeBatch || veiculos.length === 0) return null;

  const buckets = {
    acima10: { qt: 0, valor: 0 },
    acima5: { qt: 0, valor: 0 },
    proximo: { qt: 0, valor: 0 },
    abaixo5: { qt: 0, valor: 0 },
    abaixo10: { qt: 0, valor: 0 },
  };
  const todos: FipeOutlier[] = [];
  let semFipe = 0;

  for (const v of veiculos) {
    const precoFipe = precoFipeConfiavel(fipeBatch, v.chassi);
    if (precoFipe == null) {
      semFipe++;
      continue;
    }
    const desv = calcularDesvioFipe(v.preco_venda, precoFipe);
    if (!desv) continue;
    const preco = v.preco_venda ?? 0;
    if (desv.pct > 10) {
      buckets.acima10.qt++;
      buckets.acima10.valor += preco;
    } else if (desv.pct > 5) {
      buckets.acima5.qt++;
      buckets.acima5.valor += preco;
    } else if (desv.pct < -10) {
      buckets.abaixo10.qt++;
      buckets.abaixo10.valor += preco;
    } else if (desv.pct < -5) {
      buckets.abaixo5.qt++;
      buckets.abaixo5.valor += preco;
    } else {
      buckets.proximo.qt++;
      buckets.proximo.valor += preco;
    }
    todos.push({
      placa: v.placa ?? "—",
      modelo: v.modelo ?? "—",
      marca: v.marca,
      precoVenda: preco,
      precoFipe,
      desvioPct: desv.pct,
      desvioReais: desv.desvio,
      diasPatio: v.dias_patio ?? null,
      loja: null, // se quiser cruzar com lojas[v.cod_empresa]
    });
  }

  const sortedDesc = [...todos].sort((a, b) => b.desvioPct - a.desvioPct);

  return {
    totalAnalisados: veiculos.length - semFipe,
    semFipe,
    acima10Pct: buckets.acima10,
    acima5a10Pct: buckets.acima5,
    proximoFipe: buckets.proximo,
    abaixo5a10Pct: buckets.abaixo5,
    abaixo10Pct: buckets.abaixo10,
    topAcima: sortedDesc.slice(0, 15),
    topAbaixo: sortedDesc.slice(-15).reverse(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// O'''') KM POR MODELO — distribuição de quilometragem por modelo top
// ─────────────────────────────────────────────────────────────────────────────

export type KmPorModelo = {
  modelo: string;
  qtVendas: number;
  kmMin: number;
  kmMax: number;
  kmMediano: number;
  kmMedio: number;
  margemMediaPct: number;
};

export function kmPorModelo(
  vendas: VendaParsed[],
  custosPorPlaca: CustosMap,
  minVendas: number = 5,
): KmPorModelo[] {
  const map = new Map<string, { kms: number[]; margens: number[] }>();
  for (const v of vendas) {
    if (v.km == null) continue;
    const k = (v.modelo ?? "—").trim().toUpperCase();
    if (!map.has(k)) map.set(k, { kms: [], margens: [] });
    const r = map.get(k)!;
    r.kms.push(v.km);
    const m = calcMargemVenda(v, custosPorPlaca);
    if (m.valor > 0) r.margens.push((m.margem / m.valor) * 100);
  }
  return [...map.entries()]
    .filter(([, r]) => r.kms.length >= minVendas)
    .map(([modelo, r]) => {
      const kms = [...r.kms].sort((a, b) => a - b);
      const mediano = kms[Math.floor(kms.length / 2)];
      const medio = kms.reduce((s, x) => s + x, 0) / kms.length;
      const margemMedia = r.margens.length > 0 ? r.margens.reduce((s, x) => s + x, 0) / r.margens.length : 0;
      return {
        modelo,
        qtVendas: r.kms.length,
        kmMin: kms[0],
        kmMax: kms[kms.length - 1],
        kmMediano: mediano,
        kmMedio: medio,
        margemMediaPct: margemMedia,
      };
    })
    .sort((a, b) => b.qtVendas - a.qtVendas);
}

// ─────────────────────────────────────────────────────────────────────────────
// O''''') CAUTELARES POR LOJA — distribuição do laudo cautelar
// ─────────────────────────────────────────────────────────────────────────────

export type CautelarPorLoja = {
  loja: string;
  total: number;
  aprovados: number;
  comRestricao: number;
  reprovados: number;
  semCautelar: number;
};

export function cautelaresPorLoja(
  veiculos: VeiculoParsed[],
  cautelares: Record<string, StatusCautelar>,
): CautelarPorLoja[] {
  const map = new Map<string, { total: number; ap: number; cr: number; rp: number; sc: number }>();
  for (const v of veiculos) {
    const loja = `${v.cod_empresa}`; // a UI resolve nome via lookup
    if (!map.has(loja)) map.set(loja, { total: 0, ap: 0, cr: 0, rp: 0, sc: 0 });
    const r = map.get(loja)!;
    r.total++;
    const c = cautelares[v.chassi];
    if (c === "aprovado") r.ap++;
    else if (c === "com_restricao") r.cr++;
    else if (c === "reprovado") r.rp++;
    else r.sc++;
  }
  return [...map.entries()]
    .map(([loja, r]) => ({
      loja,
      total: r.total,
      aprovados: r.ap,
      comRestricao: r.cr,
      reprovados: r.rp,
      semCautelar: r.sc,
    }))
    .sort((a, b) => b.total - a.total);
}

// ─────────────────────────────────────────────────────────────────────────────
// O'''''') MARGEM POR ANO MODELO — qual idade de carro dá mais margem
// ─────────────────────────────────────────────────────────────────────────────

export type MargemPorAnoModelo = {
  ano: number;
  qt: number;
  faturamento: number;
  margem: number;
  margemPct: number;
  ticketMedio: number;
};

export function margemPorAnoModelo(
  vendas: VendaParsed[],
  custosPorPlaca: CustosMap,
): MargemPorAnoModelo[] {
  const map = new Map<number, { qt: number; valor: number; margem: number }>();
  for (const v of vendas) {
    if (v.ano_modelo == null) continue;
    if (!map.has(v.ano_modelo)) map.set(v.ano_modelo, { qt: 0, valor: 0, margem: 0 });
    const r = map.get(v.ano_modelo)!;
    const m = calcMargemVenda(v, custosPorPlaca);
    r.qt++;
    r.valor += m.valor;
    r.margem += m.margem;
  }
  return [...map.entries()]
    .map(([ano, r]) => ({
      ano,
      qt: r.qt,
      faturamento: r.valor,
      margem: r.margem,
      margemPct: pctSafe(r.margem, r.valor),
      ticketMedio: r.qt > 0 ? r.valor / r.qt : 0,
    }))
    .sort((a, b) => b.ano - a.ano);
}

// ─────────────────────────────────────────────────────────────────────────────
// P) BUNDLE COMPLETO — usado pelo /chat pra enviar contexto pro LLM
// ─────────────────────────────────────────────────────────────────────────────

export type InsightsBundle = {
  sumario: SumarioGlobal;
  lojas: MargemPorLoja[];
  marcas: MargemPorMarca[];
  giro: GiroBucket[];
  modelosPiores: MargemPorModelo[];
  modelosMelhores: MargemPorModelo[];
  /** Opcional — removido na versão compacta (chat) pra caber em quota de provider free. */
  trocas?: TrocasResumo;
  vendedoresTop: MargemPorVendedor[];
  vendedoresPiores: MargemPorVendedor[];
  outliersLucro: VendaOutlier[];
  outliersPrejuizo: VendaOutlier[];
  estoque: EstoqueRiscoResumo | null;
  /** Opcional — removido na versão compacta. */
  clientesRecorrentes?: ClienteRecorrente[];
  // Cross-tabs
  topModelosPorLoja: TopItemPorLoja[];
  topMarcasPorLoja: TopItemPorLoja[];
  topVendedoresPorLoja: TopItemPorLoja[];
  lojasDeCadaModelo: LojasPorModelo[];
  // Temporal
  vendasPorMes: VendasPorMes[];
  // Demografia (todos opcionais — removidos na versão compacta)
  vendasPorUF?: VendasPorUF[];
  pfVsPj?: ResumoPFPJ;
  idadeVeiculo?: IdadeVeiculoBucket[];
  km?: KmBucket[];
  // Estoque
  estoquePorLoja: EstoquePorLoja[] | null;
  estoquePorMarca: EstoquePorMarca[] | null;
  classificacao: DistribuicaoClasses | null;
  // Análises avançadas (opcionais — dependem de fipeBatch/cautelares)
  fipeAnaliseEstoque: FipeAnaliseEstoque | null;
  /** Opcional — removido na versão compacta. */
  kmPorModelo?: KmPorModelo[];
  /** Opcional — removido na versão compacta. */
  cautelaresPorLoja?: CautelarPorLoja[];
  /** Opcional — removido na versão compacta. */
  margemPorAnoModelo?: MargemPorAnoModelo[];
};

export function montarBundle(
  vendas: VendaParsed[],
  custosPorPlaca: CustosMap,
  veiculos: VeiculoParsed[],
  fipeBatch: BatchResult | null = null,
  cautelares: Record<string, StatusCautelar> = {},
): InsightsBundle {
  const modelos = margemPorModelo(vendas, custosPorPlaca, { minVendas: 3 });
  const vendedores = margemPorVendedor(vendas, custosPorPlaca, { minVendas: 5 });

  // Mapa cod_empresa → nome (pra estoquePorLoja)
  const lojaNomePorCod: Record<number, string> = {};
  for (const v of vendas) {
    if (v.empresa_nome) lojaNomePorCod[v.cod_empresa] = v.empresa_nome;
  }

  return {
    sumario: sumarioGlobal(vendas, custosPorPlaca),
    lojas: margemPorLoja(vendas, custosPorPlaca),
    marcas: margemPorMarca(vendas, custosPorPlaca),
    giro: giroVsMargem(vendas, custosPorPlaca),
    modelosPiores: modelos.slice(0, 15),
    modelosMelhores: [...modelos].reverse().slice(0, 15),
    trocas: trocasVsSem(vendas, custosPorPlaca),
    vendedoresTop: vendedores.slice(0, 10),
    vendedoresPiores: [...vendedores].reverse().slice(0, 10),
    outliersLucro: outliers(vendas, custosPorPlaca, { top: 10, modo: "lucro" }),
    outliersPrejuizo: outliers(vendas, custosPorPlaca, { top: 10, modo: "prejuizo" }),
    estoque: veiculos.length > 0 ? estoqueEmRisco(veiculos, vendas, custosPorPlaca, { topPiores: 20 }) : null,
    clientesRecorrentes: clientesRecorrentes(vendas, custosPorPlaca, { minCompras: 2 }).slice(0, 20),
    topModelosPorLoja: topModelosPorLoja(vendas, custosPorPlaca, { topPorLoja: 7 }),
    topMarcasPorLoja: topMarcasPorLoja(vendas, custosPorPlaca, { topPorLoja: 5 }),
    topVendedoresPorLoja: topVendedoresPorLoja(vendas, custosPorPlaca, { topPorLoja: 5 }),
    lojasDeCadaModelo: lojasPorModelo(vendas, custosPorPlaca, { minVendasModelo: 5, topModelos: 20, topLojasPorModelo: 5 }),
    vendasPorMes: vendasPorMes(vendas, custosPorPlaca),
    vendasPorUF: vendasPorUF(vendas, custosPorPlaca),
    pfVsPj: pfVsPj(vendas, custosPorPlaca),
    idadeVeiculo: idadeVeiculoVsMargem(vendas, custosPorPlaca),
    km: kmVsMargem(vendas, custosPorPlaca),
    estoquePorLoja: veiculos.length > 0 ? estoquePorLoja(veiculos, lojaNomePorCod) : null,
    estoquePorMarca: veiculos.length > 0 ? estoquePorMarca(veiculos) : null,
    classificacao: veiculos.length > 0 ? distribuicaoClasses(veiculos) : null,
    fipeAnaliseEstoque: fipeAnaliseEstoque(veiculos, fipeBatch),
    kmPorModelo: kmPorModelo(vendas, custosPorPlaca, 5).slice(0, 30),
    cautelaresPorLoja: veiculos.length > 0 ? cautelaresPorLoja(veiculos, cautelares) : [],
    margemPorAnoModelo: margemPorAnoModelo(vendas, custosPorPlaca),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Q) BUNDLE COMPACTO — versão reduzida pro chat caber em quota dos providers
// ─────────────────────────────────────────────────────────────────────────────
//
// Providers free (DeepSeek/Groq/Gemini) batem limit de tokens por minuto bem
// rápido com o bundle completo (~30-50k tokens). Esta versão corta drasticamente
// arrays e remove campos raramente perguntados pra ficar <8k tokens.
//
// REGRA: tudo que sai daqui deve poder ser explicado em "preciso desse dado,
// posso adicionar" — o system prompt do chat avisa o modelo dos campos removidos.

/**
 * Reduz drasticamente o tamanho do bundle pra uso no chat IA.
 *
 * - Mantém: sumario, classificacao, vendasPorMes, giro, estoquePorLoja, estoquePorMarca
 * - Reduz arrays principais pra top-3 a top-10
 * - Reduz estruturas aninhadas (top-modelos-por-loja etc) pra 2-3 itens
 * - Remove campos pesados raramente usados (UF, PF×PJ, idade, km, kmPorModelo,
 *   clientesRecorrentes, trocas, margemPorAnoModelo, cautelaresPorLoja)
 *
 * O `montarBundle` original continua intacto pra outros usos (dashboard, etc).
 */
export function compactarBundle(bundle: InsightsBundle): InsightsBundle {
  return {
    ...bundle,

    // Rankings — top-3 cada (era 10-15, depois 5, agora 3 pra caber em Groq 6k/min)
    modelosPiores: bundle.modelosPiores.slice(0, 3),
    modelosMelhores: bundle.modelosMelhores.slice(0, 3),
    vendedoresPiores: bundle.vendedoresPiores.slice(0, 3),
    vendedoresTop: bundle.vendedoresTop.slice(0, 3),

    // Lojas/marcas — top-5 (era 10)
    lojas: bundle.lojas.slice(0, 5),
    marcas: bundle.marcas.slice(0, 5),

    // Outliers — top-2 (era 3)
    outliersLucro: bundle.outliersLucro.slice(0, 2),
    outliersPrejuizo: bundle.outliersPrejuizo.slice(0, 2),

    // Estoque em risco — top-3 carros (era 5)
    estoque: bundle.estoque
      ? { ...bundle.estoque, itens: bundle.estoque.itens.slice(0, 3) }
      : null,

    // Cross-tabs REMOVIDOS — consumiam ~50% do bundle (16 lojas × N itens cada).
    // Se Marcos perguntar "qual carro mais sai na loja X", o sistema diz
    // "preciso desses dados, posso adicionar" e a gente pondera reativar.
    topModelosPorLoja: [],
    topMarcasPorLoja: [],
    topVendedoresPorLoja: [],
    lojasDeCadaModelo: [],

    // FIPE — top-3 cada extremo (era 5)
    fipeAnaliseEstoque: bundle.fipeAnaliseEstoque
      ? {
          ...bundle.fipeAnaliseEstoque,
          topAcima: bundle.fipeAnaliseEstoque.topAcima.slice(0, 3),
          topAbaixo: bundle.fipeAnaliseEstoque.topAbaixo.slice(0, 3),
        }
      : null,

    // vendasPorMes — últimos 6 meses (era full, 12-24 meses)
    vendasPorMes: bundle.vendasPorMes.slice(-6),

    // Removidos completamente (campos opcionais — JSON.stringify ignora undefined)
    trocas: undefined,
    clientesRecorrentes: undefined,
    vendasPorUF: undefined,
    pfVsPj: undefined,
    idadeVeiculo: undefined,
    km: undefined,
    kmPorModelo: undefined,
    cautelaresPorLoja: undefined,
    margemPorAnoModelo: undefined,
  };
}
