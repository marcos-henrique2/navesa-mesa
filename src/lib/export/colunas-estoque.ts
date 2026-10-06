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
 * Colunas em branco (ex. "Observações", "Anotações" ou qualquer nome que o
 * Marcos digitar no modal) NÃO estão no catálogo: são especiais (sempre em
 * branco, sem getter) e são tratadas à parte pelo gerador via `colunasBranco`
 * (ver `construirDefEstoque` em `relatorio/estoque.ts`).
 */

import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";
import type { CustoEstoqueDetalhado } from "@/lib/parsers/nbs-custos-estoque-pdf";
import type { ColunaAgregacao, ColunaDef } from "@/lib/export/relatorio/tipos";
import { calcularCustoReal } from "@/lib/export/custo-real";
import { resolverCustoComFallbackManual } from "@/lib/export/custo-estoque-fallback";

/**
 * Veículo enriquecido com o nome da loja já resolvido (como o gerencial usa),
 * opcionalmente o preço FIPE já resolvido (batch) e, opcionalmente, o
 * registro manual de custos de estoque (upload do PDF "Custos de Veículos em
 * Estoque" em /upload) — ver colunas `fipe` e `custo_holdback`/
 * `custo_acessorios`/`custo_impostos`/`custo_comissoes`/`custo_adm`/
 * `custo_despesas_gerais` abaixo. Nenhum dos dois é preenchido pelo catálogo (dependem de fonte
 * externa/Supabase): quem monta a lista de veículos pro modal/exportação é
 * responsável por resolvê-los ANTES — `fipe` com o mesmo critério do Vendas
 * Matriz (só preenche quando `plausibilidadeVerificada === true`),
 * `custoEstoqueManual` buscando por placa normalizada em
 * `custosEstoquePorPlaca` (store `useInventory`).
 */
