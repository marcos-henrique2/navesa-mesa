import type { Connection, BindParameters } from "oracledb";
import oracledb from "oracledb";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FILTRO_ESTOQUE } from "./sync-veiculos";
import { chunk } from "../../src/lib/data/supabase";
import { mapearMarkupOficial, type ResultadoMapeamentoMarkup } from "./mapear-markup-oficial";

/**
 * Piloto da chamada real a NBS.PKG_MARKUP_VEIC.CALCULAR_MARKUP_ESTOQUE — ver
 * docs/sync-custos-markup-acesso.md pro histórico completo da investigação
 * (por que a heurística de custos-estoque-detalhado.ts diverge do relatório
 * oficial, e por que essa procedure é a fonte real usada pelo NBS).
 *
 * A conta COMISSAO só ganhou EXECUTE no pacote e SELECT em
 * NBS.VEICULOS_MARKUP_TMP agora (antes não tinha acesso nenhum). Não sabemos
 * ainda se a procedure faz commit interno/transação autônoma — por isso este
 * módulo é 100% aditivo, isolado do sync de custos atual
 * (custos-estoque-detalhado.ts), e processa SÓ um punhado de veículos por
 * rodada, gravando o resultado bruto pra inspeção manual antes de qualquer
 * mapeamento pras 8 categorias do relatório.
 *
 * LIMITE_CARROS_PILOTO: garantiu o menor "blast radius" possível (plano
 * combinado com o Marcos: 1 carro em produção primeiro, não os ~1100 de uma
 * vez) enquanto não validávamos o comportamento real da procedure.
 *
 * ATUALIZAÇÃO 21/10/2026: a primeira tentativa em produção (ORA-06550 /
 * PLS-00306 — número incorreto de argumentos) revelou que
 * CALCULAR_MARKUP_ESTOQUE é FUNCTION, não procedure, com 20 parâmetros (a
 * maioria IN OUT), não os 10 capturados no trace original. A assinatura real
 * foi lida direto do PACKAGE SPEC via ALL_SOURCE (owner='NBS',
 * name='PKG_MARKUP_VEIC') — ver docs/sync-custos-markup-acesso.md.
 *
 * ATUALIZAÇÃO 22/10/2026: piloto validado em 4 carros diferentes, batendo ao
 * centavo contra relatórios oficiais do NBS nos 4 (mapeamento das 8
 * categorias em mapear-markup-oficial.ts). `executarMarkupPiloto` agora
 * processa TODO o estoque do filtro por padrão (sem `limite` nem
 * `placaAlvo`) — LIMITE_CARROS_PILOTO deixou de ser o corte automático;
 * fica só como valor histórico/de referência pra quem quiser um corte manual
 * pequeno via o parâmetro `limite` (ou a flag `--markup-piloto-limite=N`, ver
 * executar-custos-vendidos.ts) durante um rollout gradual.
 */
export const LIMITE_CARROS_PILOTO = 1;

export type VeiculoCandidatoPiloto = {
  codEmpresa: number;
  codProduto: number;
  codModelo: number;
  chassiResumido: string;
  /** NBS.VEICULOS.PRECO_TABELA do mesmo veículo — ver nota em bindsChamadaProcedure. */
  precoVenda: number;
  /**
   * Chassi COMPLETO (não o resumido) — mesma resolução de candidatos de
   * CANDIDATOS.chassi em mapear-veiculo.ts (CHASSI, CHASSI_COMPLETO,
   * NUM_CHASSI, em ordem de prioridade). É a chave usada pra casar com
   * `veiculos.chassi` na gravação real (ver gravarMarkupOficialEmVeiculos) —
   * CHASSI_RESUMIDO não é a mesma coisa e NÃO existe como coluna em
   * `veiculos`. null quando nenhum candidato bateu nessa row — nesse caso a
   * gravação é pulada pra esse veículo (ver processarMarkupOficialEstoque),
   * preservando o valor já gravado pela heurística.
   */
  chassi: string | null;
  /** NBS.VEICULOS.PLACA_USADO — hoje só informativo/filtro de placaAlvo; o match de gravação é por chassi. */
  placa: string | null;
};

/**
 * Valores finais dos 10 parâmetros `in out` numéricos depois da chamada —
 * a function pode alterá-los internamente (ex.: desconto incondicional em
 * APrecoBasicoVenda/APrecoVenda). Dado valioso pra entender o comportamento
 * real da function; ainda não mapeado pras 8 categorias do relatório.
 */
