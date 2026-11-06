/**
 * Tools de estoque: resumo_estoque, carros_parados, buscar_veiculo (doc §5, 1-3).
 * Capital travado = `valor_aquisicao` (mesma regra de estoquePorLoja/estoquePorMarca).
 */
import { z } from "zod";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";
import type { VendaParsed } from "@/lib/parsers/nbs-vendas-xlsx";
import { estoquePorLoja, estoquePorMarca } from "@/lib/analytics/insights";
import { calcMargemVenda } from "@/lib/analytics/margem";
import { classificarPatio, type StatusVeiculo } from "@/lib/inventory/status";
import { estaReservado } from "@/lib/inventory/reservado";
import { classificarVeiculo, contarPorModelo } from "@/lib/pricing/classificacao";
import { calcularDesvioFipe, itemFipeConfiavel } from "@/lib/fipe/confianca";
import { normalizarPlaca } from "@/lib/utils/placa";
import { definirTool } from "@cerebro/tools/definicao";
import {
  contem,
  ehErroLoja,
  filtrarVeiculos,
  filtroLoja,
  frescorDados,
  isoDia,
  limitar,
  mapaNomesLoja,
  media,
  nomeLoja,
  zLimite,
  zLoja,
  zTextoFiltro,
  type ContextoTool,
} from "@cerebro/tools/comum";

export const SITUACOES = [
  "disponivel", "transito", "preparacao", "bloqueado", "oficina", "documentacao", "outro", "reservado",
] as const satisfies readonly (StatusVeiculo | "reservado")[];

export const FAIXAS_PATIO = [
  { faixa: "0-30", min: 0, max: 30 },
  { faixa: "31-60", min: 31, max: 60 },
  { faixa: "61-90", min: 61, max: 90 },
  { faixa: "91-180", min: 91, max: 180 },
  { faixa: "180+", min: 181, max: Number.POSITIVE_INFINITY },
] as const;

const capital = (v: VeiculoParsed) => v.valor_aquisicao ?? 0;
const soma = (vs: VeiculoParsed[], f: (v: VeiculoParsed) => number) => vs.reduce((a, v) => a + f(v), 0);
const chassiFinal = (c: string) => c.slice(-8);

function situacaoDe(v: VeiculoParsed): StatusVeiculo {
  return classificarPatio(v.patio);
}

/** Linha de veículo compartilhada por carros_parados e buscar_veiculo. */
function linhaVeiculo(v: VeiculoParsed, ctx: ContextoTool, nomes: Record<number, string>, contagem: Map<string, number>) {
  const d = ctx.snapshot.datasets;
  const fipe = itemFipeConfiavel(d.fipe, v.chassi);
  const desvio = calcularDesvioFipe(v.preco_venda, fipe?.precoFipe ?? null);
  const cautelar = d.cautelares[v.chassi] ?? null;
  const c = classificarVeiculo(v, { contagemPorModelo: contagem, cautelar });
  return {
    placa: v.placa,
    chassi_final: chassiFinal(v.chassi),
    marca: v.marca,
    modelo: v.modelo,
    ano_fabricacao: v.ano_fabricacao,
    ano_modelo: v.ano_modelo,
    km: v.km,
    loja: { cod_empresa: v.cod_empresa, nome: nomeLoja(nomes, v.cod_empresa) },
    patio: v.patio,
    situacao: situacaoDe(v),
    dias_patio: v.dias_patio,
    custo_aquisicao: v.valor_aquisicao,
    custo_total: v.custo_total,
    preco_venda: v.preco_venda,
    fipe: fipe ? { preco: fipe.precoFipe, referencia: fipe.fipeReferencia } : null,
    desvio_fipe: desvio ? { reais: desvio.desvio, pct: desvio.pct } : null,
    classificacao: { classe: c.classe, canal: c.canal, rebaixado_por_estoque: c.rebaixadoPorEstoque },
    cautelar,
    reservado: estaReservado(v),
  };
}

