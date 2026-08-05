/**
 * Testes do núcleo PURO do importador Auto Avaliar (Story 2.2 / Fatia 2).
 *
 * Cobre: criar / atualizar / pendência sem chassi / reconciliação vendido↔marcado,
 * custo_real coerente (centavo-perfect) e o payload da RPC (snapshot decidido).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  montarPreviewPuro,
  montarPayloadImport,
  avaliarRiscoReconciliacao,
  type PreviewInputs,
  type RepasseAtivoRef,
  type SubidoRef,
  type VendaRef,
} from "@/lib/repasses/import-auto-avaliar";
import type { RegistroAA } from "@/lib/repasses/parse-auto-avaliar";

function reg(over: Partial<RegistroAA> & { placa_norm: string }): RegistroAA {
  return {
    linha: 1,
    placa_raw: over.placa_norm,
    modelo: "RANGER XLS",
    cor: "Cinza",
    ano_modelo: 2021,
    km: 100000,
    valor_compra: 90000,
    gastos: 0,
    minimo: 100000,
    compre_por: 105000,
    media_aa: 110000,
    media_fipe: 120000,
    media_web: 130000,
    status_aa: "Em oferta",
    data_validade: "2026-08-03",
    ...over,
  };
}

function inputs(over: Partial<PreviewInputs>): PreviewInputs {
  return {
    registros: [],
    avisos: [],
    chassiPorPlaca: new Map<string, string>(),
    repasseAtivoPorPlaca: new Map<string, RepasseAtivoRef>(),
    subidoUniverso: [],
    vendaPorPlaca: new Map<string, VendaRef>(),
    ...over,
  };
}

describe("montarPreviewPuro — decisão criar/atualizar/pendência", () => {
  it("placa com repasse ATIVO → 'atualizar' com repasse_id e chassi do ativo", () => {
    const p = montarPreviewPuro(
      inputs({
        registros: [reg({ placa_norm: "RBU6F30", valor_compra: 93000, gastos: 2000 })],
        repasseAtivoPorPlaca: new Map([["RBU6F30", { id: 42, chassi: "9BXXX" }]]),
      }),
    );
    assert.equal(p.itens.length, 1);
    assert.equal(p.itens[0].acao, "atualizar");
    assert.equal(p.itens[0].repasse_id, 42);
    assert.equal(p.itens[0].chassi, "9BXXX");
    assert.equal(p.itens[0].custo_real, 95000); // 93000 + 2000 (centavo-perfect)
    assert.equal(p.pendencias.length, 0);
  });

  it("sem repasse ativo mas chassi no estoque → 'criar'", () => {
    const p = montarPreviewPuro(
      inputs({
        registros: [reg({ placa_norm: "SCM2G20" })],
        chassiPorPlaca: new Map([["SCM2G20", "9BW-CHASSI"]]),
      }),
    );
    assert.equal(p.itens.length, 1);
    assert.equal(p.itens[0].acao, "criar");
    assert.equal(p.itens[0].repasse_id, null);
    assert.equal(p.itens[0].chassi, "9BW-CHASSI");
  });

  it("sem repasse ativo e sem chassi → Pendência 'sem_chassi' (NÃO cria)", () => {
    const p = montarPreviewPuro(
      inputs({ registros: [reg({ placa_norm: "TGK0B80" })] }),
    );
    assert.equal(p.itens.length, 0);
    assert.equal(p.pendencias.length, 1);
    assert.equal(p.pendencias[0].motivo, "sem_chassi");
    assert.equal(p.pendencias[0].registro.placa_norm, "TGK0B80");
  });

  it("custo_real null quando compra ausente", () => {
    const p = montarPreviewPuro(
      inputs({
        registros: [reg({ placa_norm: "RBU6F30", valor_compra: null })],
        chassiPorPlaca: new Map([["RBU6F30", "CH"]]),
      }),
    );
    assert.equal(p.itens[0].custo_real, null);
  });
});

describe("montarPreviewPuro — reconciliação vendido ↔ marcado", () => {
  const subido: SubidoRef[] = [
    { id: 1, placa_norm: "AAA1A11", modelo: "ONIX" },
    { id: 2, placa_norm: "BBB2B22", modelo: "HB20" },
    { id: 3, placa_norm: "CCC3C33", modelo: "KA" },
  ];

  it("subido que sumiu da lista e cruza com venda → 'vendido' (data/valor reais)", () => {
    const p = montarPreviewPuro(
      inputs({
        registros: [], // lista vazia → todos sumiram
        subidoUniverso: subido,
        vendaPorPlaca: new Map([["AAA1A11", { data_vendido: "2026-07-20", valor_vendido: 88000 }]]),
      }),
    );
    const vend = p.reconciliacao.find((r) => r.repasse_id === 1);
    assert.ok(vend);
    assert.equal(vend.novo_status, "vendido");
    assert.equal(vend.data_vendido, "2026-07-20");
    assert.equal(vend.valor_vendido, 88000);
  });

  it("subido que sumiu e NÃO cruza com venda → 'marcado' (sem data/valor)", () => {
    const p = montarPreviewPuro(
      inputs({ registros: [], subidoUniverso: subido, vendaPorPlaca: new Map() }),
    );
    assert.equal(p.reconciliacao.length, 3);
    for (const r of p.reconciliacao) {
      assert.equal(r.novo_status, "marcado");
      assert.equal(r.data_vendido, null);
      assert.equal(r.valor_vendido, null);
    }
  });

  it("subido que AINDA está na lista NÃO reconcilia (vira 'atualizar')", () => {
    const p = montarPreviewPuro(
      inputs({
        registros: [reg({ placa_norm: "AAA1A11" })],
        repasseAtivoPorPlaca: new Map([["AAA1A11", { id: 1, chassi: "CH1" }]]),
        subidoUniverso: subido,
        vendaPorPlaca: new Map([["AAA1A11", { data_vendido: "2026-07-20", valor_vendido: 88000 }]]),
      }),
    );
    assert.ok(!p.reconciliacao.some((r) => r.repasse_id === 1));
    assert.ok(p.itens.some((i) => i.acao === "atualizar" && i.repasse_id === 1));
    // os outros 2 subidos sumiram → reconciliam como 'marcado'
    assert.equal(p.reconciliacao.length, 2);
  });
});

describe("avaliarRiscoReconciliacao — trava de colagem parcial", () => {
  /** Universo subido sintético com N placas válidas distintas. */
  function universo(n: number): SubidoRef[] {
    return Array.from({ length: n }, (_, i) => ({
      id: i + 1,
      placa_norm: `AA${String(i).padStart(2, "0")}A00`,
      modelo: "MODELO",
    }));
  }

  /** Preview onde só as `mantidas` primeiras placas do universo vieram na lista. */
  function previewCom(n: number, mantidas: number) {
    const subidoUniverso = universo(n);
    const registros = subidoUniverso
      .slice(0, mantidas)
      .map((s) => reg({ placa_norm: s.placa_norm }));
    const repasseAtivoPorPlaca = new Map<string, RepasseAtivoRef>(
      subidoUniverso.slice(0, mantidas).map((s) => [s.placa_norm, { id: s.id, chassi: `CH${s.id}` }]),
    );
    return montarPreviewPuro(inputs({ registros, repasseAtivoPorPlaca, subidoUniverso }));
  }

  it("preview carrega o universo subido como denominador", () => {
    const p = previewCom(64, 60);
    assert.equal(p.subido_total, 64);
    assert.equal(p.reconciliacao.length, 4);
  });

  it("importação normal (4 de 64 sumiram) NÃO exige confirmação", () => {
    const r = avaliarRiscoReconciliacao(previewCom(64, 60));
    assert.equal(r.total, 4);
    assert.equal(r.universo, 64);
    assert.equal(r.exige_confirmacao, false);
  });

  it("semana cheia de vendas (12 de 64 = 19%) ainda passa sem atrito", () => {
    const r = avaliarRiscoReconciliacao(previewCom(64, 52));
    assert.equal(r.total, 12);
    assert.ok(r.proporcao < 0.3);
    assert.equal(r.exige_confirmacao, false);
  });

  it("colagem pela metade (32 de 64 = 50%) EXIGE confirmação", () => {
    const r = avaliarRiscoReconciliacao(previewCom(64, 32));
    assert.equal(r.total, 32);
    assert.equal(r.proporcao, 0.5);
    assert.equal(r.exige_confirmacao, true);
  });

  it("limite de 30%: 19 de 64 passa, 20 de 64 trava", () => {
    assert.equal(avaliarRiscoReconciliacao(previewCom(64, 45)).exige_confirmacao, false); // 19/64 = 29,7%
    assert.equal(avaliarRiscoReconciliacao(previewCom(64, 44)).exige_confirmacao, true); // 20/64 = 31,3%
  });

  it("piso absoluto: universo pequeno com proporção alta não trava (4 de 6 = 67%)", () => {
    const r = avaliarRiscoReconciliacao(previewCom(6, 2));
    assert.equal(r.total, 4);
    assert.ok(r.proporcao > 0.3);
    assert.equal(r.exige_confirmacao, false); // abaixo do piso de 5
  });

  it("piso alcançado em universo pequeno (5 de 6) trava", () => {
    assert.equal(avaliarRiscoReconciliacao(previewCom(6, 1)).exige_confirmacao, true);
  });

  it("universo subido vazio → proporção 0 e sem confirmação", () => {
    const r = avaliarRiscoReconciliacao(previewCom(0, 0));
    assert.equal(r.universo, 0);
    assert.equal(r.proporcao, 0);
    assert.equal(r.exige_confirmacao, false);
  });
});

