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
  AJUSTES_APLICAM_NO_MODO_GIRAR,
  MODO_PADRAO,
  REGUA_COMPRE_POR_PCT,
  REGUA_PADRAO,
  VERSAO_REGUA,
  arredondarParaCentena,
  baseDoModo,
  decomporCusto,
  reguaComprePorPct,
  serializarParametrosRegua,
  sugerirPrecoRepasse,
  versaoReguaComModo,
  type EntradaSugestaoRepasse,
  type ModoPreco,
  type SugestaoPrecoRepasse,
} from "@/lib/pricing/sugerir-preco-repasse";
import { montarSnapshotPrecificacao } from "@/lib/pricing/snapshot-precificacao";
import {
  classificarOrigemAbaixoDoCusto,
  type SnapshotRecente,
} from "@/lib/pricing/origem-abaixo-do-custo";

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

/** Atalho pro modo girar sem repetir `REGUA_PADRAO` em toda chamada. */
function girar(
  over: Partial<EntradaSugestaoRepasse> = {},
  params = REGUA_PADRAO,
): ReturnType<typeof sugerirPrecoRepasse> {
  return sugerirPrecoRepasse(entrada(over), params, "girar_rapido");
}

/** Idem pro modo recuperar, quando o teste quer o modo EXPLÍCITO. */
function recuperar(
  over: Partial<EntradaSugestaoRepasse> = {},
  params = REGUA_PADRAO,
): ReturnType<typeof sugerirPrecoRepasse> {
  return sugerirPrecoRepasse(entrada(over), params, "recuperar_tudo");
}

