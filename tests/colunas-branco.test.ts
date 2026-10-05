/**
 * Testes da lógica pura do bloco "Colunas em branco personalizadas" do modal
 * de Relatório de Estoque Customizado (ConfigurarRelatorioEstoqueModal).
 *
 * Cobre: adicionar/inserir/remover/renomear, nome vazio (não exporta, não
 * bloqueia digitação), nome duplicado (aviso, não bloqueia export), limite de
 * 15, foco após remover, e a migração one-shot da preferência antiga
 * (2 checkboxes fixos "Observações"/"Anotações").
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  adicionarColunaBranco,
  colunasBrancoParaExportar,
  focoAposRemover,
  inserirColunaBrancoApos,
  LIMITE_COLUNAS_BRANCO,
  mensagemColunaBrancoAdicionada,
  mensagemColunaBrancoRemovida,
  migrarColunasBrancoLegado,
  nenhumaColunaBrancoComNome,
  nomeDuplicado,
  nomeVazio,
  podeAdicionarColunaBranco,
  removerColunaBranco,
  renomearColunaBranco,
  textoAuxiliarColunaBranco,
  type ColunaBranco,
} from "@/lib/export/colunas-branco";

function idGen(): () => string {
  let n = 0;
  return () => `id-${++n}`;
}

describe("adicionarColunaBranco", () => {
  it("acrescenta uma linha vazia no fim", () => {
    const lista: ColunaBranco[] = [{ id: "a", nome: "Observações" }];
    const next = adicionarColunaBranco(lista, "b");
    assert.deepEqual(next, [
      { id: "a", nome: "Observações" },
      { id: "b", nome: "" },
    ]);
  });

  it("no limite (15), é no-op (devolve lista equivalente, sem adicionar)", () => {
    const lista: ColunaBranco[] = Array.from({ length: LIMITE_COLUNAS_BRANCO }, (_, i) => ({
      id: `c${i}`,
      nome: `Col ${i}`,
    }));
    const next = adicionarColunaBranco(lista, "novo");
    assert.equal(next.length, LIMITE_COLUNAS_BRANCO);
    assert.deepEqual(next, lista);
  });
});

describe("podeAdicionarColunaBranco", () => {
  it("true abaixo do limite, false no limite", () => {
    assert.equal(podeAdicionarColunaBranco([]), true);
    const cheia: ColunaBranco[] = Array.from({ length: LIMITE_COLUNAS_BRANCO }, (_, i) => ({
      id: `c${i}`,
      nome: "",
    }));
    assert.equal(podeAdicionarColunaBranco(cheia), false);
  });
});

describe("inserirColunaBrancoApos", () => {
  it("insere IMEDIATAMENTE depois do id informado (não no fim)", () => {
    const lista: ColunaBranco[] = [
      { id: "a", nome: "Observações" },
      { id: "b", nome: "Anotações" },
    ];
    const next = inserirColunaBrancoApos(lista, "a", "novo");
    assert.deepEqual(next.map((c) => c.id), ["a", "novo", "b"]);
  });

  it("id inexistente: cai pro comportamento de adicionar no fim", () => {
    const lista: ColunaBranco[] = [{ id: "a", nome: "X" }];
    const next = inserirColunaBrancoApos(lista, "nao-existe", "novo");
    assert.deepEqual(next.map((c) => c.id), ["a", "novo"]);
  });

  it("no limite, é no-op", () => {
    const lista: ColunaBranco[] = Array.from({ length: LIMITE_COLUNAS_BRANCO }, (_, i) => ({
      id: `c${i}`,
      nome: "",
    }));
    const next = inserirColunaBrancoApos(lista, "c0", "novo");
    assert.equal(next.length, LIMITE_COLUNAS_BRANCO);
  });
});

describe("removerColunaBranco / focoAposRemover", () => {
  const lista: ColunaBranco[] = [
    { id: "a", nome: "Primeira" },
    { id: "b", nome: "Segunda" },
    { id: "c", nome: "Terceira" },
  ];

  it("remove a linha pelo id", () => {
    const next = removerColunaBranco(lista, "b");
    assert.deepEqual(next.map((c) => c.id), ["a", "c"]);
  });

  it("foco vai pra linha ANTERIOR quando não é a primeira", () => {
    assert.equal(focoAposRemover(lista, "b"), "a");
    assert.equal(focoAposRemover(lista, "c"), "b");
  });

  it("foco é null (botão '+ Adicionar') quando é a primeira linha", () => {
    assert.equal(focoAposRemover(lista, "a"), null);
  });

  it("foco é null quando é a única linha da lista", () => {
    const unica: ColunaBranco[] = [{ id: "x", nome: "Única" }];
    assert.equal(focoAposRemover(unica, "x"), null);
  });
});

describe("renomearColunaBranco", () => {
  it("atualiza só o nome da linha com o id informado", () => {
    const lista: ColunaBranco[] = [
      { id: "a", nome: "" },
      { id: "b", nome: "" },
    ];
    const next = renomearColunaBranco(lista, "b", "Conferido por");
    assert.deepEqual(next, [
      { id: "a", nome: "" },
      { id: "b", nome: "Conferido por" },
    ]);
  });
});

describe("nomeVazio / nomeDuplicado / textoAuxiliarColunaBranco", () => {
  it("nome vazio (ou só espaços) é tratado como vazio", () => {
    assert.equal(nomeVazio({ id: "a", nome: "" }), true);
    assert.equal(nomeVazio({ id: "a", nome: "   " }), true);
    assert.equal(nomeVazio({ id: "a", nome: "Observações" }), false);
  });

  it("texto auxiliar de nome vazio", () => {
    const col: ColunaBranco = { id: "a", nome: "   " };
    assert.equal(textoAuxiliarColunaBranco([col], col), "Sem nome — essa coluna não será exportada.");
  });

  it("nomeDuplicado: false na 1ª ocorrência, true na 2ª+ (trim + case-insensitive)", () => {
    const lista: ColunaBranco[] = [
      { id: "a", nome: "Observações" },
      { id: "b", nome: "  observações  " },
      { id: "c", nome: "OBSERVAÇÕES" },
    ];
    assert.equal(nomeDuplicado(lista, lista[0]), false);
    assert.equal(nomeDuplicado(lista, lista[1]), true);
    assert.equal(nomeDuplicado(lista, lista[2]), true);
  });

  it("nomeDuplicado nunca marca linha vazia como duplicada", () => {
    const lista: ColunaBranco[] = [
      { id: "a", nome: "" },
      { id: "b", nome: "" },
    ];
    assert.equal(nomeDuplicado(lista, lista[1]), false);
  });

  it("texto auxiliar de duplicado só na 2ª+ ocorrência; nome vazio tem prioridade sobre duplicado", () => {
    const lista: ColunaBranco[] = [
      { id: "a", nome: "Observações" },
      { id: "b", nome: "Observações" },
    ];
    assert.equal(textoAuxiliarColunaBranco(lista, lista[0]), null);
    assert.equal(textoAuxiliarColunaBranco(lista, lista[1]), "Já existe uma coluna com esse nome.");
  });
});

describe("colunasBrancoParaExportar / nenhumaColunaBrancoComNome", () => {
  it("exporta só nomes não-vazios (trim), na ordem de adição — nomes duplicados exportam os dois (v1 simples)", () => {
    const lista: ColunaBranco[] = [
      { id: "a", nome: "Observações" },
      { id: "b", nome: "   " },
      { id: "c", nome: "Observações" },
      { id: "d", nome: "Anotações" },
    ];
    assert.deepEqual(colunasBrancoParaExportar(lista), ["Observações", "Observações", "Anotações"]);
  });

  it("lista vazia ou só com nomes vazios: nenhumaColunaBrancoComNome é true", () => {
    assert.equal(nenhumaColunaBrancoComNome([]), true);
    assert.equal(nenhumaColunaBrancoComNome([{ id: "a", nome: "   " }]), true);
  });

  it("com pelo menos um nome não-vazio: nenhumaColunaBrancoComNome é false", () => {
    assert.equal(nenhumaColunaBrancoComNome([{ id: "a", nome: "Observações" }]), false);
  });
});

describe("mensagens de aria-live", () => {
  it("adicionada / removida citam o total e o limite", () => {
    assert.equal(mensagemColunaBrancoAdicionada(3), "Coluna em branco adicionada (3 de 15).");
    assert.equal(mensagemColunaBrancoRemovida(2), "Coluna em branco removida (2 de 15).");
  });
});

describe("migrarColunasBrancoLegado", () => {
  it("ambos os checkboxes antigos marcados: migra as 2 linhas, na ordem Observações → Anotações", () => {
    const gerar = idGen();
    const migradas = migrarColunasBrancoLegado(true, true, gerar);
    assert.deepEqual(migradas, [
      { id: "id-1", nome: "Observações" },
      { id: "id-2", nome: "Anotações" },
    ]);
  });

  it("só Observações marcado: migra 1 linha", () => {
    const migradas = migrarColunasBrancoLegado(true, false, idGen());
    assert.deepEqual(migradas, [{ id: "id-1", nome: "Observações" }]);
  });

  it("só Anotações marcado: migra 1 linha", () => {
    const migradas = migrarColunasBrancoLegado(false, true, idGen());
    assert.deepEqual(migradas, [{ id: "id-1", nome: "Anotações" }]);
  });

  it("nenhum marcado (usuário novo ou nunca abriu o modal antes): lista vazia", () => {
    assert.deepEqual(migrarColunasBrancoLegado(false, false, idGen()), []);
  });
});
