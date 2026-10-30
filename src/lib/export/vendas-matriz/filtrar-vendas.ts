/**
 * VENDAS USADOS MATRIZ — aba "Vendas" do painel (detalhe linha a linha = abas 1 e 2 do Excel).
 *
 * Funções PURAS: filtros, busca, ordenação, totais do filtro e estado na URL. Os filtros
 * valem só para a lista — nunca mexem nos números do Resumo.
 *
 * Critério de aceite do cross-filter: o filtro que cada cartão aplica devolve EXATAMENTE a
 * quantidade mostrada no cartão (ver tests/vendas-matriz-filtrar-vendas.test.ts). Por isso
 * toda classificação aqui reusa as MESMAS funções do Resumo e do Excel:
 * `classificarOrigem` (tipos.ts), `classificarComprador` (resumir-painel.ts) e
 * `calcularDerivadosLinha` (tipos.ts).
 */

import { normalizarPlaca } from "@/lib/utils/placa";
import { somaCampo, mediaCampo } from "./aba-margens";
import { calcularDerivadosLinha, classificarOrigem, isAutoAvaliar, type LinhaVendaMatriz, type OrigemChave } from "./tipos";
import { classificarComprador, diaBrasilia, type CompradorChave } from "./resumir-painel";

// ═══════════════════════════════════════════════════════════════════════════
// Filtros
// ═══════════════════════════════════════════════════════════════════════════

export type FiltroConsig = "todas" | "sem" | "so";
/** Regra `lojista` do Excel (abas 5/6): mais de 2 compras no ano com o mesmo CPF/CNPJ. */
export type FiltroLojista = "sim" | "nao";

export type FiltrosVendas = {
  origem: OrigemChave | null;
  /** Vazio = todos os compradores. */
  comprador: CompradorChave[];
  /** `chaveVendedor` — `null` = todos. */
  vendedor: string | null;
  consig: FiltroConsig;
  /** Só margem líquida negativa (consignadas ficam fora: não têm margem no painel). */
  neg: boolean;
  /** Dia do mês (Brasília). */
  dia: number | null;
  q: string;
  /** Filtro oculto vindo da aba Margens (visão do Excel). */
  lojista: FiltroLojista | null;
};

export const FILTROS_VAZIOS: FiltrosVendas = {
  origem: null,
  comprador: [],
  vendedor: null,
  consig: "todas",
  neg: false,
  dia: null,
  q: "",
  lojista: null,
};

export const CHAVE_AUTO_AVALIAR = "__aa";
export const CHAVE_SEM_VENDEDOR = "__sem";

/** Auto Avaliar e "sem vendedor" viram chaves próprias (nunca caem no balde de um humano). */
export function chaveVendedor(l: LinhaVendaMatriz): string {
  if (isAutoAvaliar(l)) return CHAVE_AUTO_AVALIAR;
  const nome = (l.vendedorNome ?? "").trim();
  return nome === "" ? CHAVE_SEM_VENDEDOR : nome;
}

export function rotuloVendedor(chave: string): string {
  if (chave === CHAVE_AUTO_AVALIAR) return "Auto Avaliar (leilão)";
  if (chave === CHAVE_SEM_VENDEDOR) return "Sem vendedor";
  return chave;
}

