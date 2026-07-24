/**
 * CONTRATO DO GERADOR DE RELATÓRIOS (config-driven)
 *
 * Fundação da Fatia A: define o `RelatorioDef` — uma descrição 100% SERIALIZÁVEL
 * de um relatório (fonte, filtros, colunas escolhidas por KEY, totais, saída).
 * NENHUMA função vive dentro do `RelatorioDef`: as colunas são referenciadas por
 * `key` e resolvidas contra um CATÁLOGO da fonte (que sim contém os getters).
 *
 * Isso permite, nas fatias B/C, salvar/carregar modelos como JSON puro sem perder
 * lógica (a lógica vive no catálogo tipado, não no def).
 *
 * Só a fonte "estoque" é implementada nesta fatia. As demais são rejeitadas com
 * erro claro (ver `validarFonteImplementada` em `./registry`).
 */

/** Versão do schema do `RelatorioDef`. Bump quando o contrato quebrar. */
export const RELATORIO_DEF_VERSION = 1;

/** Fontes de dados possíveis. Nesta fatia só "estoque" tem catálogo. */
export type FonteRelatorio = "estoque" | "vendas" | "custos" | "patio";

/** Formato visual de uma coluna (dirige numFmt + alinhamento + largura). */
export type ColunaFormato =
  | "texto"
  | "numero"
  | "moeda"
  | "km"
  | "ano"
  | "percentual"
  | "data";

/**
 * Como a coluna participa das linhas de agregação:
 *  - "soma"    → entra na linha TOTAIS (Σ dos não-nulos)
 *  - "media"   → entra na linha MÉDIA (média simples dos não-nulos)
 *  - "nenhuma" → célula em BRANCO nas duas linhas (nunca "R$ 0"/"0 km")
 */
export type ColunaAgregacao = "soma" | "media" | "nenhuma";

/** Valor cru que um getter de coluna pode retornar (sem `any`). */
export type ValorColuna = string | number | null;

/** Parâmetros serializáveis passados a uma coluna paramétrica (fatia B usa mais). */
export type ColunaParams = Record<string, string | number | boolean | null>;

/**
 * Definição de uma coluna no CATÁLOGO de uma fonte (contém a lógica/getter).
 * Vive no código, NÃO no `RelatorioDef`. Genérica no tipo da linha (`Row`) pra
 * evitar `any`: cada fonte instancia com seu próprio tipo de linha.
 */
export type ColunaDef<Row> = {
  /** Identidade estável referenciada pelo `RelatorioDef`. */
  key: string;
  label: string;
  formato: ColunaFormato;
  agregacao: ColunaAgregacao;
  /**
   * Campos da linha dos quais o getter depende. Se algum deles NÃO existir na
   * linha (propriedade ausente), o motor rende `null` sem chamar o getter —
   * proteção contra NaN/crash quando a fonte muda de shape.
   */
  deps?: readonly string[];
  getValor: (row: Row, params?: ColunaParams) => ValorColuna;
};

/**
 * Uma coluna na SAÍDA do relatório (serializável). Ou referencia o catálogo por
 * key, ou é uma coluna em branco (anotação no Excel/PDF).
 */
export type ColunaSaida =
  | { tipo: "catalogo"; key: string; params?: ColunaParams; labelOverride?: string }
  | { tipo: "branco"; label: string; corFundo?: string };

/** Filtros aplicados (metadados serializáveis; fatia B estende). */
export type FiltroRelatorio = {
  /** Nome da loja filtrada na tela (ou "TODAS"). */
  loja?: string | null;
};

/** Formatos de saída suportados. Só "xlsx" nesta fatia. */
export type SaidaFormato = "xlsx" | "pdf";

/** Configuração das linhas de agregação no rodapé. */
export type TotaisConfig = {
  incluirTotais: boolean;
  incluirMedia: boolean;
};

/**
 * A definição serializável de um relatório. JSON puro — sem funções. As colunas
 * apontam pro catálogo da `fonte` por key.
 */
export type RelatorioDef = {
  schemaVersion: number;
  id: string;
  nome: string;
  fonte: FonteRelatorio;
  filtros: FiltroRelatorio;
  colunas: readonly ColunaSaida[];
  totais: TotaisConfig;
  saida: SaidaFormato;
};
