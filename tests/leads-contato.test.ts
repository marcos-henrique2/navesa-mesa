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
 *
 * As funções que tocam o Supabase (`registrarContatoLead`, `desfazerContatoLead`)
 * ficam pra e2e — aqui testamos as partes puras e o combinador de retry.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  aplicarContatoOtimista,
  comRetryUnico,
  interpretarRetornoContato,
  reverterContatoOtimista,
  type InteresseContatavel,
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
