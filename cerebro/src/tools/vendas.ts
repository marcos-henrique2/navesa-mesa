/**
 * vendas_periodo (doc §5, tool 4).
 *
 * Margem SEMPRE pela fórmula canônica: cada grupo é resumido por `sumarioGlobal`
 * (que usa `calcMargemVenda`) sobre o subconjunto do grupo. As chaves de
 * agrupamento são as mesmas de margemPorLoja/Marca/Modelo/Vendedor e
 * vendasPorMes, então os números batem com /insights e /vendas.
 */
import { z } from "zod";
import type { VendaParsed } from "@/lib/parsers/nbs-vendas-xlsx";
import { sumarioGlobal } from "@/lib/analytics/insights";
import { definirTool } from "@cerebro/tools/definicao";
import {
  contem,
  ehErroLoja,
  extremosDatas,
  filtrarPorPeriodo,
  filtroLoja,
  frescorDados,
  limitar,
  media,
  normalizarTexto,
  zData,
  zLimite,
  zLoja,
  zTextoFiltro,
  type ContextoTool,
} from "@cerebro/tools/comum";

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export const AGRUPAMENTOS = ["loja", "vendedor", "modelo", "marca", "mes", "nenhum"] as const;
type Agrupamento = (typeof AGRUPAMENTOS)[number];

/** Chave de grupo idêntica à das funções de insights.ts. `null` = venda fora do agrupamento. */
export function chaveGrupo(v: VendaParsed, por: Agrupamento): string | null {
  switch (por) {
    case "loja":
      return v.empresa_nome || `Loja ${v.cod_empresa}`; // margemPorLoja
    case "marca":
      return (v.marca ?? "—").toUpperCase(); // margemPorMarca
    case "modelo":
      return (v.modelo ?? "—").trim().toUpperCase(); // margemPorModelo
    case "vendedor":
      return v.vendedor_nome || v.vendedor_codigo || "—"; // margemPorVendedor
    case "mes": {
      if (!v.data_venda) return null; // vendasPorMes ignora venda sem data
      const d = new Date(v.data_venda);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    }
    case "nenhum":
      return "total";
  }
}

function resumir(vs: VendaParsed[], ctx: ContextoTool) {
  const s = sumarioGlobal(vs, ctx.snapshot.datasets.custosPorPlaca);
  const dias = vs.filter((v) => v.dias_estoque != null).map((v) => v.dias_estoque as number);
  return {
    qt: s.qt,
    faturamento: s.faturamento,
    custo: s.custo,
    margem: s.margem,
    margem_pct: s.margemPct,
    ganhos_indiretos: s.ganhosIndiretos,
    margem_sem_bonus: s.margemSemBonus,
    depende_de_bonus: s.dependeDeBonus,
    cobertura_custo_oficial_pct: s.cobertura * 100,
    dias_estoque_medio: media(dias),
    pct_com_troca: vs.length > 0 ? (vs.filter((v) => !!v.placa_troca).length / vs.length) * 100 : 0,
  };
}

const ORDEM = {
  margem: (r: { margem: number }) => r.margem,
  margem_pct: (r: { margem_pct: number }) => r.margem_pct,
  qtd: (r: { qt: number }) => r.qt,
  faturamento: (r: { faturamento: number }) => r.faturamento,
} as const;

export const vendasPeriodo = definirTool({
  nome: "vendas_periodo",
  descricao:
    "Vendas realizadas com margem REAL (fórmula canônica NBS, igual às telas): faturamento, custo, margem R$ e %, " +
    "ganhos indiretos (bônus), margem sem bônus, dias médios de estoque e % com troca. Agrupa por loja, vendedor, " +
    "modelo, marca ou mês. Sem inicio/fim usa todo o período carregado. Datas YYYY-MM-DD (fim inclusivo).",
  entrada: {
    inicio: zData.optional(),
    fim: zData.optional(),
    agrupar_por: z.enum(AGRUPAMENTOS).default("nenhum"),
    loja: zLoja,
    marca: zTextoFiltro.optional().describe("Marca exata, sem caixa."),
    modelo: zTextoFiltro.optional().describe("Parte do modelo (contém)."),
    vendedor: zTextoFiltro.optional().describe("Parte do nome do vendedor ou código exato."),
    ordenar: z.enum(["margem", "margem_pct", "qtd", "faturamento"]).default("margem")
      .describe("Ordem dos grupos (decrescente). Com agrupar_por=mes a ordem é cronológica."),
    limite: zLimite,
  },
  executar(args, ctx) {
    const d = ctx.snapshot.datasets;
    const fl = filtroLoja(ctx.snapshot, args.loja);
    if (ehErroLoja(fl)) return fl;
    if (args.inicio && args.fim && args.inicio > args.fim) {
      return { erro: "periodo_invalido", mensagem: "inicio é depois de fim" };
    }
    const vs = filtrarPorPeriodo(d.vendas, args).filter((v) => {
      if (fl.cod !== null && v.cod_empresa !== fl.cod) return false;
      if (args.marca && normalizarTexto(v.marca) !== normalizarTexto(args.marca)) return false;
      if (args.modelo && !contem(v.modelo, args.modelo)) return false;
      if (args.vendedor && !(contem(v.vendedor_nome, args.vendedor) || v.vendedor_codigo === args.vendedor)) return false;
      return true;
    });

    const grupos = new Map<string, VendaParsed[]>();
    for (const v of vs) {
      const k = chaveGrupo(v, args.agrupar_por);
      if (k === null) continue;
      const arr = grupos.get(k);
      if (arr) arr.push(v);
      else grupos.set(k, [v]);
    }
    const entradas = [...grupos.entries()];
    if (args.agrupar_por === "mes") entradas.sort(([a], [b]) => a.localeCompare(b)); // cronológico, "YYYY-MM"
    const linhas = entradas.map(([grupo, g]) => {
      const rotulo = args.agrupar_por === "mes"
        ? `${MESES[Number(grupo.slice(5)) - 1]}/${grupo.slice(0, 4)}`
        : grupo;
      return { grupo: rotulo, ...resumir(g, ctx) };
    });
    if (args.agrupar_por !== "mes") {
      const f = ORDEM[args.ordenar];
      linhas.sort((a, b) => f(b) - f(a));
    }
    const lim = limitar(linhas, args.limite);

    return {
      periodo: { inicio: args.inicio ?? null, fim: args.fim ?? null, ...extremosDatas(vs) },
      filtros: {
        loja: fl.loja, marca: args.marca ?? null, modelo: args.modelo ?? null, vendedor: args.vendedor ?? null,
      },
      sumario: resumir(vs, ctx),
      agrupar_por: args.agrupar_por,
      total_grupos: lim.total,
      truncado: lim.truncado,
      grupos: args.agrupar_por === "nenhum" ? [] : lim.itens,
      dados: frescorDados(ctx),
    };
  },
});
