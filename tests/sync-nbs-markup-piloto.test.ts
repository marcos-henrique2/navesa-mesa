import { describe, it } from "node:test";
import assert from "node:assert/strict";
import oracledb from "oracledb";
import {
  LIMITE_CARROS_PILOTO,
  mapearCandidatosPiloto,
  limitarCandidatosPiloto,
  bindsChamadaProcedure,
  extrairParametrosFinais,
  serializarLinhasMarkup,
  construirRegistroDebug,
  markupPilotoAtivado,
  gravarMarkupPilotoDebug,
  type VeiculoCandidatoPiloto,
  type ParametrosFinaisPiloto,
} from "../scripts/sync-nbs/calcular-markup-estoque";

function candidato(overrides: Partial<VeiculoCandidatoPiloto> = {}): VeiculoCandidatoPiloto {
  return { codEmpresa: 2, codProduto: 10, codModelo: 300, chassiResumido: "163765", precoVenda: 85000, ...overrides };
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
    });
  });

  it("LIMITE_CARROS_PILOTO é 1 — blast radius mínimo enquanto a procedure não é validada", () => {
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

describe("markup piloto — flag de ativação", () => {
  it("só ativa com a flag explícita --markup-piloto", () => {
    assert.equal(markupPilotoAtivado([]), false);
    assert.equal(markupPilotoAtivado(["--somente-custos"]), false);
    assert.equal(markupPilotoAtivado(["--markup-piloto"]), true);
    assert.equal(markupPilotoAtivado(["--somente-custos", "--markup-piloto"]), true);
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
