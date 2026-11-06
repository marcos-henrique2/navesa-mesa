/**
 * PREPARAR DATASETS — pipeline de carga PURO (sem "use client", sem React,
 * sem zustand, sem Supabase, sem browser).
 *
 * Recebe o que veio do banco e devolve exatamente os datasets que as telas
 * consomem: lojas ignoradas filtradas, mapas de custo por placa, metas e
 * lojas/vendedores derivados. É a MESMA função usada pelo `inventoryStore`
 * (browser) e pelo cérebro (Node, conexão própria) — por isso chat e telas não
 * podem divergir em centavo nenhum.
 *
 * Margem: as telas calculam via `calcMargemVenda(venda, custosPorPlaca)`
 * (`@/lib/analytics/margem`, também puro). O `custosPorPlaca` devolvido aqui é
 * a entrada canônica dessa função.
 *
 * Duas portas de entrada:
 *   - `prepararDatasets(dados)` — dados já mapeados pros tipos de domínio
 *     (caminho do browser: `listVendas()` etc. já aplicam os mappers);
 *   - `prepararDatasetsDeLinhas(linhas)` — linhas cruas do banco; aplica os
 *     mappers de `@/lib/data/mappers/*` e depois `prepararDatasets`.
 */
import type { VeiculoParsed, SnapshotMeta } from "@/lib/parsers/nbs-xlsx";
import type { VendaParsed, VendasSnapshotMeta } from "@/lib/parsers/nbs-vendas-xlsx";
import type { CustoDetalhado, CustosMeta } from "@/lib/parsers/nbs-custos-xls";
import type { CustoEstoqueDetalhado, CustosEstoquePdfMeta } from "@/lib/parsers/nbs-custos-estoque-pdf";
import type { BatchResult } from "@/lib/fipe/batch-tipos";
import type { StatusCautelar } from "@/lib/inventory/cautelar-tipos";
import { LOJAS_IGNORADAS, isLojaIgnorada } from "@/lib/config/lojas-ignoradas";
import { normalizarPlaca } from "@/lib/utils/placa";
import { vendaFromRow, type VendaRow } from "@/lib/data/mappers/vendas";
import { veiculoFromRow, snapshotMetaFromRow, type VeiculoRow, type EstoqueSnapshotRow } from "@/lib/data/mappers/veiculos";
import { custoFromRow, type CustoRow } from "@/lib/data/mappers/custos";
import {
  montarCustosEstoque,
  type CustoEstoqueRow,
  type CustosEstoqueCarregados,
} from "@/lib/data/mappers/custos-estoque";
import { montarBatchFipe, type FipeBatchRow } from "@/lib/data/mappers/fipe-batch";
import { montarCautelares, type CautelarRow } from "@/lib/data/mappers/cautelar";

export type LojaInfo = {
  cod_empresa: number;
  nome: string;
  cidade: string;
};

export type VendedorInfo = {
  codigo: string;
  nome: string;
  cpf?: string | null;
};

/** Dados já mapeados pros tipos de domínio, sem nenhum filtro aplicado. */
export type DadosCarregados = {
  vendas: VendaParsed[];
  veiculos: VeiculoParsed[];
  custos: CustoDetalhado[];
  custosEstoque: CustosEstoqueCarregados;
  meta: SnapshotMeta | null;
};

export type DatasetsPreparados = {
  vendas: VendaParsed[];
  vendasMeta: VendasSnapshotMeta | null;
  vendedores: Record<string, VendedorInfo>;
  custosPorPlaca: Record<string, CustoDetalhado>;
  custosMeta: CustosMeta | null;
  custosEstoquePorPlaca: Record<string, CustoEstoqueDetalhado>;
  custosEstoqueMeta: CustosEstoquePdfMeta | null;
  veiculos: VeiculoParsed[];
  meta: SnapshotMeta | null;
  lojas: Record<number, LojaInfo>;
};

