/**
 * Núcleo PURO da Conferência Auto Avaliar.
 *
 * Semanalmente o Marcos exporta o relatório "Veículos em Oferta" do Auto
 * Avaliar e confere manualmente cada placa contra o estoque/vendas reais do
 * NBS pra saber quais carros já venderam e podem sair do anúncio. Esta tela
 * automatiza exatamente essa conferência.
 *
 * ⚠️ DIFERENTE de `/repasses/importar`: aquela tela sincroniza só os carros
 * marcados deliberadamente pra "repasse" (subconjunto, canal='auto_avaliar')
 * e GRAVA no banco via RPC. Esta aqui é mais ampla — confere TODO o arquivo,
 * de qualquer loja, contra `vendas` e `veiculos_atual` — e é 100% leitura:
 * nunca grava nada em lugar nenhum.
 *
 * Por isso o universo de entrada é `linhas` (loja alvo, detalhe completo) MAIS
 * `outra_loja` (demais lojas do arquivo, só placa/modelo) — todo mundo que
 * apareceu no relatório, não só a Matriz.
 *
 * 100% PURO: sem I/O, sem Date, sem rede, sem banco. A camada de busca no
 * Supabase mora em `queries.ts`.
 */

import type { LinhaOfertaAA, LinhaOutraLoja, OfertasParseOk } from "@/lib/parsers/auto-avaliar-ofertas-xls";

// ─── Tipos ───────────────────────────────────────────────────────────────────

/** Uma linha do arquivo, já achatada — de qualquer loja. */
export type EntradaConferencia = {
  /** Nº da linha no arquivo (1-based, cabeçalho incluso) — igual ao que `linha` reporta lá. */
  linha: number;
  loja: string;
  /**
   * Placa como apareceu no arquivo. Pra linhas de "outra loja" o parser não
   * preserva o formato original (só `placa_norm`) — aqui cai pra `placa_norm`
   * mesmo, que já é exibível (maiúsculas, alfanumérico).
   */
  placa_raw: string;
  placa_norm: string;
  marca: string | null;
  modelo: string | null;
};

export type StatusConferencia = "vendido" | "estoque" | "nao_encontrado";

/** Dados da venda, só presentes quando `status === "vendido"`. */
export type VendaRefConferencia = {
  valor_venda: number | null;
  /** YYYY-MM-DD (data pura, sem hora). */
  data_venda: string | null;
  cliente_nome: string | null;
  vendedor_nome: string | null;
};

export type ItemConferencia = {
  entrada: EntradaConferencia;
  status: StatusConferencia;
  /** Só não-null quando `status === "vendido"`. */
  venda: VendaRefConferencia | null;
};

export type ResumoConferencia = {
  total: number;
  vendidos: number;
  em_estoque: number;
  nao_encontrados: number;
};

export type ResultadoConferencia = {
  itens: ItemConferencia[];
  resumo: ResumoConferencia;
};

// ─── Achatamento do parser ────────────────────────────────────────────────────

/**
 * Junta `linhas` (loja alvo, detalhe completo) e `outra_loja` (demais lojas,
 * só placa/modelo) num único universo, ordenado pela ordem do arquivo.
 *
 * É essa junção — e não só `linhas` — que torna esta conferência "mais ampla"
 * que o sync de repasses: aqui interessa TODO carro que apareceu no relatório,
 * de qualquer loja, não só o que seria sincronizado como repasse da Matriz.
 */
export function entradasDoParse(parse: Pick<OfertasParseOk, "linhas" | "outra_loja">): EntradaConferencia[] {
  const daLojaAlvo: EntradaConferencia[] = parse.linhas.map((l: LinhaOfertaAA) => ({
    linha: l.linha,
    loja: l.loja,
    placa_raw: l.placa_raw,
    placa_norm: l.placa_norm,
    marca: l.marca,
    modelo: l.modelo,
  }));
  const deOutraLoja: EntradaConferencia[] = parse.outra_loja.map((l: LinhaOutraLoja) => ({
    linha: l.linha,
    loja: l.loja,
    placa_raw: l.placa_norm,
    placa_norm: l.placa_norm,
    marca: null,
    modelo: l.modelo,
  }));
  return [...daLojaAlvo, ...deOutraLoja].sort((a, b) => a.linha - b.linha);
}

// ─── Classificação ────────────────────────────────────────────────────────────

/**
 * Classifica cada entrada contra os dados já resolvidos do banco:
 *   1. Achou em `vendas` (por placa_norm) → VENDIDO, com os dados da venda.
 *   2. Senão, achou em `veiculos_atual` → EM ESTOQUE (ainda ativo, nada a fazer).
 *   3. Senão → NÃO ENCONTRADO (divergência de cadastro — raro, mas acontece).
 *
 * A ordem importa: um carro pode estar em `vendas` E ainda aparecer em
 * `veiculos_atual` por atraso de sync — vendido tem prioridade, é o dado mais
 * forte (fato consumado) sobre o mais fraco (ainda não sincronizado como saída).
 */
export function classificarConferencia(
  entradas: ReadonlyArray<EntradaConferencia>,
  vendaPorPlaca: ReadonlyMap<string, VendaRefConferencia>,
  placasEmEstoque: ReadonlySet<string>,
): ResultadoConferencia {
  const itens: ItemConferencia[] = entradas.map((entrada) => {
    const venda = vendaPorPlaca.get(entrada.placa_norm) ?? null;
    if (venda) return { entrada, status: "vendido", venda };
    if (placasEmEstoque.has(entrada.placa_norm)) return { entrada, status: "estoque", venda: null };
    return { entrada, status: "nao_encontrado", venda: null };
  });

  const resumo: ResumoConferencia = {
    total: itens.length,
    vendidos: itens.filter((i) => i.status === "vendido").length,
    em_estoque: itens.filter((i) => i.status === "estoque").length,
    nao_encontrados: itens.filter((i) => i.status === "nao_encontrado").length,
  };

  return { itens, resumo };
}

// ─── Rótulos (pt-BR) ──────────────────────────────────────────────────────────

export const ROTULO_STATUS_CONFERENCIA: Record<StatusConferencia, string> = {
  vendido: "Vendido",
  estoque: "Em estoque",
  nao_encontrado: "Não encontrado",
};
