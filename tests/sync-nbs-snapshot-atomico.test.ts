import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SnapshotMeta } from "@/lib/parsers/nbs-xlsx";
import { gravarVeiculosNode } from "../scripts/sync-nbs/gravar";
import { ehErroDeTimeout, TAMANHO_LOTE_VEICULOS } from "@/lib/data/snapshot-estoque";
import { veiculo } from "./_mocks";

type Erro = { message: string; code?: string };
type Linha = Record<string, unknown>;

/**
 * Supabase falso em memória: `estoque_snapshots` (id serial) + `veiculos` com
 * `on delete cascade` em snapshot_id. `falharInsertVeiculos(n)` decide o erro da
 * n-ésima chamada de insert em `veiculos` (1-based); `contagemForcada` sobrescreve
 * o count da conferência final.
 */
function bancoFalso(opts: {
  falharInsertVeiculos?: (chamada: number) => Erro | null;
  contagemForcada?: number;
  /** Erro da n-ésima chamada de DELETE em `estoque_snapshots` (1-based). */
  falharDeleteSnapshot?: (chamada: number) => Erro | null;
  /** DELETE "passa" sem erro mas não remove nada (RETURNING vazio). */
  deleteNaoRemove?: boolean;
} = {}) {
  const snapshots: Linha[] = [];
  let veiculos: Linha[] = [];
  let proximoId = 394;
  let chamadasInsertVeiculos = 0;
  let chamadasDeleteSnapshot = 0;
  let chamadasInsertSnapshot = 0;
  const lotes: number[] = [];
  let falharInsert = opts.falharInsertVeiculos;

  const sb = {
    from(tabela: string) {
      if (tabela === "estoque_snapshots") {
        return {
          insert(row: Linha) {
            chamadasInsertSnapshot++;
            const id = proximoId++;
            snapshots.push({ ...row, id });
            return { select: () => ({ single: async () => ({ data: { id }, error: null }) }) };
          },
          delete() {
            return {
              eq(col: string, val: unknown) {
                assert.equal(col, "id");
                return {
                  async select(retorno: string) {
                    assert.equal(retorno, "id");
                    chamadasDeleteSnapshot++;
                    const erro = opts.falharDeleteSnapshot?.(chamadasDeleteSnapshot) ?? null;
                    if (erro) return { data: null, error: erro };
                    if (opts.deleteNaoRemove) return { data: [], error: null };
                    const i = snapshots.findIndex((s) => s.id === val);
                    const removidas = i >= 0 ? snapshots.splice(i, 1) : [];
                    veiculos = veiculos.filter((v) => v.snapshot_id !== val); // cascade
                    return { data: removidas.map((r) => ({ id: r.id })), error: null };
                  },
                };
              },
            };
          },
        };
      }
      assert.equal(tabela, "veiculos");
      return {
        async insert(lote: Linha[]) {
          chamadasInsertVeiculos++;
          lotes.push(lote.length);
          const erro = falharInsert?.(chamadasInsertVeiculos) ?? null;
          if (erro) return { error: erro }; // statement cancelado = nada gravado
          veiculos.push(...lote);
          return { error: null };
        },
        select(_col: string, o: { count: string; head: boolean }) {
          assert.equal(o.count, "exact");
          return {
            async eq(col: string, val: unknown) {
              assert.equal(col, "snapshot_id");
              const real = veiculos.filter((v) => v.snapshot_id === val).length;
              return { count: opts.contagemForcada ?? real, error: null };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;

  /** O que `veiculos_atual` mostraria: veículos do snapshot de maior id. */
  const veiculosAtual = () => {
    if (snapshots.length === 0) return [];
    const max = Math.max(...snapshots.map((s) => s.id as number));
    return veiculos.filter((v) => v.snapshot_id === max);
  };

  return {
    sb,
    snapshots,
    veiculosAtual,
    lotes,
    chamadas: () => chamadasInsertVeiculos,
    chamadasDelete: () => chamadasDeleteSnapshot,
    chamadasInsertSnapshot: () => chamadasInsertSnapshot,
    setFalharInsert: (f: (chamada: number) => Erro | null) => {
      falharInsert = f;
    },
  };
}

const TIMEOUT: Erro = { code: "57014", message: "canceling statement due to statement timeout" };

function estoque(n: number) {
  return Array.from({ length: n }, (_, i) => veiculo({ chassi: `CHASSI${String(i).padStart(11, "0")}` }));
}

function meta(n: number): SnapshotMeta {
  return { arquivo_nome: "sync-oracle-teste", data_geracao: new Date("2026-11-06T10:00:00Z"), total_veiculos: n, total_lojas: 1 };
}

const semEspera = { esperar: async () => {} };

describe("gravarVeiculosNode — snapshot atômico (incidente 06/11/2026)", () => {
  it("sucesso: snapshot publicado com TODOS os veículos, em lotes de no máximo 250", async () => {
    const db = bancoFalso();
    const r = await gravarVeiculosNode(db.sb, estoque(1108), meta(1108), semEspera);

    assert.equal(r.snapshotId, 394);
    assert.equal(r.inseridos, 1108);
    assert.equal(db.veiculosAtual().length, 1108);
    assert.equal(db.snapshots.length, 1);
    assert.deepEqual(db.lotes, [250, 250, 250, 250, 108]);
    assert.ok(db.lotes.every((n) => n <= TAMANHO_LOTE_VEICULOS));
  });

  it("falha no meio do insert (timeout persistente no lote 3): snapshot removido, estoque anterior continua publicado", async () => {
    const db = bancoFalso();
    await gravarVeiculosNode(db.sb, estoque(10), meta(10)); // snapshot anterior (394), completo
    const base = db.chamadas();
    db.setFalharInsert((n) => (n - base >= 3 ? TIMEOUT : null)); // lotes 1-2 entram, 3 sempre estoura

    await assert.rejects(
      gravarVeiculosNode(db.sb, estoque(1108), meta(1108), semEspera),
      (err: Error) => {
        assert.match(err.message, /snapshot 395/);
        assert.match(err.message, /lote 3\/5/);
        assert.match(err.message, /statement timeout/);
        assert.match(err.message, /snapshot removido \(rollback\)/);
        return true;
      },
    );

    assert.deepEqual(db.snapshots.map((s) => s.id), [394]);
    assert.equal(db.veiculosAtual().length, 10, "veiculos_atual volta pro snapshot anterior completo");
    assert.ok(db.veiculosAtual().every((v) => v.snapshot_id === 394));
  });

  it("timeout transitório: retry com backoff exponencial e snapshot completo no final", async () => {
    const esperas: number[] = [];
    const db = bancoFalso({ falharInsertVeiculos: (n) => (n === 2 || n === 3 ? TIMEOUT : null) });
    const r = await gravarVeiculosNode(db.sb, estoque(600), meta(600), {
      esperar: async (ms) => {
        esperas.push(ms);
      },
    });

    assert.equal(r.inseridos, 600);
    assert.equal(db.veiculosAtual().length, 600);
    assert.deepEqual(esperas, [1000, 2000]);
  });

  it("erro não-retentável (ex.: violação de unique) não faz retry e remove o snapshot", async () => {
    const db = bancoFalso({ falharInsertVeiculos: () => ({ code: "23505", message: "duplicate key value" }) });
    await assert.rejects(gravarVeiculosNode(db.sb, estoque(5), meta(5), semEspera), /tentativa 1\/3.*rollback/);
    assert.equal(db.chamadas(), 1);
    assert.equal(db.snapshots.length, 0);
    assert.equal(db.veiculosAtual().length, 0);
  });

  it("contagem gravada ≠ lida: snapshot removido mesmo sem erro nos inserts", async () => {
    const db = bancoFalso({ contagemForcada: 1107 });
    await assert.rejects(
      gravarVeiculosNode(db.sb, estoque(1108), meta(1108), semEspera),
      /contagem divergente: 1107 gravado\(s\) no banco vs 1108 lido\(s\)/,
    );
    assert.equal(db.snapshots.length, 0);
  });

  it("rollback que falha (erro não-timeout) vira erro CRÍTICO explícito (pra sync_log)", async () => {
    const db = bancoFalso({ falharInsertVeiculos: () => TIMEOUT, falharDeleteSnapshot: () => ({ message: "rede caiu" }) });
    await assert.rejects(
      gravarVeiculosNode(db.sb, estoque(5), meta(5), semEspera),
      /CRÍTICO: rollback falhou \(rede caiu \(tentativa 1\/3\)\)/,
    );
    assert.equal(db.chamadasDelete(), 1);
  });

  it("DELETE de rollback com timeout 1x é repetido com backoff e remove o snapshot", async () => {
    const esperas: number[] = [];
    const db = bancoFalso({
      falharInsertVeiculos: (n) => (n >= 2 ? { code: "23505", message: "duplicate key value" } : null),
      falharDeleteSnapshot: (n) => (n === 1 ? TIMEOUT : null),
    });
    await assert.rejects(
      gravarVeiculosNode(db.sb, estoque(600), meta(600), { esperar: async (ms) => void esperas.push(ms) }),
      /snapshot removido \(rollback\)/,
    );
    assert.equal(db.chamadasDelete(), 2);
    assert.deepEqual(esperas, [1000]);
    assert.equal(db.snapshots.length, 0);
    assert.equal(db.veiculosAtual().length, 0);
  });

  it("DELETE de rollback com timeout persistente esgota tentativas e vira CRÍTICO", async () => {
    const db = bancoFalso({ falharInsertVeiculos: () => TIMEOUT, falharDeleteSnapshot: () => TIMEOUT });
    await assert.rejects(
      gravarVeiculosNode(db.sb, estoque(5), meta(5), semEspera),
      /CRÍTICO: rollback falhou \(canceling statement due to statement timeout \(tentativa 3\/3\)\)/,
    );
    assert.equal(db.chamadasDelete(), 3);
  });

  it("DELETE sem erro mas sem linha removida (RETURNING vazio) é rollback falho → CRÍTICO", async () => {
    const db = bancoFalso({ falharInsertVeiculos: () => TIMEOUT, deleteNaoRemove: true });
    await assert.rejects(
      gravarVeiculosNode(db.sb, estoque(5), meta(5), semEspera),
      /CRÍTICO: rollback falhou \(DELETE não removeu nenhuma linha\)/,
    );
  });

  it("lista vazia é recusada antes de criar o snapshot", async () => {
    const db = bancoFalso();
    await assert.rejects(gravarVeiculosNode(db.sb, [], meta(0), semEspera), /lista de veículos vazia — snapshot não criado/);
    assert.equal(db.chamadasInsertSnapshot(), 0);
    assert.equal(db.snapshots.length, 0);
  });
});

describe("ehErroDeTimeout", () => {
  it("reconhece SQLSTATE 57014 e a mensagem do Postgres", () => {
    assert.equal(ehErroDeTimeout({ code: "57014", message: "x" }), true);
    assert.equal(ehErroDeTimeout({ message: "canceling statement due to statement timeout" }), true);
    assert.equal(ehErroDeTimeout({ code: "23505", message: "duplicate key value" }), false);
  });
});