export const resumoEstoque = definirTool({
  nome: "resumo_estoque",
  descricao:
    "Resumo do estoque atual (snapshot mais recente): quantidade de carros, capital travado (custo de aquisição), " +
    "preço de venda total, dias de pátio médio, faixas de dias de pátio, quebra por loja e por marca, reservados. " +
    "Filtros opcionais: loja, marca, situacao.",
  entrada: {
    loja: zLoja,
    marca: zTextoFiltro.optional().describe("Marca exata, sem caixa (ex. \"ford\")."),
    situacao: z.enum(SITUACOES).optional()
      .describe("Situação de pátio (disponivel, preparacao, transito, bloqueado, oficina, documentacao, outro) ou reservado."),
  },
  executar(args, ctx) {
    const d = ctx.snapshot.datasets;
    const fl = filtroLoja(ctx.snapshot, args.loja);
    if (ehErroLoja(fl)) return fl;
    let vs = filtrarVeiculos(d.veiculos, { cod: fl.cod, marca: args.marca });
    if (args.situacao === "reservado") vs = vs.filter(estaReservado);
    else if (args.situacao) vs = vs.filter((v) => situacaoDe(v) === args.situacao);

    const nomes = mapaNomesLoja(ctx.snapshot);
    const comDias = vs.filter((v) => v.dias_patio != null);
    const faixas = FAIXAS_PATIO.map((f) => {
      const n = comDias.filter((v) => (v.dias_patio as number) >= f.min && (v.dias_patio as number) <= f.max);
      return { faixa: f.faixa, qt: n.length, capital_travado: soma(n, capital) };
    });
    const porSituacao: Record<string, number> = {};
    for (const v of vs) porSituacao[situacaoDe(v)] = (porSituacao[situacaoDe(v)] ?? 0) + 1;
    const reservados = vs.filter(estaReservado);
    const codPorNome = new Map<string, number>();
    for (const v of vs) codPorNome.set(nomeLoja(nomes, v.cod_empresa), v.cod_empresa);

    return {
      filtros: { loja: fl.loja, marca: args.marca ?? null, situacao: args.situacao ?? null },
      total_carros: vs.length,
      capital_travado: soma(vs, capital),
      custo_total_soma: soma(vs, (v) => v.custo_total ?? 0),
      preco_venda_total: soma(vs, (v) => v.preco_venda ?? 0),
      sem_preco_venda: vs.filter((v) => v.preco_venda == null).length,
      dias_patio_medio: media(comDias.map((v) => v.dias_patio as number)),
      sem_dias_patio: vs.length - comDias.length,
      acima_60_dias: comDias.filter((v) => (v.dias_patio as number) > 60).length,
      acima_90_dias: comDias.filter((v) => (v.dias_patio as number) > 90).length,
      faixas_dias_patio: faixas,
      por_situacao: porSituacao,
      reservados: { qt: reservados.length, capital_travado: soma(reservados, capital) },
      por_loja: estoquePorLoja(vs, nomes).map((l) => ({ cod_empresa: codPorNome.get(l.loja) ?? null, ...l })),
      por_marca: estoquePorMarca(vs),
      dados: frescorDados(ctx),
    };
  },
});

export const carrosParados = definirTool({
  nome: "carros_parados",
  descricao:
    "Lista carros parados no pátio há MAIS de `dias_min` dias (dias_patio > dias_min, mesmo critério do relatório " +
    "gerencial). Traz custo, preço, FIPE confiável e desvio, classificação show room/repasse, cautelar e reserva, " +
    "mais o total e o capital travado de TODO o filtro (não só das linhas devolvidas).",
  entrada: {
    dias_min: z.number().int().min(0).max(3650).default(60).describe("Parados há mais de N dias (default 60)."),
    loja: zLoja,
    marca: zTextoFiltro.optional(),
    modelo: zTextoFiltro.optional().describe("Parte do modelo (contém)."),
    ordenar: z.enum(["dias", "custo"]).default("dias"),
    limite: zLimite,
  },
  executar(args, ctx) {
    const d = ctx.snapshot.datasets;
    const fl = filtroLoja(ctx.snapshot, args.loja);
    if (ehErroLoja(fl)) return fl;
    const vs = filtrarVeiculos(d.veiculos, { cod: fl.cod, marca: args.marca, modelo: args.modelo })
      .filter((v) => v.dias_patio != null && v.dias_patio > args.dias_min);
    const ordenados = [...vs].sort((a, b) =>
      args.ordenar === "custo"
        ? capital(b) - capital(a)
        : (b.dias_patio as number) - (a.dias_patio as number),
    );
    const nomes = mapaNomesLoja(ctx.snapshot);
    const contagem = contarPorModelo(d.veiculos);
    const { itens, total, truncado } = limitar(ordenados, args.limite);
    return {
      filtros: { dias_min: args.dias_min, loja: fl.loja, marca: args.marca ?? null, modelo: args.modelo ?? null },
      total,
      truncado,
      capital_travado_total: soma(vs, capital),
      preco_venda_total: soma(vs, (v) => v.preco_venda ?? 0),
      itens: itens.map((v) => linhaVeiculo(v, ctx, nomes, contagem)),
      dados: frescorDados(ctx),
    };
  },
});

