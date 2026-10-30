/**
 * VENDAS USADOS MATRIZ — aba "Vendedores" do painel.
 *
 * - Ranking do MÊS SELECIONADO. Margem, % e ticket por vendedor NÃO existem no Excel: são
 *   calculados com `metricasDe` (mesmas regras das Margens, sem consignadas).
 * - Médias "últimos 3 meses" × "meses anteriores" e Delta: mesma conta da aba 8 do Excel
 *   (`calcularMatrizMediaVendedor`), mas com o mês SELECIONADO como referência (decisão do
 *   Marcos: só o painel segue o mês selecionado; o Excel continua no mês corrente real).
 * - Auto Avaliar (leilão) e "sem vendedor" ficam fora do ranking, em linhas próprias.
 */

import {
  calcularMatrizMediaVendedor,
  type LinhaMatrizMediaVendedor,
  type MatrizMediaVendedor,
  type VendaParaMediaVendedor,
} from "./aba-media-vendedor";
import { CHAVE_AUTO_AVALIAR, CHAVE_SEM_VENDEDOR, chaveVendedor, rotuloVendedor } from "./filtrar-vendas";
import { metricasDe, mesBrasilia, type MetricasRecorte } from "./resumir-painel";
import { isNomeAutoAvaliar, type LinhaVendaMatriz } from "./tipos";

export type LinhaRankingVendedor = {
  /** Chave do filtro `vendedor=` (nome do NBS, ou CHAVE_AUTO_AVALIAR). */
  chave: string;
  nome: string;
  /** Auto Avaliar (leilão): fora do ranking, mas na tabela (entra no TOTAL do Delta, como na aba 8). */
  leilao: boolean;
  /** Vendas do MÊS SELECIONADO (0 = só aparece por ter venda nos meses fechados). */
  metricas: MetricasRecorte;
  /** Fração das vendas do mês (consignado incluso, como o KPI Vendas). */
  participacao: number;
  /** `null` quando não há meses fechados antes do mês selecionado. */
  mediaUltimos3: number | null;
  mediaAnteriores: number | null;
  delta: number | null;
};

export type MetricaRanking = "vendas" | "margem" | "margemPct" | "ticket";

export type RankingVendedores = {
  /** Ranking do mês: vendedores humanos com venda no mês selecionado. */
  vendedores: LinhaRankingVendedor[];
  /**
   * Tabela de vendas e médias: UNIÃO de quem vendeu no mês com quem está na matriz da aba 8
   * (meses fechados), Auto Avaliar numa linha própria. Assim a soma dos deltas = TOTAL do
   * DELTA do Excel quando o mês selecionado é o corrente.
   */
  tabela: LinhaRankingVendedor[];
  /** Soma dos deltas da tabela (`null` sem Bloco A). */
  somaDeltas: number | null;
  autoAvaliar: MetricasRecorte | null;
  semVendedor: MetricasRecorte | null;
  totalMes: number;
  /** Matriz "como no Excel" (aba 8) com o mês selecionado como referência. `null` = ano ainda não carregado. */
  matriz: MatrizMediaVendedor | null;
};

/** Vendas do ano (linhas de `montarLinhasAno`) no formato da aba 8, só até o ano/mês dado. */
export function vendasParaMedia(linhasAno: LinhaVendaMatriz[]): VendaParaMediaVendedor[] {
  return linhasAno.map((l) => ({ vendedorNome: l.vendedorNome, dataVenda: l.dataVenda }));
}

export function matrizDoMesSelecionado(linhasAno: LinhaVendaMatriz[], mesSelecionado: number): MatrizMediaVendedor {
  // Só meses ANTERIORES ao selecionado entram (calcularMatrizMediaVendedor já corta), então
  // linhas do mês selecionado/posteriores não mudam nada — filtro aqui só por clareza.
  const anteriores = linhasAno.filter((l) => l.dataVenda != null && mesBrasilia(l.dataVenda) < mesSelecionado);
  return calcularMatrizMediaVendedor(mesSelecionado, vendasParaMedia(anteriores));
}

/** Mesma chave do filtro `vendedor=` a partir do nome da matriz (aba 8 ignora venda sem vendedor). */
function chaveDoNome(nome: string): string {
  return isNomeAutoAvaliar(nome) ? CHAVE_AUTO_AVALIAR : nome.trim();
}