export type ParametrosFinaisPiloto = {
  codGrupoComissao: number;
  precoBasicoVenda: number;
  precoFreteVenda: number;
  outrosVenda: number;
  opcionaisVenda: number;
  acessoriosVenda: number;
  opcionaisCusto: number;
  acessoriosCusto: number;
  descontoVenda: number;
  precoVenda: number;
};

export type ResultadoVeiculoPiloto = {
  candidato: VeiculoCandidatoPiloto;
  linhas: Record<string, unknown>[];
  /** Retorno VARCHAR2 da function — provavelmente mensagem de erro/status (não documentado pelo NBS). */
  resultado: string | null;
  parametrosFinais: ParametrosFinaisPiloto | null;
  erro: string | null;
};

export type ResultadoMarkupPiloto = {
  candidatosAvaliados: number;
  sucessos: ResultadoVeiculoPiloto[];
  falhas: ResultadoVeiculoPiloto[];
};

export type RegistroMarkupPilotoDebug = {
  chassi: string;
  cod_empresa: number;
  cod_produto: number;
  cod_modelo: number;
  /** { linhas, resultado, parametros_finais } — tudo junto no jsonb (ver construirRegistroDebug). */
  resultado_bruto: unknown;
};

/**
 * Mesmo filtro "em estoque hoje" validado em sync-veiculos.ts — não duplicar
 * a lógica aqui. PRECO_TABELA entra porque a function precisa do preço de
 * venda atual do veículo nos parâmetros in/out (ver bindsChamadaProcedure).
 * PLACA (v.PLACA_USADO — NBS.VEICULOS não tem coluna PLACA, só PLACA_USADO;
 * confirmado via all_tab_columns em 22/10/2026) entra pra permitir mirar o
 * piloto num carro específico (ver montarQueryCandidatosPiloto).
 *
 * Função pura — testável sem Oracle. Com placaAlvo, acrescenta o filtro de
 * placa normalizado (sem hífen, case-insensitive) via bind nomeado
 * `:placaAlvo` — nunca concatenado. Sem placaAlvo, mantém o comportamento
 * de hoje (todos os candidatos do filtro de estoque, sem filtro extra).
 *
 * `SELECT v.*` (em vez de uma lista explícita de colunas, como antes) —
 * decisão de 22/10/2026: a gravação real (ver gravarMarkupOficialEmVeiculos)
 * precisa do CHASSI COMPLETO pra casar com `veiculos.chassi`, mas não
 * sabemos com certeza qual coluna real do Oracle é essa (CHASSI vs.
 * CHASSI_COMPLETO vs. NUM_CHASSI — mesma incerteza de CANDIDATOS.chassi em
 * mapear-veiculo.ts). `v.*` traz qualquer uma que exista sem arriscar
 * ORA-00904 numa SELECT explícita de coluna inexistente; `mapearCandidatosPiloto`
 * resolve o candidato certo em runtime (ver CANDIDATOS_CHASSI abaixo).
 * `v.PLACA_USADO AS PLACA` continua explícito pro filtro de placaAlvo e pra
 * ficar disponível como campo informativo em `candidato.placa`.
 */
export function montarQueryCandidatosPiloto(placaAlvo?: string): string {
  const temPlacaAlvo = typeof placaAlvo === "string" && placaAlvo.length > 0;
  const filtroPlaca = temPlacaAlvo
    ? ` AND UPPER(REPLACE(v.PLACA_USADO, '-', '')) = UPPER(REPLACE(:placaAlvo, '-', ''))`
    : "";
  return `
  SELECT v.*, v.PLACA_USADO AS PLACA
  FROM NBS.VEICULOS v
  WHERE ${FILTRO_ESTOQUE}${filtroPlaca}
  ORDER BY v.CHASSI_RESUMIDO
`;
}

/** Query padrão (sem placa alvo) — mantida pra compatibilidade de quem já importava a constante. */
export const SQL_SELECT_CANDIDATOS_PILOTO = montarQueryCandidatosPiloto();

/**
 * Assinatura real lida em ALL_SOURCE (owner='NBS', name='PKG_MARKUP_VEIC') em
 * 21/10/2026 — é FUNCTION (retorna VARCHAR2), não procedure, com 20
 * parâmetros. A tentativa anterior (10 parâmetros, chamada como statement
 * solto) falhou com ORA-06550/PLS-00306. Ver docs/sync-custos-markup-acesso.md.
 */
