/**
 * Detecção de anomalia em veículos do estoque.
 *
 * Usa z-score: pra cada modelo, calcula média e desvio padrão de preço/custo/dias
 * do que JÁ foi vendido. Compara com cada carro EM ESTOQUE do mesmo modelo e
 * sinaliza quando o valor está fora do padrão (z > 2 = MUITO fora; z > 1.5 = fora).
 *
 * Útil pra pegar:
 *   - Carros precificados MUITO acima do que o modelo costuma vender (vai demorar)
 *   - Carros com custo MUITO acima do normal (problema operacional)
 *   - Carros há muito tempo parados vs a média do modelo
 *
 * Limiar de modelo: mínimo 5 vendas históricas pra ter estatística confiável.
 */

import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";
import type { VendaParsed } from "@/lib/parsers/nbs-vendas-xlsx";

export type TipoAnomalia = "preco_alto" | "preco_baixo" | "custo_alto" | "dias_parado";

export type Anomalia = {
  chassi: string;
  placa: string;
  modelo: string;
  marca: string | null;
  loja: number;
  tipo: TipoAnomalia;
  /** Quantos desvios padrão fora da média. */
  zScore: number;
  /** Severidade calculada a partir do zScore. */
  severidade: "moderada" | "alta" | "extrema";
  /** Valor do carro analisado. */
  valor: number;
  /** Média histórica do modelo. */
  media: number;
  /** Desvio em R$/dias. */
  desvio: number;
  /** Texto explicativo. */
  mensagem: string;
};

function normalizarModelo(s: string): string {
  return s.trim().toUpperCase().replace(/\s+/g, " ");
}

type Stats = { media: number; dp: number; n: number };

function calcStats(valores: number[]): Stats {
  if (valores.length < 2) return { media: valores[0] ?? 0, dp: 0, n: valores.length };
  const media = valores.reduce((s, v) => s + v, 0) / valores.length;
  const variancia =
    valores.reduce((s, v) => s + (v - media) ** 2, 0) / (valores.length - 1);
  return { media, dp: Math.sqrt(variancia), n: valores.length };
}

function zScore(valor: number, stats: Stats): number {
  if (stats.dp === 0) return 0;
  return (valor - stats.media) / stats.dp;
}

function severidadePorZ(absZ: number): "moderada" | "alta" | "extrema" | null {
  if (absZ >= 3) return "extrema";
  if (absZ >= 2) return "alta";
  if (absZ >= 1.5) return "moderada";
  return null;
}

function formatBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

/**
 * Calcula estatísticas históricas por modelo a partir das vendas.
 */
function statsHistoricasPorModelo(vendas: VendaParsed[]): Map<
  string,
  { preco: Stats; custo: Stats; dias: Stats }
> {
  const porModelo = new Map<string, { precos: number[]; custos: number[]; dias: number[] }>();

  for (const v of vendas) {
    const m = normalizarModelo(v.modelo);
    if (!porModelo.has(m)) porModelo.set(m, { precos: [], custos: [], dias: [] });
    const r = porModelo.get(m)!;
    if (v.valor_venda != null && v.valor_venda > 0) r.precos.push(v.valor_venda);
    if (v.custo_total_final != null && v.custo_total_final > 0) r.custos.push(v.custo_total_final);
    if (v.dias_estoque != null && v.dias_estoque > 0) r.dias.push(v.dias_estoque);
  }

  const out = new Map<string, { preco: Stats; custo: Stats; dias: Stats }>();
  for (const [modelo, d] of porModelo) {
    out.set(modelo, {
      preco: calcStats(d.precos),
      custo: calcStats(d.custos),
      dias: calcStats(d.dias),
    });
  }
  return out;
}

/**
 * Detecta anomalias em todos os veículos em estoque.
 * Retorna lista ordenada da mais extrema pra moderada.
 */
