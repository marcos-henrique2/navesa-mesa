/**
 * Testes do parser do `relatorio_VeiculosEmOferta.xls` — Story 2.2 (Fatia 3a).
 *
 * A fixture é OFUSCADA: placas e valores são inventados. O arquivo real do
 * Marcos tem placa e valor de compra de verdade e não vai pro repo. Por isso
 * toda contagem asserida vem de `N_FIXTURE` / `N_MATRIZ` / `N_OUTRA_LOJA`,
 * declaradas aqui ao lado da fixture, nunca dos números do arquivo real (AC1).
 *
 * A fixture preserva a estrutura do original: HTML disfarçado de `.xls`, o
 * preâmbulo `xmlns:o=...office`, a ordem das 15 colunas, entidade HTML no
 * cabeçalho (`Vers&atilde;o`) convivendo com UTF-8 cru no corpo
 * (`AUTOMÁTICO`) — que é como o Auto Avaliar exporta de verdade —, o formato
 * numérico pt-BR (`251.800,00`), os `0,00` e as células vazias onde eles
 * existem, uma linha de cada loja (incluindo `AP DE GOIÂNIA`, com acento), uma
 * placa com hífen, uma linha com `Valor Compra = 0,00` (AC13c) e uma linha com
 * célula ilegível.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  parseAutoAvaliarOfertasXls,
  montarPayloadSyncArquivo,
  mensagemErroArquivo,
  MAX_LINHAS_ARQUIVO,
  type LinhaOfertaAA,
  type OfertasParseOk,
} from "@/lib/parsers/auto-avaliar-ofertas-xls";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Linhas de dados da fixture (todas as lojas). */
const N_FIXTURE = 10;
/** Linhas da loja alvo (`NAVESA - GO/MATRIZ`) — as únicas que viram payload. */
const N_MATRIZ = 8;
/** Linhas retidas no cliente por serem de outra loja. */
const N_OUTRA_LOJA = 2;

/**
 * Placa que NÃO está na fixture de propósito. O relatório é um retrato móvel —
 * entre dois downloads, carro entra e sai. Um repasse que existe no sistema e
 * sumiu do arquivo não pode virar alteração nem exclusão: o parser
 * simplesmente não fala sobre ele (AC17).
 */
const PLACA_FORA_DO_ARQUIVO = "ZZZ9Z99";

const NOME_ARQUIVO = "relatorio_VeiculosEmOferta.xls";
const CAMINHO_FIXTURE = join(__dirname, "fixtures", "veiculos-em-oferta-sample.html");
const FIXTURE_TEXTO = readFileSync(CAMINHO_FIXTURE, "utf8");

