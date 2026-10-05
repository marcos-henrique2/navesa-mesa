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
  | "patio"
  | "valoriza"
  | "custo_revisoes"
  | "custo_forplan"
  | "custo_holdback"
  | "custo_acessorios"
  | "custo_impostos"
  | "custo_comissoes"
  | "custo_adm"
  | "custo_despesas_gerais";

/**
 * Agrupamento visual das colunas no modal (metadado — NÃO afeta a ordem de
 * exportação no XLSX, que segue sempre a ordem de `COLUNAS_ESTOQUE`).
 */
export type GrupoColuna =
  | "identificacao"
  | "localizacao_status"
  | "custos"
  | "custos_detalhados"
  | "venda_margem";

/** Ordem canônica dos grupos no modal. */
export const GRUPOS_ESTOQUE: readonly GrupoColuna[] = [
  "identificacao",
  "localizacao_status",
  "custos",
  "custos_detalhados",
  "venda_margem",
];

/** Rótulo pt-BR de cada grupo, pro header colapsável do modal. */
export const GRUPO_LABEL: Readonly<Record<GrupoColuna, string>> = {
  identificacao: "Identificação",
  localizacao_status: "Localização e status",
  custos: "Custos",
  custos_detalhados: "Custos detalhados (Oracle)",
  venda_margem: "Venda e margem",
};

/** Valor cru que um getter pode retornar (sem `any`). */
export type ValorColuna = string | number | null;

