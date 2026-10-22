import { describe, it } from "node:test";
import assert from "node:assert/strict";
import oracledb from "oracledb";
import type { Connection } from "oracledb";
import {
  LIMITE_CARROS_PILOTO,
  mapearCandidatosPiloto,
  limitarCandidatosPiloto,
  bindsChamadaProcedure,
  extrairParametrosFinais,
  serializarLinhasMarkup,
  construirRegistroDebug,
  gravarMarkupPilotoDebug,
  montarQueryCandidatosPiloto,
  executarMarkupPiloto,
  type VeiculoCandidatoPiloto,
  type ParametrosFinaisPiloto,
} from "../scripts/sync-nbs/calcular-markup-estoque";

function candidato(overrides: Partial<VeiculoCandidatoPiloto> = {}): VeiculoCandidatoPiloto {
  return {
    codEmpresa: 2,
    codProduto: 10,
    codModelo: 300,
    chassiResumido: "163765",
    precoVenda: 85000,
    chassi: "9BWZZZ377VT004251",
    placa: "ABC1234",
    ...overrides,
  };
}

function parametrosFinais(overrides: Partial<ParametrosFinaisPiloto> = {}): ParametrosFinaisPiloto {
  return {
    codGrupoComissao: 0,
    precoBasicoVenda: 85000,
    precoFreteVenda: 0,
    outrosVenda: 0,
    opcionaisVenda: 0,
    acessoriosVenda: 0,
    opcionaisCusto: 0,
    acessoriosCusto: 0,
    descontoVenda: 0,
    precoVenda: 85000,
    ...overrides,
  };
}

describe("markup piloto — candidatos", () => {
  it("mapeia linhas brutas do Oracle pro tipo tipado, ignorando chassi vazio", () => {
    const candidatos = mapearCandidatosPiloto([
      { COD_EMPRESA: 2, COD_PRODUTO: 10, COD_MODELO: 300, CHASSI_RESUMIDO: "163765", PRECO_TABELA: 85000 },
      { COD_EMPRESA: 2, COD_PRODUTO: 10, COD_MODELO: 300, CHASSI_RESUMIDO: "", PRECO_TABELA: 90000 },
      { COD_EMPRESA: 2, COD_PRODUTO: 10, COD_MODELO: 300, CHASSI_RESUMIDO: null, PRECO_TABELA: 90000 },
    ]);
    assert.equal(candidatos.length, 1);
    assert.deepEqual(candidatos[0], {
      codEmpresa: 2,
      codProduto: 10,
      codModelo: 300,
      chassiResumido: "163765",
      precoVenda: 85000,
      chassi: null,
      placa: null,
    });
  });

  it("converte campos numéricos vindos como string sem quebrar", () => {
    const candidatos = mapearCandidatosPiloto([
      { COD_EMPRESA: "2", COD_PRODUTO: "10", COD_MODELO: "300", CHASSI_RESUMIDO: "163765", PRECO_TABELA: "85000" },
    ]);
    assert.deepEqual(candidatos[0], {
      codEmpresa: 2,
      codProduto: 10,
      codModelo: 300,
      chassiResumido: "163765",
      precoVenda: 85000,
      chassi: null,
      placa: null,
    });
  });

  it("resolve o chassi completo via CHASSI/CHASSI_COMPLETO/NUM_CHASSI (ordem de prioridade) e a placa via PLACA", () => {
    const porChassi = mapearCandidatosPiloto([
      { COD_EMPRESA: 2, COD_PRODUTO: 10, COD_MODELO: 300, CHASSI_RESUMIDO: "163765", PRECO_TABELA: 85000, CHASSI: "FULL1", CHASSI_COMPLETO: "FULL2", PLACA: "ABC1234" },
    ]);
    assert.equal(porChassi[0].chassi, "FULL1", "CHASSI tem prioridade sobre CHASSI_COMPLETO");
    assert.equal(porChassi[0].placa, "ABC1234");

    const porChassiCompleto = mapearCandidatosPiloto([
      { COD_EMPRESA: 2, COD_PRODUTO: 10, COD_MODELO: 300, CHASSI_RESUMIDO: "163765", PRECO_TABELA: 85000, CHASSI_COMPLETO: "FULL2", NUM_CHASSI: "FULL3" },
    ]);
    assert.equal(porChassiCompleto[0].chassi, "FULL2", "sem CHASSI, cai pra CHASSI_COMPLETO");

    const semNenhum = mapearCandidatosPiloto([
      { COD_EMPRESA: 2, COD_PRODUTO: 10, COD_MODELO: 300, CHASSI_RESUMIDO: "163765", PRECO_TABELA: 85000 },
    ]);
    assert.equal(semNenhum[0].chassi, null, "sem nenhum candidato, chassi fica null (gravação pulada depois, não falha o mapeamento)");
  });

  it("LIMITE_CARROS_PILOTO é 1 — valor histórico/debug, não é mais o corte automático (ver executarMarkupPiloto)", () => {
    assert.equal(LIMITE_CARROS_PILOTO, 1);
  });

  it("corta a lista no limite informado", () => {
    const candidatos = [candidato({ chassiResumido: "A" }), candidato({ chassiResumido: "B" }), candidato({ chassiResumido: "C" })];
    assert.deepEqual(limitarCandidatosPiloto(candidatos, 1), [candidatos[0]]);
    assert.deepEqual(limitarCandidatosPiloto(candidatos, 2), [candidatos[0], candidatos[1]]);
    assert.deepEqual(limitarCandidatosPiloto(candidatos, 10), candidatos);
    assert.deepEqual(limitarCandidatosPiloto([], 1), []);
  });

  it("rejeita limite inválido", () => {
    assert.throws(() => limitarCandidatosPiloto([candidato()], -1), /limite inválido/);
  });
});

