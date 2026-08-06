/**
 * Registro de contato do lead (`@/lib/leads/contato`).
 *
 * O que importa aqui e por quê:
 *   - ISOLAMENTO: há um lojista com interesse em 8 carros. Contatar sobre 1 não
 *     pode encostar nos outros 7. O teste prova isso pela IDENTIDADE dos objetos
 *     (as outras linhas voltam por referência), que é mais forte que comparar
 *     valores campo a campo.
 *   - RETRY/ROLLBACK: a RPC pode falhar. Uma retentativa automática; persistindo,
 *     o erro precisa chegar em quem chamou pra a UI reverter o patch otimista.
 *   - RETORNO DA RPC: JSONB do Postgres chega com números como string e pode vir
 *     embrulhado em array. Nada disso pode virar NaN/undefined na tela.
 *   - DESFAZER COMPLETO: a RPC promove `leads.status_relacionamento` de 'novo' pra
 *     'contatado'. Desfazer só o interesse deixava o lead contatado SEM contato
 *     registrado — inconsistente e invisível. O desfazer precisa reverter os dois,
 *     e só quando a promoção foi dele (`status_promovido`).
 *
 * As funções que tocam o Supabase (`registrarContatoLead`, `desfazerContatoLead`)
 * ficam pra e2e — aqui testamos as partes puras e o combinador de retry.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  aplicarContatoOtimista,
  aplicarPromocaoLead,
  comRetryUnico,
  interpretarRetornoContato,
  reverterContatoOtimista,
  reverterPromocaoLead,
  type InteresseContatavel,
  type LeadPromovivel,
} from "@/lib/leads/contato";

/** O lojista dos 8 carros: 1 já contatado, 1 negociando, o resto novo. */
function carteiraDoLojista(): InteresseContatavel[] {
  return [
    { id: 101, status_followup: "novo", data_contato: null },
    { id: 102, status_followup: "novo", data_contato: null },
    { id: 103, status_followup: "contatado", data_contato: "2026-07-20" },
    { id: 104, status_followup: "novo", data_contato: null },
    { id: 105, status_followup: "negociando", data_contato: "2026-07-28" },
    { id: 106, status_followup: "novo", data_contato: null },
    { id: 107, status_followup: "novo", data_contato: null },
    { id: 108, status_followup: "perdido", data_contato: "2026-06-02" },
  ];
}

const HOJE = "2026-08-06";

describe("aplicarContatoOtimista — isolamento entre carros do mesmo lojista", () => {
  it("marca só o carro contatado", () => {
    const antes = carteiraDoLojista();
    const depois = aplicarContatoOtimista(antes, 102, HOJE);
    const alvo = depois.find((i) => i.id === 102);
    assert.equal(alvo?.data_contato, HOJE);
    assert.equal(alvo?.status_followup, "contatado");
  });

  it("os outros 7 carros voltam pela MESMA referência (nada foi tocado)", () => {
    const antes = carteiraDoLojista();
    const depois = aplicarContatoOtimista(antes, 102, HOJE);
    assert.equal(depois.length, antes.length);
    for (let i = 0; i < antes.length; i++) {
      if (antes[i].id === 102) {
        assert.notEqual(depois[i], antes[i], "o alvo deveria ser um objeto novo");
      } else {
        assert.equal(depois[i], antes[i], `interesse ${antes[i].id} foi tocado indevidamente`);
      }
    }
  });

  it("não zera data_contato dos outros carros já contatados", () => {
    const depois = aplicarContatoOtimista(carteiraDoLojista(), 102, HOJE);
    assert.equal(depois.find((i) => i.id === 103)?.data_contato, "2026-07-20");
    assert.equal(depois.find((i) => i.id === 105)?.data_contato, "2026-07-28");
  });

  it("não rebaixa quem já avançou no funil (mesma regra da RPC)", () => {
    const depois = aplicarContatoOtimista(carteiraDoLojista(), 105, HOJE);
    const alvo = depois.find((i) => i.id === 105);
    assert.equal(alvo?.status_followup, "negociando", "negociando não pode virar contatado");
    assert.equal(alvo?.data_contato, HOJE, "mas a data do contato atualiza");
  });

  it("contato repetido no mesmo carro atualiza a data pra hoje", () => {
    const depois = aplicarContatoOtimista(carteiraDoLojista(), 103, HOJE);
    assert.equal(depois.find((i) => i.id === 103)?.data_contato, HOJE);
  });

  it("id inexistente não muda nada", () => {
    const antes = carteiraDoLojista();
    const depois = aplicarContatoOtimista(antes, 999, HOJE);
    for (let i = 0; i < antes.length; i++) assert.equal(depois[i], antes[i]);
  });

  it("não muta a lista de entrada", () => {
    const antes = carteiraDoLojista();
    aplicarContatoOtimista(antes, 102, HOJE);
    assert.equal(antes.find((i) => i.id === 102)?.data_contato, null);
    assert.equal(antes.find((i) => i.id === 102)?.status_followup, "novo");
  });
});

