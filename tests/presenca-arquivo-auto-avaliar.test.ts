/**
 * Testes do diff de PRESENÇA arquivo × sistema (Story 2.2, Fatia 3b).
 *
 * O cenário central é o REAL, medido em 2026-08-12 contra
 * `relatorio_VeiculosEmOferta (1).xls` (57 linhas: 55 MATRIZ + 1 CIAASA +
 * 1 AP DE GOIÂNIA) e os 60 repasses `subido` do sistema:
 *
 *   52 bateram · 6 sumiram do relatório · 2 estão no arquivo, mas em OUTRA LOJA
 *
 * As duas de outra loja (`SCV9H90` em Aparecida, `SDL6I80` na CIAASA) são o
 * ponto inteiro deste arquivo de teste: elas estão anunciadas, e chamá-las de
 * "saiu do anúncio" é afirmação falsa que leva a uma ação DESTRUTIVA (remover).
 *
 * `node --import tsx --test tests/*.test.ts`
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  diffPresencaNoArquivo,
  placasVistasNoArquivo,
  STATUS_ATIVOS_NO_ANUNCIO,
  type RepasseRefPresenca,
} from "@/lib/repasses/presenca-arquivo-auto-avaliar";

// ─── Cenário real (2026-08-12) ───────────────────────────────────────────────

/** As 6 que realmente sumiram do relatório. */
const SUMIRAM_DE_VERDADE = ["MWY1B38", "PRD2189", "RBM3C09", "RCF9D56", "RCM2I99", "RPX0H57"];

/** Estão NO arquivo, mas sob outra loja — o filtro do cliente as retira do payload. */
const OUTRA_LOJA = ["SCV9H90", "SDL6I80"];

/** Amostra das que bateram (MATRIZ ∩ sistema). */
const BATERAM = ["QKF2016", "RTA5F41", "SBX7J12", "SDQ4A88"];

/** No arquivo como anunciado, mas `vendido` no sistema — o caso inverso. */
const REAPARECEU = "SCW0G80";

function repasse(
  placa: string,
  status: string,
  extra: Partial<RepasseRefPresenca> = {},
): RepasseRefPresenca {
  return {
    id: Math.abs([...placa].reduce((h, c) => h * 31 + c.charCodeAt(0), 7)) % 100000,
    chassi: `CHASSI-${placa}`,
    placa,
    modelo: `MODELO ${placa}`,
    status,
    valor_compra_repasse: 100000,
    valor_minimo: 110000,
    valor_compre_por: 120000,
    ...extra,
  };
}

/** Linhas da MATRIZ do arquivo: as que bateram + a que voltou depois de vendida. */
const LINHAS_MATRIZ = [...BATERAM, REAPARECEU].map((placa_norm) => ({ placa_norm }));
/** Linhas de outra loja, retidas no cliente. */
const LINHAS_OUTRA_LOJA = OUTRA_LOJA.map((placa_norm) => ({ placa_norm }));

/** Os repasses `subido` do sistema: bateram + sumiram + as duas de outra loja. */
const REPASSES_SUBIDO = [...BATERAM, ...SUMIRAM_DE_VERDADE, ...OUTRA_LOJA].map((p) =>
  repasse(p, "subido"),
);

const placas = (itens: ReadonlyArray<RepasseRefPresenca>) => itens.map((r) => r.placa).sort();

// ─── placasVistasNoArquivo ───────────────────────────────────────────────────