describe("markup piloto — binds da function", () => {
  it("monta os 20 binds da assinatura real (ALL_SOURCE, 21/10/2026) + o bind de retorno", () => {
    const binds = bindsChamadaProcedure(candidato()) as Record<string, unknown>;
    assert.deepEqual(binds, {
      resultado: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 4000 },
      codEmpresa: 2,
      codProduto: 10,
      codModelo: 300,
      chassiResumido: "163765",
      codProposta: 0,
      codGrupoComissao: { dir: oracledb.BIND_INOUT, type: oracledb.NUMBER, val: 0 },
      precoBasicoVenda: { dir: oracledb.BIND_INOUT, type: oracledb.NUMBER, val: 85000 },
      precoFreteVenda: { dir: oracledb.BIND_INOUT, type: oracledb.NUMBER, val: 0 },
      outrosVenda: { dir: oracledb.BIND_INOUT, type: oracledb.NUMBER, val: 0 },
      opcionaisVenda: { dir: oracledb.BIND_INOUT, type: oracledb.NUMBER, val: 0 },
      acessoriosVenda: { dir: oracledb.BIND_INOUT, type: oracledb.NUMBER, val: 0 },
      opcionaisCusto: { dir: oracledb.BIND_INOUT, type: oracledb.NUMBER, val: 0 },
      acessoriosCusto: { dir: oracledb.BIND_INOUT, type: oracledb.NUMBER, val: 0 },
      descontoVenda: { dir: oracledb.BIND_INOUT, type: oracledb.NUMBER, val: 0 },
      precoVenda: { dir: oracledb.BIND_INOUT, type: oracledb.NUMBER, val: 85000 },
      tipo: "SIMULACAO",
      comissaoVendedor: -1,
      comissaoGerente: -1,
      considerarFvrFvn: "N",
      considerarDi: "N",
    });
  });

  it("usa NBS.VEICULOS.PRECO_TABELA do candidato em APrecoBasicoVenda e APrecoVenda", () => {
    const binds = bindsChamadaProcedure(candidato({ precoVenda: 123456.78 })) as Record<
      string,
      { val?: number } | unknown
    >;
    assert.equal((binds.precoBasicoVenda as { val: number }).val, 123456.78);
    assert.equal((binds.precoVenda as { val: number }).val, 123456.78);
  });
});

describe("markup piloto — valores finais dos parâmetros in/out", () => {
  it("extrai e converte os valores finais do outBinds da execução", () => {
    const outBinds = {
      resultado: "OK",
      codGrupoComissao: 3,
      precoBasicoVenda: 84000,
      precoFreteVenda: 500,
      outrosVenda: 0,
      opcionaisVenda: 0,
      acessoriosVenda: 0,
      opcionaisCusto: 0,
      acessoriosCusto: 0,
      descontoVenda: 1000,
      precoVenda: 84500,
    };
    assert.deepEqual(extrairParametrosFinais(outBinds), {
      codGrupoComissao: 3,
      precoBasicoVenda: 84000,
      precoFreteVenda: 500,
      outrosVenda: 0,
      opcionaisVenda: 0,
      acessoriosVenda: 0,
      opcionaisCusto: 0,
      acessoriosCusto: 0,
      descontoVenda: 1000,
      precoVenda: 84500,
    });
  });

  it("trata outBinds ausente/incompleto como zero, sem quebrar", () => {
    assert.deepEqual(extrairParametrosFinais({}), {
      codGrupoComissao: 0,
      precoBasicoVenda: 0,
      precoFreteVenda: 0,
      outrosVenda: 0,
      opcionaisVenda: 0,
      acessoriosVenda: 0,
      opcionaisCusto: 0,
      acessoriosCusto: 0,
      descontoVenda: 0,
      precoVenda: 0,
    });
  });
});

