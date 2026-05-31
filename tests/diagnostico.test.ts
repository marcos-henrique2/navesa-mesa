import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calcularDiagnostico,
  computarDiagnosticoLista,
} from "@/lib/pricing/diagnostico";
import type { Classe } from "@/lib/pricing/classificacao";
import { veiculo } from "./_mocks";

// ═══════════════════════════════════════════════════════════════════════════
// FIXTURES
// ═══════════════════════════════════════════════════════════════════════════

const FIPE = 100000; // preço FIPE base usado nos cenários
const MEDIANA_KM = 60000;

// ═══════════════════════════════════════════════════════════════════════════
// CASOS
// ═══════════════════════════════════════════════════════════════════════════

test("classe B + cautelar aprovada + km na mediana + 20 dias pátio + preço = FIPE → coerente", () => {
  const v = veiculo({ km: MEDIANA_KM, dias_patio: 20, preco_venda: FIPE });
  const r = calcularDiagnostico({
    veiculo: v,
    classe: "B",
    precoFipe: FIPE,
    cautelar: "aprovado",
    medianaKmModeloAno: MEDIANA_KM,
  });
  assert.equal(r.status, "coerente");
  assert.equal(r.precoEsperado, FIPE);
  assert.equal(r.ajustes.length, 0);
  assert.equal(r.baseClassePct, 0);
});

test("classe A + km na mediana + cautelar OK + 12 dias + preço -3% da base → subprecificado", () => {
  // base A = +2% → esperado = 102.000; atual = 97.000 → desvio = -4,9% (entre -7% e -3%)
  const v = veiculo({ km: MEDIANA_KM, dias_patio: 12, preco_venda: 97000 });
  const r = calcularDiagnostico({
    veiculo: v,
    classe: "A",
    precoFipe: FIPE,
    cautelar: "aprovado",
    medianaKmModeloAno: MEDIANA_KM,
  });
  assert.equal(r.status, "subprecificado");
  assert.ok(r.desvioPct < -0.03 && r.desvioPct > -0.07, `desvio=${r.desvioPct} fora da janela`);
});

test("classe B + km próximo da mediana + cautelar OK + 22 dias + preço -14% → subprecificado_grave", () => {
  // base B = 0 → esperado = 100.000; atual = 86.000 → desvio = -14% (≤ -7%)
  const v = veiculo({ km: 65000, dias_patio: 22, preco_venda: 86000 });
  const r = calcularDiagnostico({
    veiculo: v,
    classe: "B",
    precoFipe: FIPE,
    cautelar: "aprovado",
    medianaKmModeloAno: MEDIANA_KM,
  });
  assert.equal(r.status, "subprecificado_grave");
  assert.ok(r.desvioPct <= -0.07);
});

test("classe B + 87 dias parado + preço +9% acima da base → acima_mercado", () => {
  // base B = 0, dias 87 (≤90) = -3%; esperado = 97.000; atual = 109.000 → desvio = +12,4%
  const v = veiculo({ km: MEDIANA_KM, dias_patio: 87, preco_venda: 109000 });
  const r = calcularDiagnostico({
    veiculo: v,
    classe: "B",
    precoFipe: FIPE,
    cautelar: "aprovado",
    medianaKmModeloAno: MEDIANA_KM,
  });
  assert.equal(r.status, "acima_mercado");
  assert.ok(r.desvioPct >= 0.05);
  assert.equal(r.ajustes.some((a) => a.codigo === "dias_patio"), true);
});

test("classe E (qualquer combinação) → status 'repasse'", () => {
  const v = veiculo({ km: MEDIANA_KM, dias_patio: 10, preco_venda: 80000 });
  const r = calcularDiagnostico({
    veiculo: v,
    classe: "E",
    precoFipe: FIPE,
    cautelar: "reprovado",
    medianaKmModeloAno: MEDIANA_KM,
  });
  assert.equal(r.status, "repasse");
});

test("cautelar reprovada (classe E forçada) → ajuste cautelar = 0 (sem dupla contagem)", () => {
  // classificacao.ts já força E pra cautelar reprovado → baseClasse cobre.
  // Aqui validamos que NÃO aparece ajuste 'cautelar' nos ajustes individuais.
  const v = veiculo({ km: MEDIANA_KM, dias_patio: 10, preco_venda: 80000 });
  const r = calcularDiagnostico({
    veiculo: v,
    classe: "E",
    precoFipe: FIPE,
    cautelar: "reprovado",
    medianaKmModeloAno: MEDIANA_KM,
  });
  const cautelar = r.ajustes.find((a) => a.codigo === "cautelar");
  assert.equal(cautelar, undefined, "Ajuste cautelar não deve aparecer pra reprovado (já está em classe E)");
});