export const SQL_CHAMAR_PROCEDURE_MARKUP = `
BEGIN
  :resultado := NBS.PKG_MARKUP_VEIC.CALCULAR_MARKUP_ESTOQUE(
    ACodEmpresa        => :codEmpresa,
    ACodProduto        => :codProduto,
    ACodModelo         => :codModelo,
    AChassiResumido    => :chassiResumido,
    ACodProposta       => :codProposta,
    ACodGrupoComissao  => :codGrupoComissao,
    APrecoBasicoVenda  => :precoBasicoVenda,
    APrecoFreteVenda   => :precoFreteVenda,
    AOutrosVenda       => :outrosVenda,
    AOpcionaisVenda    => :opcionaisVenda,
    AAcessoriosVenda   => :acessoriosVenda,
    AOpcionaisCusto    => :opcionaisCusto,
    AAcessoriosCusto   => :acessoriosCusto,
    ADescontoVenda     => :descontoVenda,
    APrecoVenda        => :precoVenda,
    ATipo              => :tipo,
    AComissaoVendedor  => :comissaoVendedor,
    AComissaoGerente   => :comissaoGerente,
    AConsiderarFVRFVN  => :considerarFvrFvn,
    AConsiderarDI      => :considerarDi
  );
END;
`;

export const SQL_SELECT_MARKUP_TMP = `SELECT * FROM NBS.VEICULOS_MARKUP_TMP ORDER BY ORDEM`;

function asStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function asNum(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Candidatos de coluna pro chassi COMPLETO — mesma lista de CANDIDATOS.chassi
 * em mapear-veiculo.ts (duplicada aqui de propósito: evita acoplar os dois
 * módulos só por isso; se a lista mudar lá, replicar aqui).
 */
const CANDIDATOS_CHASSI = ["CHASSI", "CHASSI_COMPLETO", "NUM_CHASSI"] as const;

function achaColuna(row: Record<string, unknown>, candidatos: readonly string[]): unknown {
  for (const c of candidatos) {
    if (Object.prototype.hasOwnProperty.call(row, c) && row[c] !== null && row[c] !== undefined) return row[c];
  }
  return undefined;
}

/** Função pura — mapeia linhas brutas da query de candidatos pro tipo tipado. Testável sem Oracle. */
export function mapearCandidatosPiloto(rows: Record<string, unknown>[]): VeiculoCandidatoPiloto[] {
  const candidatos: VeiculoCandidatoPiloto[] = [];
  for (const row of rows) {
    const chassiResumido = asStr(row.CHASSI_RESUMIDO);
    if (!chassiResumido) continue;
    candidatos.push({
      codEmpresa: asNum(row.COD_EMPRESA),
      codProduto: asNum(row.COD_PRODUTO),
      codModelo: asNum(row.COD_MODELO),
      chassiResumido,
      precoVenda: asNum(row.PRECO_TABELA),
      chassi: asStr(achaColuna(row, CANDIDATOS_CHASSI)),
      placa: asStr(row.PLACA),
    });
  }
  return candidatos;
}

/** Corta a lista de candidatos no limite do piloto (ver LIMITE_CARROS_PILOTO). Função pura — testável sem Oracle. */
export function limitarCandidatosPiloto(
  candidatos: VeiculoCandidatoPiloto[],
  limite: number,
): VeiculoCandidatoPiloto[] {
  if (!Number.isFinite(limite) || limite < 0) {
    throw new Error(`limitarCandidatosPiloto: limite inválido (${limite}).`);
  }
  return candidatos.slice(0, limite);
}

/**
 * Binds da chamada à function — SEMPRE via bind variables nomeadas (nunca
 * template string com os valores), mesmo vindo de dados já lidos do próprio
 * Oracle. Função pura — testável sem Oracle (BIND_INOUT/BIND_OUT/NUMBER/
 * STRING são constantes do módulo oracledb, não exigem conexão real).
 *
 * INTERPRETAÇÃO AINDA NÃO VALIDADA EMPIRICAMENTE (baseada só nos comentários
 * do PACKAGE SPEC lidos via ALL_SOURCE em 21/10/2026 — ver
 * docs/sync-custos-markup-acesso.md):
 * - APrecoBasicoVenda e APrecoVenda = NBS.VEICULOS.PRECO_TABELA do mesmo
 *   veículo ("preço venda pode ser alterado na tela de markup" /
 *   "pode alterar com desconto incondicional no vend_veic").
 * - ACodGrupoComissao = 0 (não sabemos o código de lookup certo; 0 como
 *   "não informado" é o palpite mais seguro).
 * - Os demais 7 campos in/out (APrecoFreteVenda, AOutrosVenda,
 *   AOpcionaisVenda, AAcessoriosVenda, AOpcionaisCusto, AAcessoriosCusto,
 *   ADescontoVenda) = 0, porque o comentário do código-fonte diz
 *   explicitamente "na simulação de proposta não tem gravado no banco" e
 *   estamos simulando com ACodProposta=0 (sem proposta real).
 * Pode precisar de ajuste depois de inspecionar `markup_piloto_debug` com
 * dado real.
 */
export function bindsChamadaProcedure(candidato: VeiculoCandidatoPiloto): BindParameters {
  return {
    resultado: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 4000 },
    codEmpresa: candidato.codEmpresa,
    codProduto: candidato.codProduto,
    codModelo: candidato.codModelo,
    chassiResumido: candidato.chassiResumido,
    codProposta: 0,
    codGrupoComissao: { dir: oracledb.BIND_INOUT, type: oracledb.NUMBER, val: 0 },
    precoBasicoVenda: { dir: oracledb.BIND_INOUT, type: oracledb.NUMBER, val: candidato.precoVenda },
    precoFreteVenda: { dir: oracledb.BIND_INOUT, type: oracledb.NUMBER, val: 0 },
    outrosVenda: { dir: oracledb.BIND_INOUT, type: oracledb.NUMBER, val: 0 },
    opcionaisVenda: { dir: oracledb.BIND_INOUT, type: oracledb.NUMBER, val: 0 },
    acessoriosVenda: { dir: oracledb.BIND_INOUT, type: oracledb.NUMBER, val: 0 },
    opcionaisCusto: { dir: oracledb.BIND_INOUT, type: oracledb.NUMBER, val: 0 },
    acessoriosCusto: { dir: oracledb.BIND_INOUT, type: oracledb.NUMBER, val: 0 },
    descontoVenda: { dir: oracledb.BIND_INOUT, type: oracledb.NUMBER, val: 0 },
    precoVenda: { dir: oracledb.BIND_INOUT, type: oracledb.NUMBER, val: candidato.precoVenda },
    tipo: "SIMULACAO",
    comissaoVendedor: -1,
    comissaoGerente: -1,
    considerarFvrFvn: "N",
    considerarDi: "N",
  };
}