describe("markup piloto — serialização do resultado bruto", () => {
  it("serializa linhas simples sem alterar valores", () => {
    const linhas = [{ ORDEM: 1, DESCRICAO: "Forplan", VALOR: 123.45 }];
    assert.deepEqual(serializarLinhasMarkup(linhas), linhas);
  });

  it("converte Date pra string ISO (jsonb não aceita Date direto)", () => {
    const data = new Date("2026-10-08T12:00:00.000Z");
    const linhas = [{ ORDEM: 1, DATA_WHOLESALE_1: data }];
    const serializado = serializarLinhasMarkup(linhas) as { DATA_WHOLESALE_1: string }[];
    assert.equal(serializado[0].DATA_WHOLESALE_1, data.toISOString());
  });

  it("mantém null e não quebra com múltiplas linhas por ORDEM", () => {
    const linhas = [
      { ORDEM: 1, COD_CUSTO: 7, VALOR: null },
      { ORDEM: 2, COD_CUSTO: 9, VALOR: 50 },
    ];
    assert.deepEqual(serializarLinhasMarkup(linhas), linhas);
  });

  it("constrói o registro de debug pronto pra gravação, com resultado e parâmetros finais juntos no jsonb", () => {
    const linhas = [{ ORDEM: 1, VALOR: 10 }];
    const finais = parametrosFinais();
    const registro = construirRegistroDebug(candidato(), linhas, "OK", finais);
    assert.deepEqual(registro, {
      chassi: "163765",
      cod_empresa: 2,
      cod_produto: 10,
      cod_modelo: 300,
      resultado_bruto: { linhas, resultado: "OK", parametros_finais: finais },
    });
  });

  it("aceita resultado e parâmetros finais nulos (chamada que falhou antes de capturar outBinds)", () => {
    const registro = construirRegistroDebug(candidato(), [], null, null);
    assert.deepEqual(registro.resultado_bruto, { linhas: [], resultado: null, parametros_finais: null });
  });
});

describe("markup piloto — query de candidatos (placa alvo)", () => {
  it("sem placaAlvo, mantém a query padrão sem filtro extra (comportamento de hoje)", () => {
    const sql = montarQueryCandidatosPiloto();
    assert.ok(!sql.includes(":placaAlvo"), "não deve referenciar bind de placa sem placaAlvo");
    assert.ok(sql.includes("v.PLACA_USADO AS PLACA"), "deve trazer a placa (PLACA_USADO é a única coluna que existe em NBS.VEICULOS)");
    assert.ok(sql.includes("ORDER BY v.CHASSI_RESUMIDO"));
  });

  it("com placaAlvo, acrescenta filtro normalizado (sem hífen, case-insensitive) via bind nomeado", () => {
    const sql = montarQueryCandidatosPiloto("NVO-0860");
    assert.ok(sql.includes(":placaAlvo"), "deve usar bind nomeado, nunca concatenar o valor");
    assert.ok(!sql.includes("NVO-0860"), "o valor da placa não pode ir concatenado na string SQL");
    assert.ok(sql.includes("REPLACE(v.PLACA_USADO, '-', '')"));
    assert.ok(sql.includes("REPLACE(:placaAlvo, '-', '')"));
    assert.ok(sql.includes("UPPER("));
  });

  it("placa vazia é tratada como ausência de filtro (sem placaAlvo)", () => {
    const sql = montarQueryCandidatosPiloto("");
    assert.ok(!sql.includes(":placaAlvo"));
  });
});