test("dias_patio < 7 + preço -8% → status COERENTE (suprime alerta de subprecificado)", () => {
  // Sem a supressão seria subprec_grave (desvio -8%); recém-entrado força coerente.
  const v = veiculo({ km: MEDIANA_KM, dias_patio: 5, preco_venda: 92000 });
  const r = calcularDiagnostico({
    veiculo: v,
    classe: "B",
    precoFipe: FIPE,
    cautelar: "aprovado",
    medianaKmModeloAno: MEDIANA_KM,
  });
  assert.equal(r.status, "coerente");
  assert.equal(r.confianca.recemEntrado, true);
});

test("sem FIPE matched + tem custo → calcula com proxy custo × 1.18, semFipe=true", () => {
  // valor_aquisicao 80.000 × 1.18 = 94.400 = baseRef; classe B base=0; atual 94.400 → coerente
  const v = veiculo({
    km: MEDIANA_KM,
    dias_patio: 10,
    preco_venda: 94400,
    valor_aquisicao: 80000,
  });
  const r = calcularDiagnostico({
    veiculo: v,
    classe: "B",
    precoFipe: null,
    cautelar: "aprovado",
    medianaKmModeloAno: MEDIANA_KM,
  });
  assert.equal(r.confianca.semFipe, true);
  assert.equal(r.precoEsperado, 94400);
  assert.equal(r.status, "coerente");
});

test("sem cautelar → neutro + confianca.semCautelar=true", () => {
  const v = veiculo({ km: MEDIANA_KM, dias_patio: 10, preco_venda: FIPE });
  const r = calcularDiagnostico({
    veiculo: v,
    classe: "B",
    precoFipe: FIPE,
    cautelar: null,
    medianaKmModeloAno: MEDIANA_KM,
  });
  assert.equal(r.confianca.semCautelar, true);
  assert.equal(r.ajustes.some((a) => a.codigo === "cautelar"), false);
  assert.equal(r.status, "coerente");
});

test("cap ajustes: somatório < -10% deve cair pra -10%", () => {
  // Cautelar com_restricao (-3%) + 95 dias pátio (-5%) + km +50% mediana (-4%) = -12% somado
  // Cap deve trazer pra -10%.
  const v = veiculo({
    km: Math.round(MEDIANA_KM * 1.5),
    dias_patio: 95,
    preco_venda: 87000,
  });
  const r = calcularDiagnostico({
    veiculo: v,
    classe: "B",
    precoFipe: FIPE,
    cautelar: "com_restricao",
    medianaKmModeloAno: MEDIANA_KM,
  });
  const somaCrua = r.ajustes.reduce((a, x) => a + x.pct, 0);
  assert.ok(somaCrua < -0.1, `somaCrua=${somaCrua} deveria ser < -10%`);
  assert.equal(r.ajusteTotalPct, -0.1);
  // esperado = 100.000 × (1 + 0 + -0.10) = 90.000
  assert.equal(r.precoEsperado, 90000);
});

// ═══════════════════════════════════════════════════════════════════════════
// FIXES DO QUINN (Fase A.1) — guard rails
// ═══════════════════════════════════════════════════════════════════════════

test("FIX 1 (HIGH): valor_aquisicao=0 + sem FIPE → sem_dados (não 'coerente' falso)", () => {
  // Antes do fix: baseRef=0 escapava do guard `baseRef == null`, virava precoEsperado=0,
  // desvioPct=0 (precoEsperado<=0 cai em desvioPct=0) → status "coerente" silencioso.
  const r = calcularDiagnostico({
    veiculo: veiculo({ valor_aquisicao: 0, preco_venda: 50000 }),
    classe: "B",
    precoFipe: null,
    cautelar: null,
    medianaKmModeloAno: null,
  });
  assert.equal(r.status, "sem_dados");
  assert.equal(r.precoEsperado, 0);
  assert.ok(r.motivos.some((m) => m.includes("diagnóstico indisponível")));
});

