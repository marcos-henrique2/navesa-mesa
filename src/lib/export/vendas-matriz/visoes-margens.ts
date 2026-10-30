/**
 * VENDAS USADOS MATRIZ — aba "Margens" do painel, em formato DRE, com 3 visões:
 * - "Total e origem"         = aba 4 MARGENS (+ coluna "Não identificada", fora do Excel).
 * - "Pessoa física × jurídica" = nova (cliente_tipo, como o Resumo).
 * - "Comprador recorrente"   = abas 5/6 (regra `lojista` do Excel).
 *
 * Toda coluna que existe no Excel usa o MESMO subconjunto (`separarBlocosMargens`) e a MESMA
 * conta (`calcularMetricasBloco`) do renderer da planilha → igual ao centavo ao `result`
 * cacheado de cada fórmula. Consignado fica fora de toda coluna.
 */

import { calcularMetricasBloco, type MetricasBlocoMargens } from "./aba-margens";
import { separarBlocosMargens } from "./blocos-margens";
import { CUSTOS_LINHA, type CustoLinha, type FiltrosVendas } from "./filtrar-vendas";
import { classificarComprador, type CompradorChave } from "./resumir-painel";
import { calcularDerivadosLinha, classificarOrigem, type LinhaVendaMatriz, type OrigemChave } from "./tipos";

// ═══════════════════════════════════════════════════════════════════════════
// Cobertura de custos
// ═══════════════════════════════════════════════════════════════════════════

export type CoberturaCustos = {
  /** Vendas consideradas (sempre sem consignadas). */
  total: number;
  /** Vendas com os 5 custos lançados. */
  completas: number;
  porCusto: Record<CustoLinha, number>;
  /** Sem NF de entrada → sem custo real → sem lucro bruto/margem (fica fora da soma). */
  semNfEntrada: number;
};

/**
 * Custo não lançado entra como ZERO na margem líquida, igual ao Excel — a conta não muda,
 * o painel só mostra quantas vendas estão completas.
 */