describe("markup piloto — executarMarkupPiloto com placaAlvo", () => {
  function conexaoFalsa(rowsCandidatos: Record<string, unknown>[]) {
    const chamadas: { sql: string; binds: unknown }[] = [];
    const conn = {
      async execute(sql: string, binds?: unknown) {
        chamadas.push({ sql, binds });
        if (chamadas.length === 1) return { rows: rowsCandidatos };
        if (binds && typeof binds === "object" && "resultado" in (binds as Record<string, unknown>)) {
          return { outBinds: { resultado: "OK" } };
        }
        return { rows: [{ ORDEM: 1 }] };
      },
      async rollback() {},
    } as unknown as Connection;
    return { conn, chamadas };
  }

  const duasLinhas = [
    { COD_EMPRESA: 2, COD_PRODUTO: 10, COD_MODELO: 300, CHASSI_RESUMIDO: "A1", PRECO_TABELA: 1000 },
    { COD_EMPRESA: 2, COD_PRODUTO: 10, COD_MODELO: 301, CHASSI_RESUMIDO: "A2", PRECO_TABELA: 2000 },
  ];

  it("sem placaAlvo e sem limite, processa TODOS os candidatos do filtro (escalado em 22/10/2026)", async () => {
    const { conn, chamadas } = conexaoFalsa(duasLinhas);
    const resultado = await executarMarkupPiloto(conn);
    assert.equal(resultado.candidatosAvaliados, duasLinhas.length);
    assert.deepEqual(chamadas[0].binds, {});
    assert.ok(!chamadas[0].sql.includes(":placaAlvo"));
  });

  it("sem placaAlvo, com limite explícito, corta a lista (rollout gradual manual)", async () => {
    const { conn } = conexaoFalsa(duasLinhas);
    const resultado = await executarMarkupPiloto(conn, undefined, 1);
    assert.equal(resultado.candidatosAvaliados, 1);
  });

  const umaLinha = [duasLinhas[0]];

  it("com placaAlvo, ignora LIMITE_CARROS_PILOTO e passa a placa como bind (nunca concatenada)", async () => {
    const { conn, chamadas } = conexaoFalsa(umaLinha);
    const resultado = await executarMarkupPiloto(conn, "NVO-0860");
    assert.equal(resultado.candidatosAvaliados, 1);
    assert.deepEqual(chamadas[0].binds, { placaAlvo: "NVO-0860" });
    assert.ok(chamadas[0].sql.includes(":placaAlvo"));
    assert.ok(!chamadas[0].sql.includes("NVO-0860"));
  });

  it("0 candidatos (placa não encontrada no estoque atual) é reportado sem erro fatal", async () => {
    const { conn } = conexaoFalsa([]);
    const resultado = await executarMarkupPiloto(conn, "ZZZ0000");
    assert.deepEqual(resultado, { candidatosAvaliados: 0, sucessos: [], falhas: [] });
  });

  it("com placaAlvo, mais de um candidato retornado aborta por segurança — sem chamar a function nem uma vez", async () => {
    const { conn, chamadas } = conexaoFalsa(duasLinhas);
    await assert.rejects(
      () => executarMarkupPiloto(conn, "NVO-0860"),
      /Placa NVO-0860 retornou 2 candidatos em estoque \(esperado 0 ou 1\)/,
    );
    // só a 1ª chamada (SELECT dos candidatos) deve ter ocorrido — nenhuma chamada
    // à function NBS.PKG_MARKUP_VEIC.CALCULAR_MARKUP_ESTOQUE (processarVeiculoPiloto).
    assert.equal(chamadas.length, 1, "não deve processar nenhum veículo quando há mais de 1 candidato pra placaAlvo");
  });
});

describe("markup piloto — gravação", () => {
  it("não chama o Supabase quando não há registros", async () => {
    let chamou = false;
    const sbFalso = {
      from() {
        chamou = true;
        return this;
      },
    } as unknown as Parameters<typeof gravarMarkupPilotoDebug>[0];
    const total = await gravarMarkupPilotoDebug(sbFalso, []);
    assert.equal(total, 0);
    assert.equal(chamou, false);
  });

  it("lança erro descritivo quando o Supabase retorna erro no insert", async () => {
    const sbFalso = {
      from() {
        return { insert: async () => ({ error: { message: "falhou" } }) };
      },
    } as unknown as Parameters<typeof gravarMarkupPilotoDebug>[0];
    await assert.rejects(
      () => gravarMarkupPilotoDebug(sbFalso, [{ chassi: "163765", cod_empresa: 2, cod_produto: 10, cod_modelo: 300, resultado_bruto: [] }]),
      /gravarMarkupPilotoDebug: falhou/,
    );
  });
});
