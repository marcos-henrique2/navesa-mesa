/**
 * CATÁLOGO DE COLUNAS EXPORTÁVEIS DO ESTOQUE (puro / testável)
 *
 * Fonte única de verdade pro Relatório de Estoque Customizável: define TODAS as
 * colunas que o Marcos pode escolher exportar, cada uma com seu label pt-BR,
 * formato visual (texto/numero/moeda/km/ano) e um getter que extrai o valor cru
 * de um VeiculoParsed.
 *
 * Só inclui campos que o VeiculoParsed REALMENTE tem (mais a margem derivada de
 * preço − aquisição). Campos que dependem de fontes externas (FIPE, batch) NÃO
 * entram aqui — o catálogo é puro e não depende de hooks/estado.
 *
 * A coluna "Observações" NÃO está no catálogo: ela é especial (sempre em branco,
 * sem getter) e é tratada à parte pelo gerador via flag `incluirObservacoes`.
 */

import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";

/** Veículo enriquecido com o nome da loja já resolvido (como o gerencial usa). */
export type VeiculoExportavel = VeiculoParsed & {
  empresa_nome?: string | null;
};

/** Formato visual da coluna no XLSX. */
export type ColunaFormato = "texto" | "numero" | "moeda" | "km" | "ano";

export type ColunaKey =
  | "loja"
  | "placa"
  | "chassi"
  | "marca"
  | "modelo"
  | "ano_fabricacao"
  | "ano_modelo"
  | "ano"
  | "km"
  | "cor_externa"
  | "combustivel"
  | "dias_patio"
  | "valor_aquisicao"
  | "custo_total"
  | "preco_venda"
  | "margem"
  | "descricao_situacao"
  | "patio";

/** Valor cru que um getter pode retornar (sem `any`). */
export type ValorColuna = string | number | null;

export type ColunaEstoque = {
  key: ColunaKey;
  label: string;
  formato: ColunaFormato;
  getValor: (v: VeiculoExportavel) => ValorColuna;
};

function fmtAno(fab: number | null, mod: number | null): string | null {
  if (fab != null && mod != null) return fab === mod ? String(mod) : `${fab}/${mod}`;
  if (mod != null) return String(mod);
  if (fab != null) return String(fab);
  return null;
}

/**
 * Catálogo na ordem canônica em que as colunas devem aparecer no relatório.
 * O gerador respeita essa ordem ao montar o XLSX.
 */
export const COLUNAS_ESTOQUE: readonly ColunaEstoque[] = [
  { key: "loja", label: "Loja", formato: "texto", getValor: (v) => v.empresa_nome ?? null },
  { key: "placa", label: "Placa", formato: "texto", getValor: (v) => v.placa },
  { key: "chassi", label: "Chassi", formato: "texto", getValor: (v) => v.chassi },
  { key: "marca", label: "Marca", formato: "texto", getValor: (v) => v.marca },
  { key: "modelo", label: "Modelo", formato: "texto", getValor: (v) => v.modelo },
  { key: "ano_fabricacao", label: "Ano fabricação", formato: "ano", getValor: (v) => v.ano_fabricacao },
  { key: "ano_modelo", label: "Ano modelo", formato: "ano", getValor: (v) => v.ano_modelo },
  { key: "ano", label: "Ano", formato: "texto", getValor: (v) => fmtAno(v.ano_fabricacao, v.ano_modelo) },
  { key: "km", label: "KM", formato: "km", getValor: (v) => v.km },
  { key: "cor_externa", label: "Cor", formato: "texto", getValor: (v) => v.cor_externa },
  { key: "combustivel", label: "Combustível", formato: "texto", getValor: (v) => v.combustivel },
  { key: "dias_patio", label: "Dias parado", formato: "numero", getValor: (v) => v.dias_patio },
  { key: "valor_aquisicao", label: "Custo de entrada", formato: "moeda", getValor: (v) => v.valor_aquisicao },
  { key: "custo_total", label: "Custo total", formato: "moeda", getValor: (v) => v.custo_total },
  { key: "preco_venda", label: "Preço de venda", formato: "moeda", getValor: (v) => v.preco_venda },
  {
    key: "margem",
    label: "Margem",
    formato: "moeda",
    getValor: (v) =>
      v.preco_venda != null && v.valor_aquisicao != null ? v.preco_venda - v.valor_aquisicao : null,
  },
  { key: "descricao_situacao", label: "Status", formato: "texto", getValor: (v) => v.descricao_situacao },
  { key: "patio", label: "Localização", formato: "texto", getValor: (v) => v.patio.trim() || null },
];

/** Colunas marcadas por padrão na primeira vez que o modal abre. */
export const COLUNAS_DEFAULT: readonly ColunaKey[] = [
  "placa",
  "marca",
  "modelo",
  "ano",
  "km",
  "dias_patio",
  "valor_aquisicao",
  "preco_venda",
  "margem",
];

const COLUNA_POR_KEY: ReadonlyMap<ColunaKey, ColunaEstoque> = new Map(
  COLUNAS_ESTOQUE.map((c) => [c.key, c]),
);

/** Resolve uma coluna pela key. Retorna undefined se não existir no catálogo. */
export function getColuna(key: ColunaKey): ColunaEstoque | undefined {
  return COLUNA_POR_KEY.get(key);
}
