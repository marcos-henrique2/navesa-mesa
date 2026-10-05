/**
 * Testes da camada de I/O do sync por ARQUIVO (Story 2.2, Fatia 3a + migration 045).
 *
 * As duas funções de I/O (`previewSyncArquivo`/`aplicarSyncArquivo`) chamam
 * `getSupabase()` — exige browser, sem harness de Postgres no projeto. O que é
 * testável aqui, sem rede, é o builder PURO do `p_payload`
 * (`montarPPayloadComReconciliacao`): é ele que decide quais chaves da migration
 * 045 vão no corpo da chamada, e é o ponto exato onde um bug silencioso faria a
 * reconciliação nunca ligar (payload sem `reconciliar_sumidos`) ou ligar errado
 * (placas de outra loja esquecidas).
 *
 * `node --import tsx --test tests/*.test.ts`
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { montarPPayloadComReconciliacao } from "@/lib/repasses/sync-arquivo-auto-avaliar-queries";
import type { PayloadSyncArquivo } from "@/lib/parsers/auto-avaliar-ofertas-xls";

const PAYLOAD_BASE: PayloadSyncArquivo = {
  versao: 1,
  origem: "arquivo_xls",
  linhas: [
    {
      linha: 2,
      placa: "ABC1D23",
      valor_compra_repasse: 100000,
      valor_minimo: null,
      valor_compre_por: null,
      valor_fipe: null,
      valor_web: null,
      valor_auto_avaliar: null,
      valor_maior_oferta: null,
      qtde_anuncios: null,
    },
  ],
};

describe("montarPPayloadComReconciliacao", () => {
  it("sempre liga reconciliar_sumidos: true", () => {
    const p = montarPPayloadComReconciliacao(PAYLOAD_BASE, { placasOutrasLojas: [] });
    assert.equal(p.reconciliar_sumidos, true);
  });

  it("manda placas_outras_lojas como array, copiado (não a mesma referência)", () => {
    const outras = ["SCV9H90", "SDL6I80"];
    const p = montarPPayloadComReconciliacao(PAYLOAD_BASE, { placasOutrasLojas: outras });
    assert.deepEqual(p.placas_outras_lojas, outras);
    assert.notEqual(p.placas_outras_lojas, outras);
  });

  it("lista vazia de outras lojas vira array vazio, nunca undefined", () => {
    const p = montarPPayloadComReconciliacao(PAYLOAD_BASE, { placasOutrasLojas: [] });
    assert.deepEqual(p.placas_outras_lojas, []);
  });

  it("preserva o payload original intacto (versao, origem, linhas)", () => {
    const p = montarPPayloadComReconciliacao(PAYLOAD_BASE, { placasOutrasLojas: ["X"] });
    assert.equal(p.versao, 1);
    assert.equal(p.origem, "arquivo_xls");
    assert.deepEqual(p.linhas, PAYLOAD_BASE.linhas);
  });

  it("não muta o payload nem o array de entrada", () => {
    const outras = ["SCV9H90"];
    const copiaPayload = { ...PAYLOAD_BASE, linhas: [...PAYLOAD_BASE.linhas] };
    montarPPayloadComReconciliacao(PAYLOAD_BASE, { placasOutrasLojas: outras });
    assert.deepEqual(PAYLOAD_BASE, copiaPayload);
    assert.deepEqual(outras, ["SCV9H90"]);
  });
});
