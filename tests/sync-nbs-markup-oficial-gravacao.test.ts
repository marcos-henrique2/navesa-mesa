import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Connection } from "oracledb";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  gravarMarkupOficialEmVeiculos,
  processarMarkupOficialEstoque,
  type ItemGravacaoMarkupOficial,
} from "../scripts/sync-nbs/calcular-markup-estoque";

type ChamadaUpdate = { payload: unknown; snapshotId: unknown; chassi: unknown };

/** Mock mínimo do client Supabase só pra `.from("veiculos").update(p).eq().eq().select("id")`. */
function sbFalso(respostaPorChassi: (chassi: string) => { data: unknown[] | null; error: { message: string } | null }) {
  const chamadas: ChamadaUpdate[] = [];
  const sb = {
    from(tabela: string) {
      assert.equal(tabela, "veiculos");
      let payload: unknown;
      let snapshotId: unknown;
      return {
        update(p: unknown) {
          payload = p;
          return this;
        },
        eq(coluna: string, valor: unknown) {
          if (coluna === "snapshot_id") snapshotId = valor;
          if (coluna === "chassi") {
            chamadas.push({ payload, snapshotId, chassi: valor });
          }
          return this;
        },
        async select() {
          const ultima = chamadas[chamadas.length - 1];
          return respostaPorChassi(String(ultima.chassi));
        },
      };
    },
  } as unknown as SupabaseClient;
  return { sb, chamadas };
}

function item(overrides: Partial<ItemGravacaoMarkupOficial> = {}): ItemGravacaoMarkupOficial {
  return {
    chassi: "9BWZZZ377VT004251",
    payload: {
      custo_revisoes: 100,
      custo_forplan: 200,
      custo_holdback: 0,
      custo_acessorios: 0,
      custo_adm: 0,
      custo_impostos: 50,
      custo_comissoes: 30,
      custo_despesas_gerais: 40,
      custo_total: 400,
    },
    ...overrides,
  };
}

describe("gravarMarkupOficialEmVeiculos", () => {
  it("não chama o Supabase quando não há itens", async () => {
    let chamou = false;
    const sb = { from() { chamou = true; return this; } } as unknown as SupabaseClient;
    const r = await gravarMarkupOficialEmVeiculos(sb, 1, []);
    assert.deepEqual(r, { atualizados: 0, semCorrespondencia: [], falhas: [] });
    assert.equal(chamou, false);
  });

  it("atualiza por snapshot_id + chassi e conta sucesso quando a linha existe", async () => {
    const { sb, chamadas } = sbFalso(() => ({ data: [{ id: 1 }], error: null }));
    const r = await gravarMarkupOficialEmVeiculos(sb, 42, [item()]);
    assert.deepEqual(r, { atualizados: 1, semCorrespondencia: [], falhas: [] });
    assert.equal(chamadas[0].snapshotId, 42);
    assert.equal(chamadas[0].chassi, "9BWZZZ377VT004251");
    assert.deepEqual(chamadas[0].payload, item().payload);
  });

  it("reporta semCorrespondencia quando o update não bate nenhuma linha (chassi não está nesse snapshot)", async () => {
    const { sb } = sbFalso(() => ({ data: [], error: null }));
    const r = await gravarMarkupOficialEmVeiculos(sb, 42, [item({ chassi: "FANTASMA" })]);
    assert.deepEqual(r, { atualizados: 0, semCorrespondencia: ["FANTASMA"], falhas: [] });
  });

  it("captura o erro do Supabase na lista de falhas em vez de rejeitar a promise", async () => {
    const { sb } = sbFalso(() => ({ data: null, error: { message: "falhou" } }));
    const r = await gravarMarkupOficialEmVeiculos(sb, 42, [item()]);
    assert.equal(r.atualizados, 0);
    assert.equal(r.semCorrespondencia.length, 0);
    assert.equal(r.falhas.length, 1);
    assert.equal(r.falhas[0].chassi, "9BWZZZ377VT004251");
    assert.match(r.falhas[0].erro, /falhou/);
  });

  it("processa múltiplos itens em lotes (concorrência controlada) sem perder nenhum", async () => {
    const vistos = new Set<string>();
    const { sb } = sbFalso((chassi) => {
      vistos.add(chassi);
      return { data: [{ id: 1 }], error: null };
    });
    const itens = Array.from({ length: 7 }, (_, i) => item({ chassi: `CHASSI${i}` }));
    const r = await gravarMarkupOficialEmVeiculos(sb, 1, itens, 3);
    assert.equal(r.atualizados, 7);
    assert.equal(vistos.size, 7);
  });

  it("uma gravação falhando no meio do lote não aborta as demais (nem as anteriores nem as posteriores)", async () => {
    // Lote de concorrência 3: CHASSI0, CHASSI1 (falha), CHASSI2 no mesmo
    // Promise.all — CHASSI3 e CHASSI4 ficam no lote seguinte e também devem
    // ser processados normalmente, provando que o lote seguinte não foi
    // abortado pelo erro do lote anterior.
    const vistos = new Set<string>();
    const { sb } = sbFalso((chassi) => {
      vistos.add(chassi);
      if (chassi === "CHASSI1") return { data: null, error: { message: "rate limit" } };
      return { data: [{ id: 1 }], error: null };
    });
    const itens = Array.from({ length: 5 }, (_, i) => item({ chassi: `CHASSI${i}` }));
    const r = await gravarMarkupOficialEmVeiculos(sb, 1, itens, 3);

    // Todas as 5 gravações foram tentadas (nada foi pulado por abort).
    assert.equal(vistos.size, 5);
    // 4 sucessos (0, 2, 3, 4) + 1 falha isolada (1).
    assert.equal(r.atualizados, 4);
    assert.equal(r.semCorrespondencia.length, 0);
    assert.deepEqual(r.falhas, [{ chassi: "CHASSI1", erro: "rate limit" }]);
  });
});

