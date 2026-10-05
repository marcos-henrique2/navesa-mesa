/**
 * VENDAS USADOS MATRIZ — tipos compartilhados.
 *
 * `LinhaVendaMatriz` é a linha "achatada" que alimenta as abas 1 e 2 (o mesmo
 * renderer é usado pelas duas — a única diferença é o subconjunto de linhas).
 * Os campos aqui são os valores BRUTOS (K, L, N, O, S, U, W, Y…); as colunas
 * calculadas (M, P, Q, R, T, V, X, Z, AA, AB) são sempre fórmulas de verdade
 * escritas pelo renderer — nunca persistidas aqui.
 */

import { calcularCustoReal } from "@/lib/export/custo-real";

export type LinhaVendaMatriz = {
  /** Join key (não normalizado — é o valor bruto do NBS, só pra rastreio). */
  chassi: string;
  placa: string;

  // C — Loja de Origem (via veiculos_origem + mapa cod_empresa→nome)
  lojaOrigemNome: string;
  /** `null` quando o chassi não tem snapshot de estoque conhecido (origem desconhecida). */
  lojaOrigemCodEmpresa: number | null;

  // D..H — identidade do veículo
  descricaoVeiculo: string;
  cor: string | null;
  marca: string | null;
  /** Formatado "AA/AA" (ano_fabricacao/ano_modelo), ou "" se algum dos dois faltar. */
  anoModelo: string;

  // I..J
  km: number | null;
  diasEstoque: number | null;

  // K..L — entrada
  nfEntrada: number | null;
  valoriza: number | null;

  // N — FIPE (só preenchido quando fipe_batch.plausibilidade_verificada === true)
  valorFipe: number | null;

  // O — venda
  valorVenda: number | null;

  // S, U, W, Y — custos
  despesaGeral: number | null;
  forplan: number | null;
  impostos: number | null;
  comissao: number | null;

  // AC..AG — flags e identificação
  usadoNaTroca: boolean;
  /** `null` = não sabemos (nunca tratar como "não financiou"). */
  financiou: boolean | null;
  clienteNome: string;
  /** `true` = PJ ("SIM"), `false` = PF ("NÃO"), `null` = tipo desconhecido (célula vazia). */
  lojista: boolean | null;
  vendedorNome: string | null;

  /**
   * Venda de veículo consignado (NBS.VEICULOS.CONSIGNATO, ver migration 042 e
   * sync-vendas.ts). Nunca `null` — sempre um boolean conhecido.
   *
   * RESSALVA (decisão @aria-architect, 02/10/2026): pra vendas consignadas,
   * `custo_total_final`/`margem_pct` do Oracle não representam lucro de
   * estoque de verdade (a revenda nunca foi dona do carro — é quase
   * literalmente "preço de venda + comissão"). Por isso os blocos de MARGEM
   * do relatório (aba-margens.ts e as margens derivadas em gerar-workbook.ts)
   * excluem `consignado === true` explicitamente; os blocos de CONTAGEM (aba
   * RESUMO) incluem normalmente.
   */
  consignado: boolean;
};

/** Resultado de M (Custo Real), Q (Lucro Bruto) e AA (Margem Líquida) pra uma linha. */
export type DerivadosLinha = {
  custoReal: number | null;
  lucroBruto: number | null;
  margemLiquida: number | null;
};

/**
 * Replica exatamente as fórmulas de M, Q e AA (ver colunas.ts) em JS, pra cachear
 * o `result` de cada célula de fórmula e pra alimentar os totais das abas de
 * margens sem duplicar a regra de cálculo em três lugares.
 */