function vendaResumo(v: VendaParsed, ctx: ContextoTool) {
  const m = calcMargemVenda(v, ctx.snapshot.datasets.custosPorPlaca);
  return {
    placa: v.placa,
    chassi_final: chassiFinal(v.chassi),
    modelo: v.modelo,
    marca: v.marca,
    data_venda: isoDia(v.data_venda),
    loja: { cod_empresa: v.cod_empresa, nome: v.empresa_nome || `Loja ${v.cod_empresa}` },
    vendedor: v.vendedor_nome,
    valor_venda: m.valor,
    custo: m.custo,
    margem: m.margem,
    margem_pct: m.margemPct,
    margem_fonte: m.fonte,
    ganhos_indiretos: m.componentes?.ganhos_indiretos ?? null,
    dias_estoque: v.dias_estoque,
    teve_troca: !!v.placa_troca,
  };
}

export const buscarVeiculo = definirTool({
  nome: "buscar_veiculo",
  descricao:
    "Ficha completa de veículo(s) do estoque por placa, chassi (ou final) ou parte do modelo. " +
    "Com incluir_vendidos=true também busca nas vendas (data, valor, margem real, vendedor).",
  entrada: {
    termo: z.string().trim().min(2).max(60).describe("Placa (com ou sem hífen), chassi/final do chassi ou parte do modelo."),
    incluir_vendidos: z.boolean().default(false),
    limite: zLimite.default(10),
  },
  executar(args, ctx) {
    const d = ctx.snapshot.datasets;
    const id = normalizarPlaca(args.termo);
    const casaId = (placa: string | null, chassi: string) =>
      id.length >= 4 && (normalizarPlaca(placa) === id || normalizarPlaca(chassi).endsWith(id));
    const porId = d.veiculos.filter((v) => casaId(v.placa, v.chassi));
    const estoque = porId.length > 0 ? porId : d.veiculos.filter((v) => contem(v.modelo, args.termo));

    const nomes = mapaNomesLoja(ctx.snapshot);
    const contagem = contarPorModelo(d.veiculos);
    const lim = limitar(estoque, args.limite);
    const itens = lim.itens.map((v) => {
      const ce = d.custosEstoquePorPlaca[normalizarPlaca(v.placa)];
      return {
        ...linhaVeiculo(v, ctx, nomes, contagem),
        chassi: v.chassi,
        cor: v.cor_externa,
        combustivel: v.combustivel,
        descricao_situacao: v.descricao_situacao,
        data_entrada: isoDia(v.data_entrada),
        valoriza: v.valoriza,
        custos_estoque_detalhado: ce
          ? {
              nota_fabrica: ce.nota_fabrica, revisoes: ce.revisoes, forplan: ce.forplan, holdback: ce.holdback,
              acessorios: ce.acessorios, adm: ce.adm, impostos: ce.impostos, comissoes: ce.comissoes,
              desp_gerais: ce.desp_gerais, custo_total: ce.custo_total, bonus: ce.bonus,
              ganhos_indiretos: ce.ganhos_indiretos,
            }
          : null,
      };
    });

    let vendidos: ReturnType<typeof limitar<ReturnType<typeof vendaResumo>>> | null = null;
    if (args.incluir_vendidos) {
      const porIdV = d.vendas.filter((v) => casaId(v.placa, v.chassi));
      const vs = porIdV.length > 0 ? porIdV : d.vendas.filter((v) => contem(v.modelo, args.termo));
      const ord = [...vs].sort((a, b) => (b.data_venda?.getTime() ?? 0) - (a.data_venda?.getTime() ?? 0));
      vendidos = limitar(ord.map((v) => vendaResumo(v, ctx)), args.limite);
    }

    return {
      termo: args.termo,
      busca_por: porId.length > 0 ? "placa_ou_chassi" : "modelo",
      estoque: { total: lim.total, truncado: lim.truncado, itens },
      vendidos,
      dados: frescorDados(ctx),
    };
  },
});
