/**
 * resumo_executivo (doc §5, tool 6) e listar_lojas (tool 7).
 */
import { compactarBundle, montarBundle } from "@/lib/analytics/insights";
import { definirTool } from "@cerebro/tools/definicao";
import { extremosDatas, filtrarPorPeriodo, frescorDados, todasLojas, zData } from "@cerebro/tools/comum";

export const resumoExecutivo = definirTool({
  nome: "resumo_executivo",
  descricao:
    "Diagnóstico completo (o mesmo pacote de indicadores da tela Insights, em versão compacta): sumário com margem " +
    "real e dependência de bônus, ranking de lojas/marcas, piores e melhores modelos e vendedores, giro, vendas por " +
    "mês, estoque em risco, estoque por loja/marca, classificação show room/repasse e análise FIPE. " +
    "Ponto de partida para \"faça uma análise completa\". Período opcional (YYYY-MM-DD) só filtra as vendas.",
  entrada: {
    inicio: zData.optional(),
    fim: zData.optional(),
  },
  executar(args, ctx) {
    const d = ctx.snapshot.datasets;
    const vendas = filtrarPorPeriodo(d.vendas, args);
    const bundle = compactarBundle(montarBundle(vendas, d.custosPorPlaca, d.veiculos, d.fipe, d.cautelares));
    return {
      periodo: { inicio: args.inicio ?? null, fim: args.fim ?? null, ...extremosDatas(vendas) },
      bundle,
      dados: frescorDados(ctx),
    };
  },
});

export const listarLojas = definirTool({
  nome: "listar_lojas",
  descricao: "Lista as lojas (cod_empresa, nome, cidade, ativo) com a quantidade de carros em estoque e de vendas carregadas.",
  entrada: {},
  executar(_args, ctx) {
    const s = ctx.snapshot;
    const cadastro = new Map(s.lojasCadastro.map((l) => [l.cod_empresa, l]));
    const qtEstoque = new Map<number, number>();
    for (const v of s.datasets.veiculos) qtEstoque.set(v.cod_empresa, (qtEstoque.get(v.cod_empresa) ?? 0) + 1);
    const qtVendas = new Map<number, number>();
    for (const v of s.datasets.vendas) qtVendas.set(v.cod_empresa, (qtVendas.get(v.cod_empresa) ?? 0) + 1);
    return {
      lojas: todasLojas(s).map((l) => {
        const c = cadastro.get(l.cod_empresa);
        return {
          cod_empresa: l.cod_empresa,
          nome: l.nome,
          cidade: c?.cidade || s.datasets.lojas[l.cod_empresa]?.cidade || null,
          ativo: c ? c.ativo : null,
          qt_estoque: qtEstoque.get(l.cod_empresa) ?? 0,
          qt_vendas: qtVendas.get(l.cod_empresa) ?? 0,
        };
      }),
      dados: frescorDados(ctx),
    };
  },
});