export function rankingVendedores(linhasMes: LinhaVendaMatriz[], matriz: MatrizMediaVendedor | null): RankingVendedores {
  type Grupo = { nome: string; linhas: LinhaVendaMatriz[]; daMatriz: LinhaMatrizMediaVendedor[] };
  const grupos = new Map<string, Grupo>();
  const grupo = (k: string, nome: string): Grupo => {
    let g = grupos.get(k);
    if (!g) {
      g = { nome: k === CHAVE_AUTO_AVALIAR ? rotuloVendedor(k) : nome, linhas: [], daMatriz: [] };
      grupos.set(k, g);
    }
    return g;
  };
  for (const l of linhasMes) {
    const k = chaveVendedor(l);
    if (k === CHAVE_SEM_VENDEDOR) continue;
    grupo(k, l.vendedorNome ?? k).linhas.push(l);
  }
  for (const v of matriz?.vendedores ?? []) grupo(chaveDoNome(v.vendedor), v.vendedor).daMatriz.push(v);

  const totalMes = linhasMes.length;
  const temMedias = matriz != null && matriz.nFechados > 0;
  const temA = temMedias && matriz.temBlocoA;
  // Médias/delta são lineares por vendedor: um grupo com mais de um nome na matriz (ex.:
  // grafias do Auto Avaliar) soma as linhas — e a soma dos deltas continua a do Excel.
  const somar = (g: Grupo, f: (v: LinhaMatrizMediaVendedor) => number | null): number => g.daMatriz.reduce((s, v) => s + (f(v) ?? 0), 0);

  const tabela: LinhaRankingVendedor[] = [...grupos.entries()].map(([k, g]) => ({
    chave: k,
    nome: g.nome,
    leilao: k === CHAVE_AUTO_AVALIAR,
    metricas: metricasDe(g.linhas),
    participacao: totalMes > 0 ? g.linhas.length / totalMes : 0,
    // Vendedor sem venda nos meses fechados: 0 em tudo (é o que a aba 8 mostraria).
    mediaUltimos3: temMedias ? somar(g, (v) => v.mediaB) : null,
    mediaAnteriores: temA ? somar(g, (v) => v.mediaA) : null,
    delta: temA ? somar(g, (v) => v.delta) : null,
  }));

  const aa = grupos.get(CHAVE_AUTO_AVALIAR);
  const sem = linhasMes.filter((l) => chaveVendedor(l) === CHAVE_SEM_VENDEDOR);
  return {
    vendedores: ordenarRanking(
      tabela.filter((v) => !v.leilao && v.metricas.qtd > 0),
      "vendas",
    ),
    tabela: ordenarRanking(tabela, "vendas"),
    // = soma dos deltas da tabela: quem vendeu só no mês tem delta 0, e a soma é feita na ordem
    // da aba 8 (mesmo float da célula TOTAL do DELTA do Excel).
    somaDeltas: temA ? matriz.somaDeltas : null,
    autoAvaliar: aa && aa.linhas.length > 0 ? metricasDe(aa.linhas) : null,
    semVendedor: sem.length > 0 ? metricasDe(sem) : null,
    totalMes,
    matriz,
  };
}

export function valorMetrica(v: LinhaRankingVendedor, metrica: MetricaRanking): number | null {
  if (metrica === "vendas") return v.metricas.qtd;
  if (metrica === "margem") return v.metricas.margem;
  if (metrica === "margemPct") return v.metricas.margemPct;
  return v.metricas.ticket;
}

/** Maior primeiro; sem valor (ex.: só consignadas) no fim; desempate por nome. */
export function ordenarRanking(vendedores: LinhaRankingVendedor[], metrica: MetricaRanking): LinhaRankingVendedor[] {
  return [...vendedores].sort((a, b) => {
    const va = valorMetrica(a, metrica);
    const vb = valorMetrica(b, metrica);
    if (va == null && vb != null) return 1;
    if (vb == null && va != null) return -1;
    if (va != null && vb != null && va !== vb) return vb - va;
    return a.nome.localeCompare(b.nome, "pt-BR");
  });
}
