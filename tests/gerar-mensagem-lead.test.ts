/**
 * Testes do gerador puro da mensagem de WhatsApp pro lead.
 *
 * Verifica: contém nome/modelo/ano/km; NÃO cita valor/preço/R$; km null omite
 * o trecho "(X km)".
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  gerarMensagemLead,
  gerarMensagemNegociacao,
  montarGanchoVenda,
  repasseParaCarro,
  veiculoParaCarro,
} from "@/lib/repasses/gerar-mensagem-lead";
import type { RepasseInteressado } from "@/lib/repasses/interessados";
import { repasse, veiculo } from "./_mocks";

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

describe("gerarMensagemLead — nova API (carro, lead, contexto)", () => {
  const carro = { modelo: "S10 LTZ", ano: 2016, km: 98000 };

  it("contexto 'visualizou' fala em reaquecer (anúncio no Auto Avaliar)", () => {
    const msg = gerarMensagemLead(carro, { nome: "João Silva" }, "visualizou");
    assert.match(msg, /João/);
    assert.ok(!/Silva/.test(msg), "só o primeiro nome");
    assert.match(msg, /S10 LTZ 2016/);
    assert.match(msg, /98\.000 km/);
    assert.match(msg, /Auto Avaliar/);
    assert.match(msg, /se interessou/);
  });

  it("contexto 'oferta' apresenta o carro como novidade", () => {
    const msg = gerarMensagemLead(carro, { nome: "Maria" }, "oferta");
    assert.match(msg, /Maria/);
    assert.match(msg, /S10 LTZ 2016/);
    assert.match(msg, /pode te interessar/);
    assert.ok(!/Auto Avaliar/.test(msg), "oferta não menciona Auto Avaliar");
  });

  it("nenhuma das duas variantes cita valor/preço/R$", () => {
    for (const ctx of ["visualizou", "oferta"] as const) {
      const msg = gerarMensagemLead(carro, { nome: "João" }, ctx);
      assert.ok(!/R\$/.test(msg), `${ctx}: sem R$`);
      assert.ok(!/pre[çc]o/i.test(msg), `${ctx}: sem preço`);
      assert.ok(!/valor/i.test(msg), `${ctx}: sem valor`);
    }
  });

  it("km null omite o trecho (km) em ambos os contextos", () => {
    const semKm = { modelo: "S10 LTZ", ano: 2016, km: null };
    for (const ctx of ["visualizou", "oferta"] as const) {
      const msg = gerarMensagemLead(semKm, { nome: "João" }, ctx);
      assert.ok(!/km/.test(msg), `${ctx}: sem km no texto`);
      assert.ok(!/\(\)/.test(msg), `${ctx}: sem parênteses vazios`);
      assert.match(msg, /S10 LTZ 2016/);
    }
  });

  it("ano null omite o ano mas mantém o modelo", () => {
    const msg = gerarMensagemLead({ modelo: "S10 LTZ", ano: null, km: 98000 }, { nome: "João" }, "oferta");
    assert.match(msg, /S10 LTZ \(98\.000 km\)/);
  });
});

describe("montarGanchoVenda (argumento de venda)", () => {
  it("compre-por presente vira a linha de preço anunciado", () => {
    const s = montarGanchoVenda({ comprePor: 95000, fipe: null });
    assert.match(s, /anunciada por/);
    assert.match(s, /R\$/);
    assert.match(s, /95\.000/);
    assert.ok(!/FIPE/.test(s), "sem FIPE não menciona a tabela");
  });

  it("gancho FIPE só aparece quando compre-por < fipe", () => {
    const comHook = montarGanchoVenda({ comprePor: 95000, fipe: 105000 });
    assert.match(comHook, /abaixo da tabela FIPE/);
    assert.match(comHook, /105\.000/);

    const semHook = montarGanchoVenda({ comprePor: 105000, fipe: 100000 });
    assert.ok(!/FIPE/.test(semHook), "compre-por acima da FIPE não gera gancho");
    assert.match(semHook, /105\.000/);
  });

  it("sem compre-por retorna string vazia (degrada, sem 'undefined')", () => {
    const s = montarGanchoVenda({ comprePor: null, fipe: 100000 });
    assert.equal(s, "");
    assert.ok(!/undefined|NaN/.test(s));
  });
});

describe("gerarMensagemNegociacao (compre-por + gancho FIPE)", () => {
  const carro = { modelo: "ONIX LT", ano: 2021, km: 50000 };

  it("inclui compre-por e o gancho FIPE quando abaixo da tabela", () => {
    const msg = gerarMensagemNegociacao(
      carro,
      { nome: "João Silva" },
      { comprePor: 95000, fipe: 105000 },
    );
    assert.match(msg, /João/);
    assert.ok(!/Silva/.test(msg), "só o primeiro nome");
    assert.match(msg, /ONIX LT 2021/);
    assert.match(msg, /Auto Avaliar/);
    assert.match(msg, /95\.000/); // compre-por
    assert.match(msg, /abaixo da tabela FIPE/);
    assert.match(msg, /105\.000/); // fipe
  });

  it("sem FIPE: cita o preço mas não menciona a tabela", () => {
    const msg = gerarMensagemNegociacao(carro, { nome: "Maria" }, { comprePor: 95000, fipe: null });
    assert.match(msg, /95\.000/);
    assert.ok(!/FIPE/.test(msg), "sem FIPE não cita a tabela");
  });

  it("sem dados de margem: degrada pra reaquecimento sem vazar 'undefined'", () => {
    const msg = gerarMensagemNegociacao(carro, { nome: "Ana" }, { comprePor: null, fipe: null });
    assert.match(msg, /ONIX LT 2021/);
    assert.match(msg, /Auto Avaliar/);
    assert.ok(!/undefined|NaN|R\$/.test(msg), "sem preço não vaza R$/undefined");
  });
});

describe("adaptadores carro", () => {
  it("repasseParaCarro prioriza ano_modelo", () => {
    const c = repasseParaCarro(repasse({ modelo: "ONIX", ano_modelo: 2021, ano_fabricacao: 2020, km: 100 }));
    assert.deepEqual(c, { modelo: "ONIX", ano: 2021, km: 100 });
  });

  it("repasseParaCarro cai pra ano_fabricacao quando ano_modelo null", () => {
    const c = repasseParaCarro(repasse({ modelo: "ONIX", ano_modelo: null, ano_fabricacao: 2019, km: null }));
    assert.deepEqual(c, { modelo: "ONIX", ano: 2019, km: null });
  });

  it("veiculoParaCarro extrai modelo/ano/km do estoque", () => {
    const c = veiculoParaCarro(veiculo({ modelo: "TORO", ano_modelo: 2022, ano_fabricacao: 2021, km: 30000 }));
    assert.deepEqual(c, { modelo: "TORO", ano: 2022, km: 30000 });
  });

  it("veiculoParaCarro com ambos os anos null → ano null", () => {
    const c = veiculoParaCarro(veiculo({ modelo: "TORO", ano_modelo: null, ano_fabricacao: null, km: 30000 }));
    assert.equal(c.ano, null);
  });
});