/** Extrai os valores finais dos parâmetros in/out numéricos do outBinds da execução. Função pura — testável sem Oracle. */
export function extrairParametrosFinais(outBinds: Record<string, unknown>): ParametrosFinaisPiloto {
  return {
    codGrupoComissao: asNum(outBinds.codGrupoComissao),
    precoBasicoVenda: asNum(outBinds.precoBasicoVenda),
    precoFreteVenda: asNum(outBinds.precoFreteVenda),
    outrosVenda: asNum(outBinds.outrosVenda),
    opcionaisVenda: asNum(outBinds.opcionaisVenda),
    acessoriosVenda: asNum(outBinds.acessoriosVenda),
    opcionaisCusto: asNum(outBinds.opcionaisCusto),
    acessoriosCusto: asNum(outBinds.acessoriosCusto),
    descontoVenda: asNum(outBinds.descontoVenda),
    precoVenda: asNum(outBinds.precoVenda),
  };
}

/**
 * Deep-clone via JSON pra garantir que o resultado bruto vindo do Oracle
 * (pode conter Date, number, string, null) fica JSON-safe antes de ir pro
 * jsonb do Supabase — Date vira string ISO, igual ao que o client faria na
 * serialização do body da requisição, só que aqui é explícito e testável
 * sem rede. Função pura.
 */
export function serializarLinhasMarkup(linhas: Record<string, unknown>[]): unknown[] {
  return JSON.parse(JSON.stringify(linhas)) as unknown[];
}

/**
 * Função pura — monta o registro pronto pra gravar em markup_piloto_debug.
 * Testável sem Oracle. resultado (retorno da function) e parametrosFinais
 * (valores finais dos in/out) vão juntos dentro do jsonb resultado_bruto —
 * sem migration nova, ver RegistroMarkupPilotoDebug.
 */
export function construirRegistroDebug(
  candidato: VeiculoCandidatoPiloto,
  linhas: Record<string, unknown>[],
  resultado: string | null,
  parametrosFinais: ParametrosFinaisPiloto | null,
): RegistroMarkupPilotoDebug {
  return {
    chassi: candidato.chassiResumido,
    cod_empresa: candidato.codEmpresa,
    cod_produto: candidato.codProduto,
    cod_modelo: candidato.codModelo,
    resultado_bruto: {
      linhas: serializarLinhasMarkup(linhas),
      resultado,
      parametros_finais: parametrosFinais,
    },
  };
}

