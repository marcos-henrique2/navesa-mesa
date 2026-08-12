/**
 * Testes do motor de sugestão de preço de repasse e da montagem do snapshot
 * (Story 3.1a — AC31). Tudo sobre FUNÇÕES PURAS, sem banco.
 *
 * O que estes testes protegem, além do óbvio:
 *   - `REGUA_COMPRE_POR_PCT` é DERIVADO. Hard-codar 1.120 quebra aqui, porque a
 *     derivação dá 1,1197478…
 *   - A REFERÊNCIA (Ref. AA / FIPE) não entra no preço. Se algum dia entrar, o
 *     gatilho G1-b da ADR-002 dispara e a migration 031 vira bloqueante
 *     retroativamente — o teste dos três níveis de confiança é o sensor disso.
 *   - A invariante `compre_por ≥ mínimo ≥ custo_real` vale sobre o par
 *     SUGERIDO, nunca sobre o par APLICADO (ADR-003 §11).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  REGUA_COMPRE_POR_PCT,
  REGUA_PADRAO,
  VERSAO_REGUA,
  arredondarParaCentena,
  decomporCusto,
  reguaComprePorPct,
  serializarParametrosRegua,
  sugerirPrecoRepasse,
  type EntradaSugestaoRepasse,
  type SugestaoPrecoRepasse,
} from "@/lib/pricing/sugerir-preco-repasse";
import { montarSnapshotPrecificacao } from "@/lib/pricing/snapshot-precificacao";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/**
 * Carro "limpo": sem km/ano/dias/anúncios, pra isolar a régua dos ajustes.
 * custo_real = 100.000,00.
 */
function entrada(over: Partial<EntradaSugestaoRepasse> = {}): EntradaSugestaoRepasse {
  return {
    valorCompraRepasse: 100_000,
    gastos: [],
    valorAutoAvaliar: null,
    valorFipe: null,
    km: null,
    anoModelo: null,
    anoReferencia: 2026,
    diasNoRepasse: null,
    qtdeAnuncios: null,
    ...over,
  };
}

/** Estreita o union e falha o teste com mensagem útil se o motor não sugeriu. */
function exigirSugestao(r: ReturnType<typeof sugerirPrecoRepasse>): SugestaoPrecoRepasse {
  assert.equal(r.ok, true, `esperava sugestão, veio: ${r.ok ? "" : r.motivo}`);
  return r as SugestaoPrecoRepasse;
}

// ═════════════════════════════════════════════════════════════════════════════
// A RÉGUA — mediana no mínimo, compre-por DERIVADO da razão
// ═════════════════════════════════════════════════════════════════════════════

