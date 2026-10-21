import type { Connection } from "oracledb";
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
 */
export const LIMITE_CARROS_PILOTO = 1;

export type VeiculoCandidatoPiloto = {
  codEmpresa: number;
  codProduto: number;
  codModelo: number;
  chassiResumido: string;
};

export type ResultadoVeiculoPiloto = {
  candidato: VeiculoCandidatoPiloto;
  linhas: Record<string, unknown>[];
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
  resultado_bruto: unknown[];
};

/** Mesmo filtro "em estoque hoje" validado em sync-veiculos.ts — não duplicar a lógica aqui. */
export const SQL_SELECT_CANDIDATOS_PILOTO = `
  SELECT v.COD_EMPRESA, v.COD_PRODUTO, v.COD_MODELO, v.CHASSI_RESUMIDO
  FROM NBS.VEICULOS v
  WHERE ${FILTRO_ESTOQUE}
  ORDER BY v.CHASSI_RESUMIDO
`;

/** Assinatura capturada no trace do relatório oficial (08/10/2026) — ver docs/sync-custos-markup-acesso.md. */
export const SQL_CHAMAR_PROCEDURE_MARKUP = `
BEGIN
  NBS.PKG_MARKUP_VEIC.CALCULAR_MARKUP_ESTOQUE(
    ACODEMPRESA        => :codEmpresa,
    ACODPRODUTO        => :codProduto,
    ACODMODELO         => :codModelo,
    ACHASSI            => :chassiResumido,
    ACODPROPOSTA       => :codProposta,
    ATIPO              => :tipo,
    ACOMISSAOVENDEDOR  => :comissaoVendedor,
    ACOMISSAOGERENTE   => :comissaoGerente,
    ACONSIDERARFVRFVN  => :considerarFvrFvn,
    ACONSIDERARDI      => :considerarDi
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
 * Binds da chamada à procedure — SEMPRE via bind variables nomeadas (nunca
 * template string com os valores), mesmo vindo de dados já lidos do próprio
 * Oracle. Função pura — testável sem Oracle.
 */
export function bindsChamadaProcedure(candidato: VeiculoCandidatoPiloto): Record<string, string | number> {
  return {
    codEmpresa: candidato.codEmpresa,
    codProduto: candidato.codProduto,
    codModelo: candidato.codModelo,
    chassiResumido: candidato.chassiResumido,
    codProposta: 0,
    tipo: "SIMULACAO",
    comissaoVendedor: -1,
    comissaoGerente: -1,
    considerarFvrFvn: "N",
    considerarDi: "N",
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

/** Função pura — monta o registro pronto pra gravar em markup_piloto_debug. Testável sem Oracle. */
export function construirRegistroDebug(
  candidato: VeiculoCandidatoPiloto,
  linhas: Record<string, unknown>[],
): RegistroMarkupPilotoDebug {
  return {
    chassi: candidato.chassiResumido,
    cod_empresa: candidato.codEmpresa,
    cod_produto: candidato.codProduto,
    cod_modelo: candidato.codModelo,
    resultado_bruto: serializarLinhasMarkup(linhas),
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
    // conexão) — evita qualquer commit implícito da própria procedure via
    // essa chamada; o rollback no finally é a defesa em profundidade real.
    await conn.execute(SQL_CHAMAR_PROCEDURE_MARKUP, bindsChamadaProcedure(candidato), { autoCommit: false });
    const resultado = await conn.execute(SQL_SELECT_MARKUP_TMP, {}, { autoCommit: false });
    const linhas = (resultado.rows ?? []) as Record<string, unknown>[];
    return { candidato, linhas, erro: null };
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : String(err);
    return { candidato, linhas: [], erro: mensagem };
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