describe("montarPayloadImport — snapshot pra RPC", () => {
  it("itens carregam ação/repasse_id/chassi + registro completo; pendências ficam de fora", () => {
    const preview = montarPreviewPuro(
      inputs({
        registros: [
          reg({ placa_norm: "RBU6F30", valor_compra: 93000, gastos: 2000, media_aa: 112112.88 }),
          reg({ placa_norm: "ZZZ9Z99" }), // sem chassi → pendência
        ],
        repasseAtivoPorPlaca: new Map([["RBU6F30", { id: 42, chassi: "CH42" }]]),
      }),
    );
    const payload = montarPayloadImport(preview);
    assert.equal(payload.itens.length, 1); // pendência não entra
    const it = payload.itens[0];
    assert.equal(it.acao, "atualizar");
    assert.equal(it.repasse_id, 42);
    assert.equal(it.chassi, "CH42");
    assert.equal(it.registro.placa_norm, "RBU6F30");
    assert.equal(it.registro.valor_compra, 93000);
    assert.equal(it.registro.gastos, 2000);
    assert.equal(it.registro.media_aa, 112112.88);
  });

  it("reconciliação vai completa no payload", () => {
    const preview = montarPreviewPuro(
      inputs({
        registros: [],
        subidoUniverso: [{ id: 7, placa_norm: "DDD4D44", modelo: "T-CROSS" }],
        vendaPorPlaca: new Map([["DDD4D44", { data_vendido: "2026-07-01", valor_vendido: 99000 }]]),
      }),
    );
    const payload = montarPayloadImport(preview);
    assert.deepEqual(payload.reconciliacao, [
      { repasse_id: 7, novo_status: "vendido", data_vendido: "2026-07-01", valor_vendido: 99000 },
    ]);
  });
});
