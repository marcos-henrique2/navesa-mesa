/**
 * FIPE — cache por referência (correção da defasagem de valores).
 *
 * O bug: `TTL_MS = 30 dias` aplicado sobre o VALOR, com chave de cache SEM o mês
 * de referência. Como a FIPE publica mensalmente, valores de tabelas diferentes
 * conviviam no mesmo estoque. Medido na API em 20/07/2026, mesmo carro e mesmo
 * código FIPE (Ranger Limited+ 3.0 V6 2024, 003498-3):
 *
 *   julho/2026 (ref 335) -> R$ 275.379,00
 *   junho/2026 (ref 334) -> R$ 281.220,00   <- R$ 5.841 de diferença
 *   maio/2026  (ref 333) -> R$ 281.756,00
 *
 * O conceito do fix: valor de uma referência passada é IMUTÁVEL, então a chave
 * contém a referência e o valor nunca expira. Virou o mês, chave nova, miss.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  getMarcas,
  getModelos,
  getAnos,
  getValor,
  getReferencias,
  getReferenciaAtual,
  podarOutrasReferencias,
  clearFipeLocalCache,
  mesmoMesReferencia,
  formatReferenciaCurta,
  __setFipeCacheStorage,
  type CacheStorageLike,
} from "@/lib/fipe/service";
import { isFipeConfirmado, runFipeBatch, type BatchFipeItem, type BatchResult } from "@/lib/fipe/batch";
import { saveBatchToSupabase } from "@/lib/data/fipe-batch";
import type { FipeValor } from "@/lib/fipe/types";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";

// ═══════════════════════════════════════════════════════════════════════════
// Harness
// ═══════════════════════════════════════════════════════════════════════════

/** localStorage em memória, com a mesma superfície que o cache usa. */
class MemStorage implements CacheStorageLike {
  private map = new Map<string, string>();
  /** Quando setado, `setItem` lança — simula QuotaExceededError. */
  quotaCheia = false;

  getItem(k: string): string | null {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    if (this.quotaCheia) throw new Error("QuotaExceededError");
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  key(i: number): string | null {
    return Array.from(this.map.keys())[i] ?? null;
  }
  get length(): number {
    return this.map.size;
  }
  chaves(): string[] {
    return Array.from(this.map.keys());
  }
}

const REF_JULHO = { Codigo: 335, Mes: "julho/2026" };
const REF_JUNHO = { Codigo: 334, Mes: "junho/2026" };
const REF_MAIO = { Codigo: 333, Mes: "maio/2026" };

/** Preços reais medidos, por código de referência. */
const PRECO_POR_REF: Record<number, { valor: string; mes: string }> = {
  335: { valor: "R$ 275.379,00", mes: "julho de 2026" },
  334: { valor: "R$ 281.220,00", mes: "junho de 2026" },
  333: { valor: "R$ 281.756,00", mes: "maio de 2026" },
};

type FetchCall = { url: string; referencia: string | null };

type FakeFetchOpts = {
  /** Referências que `/referencias` devolve (a maior é a "corrente"). */
  referencias?: { Codigo: number; Mes: string }[];
  /**
   * Sobrescreve o `MesReferencia` da resposta de valor, ignorando o que foi
   * pedido — simula a API devolvendo a tabela corrente pra uma consulta fixada
   * em outro mês (foi o que aconteceu com o parâmetro `reference` em inglês).
   */
  mesForcado?: string | null;
};

let chamadas: FetchCall[] = [];
const fetchOriginal = globalThis.fetch;

function instalarFetchFake(opts: FakeFetchOpts = {}): void {
  const referencias = opts.referencias ?? [REF_JULHO, REF_JUNHO, REF_MAIO];

  globalThis.fetch = (async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const referencia = new URL(url).searchParams.get("referencia");
    chamadas.push({ url, referencia });

    const json = (body: unknown): Response =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });

    if (url.includes("/referencias")) return json(referencias);
    if (url.includes("/anos/")) {
      const ref = Number(referencia);
      const preco = PRECO_POR_REF[ref];
      if (!preco) {
        return json({
          error: "apenas assinantes pagos podem acessar o histórico de preços extendido.",
        });
      }
      const valor: FipeValor = {
        TipoVeiculo: 1,
        Valor: preco.valor,
        Marca: "Ford",
        Modelo: "Ranger Limited+ 3.0 V6 Diesel CD 4x4 Aut",
        AnoModelo: 2024,
        Combustivel: "Diesel",
        CodigoFipe: "003498-3",
        // `mesForcado` simula a API ignorando o parâmetro de referência.
        MesReferencia:
          opts.mesForcado !== undefined ? (opts.mesForcado as string) : preco.mes,
        SiglaCombustivel: "D",
      };
      return json(valor);
    }
    if (url.includes("/anos")) return json([{ codigo: "2024-3", nome: "2024 Diesel" }]);
    if (url.includes("/modelos")) {
      return json({ modelos: [{ codigo: 8000, nome: `Ranger (ref ${referencia})` }] });
    }
    if (url.includes("/marcas")) return json([{ codigo: "22", nome: "Ford" }]);
    return json({ error: `rota não simulada: ${url}` });
  }) as typeof globalThis.fetch;
}