/**
 * Chama a procedure pra UM veículo e captura o resultado bruto de
 * VEICULOS_MARKUP_TMP. SEMPRE fecha com rollback no finally — defesa em
 * profundidade: não sabemos ainda se a procedure comita internamente ou usa
 * transação autônoma (ver docs/sync-custos-markup-acesso.md), então o
 * rollback é precaução, não garantia. Erro na chamada é capturado aqui (não
 * sobe) pra um veículo falhar não derrubar o piloto inteiro.
 */
async function processarVeiculoPiloto(
  conn: Connection,
  candidato: VeiculoCandidatoPiloto,
): Promise<ResultadoVeiculoPiloto> {
  try {
    // autoCommit: false explícito nesta chamada (não um estado global da
    // conexão) — evita qualquer commit implícito da própria function via
    // essa chamada; o rollback no finally é a defesa em profundidade real.
    const execResult = await conn.execute(SQL_CHAMAR_PROCEDURE_MARKUP, bindsChamadaProcedure(candidato), {
      autoCommit: false,
    });
    const outBinds = (execResult.outBinds ?? {}) as Record<string, unknown>;
    const resultado = asStr(outBinds.resultado);
    const parametrosFinais = extrairParametrosFinais(outBinds);

    const resultadoTmp = await conn.execute(SQL_SELECT_MARKUP_TMP, {}, { autoCommit: false });
    const linhas = (resultadoTmp.rows ?? []) as Record<string, unknown>[];
    return { candidato, linhas, resultado, parametrosFinais, erro: null };
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : String(err);
    return { candidato, linhas: [], resultado: null, parametrosFinais: null, erro: mensagem };
  } finally {
    try {
      await conn.rollback();
    } catch (rollbackErr) {
      console.warn(
        `  (aviso) rollback após markup piloto (chassi ${candidato.chassiResumido}) falhou: ` +
          `${rollbackErr instanceof Error ? rollbackErr.message : rollbackErr}`,
      );
    }
  }
}

/**
 * Orquestra o piloto completo: busca candidatos (mesmo filtro "em estoque
 * hoje" de sync-veiculos.ts).
 *
 * ESCALADO em 22/10/2026 (piloto validado em 4 carros): sem placaAlvo E sem
 * `limite`, processa TODO o estoque do filtro (não corta mais em
 * LIMITE_CARROS_PILOTO por padrão) — é o comportamento de produção.
 * `limite`, quando informado, corta a lista (rollout gradual manual: 10, 100,
 * etc. — ver `--markup-piloto-limite=N` em executar-custos-vendidos.ts).
 * Com placaAlvo, filtra na própria query (via bind) e IGNORA `limite` —
 * processa só esse 1 carro específico, não aumenta o blast radius, só muda
 * QUAL carro é processado. Processa cada candidato sequencialmente (mesma
 * Connection — sem Promise.all, ver justificativa de concorrência em
 * custos-estoque-detalhado.ts); log de progresso a cada 50 veículos (ver
 * ~1089 veículos esperados em produção — não deixa a rodada "silenciosa"
 * por minutos).
 */
export async function executarMarkupPiloto(
  conn: Connection,
  placaAlvo?: string,
  limite?: number,
): Promise<ResultadoMarkupPiloto> {
  const temPlacaAlvo = typeof placaAlvo === "string" && placaAlvo.length > 0;
  const sql = montarQueryCandidatosPiloto(placaAlvo);
  const binds: BindParameters = temPlacaAlvo ? { placaAlvo } : {};
  const resultCandidatos = await conn.execute(sql, binds);
  const rows = (resultCandidatos.rows ?? []) as Record<string, unknown>[];
  const candidatosMapeados = mapearCandidatosPiloto(rows);
  if (temPlacaAlvo && candidatosMapeados.length > 1) {
    throw new Error(
      `Placa ${placaAlvo} retornou ${candidatosMapeados.length} candidatos em estoque (esperado 0 ou 1) — ` +
        `abortando por segurança, garantia de "1 carro por rodada" não pode ser violada.`,
    );
  }
  const candidatos = temPlacaAlvo
    ? candidatosMapeados
    : typeof limite === "number"
      ? limitarCandidatosPiloto(candidatosMapeados, limite)
      : candidatosMapeados;

  const sucessos: ResultadoVeiculoPiloto[] = [];
  const falhas: ResultadoVeiculoPiloto[] = [];
  let processados = 0;

  for (const candidato of candidatos) {
    const resultado = await processarVeiculoPiloto(conn, candidato);
    if (resultado.erro) falhas.push(resultado);
    else sucessos.push(resultado);
    processados++;
    if (processados % 50 === 0 || processados === candidatos.length) {
      console.log(
        `  [markup oficial] ${processados}/${candidatos.length} veículo(s) processado(s) ` +
          `(${sucessos.length} sucesso, ${falhas.length} falha).`,
      );
    }
  }

  return { candidatosAvaliados: candidatos.length, sucessos, falhas };
}

