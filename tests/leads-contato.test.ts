/**
 * Registro de contato do lead (`@/lib/leads/contato`).
 *
 * O que importa aqui e por quê:
 *   - ISOLAMENTO: há um lojista com interesse em 8 carros. Contatar sobre 1 não
 *     pode encostar nos outros 7. Duas provas complementares:
 *       a) no patch em memória, as outras linhas voltam pela MESMA referência —
 *          conclusão mais forte que "os valores continuam iguais", porque também
 *          descarta cópia desnecessária e prova que nada foi reconstruído; note que
 *          ela NÃO substitui a comparação de valores (mutação in-place preservaria a
 *          referência), então os testes de valor abaixo continuam necessários;
 *       b) no banco, quem isola é o `WHERE repasse_id` da RPC — garantido pelo
 *          `p_repasse_id` que `paramsMarcarContatado` sempre envia.
 *   - RETRY/ROLLBACK: a RPC pode falhar. Uma retentativa automática; persistindo,
 *     o erro precisa chegar em quem chamou pra a UI reverter o patch otimista.
 *   - RETORNO DA RPC: JSONB do Postgres chega com números como string e pode vir
 *     embrulhado em array. Nada disso pode virar NaN/undefined na tela.
 *   - DESFAZER COMPLETO: a RPC promove `leads.status_relacionamento` de 'novo' pra
 *     'contatado'. Desfazer só o interesse deixava o lead contatado SEM contato
 *     registrado — inconsistente e invisível. O desfazer precisa reverter os dois,
 *     e só quando a promoção foi dele (`status_promovido`) E nenhum outro carro do
 *     mesmo lead foi contatado na janela dos 8s (`podeRebaixarLead`).
 *   - ESCOPO INESPERADO: a RPC tem um fallback que alarga o UPDATE pra todos os
 *     interesses pendentes do lead. Quando ele dispara, o "Desfazer" reverteria 1 de
 *     N — a tela precisa saber (`escopoInesperado`) pra avisar e não oferecê-lo.
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
  mensagemEscopoInesperado,
  paramsMarcarContatado,
  podeRebaixarLead,
  reverterContatoOtimista,
  reverterPromocaoLead,
  usaRpcIsolada,
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
      escopoInesperado: false,
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

describe("escopo inesperado — o fallback da RPC atingindo mais (ou menos) que 1 carro", () => {
  // A RPC marca o interesse do carro pedido (WHERE lead_id AND repasse_id). Se ele
  // sumiu entre o carregamento da tela e o clique, ROW_COUNT = 0 e ela cai num
  // fallback que marca TODOS os interesses do lead sem data_contato — os outros 7
  // carros do lojista junto. O "Desfazer" é escopado num interesse só: ofertá-lo aqui
  // reverteria 1 de N e deixaria o resto marcado, em silêncio.
  const comEscopo = (interesses_marcados: number) =>
    interpretarRetornoContato({ interesses_marcados, status_promovido: true }, 7, HOJE, true);

  it("1 interesse marcado é o caminho normal — nada de anomalia", () => {
    assert.equal(comEscopo(1).escopoInesperado, false);
  });

  it("O CASO: fallback pegou 5 carros do mesmo lojista", () => {
    assert.equal(comEscopo(5).escopoInesperado, true);
  });

  it("0 marcados também é anomalia (o carro sumiu e não sobrou pendente nenhum)", () => {
    assert.equal(comEscopo(0).escopoInesperado, true);
  });

  it("sem escopo isolado (estoque/sondagem) o contador não é anomalia nenhuma", () => {
    // Sem `p_repasse_id` a RPC marca todos os pendentes DE PROPÓSITO.
    for (const n of [0, 1, 5]) {
      const r = interpretarRetornoContato({ interesses_marcados: n }, 7, HOJE);
      assert.equal(r.escopoInesperado, false, `${n} marcados não deveria acusar anomalia`);
    }
  });

  it("bigint como string do Postgres também é avaliado", () => {
    const r = interpretarRetornoContato({ interesses_marcados: "3" }, 7, HOJE, true);
    assert.equal(r.escopoInesperado, true);
  });

  it("retorno lixo (0 por degradação) acusa anomalia — silêncio seria pior", () => {
    assert.equal(interpretarRetornoContato(null, 7, HOJE, true).escopoInesperado, true);
  });

  it("o aviso diz o que houve e por que o Desfazer sumiu", () => {
    const zero = mensagemEscopoInesperado(0);
    assert.match(zero, /nenhum interesse foi marcado/);
    assert.match(zero, /Desfazer/);
    assert.match(zero, /Recarregue/);

    const muitos = mensagemEscopoInesperado(5);
    assert.match(muitos, /5 interesses/);
    assert.match(muitos, /Desfazer/);
  });
});

describe("podeRebaixarLead — a corrida dos dois carros do mesmo lojista", () => {
  it("O CASO: outro carro contatado na janela dos 8s trava o rebaixamento", () => {
    // 1. contata carro A → RPC promove o lead, status_promovido = true
    // 2. contata carro B em seguida → contato válido, registrado, lead já 'contatado'
    // 3. clica em Desfazer no toast do A
    // Rebaixar aqui deixaria o lead 'novo' COM o contato do B valendo.
    assert.equal(podeRebaixarLead(true, true), false);
  });

  it("sem outro contato na janela, a promoção é nossa e o rebaixamento vale", () => {
    assert.equal(podeRebaixarLead(true, false), true);
  });

  it("promoção que não foi nossa nunca rebaixa, com ou sem outro contato", () => {
    assert.equal(podeRebaixarLead(false, false), false);
    assert.equal(podeRebaixarLead(false, true), false);
  });

  it("as duas guardas são independentes — nenhuma sozinha autoriza", () => {
    const combinacoes: Array<[boolean, boolean, boolean]> = [
      [true, false, true],
      [true, true, false],
      [false, false, false],
      [false, true, false],
    ];
    for (const [promovido, outro, esperado] of combinacoes) {
      assert.equal(
        podeRebaixarLead(promovido, outro),
        esperado,
        `promovido=${promovido} outroContato=${outro}`,
      );
    }
  });
});

describe("paramsMarcarContatado — o isolamento que vive no WHERE da RPC", () => {
  it("sempre envia p_repasse_id — é ele que vira WHERE repasse_id", () => {
    // Sem esse parâmetro a RPC cai no ramo que marca TODOS os interesses pendentes
    // do lead: contatar sobre 1 carro encostaria nos outros 7 do lojista.
    const p = paramsMarcarContatado(7, 42);
    assert.equal(p.p_repasse_id, 42);
    assert.equal(p.p_lead_id, 7);
    assert.equal(p.p_tipo, "carro_visto");
  });

  it("o payload é exatamente a assinatura (BIGINT, TEXT, BIGINT) da migration 020/028", () => {
    assert.deepEqual(Object.keys(paramsMarcarContatado(7, 42)).sort(), [
      "p_lead_id",
      "p_repasse_id",
      "p_tipo",
    ]);
  });

  it("cada carro do lojista gera um payload distinto (nada compartilhado)", () => {
    const carros = [101, 102, 103].map((r) => paramsMarcarContatado(7, r));
    assert.deepEqual(
      carros.map((p) => p.p_repasse_id),
      [101, 102, 103],
    );
  });
});

describe("usaRpcIsolada — roteamento RPC × UPDATE direto (órfão da migration 033)", () => {
  it("repasse existente vai pra RPC isolada", () => {
    assert.ok(usaRpcIsolada(42));
  });

  it("O CASO: interesse órfão (repasse deletado, repasse_id NULL) NÃO vai pra RPC", () => {
    // Se fosse, a RPC não teria como escopar o UPDATE e cairia no fallback que
    // marca todos os interesses pendentes do lead — os outros 7 carros junto.
    assert.ok(!usaRpcIsolada(null));
  });

  it("estoque (também sem repasse_id) segue pelo mesmo UPDATE direto", () => {
    assert.ok(!usaRpcIsolada(null));
  });

  it("repasse_id = 0 é id válido — não pode ser confundido com ausência", () => {
    assert.ok(usaRpcIsolada(0));
  });
});
