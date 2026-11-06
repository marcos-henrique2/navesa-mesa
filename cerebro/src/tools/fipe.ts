/**
 * comparar_fipe (doc §5, tool 5).
 *
 * Escopo `vendas` (Q6): `fipe_batch` é por chassi do ESTOQUE; em 06/11/2026 só
 * 162 de 3.460 vendas (4,7%) tinham chassi no batch. Com essa cobertura a
 * comparação em vendas seria enganosa, então a tool responde `nao_disponivel`
 * com a cobertura medida AO VIVO (o número se atualiza sozinho se melhorar).
 */
import { z } from "zod";
import { fipeAnaliseEstoque } from "@/lib/analytics/insights";
import { calcularDesvioFipe, itemFipeConfiavel } from "@/lib/fipe/confianca";
import { definirTool } from "@cerebro/tools/definicao";
import {
  ehErroLoja,
  filtrarVeiculos,
  filtroLoja,
  frescorDados,
  limitar,
  mapaNomesLoja,
  nomeLoja,
  zLimite,
  zLoja,
  zTextoFiltro,
} from "@cerebro/tools/comum";

export const compararFipe = definirTool({
  nome: "comparar_fipe",
  descricao:
    "Compara o preço anunciado do ESTOQUE com a FIPE confiável (match confirmado): desvio em R$ e %, dias de pátio. " +
    "Positivo = pedindo acima da FIPE. Carros sem FIPE confiável são contados à parte (sem_fipe). " +
    "Inclui as faixas da análise FIPE da tela Insights. Escopo 'vendas' ainda não é suportado.",
  entrada: {
    escopo: z.enum(["estoque", "vendas"]).default("estoque"),
    direcao: z.enum(["acima", "abaixo", "ambos"]).default("ambos"),
    desvio_min_pct: z.number().min(0).max(1000).default(10).describe("Desvio mínimo em % (absoluto). Default 10."),
    loja: zLoja,
    marca: zTextoFiltro.optional(),
    modelo: zTextoFiltro.optional(),
    limite: zLimite,
  },
  executar(args, ctx) {
    const d = ctx.snapshot.datasets;
    if (args.escopo === "vendas") {
      const comFipe = d.vendas.filter((v) => itemFipeConfiavel(d.fipe, v.chassi) != null).length;
      return {
        erro: "nao_disponivel",
        mensagem:
          "Comparação FIPE em vendas realizadas ainda não está disponível: a FIPE só existe para chassis que passaram " +
          "pelo estoque com o batch rodando, e a cobertura é baixa.",
        cobertura: { vendas_total: d.vendas.length, vendas_com_fipe_confiavel: comFipe },
      };
    }
    const fl = filtroLoja(ctx.snapshot, args.loja);
    if (ehErroLoja(fl)) return fl;
    const vs = filtrarVeiculos(d.veiculos, { cod: fl.cod, marca: args.marca, modelo: args.modelo });
    const nomes = mapaNomesLoja(ctx.snapshot);

    let semFipe = 0, semPreco = 0;
    const linhas = [];
    for (const v of vs) {
      const item = itemFipeConfiavel(d.fipe, v.chassi);
      if (!item) { semFipe++; continue; }
      const desv = calcularDesvioFipe(v.preco_venda, item.precoFipe);
      if (!desv) { semPreco++; continue; }
      if (Math.abs(desv.pct) < args.desvio_min_pct) continue;
      if (args.direcao === "acima" && desv.pct <= 0) continue;
      if (args.direcao === "abaixo" && desv.pct >= 0) continue;
      linhas.push({
        placa: v.placa,
        marca: v.marca,
        modelo: v.modelo,
        ano_modelo: v.ano_modelo,
        loja: { cod_empresa: v.cod_empresa, nome: nomeLoja(nomes, v.cod_empresa) },
        preco_venda: v.preco_venda,
        fipe: item.precoFipe,
        fipe_referencia: item.fipeReferencia,
        desvio_reais: desv.desvio,
        desvio_pct: desv.pct,
        dias_patio: v.dias_patio,
        custo_aquisicao: v.valor_aquisicao,
      });
    }
    linhas.sort((a, b) => Math.abs(b.desvio_pct) - Math.abs(a.desvio_pct));
    const lim = limitar(linhas, args.limite);
    const faixas = fipeAnaliseEstoque(vs, d.fipe);

    return {
      escopo: "estoque",
      filtros: {
        loja: fl.loja, marca: args.marca ?? null, modelo: args.modelo ?? null,
        direcao: args.direcao, desvio_min_pct: args.desvio_min_pct,
      },
      analisados: vs.length,
      sem_fipe: semFipe,
      sem_preco_venda: semPreco,
      total: lim.total,
      truncado: lim.truncado,
      itens: lim.itens,
      faixas: faixas
        ? {
            acima_10_pct: faixas.acima10Pct,
            acima_5_a_10_pct: faixas.acima5a10Pct,
            proximo_fipe: faixas.proximoFipe,
            abaixo_5_a_10_pct: faixas.abaixo5a10Pct,
            abaixo_10_pct: faixas.abaixo10Pct,
          }
        : null,
      dados: frescorDados(ctx),
    };
  },
});