export function coberturaCustos(linhas: LinhaVendaMatriz[]): CoberturaCustos {
  const sem = linhas.filter((l) => !l.consignado);
  const porCusto = Object.fromEntries(CUSTOS_LINHA.map((c) => [c, sem.filter((l) => l[c] != null).length])) as Record<CustoLinha, number>;
  return {
    total: sem.length,
    completas: sem.filter((l) => CUSTOS_LINHA.every((c) => l[c] != null)).length,
    porCusto,
    semNfEntrada: sem.filter((l) => calcularDerivadosLinha(l).custoReal == null).length,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Colunas
// ═══════════════════════════════════════════════════════════════════════════

export type VisaoMargensChave = "origem" | "pfpj" | "recorrente";

export type CorColunaMargem = OrigemChave | "total" | "pf" | "pj" | "neutro";

export type ColunaMargem = {
  id: string;
  titulo: string;
  /** Nome do bloco na planilha (pra quem confere) — `null` quando não existe no Excel. */
  blocoExcel: string | null;
  /** Coluna sem equivalente no Excel / parcela de reconciliação → visual muted. */
  secundaria: boolean;
  cor: CorColunaMargem;
  tooltip: string | null;
  metricas: MetricasBlocoMargens;
  cobertura: CoberturaCustos;
  /** Filtro equivalente na aba Vendas (sempre sem consignado). */
  filtro: Partial<FiltrosVendas>;
};

function coluna(
  id: string,
  titulo: string,
  linhas: LinhaVendaMatriz[],
  filtro: Partial<FiltrosVendas>,
  opts: { blocoExcel?: string; secundaria?: boolean; cor: CorColunaMargem; tooltip?: string },
): ColunaMargem {
  return {
    id,
    titulo,
    blocoExcel: opts.blocoExcel ?? null,
    secundaria: opts.secundaria ?? false,
    cor: opts.cor,
    tooltip: opts.tooltip ?? null,
    metricas: calcularMetricasBloco(linhas),
    cobertura: coberturaCustos(linhas),
    filtro: { consig: "sem", ...filtro },
  };
}

export const TOOLTIP_NAO_IDENTIFICADA =
  "Vendas sem registro de entrada no estoque do grupo. O Excel deixa essas vendas fora dos blocos Próprio e Outras; aparecem aqui pra que Próprio + Outras + Não identificada = Total.";

/** Uma parcela da reconciliação ("12 vendas sem CPF/CNPJ no cadastro"). */
export type ParcelaReconciliacao = { rotulo: string; qtd: number; margem: number };

export type VisaoMargens = {
  chave: VisaoMargensChave;
  colunas: ColunaMargem[];
  /** Vendas do mês sem consignadas (= Qtde do bloco "VENDIDO TOTAL"). */
  totalSemConsig: number;
  margemTotal: number;
  qtdConsignadas: number;
  /** Soma das colunas que entram na reconciliação (todas menos "Total"). */
  somaColunas: { qtd: number; margem: number };
  /** Vendas que ficam de fora das colunas desta visão (só na visão do Excel). */
  foraDaVisao: ParcelaReconciliacao[];
};

function reconciliar(colunas: ColunaMargem[]): { qtd: number; margem: number } {
  const partes = colunas.filter((c) => c.id !== "total");
  return {
    qtd: partes.reduce((s, c) => s + c.metricas.qtdeFaturados, 0),
    margem: partes.reduce((s, c) => s + c.metricas.margemLiquidaTotal, 0),
  };
}

function montarVisao(
  chave: VisaoMargensChave,
  colunas: ColunaMargem[],
  linhasMes: LinhaVendaMatriz[],
  foraDaVisao: ParcelaReconciliacao[] = [],
): VisaoMargens {
  const total = calcularMetricasBloco(linhasMes.filter((l) => !l.consignado));
  return {
    chave,
    colunas,
    totalSemConsig: total.qtdeFaturados,
    margemTotal: total.margemLiquidaTotal,
    qtdConsignadas: linhasMes.filter((l) => l.consignado).length,
    somaColunas: reconciliar(colunas),
    foraDaVisao,
  };
}

/** Visão "Total e origem" = aba 4 MARGENS, mais a coluna "Não identificada" (some se 0). */
export function visaoTotalOrigem(linhasMes: LinhaVendaMatriz[], codEmpresa: number): VisaoMargens {
  const b = separarBlocosMargens(linhasMes, codEmpresa);
  const naoIdent = b.total.filter((l) => classificarOrigem(l, codEmpresa) === "naoIdentificada");
  const colunas = [
    coluna("total", "Total", b.total, {}, { blocoExcel: "VENDIDO TOTAL NAVESA AEROPORTO", cor: "total" }),
    coluna("proprio", "Próprio", b.proprio, { origem: "proprio" }, { blocoExcel: "VENDIDO SOMENTE ESTOQUE NAVESA AEROPORTO", cor: "proprio" }),
    coluna("outras", "Outras lojas", b.outras, { origem: "outras" }, { blocoExcel: "VENDIDO NAVESA - ESTOQUES OUTRAS LOJAS", cor: "outras" }),
  ];
  if (naoIdent.length > 0) {
    colunas.push(
      coluna("naoIdentificada", "Não identificada", naoIdent, { origem: "naoIdentificada" }, {
        secundaria: true,
        cor: "naoIdentificada",
        tooltip: TOOLTIP_NAO_IDENTIFICADA,
      }),
    );
  }
  return montarVisao("origem", colunas, linhasMes);
}

const ROTULO_COMPRADOR: Record<CompradorChave, string> = {
  pf: "Pessoa física",
  pj: "Pessoa jurídica",
  autoAvaliar: "Auto Avaliar",
  naoInformado: "Não informado",
};
const ROTULO_ORIGEM_COL: Record<OrigemChave, string> = { proprio: "Próprio", outras: "Outras", naoIdentificada: "Não ident." };

/**
 * Visão "Pessoa física × jurídica" (cliente_tipo, mesma regra do Resumo): PF + PJ + Auto
 * Avaliar + Não informado = Total. `abrirPorOrigem` quebra PF e PJ por origem (a parcela
 * "não identificada" aparece só se > 0, pra a soma continuar fechando).
 */
export function visaoPfPj(linhasMes: LinhaVendaMatriz[], codEmpresa: number, abrirPorOrigem: boolean): VisaoMargens {
  const sem = separarBlocosMargens(linhasMes, codEmpresa).total;
  const de = (c: CompradorChave) => sem.filter((l) => classificarComprador(l) === c);
  const colunas: ColunaMargem[] = [coluna("total", "Total", sem, {}, { blocoExcel: "VENDIDO TOTAL NAVESA AEROPORTO", cor: "total" })];
  for (const c of ["pf", "pj"] as const) {
    if (!abrirPorOrigem) {
      colunas.push(coluna(c, ROTULO_COMPRADOR[c], de(c), { comprador: [c] }, { cor: c }));
      continue;
    }
    for (const o of ["proprio", "outras", "naoIdentificada"] as const) {
      const linhas = de(c).filter((l) => classificarOrigem(l, codEmpresa) === o);
      if (o === "naoIdentificada" && linhas.length === 0) continue;
      colunas.push(
        coluna(`${c}-${o}`, `${c.toUpperCase()} · ${ROTULO_ORIGEM_COL[o]}`, linhas, { comprador: [c], origem: o }, {
          cor: c,
          secundaria: o === "naoIdentificada",
        }),
      );
    }
  }
  colunas.push(
    coluna("autoAvaliar", ROTULO_COMPRADOR.autoAvaliar, de("autoAvaliar"), { comprador: ["autoAvaliar"] }, {
      secundaria: true,
      cor: "neutro",
      tooltip: "Vendas por leilão na plataforma Auto Avaliar, fora de PF e PJ (igual ao Resumo).",
    }),
    coluna("naoInformado", ROTULO_COMPRADOR.naoInformado, de("naoInformado"), { comprador: ["naoInformado"] }, {
      secundaria: true,
      cor: "neutro",
      tooltip: "Cliente sem tipo (CPF ou CNPJ) preenchido nos dados importados do NBS.",
    }),
  );
  return montarVisao("pfpj", colunas, linhasMes);
}

export const NOTA_REGRA_RECORRENTE =
  "Regra do Excel: mais de 2 compras no ano com o mesmo CPF/CNPJ — não é o mesmo que pessoa jurídica.";

/**
 * Visão "Comprador recorrente (lojista) × Cliente final" = abas 5 e 6, 4 colunas na ordem do
 * Excel. Fora dela, como no Excel: vendas sem CPF/CNPJ (`lojista = null`) e origem não
 * identificada — sempre reconciliado no rodapé.
 */
export function visaoRecorrente(linhasMes: LinhaVendaMatriz[], codEmpresa: number): VisaoMargens {
  const b = separarBlocosMargens(linhasMes, codEmpresa);
  const colunas = [
    coluna("lojistaOutras", "Recorrente · outras lojas", b.lojistaOutras, { lojista: "sim", origem: "outras" }, {
      blocoExcel: "VENDIDO REPASSE OUTROS ESTOQUES",
      cor: "outras",
    }),
    coluna("lojistaPropria", "Recorrente · estoque Navesa", b.lojistaPropria, { lojista: "sim", origem: "proprio" }, {
      blocoExcel: "VENDIDO REPASSE ESTOQUE NAVESA",
      cor: "proprio",
    }),
    coluna("clientePropria", "Cliente final · estoque Navesa", b.clientePropria, { lojista: "nao", origem: "proprio" }, {
      blocoExcel: "VENDIDO CLIENTE FINAL ESTOQUE NAVESA",
      cor: "proprio",
    }),
    coluna("clienteOutras", "Cliente final · outras lojas", b.clienteOutras, { lojista: "nao", origem: "outras" }, {
      blocoExcel: "VENDIDO CLIENTE FINAL OUTROS ESTOQUES",
      cor: "outras",
    }),
  ];
  const semDoc = b.total.filter((l) => l.lojista == null);
  const naoIdent = b.total.filter((l) => l.lojista != null && classificarOrigem(l, codEmpresa) === "naoIdentificada");
  const parcela = (rotulo: string, linhas: LinhaVendaMatriz[]): ParcelaReconciliacao => {
    const m = calcularMetricasBloco(linhas);
    return { rotulo, qtd: m.qtdeFaturados, margem: m.margemLiquidaTotal };
  };
  return montarVisao("recorrente", colunas, linhasMes, [
    parcela("sem CPF/CNPJ no cadastro", semDoc),
    parcela("de origem não identificada", naoIdent),
  ]);
}

export function visaoMargens(chave: VisaoMargensChave, linhasMes: LinhaVendaMatriz[], codEmpresa: number, abrirPorOrigem = false): VisaoMargens {
  if (chave === "pfpj") return visaoPfPj(linhasMes, codEmpresa, abrirPorOrigem);
  if (chave === "recorrente") return visaoRecorrente(linhasMes, codEmpresa);
  return visaoTotalOrigem(linhasMes, codEmpresa);
}