describe("placasVistasNoArquivo", () => {
  it("une loja alvo e outras lojas no mesmo conjunto", () => {
    const vistas = placasVistasNoArquivo(LINHAS_MATRIZ, LINHAS_OUTRA_LOJA);
    assert.equal(vistas.size, LINHAS_MATRIZ.length + LINHAS_OUTRA_LOJA.length);
    for (const p of [...BATERAM, REAPARECEU, ...OUTRA_LOJA]) {
      assert.ok(vistas.has(p), `${p} deveria estar no universo`);
    }
  });

  it("nenhuma das placas que sumiram entra no universo", () => {
    const vistas = placasVistasNoArquivo(LINHAS_MATRIZ, LINHAS_OUTRA_LOJA);
    for (const p of SUMIRAM_DE_VERDADE) assert.ok(!vistas.has(p), `${p} não deveria estar`);
  });

  it("placa vazia não entra — não prova presença de carro nenhum", () => {
    const vistas = placasVistasNoArquivo([{ placa_norm: "" }, { placa_norm: "ABC1D23" }], [
      { placa_norm: "" },
    ]);
    assert.deepEqual([...vistas], ["ABC1D23"]);
  });

  it("deduplica placa que aparece nas duas listas", () => {
    const vistas = placasVistasNoArquivo([{ placa_norm: "ABC1D23" }], [{ placa_norm: "ABC1D23" }]);
    assert.equal(vistas.size, 1);
  });
});

// ─── A armadilha: universo = arquivo INTEIRO, não só a loja alvo ─────────────

describe("diffPresencaNoArquivo — regra do universo de placas (caso real)", () => {
  it("com o arquivo inteiro, dá exatamente as 6 que sumiram", () => {
    const vistas = placasVistasNoArquivo(LINHAS_MATRIZ, LINHAS_OUTRA_LOJA);
    const { sumiram } = diffPresencaNoArquivo(REPASSES_SUBIDO, vistas);

    assert.equal(sumiram.length, 6);
    assert.deepEqual(placas(sumiram), [...SUMIRAM_DE_VERDADE].sort());
  });

  it("SCV9H90 e SDL6I80 NÃO são acusadas de ter saído — estão no arquivo, em outra loja", () => {
    const vistas = placasVistasNoArquivo(LINHAS_MATRIZ, LINHAS_OUTRA_LOJA);
    const { sumiram } = diffPresencaNoArquivo(REPASSES_SUBIDO, vistas);

    for (const p of OUTRA_LOJA) {
      assert.ok(!placas(sumiram).includes(p), `${p} não pode aparecer como sumido`);
    }
  });

  it("REGRESSÃO: comparar só contra a MATRIZ produz 8 — dois falsos positivos", () => {
    // Este é o bug que o módulo existe pra impedir. Se algum dia o universo
    // voltar a ser só a loja alvo, o teste acima quebra e este documenta o porquê.
    const soMatriz = placasVistasNoArquivo(LINHAS_MATRIZ, []);
    const { sumiram } = diffPresencaNoArquivo(REPASSES_SUBIDO, soMatriz);

    assert.equal(sumiram.length, 8);
    assert.deepEqual(placas(sumiram), [...SUMIRAM_DE_VERDADE, ...OUTRA_LOJA].sort());
  });

  it("tolera formato de placa diferente entre banco e arquivo (hífen, minúscula)", () => {
    const vistas = placasVistasNoArquivo([{ placa_norm: "SCV9H90" }], []);
    const { sumiram } = diffPresencaNoArquivo([repasse("scv-9h90", "subido")], vistas);
    assert.equal(sumiram.length, 0);
  });
});

// ─── Status ──────────────────────────────────────────────────────────────────

describe("diffPresencaNoArquivo — status", () => {
  const vistas = placasVistasNoArquivo(LINHAS_MATRIZ, LINHAS_OUTRA_LOJA);

  it("`marcado` conta como ativo no anúncio, igual a `subido`", () => {
    const { sumiram } = diffPresencaNoArquivo([repasse("MWY1B38", "marcado")], vistas);
    assert.deepEqual(placas(sumiram), ["MWY1B38"]);
    assert.deepEqual([...STATUS_ATIVOS_NO_ANUNCIO].sort(), ["marcado", "subido"]);
  });

  it("`nao_vendido` e `cancelado` ficam fora dos três grupos", () => {
    const d = diffPresencaNoArquivo(
      [repasse("MWY1B38", "nao_vendido"), repasse("PRD2189", "cancelado")],
      vistas,
    );
    assert.deepEqual(d.sumiram, []);
    assert.deepEqual(d.reapareceram, []);
    assert.deepEqual(d.sem_placa_comparavel, []);
  });

  it("`vendido` que sumiu do arquivo não vira nada — já estava fechado", () => {
    const d = diffPresencaNoArquivo([repasse("MWY1B38", "vendido")], vistas);
    assert.deepEqual(d.sumiram, []);
    assert.deepEqual(d.reapareceram, []);
  });
});

