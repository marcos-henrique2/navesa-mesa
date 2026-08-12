/**
 * Testes de `hojeLocal` / `formatarDataBR` — o antídoto do bug de fuso.
 *
 * O bug original: `new Date().toISOString().slice(0,10)` devolve a data UTC. Em
 * Brasília (UTC−3), das 21h à meia-noite o UTC já virou o dia seguinte, então um
 * contato feito hoje às 22h era gravado como amanhã.
 *
 * Desde a Story 2.2 (Risco R2), `hojeLocal` NÃO usa mais o fuso do processo —
 * ela fixa `America/Sao_Paulo`. Por isso estes testes usam INSTANTES ABSOLUTOS
 * (`...Z`) em vez de `new Date(ano, mes, dia, hora)`: a asserção passa a valer
 * em qualquer fuso de execução, que é exatamente a propriedade que se quer
 * provar. O caso 21h–00h de Brasília é testado explicitamente, e há um teste
 * que roda a função num processo com `TZ=UTC` — o cenário da Vercel.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { formatarDataBR, hojeLocal } from "@/lib/utils/data-local";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Sonda executada em processo filho — ver o cabeçalho dela. */
const SONDA_TZ = join(__dirname, "_hoje-local-em-utc.ts");

describe("hojeLocal", () => {
  it("formata YYYY-MM-DD com zero à esquerda", () => {
    assert.equal(hojeLocal(new Date("2026-01-05T13:00:00Z")), "2026-01-05");
    assert.equal(hojeLocal(new Date("2026-12-31T13:00:00Z")), "2026-12-31");
  });

  it("às 22h de Brasília devolve o dia de Brasília, não o dia UTC", () => {
    // 2026-08-07T01:00Z é 06/08 às 22h em Brasília.
    // toISOString().slice(0,10) daria "2026-08-07" — o bug.
    assert.equal(hojeLocal(new Date("2026-08-07T01:00:00Z")), "2026-08-06");
  });

  it("às 00h30 de Brasília devolve o próprio dia", () => {
    assert.equal(hojeLocal(new Date("2026-08-06T03:30:00Z")), "2026-08-06");
  });

  it("vira o dia na meia-noite de BRASÍLIA (03:00Z), não na meia-noite UTC", () => {
    assert.equal(hojeLocal(new Date("2026-08-07T02:59:59Z")), "2026-08-06");
    assert.equal(hojeLocal(new Date("2026-08-07T03:00:00Z")), "2026-08-07");
    // Meia-noite UTC ainda é o dia anterior em Brasília.
    assert.equal(hojeLocal(new Date("2026-08-07T00:00:00Z")), "2026-08-06");
  });

  it("independe do fuso do processo: varre as 24h de um dia em UTC", () => {
    for (let h = 0; h < 24; h++) {
      const iso = `2026-08-06T${String(h).padStart(2, "0")}:00:00Z`;
      // Brasília é UTC−3 o ano todo (sem horário de verão desde 2019).
      const esperado = h < 3 ? "2026-08-05" : "2026-08-06";
      assert.equal(hojeLocal(new Date(iso)), esperado, `divergiu em ${iso}`);
    }
  });

  it("sem argumento usa a data de agora", () => {
    const agora = new Date();
    assert.equal(hojeLocal(), hojeLocal(agora));
    assert.match(hojeLocal(), /^\d{4}-\d{2}-\d{2}$/);
  });

  it("[R2] rodando com TZ=UTC ainda devolve o dia de Brasília", () => {
    // O cenário real: processo da Vercel em UTC. Antes do fix, 22h de Brasília
    // saía como o dia seguinte. Roda de verdade num processo filho com TZ=UTC —
    // o fuso do processo só dá pra fixar na largada do Node.
    //
    // A sonda é um ARQUIVO .ts, não `--eval`: o hook do tsx não engata no
    // contexto `[eval]` do Node 22 (a versão do CI) e o módulo volta vazio.
    const saida = execFileSync(
      process.execPath,
      ["--import", "tsx", SONDA_TZ, "2026-08-07T01:00:00Z"],
      { env: { ...process.env, TZ: "UTC" }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const [fusoDoProcesso, data] = saida.trim().split("|");

    // Sem esta primeira asserção o teste seria vazio num sistema que ignorasse
    // TZ: ele passaria sem nunca ter provado o cenário da Vercel.
    assert.equal(fusoDoProcesso, "UTC", "o processo filho precisava rodar em UTC");
    assert.equal(data, "2026-08-06");
  });
});

describe("formatarDataBR", () => {
  it("converte YYYY-MM-DD em DD/MM/AAAA", () => {
    assert.equal(formatarDataBR("2026-08-06"), "06/08/2026");
    assert.equal(formatarDataBR("2026-01-01"), "01/01/2026");
  });

  it("não desloca o dia (não passa por new Date)", () => {
    // new Date("2026-08-06") é meia-noite UTC → em UTC−3 formataria 05/08.
    assert.equal(formatarDataBR("2026-08-06"), "06/08/2026");
  });

  it("aceita timestamp e usa só a parte da data", () => {
    assert.equal(formatarDataBR("2026-08-06T23:10:00Z"), "06/08/2026");
  });

  it("entrada inválida ou nula vira —", () => {
    assert.equal(formatarDataBR(null), "—");
    assert.equal(formatarDataBR(undefined), "—");
    assert.equal(formatarDataBR(""), "—");
    assert.equal(formatarDataBR("06/08/2026"), "—");
  });
});