/**
 * Linhas cruas do banco. No browser vêm de `select("*")`; no cérebro, de um
 * SELECT com colunas explícitas (`vendas` usa `VENDAS_COLUNAS_CEREBRO`, sem as
 * colunas restritas — por isso elas são opcionais em `VendaRow`).
 */
export type LinhasBrutas = {
  vendas: VendaRow[];
  veiculos: VeiculoRow[];
  custos: CustoRow[];
  custosEstoque: CustoEstoqueRow[];
  meta: EstoqueSnapshotRow | null;
  fipe?: FipeBatchRow[];
  cautelares?: CautelarRow[];
};

export type DatasetsPreparadosCompletos = DatasetsPreparados & {
  fipe: BatchResult | null;
  cautelares: Record<string, StatusCautelar>;
};

/** Deriva mapa de vendedores a partir de uma lista de vendas (sem persistir). */
export function derivarVendedores(vendas: VendaParsed[]): Record<string, VendedorInfo> {
  const out: Record<string, VendedorInfo> = {};
  for (const v of vendas) {
    if (v.vendedor_codigo && v.vendedor_nome) {
      out[v.vendedor_codigo] = {
        codigo: v.vendedor_codigo,
        nome: v.vendedor_nome,
        cpf: v.vendedor_cpf,
      };
    }
  }
  return out;
}

/** Reconstrói vendasMeta a partir da lista de vendas carregadas. */
export function derivarVendasMeta(vendas: VendaParsed[]): VendasSnapshotMeta | null {
  if (vendas.length === 0) return null;
  let ini: number | null = null, fim: number | null = null;
  const lojas = new Set<number>(), vendedores = new Set<string>();
  for (const v of vendas) {
    if (v.data_venda) {
      const t = new Date(v.data_venda).getTime();
      if (ini == null || t < ini) ini = t;
      if (fim == null || t > fim) fim = t;
    }
    lojas.add(v.cod_empresa);
    if (v.vendedor_codigo) vendedores.add(v.vendedor_codigo);
  }
  return {
    arquivo_nome: "supabase",
    data_geracao: null,
    total_vendas: vendas.length,
    total_lojas: lojas.size,
    total_vendedores: vendedores.size,
    periodo_inicio: ini ? new Date(ini) : null,
    periodo_fim: fim ? new Date(fim) : null,
  };
}

export function derivarCustosMeta(qt: number): CustosMeta | null {
  if (qt === 0) return null;
  return {
    arquivo_nome: "supabase",
    periodo: null,
    data_geracao: null,
    total_vendas: qt,
    loja_principal: null,
  };
}

export function derivarCustosEstoqueMeta(qt: number): CustosEstoquePdfMeta | null {
  if (qt === 0) return null;
  return {
    arquivo_nome: "supabase",
    empresa: "",
    filial: "",
    cod_empresa: null, // não apurado — este meta é reconstruído pós-load, não vem de um PDF específico
    data_impressao: null,
    total_veiculos: qt,
  };
}

/**
 * Auto-descoberta de lojas a partir de vendas/veículos (já filtrados), em cima
 * das lojas conhecidas. Não muta `lojasAtuais`. Lojas ignoradas nunca saem.
 */
export function derivarLojas(
  lojasAtuais: Record<number, LojaInfo>,
  vendas: VendaParsed[],
  veiculos: VeiculoParsed[],
): Record<number, LojaInfo> {
  const nextLojas = { ...lojasAtuais };
  for (const v of vendas) {
    if (v.empresa_nome && !nextLojas[v.cod_empresa]?.nome) {
      nextLojas[v.cod_empresa] = {
        cod_empresa: v.cod_empresa,
        nome: v.empresa_nome,
        cidade: nextLojas[v.cod_empresa]?.cidade ?? "",
      };
    } else if (!nextLojas[v.cod_empresa]) {
      nextLojas[v.cod_empresa] = { cod_empresa: v.cod_empresa, nome: "", cidade: "" };
    }
  }
  for (const v of veiculos) {
    if (!nextLojas[v.cod_empresa]) {
      nextLojas[v.cod_empresa] = { cod_empresa: v.cod_empresa, nome: "", cidade: "" };
    }
  }
  // Garante que lojas ignoradas não fiquem persistidas (mesmo se vieram do localStorage)
  for (const cod of LOJAS_IGNORADAS) {
    delete nextLojas[cod];
  }
  return nextLojas;
}