/** Bytes UTF-8, como o `ImportarPorArquivo` entrega via `file.arrayBuffer()`. */
function fixtureBytes(): ArrayBuffer {
  const buf = readFileSync(CAMINHO_FIXTURE);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function ok(entrada: ArrayBuffer | Uint8Array | string): OfertasParseOk {
  const r = parseAutoAvaliarOfertasXls(entrada, NOME_ARQUIVO);
  assert.ok(r.ok, `esperava sucesso, veio ${r.ok ? "" : r.erro.codigo}`);
  return r;
}

function porPlaca(linhas: LinhaOfertaAA[], norm: string): LinhaOfertaAA {
  const l = linhas.find((x) => x.placa_norm === norm);
  assert.ok(l, `linha ${norm} não encontrada`);
  return l;
}

/** Monta uma tabela HTML igual à do Auto Avaliar, para casos de borda. */
function tabela(header: string[], linhas: string[][]): string {
  const tr = (cels: string[], tag: string) =>
    `<tr>${cels.map((c) => `<${tag}>${c}</${tag}>`).join("")}</tr>`;
  return `<html><head><meta charset="utf-8"></head><body><table border="1">${tr(
    header,
    "th",
  )}${linhas.map((l) => tr(l, "td")).join("")}</table></body></html>`;
}

const HEADER_COMPLETO = [
  "Loja",
  "Placa",
  "Marca",
  "Modelo",
  "Versão",
  "Ano Fab.",
  "Ano Mod.",
  "Qtde Anuncios",
  "Valor Compra",
  "Valor Anunciado",
  "Valor ComprePor",
  "Vlr Maior Oferta",
  "Vlr Ref. Web",
  "Vlr Ref. FIPE",
  "Vlr Ref. AutoAvaliar",
];

/** Índices das colunas em `HEADER_COMPLETO`, para os overrides dos casos de borda. */
const C = {
  loja: 0,
  placa: 1,
  qtde: 7,
  compra: 8,
  anunciado: 9,
  comprepor: 10,
  oferta: 11,
  web: 12,
  fipe: 13,
} as const;

function linhaMatriz(placa: string, sobrescreve: Record<number, string> = {}): string[] {
  const base = [
    "NAVESA - GO/MATRIZ",
    placa,
    "CHEVROLET",
    "ONIX",
    "1.0 LT",
    "2020",
    "2021",
    "3",
    "50.000,00",
    "55.000,00",
    "58.000,00",
    "49.000,00",
    "56.000,00",
    "57.000,00",
    "54.000,00",
  ];
  for (const [i, v] of Object.entries(sobrescreve)) base[Number(i)] = v;
  return base;
}

// ─── AC1 / AC2 — leitura e mapeamento ────────────────────────────────────────

describe("parseAutoAvaliarOfertasXls — leitura da fixture (AC1)", () => {
  it("lê o .xls HTML-disfarçado a partir de bytes UTF-8 e devolve N_FIXTURE linhas", () => {
    const r = ok(fixtureBytes());
    assert.equal(r.meta.total_linhas, N_FIXTURE);
    assert.equal(r.meta.total_loja_alvo, N_MATRIZ);
    assert.equal(r.meta.total_outra_loja, N_OUTRA_LOJA);
    assert.equal(r.linhas.length, N_MATRIZ);
    assert.equal(r.outra_loja.length, N_OUTRA_LOJA);
  });

  it("carimba o nome do arquivo na meta, como os parsers do NBS", () => {
    assert.equal(ok(fixtureBytes()).meta.arquivo_nome, NOME_ARQUIVO);
  });

  it("aceita string e bytes com o mesmo resultado", () => {
    const porTexto = ok(FIXTURE_TEXTO);
    const porBytes = ok(fixtureBytes());
    assert.deepEqual(porTexto.linhas, porBytes.linhas);
    assert.deepEqual(porTexto.outra_loja, porBytes.outra_loja);
  });

  it("nenhuma linha some: total = loja alvo + outra loja", () => {
    const r = ok(fixtureBytes());
    assert.equal(r.meta.total_linhas, r.linhas.length + r.outra_loja.length);
  });

  it("reporta o nº da linha física do arquivo (1-based, cabeçalho incluso)", () => {
    const r = ok(fixtureBytes());
    assert.equal(porPlaca(r.linhas, "ABC1D23").linha, 2);
    assert.deepEqual(
      [...r.linhas, ...r.outra_loja].map((l) => l.linha).sort((a, b) => a - b),
      [2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    );
  });

  it("mapeia por NOME de coluna, não por posição (AC2)", () => {
    // Mesmas colunas, ordem invertida: os valores têm que cair nos mesmos campos.
    const idx = HEADER_COMPLETO.map((_, i) => HEADER_COMPLETO.length - 1 - i);
    const header = idx.map((i) => HEADER_COMPLETO[i]);
    const linha = idx.map((i) => linhaMatriz("ABC1D23")[i]);
    const l = porPlaca(ok(tabela(header, [linha])).linhas, "ABC1D23");
    assert.equal(l.valor_compra_repasse, 50000);
    assert.equal(l.valor_minimo, 55000);
    assert.equal(l.valor_compre_por, 58000);
    assert.equal(l.valor_maior_oferta, 49000);
    assert.equal(l.valor_web, 56000);
    assert.equal(l.valor_fipe, 57000);
    assert.equal(l.valor_auto_avaliar, 54000);
    assert.equal(l.qtde_anuncios, 3);
  });

  it("cabeçalho casa sem acento, sem pontuação e em caixa diferente (AC2)", () => {
    const header = [
      " loja ",
      "PLACA",
      "marca",
      "modelo",
      "Versao",
      "ANO FAB",
      "ano mod",
      "QTDE ANUNCIOS",
      "valor compra",
      "VALOR ANUNCIADO",
      "Valor Compre Por",
      "VLR MAIOR OFERTA",
      "vlr ref web",
      "Vlr Ref FIPE",
      "vlr ref auto avaliar",
    ];
    const r = ok(tabela(header, [linhaMatriz("ABC1D23")]));
    assert.equal(porPlaca(r.linhas, "ABC1D23").valor_fipe, 57000);
  });

  it("resolve entidade HTML no cabeçalho — `Vers&atilde;o` não pode perder a coluna", () => {
    // O exportador escapa o cabeçalho e deixa o corpo em UTF-8 cru. Sem
    // desescapar, "Versão" nunca casaria e a coluna sumiria em silêncio.
    const r = ok(fixtureBytes());
    assert.equal(porPlaca(r.linhas, "ABC1D23").versao, "1.0 12V FLEX LT MANUAL");
  });

  it("resolve entidade HTML no corpo, maiúscula inclusive", () => {
    const r = ok(fixtureBytes());
    // `AUTOM&Aacute;TICO` na fixture
    assert.equal(porPlaca(r.linhas, "DEF4G56").versao, "2.0 16V FLEX XEI AUTOMÁTICO");
    // `GOI&Acirc;NIA` na fixture
    assert.ok(r.meta.lojas_encontradas.includes("NAVESA - GO/AP DE GOIÂNIA"));
  });
});

// ─── Mapeamento das 8 colunas de valor ───────────────────────────────────────

describe("mapeamento coluna → campo (evidência da story)", () => {
  const r = ok(fixtureBytes());

  it("as 8 colunas caem nos 8 campos, centavo-perfect", () => {
    const l = porPlaca(r.linhas, "EFG5H67");
    assert.equal(l.valor_compra_repasse, 152000); // Valor Compra
    assert.equal(l.valor_minimo, 161900); // Valor Anunciado
    assert.equal(l.valor_compre_por, 168900); // Valor ComprePor
    assert.equal(l.valor_fipe, 167940); // Vlr Ref. FIPE
    assert.equal(l.valor_web, 165300); // Vlr Ref. Web
    assert.equal(l.valor_auto_avaliar, 158220.1); // Vlr Ref. AutoAvaliar
    assert.equal(l.valor_maior_oferta, 149000); // Vlr Maior Oferta
    assert.equal(l.qtde_anuncios, 3); // Qtde Anuncios
  });

  it("`251.800,00` não vira 251 — a armadilha do raw:true do SheetJS", () => {
    const l = porPlaca(ok(tabela(HEADER_COMPLETO, [linhaMatriz("ABC1D23", {
      [C.compra]: "240.000,00",
      [C.anunciado]: "251.800,00",
    })])).linhas, "ABC1D23");
    assert.equal(l.valor_compra_repasse, 240000);
    assert.equal(l.valor_minimo, 251800);
  });

  it("centavos sobrevivem ao parse pt-BR", () => {
    assert.equal(porPlaca(r.linhas, "BCD2E34").valor_fipe, 49870.55);
    assert.equal(porPlaca(r.linhas, "DEF4G56").valor_auto_avaliar, 121450.33);
    assert.equal(porPlaca(r.linhas, "EFG5H67").valor_auto_avaliar, 158220.1);
  });

  it("nenhum valor sai com mais de 2 casas decimais (round 2 do §4.1)", () => {
    for (const l of r.linhas) {
      for (const v of [
        l.valor_compra_repasse,
        l.valor_minimo,
        l.valor_compre_por,
        l.valor_fipe,
        l.valor_web,
        l.valor_auto_avaliar,
        l.valor_maior_oferta,
      ]) {
        if (v === null) continue;
        assert.equal(v, Math.round(v * 100) / 100, `${l.placa_norm}: ${v} tem artefato de float`);
      }
    }
  });

  it("também lê texto e ano das colunas descritivas", () => {
    const l = porPlaca(r.linhas, "EFG5H67");
    assert.equal(l.marca, "FORD");
    assert.equal(l.modelo, "RANGER");
    assert.equal(l.versao, "3.2 20V DIESEL XLT 4X4 AUTOMÁTICO");
    assert.equal(l.ano_fabricacao, 2018);
    assert.equal(l.ano_modelo, 2019);
  });
});

// ─── AC3 — zero é ausência, menos em Qtde Anuncios ───────────────────────────

describe("semântica do zero (AC3)", () => {
  const r = ok(fixtureBytes());

  it("dinheiro `0,00` vira null, nunca 0 — senão o COALESCE do banco apagaria dado bom", () => {
    const l = porPlaca(r.linhas, "ABC1D23");
    assert.equal(l.valor_web, null); // "0,00"
    assert.equal(l.valor_auto_avaliar, null); // "0,00"
    // e o que veio preenchido continua preenchido
    assert.equal(l.valor_compra_repasse, 68000);
  });

  it("célula de dinheiro vazia vira null", () => {
    const l = porPlaca(r.linhas, "JKL0N12");
    assert.equal(l.valor_maior_oferta, null);
    assert.equal(l.valor_web, null);
    assert.equal(l.valor_auto_avaliar, null);
    assert.equal(l.valor_fipe, 78550);
  });

  it("`Qtde Anuncios = 0` é ZERO REAL, não ausência", () => {
    const l = porPlaca(r.linhas, "DEF4G56");
    assert.equal(l.qtde_anuncios, 0);
    assert.notEqual(l.qtde_anuncios, null);
  });

  it("`Qtde Anuncios` ilegível, vazia ou negativa vira null (não vira 0)", () => {
    const r2 = ok(
      tabela(HEADER_COMPLETO, [
        linhaMatriz("AAA1A11", { [C.qtde]: "" }),
        linhaMatriz("BBB2B22", { [C.qtde]: "-3" }),
        linhaMatriz("CCC3C33", { [C.qtde]: "muitos" }),
      ]),
    );
    for (const p of ["AAA1A11", "BBB2B22", "CCC3C33"]) {
      assert.equal(porPlaca(r2.linhas, p).qtde_anuncios, null, p);
    }
  });

  /**
   * AC13c — o gatilho da guarda mora AQUI, no parser, não na RPC.
   *
   * `aa_arq_zero_explicito` (029:157-167) só dispara quando a célula chega como
   * JSON number `0`. Se o parser colapsar `0,00 → null`, `jsonb_typeof('null')`
   * não é `'number'`, a guarda fica falsa, e a linha sincroniza todo o resto em
   * silêncio num campo que decide margem. Não se perde dado (o COALESCE
   * protege) — perde-se o AVISO.
   *
   * Verificado contra produção com o preview `STABLE` (nada gravado), mesma
   * placa nos dois payloads:
   *   `"valor_compra_repasse": null` → ignoradas 0 · com_alteracao 1 (3 campos)
   *   `"valor_compra_repasse": 0`    → ignoradas 1 · com_alteracao 0
   */
  it("`Valor Compra = 0,00` PRESERVA o zero — é o gatilho da guarda da RPC (AC13c)", () => {
    const l = porPlaca(r.linhas, "CDE3F45");
    assert.equal(l.valor_compra_repasse, 0);
    assert.notEqual(l.valor_compra_repasse, null);
  });

  it("o zero de `Valor Compra` chega à RPC como JSON number 0, não como null", () => {
    const l = porPlaca(r.linhas, "CDE3F45");
    const item = montarPayloadSyncArquivo(r.linhas).linhas.find((x) => x.linha === l.linha);
    assert.ok(item, "a linha tem que continuar no payload");
    assert.equal(item.valor_compra_repasse, 0);
    assert.equal(typeof item.valor_compra_repasse, "number");
    // O que a RPC realmente recebe depois do JSON.stringify do supabase-js:
    // `null` aqui desarmaria a guarda em silêncio.
    const round = JSON.parse(JSON.stringify(item)) as Record<string, unknown>;
    assert.equal(round.valor_compra_repasse, 0);
    assert.equal(typeof round.valor_compra_repasse, "number");
  });

  it("a exceção do zero vale SÓ pra `Valor Compra` — os outros valores continuam null", () => {
    const r2 = ok(
      tabela(HEADER_COMPLETO, [
        linhaMatriz("AAA1A11", {
          [C.compra]: "0,00",
          [C.anunciado]: "0,00",
          [C.comprepor]: "0,00",
          [C.oferta]: "0,00",
          [C.web]: "R$ 0,00",
          [C.fipe]: "0,00",
          14: "0,00", // Vlr Ref. AutoAvaliar
        }),
      ]),
    );
    const l = porPlaca(r2.linhas, "AAA1A11");
    assert.equal(l.valor_compra_repasse, 0);
    for (const campo of [
      "valor_minimo",
      "valor_compre_por",
      "valor_maior_oferta",
      "valor_web",
      "valor_fipe",
      "valor_auto_avaliar",
    ] as const) {
      assert.equal(l[campo], null, campo);
    }
  });

  it("célula vazia / ilegível em `Valor Compra` continua null (só o 0,00 explícito vira 0)", () => {
    const r2 = ok(
      tabela(HEADER_COMPLETO, [
        linhaMatriz("AAA1A11", { [C.compra]: "" }),
        linhaMatriz("BBB2B22", { [C.compra]: "-" }),
        linhaMatriz("CCC3C33", { [C.compra]: "N/A" }),
      ]),
    );
    for (const p of ["AAA1A11", "BBB2B22", "CCC3C33"]) {
      assert.equal(porPlaca(r2.linhas, p).valor_compra_repasse, null, p);
    }
  });
});

// ─── Robustez: célula ilegível não derruba o lote ────────────────────────────

describe("célula ilegível não derruba o lote", () => {
  const r = ok(fixtureBytes());

  it("`-` e `N/A` viram null; `R$ 88.000` é lido; a linha sobrevive inteira", () => {
    const l = porPlaca(r.linhas, "FGH6J78");
    assert.equal(l.valor_web, null); // "-"
    assert.equal(l.valor_fipe, null); // "N/A"
    assert.equal(l.valor_maior_oferta, 88000); // "R$ 88.000"
    assert.equal(l.valor_compra_repasse, 92000);
    assert.equal(l.qtde_anuncios, 5);
  });

  it("as outras linhas do arquivo continuam todas lá", () => {
    assert.equal(r.linhas.length, N_MATRIZ);
  });

  it("lixo em qualquer coluna de dinheiro nunca lança nem contamina o lote", () => {
    const lixos = ["R$", "abc", "1.2.3,4,5", "12e10", "-500,00", "  ", "#VALOR!"];
    const linhas = lixos.map((v, i) =>
      linhaMatriz(`ZZ${i}Z${i}${i}${i}`, { [C.fipe]: v, [C.oferta]: v }),
    );
    const r2 = ok(tabela(HEADER_COMPLETO, linhas));
    assert.equal(r2.linhas.length, lixos.length);
    for (const l of r2.linhas) {
      assert.equal(l.valor_fipe, null);
      assert.equal(l.valor_maior_oferta, null);
      assert.equal(l.valor_compra_repasse, 50000, "as demais colunas continuam corretas");
    }
  });
});

// ─── AC5 — filtro de loja ────────────────────────────────────────────────────

describe("filtro de loja (AC5)", () => {
  const r = ok(fixtureBytes());

  it("só `NAVESA - GO/MATRIZ` entra no payload", () => {
    const payload = montarPayloadSyncArquivo(r.linhas);
    assert.equal(payload.linhas.length, N_MATRIZ);
    for (const l of r.linhas) assert.equal(l.loja, "NAVESA - GO/MATRIZ");
  });

  it("outra loja é retida no cliente com placa, modelo e nome da loja", () => {
    const ciaasa = r.outra_loja.find((l) => l.placa_norm === "GHI7K89");
    assert.ok(ciaasa);
    assert.equal(ciaasa.loja, "NAVESA - GO/CIAASA");
    assert.equal(ciaasa.modelo, "COMPASS");
  });

  it("o acento de `AP DE GOIÂNIA` sobrevive e a loja é reconhecida", () => {
    const ap = r.outra_loja.find((l) => l.placa_norm === "HIJ8L90");
    assert.ok(ap);
    assert.equal(ap.loja, "NAVESA - GO/AP DE GOIÂNIA");
  });

  it("nenhuma placa de outra loja aparece no payload", () => {
    const payload = montarPayloadSyncArquivo(r.linhas);
    const linhasPayload = new Set(payload.linhas.map((l) => l.linha));
    for (const o of r.outra_loja) assert.equal(linhasPayload.has(o.linha), false, o.placa_norm);
    const serializado = JSON.stringify(payload);
    for (const o of r.outra_loja) assert.equal(serializado.includes(o.placa_norm), false);
  });

  it("comparação de loja é acento/caixa/espaço-insensível (R3)", () => {
    const variantes = ["navesa - go/matriz", "NAVESA  -  GO/MATRIZ ", "Navesa - Go/Matriz"];
    const r2 = ok(
      tabela(
        HEADER_COMPLETO,
        variantes.map((loja, i) => linhaMatriz(`AAA${i}A${i}${i}`, { [C.loja]: loja })),
      ),
    );
    assert.equal(r2.linhas.length, variantes.length);
    assert.equal(r2.outra_loja.length, 0);
  });

  it("quando o filtro zera, `lojas_encontradas` permite o preview gritar (R3)", () => {
    const r2 = ok(tabela(HEADER_COMPLETO, [linhaMatriz("AAA1A11", { [C.loja]: "NAVESA MATRIZ" })]));
    assert.equal(r2.linhas.length, 0);
    assert.equal(r2.outra_loja.length, 1);
    assert.deepEqual(r2.meta.lojas_encontradas, ["NAVESA MATRIZ"]);
  });
});

// ─── AC6 — placa ─────────────────────────────────────────────────────────────

describe("placa (AC6)", () => {
  it("normaliza com a mesma expressão do índice do banco", () => {
    const l = porPlaca(ok(fixtureBytes()).linhas, "EFG5H67");
    assert.equal(l.placa_raw, "EFG-5H67");
    assert.equal(l.placa_norm, "EFG5H67");
  });

  it("hífen, espaço, ponto e minúscula convergem para a mesma forma", () => {
    const r = ok(
      tabela(HEADER_COMPLETO, [
        linhaMatriz("abc-1d23"),
        linhaMatriz(" ABC 1D23 "),
        linhaMatriz("ABC.1D23"),
      ]),
    );
    assert.deepEqual(
      r.linhas.map((l) => l.placa_norm),
      ["ABC1D23", "ABC1D23", "ABC1D23"],
    );
  });

  it("o payload manda a placa CRUA — quem normaliza é a RPC (§3.2)", () => {
    const payload = montarPayloadSyncArquivo(ok(fixtureBytes()).linhas);
    assert.ok(
      payload.linhas.some((l) => l.placa === "EFG-5H67"),
      "placa crua deveria chegar ao payload",
    );
  });
});

// ─── AC17 — ausência não é afirmação ─────────────────────────────────────────

describe("repasse que sumiu do arquivo (AC17)", () => {
  it("o parser não fala sobre placa ausente — nem como alteração, nem como ignorada", () => {
    // O relatório é um retrato móvel: entre dois downloads reais, 6 placas
    // saíram e 1 entrou. Quem está no banco e não está no arquivo não pode
    // aparecer em lugar nenhum da saída.
    const r = ok(fixtureBytes());
    const todas = [...r.linhas.map((l) => l.placa_norm), ...r.outra_loja.map((l) => l.placa_norm)];
    assert.equal(todas.includes(PLACA_FORA_DO_ARQUIVO), false);
    const payload = montarPayloadSyncArquivo(r.linhas);
    assert.equal(JSON.stringify(payload).includes(PLACA_FORA_DO_ARQUIVO), false);
  });
});

// ─── AC4 — erros tipados ─────────────────────────────────────────────────────

describe("erros fatais tipados (AC4)", () => {
  it("ARQUIVO_ILEGIVEL — nada legível", () => {
    for (const entrada of ["", "   \n  ", new Uint8Array(0)]) {
      const r = parseAutoAvaliarOfertasXls(entrada, NOME_ARQUIVO);
      assert.equal(r.ok, false);
      assert.equal(r.ok === false && r.erro.codigo, "ARQUIVO_ILEGIVEL");
    }
  });

  it("COLUNA_OBRIGATORIA_AUSENTE — nomeia a coluna que faltou", () => {
    for (const remover of ["Loja", "Placa", "Valor Compra", "Valor Anunciado", "Valor ComprePor"]) {
      const i = HEADER_COMPLETO.indexOf(remover);
      const header = HEADER_COMPLETO.filter((_, k) => k !== i);
      const linha = linhaMatriz("ABC1D23").filter((_, k) => k !== i);
      const r = parseAutoAvaliarOfertasXls(tabela(header, [linha]), NOME_ARQUIVO);
      assert.equal(r.ok, false, `sem ${remover} deveria falhar`);
      assert.equal(r.ok === false && r.erro.codigo, "COLUNA_OBRIGATORIA_AUSENTE");
      assert.equal(r.ok === false && r.erro.coluna, remover);
    }
  });

  it("COLUNA_OBRIGATORIA_AUSENTE — arquivo que não é o relatório", () => {
    const r = parseAutoAvaliarOfertasXls("isso aqui nao e o relatorio de veiculos", NOME_ARQUIVO);
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.erro.codigo, "COLUNA_OBRIGATORIA_AUSENTE");
  });

  it("ARQUIVO_SEM_LINHAS — cabeçalho válido, zero veículos", () => {
    const r = parseAutoAvaliarOfertasXls(tabela(HEADER_COMPLETO, []), NOME_ARQUIVO);
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.erro.codigo, "ARQUIVO_SEM_LINHAS");
  });

  it("ARQUIVO_GRANDE_DEMAIS — acima do teto, com a contagem no erro", () => {
    const linhas = Array.from({ length: MAX_LINHAS_ARQUIVO + 1 }, (_, i) =>
      linhaMatriz(`A${String(i).padStart(4, "0")}`),
    );
    const r = parseAutoAvaliarOfertasXls(tabela(HEADER_COMPLETO, linhas), NOME_ARQUIVO);
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.erro.codigo, "ARQUIVO_GRANDE_DEMAIS");
    assert.equal(r.ok === false && r.erro.linhas, MAX_LINHAS_ARQUIVO + 1);
  });

  it("exatamente no teto ainda passa", () => {
    const linhas = Array.from({ length: MAX_LINHAS_ARQUIVO }, (_, i) =>
      linhaMatriz(`A${String(i).padStart(4, "0")}`),
    );
    assert.equal(ok(tabela(HEADER_COMPLETO, linhas)).meta.total_linhas, MAX_LINHAS_ARQUIVO);
  });

  it("mensagem pt-BR preenche os buracos do rótulo", () => {
    assert.match(
      mensagemErroArquivo({ codigo: "COLUNA_OBRIGATORIA_AUSENTE", coluna: "Valor ComprePor" }),
      /«Valor ComprePor»/,
    );
    assert.match(mensagemErroArquivo({ codigo: "ARQUIVO_GRANDE_DEMAIS", linhas: 3000 }), /3000/);
    assert.match(mensagemErroArquivo({ codigo: "ARQUIVO_SEM_LINHAS" }), /vazio/i);
    assert.match(mensagemErroArquivo({ codigo: "ARQUIVO_ILEGIVEL" }), /Auto Avaliar/);
  });
});