test("FIX 2 (MEDIUM): dias_patio=null → recemEntrado=false + flag semDiasPatio + alerta dispara", () => {
  // Antes do fix: dias_patio ?? 0 → recemEntrado=true → suprimia alerta de subprecificado
  // em massa pra todos os carros sem essa info no parser.
  const r = calcularDiagnostico({
    veiculo: veiculo({ dias_patio: null, preco_venda: 50000 }),
    classe: "B",
    precoFipe: 60000,
    cautelar: "aprovado",
    medianaKmModeloAno: null,
  });
  assert.equal(r.confianca.recemEntrado, false);
  assert.equal(r.confianca.semDiasPatio, true);
  // Sem dias_patio, nenhum ajuste de tier é aplicado
  assert.equal(r.ajustes.some((a) => a.codigo === "dias_patio"), false);
  // Desvio = (50000-60000)/60000 ≈ -16,7% → subprecificado_grave (não suprime mais)
  assert.equal(r.status, "subprecificado_grave");
});

test("FIX 3 (MEDIUM): classe inválida (não A-E) → sem_dados sem NaN", () => {
  // Antes do fix: params.baseClasse['Z'] = undefined → toda aritmética virava NaN,
  // status caía em "coerente" (NaN não bate threshold) e precoEsperado=NaN virava null no JSON.
  const r = calcularDiagnostico({
    veiculo: veiculo({ preco_venda: 50000 }),
    classe: "Z" as unknown as Classe,
    precoFipe: 60000,
    cautelar: null,
    medianaKmModeloAno: null,
  });
  assert.equal(r.status, "sem_dados");
  assert.ok(Number.isFinite(r.precoEsperado), `precoEsperado=${r.precoEsperado} deve ser finito`);
  assert.ok(Number.isFinite(r.desvioPct), `desvioPct=${r.desvioPct} deve ser finito`);
  assert.ok(r.motivos.some((m) => m.toLowerCase().includes("classe inválida")));
});

test("Fase B: medianaPorHeuristica=true → confianca.kmHeuristica=true + motivo", () => {
  const r = calcularDiagnostico({
    veiculo: veiculo({ km: MEDIANA_KM, dias_patio: 20, preco_venda: FIPE }),
    classe: "B",
    precoFipe: FIPE,
    cautelar: "aprovado",
    medianaKmModeloAno: MEDIANA_KM,
    medianaPorHeuristica: true,
  });
  assert.equal(r.confianca.kmHeuristica, true);
  assert.ok(r.motivos.some((m) => m.toLowerCase().includes("heurística")));
});

test("Fase B: medianaPorHeuristica default false → kmHeuristica=false", () => {
  const r = calcularDiagnostico({
    veiculo: veiculo({ km: MEDIANA_KM, dias_patio: 20, preco_venda: FIPE }),
    classe: "B",
    precoFipe: FIPE,
    cautelar: "aprovado",
    medianaKmModeloAno: MEDIANA_KM,
  });
  assert.equal(r.confianca.kmHeuristica, false);
});

test("computarDiagnosticoLista retorna Map com diagnóstico por chassi", () => {
  const v1 = veiculo({
    chassi: "CHASSI11111111111",
    km: MEDIANA_KM,
    dias_patio: 20,
    preco_venda: FIPE,
    marca: "FORD",
    modelo: "RANGER XLS",
    ano_modelo: 2022,
  });
  const v2 = veiculo({
    chassi: "CHASSI22222222222",
    km: 80000,
    dias_patio: 22,
    preco_venda: 86000,
    marca: "FORD",
    modelo: "RANGER XLS",
    ano_modelo: 2022,
  });

  const classesPorChassi = new Map<string, Classe>([
    [v1.chassi, "B"],
    [v2.chassi, "B"],
  ]);
  const fipeBatch: Record<string, number> = {
    [v1.chassi]: FIPE,
    [v2.chassi]: FIPE,
  };
  const cautelaresPorChassi = {
    [v1.chassi]: "aprovado" as const,
    [v2.chassi]: "aprovado" as const,
  };
  const medianasKmPorChave = new Map<string, number>([
    ["FORD|RANGER XLS|2022", MEDIANA_KM],
  ]);

  const mapa = computarDiagnosticoLista({
    veiculos: [v1, v2],
    classesPorChassi,
    fipeBatch,
    cautelaresPorChassi,
    medianasKmPorChave,
  });

  assert.equal(mapa.size, 2);
  assert.equal(mapa.get(v1.chassi)?.status, "coerente");
  assert.equal(mapa.get(v2.chassi)?.status, "subprecificado_grave");
});