describe("reverterContatoOtimista — rollback e Desfazer", () => {
  it("devolve exatamente o estado anterior do carro", () => {
    const antes = carteiraDoLojista();
    const depois = aplicarContatoOtimista(antes, 102, HOJE);
    const revertido = reverterContatoOtimista(depois, 102, {
      status_followup: "novo",
      data_contato: null,
    });
    assert.deepEqual(
      revertido.find((i) => i.id === 102),
      { id: 102, status_followup: "novo", data_contato: null },
    );
  });

  it("aplicar e reverter é ida e volta (round-trip) pra todos os carros", () => {
    const antes = carteiraDoLojista();
    for (const alvo of antes) {
      const ida = aplicarContatoOtimista(antes, alvo.id, HOJE);
      const volta = reverterContatoOtimista(ida, alvo.id, {
        status_followup: alvo.status_followup,
        data_contato: alvo.data_contato,
      });
      assert.deepEqual(volta, antes, `round-trip falhou no interesse ${alvo.id}`);
    }
  });

  it("rollback também não encosta nos outros carros", () => {
    const base = aplicarContatoOtimista(carteiraDoLojista(), 102, HOJE);
    const revertido = reverterContatoOtimista(base, 102, {
      status_followup: "novo",
      data_contato: null,
    });
    for (let i = 0; i < base.length; i++) {
      if (base[i].id !== 102) assert.equal(revertido[i], base[i]);
    }
  });

  it("desfazer restaura a data anterior quando já havia contato", () => {
    const base = aplicarContatoOtimista(carteiraDoLojista(), 103, HOJE);
    const revertido = reverterContatoOtimista(base, 103, {
      status_followup: "contatado",
      data_contato: "2026-07-20",
    });
    assert.equal(revertido.find((i) => i.id === 103)?.data_contato, "2026-07-20");
  });
});

describe("promoção do lead — Desfazer completo", () => {
  /** Lead + um campo extra, pra provar que o resto do objeto sobrevive. */
  type LeadFake = LeadPromovivel & { id: number; nome: string };
  const lead = (status: LeadPromovivel["status_relacionamento"]): LeadFake => ({
    id: 7,
    nome: "Auto Center Bagé",
    status_relacionamento: status,
  });

  it("aplica a promoção que a RPC informou ter feito", () => {
    assert.equal(aplicarPromocaoLead(lead("novo"), true)?.status_relacionamento, "contatado");
  });

  it("statusPromovido false devolve o MESMO objeto (banco não mexeu, tela não mexe)", () => {
    const antes = lead("novo");
    assert.equal(aplicarPromocaoLead(antes, false), antes);
    assert.equal(reverterPromocaoLead(antes, false), antes);
  });

  it("lead null não quebra nenhum dos dois", () => {
    assert.equal(aplicarPromocaoLead(null, true), null);
    assert.equal(reverterPromocaoLead(null, true), null);
  });

  it("O CASO: desfazer rebaixa 'contatado' de volta pra 'novo'", () => {
    const promovido = aplicarPromocaoLead(lead("novo"), true);
    const desfeito = reverterPromocaoLead(promovido, true);
    assert.equal(desfeito?.status_relacionamento, "novo");
  });

  it("round-trip promover → desfazer devolve o lead idêntico", () => {
    const antes = lead("novo");
    assert.deepEqual(reverterPromocaoLead(aplicarPromocaoLead(antes, true), true), antes);
  });

  it("não rebaixa quem avançou no funil durante os 8s do toast", () => {
    // Marcos clica em WhatsApp (RPC promove novo→contatado), o lojista responde na
    // hora, ele move pra 'negociando' e só então clica em Desfazer.
    for (const avancado of ["respondeu", "negociando", "fechou", "perdido"] as const) {
      const atual = lead(avancado);
      assert.equal(
        reverterPromocaoLead(atual, true),
        atual,
        `${avancado} não pode ser rebaixado pra novo`,
      );
    }
  });

  it("não rebaixa lead que já estava 'contatado' antes (promoção não foi nossa)", () => {
    // Nesse cenário a RPC devolve status_promovido = false — a guarda vem daí.
    const atual = lead("contatado");
    assert.equal(reverterPromocaoLead(atual, false), atual);
  });

  it("preserva os demais campos do lead", () => {
    const desfeito = reverterPromocaoLead(lead("contatado"), true);
    assert.equal(desfeito?.id, 7);
    assert.equal(desfeito?.nome, "Auto Center Bagé");
  });

  it("não muta o lead de entrada", () => {
    const antes = lead("novo");
    aplicarPromocaoLead(antes, true);
    assert.equal(antes.status_relacionamento, "novo");
  });

  it("statusPromovido vem do retorno da RPC — o encaixe das duas pontas", () => {
    // A UI lê status_promovido via interpretarRetornoContato e o repassa pro desfazer.
    const r = interpretarRetornoContato({ status_promovido: true }, 7, HOJE);
    assert.equal(reverterPromocaoLead(lead("contatado"), r.statusPromovido)?.status_relacionamento, "novo");

    const sem = interpretarRetornoContato({ status_promovido: false }, 7, HOJE);
    const atual = lead("contatado");
    assert.equal(reverterPromocaoLead(atual, sem.statusPromovido), atual);
  });
});