/** Grava os resultados brutos capturados (só dos sucessos) em markup_piloto_debug, pra inspeção manual. */
export async function gravarMarkupPilotoDebug(
  sb: SupabaseClient,
  registros: RegistroMarkupPilotoDebug[],
): Promise<number> {
  if (registros.length === 0) return 0;
  const { error } = await sb.from("markup_piloto_debug").insert(registros);
  if (error) throw new Error(`gravarMarkupPilotoDebug: ${error.message}`);
  return registros.length;
}

/** Lê a flag `--markup-piloto` do argv. Função pura — testável sem Oracle. */
export function markupPilotoAtivado(args: string[]): boolean {
  return args.includes("--markup-piloto");
}

/** Payload pronto pras 8 colunas oficiais + custo_total — shape de `gravarMarkupOficialEmVeiculos`. */
export type PayloadMarkupOficial = {
  custo_revisoes: number;
  custo_forplan: number;
  custo_holdback: number;
  custo_acessorios: number;
  custo_adm: number;
  custo_impostos: number;
  custo_comissoes: number;
  custo_despesas_gerais: number;
  custo_total: number;
};

export type ItemGravacaoMarkupOficial = {
  /** Chassi COMPLETO (ver VeiculoCandidatoPiloto.chassi) — chave de match com `veiculos.chassi`. */
  chassi: string;
  payload: PayloadMarkupOficial;
};

function payloadMarkupOficial(mapeamento: ResultadoMapeamentoMarkup): PayloadMarkupOficial {
  return {
    custo_revisoes: mapeamento.categorias.custo_revisoes,
    custo_forplan: mapeamento.categorias.custo_forplan,
    custo_holdback: mapeamento.categorias.custo_holdback,
    custo_acessorios: mapeamento.categorias.custo_acessorios,
    custo_adm: mapeamento.categorias.custo_adm,
    custo_impostos: mapeamento.categorias.custo_impostos,
    custo_comissoes: mapeamento.categorias.custo_comissoes,
    custo_despesas_gerais: mapeamento.categorias.custo_despesas_gerais,
    // custo_total_oficial nunca é null aqui — mapearMarkupOficial marca
    // divergente=true quando COD_CUSTO=105 está ausente, e esse caso já foi
    // filtrado antes de chegar aqui (ver processarMarkupOficialEstoque).
    custo_total: mapeamento.custoTotalOficial ?? 0,
  };
}

/**
 * Atualiza as 9 colunas oficiais (8 categorias + custo_total) pro snapshot
 * MAIS RECENTE — UPDATE real (não insert/upsert: a linha já existe, inserida
 * pelo bloco VEÍCULOS desta mesma rodada com o valor da heurística antiga;
 * aqui só sobrescrevemos quando a reconciliação confirmou o valor oficial).
 *
 * Match por `snapshot_id` + `chassi` — único por constraint de banco
 * (`unique (snapshot_id, chassi)`, migration 002). NÃO usa upsert: um upsert
 * parcial (só as 9 colunas) falharia a validação NOT NULL de colunas como
 * `modelo`/`placa` antes mesmo de chegar no ON CONFLICT — update é a
 * ferramenta certa aqui.
 *
 * Concorrência controlada (lotes de `concorrencia`, default 20): diferente
 * das chamadas Oracle (sequenciais por natureza — mesma Connection
 * serializa, ver custos-estoque-detalhado.ts), cada UPDATE aqui é uma
 * requisição HTTP independente pro Supabase — paralelizar de verdade em
 * lotes pequenos é seguro e evita ~1089 round-trips sequenciais no pior caso.
 *
 * `semCorrespondencia` lista chassis que reconciliaram no Oracle mas não
 * bateram nenhuma linha do snapshot informado (ex.: filtro de estoque da
 * query de candidatos divergiu do filtro usado no bloco VEÍCULOS, ou a linha
 * já não está mais no snapshot) — não é erro fatal, só reportado pra quem
 * chama logar e investigar; o valor anterior (heurística) permanece intacto
 * nesse caso.
 *
 * `falhas` (achado do Quinn no review, 22/10/2026): cada UPDATE individual
 * roda dentro de um try/catch PRÓPRIO — um erro isolado (rate limit do
 * Supabase, blip de rede, etc.) não pode subir pelo `Promise.all` do lote e
 * abortar os lotes seguintes da rodada. Antes, UM UPDATE falhando no meio de
 * um lote de 20 derrubava a function inteira e deixava o resto da rodada
 * (potencialmente centenas de veículos) sem gravação alguma, sem distinguir
 * "abortado por erro técnico" de "divergência real de reconciliação". Agora
 * o erro é capturado por item, acumulado em `falhas`, e os lotes seguintes
 * continuam normalmente — quem chama decide o que fazer (logar, reprocessar
 * os chassis de `falhas` numa rodada futura, etc.).
 */