/** Minúsculas e sem acento — busca tolerante. */
export function normalizarBusca(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function casaBusca(l: LinhaVendaMatriz, qTexto: string, qPlaca: string): boolean {
  if (qTexto === "") return true;
  if (qPlaca !== "" && (normalizarPlaca(l.placa).includes(qPlaca) || normalizarPlaca(l.chassi).includes(qPlaca))) return true;
  return [l.descricaoVeiculo, l.clienteNome, l.marca ?? ""].some((campo) => normalizarBusca(campo).includes(qTexto));
}

export function filtrarVendas(linhas: LinhaVendaMatriz[], f: FiltrosVendas, codEmpresa: number): LinhaVendaMatriz[] {
  const qTexto = normalizarBusca(f.q);
  const qPlaca = normalizarPlaca(f.q);
  return linhas.filter((l) => {
    if (f.origem != null && classificarOrigem(l, codEmpresa) !== f.origem) return false;
    if (f.comprador.length > 0 && !f.comprador.includes(classificarComprador(l))) return false;
    if (f.vendedor != null && chaveVendedor(l) !== f.vendedor) return false;
    if (f.consig === "sem" && l.consignado) return false;
    if (f.consig === "so" && !l.consignado) return false;
    if (f.neg) {
      const m = calcularDerivadosLinha(l).margemLiquida;
      if (l.consignado || m == null || m >= 0) return false;
    }
    if (f.dia != null && (l.dataVenda == null || diaBrasilia(l.dataVenda) !== f.dia)) return false;
    if (f.lojista === "sim" && l.lojista !== true) return false;
    if (f.lojista === "nao" && l.lojista !== false) return false;
    return casaBusca(l, qTexto, qPlaca);
  });
}

/** Nº de filtros ativos (chips). */
export function contarFiltrosAtivos(f: FiltrosVendas): number {
  return (
    (f.origem != null ? 1 : 0) +
    f.comprador.length +
    (f.vendedor != null ? 1 : 0) +
    (f.consig !== "todas" ? 1 : 0) +
    (f.neg ? 1 : 0) +
    (f.dia != null ? 1 : 0) +
    (f.q.trim() !== "" ? 1 : 0) +
    (f.lojista != null ? 1 : 0)
  );
}

/** Contagem por categoria no mês (para os rótulos "PF 49" dos seletores). */
export function contarPor<K extends string>(linhas: LinhaVendaMatriz[], chave: (l: LinhaVendaMatriz) => K): Map<K, number> {
  const m = new Map<K, number>();
  for (const l of linhas) m.set(chave(l), (m.get(chave(l)) ?? 0) + 1);
  return m;
}

// ═══════════════════════════════════════════════════════════════════════════
// Linha derivada (conta do carro — mesma de calcularDerivadosLinha / fórmulas do Excel)
// ═══════════════════════════════════════════════════════════════════════════

export type CustoLinha = "despesaGeral" | "forplan" | "impostos" | "comissao" | "adm";
export const CUSTOS_LINHA: readonly CustoLinha[] = ["despesaGeral", "forplan", "impostos", "comissao", "adm"];
export const ROTULO_CUSTO: Record<CustoLinha, string> = {
  despesaGeral: "Despesa geral",
  forplan: "F Plan",
  impostos: "Impostos",
  comissao: "Comissão",
  adm: "ADM",
};

export type DerivadosVenda = {
  custoReal: number | null;
  lucroBruto: number | null;
  margemLiquida: number | null;
  /** Venda ÷ FIPE (fração) — `null` sem FIPE confirmada (nunca 0%). Coluna P do Excel. */
  pctFipe: number | null;
  /** Margem ÷ venda (fração). Coluna AB do Excel. */
  pctMargem: number | null;
  pctLucroBruto: number | null;
  /** Custos sem lançamento — contam como zero na margem, como no Excel. */
  custosNaoLancados: CustoLinha[];
};

export function derivadosVenda(l: LinhaVendaMatriz): DerivadosVenda {
  const { custoReal, lucroBruto, margemLiquida } = calcularDerivadosLinha(l);
  const venda = l.valorVenda;
  return {
    custoReal,
    lucroBruto,
    margemLiquida,
    pctFipe: l.valorFipe != null && l.valorFipe > 0 ? (venda ?? 0) / l.valorFipe : null,
    pctMargem: margemLiquida != null && venda != null && venda > 0 ? margemLiquida / venda : null,
    pctLucroBruto: lucroBruto != null && venda != null && venda > 0 ? lucroBruto / venda : null,
    custosNaoLancados: CUSTOS_LINHA.filter((c) => l[c] == null),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Ordenação
// ═══════════════════════════════════════════════════════════════════════════

export type ChaveOrdenacao = "data" | "venda" | "pctFipe" | "margem" | "pctMargem" | "dias" | "vendedor" | "cliente" | "origem";
export type DirecaoOrdenacao = "asc" | "desc";
export type Ordenacao = { chave: ChaveOrdenacao; dir: DirecaoOrdenacao };
export const ORDENACAO_PADRAO: Ordenacao = { chave: "data", dir: "desc" };

const COLLATOR = new Intl.Collator("pt-BR", { sensitivity: "base" });

function valorOrdenacao(l: LinhaVendaMatriz, chave: ChaveOrdenacao, codEmpresa: number): number | string | null {
  switch (chave) {
    case "data":
      return l.dataVenda?.getTime() ?? null;
    case "venda":
      return l.valorVenda;
    case "pctFipe":
      return derivadosVenda(l).pctFipe;
    case "margem":
      // Consignada não tem margem no painel → vai pro fim, como "sem valor".
      return l.consignado ? null : calcularDerivadosLinha(l).margemLiquida;
    case "pctMargem":
      return l.consignado ? null : derivadosVenda(l).pctMargem;
    case "dias":
      return l.diasEstoque;
    case "vendedor":
      return rotuloVendedor(chaveVendedor(l));
    case "cliente":
      return l.clienteNome || null;
    case "origem":
      return classificarOrigem(l, codEmpresa) === "proprio" ? " " : l.lojaOrigemCodEmpresa == null ? null : l.lojaOrigemNome;
  }
}

/** Vazios sempre no fim (nas duas direções); desempate por placa. Não muta a entrada. */
export function ordenarVendas(linhas: LinhaVendaMatriz[], ord: Ordenacao, codEmpresa: number): LinhaVendaMatriz[] {
  const sinal = ord.dir === "asc" ? 1 : -1;
  return linhas
    .map((l) => ({ l, v: valorOrdenacao(l, ord.chave, codEmpresa) }))
    .sort((a, b) => {
      if (a.v == null && b.v != null) return 1;
      if (b.v == null && a.v != null) return -1;
      if (a.v != null && b.v != null && a.v !== b.v) {
        const cmp = typeof a.v === "string" || typeof b.v === "string" ? COLLATOR.compare(String(a.v), String(b.v)) : a.v - b.v;
        if (cmp !== 0) return cmp * sinal;
      }
      return COLLATOR.compare(a.l.placa, b.l.placa);
    })
    .map((x) => x.l);
}

// ═══════════════════════════════════════════════════════════════════════════
// Totais do filtro (rodapé da tabela)
// ═══════════════════════════════════════════════════════════════════════════

export type TotaisFiltro = {
  /** Todas as filtradas (consignado incluso). */
  qtd: number;
  qtdConsignadas: number;
  /** Daqui pra baixo: SEM consignadas (regra da Fase 1). */
  qtdSemConsig: number;
  venda: number;
  /** Soma da venda ÷ soma da FIPE, só nas vendas com FIPE confirmada. */
  pctFipe: number | null;
  margem: number | null;
  pctMargem: number | null;
  diasMedio: number | null;
  kmMedio: number | null;
  /** Como o rodapé "TOTAIS / MÉDIAS DO PERÍODO" da aba 1 (soma também as consignadas). */
  excelComConsig: { venda: number; margem: number };
};

export function totaisFiltro(linhas: LinhaVendaMatriz[]): TotaisFiltro {
  const sem = linhas.filter((l) => !l.consignado);
  const venda = somaCampo(sem, (l) => l.valorVenda);
  const comFipe = sem.filter((l) => l.valorFipe != null && l.valorFipe > 0);
  const fipe = somaCampo(comFipe, (l) => l.valorFipe);
  const margem = sem.length > 0 ? somaCampo(sem, (l) => calcularDerivadosLinha(l).margemLiquida) : null;
  const temDias = sem.some((l) => l.diasEstoque != null);
  const temKm = sem.some((l) => l.km != null);
  return {
    qtd: linhas.length,
    qtdConsignadas: linhas.length - sem.length,
    qtdSemConsig: sem.length,
    venda,
    pctFipe: fipe > 0 ? somaCampo(comFipe, (l) => l.valorVenda) / fipe : null,
    margem,
    pctMargem: margem != null && venda > 0 ? margem / venda : null,
    diasMedio: temDias ? mediaCampo(sem, (l) => l.diasEstoque) : null,
    kmMedio: temKm ? mediaCampo(sem, (l) => l.km) : null,
    excelComConsig: {
      venda: somaCampo(linhas, (l) => l.valorVenda),
      margem: somaCampo(linhas, (l) => calcularDerivadosLinha(l).margemLiquida),
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Estado na URL
// ═══════════════════════════════════════════════════════════════════════════

export const ABAS_PAINEL = ["resumo", "evolucao", "vendedores", "margens", "vendas", "playplan"] as const;
export type AbaPainel = (typeof ABAS_PAINEL)[number];

const ORIGEM_URL: Record<OrigemChave, string> = { proprio: "proprio", outras: "outras", naoIdentificada: "naoident" };
const COMPRADOR_URL: Record<CompradorChave, string> = { pf: "pf", pj: "pj", autoAvaliar: "aa", naoInformado: "ni" };

function inverter<K extends string>(m: Record<K, string>): Map<string, K> {
  return new Map((Object.entries(m) as [K, string][]).map(([k, v]) => [v, k]));
}
const ORIGEM_DE_URL = inverter(ORIGEM_URL);
const COMPRADOR_DE_URL = inverter(COMPRADOR_URL);

export type EstadoUrlPainel = {
  /** "YYYY-MM" ou `null` (= mês corrente). */
  mes: string | null;
  aba: AbaPainel;
  filtros: FiltrosVendas;
};

/** Lê a URL de forma tolerante: valor desconhecido = ausente (nunca quebra a página). */
export function lerEstadoUrl(sp: URLSearchParams): EstadoUrlPainel {
  const mesRaw = sp.get("mes");
  const mes = mesRaw != null && /^\d{4}-(0[1-9]|1[0-2])$/.test(mesRaw) ? mesRaw : null;
  const abaRaw = sp.get("aba");
  const aba = (ABAS_PAINEL as readonly string[]).includes(abaRaw ?? "") ? (abaRaw as AbaPainel) : "resumo";
  const consigRaw = sp.get("consig");
  const diaNum = Number(sp.get("dia"));
  const lojistaRaw = sp.get("lojista");
  const comprador = (sp.get("comprador") ?? "")
    .split(",")
    .map((c) => COMPRADOR_DE_URL.get(c))
    .filter((c): c is CompradorChave => c != null);
  return {
    mes,
    aba,
    filtros: {
      origem: ORIGEM_DE_URL.get(sp.get("origem") ?? "") ?? null,
      comprador: [...new Set(comprador)],
      vendedor: sp.get("vendedor") || null,
      consig: consigRaw === "sem" || consigRaw === "so" ? consigRaw : "todas",
      neg: sp.get("neg") === "1",
      dia: Number.isInteger(diaNum) && diaNum >= 1 && diaNum <= 31 ? diaNum : null,
      q: sp.get("q") ?? "",
      lojista: lojistaRaw === "sim" || lojistaRaw === "nao" ? lojistaRaw : null,
    },
  };
}

/** Só grava o que difere do padrão — URL curta e compartilhável. */
export function escreverEstadoUrl(e: EstadoUrlPainel): string {
  const sp = new URLSearchParams();
  if (e.mes) sp.set("mes", e.mes);
  if (e.aba !== "resumo") sp.set("aba", e.aba);
  const f = e.filtros;
  if (f.origem) sp.set("origem", ORIGEM_URL[f.origem]);
  if (f.comprador.length > 0) sp.set("comprador", f.comprador.map((c) => COMPRADOR_URL[c]).join(","));
  if (f.vendedor) sp.set("vendedor", f.vendedor);
  if (f.consig !== "todas") sp.set("consig", f.consig);
  if (f.neg) sp.set("neg", "1");
  if (f.dia != null) sp.set("dia", String(f.dia));
  if (f.q.trim() !== "") sp.set("q", f.q);
  if (f.lojista) sp.set("lojista", f.lojista);
  const s = sp.toString();
  return s === "" ? "" : `?${s}`;
}