// ─── §3 — payload ────────────────────────────────────────────────────────────

describe("montarPayloadSyncArquivo (§3)", () => {
  const r = ok(fixtureBytes());
  const payload = montarPayloadSyncArquivo(r.linhas);

  it("carimba versão e origem", () => {
    assert.equal(payload.versao, 1);
    assert.equal(payload.origem, "arquivo_xls");
  });

  it("superfície mínima: só as 9 chaves do contrato", () => {
    for (const item of payload.linhas) {
      assert.deepEqual(Object.keys(item).sort(), [
        "linha",
        "placa",
        "qtde_anuncios",
        "valor_auto_avaliar",
        "valor_compra_repasse",
        "valor_compre_por",
        "valor_fipe",
        "valor_maior_oferta",
        "valor_minimo",
        "valor_web",
      ]);
    }
  });

  it("não vaza loja, marca, modelo nem versão pro banco", () => {
    const serializado = JSON.stringify(payload);
    assert.equal(serializado.includes("NAVESA"), false);
    assert.equal(serializado.includes("CHEVROLET"), false);
    assert.equal(serializado.includes("ONIX"), false);
  });

  it("campo não observado vai como null explícito (chave ausente ≡ null, §3.3)", () => {
    const item = payload.linhas.find((l) => l.placa === "JKL0N12");
    assert.ok(item);
    assert.equal(item.valor_web, null);
    assert.equal(item.valor_fipe, 78550);
  });
});