export type VeiculoExportavel = VeiculoParsed & {
  empresa_nome?: string | null;
  fipe?: number | null;
  custoEstoqueManual?: CustoEstoqueDetalhado | null;
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
  | "custo_real"
  | "fipe"
  | "custo_revisoes"
  | "custo_forplan"
  | "custo_holdback"
  | "custo_acessorios"
  | "custo_impostos"
  | "custo_comissoes"
  | "custo_adm"
  | "custo_despesas_gerais"
  | "custo_detalhado_total";

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
   *  - "baixa": a categoria tem fonte mapeada no Oracle (CODIGO_CUSTO ou
   *    coluna direta), mas veio zerada em toda a amostra testada até agora
   *    (sem exemplo não-zero pra confirmar o valor, só a ausência de erro).
   *  - "nao_apurado": a coluna pode vir em BRANCO (não R$ 0,00) — ainda não
   *    existe fórmula de cálculo definida pra essa categoria.
   *  - "parcial": é uma SOMA de categorias com confiança desigual (ex.:
   *    `custo_detalhado_total` mistura categorias confirmadas com "baixa" e
   *    "nao_apurado") — o total pode estar subestimado mesmo sem nenhuma
   *    categoria individual estar "errada".
   *  - "diverge_relatorio": a coluna TEM fonte real e confirmada no Oracle
   *    (não vem zerada), mas o valor que ela soma é um custo DIFERENTE do que
   *    o relatório nativo NBS "Custos de Veículos em Estoque" mostra na
   *    coluna de mesmo nome — confirmado em 05/10/2026 (migration 046) que
   *    esse valor é CALCULADO pelo motor do relatório (dado fiscal fora das
   *    tabelas que o sync Oracle consegue ler), não soma de lançamentos.
   *    Diferente de "baixa" (onde a fonte pode estar certa mas só não foi
   *    confirmada por falta de exemplo não-zero): aqui já sabemos que a fonte
   *    mapeada mede outra coisa.
   */
  confianca?: "baixa" | "nao_apurado" | "parcial" | "diverge_relatorio";
  /**
   * true quando o getValor desta coluna cai pro registro MANUAL de
   * `custos_estoque_detalhado` (upload do PDF "Custos de Veículos em
   * Estoque" em /upload) sempre que o automático (sync Oracle) vem sem dado
   * — ver `resolverCustoComFallbackManual`. Usado só pra UI (ícone extra no
   * modal avisando que o valor exportado PODE ter vindo de upload manual,
   * possivelmente desatualizado); não afeta o valor em si.
   */
  fallbackManual?: boolean;
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
  { key: "valoriza", label: "Valoriza (bônus fábrica)", formato: "moeda", agregacao: "soma", grupo: "custos", getValor: (v) => v.valoriza },
  // custo_real = Custo de entrada − Valoriza — mesma fórmula do Vendas Matriz
  // (calcularDerivadosLinha, campo custoReal), extraída pra custo-real.ts pra
  // garantir que os dois relatórios nunca divirjam. Sem indicador de confiança.
  { key: "custo_real", label: "Custo Real (Entrada − Valoriza)", formato: "moeda", agregacao: "soma", grupo: "custos", getValor: (v) => calcularCustoReal(v.valor_aquisicao, v.valoriza) },
  { key: "custo_total", label: "Custo total", formato: "moeda", agregacao: "soma", grupo: "custos", getValor: (v) => v.custo_total },
  // fipe: só vem preenchido quando quem monta a lista de veículos resolveu o
  // batch FIPE (ver VeiculoExportavel.fipe) — o catálogo só lê o campo, não
  // busca o preço. `null` quando não há FIPE confirmado pra esse chassi.
  { key: "fipe", label: "FIPE", formato: "moeda", agregacao: "soma", grupo: "venda_margem", getValor: (v) => v.fipe ?? null },
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
  { key: "custo_revisoes", label: "Revisões", formato: "moeda", agregacao: "soma", grupo: "custos_detalhados", getValor: (v) => v.custo_revisoes },
  // custo_forplan: confiança baixa REMOVIDA em 05/10/2026 — fonte corrigida
  // pra NBS.VEICULOS.CUSTO_FORPLAN_FINAL (coluna direta, não CODIGO_CUSTO),
  // confirmada batendo ao centavo contra o relatório nativo PDF em 3
  // veículos. Ver migration 043 e custos-estoque-detalhado.ts.
  { key: "custo_forplan", label: "Forplan", formato: "moeda", agregacao: "soma", grupo: "custos_detalhados", getValor: (v) => v.custo_forplan },
  // custo_holdback: fonte corrigida em 05/10/2026 pra NBS.VEICULOS.HOLD_BACK_FINAL
  // (coluna direta, mesmo padrão de custo_forplan) — mas sem exemplo
  // não-zero no PDF de hoje pra confirmar valor (os ~283 veículos testados
  // vieram todos R$0,00 tanto no PDF quanto no Oracle). Confiança continua
  // "baixa" até aparecer um veículo com HoldBack real pra validar.
  //
  // FALLBACK MANUAL (06/10/2026): investigação confirmou que HoldBack/
  // Acessórios/Comissões/ADM/Despesas Gerais não têm fonte automática
  // confiável via Oracle (ver migration 047) — quando o automático vem SEM
  // DADO (0 pras 3 primeiras, null pras 2 últimas), usa o registro manual de
  // `custos_estoque_detalhado` (upload do PDF em /upload) como alternativa.
  // Automático prevalece quando tem valor não-zero (mais fresco — sync a
  // cada 2h — vs. manual, que só atualiza quando alguém sobe o PDF de novo).
  { key: "custo_holdback", label: "HoldBack", formato: "moeda", agregacao: "soma", grupo: "custos_detalhados", confianca: "baixa", fallbackManual: true, getValor: (v) => resolverCustoComFallbackManual(v.custo_holdback, v.custoEstoqueManual?.holdback) },
  { key: "custo_acessorios", label: "Acessórios", formato: "moeda", agregacao: "soma", grupo: "custos_detalhados", confianca: "baixa", fallbackManual: true, getValor: (v) => resolverCustoComFallbackManual(v.custo_acessorios, v.custoEstoqueManual?.acessorios) },
  // custo_impostos: confianca "diverge_relatorio" ADICIONADA em 05/10/2026 (migration
  // 046) — a soma dos 20 CODIGO_CUSTO (ICMS/PIS/COFINS lançados na aquisição) é um dado
  // REAL, mas confirmado que NUNCA bate com a coluna "Impostos" do relatório nativo NBS
  // (que é calculada pelo motor do relatório, fora das tabelas que o sync Oracle
  // consegue ler — ver migration 046, caso definitivo: chassi com ZERO lançamentos mas
  // Impostos=R$499,50 no relatório nativo). Era "sem indicador" até aqui por engano
  // (migration 040 validou só magnitude plausível, nunca o valor exato contra o PDF).
  //
  // FALLBACK MANUAL (06/10/2026): decisão do Marcos — Impostos passa a se
  // comportar IGUAL a HoldBack/Acessórios/Comissões (mesma regra "automático
  // sempre-número, 0 = ausente" de resolverCustoComFallbackManual): quando o
  // automático vier 0, cai pro valor do upload manual (`custoEstoqueManual.
  // impostos`) se existir. `confianca: "diverge_relatorio"` CONTINUA — ainda
  // é verdade quando não há fallback ativo (automático≠0, dado real porém
  // DIFERENTE do relatório nativo); só deixa de ser 100% precisa quando o
  // manual entra em ação (nesse caso o valor É o do relatório nativo, já que
  // vem do PDF dele — ver texto ajustado em ConfigurarRelatorioEstoqueModal).
  { key: "custo_impostos", label: "Impostos", formato: "moeda", agregacao: "soma", grupo: "custos_detalhados", confianca: "diverge_relatorio", fallbackManual: true, getValor: (v) => resolverCustoComFallbackManual(v.custo_impostos, v.custoEstoqueManual?.impostos) },
  { key: "custo_comissoes", label: "Comissões", formato: "moeda", agregacao: "soma", grupo: "custos_detalhados", confianca: "baixa", fallbackManual: true, getValor: (v) => resolverCustoComFallbackManual(v.custo_comissoes, v.custoEstoqueManual?.comissoes) },
  { key: "custo_adm", label: "ADM", formato: "moeda", agregacao: "soma", grupo: "custos_detalhados", confianca: "nao_apurado", fallbackManual: true, getValor: (v) => resolverCustoComFallbackManual(v.custo_adm, v.custoEstoqueManual?.adm) },
  { key: "custo_despesas_gerais", label: "Despesas Gerais", formato: "moeda", agregacao: "soma", grupo: "custos_detalhados", confianca: "nao_apurado", fallbackManual: true, getValor: (v) => resolverCustoComFallbackManual(v.custo_despesas_gerais, v.custoEstoqueManual?.desp_gerais) },
  // custo_detalhado_total: soma das OUTRAS 7 categorias (exclui Forplan —
  // esclarecido pelo Marcos em 05/10/2026: Forplan é custo FINANCEIRO (floor
  // plan), conceitualmente diferente do "custo que o carro teve"; continua
  // tendo sua própria coluna, só não entra nesta soma). Trata null de
  // ADM/Despesas Gerais como 0 (NÃO propagar null — se propagasse, a coluna
  // ficaria "—" pra quase todo carro, já que essas duas são "não apurado" na
  // maioria).
  //
  // HoldBack/Acessórios/Impostos/Comissões/ADM/Despesas Gerais entram aqui JÁ
  // com o fallback manual resolvido (mesma chamada de
  // resolverCustoComFallbackManual usada nas colunas individuais acima) —
  // senão o total divergiria da soma do que o Marcos vê nas colunas quando o
  // fallback entra em ação. Só Revisões não tem fallback (sem
  // fallbackManual), entra direto.
  //
  // NOTA 06/10/2026: Impostos passou a ter fallback manual (ver comentário na
  // coluna acima) — antes entrava direto (`v.custo_impostos`), agora entra
  // resolvido como as outras 5, pra não divergir da coluna individual quando
  // o manual entra em ação.
  {
    key: "custo_detalhado_total",
    label: "Custos detalhados (total, sem Forplan)",
    formato: "moeda",
    agregacao: "soma",
    grupo: "custos_detalhados",
    confianca: "parcial",
    getValor: (v) =>
      v.custo_revisoes +
      (resolverCustoComFallbackManual(v.custo_holdback, v.custoEstoqueManual?.holdback) ?? 0) +
      (resolverCustoComFallbackManual(v.custo_acessorios, v.custoEstoqueManual?.acessorios) ?? 0) +
      (resolverCustoComFallbackManual(v.custo_impostos, v.custoEstoqueManual?.impostos) ?? 0) +
      (resolverCustoComFallbackManual(v.custo_comissoes, v.custoEstoqueManual?.comissoes) ?? 0) +
      (resolverCustoComFallbackManual(v.custo_adm, v.custoEstoqueManual?.adm) ?? 0) +
      (resolverCustoComFallbackManual(v.custo_despesas_gerais, v.custoEstoqueManual?.desp_gerais) ?? 0),
  },
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
