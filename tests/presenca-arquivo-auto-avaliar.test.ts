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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseAutoAvaliarOfertasXls } from "@/lib/parsers/auto-avaliar-ofertas-xls";
import {
  diffPresencaNoArquivo,
  LIMITE_SUSPEITA_ARQUIVO_PARCIAL,
  pareceArquivoParcial,
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

// ─── A FIAÇÃO: parser real → universo ────────────────────────────────────────

/**
 * Os testes acima protegem o MÓDULO. Este protege o CALL SITE.
 *
 * A regra do universo pode ser invertida sem encostar em
 * `presenca-arquivo-auto-avaliar.ts`: basta alguém "simplificar" o
 * `UploadDropzone` pra `placasVistasNoArquivo(parse.linhas, [])`. Sem este
 * teste, a mutação mais provável na vida real passa verde.
 *
 * Roda o parser DE VERDADE contra a fixture e afirma o invariante que o call
 * site precisa manter: o universo cobre TODAS as linhas parseadas.
 */
describe("universo a partir do parser real (fixture)", () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const bytes = readFileSync(join(__dirname, "fixtures", "veiculos-em-oferta-sample.html"));
  const parse = parseAutoAvaliarOfertasXls(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    "veiculos-em-oferta-sample.html",
  );

  it("o universo cobre matriz + outra loja, sem sobra nem falta", () => {
    assert.ok(parse.ok, "fixture deveria parsear");
    const universo = placasVistasNoArquivo(parse.linhas, parse.outra_loja);

    // 8 da Matriz + 2 de outra loja = 10 linhas, 10 placas no universo.
    assert.equal(parse.linhas.length, 8);
    assert.equal(parse.outra_loja.length, 2);
    assert.equal(universo.size, 10);

    for (const l of [...parse.linhas, ...parse.outra_loja]) {
      assert.ok(universo.has(l.placa_norm), `${l.placa_norm} tinha que estar no universo`);
    }
  });

  it("nenhum carro de outra loja da fixture é acusado de ter sumido", () => {
    assert.ok(parse.ok, "fixture deveria parsear");
    const universo = placasVistasNoArquivo(parse.linhas, parse.outra_loja);
    // Todo carro do arquivo existe no sistema como `subido` — cenário do sync feliz.
    const banco = [...parse.linhas, ...parse.outra_loja].map((l) => repasse(l.placa_norm, "subido"));

    assert.deepEqual(diffPresencaNoArquivo(banco, universo).sumiram, []);

    // Contraprova: esquecer o segundo argumento faz as 2 de outra loja sumirem.
    const soMatriz = placasVistasNoArquivo(parse.linhas, []);
    assert.equal(diffPresencaNoArquivo(banco, soMatriz).sumiram.length, 2);
  });
});

// ─── Guarda de arquivo parcial ───────────────────────────────────────────────

describe("pareceArquivoParcial", () => {
  const vistas = placasVistasNoArquivo(LINHAS_MATRIZ, LINHAS_OUTRA_LOJA);

  /** N ativos, dos quais `sumidos` não estão no arquivo. */
  function cenario(presentes: number, sumidos: number) {
    const ativos = [
      ...BATERAM.slice(0, presentes).map((p) => repasse(p, "subido")),
      ...Array.from({ length: sumidos }, (_, i) => repasse(`FORA${i}A00`, "subido")),
    ];
    return diffPresencaNoArquivo(ativos, vistas);
  }

  it("conta os ativos comparáveis como denominador", () => {
    const d = cenario(4, 2);
    assert.equal(d.total_ativos_comparaveis, 6);
    assert.equal(d.sumiram.length, 2);
  });

  it("ativo sem placa não infla o denominador", () => {
    const d = diffPresencaNoArquivo(
      [repasse("QKF2016", "subido"), repasse("", "subido", { id: 1 })],
      vistas,
    );
    assert.equal(d.total_ativos_comparaveis, 1);
  });

  it("proporção normal (2 de 6, 33%… acima do limite) dispara", () => {
    // 2/6 = 0,333 > 0,30 → dispara. O limite é fração, não contagem.
    assert.ok(LIMITE_SUSPEITA_ARQUIVO_PARCIAL === 0.3);
    assert.equal(pareceArquivoParcial(cenario(4, 2)), true);
  });

  it("1 de 6 (17%) não dispara", () => {
    assert.equal(pareceArquivoParcial(cenario(5, 1)), false);
  });

  it("nada sumiu: não dispara nem com sistema vazio", () => {
    assert.equal(pareceArquivoParcial(cenario(4, 0)), false);
    assert.equal(pareceArquivoParcial(diffPresencaNoArquivo([], vistas)), false);
  });

  it("arquivo vazio (download quebrado): dispara", () => {
    const d = diffPresencaNoArquivo(REPASSES_SUBIDO, new Set<string>());
    assert.equal(pareceArquivoParcial(d), true);
  });

  it("o caso real de 6 sumidos em 60 ativos NÃO dispara — é leitura plausível", () => {
    // 6/60 = 10%. A guarda existe pra download quebrado, não pra dia movimentado.
    const presentes = Array.from({ length: 54 }, (_, i) => `OK${String(i).padStart(2, "0")}A00`);
    const universo = new Set(presentes);
    const banco = [
      ...presentes.map((p) => repasse(p, "subido")),
      ...SUMIRAM_DE_VERDADE.map((p) => repasse(p, "subido")),
    ];
    const d = diffPresencaNoArquivo(banco, universo);
    assert.equal(d.sumiram.length, 6);
    assert.equal(d.total_ativos_comparaveis, 60);
    assert.equal(pareceArquivoParcial(d), false);
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
    assert.deepEqual(d, {
      sumiram: [],
      reapareceram: [],
      sem_placa_comparavel: [],
      total_ativos_comparaveis: 0,
    });
  });
});
