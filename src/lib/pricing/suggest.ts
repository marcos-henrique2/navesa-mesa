import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";

export type PrecoSuggestion = {
  precoSugerido: number;
  margemPct: number;
  baseUsada: "fipe" | "custo";
  precoFipe: number | null;
  precoMinPorCusto: number;
  justificativaBreve: string;
};

const MARGEM_MIN = 0.07; // 7% sobre o custo total
const MARGEM_PREMIUM_FIPE = 0.02; // mais 2% acima da FIPE quando vier dela

export function sugerirPreco(v: VeiculoParsed, valorFipe: number | null): PrecoSuggestion {
  const custo = v.custo_total ?? v.valor_aquisicao ?? 0;
  const precoMinPorCusto = custo * (1 + MARGEM_MIN);

  let precoSugerido: number;
  let baseUsada: "fipe" | "custo";

  if (valorFipe && valorFipe > 0) {
    const acimaFipe = valorFipe * (1 + MARGEM_PREMIUM_FIPE);
    precoSugerido = Math.max(acimaFipe, precoMinPorCusto);
    baseUsada = precoSugerido === acimaFipe ? "fipe" : "custo";
  } else {
    precoSugerido = precoMinPorCusto;
    baseUsada = "custo";
  }

  const margem = custo > 0 ? (precoSugerido - custo) / custo : 0;

  const just = baseUsada === "fipe"
    ? `FIPE ${formatBR(valorFipe!)} +${(MARGEM_PREMIUM_FIPE * 100).toFixed(0)}% (acima do mínimo de ${formatBR(precoMinPorCusto)} sobre custo)`
    : `Mínimo de ${(MARGEM_MIN * 100).toFixed(0)}% sobre custo de ${formatBR(custo)}${valorFipe ? ` (FIPE ${formatBR(valorFipe)} ficou abaixo do mínimo)` : " — FIPE indisponível"}`;

  return {
    precoSugerido: Math.round(precoSugerido),
    margemPct: margem,
    baseUsada,
    precoFipe: valorFipe,
    precoMinPorCusto: Math.round(precoMinPorCusto),
    justificativaBreve: just,
  };
}

function formatBR(n: number): string {
  return "R$ " + n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}