export async function gravarMarkupOficialEmVeiculos(
  sb: SupabaseClient,
  snapshotId: number,
  itens: readonly ItemGravacaoMarkupOficial[],
  concorrencia = 20,
): Promise<{ atualizados: number; semCorrespondencia: string[]; falhas: { chassi: string; erro: string }[] }> {
  if (itens.length === 0) return { atualizados: 0, semCorrespondencia: [], falhas: [] };

  let atualizados = 0;
  const semCorrespondencia: string[] = [];
  const falhas: { chassi: string; erro: string }[] = [];

  for (const lote of chunk([...itens], concorrencia)) {
    const resultados = await Promise.all(
      lote.map(async (item) => {
        try {
          const { data, error } = await sb
            .from("veiculos")
            .update(item.payload)
            .eq("snapshot_id", snapshotId)
            .eq("chassi", item.chassi)
            .select("id");
          if (error) throw new Error(error.message);
          return { chassi: item.chassi, atualizou: (data?.length ?? 0) > 0, erro: null as string | null };
        } catch (err) {
          const mensagem = err instanceof Error ? err.message : String(err);
          return { chassi: item.chassi, atualizou: false, erro: mensagem };
        }
      }),
    );
    for (const r of resultados) {
      if (r.erro) falhas.push({ chassi: r.chassi, erro: r.erro });
      else if (r.atualizou) atualizados++;
      else semCorrespondencia.push(r.chassi);
    }
  }

  return { atualizados, semCorrespondencia, falhas };
}

export type ResumoMarkupOficial = {
  candidatosAvaliados: number;
  sucessosOracle: number;
  falhasOracle: number;
  /** Veículos com gravação de fato aplicada (reconciliados + chassi resolvido + bateu no snapshot). */
  gravados: number;
  /** Reconciliação falhou (diferença ≥ R$0,01 ou custo_total_oficial ausente) — valor anterior (heurística) preservado. */
  divergentes: number;
  /** Reconciliou, mas sem chassi completo resolvido na query de candidatos — gravação pulada, valor anterior preservado. */
  semChassiParaGravar: number;
  /** Reconciliou e tinha chassi, mas não bateu nenhuma linha do snapshot informado — ver gravarMarkupOficialEmVeiculos. */
  semCorrespondenciaNoSnapshot: number;
  /** UPDATE individual falhou (erro técnico, não divergência) — ver gravarMarkupOficialEmVeiculos. */
  falhasGravacao: { chassi: string; erro: string }[];
  avisos: string[];
  /** Resultado bruto do Oracle pra quem chama reusar (ex.: gravação em markup_piloto_debug) sem repetir as chamadas. */
  sucessos: ResultadoVeiculoPiloto[];
  falhas: ResultadoVeiculoPiloto[];
};

/**
 * Orquestra o fluxo completo: busca candidatos + chama a function Oracle pra
 * cada um (executarMarkupPiloto) -> mapeia pras 8 categorias + reconcilia
 * (mapearMarkupOficial) -> grava só os que reconciliaram (gravarMarkupOficialEmVeiculos).
 *
 * DECISÃO DE FALLBACK (22/10/2026, ver pedido do Marcos no item 4): quando um
 * veículo falha na chamada Oracle OU diverge na reconciliação, este módulo
 * NÃO escreve nada pra ele — e isso É o fallback pra heurística antiga, sem
 * código extra: o bloco VEÍCULOS desta mesma rodada (`syncVeiculos`/
 * `gravarVeiculosNode`, ver index.ts) já INSERIU o snapshot com o valor da
 * heurística (`custos-estoque-detalhado.ts`) ANTES deste bloco rodar. "Não
 * sobrescrever" aqui equivale exatamente a "manter o valor da heurística que
 * já está na linha" — mesma filosofia de bloqueio de `executarCustosVendidos`,
 * adaptada ao fato de que aqui a "gravação anterior" é a heurística do MESMO
 * ciclo de sync, não um ciclo anterior (snapshot é recriado do zero a cada
 * rodada, nunca é um UPDATE incremental — ver gravarVeiculosNode em gravar.ts).
 * Isso só funciona se este bloco rodar DEPOIS do bloco VEÍCULOS na mesma
 * rodada (garantido em index.ts) e com o `snapshotId` daquela mesma rodada —
 * sem `snapshotId` (ex.: modo `--somente-markup-piloto`, que não roda
 * VEÍCULOS), a gravação real é pulada inteiramente (`sb`/`snapshotId` nulos),
 * ficando só leitura/diagnóstico.
 */
