import type { Connection, BindParameters } from "oracledb";
import oracledb from "oracledb";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FILTRO_ESTOQUE } from "./sync-veiculos";

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
 * LIMITE_CARROS_PILOTO: só isto garante o menor "blast radius" possível
 * (plano combinado com o Marcos: 1 carro em produção primeiro, não os ~1100
 * de uma vez) enquanto não validamos o comportamento real da procedure.
 * Suba esse número SÓ depois de inspecionar `markup_piloto_debug` e
 * confirmar que não há efeito colateral.
 *
 * ATUALIZAÇÃO 21/10/2026: a primeira tentativa em produção (ORA-06550 /
 * PLS-00306 — número incorreto de argumentos) revelou que
 * CALCULAR_MARKUP_ESTOQUE é FUNCTION, não procedure, com 20 parâmetros (a
 * maioria IN OUT), não os 10 capturados no trace original. A assinatura real
 * foi lida direto do PACKAGE SPEC via ALL_SOURCE (owner='NBS',
 * name='PKG_MARKUP_VEIC') — ver docs/sync-custos-markup-acesso.md.
 */
export const LIMITE_CARROS_PILOTO = 1;

export type VeiculoCandidatoPiloto = {
  codEmpresa: number;
  codProduto: number;
  codModelo: number;
  chassiResumido: string;
  /** NBS.VEICULOS.PRECO_TABELA do mesmo veículo — ver nota em bindsChamadaProcedure. */
  precoVenda: number;
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
 */
export const SQL_SELECT_CANDIDATOS_PILOTO = `
  SELECT v.COD_EMPRESA, v.COD_PRODUTO, v.COD_MODELO, v.CHASSI_RESUMIDO, v.PRECO_TABELA
  FROM NBS.VEICULOS v
  WHERE ${FILTRO_ESTOQUE}
  ORDER BY v.CHASSI_RESUMIDO
`;

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
 * hoje" de sync-veiculos.ts), corta em LIMITE_CARROS_PILOTO, e processa cada
 * um sequencialmente (mesma Connection — sem Promise.all, ver justificativa
 * de concorrência em custos-estoque-detalhado.ts).
 */
export async function executarMarkupPiloto(conn: Connection): Promise<ResultadoMarkupPiloto> {
  const resultCandidatos = await conn.execute(SQL_SELECT_CANDIDATOS_PILOTO);
  const rows = (resultCandidatos.rows ?? []) as Record<string, unknown>[];
  const candidatos = limitarCandidatosPiloto(mapearCandidatosPiloto(rows), LIMITE_CARROS_PILOTO);

  const sucessos: ResultadoVeiculoPiloto[] = [];
  const falhas: ResultadoVeiculoPiloto[] = [];

  for (const candidato of candidatos) {
    const resultado = await processarVeiculoPiloto(conn, candidato);
    if (resultado.erro) falhas.push(resultado);
    else sucessos.push(resultado);
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
