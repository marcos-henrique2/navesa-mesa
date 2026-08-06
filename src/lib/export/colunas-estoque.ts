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
import type { ColunaAgregacao, ColunaDef } from "@/lib/export/relatorio/tipos";

/** Veículo enriquecido com o nome da loja já resolvido (como o gerencial usa). */
export type VeiculoExportavel = VeiculoParsed & {
  empresa_nome?: string | null;
};

/**
 * Formato visual da coluna no XLSX. Subconjunto do `ColunaFormato` do contrato
 * genérico (`relatorio/tipos`) — o estoque só usa estes 5. Mantido local pra não
 * quebrar consumidores que fazem `Record<ColunaFormato, …>` com estas 5 chaves.
 */
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
  /** Como a coluna participa das linhas TOTAIS/MÉDIA do motor genérico. */
  agregacao: ColunaAgregacao;
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
  { key: "loja", label: "Loja", formato: "texto", agregacao: "nenhuma", getValor: (v) => v.empresa_nome ?? null },
  { key: "placa", label: "Placa", formato: "texto", agregacao: "nenhuma", getValor: (v) => v.placa },
  { key: "chassi", label: "Chassi", formato: "texto", agregacao: "nenhuma", getValor: (v) => v.chassi },
  { key: "marca", label: "Marca", formato: "texto", agregacao: "nenhuma", getValor: (v) => v.marca },
  { key: "modelo", label: "Modelo", formato: "texto", agregacao: "nenhuma", getValor: (v) => v.modelo },
  // Ano é UMA opção só, no formato que a concessionária usa: "2021/2022" (fabricação/modelo),
  // ou "2022" quando os dois coincidem. Antes existiam três checkboxes — "Ano fabricação",
  // "Ano modelo" e "Ano" —, e o rótulo "Ano" não deixava claro que era o combinado: quem
  // queria os dois marcava "Ano modelo" e recebia só um. Uma opção, sem ambiguidade.
  { key: "ano", label: "Ano/Modelo", formato: "texto", agregacao: "nenhuma", getValor: (v) => fmtAno(v.ano_fabricacao, v.ano_modelo) },
  { key: "km", label: "KM", formato: "km", agregacao: "media", getValor: (v) => v.km },
  { key: "cor_externa", label: "Cor", formato: "texto", agregacao: "nenhuma", getValor: (v) => v.cor_externa },
  { key: "combustivel", label: "Combustível", formato: "texto", agregacao: "nenhuma", getValor: (v) => v.combustivel },
  { key: "dias_patio", label: "Dias parado", formato: "numero", agregacao: "media", getValor: (v) => v.dias_patio },
  { key: "valor_aquisicao", label: "Custo de entrada", formato: "moeda", agregacao: "soma", getValor: (v) => v.valor_aquisicao },
  { key: "custo_total", label: "Custo total", formato: "moeda", agregacao: "soma", getValor: (v) => v.custo_total },
  { key: "preco_venda", label: "Preço de venda", formato: "moeda", agregacao: "soma", getValor: (v) => v.preco_venda },
  {
    key: "margem",
    label: "Margem",
    formato: "moeda",
    agregacao: "soma",
    getValor: (v) =>
      v.preco_venda != null && v.valor_aquisicao != null ? v.preco_venda - v.valor_aquisicao : null,
  },
  { key: "descricao_situacao", label: "Status", formato: "texto", agregacao: "nenhuma", getValor: (v) => v.descricao_situacao },
  { key: "patio", label: "Localização", formato: "texto", agregacao: "nenhuma", getValor: (v) => v.patio.trim() || null },
];

/**
 * Catálogo no formato do MOTOR GENÉRICO (key → ColunaDef<VeiculoExportavel>).
 * Cada `ColunaEstoque` é estruturalmente um `ColunaDef` (formato é subconjunto,
 * `getValor` de 1 arg é compatível com a assinatura de 2 args). Usado por
 * `montarRelatorio` na Fatia A.
 */
export const CATALOGO_ESTOQUE: ReadonlyMap<string, ColunaDef<VeiculoExportavel>> = new Map(
  COLUNAS_ESTOQUE.map((c) => [c.key, c]),
);

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