/** Prepara storage limpo + fetch fake. Devolve o storage pra inspeção. */
function setup(opts: FakeFetchOpts = {}): MemStorage {
  const st = new MemStorage();
  __setFipeCacheStorage(st);
  chamadas = [];
  instalarFetchFake(opts);
  return st;
}

function teardown(): void {
  __setFipeCacheStorage(null);
  globalThis.fetch = fetchOriginal;
  chamadas = [];
}

/** Quantas chamadas de rede bateram no endpoint de valor. */
function chamadasDeValor(): FetchCall[] {
  return chamadas.filter((c) => c.url.includes("/anos/"));
}

function itemBase(over: Partial<BatchFipeItem> = {}): BatchFipeItem {
  return {
    chassi: "9BFXXXXXXXXXXXXXX",
    precoFipe: 275_379,
    match: {
      marcaCod: "22",
      marcaNome: "Ford",
      modeloCod: 8000,
      modeloNome: "Ranger Limited+ 3.0 V6 Diesel CD 4x4 Aut",
      anoCod: "2024-3",
      anoNome: "2024 Diesel",
    },
    score: 0.92,
    plausibilidadeVerificada: true,
    fipeReferencia: "julho/2026",
    fipeReferenciaCod: 335,
    ...over,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1) A chave de cache inclui a referência
// ═══════════════════════════════════════════════════════════════════════════

test("chave do valor inclui a referência", async () => {
  const st = setup();
  try {
    const ref = await getReferenciaAtual();
    await getValor(ref, "22", 8000, "2024-3");

    const chaveValor = st.chaves().find((k) => k.includes(":valor:"));
    assert.ok(chaveValor, "deveria existir uma chave de valor no cache");
    assert.ok(
      chaveValor.includes("valor:335:22:8000:2024-3"),
      `chave deveria conter a referência 335; veio "${chaveValor}"`,
    );
  } finally {
    teardown();
  }
});

test("marcas, modelos e anos também são chaveados por referência", async () => {
  const st = setup();
  try {
    await getMarcas(335);
    await getModelos(335, "22");
    await getAnos(335, "22", 8000);

    const chaves = st.chaves().map((k) => k.split("fipe-cache-v2:")[1]);
    assert.ok(chaves.includes("marcas:335"));
    assert.ok(chaves.includes("modelos:335:22"));
    assert.ok(chaves.includes("anos:335:22:8000"));
  } finally {
    teardown();
  }
});

test("a requisição é fixada com o parâmetro `referencia` (não `reference`)", async () => {
  // Regressão específica: `?reference=334` é SILENCIOSAMENTE ignorado pela API,
  // que responde com o mês corrente. O nome errado não dá erro — só defasagem.
  setup();
  try {
    const ref = await getReferenciaAtual();
    await getValor(ref, "22", 8000, "2024-3");

    const chamada = chamadasDeValor()[0];
    assert.equal(chamada.referencia, "335");
    assert.ok(
      !/[?&]reference=/.test(chamada.url),
      "não pode usar o parâmetro em inglês, que a API descarta",
    );
  } finally {
    teardown();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 2) Hit dentro do mesmo mês / miss na virada
// ═══════════════════════════════════════════════════════════════════════════

test("hit: duas consultas na mesma referência batem na rede uma vez só", async () => {
  setup();
  try {
    const ref = await getReferenciaAtual();
    const a = await getValor(ref, "22", 8000, "2024-3");
    const b = await getValor(ref, "22", 8000, "2024-3");

    assert.equal(chamadasDeValor().length, 1, "a segunda consulta deveria vir do cache");
    assert.equal(a.Valor, b.Valor);
    assert.equal(a.Valor, "R$ 275.379,00");
  } finally {
    teardown();
  }
});

test("hit persiste além dos 30 dias do TTL antigo — valor de mês fechado não expira", async () => {
  const st = setup();
  try {
    const ref = await getReferenciaAtual();
    await getValor(ref, "22", 8000, "2024-3");
    assert.equal(chamadasDeValor().length, 1);

    // A entrada de valor não pode carregar expiração alguma.
    const chaveValor = st.chaves().find((k) => k.includes(":valor:"))!;
    const bruto = JSON.parse(st.getItem(chaveValor)!) as { exp: number | null };
    assert.equal(bruto.exp, null, "valor de referência fechada não pode expirar");

    // Mesmo "no futuro" (o TTL de 30 dias teria vencido), segue hit.
    const depois = await getValor(ref, "22", 8000, "2024-3");
    assert.equal(chamadasDeValor().length, 1);
    assert.equal(depois.Valor, "R$ 275.379,00");
  } finally {
    teardown();
  }
});

test("miss na virada do mês: referência nova busca de novo e traz o preço novo", async () => {
  // Junho é o estado inicial; julho publica depois. O MESMO carro muda R$ 5.841.
  const st = setup({ referencias: [REF_JUNHO, REF_MAIO] });
  try {
    const refJunho = await getReferenciaAtual();
    assert.equal(refJunho.codigo, 334);
    const valorJunho = await getValor(refJunho, "22", 8000, "2024-3");
    assert.equal(valorJunho.Valor, "R$ 281.220,00");
    assert.equal(chamadasDeValor().length, 1);

    // A FIPE publica julho.
    teardownFetchApenas();
    instalarFetchFake({ referencias: [REF_JULHO, REF_JUNHO, REF_MAIO] });
    // A lista de referências tem TTL de 6h; expira pra simular a redescoberta.
    expirarChave(st, "refs");
    // Zera o contador pra medir só as chamadas DEPOIS da virada.
    chamadas = [];

    const refJulho = await getReferenciaAtual();
    assert.equal(refJulho.codigo, 335);

    const valorJulho = await getValor(refJulho, "22", 8000, "2024-3");
    assert.equal(
      valorJulho.Valor,
      "R$ 275.379,00",
      "chave nova deveria dar miss e trazer o preço de julho",
    );
    assert.equal(chamadasDeValor().length, 1, "miss real: bateu na rede de novo");
  } finally {
    teardown();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 3) Valor de referência passada não é sobrescrito
// ═══════════════════════════════════════════════════════════════════════════

test("consultar julho não sobrescreve o valor já cacheado de junho", async () => {
  const st = setup();
  try {
    const junho = { codigo: 334, mes: "junho/2026" };
    const julho = { codigo: 335, mes: "julho/2026" };

    const vJunho = await getValor(junho, "22", 8000, "2024-3");
    const vJulho = await getValor(julho, "22", 8000, "2024-3");

    assert.equal(vJunho.Valor, "R$ 281.220,00");
    assert.equal(vJulho.Valor, "R$ 275.379,00");

    // As duas entradas coexistem, cada uma sob sua chave.
    const chaves = st.chaves().filter((k) => k.includes(":valor:"));
    assert.equal(chaves.length, 2, `esperava 2 entradas de valor, veio ${chaves.length}`);

    // E junho continua devolvendo junho depois de julho ter sido consultado —
    // era exatamente isso que a chave sem referência quebrava.
    const vJunhoDeNovo = await getValor(junho, "22", 8000, "2024-3");
    assert.equal(vJunhoDeNovo.Valor, "R$ 281.220,00");
  } finally {
    teardown();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 4) Fallback quando a API não devolve a referência
// ═══════════════════════════════════════════════════════════════════════════

test("valor sem MesReferencia é RECUSADO e não entra no cache", async () => {
  const st = setup({ mesForcado: "" });
  try {
    const ref = await getReferenciaAtual();
    await assert.rejects(
      () => getValor(ref, "22", 8000, "2024-3"),
      /sem MesReferencia/i,
      "preço sem referência não pode ser aceito",
    );
    assert.equal(
      st.chaves().filter((k) => k.includes(":valor:")).length,
      0,
      "nada pode ser cacheado quando a referência não veio",
    );
  } finally {
    teardown();
  }
});

test("valor de mês DIFERENTE do pedido é recusado (parâmetro ignorado pela API)", async () => {
  // Modo de falha real do `?reference=` em inglês: pediu junho, veio julho.
  const st = setup({ mesForcado: "julho de 2026" });
  try {
    const junho = { codigo: 334, mes: "junho/2026" };
    await assert.rejects(
      () => getValor(junho, "22", 8000, "2024-3"),
      /não misturar tabelas/i,
    );
    assert.equal(
      st.chaves().filter((k) => k.includes(":valor:")).length,
      0,
      "valor do mês errado não pode ser gravado sob a chave de junho",
    );
  } finally {
    teardown();
  }
});

test("lista de referências vazia derruba a descoberta em vez de assumir um mês", async () => {
  setup({ referencias: [] });
  try {
    await assert.rejects(() => getReferenciaAtual(), /referências/i);
  } finally {
    teardown();
  }
});

test("saveBatchToSupabase RECUSA gravar item sem referência", async () => {
  // Invariante de escrita no banco. Este teste é o que teria pego, na hora, o
  // caminho de migração localStorage→Supabase passando itens legados (todos sem
  // referência por construção) e estourando a migração no meio.
  const batch = (items: Record<string, BatchFipeItem>): BatchResult => ({
    timestamp: Date.now(),
    items,
    erros: [],
    totalGrupos: 0,
    totalVeiculos: Object.keys(items).length,
    persistenciaErro: null,
  });

  await assert.rejects(
    () => saveBatchToSupabase(batch({ A: itemBase({ chassi: "A", fipeReferencia: null }) })),
    /sem referência FIPE/i,
  );

  // Um item bom no meio de um ruim não salva o lote: a recusa é do lote inteiro.
  await assert.rejects(
    () =>
      saveBatchToSupabase(
        batch({
          A: itemBase({ chassi: "A" }),
          B: itemBase({ chassi: "B", fipeReferencia: null }),
        }),
      ),
    /1 item\(ns\) sem referência/i,
  );

  // Lote vazio é no-op, não erro.
  await assert.doesNotReject(() => saveBatchToSupabase(batch({})));
});

test("runFipeBatch aborta sem buscar nem gravar quando a referência não resolve", async () => {
  // Fallback seguro: sem saber a tabela, nenhum preço é buscado nem gravado.
  // Melhor não ter número do que ter um número não auditável.
  setup({ referencias: [] });
  try {
    const veiculo = {
      chassi: "9BFXXXXXXXXXXXXXX",
      marca: "Ford",
      modelo: "RANGER LIMITED",
      ano_modelo: 2024,
      combustivel: "Diesel",
      custo_total: 250_000,
    } as unknown as VeiculoParsed;

    await assert.rejects(
      () => runFipeBatch([veiculo]),
      /tabela FIPE de referência/i,
    );

    // Nada além do próprio /referencias pode ter sido chamado.
    assert.equal(
      chamadas.filter((c) => !c.url.includes("/referencias")).length,
      0,
      "nenhuma consulta de marca/modelo/ano/valor pode acontecer sem referência",
    );
    assert.equal(chamadasDeValor().length, 0);
  } finally {
    teardown();
  }
});

test("item sem referência NÃO conta como FIPE confirmada", () => {
  // A regra que faz o preço legado (mês desconhecido) cair no proxy de custo
  // em vez de alimentar precificação.
  assert.equal(isFipeConfirmado(itemBase()), true);
  assert.equal(isFipeConfirmado(itemBase({ fipeReferencia: null })), false);
  assert.equal(isFipeConfirmado(itemBase({ fipeReferencia: "" })), false);
});

// ═══════════════════════════════════════════════════════════════════════════
// 5) Poda de referências antigas (limite de ~5MB do localStorage)
// ═══════════════════════════════════════════════════════════════════════════

test("poda remove só as chaves de outras referências", async () => {
  const st = setup();
  try {
    // Popula a lista de referências: ela NÃO é por-mês e deve sobreviver à poda.
    await getReferencias();
    await getMarcas(334);
    await getModelos(334, "22");
    await getValor({ codigo: 334, mes: "junho/2026" }, "22", 8000, "2024-3");
    await getMarcas(335);
    await getValor({ codigo: 335, mes: "julho/2026" }, "22", 8000, "2024-3");

    const removidas = podarOutrasReferencias(335);
    assert.equal(removidas, 3, "3 chaves de junho deveriam sair");

    const restantes = st.chaves().map((k) => k.split("fipe-cache-v2:")[1]);
    assert.ok(!restantes.some((k) => /^(marcas|modelos|anos|valor):334/.test(k)));
    assert.ok(restantes.includes("marcas:335"));
    assert.ok(restantes.includes("valor:335:22:8000:2024-3"));
    // A lista de referências não é por-mês e precisa sobreviver.
    assert.ok(restantes.includes("refs"));
  } finally {
    teardown();
  }
});

test("virada de mês poda a safra anterior automaticamente", async () => {
  const st = setup({ referencias: [REF_JUNHO, REF_MAIO] });
  try {
    const junho = await getReferenciaAtual();
    await getMarcas(junho.codigo);
    await getValor(junho, "22", 8000, "2024-3");
    assert.ok(st.chaves().some((k) => k.includes("valor:334:")));

    teardownFetchApenas();
    instalarFetchFake({ referencias: [REF_JULHO, REF_JUNHO, REF_MAIO] });
    expirarChave(st, "refs");

    await getReferenciaAtual();

    assert.ok(
      !st.chaves().some((k) => /:(marcas|modelos|anos|valor):334/.test(k)),
      "a safra de junho deveria ter sido podada na virada",
    );
  } finally {
    teardown();
  }
});

test("quota estourada: poda e reescreve em vez de perder a gravação", async () => {
  const st = setup();
  try {
    // Popula junho e fixa a referência corrente em 335.
    await getValor({ codigo: 334, mes: "junho/2026" }, "22", 8000, "2024-3");
    await getReferenciaAtual();
    const antes = st.chaves().length;

    // Próximo setItem falha uma vez; a poda libera espaço e a segunda tentativa passa.
    let primeira = true;
    const setOriginal = st.setItem.bind(st);
    st.setItem = (k: string, v: string) => {
      if (primeira) {
        primeira = false;
        throw new Error("QuotaExceededError");
      }
      setOriginal(k, v);
    };

    await getValor({ codigo: 335, mes: "julho/2026" }, "22", 8000, "2024-3");
    st.setItem = setOriginal;

    assert.ok(
      st.chaves().some((k) => k.includes("valor:335:22:8000:2024-3")),
      "o valor deveria ter sido gravado na segunda tentativa",
    );
    assert.ok(
      !st.chaves().some((k) => k.includes("valor:334:")),
      "a poda deveria ter removido a referência antiga",
    );
    assert.ok(st.chaves().length <= antes + 1);
  } finally {
    teardown();
  }
});

test("clearFipeLocalCache limpa v2 e o prefixo v1 aposentado", async () => {
  const st = setup();
  try {
    await getMarcas(335);
    st.setItem("navesa-mesa:fipe-cache-v1:valor:22:8000:2024-3", "{}");
    st.setItem("outra-app:preservar", "1");

    const removidas = clearFipeLocalCache();
    assert.equal(removidas, 2);
    assert.deepEqual(st.chaves(), ["outra-app:preservar"]);
  } finally {
    teardown();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 6) Formatação de mês
// ═══════════════════════════════════════════════════════════════════════════

test("mesmoMesReferencia concilia 'julho/2026' e 'julho de 2026'", () => {
  // `/referencias` usa barra; o endpoint de valor usa " de " e às vezes espaço.
  assert.equal(mesmoMesReferencia("julho/2026", "julho de 2026"), true);
  assert.equal(mesmoMesReferencia("julho/2026", " julho de 2026 "), true);
  assert.equal(mesmoMesReferencia("julho/2026", "junho de 2026"), false);
  assert.equal(mesmoMesReferencia("julho/2026", "julho de 2025"), false);
});

test("formatReferenciaCurta encurta pra exibição", () => {
  assert.equal(formatReferenciaCurta("julho/2026"), "jul/2026");
  assert.equal(formatReferenciaCurta("julho de 2026"), "jul/2026");
  assert.equal(formatReferenciaCurta("março/2026"), "mar/2026");
  assert.equal(formatReferenciaCurta("dezembro/2025"), "dez/2025");
  assert.equal(formatReferenciaCurta(null), null);
  // Mês irreconhecível não pode quebrar a UI.
  assert.equal(formatReferenciaCurta("bagunça/2026"), "bagunça/2026");
});

test("getReferencias devolve a lista parseada e ignora entradas malformadas", async () => {
  setup({
    referencias: [
      REF_JULHO,
      { Codigo: "334", Mes: "junho/2026" } as unknown as { Codigo: number; Mes: string },
      REF_MAIO,
    ],
  });
  try {
    const refs = await getReferencias();
    assert.deepEqual(
      refs.map((r) => r.codigo),
      [335, 333],
      "a entrada com Codigo string deveria ter sido descartada",
    );
  } finally {
    teardown();
  }
});

// ─── helpers de manipulação do cache nos testes ─────────────────────────────

/** Restaura só o fetch, preservando o storage (pra simular virada de mês). */
function teardownFetchApenas(): void {
  globalThis.fetch = fetchOriginal;
}

/** Força a expiração de uma entrada com TTL (usado pra `refs`). */
function expirarChave(st: MemStorage, chave: string): void {
  const k = `navesa-mesa:fipe-cache-v2:${chave}`;
  const raw = st.getItem(k);
  if (!raw) return;
  const parsed = JSON.parse(raw) as { v: unknown; exp: number | null };
  st.setItem(k, JSON.stringify({ v: parsed.v, exp: Date.now() - 1 }));
}