export async function processarMarkupOficialEstoque(
  conn: Connection,
  sb: SupabaseClient | null,
  snapshotId: number | null,
  opcoes: { placaAlvo?: string; limite?: number } = {},
): Promise<ResumoMarkupOficial> {
  const resultadoPiloto = await executarMarkupPiloto(conn, opcoes.placaAlvo, opcoes.limite);
  const avisos: string[] = [];
  let divergentes = 0;
  let semChassiParaGravar = 0;
  const itensGravacao: ItemGravacaoMarkupOficial[] = [];

  for (const sucesso of resultadoPiloto.sucessos) {
    const mapeamento = mapearMarkupOficial(sucesso.linhas);
    for (const aviso of mapeamento.avisos) {
      avisos.push(`chassi_resumido ${sucesso.candidato.chassiResumido}: ${aviso}`);
    }
    if (mapeamento.divergente) {
      divergentes++;
      avisos.push(
        `chassi_resumido ${sucesso.candidato.chassiResumido}: divergência bloqueou a gravação (${mapeamento.motivoDivergencia}) ` +
          `— valor da heurística já gravado neste snapshot foi preservado.`,
      );
      continue;
    }
    if (!sucesso.candidato.chassi) {
      semChassiParaGravar++;
      avisos.push(
        `chassi_resumido ${sucesso.candidato.chassiResumido}: reconciliou, mas sem chassi completo resolvido na query de candidatos ` +
          `— gravação pulada, valor da heurística preservado.`,
      );
      continue;
    }
    itensGravacao.push({ chassi: sucesso.candidato.chassi, payload: payloadMarkupOficial(mapeamento) });
  }

  for (const falha of resultadoPiloto.falhas) {
    avisos.push(
      `chassi_resumido ${falha.candidato.chassiResumido}: falha na chamada Oracle (${falha.erro}) ` +
        `— valor da heurística já gravado neste snapshot foi preservado.`,
    );
  }

  let gravados = 0;
  let semCorrespondenciaNoSnapshot = 0;
  const falhasGravacao: { chassi: string; erro: string }[] = [];
  if (sb && snapshotId != null && itensGravacao.length > 0) {
    const resultadoGravacao = await gravarMarkupOficialEmVeiculos(sb, snapshotId, itensGravacao);
    gravados = resultadoGravacao.atualizados;
    semCorrespondenciaNoSnapshot = resultadoGravacao.semCorrespondencia.length;
    for (const chassi of resultadoGravacao.semCorrespondencia) {
      avisos.push(`chassi ${chassi}: reconciliou, mas não encontrado no snapshot ${snapshotId} — gravação não aplicada.`);
    }
    for (const falha of resultadoGravacao.falhas) {
      falhasGravacao.push(falha);
      avisos.push(
        `chassi ${falha.chassi}: falha ao gravar no Supabase (${falha.erro}) — valor da heurística já gravado neste snapshot foi preservado.`,
      );
    }
  } else if (itensGravacao.length > 0) {
    avisos.push(
      `${itensGravacao.length} veículo(s) reconciliaram mas a gravação real foi pulada ` +
        `(${sb ? "snapshot desta rodada indisponível" : "SUPABASE não configurado"}) — só leitura/diagnóstico.`,
    );
  }

  return {
    candidatosAvaliados: resultadoPiloto.candidatosAvaliados,
    sucessosOracle: resultadoPiloto.sucessos.length,
    falhasOracle: resultadoPiloto.falhas.length,
    gravados,
    divergentes,
    semChassiParaGravar,
    semCorrespondenciaNoSnapshot,
    falhasGravacao,
    avisos,
    sucessos: resultadoPiloto.sucessos,
    falhas: resultadoPiloto.falhas,
  };
}