// ─── Caso inverso: SCW0G80 ───────────────────────────────────────────────────

describe("diffPresencaNoArquivo — vendido que voltou a aparecer (SCW0G80)", () => {
  const vistas = placasVistasNoArquivo(LINHAS_MATRIZ, LINHAS_OUTRA_LOJA);

  it("cai em `reapareceram`, não em `sumiram`", () => {
    const d = diffPresencaNoArquivo(
      [...REPASSES_SUBIDO, repasse(REAPARECEU, "vendido")],
      vistas,
    );
    assert.deepEqual(placas(d.reapareceram), [REAPARECEU]);
    assert.equal(d.sumiram.length, 6);
    assert.ok(!placas(d.sumiram).includes(REAPARECEU));
  });

  it("um vendido de OUTRA loja também conta como reaparecido — está anunciado", () => {
    const d = diffPresencaNoArquivo([repasse("SDL6I80", "vendido")], vistas);
    assert.deepEqual(placas(d.reapareceram), ["SDL6I80"]);
  });
});

// ─── Placa não comparável ────────────────────────────────────────────────────

describe("diffPresencaNoArquivo — placa ilegível", () => {
  const vistas = placasVistasNoArquivo(LINHAS_MATRIZ, LINHAS_OUTRA_LOJA);

  it("ativo sem placa não vira falso positivo de 'sumiu'", () => {
    const d = diffPresencaNoArquivo(
      [repasse("", "subido", { id: 9001 }), repasse("   ", "marcado", { id: 9002 })],
      vistas,
    );
    assert.deepEqual(d.sumiram, []);
    assert.deepEqual(
      d.sem_placa_comparavel.map((r) => r.id),
      [9001, 9002],
    );
  });

  it("vendido sem placa é simplesmente ignorado", () => {
    const d = diffPresencaNoArquivo([repasse("", "vendido")], vistas);
    assert.deepEqual(d.sumiram, []);
    assert.deepEqual(d.reapareceram, []);
    assert.deepEqual(d.sem_placa_comparavel, []);
  });
});

// ─── Estabilidade ────────────────────────────────────────────────────────────

describe("diffPresencaNoArquivo — ordem e pureza", () => {
  const vistas = placasVistasNoArquivo(LINHAS_MATRIZ, LINHAS_OUTRA_LOJA);

  it("ordena por placa, independente da ordem de entrada", () => {
    const embaralhado = [...REPASSES_SUBIDO].reverse();
    const a = diffPresencaNoArquivo(REPASSES_SUBIDO, vistas).sumiram.map((r) => r.placa);
    const b = diffPresencaNoArquivo(embaralhado, vistas).sumiram.map((r) => r.placa);
    assert.deepEqual(a, b);
    assert.deepEqual(a, [...SUMIRAM_DE_VERDADE].sort());
  });

  it("não muta a lista recebida", () => {
    const entrada = [...REPASSES_SUBIDO];
    const copia = entrada.map((r) => r.placa);
    diffPresencaNoArquivo(entrada, vistas);
    assert.deepEqual(
      entrada.map((r) => r.placa),
      copia,
    );
  });

  it("arquivo vazio: todo ativo sumiu (e nada quebra)", () => {
    const { sumiram } = diffPresencaNoArquivo(REPASSES_SUBIDO, new Set<string>());
    assert.equal(sumiram.length, REPASSES_SUBIDO.length);
  });

  it("sistema vazio: nenhum grupo", () => {
    const d = diffPresencaNoArquivo([], vistas);
    assert.deepEqual(d, { sumiram: [], reapareceram: [], sem_placa_comparavel: [] });
  });
});