describe("régua: mínimo pela mediana, compre-por derivado da razão", () => {
  it("REGUA_COMPRE_POR_PCT é derivado, não hard-coded", () => {
    assert.equal(
      REGUA_COMPRE_POR_PCT,
      REGUA_PADRAO.REGUA_MINIMO_PCT / REGUA_PADRAO.RAZAO_MINIMO_SOBRE_COMPRE_POR,
    );
    // A derivação dá 1,1197478… — quem escrever 1.120 à mão cai aqui.
    assert.notEqual(REGUA_COMPRE_POR_PCT, 1.12);
    assert.ok(Math.abs(REGUA_COMPRE_POR_PCT - 1.1197478991596638) < 1e-12);
  });

  it("a derivação segue o override de parâmetros (não é constante congelada)", () => {
    assert.equal(reguaComprePorPct({ ...REGUA_PADRAO, RAZAO_MINIMO_SOBRE_COMPRE_POR: 0.9 }), 1.066 / 0.9);
  });

  it("custo 100.000 → mínimo 106.600,00 e compre por 111.974,79", () => {
    const s = exigirSugestao(sugerirPrecoRepasse(entrada()));
    assert.equal(s.minimoSugerido, 106_600);
    assert.equal(s.comprePorSugerido, 111_974.79);
    // 1.120 daria 112.000,00 — se alguém hard-codar, este assert quebra.
    assert.notEqual(s.comprePorSugerido, 112_000);
  });

  it("razões efetivas batem com os preços gravados (snapshot coerente)", () => {
    const s = exigirSugestao(sugerirPrecoRepasse(entrada()));
    assert.equal(s.minimoRazaoEfetiva, 1.066);
    assert.equal(s.comprePorRazaoEfetiva, 1.119748);
    assert.equal(s.bateuPiso, false);
  });

  it("arredondamento pra centena é SÓ apresentação — o gravado é centavo-perfect", () => {
    const s = exigirSugestao(sugerirPrecoRepasse(entrada()));
    assert.equal(s.comprePorExibicao, 112_000);
    assert.equal(s.comprePorSugerido, 111_974.79);
    assert.equal(arredondarParaCentena(106_649), 106_600);
    assert.equal(arredondarParaCentena(106_651), 106_700);
  });

  it("a banda p25–p75 é do MÍNIMO entre carros, não a faixa mínimo↔compre-por", () => {
    const s = exigirSugestao(sugerirPrecoRepasse(entrada()));
    assert.equal(s.bandaMinimo.p25, 104_200);
    assert.equal(s.bandaMinimo.p75, 110_700);
    // O p75 NÃO é o compre-por — se um dia virar, a ADR-003 §4 foi desfeita.
    assert.notEqual(s.bandaMinimo.p75, s.comprePorSugerido);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PISO DE CUSTO E INVARIANTE DE ORDENAÇÃO
// ═════════════════════════════════════════════════════════════════════════════

describe("piso de custo (AC12)", () => {
  it("régua abaixo de 100% trava no custo real e alerta", () => {
    const s = exigirSugestao(
      sugerirPrecoRepasse(entrada(), { ...REGUA_PADRAO, REGUA_MINIMO_PCT: 0.9 }),
    );
    assert.equal(s.bateuPiso, true);
    assert.equal(s.minimoSugerido, 100_000); // == custo_real
    assert.equal(s.minimoRazaoEfetiva, 1);
    assert.equal(s.comprePorSugerido, 105_042.02); // 1 / 0,952 sobre o custo
    assert.ok(s.alertas.some((a) => a.includes("piso de custo")));
  });

  it("ajustes que derrubariam abaixo do custo também travam", () => {
    const s = exigirSugestao(
      sugerirPrecoRepasse(entrada({ qtdeAnuncios: 3 }), {
        ...REGUA_PADRAO,
        REGUA_MINIMO_PCT: 1.01,
        AJUSTE_TOTAL_MAX: 0.5,
        AJUSTE_REANUNCIO_MAX: 0.5,
        REANUNCIO_PONTOS_POR_EXTRA: 0.05,
      }),
    );
    assert.equal(s.bateuPiso, true);
    assert.equal(s.minimoSugerido, 100_000);
  });
});

describe("invariante compre_por ≥ mínimo ≥ custo_real, DEPOIS do clamp (AC12)", () => {
  it("razão > 1 produziria par invertido — a guarda trava o compre-por no mínimo", () => {
    // Sem o seam de parâmetros da AC10 esta invariante não seria testável:
    // constante de módulo não é adulterável a partir do teste.
    const s = exigirSugestao(
      sugerirPrecoRepasse(entrada(), { ...REGUA_PADRAO, RAZAO_MINIMO_SOBRE_COMPRE_POR: 1.2 }),
    );
    assert.equal(s.minimoSugerido, 106_600);
    assert.equal(s.comprePorSugerido, 106_600);
    assert.ok(s.comprePorSugerido >= s.minimoSugerido);
    assert.ok(s.minimoSugerido >= s.custo.custoReal);
    assert.ok(s.alertas.some((a) => a.includes("Régua inconsistente")));
  });

  it("a invariante vale em toda combinação de piso × razão inválida", () => {
    for (const razao of [1.2, 2, 0.5, 0.952]) {
      for (const minimoPct of [0.5, 1, 1.066, 1.5]) {
        const s = exigirSugestao(
          sugerirPrecoRepasse(entrada(), {
            ...REGUA_PADRAO,
            RAZAO_MINIMO_SOBRE_COMPRE_POR: razao,
            REGUA_MINIMO_PCT: minimoPct,
          }),
        );
        assert.ok(
          s.comprePorSugerido >= s.minimoSugerido && s.minimoSugerido >= s.custo.custoReal,
          `invariante quebrada em razao=${razao} minimoPct=${minimoPct}`,
        );
      }
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// REFERÊNCIA: CONFIANÇA E ALERTA — NUNCA O PREÇO
// ═════════════════════════════════════════════════════════════════════════════

describe("fallback Ref. AA → FIPE → sem referência (AC13/14/15)", () => {
  const comAA = exigirSugestao(sugerirPrecoRepasse(entrada({ valorAutoAvaliar: 105_000 })));
  const comFipe = exigirSugestao(sugerirPrecoRepasse(entrada({ valorFipe: 130_000 })));
  const semNada = exigirSugestao(sugerirPrecoRepasse(entrada()));

  it("os três níveis de confiança são emitidos", () => {
    assert.equal(comAA.confianca, "alta");
    assert.equal(comAA.fonteReferencia, "auto_avaliar");
    assert.equal(comFipe.confianca, "baixa");
    assert.equal(comFipe.fonteReferencia, "fipe_ajustada");
    assert.equal(semNada.confianca, "muito_baixa");
    assert.equal(semNada.fonteReferencia, "nenhuma");
    assert.equal(semNada.referenciaTeto, null);
  });

  it("OS DOIS PREÇOS NÃO MUDAM entre os três casos — a referência não entra no preço", () => {
    // Invariante das AC13–AC15. Se este teste falhar, a Ref. AA passou a ter
    // efeito numérico: G1-b disparou e a migration 031 virou bloqueante.
    for (const s of [comAA, comFipe, semNada]) {
      assert.equal(s.minimoSugerido, 106_600);
      assert.equal(s.comprePorSugerido, 111_974.79);
      assert.equal(s.minimoRazaoEfetiva, 1.066);
    }
  });

  it("sem Ref. AA a FIPE vira referência do alerta, com aviso de que ignora km", () => {
    assert.ok(comFipe.alertas.some((a) => a.includes("IGNORA quilometragem")));
    assert.notEqual(comFipe.referenciaTeto, null);
  });

  it("sem Ref. AA e sem FIPE não há alerta de teto nenhum", () => {
    assert.ok(semNada.alertas.some((a) => a.includes("não há referência de mercado")));
    assert.ok(!semNada.alertas.some((a) => a.includes("passa de")));
  });

  it("FIPE ajustada por km desconta o excesso — e mesmo assim não toca no preço", () => {
    const rodado = exigirSugestao(
      sugerirPrecoRepasse(entrada({ valorFipe: 130_000, km: 249_000, anoModelo: 2018 })),
    );
    assert.ok(rodado.referenciaTeto != null && rodado.referenciaTeto < 130_000);
    assert.equal(rodado.minimoSugerido, 106_600);
  });
});

describe("teto da referência (AC13) — alerta sobre o MÍNIMO, jamais trava", () => {
  it("mínimo acima de 105% da Ref. AA gera alerta e NÃO muda o número", () => {
    const s = exigirSugestao(sugerirPrecoRepasse(entrada({ valorAutoAvaliar: 100_000 })));
    // 106.600 > 100.000 × 1,05 = 105.000
    const tetoAlerta = s.alertas.filter((a) => a.includes("passa de"));
    assert.equal(tetoAlerta.length, 1);
    assert.ok(tetoAlerta[0].startsWith("Mínimo sugerido"));
    assert.equal(s.minimoSugerido, 106_600);
    assert.equal(s.comprePorSugerido, 111_974.79);
  });

  it("o teto NUNCA se aplica ao compre-por, mesmo ele estando bem acima da referência", () => {
    // Ref. AA 108.000 ⇒ teto 113.400. O mínimo (106.600) cabe; o compre-por
    // (111.974,79) fica acima da referência crua — e isso é o desenho, não um
    // caso a alertar: o compre-por é prêmio por encerrar o anúncio na hora.
    const s = exigirSugestao(sugerirPrecoRepasse(entrada({ valorAutoAvaliar: 108_000 })));
    assert.ok(s.comprePorSugerido > 108_000);
    assert.equal(s.alertas.filter((a) => a.includes("passa de")).length, 0);
  });

  it("não existe alerta de piso ('muito abaixo da referência') — o caso Amarok", () => {
    // Amarok: fechou a 76% da Ref. AA e a régua sobre custo o teria precificado
    // bem. Ficar bem abaixo da referência estava CERTO.
    const s = exigirSugestao(sugerirPrecoRepasse(entrada({ valorAutoAvaliar: 200_000 })));
    assert.deepEqual(s.alertas, []);
    assert.equal(s.minimoSugerido, 106_600);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CUSTO REAL — a regra de ouro
// ═════════════════════════════════════════════════════════════════════════════

describe("custo_real decomposto (AC5–AC8)", () => {
  it("sem gastos → custo == compra, e a qtde de gastos é 0", () => {
    const c = decomporCusto(100_000, []);
    assert.deepEqual(c, {
      valorCompraRepasse: 100_000,
      gastosTotal: 0,
      gastosQtde: 0,
      custoReal: 100_000,
    });
  });

  it("com gastos → decomposição centavo-perfect (contrato da migration 030 §2.4)", () => {
    const c = decomporCusto(100_000, [1_500, 2_500.55]);
    assert.ok(c != null);
    assert.equal(c.gastosTotal, 4_000.55);
    assert.equal(c.gastosQtde, 2);
    assert.equal(c.custoReal, 104_000.55);
    // `rep_prec_custo_decomposto_chk` — sem tolerância nenhuma.
    assert.equal(c.custoReal, c.valorCompraRepasse + c.gastosTotal);
  });

  it("gastos nulos/inválidos são ignorados e não contam na qtde", () => {
    const c = decomporCusto(50_000, [null, undefined, NaN, 250]);
    assert.ok(c != null);
    assert.equal(c.gastosTotal, 250);
    assert.equal(c.gastosQtde, 1);
    assert.equal(c.custoReal, 50_250);
  });

  it("valor_compra_repasse nulo → NENHUMA sugestão (nunca valor_aquisicao)", () => {
    assert.equal(decomporCusto(null, [5_000]), null);
    const r = sugerirPrecoRepasse(entrada({ valorCompraRepasse: null, gastos: [5_000] }));
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.motivo.includes("R$ Compra"));
    assert.ok(!r.ok && r.custo === null);
  });

  it("custo_real == 0 → nenhuma sugestão (a régua devolveria R$ 0,00)", () => {
    const r = sugerirPrecoRepasse(entrada({ valorCompraRepasse: 0, gastos: [] }));
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.motivo.includes("zero"));
    assert.equal(!r.ok && r.custo?.custoReal, 0);
  });

  it("valor_compra_repasse negativo → nenhuma sugestão", () => {
    assert.equal(decomporCusto(-1, []), null);
  });

  it("os gastos entram no preço porque entram no custo (caso Frontier)", () => {
    const s = exigirSugestao(sugerirPrecoRepasse(entrada({ gastos: [2_000] })));
    assert.equal(s.custo.custoReal, 102_000);
    assert.equal(s.minimoSugerido, 108_732); // 102.000 × 1,066
    assert.ok(s.justificativa.includes("1 gasto"));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// AJUSTES (AC16) — limitados por teto explícito e sempre justificados
// ═════════════════════════════════════════════════════════════════════════════

describe("ajustes por dias parados / reanúncio (AC16)", () => {
  const s = exigirSugestao(
    sugerirPrecoRepasse(
      entrada({ km: 200_000, anoModelo: 2018, diasNoRepasse: 90, qtdeAnuncios: 3 }),
    ),
  );

  it("cada ajuste aplicado vira uma linha na justificativa", () => {
    assert.deepEqual(s.ajustes.map((a) => a.codigo).sort(), ["dias_parado", "reanuncio"]);
    for (const a of s.ajustes) assert.ok(s.justificativa.includes(a.label));
  });

  it("cada ajuste é limitado pela sua própria constante nomeada", () => {
    const dias = s.ajustes.find((a) => a.codigo === "dias_parado");
    const rean = s.ajustes.find((a) => a.codigo === "reanuncio");
    // 90 dias: (90−30)/30 × 1pt = −2pt, dentro do teto de 3pt.
    assert.equal(dias?.pontos, -0.02);
    // 3 anúncios: 2 extras × 1pt = −2pt, exatamente no teto de 2pt.
    assert.equal(rean?.pontos, -REGUA_PADRAO.AJUSTE_REANUNCIO_MAX);
    assert.equal(s.minimoSugerido, 102_600); // 1,066 − 0,04 = 1,026 sobre 100.000
  });

  it("com a régua padrão os tetos individuais já limitam antes do total", () => {
    // 3pt (dias) + 2pt (reanúncio) = 5pt < AJUSTE_TOTAL_MAX (6pt). Ou seja: hoje
    // o teto total NÃO chega a morder — ele é a guarda externa, não o limitador.
    const muito = exigirSugestao(
      sugerirPrecoRepasse(entrada({ diasNoRepasse: 400, qtdeAnuncios: 9 })),
    );
    const bruto = muito.ajustes.reduce((t, a) => t + a.pontos, 0);
    assert.ok(Math.abs(bruto - -0.05) < 1e-12);
    assert.ok(Math.abs(bruto) < REGUA_PADRAO.AJUSTE_TOTAL_MAX);
    assert.equal(muito.minimoSugerido, 101_600); // 1,066 − 0,05 = 1,016
  });

  it("AJUSTE_TOTAL_MAX morde quando os tetos individuais são afrouxados", () => {
    // É pra isso que a guarda externa existe: alguém subir um teto individual
    // não deve conseguir derrubar a régua sem limite.
    const muito = exigirSugestao(
      sugerirPrecoRepasse(entrada({ diasNoRepasse: 400, qtdeAnuncios: 9 }), {
        ...REGUA_PADRAO,
        AJUSTE_DIAS_MAX: 0.5,
        AJUSTE_REANUNCIO_MAX: 0.5,
      }),
    );
    const bruto = muito.ajustes.reduce((t, a) => t + a.pontos, 0);
    assert.ok(bruto < -REGUA_PADRAO.AJUSTE_TOTAL_MAX); // pediram mais que o teto
    assert.equal(muito.minimoSugerido, 100_600); // travou em 1,066 − 0,06 = 1,006
    assert.equal(muito.comprePorSugerido, 105_672.27);
  });

  it("carro sem dias/anúncios não sofre ajuste nenhum", () => {
    const limpo = exigirSugestao(sugerirPrecoRepasse(entrada()));
    assert.deepEqual(limpo.ajustes, []);
    assert.equal(limpo.minimoSugerido, 106_600);
  });
});

describe("a régua é PLANA em quilometragem (decisão do Marcos, 2026-08-12)", () => {
  // O ajuste de km existiu e foi removido: cobrava duas vezes pelo mesmo sinal,
  // porque REGUA_MINIMO_PCT já é a mediana de uma amostra desta frota rodada.
  // Este teste é a trava contra readicionar o ajuste achando que foi esquecimento.
  it("dois carros idênticos com km MUITO diferente recebem o MESMO preço", () => {
    const rodado = exigirSugestao(
      sugerirPrecoRepasse(entrada({ km: 260_000, anoModelo: 2017 })),
    );
    const novo = exigirSugestao(sugerirPrecoRepasse(entrada({ km: 5_000, anoModelo: 2026 })));
    assert.equal(rodado.minimoSugerido, novo.minimoSugerido);
    assert.equal(rodado.comprePorSugerido, novo.comprePorSugerido);
    assert.equal(rodado.minimoSugerido, 106_600);
    assert.deepEqual(rodado.ajustes, []);
    assert.deepEqual(novo.ajustes, []);
  });

  it("nenhum ajuste do motor tem código de km", () => {
    const s = exigirSugestao(
      sugerirPrecoRepasse(entrada({ km: 500_000, anoModelo: 2010, diasNoRepasse: 200 })),
    );
    assert.ok(!s.ajustes.some((a) => String(a.codigo).includes("km")));
  });

  it("km continua valendo pra FIPE ajustada — que é referência de ALERTA, não preço", () => {
    const rodado = exigirSugestao(
      sugerirPrecoRepasse(entrada({ valorFipe: 130_000, km: 249_000, anoModelo: 2018 })),
    );
    const novo = exigirSugestao(
      sugerirPrecoRepasse(entrada({ valorFipe: 130_000, km: 5_000, anoModelo: 2018 })),
    );
    // A referência do alerta muda…
    assert.ok(rodado.referenciaTeto != null && rodado.referenciaTeto < 130_000);
    assert.equal(novo.referenciaTeto, 130_000);
    // …e o preço, não.
    assert.equal(rodado.minimoSugerido, novo.minimoSugerido);
    assert.equal(rodado.minimoSugerido, 106_600);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SERIALIZAÇÃO DA RÉGUA (parametros_regua JSONB NOT NULL)
// ═════════════════════════════════════════════════════════════════════════════

describe("serializarParametrosRegua (AC10 / migration 030)", () => {
  it("é objeto não-vazio e leva o compre-por DERIVADO junto", () => {
    const p = serializarParametrosRegua();
    assert.ok(Object.keys(p).length > 0);
    assert.equal(p.REGUA_MINIMO_PCT, 1.066);
    assert.equal(p.RAZAO_MINIMO_SOBRE_COMPRE_POR, 0.952);
    assert.equal(p.REGUA_COMPRE_POR_PCT, REGUA_COMPRE_POR_PCT);
    assert.equal(p.TETO_REF_AA_PCT, 1.05);
    assert.equal(p.PISO_PCT, 1);
  });

  it("serializa os valores do OVERRIDE, não os da régua padrão", () => {
    const p = serializarParametrosRegua({ ...REGUA_PADRAO, REGUA_MINIMO_PCT: 1.1 });
    assert.equal(p.REGUA_MINIMO_PCT, 1.1);
    assert.equal(p.REGUA_COMPRE_POR_PCT, 1.1 / 0.952);
  });

  it("versao_regua cabe no CHECK da 030 (1..60 caracteres, não vazia)", () => {
    assert.ok(VERSAO_REGUA.trim().length >= 1 && VERSAO_REGUA.trim().length <= 60);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// MONTAGEM DO SNAPSHOT — função pura, sem banco (AC21/AC22)
// ═════════════════════════════════════════════════════════════════════════════

describe("montarSnapshotPrecificacao (AC21/AC22)", () => {
  const AGORA = new Date("2026-08-12T15:30:00.000Z");

  const sugestao = exigirSugestao(
    sugerirPrecoRepasse(
      entrada({
        gastos: [1_500, 2_500.55],
        valorAutoAvaliar: 112_000,
        valorFipe: 130_000,
        km: 84_000,
        anoModelo: 2020,
        diasNoRepasse: 12,
        qtdeAnuncios: 1,
      }),
    ),
  );

  it("aplicar SEM editar grava sugerido == aplicado", () => {
    const { insert, carimbo, houveEdicao } = montarSnapshotPrecificacao({
      repasseId: 42,
      sugestao,
      aplicado: { minimo: sugestao.minimoSugerido, comprePor: sugestao.comprePorSugerido },
      agora: AGORA,
    });
    assert.equal(houveEdicao, false);
    assert.equal(carimbo.minimo_aplicado, insert.minimo_sugerido);
    assert.equal(carimbo.compre_por_aplicado, insert.compre_por_sugerido);
    assert.equal(carimbo.aplicado_em, "2026-08-12T15:30:00.000Z");
  });

  it("editar antes de aplicar preserva OS DOIS PARES — a correção é o rótulo", () => {
    const { insert, carimbo, houveEdicao } = montarSnapshotPrecificacao({
      repasseId: 42,
      sugestao,
      aplicado: { minimo: 105_000, comprePor: 110_000 },
      agora: AGORA,
    });
    assert.equal(houveEdicao, true);
    assert.equal(insert.minimo_sugerido, sugestao.minimoSugerido);
    assert.equal(carimbo.minimo_aplicado, 105_000);
    assert.equal(carimbo.compre_por_aplicado, 110_000);
  });

  it("aplicar ABAIXO do custo é permitido — a invariante é do sugerido, não do aplicado", () => {
    // ADR-003 §11: o banco deliberadamente não recusa; testar ordenação no
    // aplicado viraria proibição de corrigir a régua.
    const { insert, carimbo } = montarSnapshotPrecificacao({
      repasseId: 42,
      sugestao,
      aplicado: { minimo: 90_000, comprePor: 80_000 },
      agora: AGORA,
    });
    assert.equal(carimbo.minimo_aplicado, 90_000);
    assert.equal(carimbo.compre_por_aplicado, 80_000);
    assert.ok(carimbo.compre_por_aplicado < carimbo.minimo_aplicado);
    assert.ok(carimbo.minimo_aplicado < insert.custo_real);
    // O par SUGERIDO continua ordenado.
    assert.ok(insert.compre_por_sugerido >= insert.minimo_sugerido);
    assert.ok(insert.minimo_sugerido >= insert.custo_real);
  });

  it("honra o contrato centavo-perfect da rep_prec_custo_decomposto_chk", () => {
    const { insert } = montarSnapshotPrecificacao({
      repasseId: 42,
      sugestao,
      aplicado: { minimo: sugestao.minimoSugerido, comprePor: sugestao.comprePorSugerido },
      agora: AGORA,
    });
    assert.equal(insert.custo_real, insert.valor_compra_repasse + insert.gastos_total);
    assert.equal(insert.custo_real, 104_000.55);
    assert.equal(insert.gastos_qtde, 2);
  });

  it("congela o CONTEXTO DO MOMENTO — é o que muda depois e não volta", () => {
    const { insert } = montarSnapshotPrecificacao({
      repasseId: 42,
      sugestao,
      aplicado: { minimo: sugestao.minimoSugerido, comprePor: sugestao.comprePorSugerido },
      agora: AGORA,
    });
    assert.equal(insert.repasse_id, 42);
    assert.equal(insert.valor_auto_avaliar, 112_000);
    assert.equal(insert.valor_fipe, 130_000);
    assert.equal(insert.km, 84_000);
    assert.equal(insert.dias_no_repasse, 12);
    assert.equal(insert.qtde_anuncios, 1);
    assert.equal(insert.confianca, "alta");
    assert.equal(insert.versao_regua, VERSAO_REGUA);
    assert.equal(insert.bateu_piso, false);
    assert.ok(Array.isArray(insert.alertas));
    assert.ok(insert.justificativa.length > 0);
    assert.equal(insert.parametros_regua.REGUA_COMPRE_POR_PCT, REGUA_COMPRE_POR_PCT);
  });

  it("referências ausentes viram NULL no snapshot — ausência é dado, nunca chute", () => {
    const semRef = exigirSugestao(sugerirPrecoRepasse(entrada()));
    const { insert } = montarSnapshotPrecificacao({
      repasseId: 7,
      sugestao: semRef,
      aplicado: { minimo: semRef.minimoSugerido, comprePor: semRef.comprePorSugerido },
      agora: AGORA,
    });
    assert.equal(insert.valor_auto_avaliar, null);
    assert.equal(insert.valor_fipe, null);
    assert.equal(insert.km, null);
    assert.equal(insert.confianca, "muito_baixa");
  });

  it("valor aplicado não-numérico é recusado antes de chegar no banco", () => {
    assert.throws(
      () =>
        montarSnapshotPrecificacao({
          repasseId: 1,
          sugestao,
          aplicado: { minimo: Number.NaN, comprePor: 1 },
          agora: AGORA,
        }),
      /minimo aplicado inválido/,
    );
  });
});