/** Centavo-perfect, mesmo critério do motor. */
function cent(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/** Os DOIS modos, e só dois — mesmo domínio do `rep_prec_modo_chk` da 032. */
const MODOS: readonly ModoPreco[] = ["recuperar_tudo", "girar_rapido"];

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

  it("o par arredondado é o que se aplica; o exato é o que o snapshot chama de sugerido", () => {
    const s = exigirSugestao(sugerirPrecoRepasse(entrada()));
    assert.equal(s.comprePorArredondado, 112_000);
    assert.equal(s.comprePorSugerido, 111_974.79);
    assert.equal(s.minimoArredondado, 106_600); // já era múltiplo de 100
    assert.equal(arredondarParaCentena(106_649), 106_600);
    assert.equal(arredondarParaCentena(106_651), 106_700);
  });

  it("o arredondamento NUNCA fura o piso — cai pro exato e avisa", () => {
    // Piso ativo: o mínimo trava no custo_real, e a centena de BAIXO cruzaria.
    // custo 100.040,00 ⇒ mínimo trava em 100.040,00; arredondar daria 100.000.
    const s = exigirSugestao(
      sugerirPrecoRepasse(entrada({ valorCompraRepasse: 100_040 }), {
        ...REGUA_PADRAO,
        REGUA_MINIMO_PCT: 0.9, // força o clamp no piso
      }),
    );
    assert.equal(s.bateuPiso, true);
    assert.equal(s.minimoSugerido, 100_040);
    assert.equal(s.minimoArredondado, 100_040); // NÃO virou 100.000
    assert.ok(s.minimoArredondado >= s.custo.custoReal);
    assert.ok(s.alertas.some((a) => a.includes("não foi arredondado")));
  });

  it("arredondar pra CIMA não fura piso nenhum e segue valendo", () => {
    // custo 100.060 ⇒ trava em 100.060; a centena mais próxima é 100.100 (acima).
    const s = exigirSugestao(
      sugerirPrecoRepasse(entrada({ valorCompraRepasse: 100_060 }), {
        ...REGUA_PADRAO,
        REGUA_MINIMO_PCT: 0.9,
      }),
    );
    assert.equal(s.minimoArredondado, 100_100);
    assert.ok(!s.alertas.some((a) => a.includes("não foi arredondado")));
  });

  it("o compre por arredondado nunca cai abaixo do mínimo arredondado", () => {
    for (const compra of [100_000, 100_050, 66_037, 248_991.47, 12_345.67]) {
      const s = exigirSugestao(sugerirPrecoRepasse(entrada({ valorCompraRepasse: compra })));
      assert.ok(
        s.comprePorArredondado >= s.minimoArredondado &&
          s.minimoArredondado >= s.custo.custoReal,
        `par arredondado quebrou a ordem em compra=${compra}`,
      );
    }
  });

  it("a banda p25–p75 é do MÍNIMO entre carros, não a faixa mínimo↔compre-por", () => {
    const s = exigirSugestao(sugerirPrecoRepasse(entrada()));
    // `bandaMinimo` é `| null` desde a C7 da 3.1c — no modo recuperar (default
    // aqui) ela SEMPRE existe; o `null` é exclusivo do girar.
    assert.ok(s.bandaMinimo != null);
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

  it("versao_regua cabe no CHECK da 030 (1..60 caracteres, não vazia) — COM o sufixo do modo", () => {
    assert.ok(VERSAO_REGUA.trim().length >= 1 && VERSAO_REGUA.trim().length <= 60);
    // O que vai ao banco é a versão SUFIXADA (C12). 49 e 47 chars hoje; se
    // alguém alongar `VERSAO_REGUA`, é aqui que estoura, não em produção.
    for (const modo of ["recuperar_tudo", "girar_rapido"] as ModoPreco[]) {
      const v = versaoReguaComModo(modo);
      assert.ok(v.trim().length >= 1 && v.trim().length <= 60, `versao_regua longa demais: ${v}`);
    }
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

  it("aplicar exatamente o sugerido grava sugerido == aplicado", () => {
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

  it("o caminho REAL da UI aplica o par arredondado — delta abaixo de R$ 100", () => {
    // Decisão do Marcos, 2026-08-12: grava-se o que foi de fato ao ar, não o
    // centavo da régua. Quem recalibrar tem que olhar a MAGNITUDE, não a flag.
    const { insert, carimbo, houveEdicao } = montarSnapshotPrecificacao({
      repasseId: 42,
      sugestao,
      aplicado: { minimo: sugestao.minimoArredondado, comprePor: sugestao.comprePorArredondado },
      agora: AGORA,
    });
    assert.equal(houveEdicao, true);
    assert.ok(Math.abs(carimbo.minimo_aplicado - insert.minimo_sugerido) < 100);
    assert.ok(Math.abs(carimbo.compre_por_aplicado - insert.compre_por_sugerido) < 100);
    // O sugerido gravado continua sendo a saída CRUA da régua.
    assert.equal(insert.minimo_sugerido, sugestao.minimoSugerido);
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
    // ⚠️ Exceção declarada da C1 (3.1c): `versao_regua` passa a carregar o
    // sufixo do modo NOS DOIS MODOS. Sem ele, a query 6 da migration 032
    // (`NOT LIKE '%\_\_' || modo`) marcaria 100% das linhas recuperar como
    // inconsistentes e o detector viraria ruído.
    assert.equal(insert.versao_regua, `${VERSAO_REGUA}__recuperar_tudo`);
    assert.equal(insert.modo, "recuperar_tudo");
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

// ═════════════════════════════════════════════════════════════════════════════
// STORY 3.1c — DOIS MODOS, UMA CONSTANTE, DUAS BASES
// ═════════════════════════════════════════════════════════════════════════════
//
// ┌─ ⚠️ LEIA ANTES DE "CONSERTAR" QUALQUER COISA AQUI ──────────────────────────┐
// │ Autoridade: ADR-003 §12.2 (a invariante nova) e a decisão do MARCOS de      │
// │ 2026-08-12 (D1 = piso na compra; D3 = régua ÚNICA nas duas bases).          │
// │                                                                             │
// │ `minimo_sugerido ≥ custo_real` **NÃO é mais invariante do sistema**. É      │
// │ corolário de I1 no modo `recuperar_tudo` e é **FALSO POR DESENHO** no modo  │
// │ `girar_rapido` sempre que os gastos passarem de 6,6% da compra. O caso      │
// │ PRD2189 abaixo EXIGE `minimo < custo_real` — é ele que transforma a decisão │
// │ do Marcos em regressão detectável.                                          │
// │                                                                             │
// │ Os três "consertos" errados, todos mais baratos de escrever que o certo     │
// │ (ADR-003 §12.3): ❌ afrouxar pra `>= custo_real * 0,9`; ❌ pular a asserção  │
// │ no girar; ❌ passar `custo_real` como base do girar "só pro teste passar" — │
// │ que é literalmente a opção que o Marcos recusou.                            │
// └─────────────────────────────────────────────────────────────────────────────┘

/** PRD2189 — o carro real da story. compra 80.000 · gastos 6.850 · custo 86.850. */
const PRD2189: Partial<EntradaSugestaoRepasse> = {
  valorCompraRepasse: 80_000,
  gastos: [6_850],
};

describe("3.1c C1 — não-regressão do modo recuperar", () => {
  it("o default do motor é `recuperar_tudo` e bate com o modo explícito", () => {
    const implicito = exigirSugestao(sugerirPrecoRepasse(entrada(PRD2189)));
    const explicito = exigirSugestao(recuperar(PRD2189));
    assert.equal(MODO_PADRAO, "recuperar_tudo");
    assert.deepEqual(implicito, explicito);
  });

  it("os números da 3.1a não se mexeram — mesma base, mesmas constantes, mesmo par", () => {
    const s = exigirSugestao(recuperar());
    assert.equal(s.custo.custoReal, 100_000);
    assert.equal(s.minimoSugerido, 106_600);
    assert.equal(s.comprePorSugerido, 111_974.79);
    assert.equal(s.minimoRazaoEfetiva, 1.066);
    assert.equal(s.comprePorRazaoEfetiva, 1.119748);
    assert.equal(s.bateuPiso, false);
    assert.deepEqual(s.bandaMinimo, { p25: 104_200, p75: 110_700 });
  });

  it("as DUAS únicas diferenças declaradas são `modo` e o sufixo de `versaoRegua`", () => {
    const s = exigirSugestao(recuperar(PRD2189));
    assert.equal(s.modo, "recuperar_tudo");
    assert.equal(s.versaoRegua, `${VERSAO_REGUA}__recuperar_tudo`);
    // O alerta de piso do modo recuperar continua BYTE A BYTE o da 3.1a.
    const piso = exigirSugestao(recuperar({}, { ...REGUA_PADRAO, REGUA_MINIMO_PCT: 0.9 }));
    assert.ok(
      piso.alertas.includes(
        "Sugestão bateu no piso de custo — não há espaço pra desconto. O mínimo travou no custo real.",
      ),
    );
  });
});

describe("3.1c C2/D3 — uma constante só, sobre duas bases", () => {
  it("o mínimo do girar sai de valor_compra_repasse × REGUA_MINIMO_PCT", () => {
    const s = exigirSugestao(girar(PRD2189));
    assert.equal(s.modo, "girar_rapido");
    assert.equal(s.custo.valorCompraRepasse, 80_000);
    assert.equal(s.minimoSugerido, 85_280); // 80.000 × 1,066
    assert.equal(s.comprePorSugerido, 89_579.83); // 85.280 ÷ 0,952
    assert.equal(s.versaoRegua, `${VERSAO_REGUA}__girar_rapido`);
  });

  it("`baseDoModo` é a única fonte da base — e ela é a compra no girar", () => {
    const c = decomporCusto(80_000, [6_850]);
    assert.ok(c != null);
    assert.equal(baseDoModo(c, "recuperar_tudo"), 86_850);
    assert.equal(baseDoModo(c, "girar_rapido"), 80_000);
  });

  it("NENHUMA constante nova em REGUA_PADRAO — REGUA_GIRAR_PCT não existe", () => {
    // Trava contra a proposta da v1 da story (1,072 sobre a compra). Sob D3 a
    // diferença entre os modos é INTEIRAMENTE atribuível à base.
    assert.deepEqual(Object.keys(REGUA_PADRAO).sort(), [
      "AJUSTE_DIAS_MAX",
      "AJUSTE_REANUNCIO_MAX",
      "AJUSTE_TOTAL_MAX",
      "BANDA_MINIMO_P25_PCT",
      "BANDA_MINIMO_P75_PCT",
      "DIAS_PARADO_LIMIAR",
      "DIAS_PARADO_POR_PONTO",
      "FIPE_DESCONTO_MAX",
      "FIPE_DESCONTO_POR_EXCESSO",
      "KM_EXCESSO_POR_PONTO",
      "KM_POR_ANO_REFERENCIA",
      "PISO_PCT",
      "RAZAO_MINIMO_SOBRE_COMPRE_POR",
      "REANUNCIO_PONTOS_POR_EXTRA",
      "REGUA_MINIMO_PCT",
      "TETO_REF_AA_PCT",
    ]);
    assert.ok(!("REGUA_GIRAR_PCT" in REGUA_PADRAO));
  });

  it("os dois modos serializam `parametros_regua` BYTE A BYTE idêntico", () => {
    // É por isso que a coluna `modo` da 032 é a ÚNICA fonte possível do modo:
    // derivar do conteúdo da linha não é inferência fraca, é IMPOSSÍVEL.
    const r = exigirSugestao(recuperar(PRD2189));
    const g = exigirSugestao(girar(PRD2189));
    assert.deepEqual(
      serializarParametrosRegua(r.parametros),
      serializarParametrosRegua(g.parametros),
    );
  });
});

describe("3.1c C18 — a identidade da diferença (a trava contra uma 2ª constante)", () => {
  // ⚠️ ESTA É A ASSERÇÃO QUE BARRA A REINTRODUÇÃO DE `REGUA_GIRAR_PCT`,
  // inclusive por engano num merge — a v1 desta story propunha exatamente isso.
  // Sem ela, uma segunda constante passa em todos os outros testes.
  it("minimo_recuperar − minimo_girar = REGUA_MINIMO_PCT × Σ gastos, EXATO", () => {
    const casos: Array<{ compra: number; gastos: number[] }> = [
      { compra: 100_000, gastos: [] },
      { compra: 80_000, gastos: [6_850] },
      { compra: 100_000, gastos: [1_500, 2_500.55] },
      { compra: 100_000, gastos: [12_345.67] },
    ];
    for (const { compra, gastos } of casos) {
      const r = exigirSugestao(recuperar({ valorCompraRepasse: compra, gastos }));
      const g = exigirSugestao(girar({ valorCompraRepasse: compra, gastos }));
      assert.equal(
        cent(r.minimoSugerido - g.minimoSugerido),
        cent(REGUA_PADRAO.REGUA_MINIMO_PCT * r.custo.gastosTotal),
        `identidade quebrada com gastos=${JSON.stringify(gastos)}`,
      );
    }
  });

  it("a diferença é ZERO se e somente se os gastos são zero", () => {
    const semGasto = { valorCompraRepasse: 100_000, gastos: [] };
    assert.equal(
      cent(
        exigirSugestao(recuperar(semGasto)).minimoSugerido -
          exigirSugestao(girar(semGasto)).minimoSugerido,
      ),
      0,
    );
    const comGasto = { valorCompraRepasse: 100_000, gastos: [0.01] };
    assert.ok(
      exigirSugestao(recuperar(comGasto)).minimoSugerido >
        exigirSugestao(girar(comGasto)).minimoSugerido,
    );
  });
});

describe("3.1c C11/D2 — o ajuste de dias parados APLICA no girar (decidido por dado)", () => {
  // ⚠️ Isto NÃO é "ficou como estava". D2 foi respondida com medição em
  // 2026-08-12 (n=62): a diferença entre ≤30 e >30 dias não encolheu ao trocar o
  // denominador de custo (2,72 pt) pra compra (3,03 pt) — logo "parado" e "base
  // da compra" são sinais INDEPENDENTES e não há double-count.
  //
  // Se a medição virar com n maior, o conserto é FLIPAR
  // `AJUSTES_APLICAM_NO_MODO_GIRAR`. Uma segunda fórmula viola a ADR-003 §12.10:
  // o ajuste opera em espaço de razão e é base-agnóstico por construção.
  it("a chave está LIGADA e o ajuste morde no girar", () => {
    assert.equal(AJUSTES_APLICAM_NO_MODO_GIRAR, true);
    const parado = exigirSugestao(girar({ ...PRD2189, diasNoRepasse: 90 }));
    assert.deepEqual(
      parado.ajustes.map((a) => a.codigo),
      ["dias_parado"],
    );
    // 90 dias ⇒ (90−30)/30 × 1pt = −2pt ⇒ 1,066 − 0,02 = 1,046 sobre a COMPRA.
    assert.equal(parado.minimoSugerido, 83_680); // 80.000 × 1,046
  });

  it("o ajuste é o MESMO em pontos de razão nos dois modos (base-agnóstico)", () => {
    const g = exigirSugestao(girar({ ...PRD2189, diasNoRepasse: 90 }));
    const r = exigirSugestao(recuperar({ ...PRD2189, diasNoRepasse: 90 }));
    assert.deepEqual(g.ajustes, r.ajustes);
    // E a identidade da diferença continua valendo COM ajuste aplicado — prova
    // de que o ajuste vive em razão e não vira uma segunda fórmula por modo.
    assert.equal(
      cent(r.minimoSugerido - g.minimoSugerido),
      cent((REGUA_PADRAO.REGUA_MINIMO_PCT - 0.02) * r.custo.gastosTotal),
    );
  });
});

describe("3.1c C3 — carro SEM GASTO: os dois modos dão o MESMO preço", () => {
  // 12 dos 16 vendidos e a maioria da frota. `base(girar) == base(recuperar)` e
  // a constante é a mesma ⇒ não há segunda conta a fazer. Igualdade EXATA, não
  // proximidade: o "coincidem, e qual está por cima" morreu junto com o
  // cruzamento C-a (que só existia com duas constantes).
  const r = exigirSugestao(recuperar({ gastos: [] }));
  const g = exigirSugestao(girar({ gastos: [] }));

  it("os pares sugerido e arredondado são idênticos até o centavo", () => {
    assert.equal(r.minimoSugerido, g.minimoSugerido);
    assert.equal(r.comprePorSugerido, g.comprePorSugerido);
    assert.equal(r.minimoArredondado, g.minimoArredondado);
    assert.equal(r.comprePorArredondado, g.comprePorArredondado);
    assert.equal(r.minimoRazaoEfetiva, g.minimoRazaoEfetiva);
  });

  it("mesmo idênticos, as linhas continuam distinguíveis pelo `modo`", () => {
    assert.notEqual(r.modo, g.modo);
    assert.notEqual(r.versaoRegua, g.versaoRegua);
  });
});

describe("3.1c C4/C18 — as invariantes I0–I3 sob as duas bases", () => {
  it("base(girar) <= base(recuperar) implica preço_girar <= preço_recuperar", () => {
    // Sob D3 a implicação VALE. Com duas constantes era falsa — era o C-a.
    for (const gastos of [[], [10], [6_850], [50_000]]) {
      const r = exigirSugestao(recuperar({ gastos }));
      const g = exigirSugestao(girar({ gastos }));
      assert.ok(baseDoModo(g.custo, "girar_rapido") <= baseDoModo(r.custo, "recuperar_tudo"));
      assert.ok(g.minimoSugerido <= r.minimoSugerido);
      assert.ok(g.comprePorSugerido <= r.comprePorSugerido);
    }
  });

  it("I1 por modo e I2 nos dois, mesmo com a régua adulterada (seam da AC10)", () => {
    for (const razao of [1.2, 2, 0.5, 0.952]) {
      for (const minimoPct of [0.5, 1, 1.066, 1.5]) {
        const params = {
          ...REGUA_PADRAO,
          RAZAO_MINIMO_SOBRE_COMPRE_POR: razao,
          REGUA_MINIMO_PCT: minimoPct,
        };
        for (const modo of MODOS) {
          const s = exigirSugestao(sugerirPrecoRepasse(entrada(PRD2189), params, modo));
          const base = baseDoModo(s.custo, modo);
          // I1 — sobre a base DO MODO, nunca sobre o custo_real.
          assert.ok(
            s.minimoSugerido >= base * params.PISO_PCT,
            `I1 quebrada em modo=${modo} razao=${razao} minimoPct=${minimoPct}`,
          );
          // I2 — incondicional nos dois modos.
          assert.ok(s.comprePorSugerido >= s.minimoSugerido, `I2 quebrada em modo=${modo}`);
          // A garantia global que sobrevive à emenda: "não perco no carro".
          assert.ok(
            s.minimoSugerido >= s.custo.valorCompraRepasse,
            `mínimo abaixo da compra em modo=${modo}`,
          );
        }
      }
    }
  });

  it("PRD2189/girar: `minimo < custo_real` é o resultado ESPERADO", () => {
    // ⚠️ NÃO "CONSERTAR". ADR-003 §12.2 (I-morta) + decisão do Marcos de
    // 2026-08-12: sob o modo girar o mínimo fica abaixo do custo real sempre que
    // os gastos passarem de 6,6% da compra (aqui g = 6.850/80.000 = 8,56%).
    // Este assert é o que torna a decisão dele uma REGRESSÃO DETECTÁVEL.
    const g = exigirSugestao(girar(PRD2189));
    assert.equal(g.custo.custoReal, 86_850);
    assert.equal(g.minimoSugerido, 85_280);
    assert.ok(g.minimoSugerido < g.custo.custoReal, "o girar DEVE ficar abaixo do custo aqui");
    // …e mesmo assim nunca abaixo da compra (I1).
    assert.ok(g.minimoSugerido >= g.custo.valorCompraRepasse);
    // O compre-por segue ACIMA do custo (g < 11,97%) ⇒ sem badge vermelho na lista.
    assert.ok(g.comprePorSugerido > g.custo.custoReal);
    // E o modo recuperar, no MESMO carro, continua acima do custo.
    assert.ok(exigirSugestao(recuperar(PRD2189)).minimoSugerido >= 86_850);
  });
});

describe("3.1c C6 — base(modo) <= 0: a guarda é CONDICIONAL AO MODO", () => {
  // Bug real da 3.1a: `decomporCusto` aceita compra = 0 (só recusa negativo),
  // então com compra 0 e gastos > 0 o custo_real > 0 atravessava a guarda antiga
  // e o girar devolvia mínimo R$ 0,00.
  const semCompra = { valorCompraRepasse: 0, gastos: [6_850] };

  it("girar RECUSA — a base dele é a compra, e ela é zero", () => {
    const r = girar(semCompra);
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.motivo.includes("Girar rápido"));
    assert.ok(!r.ok && r.motivo.includes("COMPRA"));
    assert.equal(!r.ok && r.custo?.custoReal, 6_850);
  });

  it("recuperar SUGERE NORMALMENTE — é caso LEGÍTIMO, não bug", () => {
    // ⚠️ Este ramo é a razão de a guarda NÃO poder virar um
    // `valor_compra_repasse > 0` global: barraria uma sugestão certa. A Dara
    // provou no banco que `rep_prec_base_do_modo_positiva_chk` aceita esta linha.
    const s = exigirSugestao(recuperar(semCompra));
    assert.equal(s.custo.custoReal, 6_850);
    assert.equal(s.minimoSugerido, 7_302.1); // 6.850 × 1,066
    assert.ok(s.minimoSugerido > 0);
  });

  it("compra 0 SEM gastos não sugere em modo nenhum", () => {
    for (const modo of MODOS) {
      const r = sugerirPrecoRepasse(
        entrada({ valorCompraRepasse: 0, gastos: [] }),
        REGUA_PADRAO,
        modo,
      );
      assert.equal(r.ok, false, `modo ${modo} não deveria sugerir`);
    }
  });
});

describe("3.1c C7 — a banda p25–p75 é SUPRIMIDA PELO MOTOR no girar", () => {
  it("`bandaMinimo === null` no girar e preenchida no recuperar", () => {
    assert.equal(exigirSugestao(girar(PRD2189)).bandaMinimo, null);
    assert.deepEqual(exigirSugestao(recuperar(PRD2189)).bandaMinimo, {
      p25: 90_497.7, // 86.850 × 1,042
      p75: 96_142.95, // 86.850 × 1,107
    });
  });

  it("a banda do recuperar continua sobre custo_real — não trocou de base", () => {
    const s = exigirSugestao(recuperar(PRD2189));
    assert.ok(s.bandaMinimo != null);
    assert.equal(s.bandaMinimo.p25, cent(s.custo.custoReal * REGUA_PADRAO.BANDA_MINIMO_P25_PCT));
  });
});

describe("3.1c C8 — a referência não entra no preço em NENHUM modo", () => {
  it("Ref. AA, FIPE e sem-referência produzem pares idênticos nos dois modos", () => {
    for (const modo of MODOS) {
      const pares = [
        { ...PRD2189, valorAutoAvaliar: 105_000 },
        { ...PRD2189, valorFipe: 130_000 },
        { ...PRD2189 },
      ].map((o) => {
        const s = exigirSugestao(sugerirPrecoRepasse(entrada(o), REGUA_PADRAO, modo));
        return [s.minimoSugerido, s.comprePorSugerido];
      });
      assert.deepEqual(pares[0], pares[1]);
      assert.deepEqual(pares[1], pares[2]);
    }
  });

  it("a confiança NÃO é rebaixada no girar — é o mesmo eixo (qualidade da referência)", () => {
    const g = exigirSugestao(girar({ ...PRD2189, valorAutoAvaliar: 105_000 }));
    const r = exigirSugestao(recuperar({ ...PRD2189, valorAutoAvaliar: 105_000 }));
    assert.equal(g.confianca, "alta");
    assert.equal(g.confianca, r.confianca);
  });
});

describe("3.1c C12/C19 — o snapshot e o modo que o produziu", () => {
  const AGORA_3_1C = new Date("2026-08-12T15:30:00.000Z");

  function montar(modo: ModoPreco) {
    const s = exigirSugestao(sugerirPrecoRepasse(entrada(PRD2189), REGUA_PADRAO, modo));
    return montarSnapshotPrecificacao({
      repasseId: 42,
      sugestao: s,
      aplicado: { minimo: s.minimoArredondado, comprePor: s.comprePorArredondado },
      agora: AGORA_3_1C,
    });
  }

  it("o `modo` gravado vem do RESULTADO DO MOTOR, nos dois modos", () => {
    assert.equal(montar("girar_rapido").insert.modo, "girar_rapido");
    assert.equal(montar("recuperar_tudo").insert.modo, "recuperar_tudo");
  });

  it("C19 — a assinatura NÃO aceita `modo` em separado (fix de TIPO, não de teste)", () => {
    const s = exigirSugestao(girar(PRD2189));
    montarSnapshotPrecificacao({
      repasseId: 42,
      sugestao: s,
      // @ts-expect-error C19: "girar com modo recuperar" tem que ser INEXPRIMÍVEL.
      // Se o tsc passar a acusar este `@ts-expect-error` como "unused", alguém
      // acrescentou `modo` a `MontarSnapshotArgs` e reabriu a única corrupção da
      // tabela 030 que o banco NÃO detecta (migration 032 §6).
      modo: "recuperar_tudo",
      aplicado: { minimo: s.minimoArredondado, comprePor: s.comprePorArredondado },
      agora: AGORA_3_1C,
    });
  });

  it("`versao_regua` leva o sufixo COERENTE com a coluna `modo` nos dois", () => {
    // Query 6 da 032 (`versao_regua NOT LIKE ... || modo`) tem que dar 0 linhas.
    for (const modo of MODOS) {
      const { insert } = montar(modo);
      assert.equal(insert.versao_regua, `${VERSAO_REGUA}__${modo}`);
      assert.ok(insert.versao_regua.endsWith(`__${insert.modo}`));
      assert.ok(insert.versao_regua.length <= 60);
    }
  });

  it("`parametros_regua` NÃO ganha chave nova, e é igual nos dois modos", () => {
    assert.deepEqual(
      montar("girar_rapido").insert.parametros_regua,
      montar("recuperar_tudo").insert.parametros_regua,
    );
    assert.ok(!("REGUA_GIRAR_PCT" in montar("girar_rapido").insert.parametros_regua));
  });

  it("as razões efetivas continuam SOBRE custo_real nos dois modos (§12.5)", () => {
    const g = montar("girar_rapido").insert;
    assert.equal(g.custo_real, 86_850);
    assert.equal(g.minimo_sugerido, 85_280);
    // 85.280 ÷ 86.850 = 0,9819228… truncado em numeric(9,6).
    assert.equal(g.minimo_razao_efetiva, 0.981923);
    // O denominador é UNIFORME entre modos — não é a base do modo.
    assert.notEqual(g.minimo_razao_efetiva, g.minimo_sugerido / g.valor_compra_repasse);
  });

  it("o round-trip da razão fecha a ±R$ 0,01 e NÃO exatamente — é por construção", () => {
    // ⛔ NÃO escrever teste de round-trip EXATO (C18 / Edge case #4 / ADR-003
    // §12.5). O valor autoritativo é sempre `minimo_sugerido` (numeric(12,2));
    // a razão é numeric(9,6) e serve pra auditar ordem de grandeza. NÃO é o bug
    // crítico de centavo da AGENTS.md §4: aqui o centavo não é dinheiro, é
    // arredondamento de uma grandeza derivada.
    const g = montar("girar_rapido").insert;
    const volta = cent(g.minimo_razao_efetiva * g.custo_real);
    assert.equal(volta, 85_280.01); // ⚠️ um centavo ACIMA — esperado
    assert.notEqual(volta, g.minimo_sugerido);
    assert.ok(Math.abs(volta - g.minimo_sugerido) <= 0.01);

    // ⚠️ A ASSIMETRIA ENTRE MODOS É ESPERADA E NÃO INDICA DEFEITO NO GIRAR: no
    // recuperar a razão é a própria constante (1,066000) e o round-trip fecha
    // EXATO. Só o girar produz razão não-terminante.
    const r = montar("recuperar_tudo").insert;
    assert.equal(r.minimo_razao_efetiva, 1.066);
    assert.equal(cent(r.minimo_razao_efetiva * r.custo_real), r.minimo_sugerido);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// C16 — AS TRÊS ORIGENS DE "ABAIXO DO CUSTO" (ADR-003 §12.8)
// ═════════════════════════════════════════════════════════════════════════════
//
// ⚠️ O que estes testes protegem: o vermelho fica reservado pro que o Marcos NÃO
// escolheu. Se um "conserto" futuro fizer carro girado voltar a acender
// vermelho, o alerta passa a tocar em TODO carro girado com g > 6,6% — e alerta
// que toca sempre deixa de ser lido (a razão que matou o alerta de piso, §5).

describe("3.1c C16 — classificarOrigemAbaixoDoCusto", () => {
  const girado: SnapshotRecente = {
    modo: "girar_rapido",
    minimoAplicado: 85_300,
    custoReal: 86_850,
    aplicadoEmData: "2026-08-12",
  };

  it("DECISÃO — snapshot girar e o aplicado bate com o preço de hoje", () => {
    assert.equal(classificarOrigemAbaixoDoCusto(girado, 85_300), "decisao");
  });

  it("DERIVA — snapshot recuperar que bate: o custo subiu depois (gasto tardio)", () => {
    // Na hora da decisão a I1 garantia `minimo ≥ custo`; se hoje está abaixo, o
    // custo é que subiu. É o caso que o Risk #8 da 3.1 mirava — vermelho intacto.
    const recuperado: SnapshotRecente = {
      modo: "recuperar_tudo",
      minimoAplicado: 106_600,
      custoReal: 100_000,
      aplicadoEmData: "2026-08-12",
    };
    assert.equal(classificarOrigemAbaixoDoCusto(recuperado, 106_600), "deriva");
  });

  it("FORA DO SISTEMA — não há snapshot nenhum", () => {
    assert.equal(classificarOrigemAbaixoDoCusto(null, 85_300), "fora_do_sistema");
  });

  it("FORA DO SISTEMA — o preço de hoje NÃO é o que foi aplicado (import/inline)", () => {
    // O import do portal ou uma edição inline sobrescreveram o preço: a decisão
    // registrada não explica o número que está no ar.
    assert.equal(classificarOrigemAbaixoDoCusto(girado, 84_000), "fora_do_sistema");
  });

  it("FORA DO SISTEMA — linha 'sugeriu e não aplicou' (carimbo nunca veio)", () => {
    assert.equal(
      classificarOrigemAbaixoDoCusto({ ...girado, minimoAplicado: null }, 85_300),
      "fora_do_sistema",
    );
  });

  it("a comparação do aplicado é CENTAVO-PERFECT, não por tolerância", () => {
    assert.equal(classificarOrigemAbaixoDoCusto(girado, 85_300.0), "decisao");
    assert.equal(classificarOrigemAbaixoDoCusto(girado, 85_300.01), "fora_do_sistema");
  });

  it("girar que bate continua DECISÃO mesmo com o custo de hoje bem acima", () => {
    // Gasto tardio num carro JÁ girado não converte a decisão em erro: o preço
    // no ar continua sendo exatamente o que ele mandou pro portal.
    assert.equal(classificarOrigemAbaixoDoCusto(girado, 85_300), "decisao");
  });
});