export function calcularDerivadosLinha(l: LinhaVendaMatriz): DerivadosLinha {
  // M = K - L — fórmula compartilhada com colunas-estoque.ts (coluna `custo_real`),
  // ver custo-real.ts.
  const custoReal = calcularCustoReal(l.nfEntrada, l.valoriza);

  // Q = O - M
  const lucroBruto = l.valorVenda != null && custoReal != null ? l.valorVenda - custoReal : null;

  // AA = Q - S - U - W - Y
  const margemLiquida =
    lucroBruto != null
      ? lucroBruto - (l.despesaGeral ?? 0) - (l.forplan ?? 0) - (l.impostos ?? 0) - (l.comissao ?? 0)
      : null;

  return { custoReal, lucroBruto, margemLiquida };
}

/**
 * "Auto Avaliar" = venda por leilão sem vendedor humano. Regra confirmada com o Marcos:
 * `vendedor_nome ILIKE '%MOZAINEL%'` (o valor real no NBS é "MOZAINEL CORREA",
 * `vendedor_codigo` = "MOZAINIEL" — usamos o nome porque é o campo que chega em
 * `vendedorNome`). Trate sempre como categoria própria em qualquer lógica "por vendedor" —
 * nunca deixar cair no balde de um vendedor humano.
 */
export function isAutoAvaliar(l: LinhaVendaMatriz): boolean {
  return (l.vendedorNome ?? "").toUpperCase().includes("MOZAINEL");
}

/** Critérios de wildcard Excel equivalentes a `isAutoAvaliar`, pra COUNTIF/SUMIF/COUNTIFS
 * contra a coluna AG (Vendedor) da aba de detalhe — Excel aceita `<>` concatenado com
 * wildcard pra negar um "contém". */
export const CRITERIO_AUTO_AVALIAR = "*MOZAINEL*";
export const CRITERIO_NAO_AUTO_AVALIAR = "<>*MOZAINEL*";

export type ColetarVendasMatrizInput = {
  /** Loja "dona" do relatório (ex: 2 = Ford Aeroporto). Nunca hardcode — sempre parâmetro. */
  codEmpresa: number;
  /** 1-12 */
  mes: number;
  ano: number;
};

const NOMES_MESES = [
  "JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO",
  "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO",
] as const;

/** Nome do mês por extenso, maiúsculo, PT-BR (1=JANEIRO .. 12=DEZEMBRO). */
export function nomeMesExtenso(mes: number): string {
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) {
    throw new Error(`Mês inválido: ${mes}`);
  }
  return NOMES_MESES[mes - 1];
}

export type NomesAbasVendaMatriz = {
  /** "VENDAS USADOS {MES} MATRIZ" */
  aba1: string;
  /** "VENDAS {MES} SÓ ESTOQUE" */
  aba2: string;
  /** "RESUMO VENDAS MATRIZ {MES}" */
  aba3: string;
  aba4: string;
  aba5: string;
  aba6: string;
  aba7: string;
  aba8: string;
  aba9: string;
};

/**
 * Nomes das 9 abas do relatório, RESOLVIDO com o Marcos — nunca montar o nome de
 * uma aba na mão em outro lugar, sempre chamar esta função.
 *
 * `aba7`/`aba8`/`aba9` são nomes FIXOS (não dependem de mes/ano) — reproduzem
 * literalmente as abas do arquivo modelo, inclusive o espaço inicial de aba7.
 */
export function nomesAbas(mes: number, ano: number): NomesAbasVendaMatriz {
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) {
    throw new Error(`Ano inválido: ${ano}`);
  }
  const nomeMes = nomeMesExtenso(mes);
  return {
    aba1: `VENDAS USADOS ${nomeMes} MATRIZ`,
    aba2: `VENDAS ${nomeMes} SÓ ESTOQUE`,
    aba3: `RESUMO VENDAS MATRIZ ${nomeMes}`,
    aba4: "MARGENS",
    aba5: "MARGENS VENDAS LOJISTAS",
    aba6: "MARGENS VENDAS CLIENTES",
    aba7: " MÉDIA VENDEDOR 2025",
    aba8: "MEDIA 2026",
    aba9: "PLAY PLAN VENDEDOR INFLUENCER",
  };
}
