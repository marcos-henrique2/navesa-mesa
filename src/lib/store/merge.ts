/**
 * UPLOAD INCREMENTAL — funções puras pra mesclar resultados de parse
 * com dados já existentes no store.
 *
 * REGRA GERAL:
 *   1. Detecta o "período" do novo arquivo (min/max de data).
 *   2. Remove do conjunto existente tudo que está DENTRO desse período.
 *   3. Adiciona os novos registros.
 *   4. Recalcula meta (período acumulado, totais).
 *
 * Assim, o usuário pode subir relatórios incrementais (só do dia, da semana)
 * sem perder o histórico que já tinha carregado antes.
 *
 * Estoque é exceção: SEMPRE substitui (é um snapshot do "agora").
 */

import type { VendaParsed, VendasParseResult, VendasSnapshotMeta } from "@/lib/parsers/nbs-vendas-xlsx";
import type { CustoDetalhado, CustosMeta, CustosParseResult } from "@/lib/parsers/nbs-custos-xls";

function toTime(d: Date | string | null | undefined): number | null {
  if (!d) return null;
  const t = d instanceof Date ? d.getTime() : new Date(d).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Determina o intervalo coberto por uma coleção de vendas.
 * Usa meta.periodo_* quando disponível, senão calcula do dataset.
 */
function intervaloVendas(meta: VendasSnapshotMeta | null, vendas: VendaParsed[]): { ini: number; fim: number } | null {
  let ini = toTime(meta?.periodo_inicio);
  let fim = toTime(meta?.periodo_fim);
  if (ini == null || fim == null) {
    for (const v of vendas) {
      const t = toTime(v.data_venda);
      if (t == null) continue;
      if (ini == null || t < ini) ini = t;
      if (fim == null || t > fim) fim = t;
    }
  }
  if (ini == null || fim == null) return null;
  return { ini, fim };
}

export type MergeResultVendas = {
  vendas: VendaParsed[];
  meta: VendasSnapshotMeta;
  warnings: string[];
  /** Estatísticas pra feedback ao usuário */
  delta: {
    novas: number;
    substituidas: number;
    mantidas: number;
    periodoNovo: { inicio: Date | null; fim: Date | null };
    periodoAcumulado: { inicio: Date | null; fim: Date | null };
  };
};

export function mergeVendas(
  existentes: VendaParsed[],
  metaExistente: VendasSnapshotMeta | null,
  novoResult: VendasParseResult,
): MergeResultVendas {
  // Sem dados anteriores → comporta como upload normal
  if (existentes.length === 0) {
    return {
      vendas: novoResult.vendas,
      meta: novoResult.meta,
      warnings: novoResult.warnings,
      delta: {
        novas: novoResult.vendas.length,
        substituidas: 0,
        mantidas: 0,
        periodoNovo: { inicio: novoResult.meta.periodo_inicio, fim: novoResult.meta.periodo_fim },
        periodoAcumulado: { inicio: novoResult.meta.periodo_inicio, fim: novoResult.meta.periodo_fim },
      },
    };
  }

  const intNovo = intervaloVendas(novoResult.meta, novoResult.vendas);
  if (!intNovo) {
    // Nada parseável no novo arquivo, mantém o existente
    return {
      vendas: existentes,
      meta: metaExistente!,
      warnings: [...(novoResult.warnings ?? []), "Não foi possível determinar o período do novo upload — nada alterado."],
      delta: {
        novas: 0,
        substituidas: 0,
        mantidas: existentes.length,
        periodoNovo: { inicio: null, fim: null },
        periodoAcumulado: { inicio: metaExistente?.periodo_inicio ?? null, fim: metaExistente?.periodo_fim ?? null },
      },
    };
  }

  // Separa existentes em "dentro do período do novo" (descarta) e "fora" (mantém)
  let substituidas = 0;
  const mantidas: VendaParsed[] = [];
  for (const v of existentes) {
    const t = toTime(v.data_venda);
    if (t != null && t >= intNovo.ini && t <= intNovo.fim) {
      substituidas++;
    } else {
      mantidas.push(v);
    }
  }

  const vendasFinais = [...mantidas, ...novoResult.vendas];

  // Período acumulado
  const intAcum = intervaloVendas(metaExistente, mantidas);
  const acumIni = intAcum ? Math.min(intAcum.ini, intNovo.ini) : intNovo.ini;
  const acumFim = intAcum ? Math.max(intAcum.fim, intNovo.fim) : intNovo.fim;

  // Recalcula totais auxiliares
  const lojas = new Set<number>();
  const vendedores = new Set<string>();
  for (const v of vendasFinais) {
    lojas.add(v.cod_empresa);
    if (v.vendedor_codigo) vendedores.add(v.vendedor_codigo);
  }

  const meta: VendasSnapshotMeta = {
    arquivo_nome: novoResult.meta.arquivo_nome, // último arquivo subido
    data_geracao: novoResult.meta.data_geracao, // último geração
    total_vendas: vendasFinais.length,
    total_lojas: lojas.size,
    total_vendedores: vendedores.size,
    periodo_inicio: new Date(acumIni),
    periodo_fim: new Date(acumFim),
  };

  return {
    vendas: vendasFinais,
    meta,
    warnings: novoResult.warnings,
    delta: {
      novas: novoResult.vendas.length,
      substituidas,
      mantidas: mantidas.length,
      periodoNovo: { inicio: novoResult.meta.periodo_inicio, fim: novoResult.meta.periodo_fim },
      periodoAcumulado: { inicio: meta.periodo_inicio, fim: meta.periodo_fim },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOS
// ─────────────────────────────────────────────────────────────────────────────

export type MergeResultCustos = {
  custosPorPlaca: Record<string, CustoDetalhado>;
  meta: CustosMeta;
  warnings: string[];
  delta: {
    novos: number;
    substituidos: number;
    mantidos: number;
  };
};

/**
 * Custos é keyed por placa — fazemos merge por placa direto:
 *   - Se nova placa já existia, substitui pelo novo (versão mais recente).
 *   - Se nova placa não existia, adiciona.
 *   - Placas antigas que NÃO estão no novo arquivo: mantém.
 *
 * Não removemos placas antigas porque o relatório do NBS pode estar filtrado por período,
 * e queremos preservar o histórico de custos de vendas mais antigas.
 */
export function mergeCustos(
  existentes: Record<string, CustoDetalhado>,
  metaExistente: CustosMeta | null,
  novoResult: CustosParseResult,
): MergeResultCustos {
  const merged: Record<string, CustoDetalhado> = { ...existentes };
  let substituidos = 0;
  let novos = 0;
  for (const c of novoResult.custos) {
    if (!c.placa) continue;
    if (merged[c.placa]) substituidos++;
    else novos++;
    merged[c.placa] = c;
  }

  const total = Object.keys(merged).length;
  const meta: CustosMeta = {
    ...novoResult.meta,
    // Mantém o período do upload mais recente pro contexto, mas o total reflete o acumulado
    total_vendas: total,
  };

  return {
    custosPorPlaca: merged,
    meta,
    warnings: novoResult.warnings,
    delta: {
      novos,
      substituidos,
      mantidos: Math.max(0, Object.keys(existentes).length - substituidos),
    },
  };
}