describe("processarMarkupOficialEstoque", () => {
  function linhaCusto(codigo: number, valor: number) {
    return { COD_CUSTO: codigo, VALOR: valor };
  }

  /** Linhas que reconciliam: revisoes=100, forplan=0, impostos=0, comissoes=0, gerais=0, total=100. */
  const linhasOk = [linhaCusto(7, 100), linhaCusto(105, 100)];
  /** Linhas que NÃO reconciliam (total não bate com a soma das categorias). */
  const linhasDivergentes = [linhaCusto(7, 100), linhaCusto(105, 999)];

  function conexaoFalsa(candidatosRows: Record<string, unknown>[], tmpPorChassiResumido: Map<string, Record<string, unknown>[]>) {
    let indiceCandidato = -1;
    const conn = {
      async execute(sql: string) {
        if (sql.includes("FROM NBS.VEICULOS v")) {
          return { rows: candidatosRows };
        }
        if (sql.includes("VEICULOS_MARKUP_TMP")) {
          const chassiResumido = candidatosRows[indiceCandidato]?.CHASSI_RESUMIDO as string;
          return { rows: tmpPorChassiResumido.get(chassiResumido) ?? [] };
        }
        // chamada à function (BEGIN ... END) — indiceCandidato avança aqui
        indiceCandidato++;
        return { outBinds: { resultado: "OK" } };
      },
      async rollback() {},
    } as unknown as Connection;
    return conn;
  }

  it("grava só os veículos reconciliados; divergentes e sem chassi preservam valor anterior (não gravam)", async () => {
    const candidatosRows = [
      { COD_EMPRESA: 2, COD_PRODUTO: 10, COD_MODELO: 300, CHASSI_RESUMIDO: "OK1", PRECO_TABELA: 1000, CHASSI: "CHASSI-OK1", PLACA: "AAA1111" },
      { COD_EMPRESA: 2, COD_PRODUTO: 10, COD_MODELO: 300, CHASSI_RESUMIDO: "DIVERGE", PRECO_TABELA: 2000, CHASSI: "CHASSI-DIVERGE", PLACA: "BBB2222" },
      { COD_EMPRESA: 2, COD_PRODUTO: 10, COD_MODELO: 300, CHASSI_RESUMIDO: "SEMCHASSI", PRECO_TABELA: 3000, PLACA: "CCC3333" },
    ];
    const tmp = new Map<string, Record<string, unknown>[]>([
      ["OK1", linhasOk],
      ["DIVERGE", linhasDivergentes],
      ["SEMCHASSI", linhasOk],
    ]);
    const conn = conexaoFalsa(candidatosRows, tmp);

    const gravacoes: unknown[] = [];
    const sb = {
      from(tabela: string) {
        assert.equal(tabela, "veiculos");
        let payload: unknown;
        return {
          update(p: unknown) { payload = p; return this; },
          eq() { return this; },
          async select() {
            gravacoes.push(payload);
            return { data: [{ id: 1 }], error: null };
          },
        };
      },
    } as unknown as SupabaseClient;

    const resumo = await processarMarkupOficialEstoque(conn, sb, 777);

    assert.equal(resumo.candidatosAvaliados, 3);
    assert.equal(resumo.sucessosOracle, 3);
    assert.equal(resumo.falhasOracle, 0);
    assert.equal(resumo.divergentes, 1);
    assert.equal(resumo.semChassiParaGravar, 1);
    assert.equal(resumo.gravados, 1);
    assert.equal(gravacoes.length, 1);
    assert.ok(resumo.avisos.some((a) => a.includes("DIVERGE") && a.includes("divergência bloqueou")));
    assert.ok(resumo.avisos.some((a) => a.includes("SEMCHASSI") && a.includes("sem chassi completo")));
  });

  it("sem sb (SUPABASE indisponível), não grava nada mas ainda reconcilia e avisa", async () => {
    const candidatosRows = [
      { COD_EMPRESA: 2, COD_PRODUTO: 10, COD_MODELO: 300, CHASSI_RESUMIDO: "OK1", PRECO_TABELA: 1000, CHASSI: "CHASSI-OK1", PLACA: "AAA1111" },
    ];
    const conn = conexaoFalsa(candidatosRows, new Map([["OK1", linhasOk]]));
    const resumo = await processarMarkupOficialEstoque(conn, null, null);
    assert.equal(resumo.gravados, 0);
    assert.ok(resumo.avisos.some((a) => a.includes("SUPABASE não configurado")));
  });
});
