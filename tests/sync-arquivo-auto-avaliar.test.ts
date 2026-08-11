/**
 * Testes do espelho tipado do contrato §5 da migration 029 (Story 2.2, Fatia 3a).
 *
 * Estes testes NÃO tocam banco — não existe harness de Postgres no projeto. O
 * que eles provam é que a tela lê corretamente o JSONB que a RPC devolve, e a
 * fixture principal é uma resposta REAL, capturada do preview rodado contra
 * produção com o arquivo do Marcos (58 linhas: 56 da Matriz + 2 de outra loja).
 *
 * `node --import tsx --test tests/*.test.ts`
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  baldesFecham,
  contarAcoes,
  formatarValorCampo,
  lerRelatorioSync,
  ordenarPorAtencao,
  pareceSessaoExpirada,
  rotuloCampo,
  rotuloMotivoIgnorada,
  rotuloMotivoNaoEncontrada,
  temValorTrocado,
  type RelatorioSync,
} from "@/lib/repasses/sync-arquivo-auto-avaliar";

// ─── Fixture: recorte REAL do retorno do preview em produção ─────────────────
// Capturado com `sincronizar_repasse_arquivo_auto_avaliar_preview` no arquivo de
// 2026-08-11. `resumo` é o real (56 linhas da Matriz); os arrays são o recorte
// que cobre os quatro baldes, com placa real só onde ela já aparece na story.
const RESPOSTA_REAL: unknown = {
  versao: 1,
  modo: "preview",
  gerado_em: "2026-08-11T17:48:53-03:00",
  truncado: false,
  resumo: {
    linhas_no_arquivo: 56,
    sem_alteracao: 0,
    com_alteracao: 54,
    nao_encontradas: 2,
    ignoradas: 0,
    campos_a_alterar: 104,
    linhas_gravadas: 0,
  },
  com_alteracao: [
    {
      linha: 2,
      placa_norm: "AAA0A00",
      repasse_id: 401,
      modelo: "MODELO A",
      status: "subido",
      // `patch` VEM no JSON e tem que ser descartado na leitura — a tela nunca
      // pode renderizar a partir dele (AC13b).
      patch: { qtde_anuncios: 21, valor_maior_oferta: 160000 },
      campos: [
        { campo: "qtde_anuncios", antes: null, depois: 21, acao: "preenche" },
        { campo: "valor_maior_oferta", antes: null, depois: 160000.0, acao: "preenche" },
      ],
      campos_observados_sem_mudanca: ["valor_compra_repasse", "valor_minimo"],
    },
    {
      linha: 31,
      placa_norm: "RBM3C09",
      repasse_id: 405,
      modelo: "RANGER 3.2 LIMITED 4X4 CD 20V DIESEL 4P AUTOMATICO",
      status: "subido",
      patch: { valor_minimo: 142500 },
      campos: [
        { campo: "qtde_anuncios", antes: null, depois: 7, acao: "preenche" },
        { campo: "valor_fipe", antes: 171062.0, depois: 169799.0, acao: "altera" },
        { campo: "valor_maior_oferta", antes: null, depois: 143000.0, acao: "preenche" },
        { campo: "valor_minimo", antes: 147000.0, depois: 142500.0, acao: "altera" },
      ],
      campos_observados_sem_mudanca: [
        "valor_auto_avaliar",
        "valor_compra_repasse",
        "valor_compre_por",
        "valor_web",
      ],
    },
  ],
  sem_alteracao: [],
  nao_encontradas: [
    { linha: 9, placa_norm: "TGK0B80", motivo: "sem_repasse" },
    { linha: 18, placa_norm: "PRU3B12", motivo: "sem_repasse" },
  ],
  ignoradas: [],
};

function rel(): RelatorioSync {
  return lerRelatorioSync(RESPOSTA_REAL);
}

describe("lerRelatorioSync — leitura do contrato §5", () => {
  it("lê o resumo real do arquivo de 2026-08-11", () => {
    const r = rel();
    assert.equal(r.modo, "preview");
    assert.equal(r.truncado, false);
    assert.deepEqual(r.resumo, {
      linhas_no_arquivo: 56,
      sem_alteracao: 0,
      com_alteracao: 54,
      nao_encontradas: 2,
      ignoradas: 0,
      campos_a_alterar: 104,
      linhas_gravadas: 0,
    });
  });

  it("lê `campos[]` com antes/depois/acao — o contrato observado na RPC real", () => {
    const rbm = rel().com_alteracao.find((i) => i.placa_norm === "RBM3C09");
    assert.ok(rbm);
    assert.equal(rbm.campos.length, 4);
    assert.deepEqual(rbm.campos.map((c) => c.campo).sort(), [
      "qtde_anuncios",
      "valor_fipe",
      "valor_maior_oferta",
      "valor_minimo",
    ]);
    const minimo = rbm.campos.find((c) => c.campo === "valor_minimo");
    assert.deepEqual(minimo, {
      campo: "valor_minimo",
      antes: 147000,
      depois: 142500,
      acao: "altera",
    });
  });

  it("`antes` é null exatamente quando a ação é preenche", () => {
    for (const item of rel().com_alteracao) {
      for (const c of item.campos) {
        assert.equal(c.antes === null, c.acao === "preenche", `${item.placa_norm}/${c.campo}`);
      }
    }
  });

  it("descarta `patch` — a tela não consegue renderizar o que a RPC usa internamente", () => {
    const bruto = rel().com_alteracao[0] as unknown as Record<string, unknown>;
    assert.equal("patch" in bruto, false);
  });

  it("aceita numeric-como-string do PostgREST sem virar NaN", () => {
    const r = lerRelatorioSync({
      resumo: { linhas_no_arquivo: "3", com_alteracao: "1" },
      com_alteracao: [
        {
          linha: "7",
          placa_norm: "AAA0A00",
          repasse_id: "88",
          campos: [{ campo: "valor_fipe", antes: "100.50", depois: "120.25", acao: "altera" }],
        },
      ],
    });
    assert.equal(r.resumo.linhas_no_arquivo, 3);
    assert.equal(r.com_alteracao[0].linha, 7);
    assert.equal(r.com_alteracao[0].repasse_id, 88);
    assert.deepEqual(
      { a: r.com_alteracao[0].campos[0].antes, d: r.com_alteracao[0].campos[0].depois },
      { a: 100.5, d: 120.25 },
    );
  });

  it("não estoura com retorno vazio, nulo ou de formato inesperado", () => {
    for (const entrada of [null, undefined, 42, "erro", [], {}]) {
      const r = lerRelatorioSync(entrada);
      assert.equal(r.resumo.linhas_no_arquivo, 0);
      assert.deepEqual(r.com_alteracao, []);
      assert.deepEqual(r.ignoradas, []);
    }
  });

  it("lê o modo aplicado e as linhas gravadas", () => {
    const r = lerRelatorioSync({
      modo: "aplicado",
      resumo: { com_alteracao: 54, linhas_gravadas: 54 },
    });
    assert.equal(r.modo, "aplicado");
    assert.equal(r.resumo.linhas_gravadas, 54);
  });

  it("lê ignoradas com motivo e repasse_ids só quando existem", () => {
    const r = lerRelatorioSync({
      ignoradas: [
        { linha: 12, placa_norm: "GHI3F45", motivo: "repasse_ambiguo", repasse_ids: [201, 377] },
        { linha: 58, placa_norm: null, motivo: "placa_invalida" },
      ],
    });
    assert.deepEqual(r.ignoradas[0].repasse_ids, [201, 377]);
    assert.equal(r.ignoradas[1].repasse_ids, null);
    assert.equal(r.ignoradas[1].placa_norm, null);
  });
});

describe("contarAcoes — preencher buraco ≠ trocar valor", () => {
  it("separa preenche de altera na fixture real", () => {
    // A distinção é o que impede a primeira importação de parecer um desastre:
    // 4 dos 6 campos aqui são buraco sendo preenchido.
    assert.deepEqual(contarAcoes(rel()), { preenche: 4, altera: 2 });
  });

  it("conta zero em relatório sem mudanças", () => {
    assert.deepEqual(contarAcoes(lerRelatorioSync({})), { preenche: 0, altera: 0 });
  });
});

describe("ordenarPorAtencao — quem troca valor vem primeiro", () => {
  it("põe o carro com valor trocado na frente do que só preenche", () => {
    const ordenado = ordenarPorAtencao(rel().com_alteracao);
    assert.deepEqual(
      ordenado.map((i) => i.placa_norm),
      ["RBM3C09", "AAA0A00"],
    );
  });

  it("preserva a ordem do arquivo dentro de cada grupo", () => {
    const r = lerRelatorioSync({
      com_alteracao: [
        { linha: 9, placa_norm: "C", campos: [{ campo: "x", antes: null, depois: 1, acao: "preenche" }] },
        { linha: 3, placa_norm: "A", campos: [{ campo: "x", antes: null, depois: 1, acao: "preenche" }] },
        { linha: 5, placa_norm: "B", campos: [{ campo: "x", antes: 2, depois: 1, acao: "altera" }] },
      ],
    });
    assert.deepEqual(
      ordenarPorAtencao(r.com_alteracao).map((i) => i.placa_norm),
      ["B", "A", "C"],
    );
  });

  it("não muta o array de entrada", () => {
    const original = rel().com_alteracao;
    const antes = original.map((i) => i.placa_norm);
    ordenarPorAtencao(original);
    assert.deepEqual(original.map((i) => i.placa_norm), antes);
  });

  it("temValorTrocado é verdadeiro em item misto (preenche + altera)", () => {
    const rbm = rel().com_alteracao.find((i) => i.placa_norm === "RBM3C09")!;
    const aaa = rel().com_alteracao.find((i) => i.placa_norm === "AAA0A00")!;
    assert.equal(temValorTrocado(rbm), true);
    assert.equal(temValorTrocado(aaa), false);
  });
});

describe("baldesFecham — invariante de soma, nunca número fixo (AC5)", () => {
  it("fecha na resposta real (0 + 54 + 2 + 0 = 56)", () => {
    assert.equal(baldesFecham(rel()), true);
  });

  it("acusa quando alguma linha some entre os grupos", () => {
    const r = lerRelatorioSync({
      resumo: { linhas_no_arquivo: 56, sem_alteracao: 0, com_alteracao: 53, nao_encontradas: 2, ignoradas: 0 },
    });
    assert.equal(baldesFecham(r), false);
  });
});

describe("pareceSessaoExpirada — RLS zerando a visibilidade (§9, caso 15)", () => {
  it("acusa quando TODAS as linhas caem em não encontradas", () => {
    const r = lerRelatorioSync({ resumo: { linhas_no_arquivo: 56, nao_encontradas: 56 } });
    assert.equal(pareceSessaoExpirada(r), true);
  });

  it("não acusa no caso real (2 de 56)", () => {
    assert.equal(pareceSessaoExpirada(rel()), false);
  });

  it("não acusa em arquivo sem linhas", () => {
    const r = lerRelatorioSync({ resumo: { linhas_no_arquivo: 0, nao_encontradas: 0 } });
    assert.equal(pareceSessaoExpirada(r), false);
  });
});

describe("Rótulos pt-BR", () => {
  it("traduz os 8 campos da whitelist", () => {
    assert.equal(rotuloCampo("valor_maior_oferta"), "Maior oferta");
    assert.equal(rotuloCampo("qtde_anuncios"), "Qtde de anúncios");
    assert.equal(rotuloCampo("valor_compra_repasse"), "Valor de compra");
  });

  it("devolve o código cru quando o servidor manda um campo desconhecido", () => {
    assert.equal(rotuloCampo("coluna_nova_qualquer"), "coluna_nova_qualquer");
  });

  it("traduz os motivos dos dois enums fechados", () => {
    assert.match(rotuloMotivoNaoEncontrada("sem_repasse"), /importação por texto/);
    assert.match(rotuloMotivoNaoEncontrada("repasse_inativo"), /saiu do ciclo/);
    assert.match(rotuloMotivoIgnorada("valor_compra_zerado"), /custo-base/);
    assert.match(rotuloMotivoIgnorada("repasse_ambiguo"), /mais de um repasse ativo/i);
    assert.match(rotuloMotivoIgnorada("placa_duplicada_no_arquivo"), /repetida/);
  });
});

describe("formatarValorCampo — dinheiro vs contagem", () => {
  it("formata dinheiro com centavos", () => {
    assert.equal(formatarValorCampo("valor_minimo", 142500).replace(/ /g, " "), "R$ 142.500,00");
  });

  it("formata contagem como inteiro, sem R$", () => {
    assert.equal(formatarValorCampo("qtde_anuncios", 7), "7");
  });

  it("`antes: null` vira 'vazio', nunca R$ 0,00", () => {
    assert.equal(formatarValorCampo("valor_maior_oferta", null), "vazio");
    assert.equal(formatarValorCampo("qtde_anuncios", null), "vazio");
  });

  it("zero em contagem é valor real, não ausência", () => {
    assert.equal(formatarValorCampo("qtde_anuncios", 0), "0");
  });
});
