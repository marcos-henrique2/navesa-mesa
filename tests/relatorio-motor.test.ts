/**
 * Testes do MOTOR GENÉRICO config-driven (`montarRelatorio`).
 *
 * Puros, sem I/O: catálogo sintético + linhas cruas → `RelatorioMontado`.
 * Cobrem os AC da Fatia A: ordem do def, agregação TOTAIS/MÉDIA por metadado,
 * precisão centavo-perfect (some cru), proteção deps→null, zero linhas sem crash,
 * e rejeição de fonte não implementada.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { montarRelatorio } from "@/lib/export/relatorio/motor";
import { validarFonteImplementada, fonteImplementada } from "@/lib/export/relatorio/registry";
import {
  RELATORIO_DEF_VERSION,
  type ColunaDef,
  type ColunaSaida,
  type RelatorioDef,
} from "@/lib/export/relatorio/tipos";

type Row = {
  nome: string | null;
  valor: number | null;
  km: number | null;
  a?: number;
  b?: number;
};

const CATALOGO: ReadonlyMap<string, ColunaDef<Row>> = new Map<string, ColunaDef<Row>>([
  ["nome", { key: "nome", label: "Nome", formato: "texto", agregacao: "nenhuma", getValor: (r) => r.nome }],
  ["valor", { key: "valor", label: "Valor", formato: "moeda", agregacao: "soma", getValor: (r) => r.valor }],
  ["km", { key: "km", label: "KM", formato: "km", agregacao: "media", getValor: (r) => r.km }],
  [
    "calc",
    {
      key: "calc",
      label: "Calc",
      formato: "numero",
      agregacao: "soma",
      deps: ["a", "b"],
      getValor: (r) => (r.a as number) - (r.b as number),
    },
  ],
]);

function def(colunas: ColunaSaida[], over: Partial<RelatorioDef> = {}): RelatorioDef {
  return {
    schemaVersion: RELATORIO_DEF_VERSION,
    id: "t",
    nome: "Teste",
    fonte: "estoque",
    filtros: {},
    colunas,
    totais: { incluirTotais: true, incluirMedia: true },
    saida: "xlsx",
    ...over,
  };
}

const cat = (key: string): ColunaSaida => ({ tipo: "catalogo", key });

describe("montarRelatorio — ordem e resolução de colunas", () => {
  it("respeita a ORDEM do def.colunas (não força ordem canônica)", () => {
    const linhas: Row[] = [{ nome: "x", valor: 1, km: 1 }];
    const direta = montarRelatorio(def([cat("nome"), cat("valor"), cat("km")]), linhas, CATALOGO);
    assert.deepEqual(direta.colunas.map((c) => c.label), ["Nome", "Valor", "KM"]);

    const invertida = montarRelatorio(def([cat("km"), cat("valor"), cat("nome")]), linhas, CATALOGO);
    assert.deepEqual(invertida.colunas.map((c) => c.label), ["KM", "Valor", "Nome"]);
  });

  it("coluna em branco entra sem getter, formato texto, agregacao nenhuma", () => {
    const m = montarRelatorio(
      def([cat("nome"), { tipo: "branco", label: "Obs" }]),
      [{ nome: "x", valor: null, km: null }],
      CATALOGO,
    );
    assert.equal(m.colunas[1]!.label, "Obs");
    assert.equal(m.colunas[1]!.branco, true);
    assert.equal(m.linhas[0]![1], null);
  });

  it("key inexistente no catálogo lança erro claro", () => {
    assert.throws(
      () => montarRelatorio(def([cat("nao_existe")]), [], CATALOGO),
      /não existe no catálogo/,
    );
  });

  it("schemaVersion incompatível lança erro", () => {
    assert.throws(
      () => montarRelatorio(def([cat("nome")], { schemaVersion: 99 }), [], CATALOGO),
      /schemaVersion/,
    );
  });
});

describe("montarRelatorio — agregação TOTAIS/MÉDIA", () => {
  const linhas: Row[] = [
    { nome: "a", valor: 100, km: 1000 },
    { nome: "b", valor: 200, km: 3000 },
  ];

  it("TOTAIS soma colunas 'soma'; deixa 'media'/'nenhuma' em BRANCO", () => {
    const m = montarRelatorio(def([cat("nome"), cat("valor"), cat("km")]), linhas, CATALOGO);
    assert.ok(m.totais);
    assert.equal(m.totais!.celulas[1], 300); // valor = 100+200
    assert.equal(m.totais!.celulas[2], null); // km é 'media' → branco no TOTAIS
    assert.equal(m.totais!.celulas[0], null); // nome é 'nenhuma' → branco
    assert.equal(m.totais!.rotulo, "TOTAIS");
    assert.equal(m.totais!.rotuloColIndex, 0); // 1ª coluna 'nenhuma'
  });

  it("MÉDIA média colunas 'media'; deixa 'soma'/'nenhuma' em BRANCO", () => {
    const m = montarRelatorio(def([cat("nome"), cat("valor"), cat("km")]), linhas, CATALOGO);
    assert.ok(m.media);
    assert.equal(m.media!.celulas[2], 2000); // km = (1000+3000)/2
    assert.equal(m.media!.celulas[1], null); // valor é 'soma' → branco na MÉDIA
    assert.equal(m.media!.rotulo, "MÉDIA");
  });

  it("MÉDIA ignora nulos (média só dos não-nulos)", () => {
    const comNulo: Row[] = [
      { nome: "a", valor: null, km: 1000 },
      { nome: "b", valor: null, km: null },
      { nome: "c", valor: null, km: 3000 },
    ];
    const m = montarRelatorio(def([cat("nome"), cat("km")]), comNulo, CATALOGO);
    // média de 1000 e 3000 (ignora o null) = 2000
    assert.equal(m.media!.celulas[1], 2000);
  });

  it("coluna 'soma' sem NENHUM valor contribuinte → BRANCO (null), não 0/\"R$ 0\"", () => {
    const semDinheiro: Row[] = [
      { nome: "a", valor: null, km: 100 },
      { nome: "b", valor: null, km: 200 },
    ];
    const m = montarRelatorio(def([cat("nome"), cat("valor"), cat("km")]), semDinheiro, CATALOGO);
    assert.equal(m.totais!.celulas[1], null); // 'valor' soma sem valores → branco (não 0)
    assert.equal(m.media!.celulas[2], 150); // km média segue normal
  });

  it("zero linhas → sem TOTAIS/MÉDIA, sem divisão por zero, sem crash", () => {
    const m = montarRelatorio(def([cat("nome"), cat("valor"), cat("km")]), [], CATALOGO);
    assert.equal(m.linhas.length, 0);
    assert.equal(m.totais, null);
    assert.equal(m.media, null);
  });

  it("incluirTotais/incluirMedia=false suprimem as linhas", () => {
    const m = montarRelatorio(
      def([cat("valor"), cat("km")], { totais: { incluirTotais: false, incluirMedia: false } }),
      linhas,
      CATALOGO,
    );
    assert.equal(m.totais, null);
    assert.equal(m.media, null);
  });

  it("sem coluna 'soma' não emite TOTAIS; sem 'media' não emite MÉDIA", () => {
    const soNome = montarRelatorio(def([cat("nome")]), linhas, CATALOGO);
    assert.equal(soNome.totais, null);
    assert.equal(soNome.media, null);
  });
});

describe("montarRelatorio — precisão centavo-perfect", () => {
  it("soma os valores CRUS (não arredonda por linha antes de somar)", () => {
    // 3 × 100.25 = 300.75. Se alguém arredondasse por linha (100 cada) daria 300 → bug R$ 0,75.
    const linhas: Row[] = [
      { nome: "a", valor: 100.25, km: null },
      { nome: "b", valor: 100.25, km: null },
      { nome: "c", valor: 100.25, km: null },
    ];
    const m = montarRelatorio(def([cat("nome"), cat("valor")]), linhas, CATALOGO);
    assert.equal(m.totais!.celulas[1], 300.75);
  });

  it("soma de centavos quebrados bate exatamente (divergência R$ 0,00)", () => {
    const linhas: Row[] = [
      { nome: "a", valor: 12345.67, km: null },
      { nome: "b", valor: 8901.23, km: null },
      { nome: "c", valor: 4567.1, km: null },
    ];
    const esperado = 12345.67 + 8901.23 + 4567.1;
    const m = montarRelatorio(def([cat("nome"), cat("valor")]), linhas, CATALOGO);
    assert.equal(m.totais!.celulas[1], esperado);
  });
});

describe("montarRelatorio — proteção deps→null", () => {
  it("campo de deps AUSENTE na linha rende null (nunca NaN/crash)", () => {
    // 'calc' depende de 'a' e 'b'. A linha só tem 'a' → célula null, não NaN.
    const linhas: Row[] = [{ nome: "x", valor: null, km: null, a: 10 }];
    const m = montarRelatorio(def([cat("nome"), cat("calc")]), linhas, CATALOGO);
    assert.equal(m.linhas[0]![1], null);
  });

  it("com todas as deps presentes, o getter roda normalmente", () => {
    const linhas: Row[] = [{ nome: "x", valor: null, km: null, a: 10, b: 3 }];
    const m = montarRelatorio(def([cat("nome"), cat("calc")]), linhas, CATALOGO);
    assert.equal(m.linhas[0]![1], 7);
  });

  it("dep presente (mesmo null) NÃO dispara a proteção — proteção é por PRESENÇA de propriedade", () => {
    // 'a' presente com valor null: a propriedade existe → o getter roda normalmente.
    // (getter faz null - 3, que em JS coage pra -3). O ponto é: proteção cobre
    // AUSÊNCIA de propriedade, não valor nulo — quem lida com null é o getter.
    const linhas: Array<Row & { a: number | null }> = [
      { nome: "x", valor: null, km: null, a: null as unknown as number, b: 3 },
    ];
    const m = montarRelatorio(def([cat("calc")]), linhas, CATALOGO);
    assert.equal(m.linhas[0]![0], -3); // getter rodou (não virou null pela proteção)
  });
});

describe("montarRelatorio — serializabilidade (round-trip JSON)", () => {
  it("def sobrevive a JSON.parse(JSON.stringify(def)) e o motor produz saída idêntica", () => {
    const original = def([cat("nome"), cat("valor"), cat("km"), { tipo: "branco", label: "Obs" }]);
    const linhas: Row[] = [
      { nome: "x", valor: 10.25, km: 1000 },
      { nome: "y", valor: 20.75, km: 3000 },
    ];
    const clone = JSON.parse(JSON.stringify(original)) as RelatorioDef;
    // Prova que nada relevante virou função/undefined na serialização.
    assert.deepEqual(clone, original);

    const a = montarRelatorio(original, linhas, CATALOGO);
    const b = montarRelatorio(clone, linhas, CATALOGO);
    assert.deepEqual(b.colunas, a.colunas);
    assert.deepEqual(b.linhas, a.linhas);
    assert.deepEqual(b.totais, a.totais);
    assert.deepEqual(b.media, a.media);
  });
});

describe("registry — fontes implementadas", () => {
  it("estoque é implementada; custos/patio/vendas não", () => {
    assert.equal(fonteImplementada("estoque"), true);
    assert.equal(fonteImplementada("custos"), false);
    assert.equal(fonteImplementada("patio"), false);
    assert.equal(fonteImplementada("vendas"), false);
  });

  it("validarFonteImplementada lança erro claro pra fonte não implementada", () => {
    assert.throws(() => validarFonteImplementada("custos"), /não implementada/);
    assert.doesNotThrow(() => validarFonteImplementada("estoque"));
  });
});
