/**
 * Testes do núcleo canônico de margem do repasse (Stories 1.2 / 1.3).
 *
 * Cobre: custo_real (com/sem gastos), margem R$/% centavo-perfect, guardas
 * (div/0, input inválido), a tabela-verdade das 4 faixas de cor + as 3 fronteiras
 * "==", o caso minimo<custo (🔴 sem 🟠), incompleto→neutro, e badge==simulador.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calcularCustoReal,
  calcularDiasNoRepasse,
  calcularMargemPct,
  calcularMargemValor,
  classificarBadge,
  classificarMargem,
  simularLance,
} from "@/lib/repasses/margem-repasse";

// ─── custo_real ──────────────────────────────────────────────────────────────

describe("calcularCustoReal", () => {
  it("sem gastos → só valor_compra_repasse", () => {
    assert.equal(calcularCustoReal(100_000, []), 100_000);
  });

  it("com gastos → compra + Σ gastos", () => {
    assert.equal(calcularCustoReal(100_000, [1_500, 2_500, 300]), 104_300);
  });

  it("gastos com centavos → centavo-perfect (sem drift de float)", () => {
    // 100.10 + 200.20 = 300.30 (float puro daria 300.29999…)
    assert.equal(calcularCustoReal(0.0, [100.1, 200.2]), 300.3);
    assert.equal(calcularCustoReal(1_000.01, [0.02, 0.03]), 1_000.06);
  });

  it("gastos nulos/ inválidos são ignorados (contam 0)", () => {
    assert.equal(calcularCustoReal(50_000, [null, undefined, NaN, 250]), 50_250);
  });

  it("valor_compra_repasse nulo → null (dados incompletos, NUNCA valor_aquisicao)", () => {
    assert.equal(calcularCustoReal(null, [1_000]), null);
    assert.equal(calcularCustoReal(undefined, []), null);
  });
});

// ─── Margem R$ / % ───────────────────────────────────────────────────────────

describe("calcularMargemValor", () => {
  it("positiva", () => {
    assert.equal(calcularMargemValor(130_000, 100_000), 30_000);
  });
  it("negativa (prejuízo)", () => {
    assert.equal(calcularMargemValor(90_000, 100_000), -10_000);
  });
  it("centavo-perfect", () => {
    assert.equal(calcularMargemValor(100_000.5, 100_000.25), 0.25);
    assert.equal(calcularMargemValor(300.3, 100.1), 200.2);
  });
  it("null se algum inválido", () => {
    assert.equal(calcularMargemValor(null, 100_000), null);
    assert.equal(calcularMargemValor(100_000, null), null);
  });
});

describe("calcularMargemPct (sempre sobre custo_real)", () => {
  it("30% de margem", () => {
    assert.equal(calcularMargemPct(130_000, 100_000), 30);
  });
  it("prejuízo → negativo", () => {
    assert.equal(calcularMargemPct(80_000, 100_000), -20);
  });
  it("guarda div/0: custo_real == 0 → null", () => {
    assert.equal(calcularMargemPct(50_000, 0), null);
  });
  it("null se algum inválido", () => {
    assert.equal(calcularMargemPct(100_000, null), null);
    assert.equal(calcularMargemPct(NaN, 100_000), null);
  });
});

// ─── classificarMargem: tabela-verdade das 4 faixas ──────────────────────────
// Cenário saudável: custo=100k ≤ minimo=110k ≤ compre_por=120k
const CUSTO = 100_000;
const MIN = 110_000;
const CP = 120_000;

describe("classificarMargem — 4 faixas", () => {
  it("oferta < custo_real → 🔴 vermelho", () => {
    assert.equal(classificarMargem(90_000, CUSTO, MIN, CP).cor, "vermelho");
  });
  it("oferta acima do compre-por → 🟢 verde", () => {
    assert.equal(classificarMargem(130_000, CUSTO, MIN, CP).cor, "verde");
  });
  it("oferta entre mínimo e compre-por → 🟡 amarelo", () => {
    assert.equal(classificarMargem(115_000, CUSTO, MIN, CP).cor, "amarelo");
  });
  it("oferta entre custo e mínimo → 🟠 laranja", () => {
    assert.equal(classificarMargem(105_000, CUSTO, MIN, CP).cor, "laranja");
  });
});

describe("classificarMargem — 3 fronteiras (==)", () => {
  it("oferta == compre_por → 🟢 verde", () => {
    assert.equal(classificarMargem(CP, CUSTO, MIN, CP).cor, "verde");
  });
  it("oferta == minimo → 🟡 amarelo", () => {
    assert.equal(classificarMargem(MIN, CUSTO, MIN, CP).cor, "amarelo");
  });
  it("oferta == custo → 🟠 laranja", () => {
    assert.equal(classificarMargem(CUSTO, CUSTO, MIN, CP).cor, "laranja");
  });
});

describe("classificarMargem — casos especiais", () => {
  it("minimo < custo → 🔴 (regra 1 vem antes da 3), NUNCA 🟠", () => {
    // custo=100k, minimo=80k, compre_por=120k. Oferta 90k está acima do mínimo
    // mas abaixo do custo → deve ser vermelho, não laranja.
    const c = classificarMargem(90_000, 100_000, 80_000, 120_000);
    assert.equal(c.cor, "vermelho");
    // Varre a faixa [minimo, custo): nenhuma vira 🟠.
    for (let o = 80_000; o < 100_000; o += 2_500) {
      assert.equal(classificarMargem(o, 100_000, 80_000, 120_000).cor, "vermelho");
    }
    // Acima do custo com minimo<custo vira 🟡 (>= minimo), nunca 🟠.
    assert.equal(classificarMargem(110_000, 100_000, 80_000, 120_000).cor, "amarelo");
  });

  it("qualquer valor nulo → neutro (dados incompletos)", () => {
    assert.deepEqual(classificarMargem(CP, null, MIN, CP), { cor: "neutro", completo: false });
    assert.deepEqual(classificarMargem(CP, CUSTO, null, CP), { cor: "neutro", completo: false });
    assert.deepEqual(classificarMargem(CP, CUSTO, MIN, null), { cor: "neutro", completo: false });
    assert.deepEqual(classificarMargem(null, CUSTO, MIN, CP), { cor: "neutro", completo: false });
  });
});

// ─── Badge ───────────────────────────────────────────────────────────────────

describe("classificarBadge (oferta = valor_compre_por)", () => {
  it("compre_por >= custo → 🟢 verde (caso normal)", () => {
    assert.equal(classificarBadge(CUSTO, MIN, CP).cor, "verde");
  });
  it("compre_por < custo → 🔴 vermelho (anuncia abaixo do custo: SCM2G20/PMK6A00)", () => {
    assert.equal(classificarBadge(120_000, 110_000, 100_000).cor, "vermelho");
  });
  it("incompleto → neutro", () => {
    assert.equal(classificarBadge(null, MIN, CP).cor, "neutro");
  });
});

// ─── Simulador + equivalência badge == simulador ─────────────────────────────

describe("simularLance", () => {
  const dados = { custoReal: CUSTO, minimo: MIN, comprePor: CP };

  it("oferta boa → verde, margem R$ e % corretos", () => {
    const s = simularLance(130_000, dados);
    assert.equal(s.valido, true);
    assert.equal(s.completo, true);
    assert.equal(s.cor, "verde");
    assert.equal(s.margemValor, 30_000);
    assert.equal(s.margemPct, 30);
    assert.equal(s.abaixoDoMinimo, false);
    assert.equal(s.abaixoDoCusto, false);
  });

  it("oferta abaixo do mínimo (acima do custo) → flag abaixoDoMinimo, sem prejuízo", () => {
    const s = simularLance(105_000, dados);
    assert.equal(s.cor, "laranja");
    assert.equal(s.abaixoDoMinimo, true);
    assert.equal(s.abaixoDoCusto, false);
  });

  it("oferta abaixo do custo → prejuízo (flag abaixoDoCusto) + vermelho + margem negativa", () => {
    const s = simularLance(90_000, dados);
    assert.equal(s.cor, "vermelho");
    assert.equal(s.abaixoDoCusto, true);
    assert.equal(s.abaixoDoMinimo, true);
    assert.equal(s.margemValor, -10_000);
    assert.equal(s.margemPct, -10);
  });

  it("guarda input: oferta 0 / negativa / não-numérica → não calcula", () => {
    for (const bad of [0, -5, NaN, null, undefined]) {
      const s = simularLance(bad, dados);
      assert.equal(s.valido, false);
      assert.equal(s.margemValor, null);
      assert.equal(s.cor, "neutro");
      assert.ok(s.motivo);
    }
  });

  it("dados incompletos → input válido mas sem margem/cor", () => {
    const s = simularLance(130_000, { custoReal: null, minimo: MIN, comprePor: CP });
    assert.equal(s.valido, true);
    assert.equal(s.completo, false);
    assert.equal(s.cor, "neutro");
    assert.equal(s.margemValor, null);
    assert.ok(s.motivo);
  });

  it("guarda div/0: custo_real == 0 → margem % null, margem R$ calcula", () => {
    const s = simularLance(50_000, { custoReal: 0, minimo: 0, comprePor: 0 });
    assert.equal(s.margemPct, null);
    assert.equal(s.margemValor, 50_000);
  });

  it("badge == simulador: mesma cor pra oferta = compre_por (mesma função canônica)", () => {
    // Normal
    assert.equal(
      simularLance(CP, dados).cor,
      classificarBadge(CUSTO, MIN, CP).cor,
    );
    // Anúncio abaixo do custo
    const abaixo = { custoReal: 120_000, minimo: 110_000, comprePor: 100_000 };
    assert.equal(
      simularLance(100_000, abaixo).cor,
      classificarBadge(120_000, 110_000, 100_000).cor,
    );
  });
});

// ─── dias_no_repasse ─────────────────────────────────────────────────────────

describe("calcularDiasNoRepasse", () => {
  it("parado → hoje − data_subiu", () => {
    assert.equal(calcularDiasNoRepasse("2026-07-01", null, "2026-08-01"), 31);
  });
  it("vendido → data_vendido − data_subiu (ignora hoje)", () => {
    assert.equal(calcularDiasNoRepasse("2026-06-01", "2026-06-15", "2026-08-01"), 14);
  });
  it("data_subiu nula → null (UI mostra —)", () => {
    assert.equal(calcularDiasNoRepasse(null, null, "2026-08-01"), null);
  });
  it("mesma data → 0", () => {
    assert.equal(calcularDiasNoRepasse("2026-08-01", null, "2026-08-01"), 0);
  });
  it("nunca negativo", () => {
    assert.equal(calcularDiasNoRepasse("2026-08-10", null, "2026-08-01"), 0);
  });
});