/** Filtra lojas ignoradas, monta os mapas por placa e deriva metas/lojas/vendedores. */
export function prepararDatasets(
  dados: DadosCarregados,
  lojasAtuais: Record<number, LojaInfo> = {},
): DatasetsPreparados {
  const { vendas, veiculos, custos, custosEstoque, meta } = dados;

  // Filtra lojas ignoradas (config central — ver src/lib/config/lojas-ignoradas.ts)
  const vendasFiltradas = vendas.filter((v) => !isLojaIgnorada(v.cod_empresa));
  const veiculosFiltrados = veiculos.filter((v) => !isLojaIgnorada(v.cod_empresa));
  // Custos: remove placas que pertencem só a lojas ignoradas (mapeadas via vendas original)
  const placasIgnoradas = new Set<string>();
  for (const v of vendas) {
    if (isLojaIgnorada(v.cod_empresa) && v.placa) placasIgnoradas.add(v.placa);
  }
  const custosFiltrados = custos.filter((c) => !placasIgnoradas.has(c.placa));

  // Custos de estoque: filtra por cod_empresa (vem direto na linha)
  const custosEstoqueFiltrados = custosEstoque.itens.filter((c) => {
    const cod = custosEstoque.codEmpresaPorPlaca[c.placa];
    return !isLojaIgnorada(cod);
  });

  // Processa custos
  const cMap: Record<string, CustoDetalhado> = {};
  for (const c of custosFiltrados) if (c.placa) cMap[c.placa] = c;

  // Processa custos de estoque — chaves normalizadas (sem hífen/espaço, maiúsculas)
  // pra bater com placas do estoque vindas em formato "ABC-1234" ou "ABC1234"
  const ceMap: Record<string, CustoEstoqueDetalhado> = {};
  for (const c of custosEstoqueFiltrados) {
    if (c.placa) ceMap[normalizarPlaca(c.placa)] = c;
  }

  return {
    vendas: vendasFiltradas,
    vendasMeta: derivarVendasMeta(vendasFiltradas),
    vendedores: derivarVendedores(vendasFiltradas),
    custosPorPlaca: cMap,
    custosMeta: derivarCustosMeta(custosFiltrados.length),
    custosEstoquePorPlaca: ceMap,
    custosEstoqueMeta: derivarCustosEstoqueMeta(custosEstoqueFiltrados.length),
    veiculos: veiculosFiltrados,
    meta,
    lojas: derivarLojas(lojasAtuais, vendasFiltradas, veiculosFiltrados),
  };
}

/** Aplica os mappers às linhas cruas e roda `prepararDatasets`. FIPE/cautelar são opcionais. */
export function prepararDatasetsDeLinhas(
  linhas: LinhasBrutas,
  lojasAtuais: Record<number, LojaInfo> = {},
): DatasetsPreparadosCompletos {
  const datasets = prepararDatasets(
    {
      vendas: linhas.vendas.map(vendaFromRow),
      veiculos: linhas.veiculos.map(veiculoFromRow),
      custos: linhas.custos.map(custoFromRow),
      custosEstoque: montarCustosEstoque(linhas.custosEstoque),
      meta: linhas.meta ? snapshotMetaFromRow(linhas.meta) : null,
    },
    lojasAtuais,
  );
  return {
    ...datasets,
    fipe: montarBatchFipe(linhas.fipe ?? []),
    cautelares: montarCautelares(linhas.cautelares ?? []),
  };
}
