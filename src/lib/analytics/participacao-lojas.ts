/**
 * Participação de vendas por loja — % de cada loja sobre o total de vendas do período.
 *
 * Reaproveita o mesmo padrão de agrupamento por cod_empresa/empresa_nome usado em
 * HeatmapLojas.tsx: cod_empresa é a chave canônica (estável), nome vem do cadastro
 * de lojas (fonte de verdade) com fallback pro nome que veio na própria venda,
 * e por fim "Loja X" se nada for encontrado.
 *
 * Vendas sem cod_empresa não são descartadas — caem em "Não identificado" pra
 * soma dos % sempre bater 100% (precisão financeira/contagem é regra do projeto).
 */
import type { VendaParsed } from "@/lib/parsers/nbs-vendas-xlsx";
import type { LojaInfo } from "@/lib/store/inventoryStore";

export const NAO_IDENTIFICADO = "Não identificado";

export type ParticipacaoLoja = {
  cod: number | null;
  loja: string;
  qt: number;
  pct: number;
};

export function calcularParticipacaoLojas(
  vendas: VendaParsed[],
  lojas: Record<number, LojaInfo>,
): ParticipacaoLoja[] {
  if (vendas.length === 0) return [];

  // Mapa cod_empresa → nome derivado das próprias vendas (fallback quando o
  // cadastro de lojas não conhece o código), igual HeatmapLojas.tsx.
  const nomePorCod = new Map<number, string>();
  for (const v of vendas) {
    if (typeof v.cod_empresa === "number" && v.empresa_nome && !nomePorCod.has(v.cod_empresa)) {
      nomePorCod.set(v.cod_empresa, v.empresa_nome);
    }
  }

  const qtPorCod = new Map<number, number>();
  let naoIdentificado = 0;
  for (const v of vendas) {
    if (typeof v.cod_empresa !== "number") {
      naoIdentificado++;
      continue;
    }
    qtPorCod.set(v.cod_empresa, (qtPorCod.get(v.cod_empresa) ?? 0) + 1);
  }

  const total = vendas.length;
  const result: ParticipacaoLoja[] = [];
  for (const [cod, qt] of qtPorCod.entries()) {
    const loja = lojas[cod]?.nome?.trim() || nomePorCod.get(cod) || `Loja ${cod}`;
    result.push({ cod, loja, qt, pct: (qt / total) * 100 });
  }
  if (naoIdentificado > 0) {
    result.push({ cod: null, loja: NAO_IDENTIFICADO, qt: naoIdentificado, pct: (naoIdentificado / total) * 100 });
  }

  return result.sort((a, b) => b.pct - a.pct);
}