export type ColunaEstoque = {
  key: ColunaKey;
  label: string;
  formato: ColunaFormato;
  /** Como a coluna participa das linhas TOTAIS/MÉDIA do motor genérico. */
  agregacao: ColunaAgregacao;
  getValor: (v: VeiculoExportavel) => ValorColuna;
  /** Grupo visual no modal (metadado — não entra no XLSX). */
  grupo: GrupoColuna;
  /**
   * Indicador de confiança exibido no modal (ícone + tooltip), quando a
   * coluna merece aviso. Ausente = confiança alta/média, sem aviso.
   *  - "baixa": a categoria tem CODIGO_CUSTO mapeado no Oracle, mas veio
   *    zerada na maioria da amostra testada.
   *  - "nao_apurado": a coluna pode vir em BRANCO (não R$ 0,00) — ainda não
   *    existe fórmula de cálculo definida pra essa categoria.
   */
  confianca?: "baixa" | "nao_apurado";
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
  { key: "loja", label: "Loja", formato: "texto", agregacao: "nenhuma", grupo: "localizacao_status", getValor: (v) => v.empresa_nome ?? null },
  { key: "placa", label: "Placa", formato: "texto", agregacao: "nenhuma", grupo: "identificacao", getValor: (v) => v.placa },
  { key: "chassi", label: "Chassi", formato: "texto", agregacao: "nenhuma", grupo: "identificacao", getValor: (v) => v.chassi },
  { key: "marca", label: "Marca", formato: "texto", agregacao: "nenhuma", grupo: "identificacao", getValor: (v) => v.marca },
  { key: "modelo", label: "Modelo", formato: "texto", agregacao: "nenhuma", grupo: "identificacao", getValor: (v) => v.modelo },
  // Ano é UMA opção só, no formato que a concessionária usa: "2021/2022" (fabricação/modelo),
  // ou "2022" quando os dois coincidem. Antes existiam três checkboxes — "Ano fabricação",
  // "Ano modelo" e "Ano" —, e o rótulo "Ano" não deixava claro que era o combinado: quem
  // queria os dois marcava "Ano modelo" e recebia só um. Uma opção, sem ambiguidade.
  { key: "ano", label: "Ano/Modelo", formato: "texto", agregacao: "nenhuma", grupo: "identificacao", getValor: (v) => fmtAno(v.ano_fabricacao, v.ano_modelo) },
  { key: "km", label: "KM", formato: "km", agregacao: "media", grupo: "identificacao", getValor: (v) => v.km },
  { key: "cor_externa", label: "Cor", formato: "texto", agregacao: "nenhuma", grupo: "identificacao", getValor: (v) => v.cor_externa },
  { key: "combustivel", label: "Combustível", formato: "texto", agregacao: "nenhuma", grupo: "identificacao", getValor: (v) => v.combustivel },
  { key: "dias_patio", label: "Dias parado", formato: "numero", agregacao: "media", grupo: "localizacao_status", getValor: (v) => v.dias_patio },
  { key: "valor_aquisicao", label: "Custo de entrada", formato: "moeda", agregacao: "soma", grupo: "custos", getValor: (v) => v.valor_aquisicao },
  { key: "custo_total", label: "Custo total", formato: "moeda", agregacao: "soma", grupo: "custos", getValor: (v) => v.custo_total },
  { key: "preco_venda", label: "Preço de venda", formato: "moeda", agregacao: "soma", grupo: "venda_margem", getValor: (v) => v.preco_venda },
  {
    key: "margem",
    label: "Margem",
    formato: "moeda",
    agregacao: "soma",
    grupo: "venda_margem",
    getValor: (v) =>
      v.preco_venda != null && v.valor_aquisicao != null ? v.preco_venda - v.valor_aquisicao : null,
  },
  { key: "descricao_situacao", label: "Status", formato: "texto", agregacao: "nenhuma", grupo: "localizacao_status", getValor: (v) => v.descricao_situacao },
  { key: "patio", label: "Localização", formato: "texto", agregacao: "nenhuma", grupo: "localizacao_status", getValor: (v) => v.patio.trim() || null },
  { key: "valoriza", label: "Valoriza (bônus fábrica)", formato: "moeda", agregacao: "soma", grupo: "custos", getValor: (v) => v.valoriza },
  { key: "custo_revisoes", label: "Revisões", formato: "moeda", agregacao: "soma", grupo: "custos_detalhados", getValor: (v) => v.custo_revisoes },
  { key: "custo_forplan", label: "Forplan", formato: "moeda", agregacao: "soma", grupo: "custos_detalhados", confianca: "baixa", getValor: (v) => v.custo_forplan },
  { key: "custo_holdback", label: "HoldBack", formato: "moeda", agregacao: "soma", grupo: "custos_detalhados", confianca: "baixa", getValor: (v) => v.custo_holdback },
  { key: "custo_acessorios", label: "Acessórios", formato: "moeda", agregacao: "soma", grupo: "custos_detalhados", confianca: "baixa", getValor: (v) => v.custo_acessorios },
  { key: "custo_impostos", label: "Impostos", formato: "moeda", agregacao: "soma", grupo: "custos_detalhados", getValor: (v) => v.custo_impostos },
  { key: "custo_comissoes", label: "Comissões", formato: "moeda", agregacao: "soma", grupo: "custos_detalhados", confianca: "baixa", getValor: (v) => v.custo_comissoes },
  { key: "custo_adm", label: "ADM", formato: "moeda", agregacao: "soma", grupo: "custos_detalhados", confianca: "nao_apurado", getValor: (v) => v.custo_adm ?? null },
  { key: "custo_despesas_gerais", label: "Despesas Gerais", formato: "moeda", agregacao: "soma", grupo: "custos_detalhados", confianca: "nao_apurado", getValor: (v) => v.custo_despesas_gerais ?? null },
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

/**
 * Normaliza texto pra comparação de busca: remove acentos (NFD + strip dos
 * diacríticos) e passa pra minúsculas. Pura e testável — usada tanto no
 * label da coluna quanto no termo digitado, pra "forplan" bater com "Forplan"
 * e "comissões" bater com "comissoes".
 */
export function normalizarBusca(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** Testa se o label da coluna corresponde ao termo de busca (vazio = sempre true). */
export function colunaCorrespondeABusca(coluna: ColunaEstoque, termo: string): boolean {
  const alvo = normalizarBusca(termo.trim());
  if (alvo === "") return true;
  return normalizarBusca(coluna.label).includes(alvo);
}

/**
 * Um grupo "abre sozinho" (sem busca ativa) se tiver pelo menos uma coluna
 * marcada em `COLUNAS_DEFAULT` por padrão. Com as defaults atuais, isso abre
 * Identificação/Localização e status/Custos/Venda e margem e deixa só
 * "Custos detalhados (Oracle)" fechado (nenhuma default pertence a ele).
 */
export function grupoAbrePorDefault(
  grupo: GrupoColuna,
  defaults: readonly ColunaKey[] = COLUNAS_DEFAULT,
): boolean {
  return COLUNAS_ESTOQUE.some((c) => c.grupo === grupo && defaults.includes(c.key));
}

/** Conjunto dos grupos que devem começar expandidos (ver `grupoAbrePorDefault`). */
export function gruposAbertosPorDefault(
  defaults: readonly ColunaKey[] = COLUNAS_DEFAULT,
): ReadonlySet<GrupoColuna> {
  return new Set(GRUPOS_ESTOQUE.filter((g) => grupoAbrePorDefault(g, defaults)));
}