describe("comRetryUnico", () => {
  it("sucesso de primeira → chama uma vez só", async () => {
    let chamadas = 0;
    const r = await comRetryUnico(async () => {
      chamadas++;
      return "ok";
    });
    assert.equal(r, "ok");
    assert.equal(chamadas, 1);
  });

  it("falha na 1ª, sucesso na 2ª → resolve sem propagar o erro", async () => {
    let chamadas = 0;
    const r = await comRetryUnico(async () => {
      chamadas++;
      if (chamadas === 1) throw new Error("timeout da RPC");
      return "ok";
    });
    assert.equal(r, "ok");
    assert.equal(chamadas, 2);
  });

  it("falha nas duas → propaga o erro da SEGUNDA tentativa", async () => {
    let chamadas = 0;
    await assert.rejects(
      comRetryUnico(async () => {
        chamadas++;
        throw new Error(`falha ${chamadas}`);
      }),
      /falha 2/,
    );
    assert.equal(chamadas, 2, "não pode tentar mais de 2 vezes");
  });

  it("nunca tenta uma 3ª vez", async () => {
    let chamadas = 0;
    await assert.rejects(
      comRetryUnico(async () => {
        chamadas++;
        throw new Error("sempre falha");
      }),
    );
    assert.equal(chamadas, 2);
  });
});

describe("interpretarRetornoContato", () => {
  const RETORNO_OK = {
    lead_id: 7,
    tipo: "carro_visto",
    repasse_id: 42,
    interesses_marcados: 1,
    status_promovido: true,
    data_contato: "2026-08-06",
  };

  it("lê o JSONB da RPC", () => {
    assert.deepEqual(interpretarRetornoContato(RETORNO_OK, 7, HOJE), {
      leadId: 7,
      interessesMarcados: 1,
      statusPromovido: true,
      dataContato: "2026-08-06",
    });
  });

  it("aceita o retorno embrulhado em array (variação do PostgREST)", () => {
    assert.equal(interpretarRetornoContato([RETORNO_OK], 7, HOJE).interessesMarcados, 1);
  });

  it("número como string (bigint do Postgres) vira number", () => {
    const r = interpretarRetornoContato({ ...RETORNO_OK, interesses_marcados: "3" }, 7, HOJE);
    assert.equal(r.interessesMarcados, 3);
    assert.equal(typeof r.interessesMarcados, "number");
  });

  it("status_promovido só é true quando é o booleano true", () => {
    assert.equal(interpretarRetornoContato({ status_promovido: "true" }, 7, HOJE).statusPromovido, false);
    assert.equal(interpretarRetornoContato({ status_promovido: false }, 7, HOJE).statusPromovido, false);
    assert.equal(interpretarRetornoContato({ status_promovido: true }, 7, HOJE).statusPromovido, true);
  });

  it("sem data no retorno cai na data local que a UI já mostrou", () => {
    assert.equal(interpretarRetornoContato({}, 7, HOJE).dataContato, HOJE);
    assert.equal(interpretarRetornoContato(null, 7, HOJE).dataContato, HOJE);
  });

  it("timestamp completo é cortado pra YYYY-MM-DD", () => {
    const r = interpretarRetornoContato({ data_contato: "2026-08-06T00:00:00" }, 7, HOJE);
    assert.equal(r.dataContato, "2026-08-06");
  });

  it("retorno lixo degrada pra valores neutros, nunca NaN", () => {
    const r = interpretarRetornoContato("???", 7, HOJE);
    assert.equal(r.interessesMarcados, 0);
    assert.equal(r.statusPromovido, false);
    assert.equal(r.dataContato, HOJE);
    assert.equal(Number.isNaN(r.interessesMarcados), false);
  });
});
