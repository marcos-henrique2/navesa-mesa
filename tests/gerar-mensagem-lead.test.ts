/**
 * Testes do gerador puro da mensagem de WhatsApp pro lead.
 *
 * Verifica: contém nome/modelo/ano/km; NÃO cita valor/preço/R$; km null omite
 * o trecho "(X km)".
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { gerarMensagemLead } from "@/lib/repasses/gerar-mensagem-lead";
import type { RepasseInteressado } from "@/lib/repasses/interessados";
import { repasse } from "./_mocks";

function interessado(over: Partial<RepasseInteressado> = {}): RepasseInteressado {
  return {
    id: 1,
    repasse_id: 1,
    nome: "spacecar veiculos",
    cidade_uf: "Uberlândia / MG",
    telefone_whatsapp: "5534992190088",
    telefones_raw: "(34) 992190088",
    email: "marluslener@hotmail.com",
    qtd_visualizacoes: 2,
    data_acesso: "21/06/2026 15:24:20",
    status_followup: "novo",
    observacao: null,
    data_contato: null,
    criado_em: "2026-06-21T00:00:00.000Z",
    atualizado_em: "2026-06-21T00:00:00.000Z",
    ...over,
  };
}

describe("gerarMensagemLead", () => {
  it("contém primeiro nome, modelo, ano e km", () => {
    const r = repasse({ modelo: "ONIX LT", ano_modelo: 2021, ano_fabricacao: 2020, km: 134694 });
    const msg = gerarMensagemLead(r, interessado());
    assert.match(msg, /spacecar/); // primeiro token do nome
    assert.ok(!/veiculos/.test(msg), "não deve incluir o segundo token do nome");
    assert.match(msg, /ONIX LT/);
    assert.match(msg, /2021/); // ano_modelo tem prioridade
    assert.match(msg, /134\.694 km/); // formatInt pt-BR
  });

  it("NÃO cita valor/preço/R$", () => {
    const r = repasse({ modelo: "ONIX LT", km: 50000, preco_atual: 110000, valor_subir: 95000 });
    const msg = gerarMensagemLead(r, interessado());
    assert.ok(!/R\$/.test(msg), "não pode ter R$");
    assert.ok(!/pre[çc]o/i.test(msg), "não pode citar preço");
    assert.ok(!/valor/i.test(msg), "não pode citar valor");
    assert.ok(!/110\.?000/.test(msg), "não pode vazar o preço atual");
    assert.ok(!/95\.?000/.test(msg), "não pode vazar o valor pra subir");
  });

  it("km null omite o trecho (km)", () => {
    const r = repasse({ modelo: "ONIX LT", ano_modelo: 2021, km: null });
    const msg = gerarMensagemLead(r, interessado());
    assert.ok(!/km/.test(msg), "sem km não pode ter 'km' no texto");
    assert.ok(!/\(\)/.test(msg), "não pode sobrar parênteses vazios");
    assert.match(msg, /ONIX LT 2021/);
  });

  it("ano null omite o ano mas mantém o modelo", () => {
    const r = repasse({ modelo: "ONIX LT", ano_modelo: null, ano_fabricacao: null, km: 50000 });
    const msg = gerarMensagemLead(r, interessado());
    assert.match(msg, /ONIX LT \(50\.000 km\)/);
  });

  it("usa ano_fabricacao quando ano_modelo é null", () => {
    const r = repasse({ modelo: "ONIX LT", ano_modelo: null, ano_fabricacao: 2019, km: 50000 });
    const msg = gerarMensagemLead(r, interessado());
    assert.match(msg, /ONIX LT 2019/);
  });
});
