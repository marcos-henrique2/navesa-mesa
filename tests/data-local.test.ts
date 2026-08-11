/**
 * Testes de `hojeLocal` / `formatarDataBR` — o antídoto do bug de fuso.
 *
 * O bug original: `new Date().toISOString().slice(0,10)` devolve a data UTC. Em
 * Brasília (UTC−3), das 21h à meia-noite o UTC já virou o dia seguinte, então um
 * contato feito hoje às 22h era gravado como amanhã.
 *
 * Os testes usam Date com hora local explícita (`new Date(ano, mes, dia, hora)`),
 * que é o mesmo construtor que o navegador do usuário usaria. O caso 21h/22h só
 * DIVERGE do UTC quando a suíte roda em fuso negativo; a asserção que vale em
 * qualquer fuso é: hojeLocal SEMPRE concorda com getFullYear/getMonth/getDate.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatarDataBR, hojeLocal } from "@/lib/utils/data-local";

describe("hojeLocal", () => {
  it("formata YYYY-MM-DD com zero à esquerda", () => {
    assert.equal(hojeLocal(new Date(2026, 0, 5, 10, 0, 0)), "2026-01-05");
    assert.equal(hojeLocal(new Date(2026, 11, 31, 10, 0, 0)), "2026-12-31");
  });

  it("às 22h locais devolve o dia LOCAL, não o dia seguinte", () => {
    // Em UTC−3 isso é 2026-08-07T01:00Z — toISOString().slice(0,10) daria "07".
    const d = new Date(2026, 7, 6, 22, 30, 0);
    assert.equal(hojeLocal(d), "2026-08-06");
  });

  it("às 00h30 locais devolve o próprio dia", () => {
    assert.equal(hojeLocal(new Date(2026, 7, 6, 0, 30, 0)), "2026-08-06");
  });

  it("concorda com getFullYear/getMonth/getDate em qualquer hora do dia", () => {
    // Varre as 24 horas: hojeLocal nunca pode discordar do calendário local.
    for (let h = 0; h < 24; h++) {
      const d = new Date(2026, 7, 6, h, 0, 0);
      const esperado = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate(),
      ).padStart(2, "0")}`;
      assert.equal(hojeLocal(d), esperado, `divergiu às ${h}h`);
    }
  });

  it("vira o dia corretamente na virada da meia-noite local", () => {
    assert.equal(hojeLocal(new Date(2026, 7, 6, 23, 59, 59)), "2026-08-06");
    assert.equal(hojeLocal(new Date(2026, 7, 7, 0, 0, 0)), "2026-08-07");
  });

  it("sem argumento usa a data de agora", () => {
    const agora = new Date();
    assert.equal(hojeLocal(), hojeLocal(agora));
    assert.match(hojeLocal(), /^\d{4}-\d{2}-\d{2}$/);
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