export function detectarAnomalias(
  veiculos: VeiculoParsed[],
  vendas: VendaParsed[],
  opts: { minVendasModelo?: number } = {},
): Anomalia[] {
  const minVendas = opts.minVendasModelo ?? 5;
  const statsPorModelo = statsHistoricasPorModelo(vendas);
  const anomalias: Anomalia[] = [];

  for (const v of veiculos) {
    const m = normalizarModelo(v.modelo);
    const stats = statsPorModelo.get(m);
    if (!stats) continue;

    // 1) Preço de venda — z-score positivo grande = caro demais; negativo = barato demais
    if (v.preco_venda != null && v.preco_venda > 0 && stats.preco.n >= minVendas && stats.preco.dp > 0) {
      const z = zScore(v.preco_venda, stats.preco);
      const sev = severidadePorZ(Math.abs(z));
      if (sev && z > 0) {
        anomalias.push({
          chassi: v.chassi,
          placa: v.placa,
          modelo: v.modelo,
          marca: v.marca,
          loja: v.cod_empresa,
          tipo: "preco_alto",
          zScore: z,
          severidade: sev,
          valor: v.preco_venda,
          media: stats.preco.media,
          desvio: v.preco_venda - stats.preco.media,
          mensagem: `Preço ${formatBRL(v.preco_venda)} está ${formatBRL(v.preco_venda - stats.preco.media)} acima da média do modelo (${formatBRL(stats.preco.media)} em ${stats.preco.n} vendas históricas).`,
        });
      } else if (sev && z < 0) {
        anomalias.push({
          chassi: v.chassi,
          placa: v.placa,
          modelo: v.modelo,
          marca: v.marca,
          loja: v.cod_empresa,
          tipo: "preco_baixo",
          zScore: z,
          severidade: sev,
          valor: v.preco_venda,
          media: stats.preco.media,
          desvio: v.preco_venda - stats.preco.media,
          mensagem: `Preço ${formatBRL(v.preco_venda)} está ${formatBRL(Math.abs(v.preco_venda - stats.preco.media))} abaixo da média do modelo (${formatBRL(stats.preco.media)}). Pode estar perdendo margem.`,
        });
      }
    }

    // 2) Custo total — anomalia se MUITO acima (problema operacional)
    if (v.custo_total != null && v.custo_total > 0 && stats.custo.n >= minVendas && stats.custo.dp > 0) {
      const z = zScore(v.custo_total, stats.custo);
      const sev = severidadePorZ(Math.abs(z));
      if (sev && z > 0) {
        anomalias.push({
          chassi: v.chassi,
          placa: v.placa,
          modelo: v.modelo,
          marca: v.marca,
          loja: v.cod_empresa,
          tipo: "custo_alto",
          zScore: z,
          severidade: sev,
          valor: v.custo_total,
          media: stats.custo.media,
          desvio: v.custo_total - stats.custo.media,
          mensagem: `Custo ${formatBRL(v.custo_total)} está ${formatBRL(v.custo_total - stats.custo.media)} acima da média do modelo (${formatBRL(stats.custo.media)}). Pode indicar gastos atípicos de oficina ou floor plan estourado.`,
        });
      }
    }

    // 3) Dias parados — anomalia se MUITO acima da média de tempo no modelo
    if (v.dias_patio != null && v.dias_patio > 0 && stats.dias.n >= minVendas && stats.dias.dp > 0) {
      const z = zScore(v.dias_patio, stats.dias);
      const sev = severidadePorZ(Math.abs(z));
      if (sev && z > 0) {
        anomalias.push({
          chassi: v.chassi,
          placa: v.placa,
          modelo: v.modelo,
          marca: v.marca,
          loja: v.cod_empresa,
          tipo: "dias_parado",
          zScore: z,
          severidade: sev,
          valor: v.dias_patio,
          media: stats.dias.media,
          desvio: v.dias_patio - stats.dias.media,
          mensagem: `${v.dias_patio} dias parado, mas modelo costuma vender em ${Math.round(stats.dias.media)} dias. ${Math.round(v.dias_patio - stats.dias.media)} dias acima do esperado.`,
        });
      }
    }
  }

  // Ordena por severidade (extrema > alta > moderada) e dentro disso por |zScore| desc
  const ordemSev = { extrema: 0, alta: 1, moderada: 2 };
  return anomalias.sort((a, b) => {
    const dif = ordemSev[a.severidade] - ordemSev[b.severidade];
    if (dif !== 0) return dif;
    return Math.abs(b.zScore) - Math.abs(a.zScore);
  });
}

export type ResumoAnomalias = {
  total: number;
  extrema: number;
  alta: number;
  moderada: number;
  porTipo: Record<TipoAnomalia, number>;
};

export function resumirAnomalias(anomalias: Anomalia[]): ResumoAnomalias {
  const r: ResumoAnomalias = {
    total: anomalias.length,
    extrema: 0,
    alta: 0,
    moderada: 0,
    porTipo: { preco_alto: 0, preco_baixo: 0, custo_alto: 0, dias_parado: 0 },
  };
  for (const a of anomalias) {
    if (a.severidade === "extrema") r.extrema++;
    else if (a.severidade === "alta") r.alta++;
    else r.moderada++;
    r.porTipo[a.tipo]++;
  }
  return r;
}
