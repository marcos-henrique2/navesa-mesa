/**
 * Testes da função pura `gerarAnuncioRepasse`.
 *
 * Cobre a lógica condicional (IPVA, doc, observações), a omissão de cautelar,
 * a presença das seções fixas e a formatação de KM/ano.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { gerarAnuncioRepasse } from "@/lib/repasses/gerar-anuncio";
import { repasse } from "./_mocks";

describe("gerarAnuncioRepasse", () => {
  it("IPVA pago + doc ok → linhas corretas", () => {
    const txt = gerarAnuncioRepasse(repasse({ ipva_status: "pago", documentacao_status: "ok" }));
    assert.ok(txt.includes("- IPVA 2026: PAGO"));
    assert.ok(txt.includes("- Documentação: APROVADA, em ordem"));
  });

  it("IPVA em_aberto → 'A PAGAR PELO COMPRADOR'", () => {
    const txt = gerarAnuncioRepasse(repasse({ ipva_status: "em_aberto" }));
    assert.ok(txt.includes("- IPVA 2026: A PAGAR PELO COMPRADOR"));
  });

  it("IPVA nao_verificado → NÃO inclui linha de IPVA", () => {
    const txt = gerarAnuncioRepasse(repasse({ ipva_status: "nao_verificado" }));
    assert.ok(!txt.includes("IPVA 2026"));
  });

  it("IPVA null → NÃO inclui linha de IPVA", () => {
    const txt = gerarAnuncioRepasse(repasse({ ipva_status: null }));
    assert.ok(!txt.includes("IPVA 2026"));
  });

  it("doc pendente → 'Documentação: PENDENTE'", () => {
    const txt = gerarAnuncioRepasse(repasse({ documentacao_status: "pendente" }));
    assert.ok(txt.includes("- Documentação: PENDENTE"));
  });

  it("doc irregular → texto de alerta correto", () => {
    const txt = gerarAnuncioRepasse(repasse({ documentacao_status: "irregular" }));
    assert.ok(txt.includes("- Documentação: IRREGULAR — verifique antes do lance"));
  });

  it("doc null/nao_verificado → NÃO inclui linha de documentação", () => {
    const txtNull = gerarAnuncioRepasse(repasse({ documentacao_status: null }));
    assert.ok(!txtNull.includes("- Documentação:"));
    const txtNv = gerarAnuncioRepasse(repasse({ documentacao_status: "nao_verificado" }));
    assert.ok(!txtNv.includes("- Documentação:"));
  });

  it("cautelar com restrição → NÃO aparece no anúncio (ignorado)", () => {
    const txt = gerarAnuncioRepasse(repasse({ cautelar_status_manual: "com_restricao" }));
    assert.ok(!/cautelar/i.test(txt));
    assert.ok(!/restri/i.test(txt));
  });

  it("observacoes preenchido → inclui seção OBSERVAÇÕES com o conteúdo", () => {
    const txt = gerarAnuncioRepasse(repasse({ observacoes: "Pneus novos, único dono." }));
    assert.ok(txt.includes("OBSERVAÇÕES"));
    assert.ok(txt.includes("Pneus novos, único dono."));
  });

  it("observacoes vazio/null → NÃO inclui seção OBSERVAÇÕES", () => {
    assert.ok(!gerarAnuncioRepasse(repasse({ observacoes: null })).includes("OBSERVAÇÕES"));
    assert.ok(!gerarAnuncioRepasse(repasse({ observacoes: "   " })).includes("OBSERVAÇÕES"));
  });

  it("sempre inclui as seções fixas", () => {
    const txt = gerarAnuncioRepasse(repasse());
    assert.ok(txt.includes("CONDIÇÕES DA OPERAÇÃO"));
    assert.ok(txt.includes("SITUAÇÃO DOCUMENTAL"));
    assert.ok(txt.includes("LIBERAÇÃO DO VEÍCULO"));
    assert.ok(txt.includes("RETIRADA E CONTATO"));
    assert.ok(txt.includes("IMPORTANTE"));
    assert.ok(txt.includes(">> VENDA EXCLUSIVA PARA REVENDEDORES (B2B) - Grupo Navesa / Repasse"));
  });

  it("tempo de entrega da documentação sempre aparece (config fixa)", () => {
    const txt = gerarAnuncioRepasse(repasse());
    assert.ok(txt.includes("- Tempo de entrega da documentação: de 10 a 15 dias"));
  });

  it("NÃO inclui linha de estrutura jurídica da venda", () => {
    const txt = gerarAnuncioRepasse(repasse());
    assert.ok(!txt.includes("Estrutura da venda"));
    assert.ok(!/procura[çc][ãa]o/i.test(txt));
  });

  it("RETIRADA E CONTATO tem WhatsApp e E-mail reais, sem Telefone", () => {
    const txt = gerarAnuncioRepasse(repasse());
    assert.ok(!txt.includes("Telefone"));
    assert.ok(txt.includes("WhatsApp: (62) 98226-2543"));
    assert.ok(txt.includes("E-mail: marcos.jesus@navesa.com.br"));
  });

  it("inclui o prazo de retirada de 10 dias", () => {
    const txt = gerarAnuncioRepasse(repasse());
    assert.ok(txt.includes("Retirada em até 10 dias"));
  });

  it("formata KM com ponto de milhar (BR)", () => {
    const txt = gerarAnuncioRepasse(repasse({ km: 134694 }));
    assert.ok(txt.includes("134.694 km"));
  });

  it("formata ano fab/modelo no título", () => {
    const txt = gerarAnuncioRepasse(repasse({ ano_fabricacao: 2020, ano_modelo: 2021 }));
    assert.ok(txt.includes("2020/2021"));
  });

  it("ano com um dos campos null usa o que tiver", () => {
    const soFab = gerarAnuncioRepasse(repasse({ ano_fabricacao: 2019, ano_modelo: null }));
    assert.ok(soFab.includes("- 2019"));
    assert.ok(!soFab.includes("2019/"));
    const soModelo = gerarAnuncioRepasse(repasse({ ano_fabricacao: null, ano_modelo: 2022 }));
    assert.ok(soModelo.includes("- 2022"));
  });

  it("KM null → não exibe ' km'", () => {
    const txt = gerarAnuncioRepasse(repasse({ km: null, cor: "BRANCO" }));
    assert.ok(!txt.includes(" km"));
    assert.ok(txt.includes("BRANCO"));
  });

  it("título começa com o modelo", () => {
    const txt = gerarAnuncioRepasse(repasse({ modelo: "ONIX LT 1.0" }));
    assert.ok(txt.startsWith("ONIX LT 1.0 - "));
  });
});
