/**
 * Testes do parser PURO do export do Auto Avaliar (Story 2.1 / Fatia 2).
 *
 * Cobre a fixture real (6 carros multi-linha) + casos de borda: header
 * reordenado, "+Gastos" presente/ausente, bloco de médias com 2/3 linhas,
 * placa inválida, valor "R$ 0,00" → 0, header não reconhecido.
 * Centavo-perfect (parseValorBR) em todos os valores monetários.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseAutoAvaliar, type RegistroAA } from "@/lib/repasses/parse-auto-avaliar";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(join(__dirname, "fixtures", "auto-avaliar-sample.txt"), "utf8");
const FIXTURE_REAL = readFileSync(join(__dirname, "fixtures", "aa_real_validacao.txt"), "utf8");

function porPlaca(regs: RegistroAA[], norm: string): RegistroAA {
  const r = regs.find((x) => x.placa_norm === norm);
  assert.ok(r, `registro ${norm} não encontrado`);
  return r;
}

describe("parseAutoAvaliar — fixture real (6 carros multi-linha)", () => {
  const { registros, avisos } = parseAutoAvaliar(FIXTURE);

  it("reconhece os 6 registros", () => {
    assert.equal(registros.length, 6);
  });

  it("carro 1 (RBU6F30): placa, ano, km, compra sem gastos, min/compre, médias AA/F/W", () => {
    const r = porPlaca(registros, "RBU6F30");
    assert.equal(r.placa_norm, "RBU6F30");
    assert.equal(r.ano_modelo, 2021);
    assert.equal(r.km, 260739);
    assert.equal(r.valor_compra, 93000);
    assert.equal(r.gastos, 0);
    assert.equal(r.minimo, 104000);
    assert.equal(r.compre_por, 109000);
    assert.equal(r.media_aa, 112112.88);
    assert.equal(r.media_fipe, 137945);
    assert.equal(r.media_web, 139990);
    assert.equal(r.cor, "Cinza");
    assert.equal(r.status_aa, "Em oferta");
    assert.equal(r.data_validade, "2026-08-03");
    assert.match(r.modelo ?? "", /RANGER/);
  });

  it("carro 2 (RCC3C32): '+ Gastos' separa compra e gastos; Web 'R$ 0,00' → 0", () => {
    const r = porPlaca(registros, "RCC3C32");
    assert.equal(r.valor_compra, 210000);
    assert.equal(r.gastos, 2000);
    assert.equal(r.minimo, 218000);
    assert.equal(r.compre_por, 222000);
    assert.equal(r.media_aa, 233621.12);
    assert.equal(r.media_fipe, 236172);
    assert.equal(r.media_web, 0); // "R$ 0,00 W"
  });

  it("carro 5 (TIU1F38): compra com centavos; média AA 'R$ 0,00' → 0", () => {
    const r = porPlaca(registros, "TIU1F38");
    assert.equal(r.valor_compra, 248991.47);
    assert.equal(r.gastos, 0);
    assert.equal(r.minimo, 260000);
    assert.equal(r.compre_por, 266000);
    assert.equal(r.media_aa, 0);
    assert.equal(r.media_fipe, 310073);
    assert.equal(r.media_web, 0);
  });

  it("todos os registros têm placa normalizada válida", () => {
    for (const r of registros) {
      assert.match(r.placa_norm, /^[A-Z]{3}\d[A-Z0-9]\d{2}$/);
    }
  });

  it("fixture bem-formada não gera avisos", () => {
    assert.equal(avisos.length, 0);
  });
});

describe("parseAutoAvaliar — export REAL (25 carros, header multi-linha)", () => {
  const { registros, avisos } = parseAutoAvaliar(FIXTURE_REAL);

  it("parseia os 25 registros mesmo com header quebrado em 3 linhas físicas", () => {
    assert.equal(registros.length, 25);
  });

  it("não gera aviso FATAL de header não reconhecido", () => {
    assert.ok(!avisos.some((a) => a.codigo === "header_nao_reconhecido"));
  });

  it("RBU6F30 — compra/mínimo/compre + médias AA/F/W centavo-perfect", () => {
    const r = porPlaca(registros, "RBU6F30");
    assert.equal(r.valor_compra, 93000);
    assert.equal(r.minimo, 104000);
    assert.equal(r.compre_por, 109000);
    assert.equal(r.media_aa, 112112.88);
    assert.equal(r.media_fipe, 137945);
    assert.equal(r.media_web, 139990);
  });

  it("QTQ5E00 — Média Web 'R$ 0,00' → 0", () => {
    assert.equal(porPlaca(registros, "QTQ5E00").media_web, 0);
  });

  it("TIU1F38 — Média AA 'R$ 0,00' → 0", () => {
    assert.equal(porPlaca(registros, "TIU1F38").media_aa, 0);
  });

  it("PMK6A00 — caso prejuízo (compre_por < compra)", () => {
    const r = porPlaca(registros, "PMK6A00");
    assert.equal(r.valor_compra, 86100);
    assert.equal(r.minimo, 79990);
    assert.equal(r.compre_por, 85990);
  });

  it("todas as placas normalizadas são válidas", () => {
    for (const r of registros) {
      assert.match(r.placa_norm, /^[A-Z]{3}\d[A-Z0-9]\d{2}$/);
    }
  });
});

describe("parseAutoAvaliar — header", () => {
  it("header reordenado ainda mapeia por rótulo (não por posição)", () => {
    const texto = [
      "Status\tVeículos\tData Validade\tR$ Compra\tR$ Mínimo / Compre por\tAnunciante\tMédia_Fipe/Web",
      "NAVESA - GO/MATRIZ (Goiania/GO)",
      "Em oferta\tRBU6F30 RANGER XLS Cinza Ano Mod.2021 km: 260739\t03/08/2026\t93.000,00\t104.000,00 / 109.000,00\tR$ 112.112,88 AA",
      "R$ 137.945,00 F",
      "R$ 139.990,00 W",
    ].join("\n");
    const { registros, avisos } = parseAutoAvaliar(texto);
    assert.equal(registros.length, 1);
    assert.equal(registros[0].valor_compra, 93000);
    assert.equal(registros[0].minimo, 104000);
    assert.equal(registros[0].media_aa, 112112.88);
    assert.equal(avisos.length, 0);
  });

  it("sem header reconhecível → aviso fatal + registros vazios", () => {
    const texto = "linha qualquer\noutra linha\n";
    const { registros, avisos } = parseAutoAvaliar(texto);
    assert.equal(registros.length, 0);
    assert.equal(avisos.length, 1);
    assert.equal(avisos[0].codigo, "header_nao_reconhecido");
  });

  it("header sem coluna essencial → coluna_ausente + header_nao_reconhecido (fatal)", () => {
    // Falta "Veículos", "Compra", "Mínimo", "Média" → mas casa /anunciante/+/ve.../ pra
    // ser detectado como header? não: sem "Veículos" nem é detectado. Uso um header com
    // Anunciante+Veículos mas sem Compra/Mínimo/Média.
    const texto = [
      "Anunciante\tVeículos\tStatus",
      "NAVESA - GO/MATRIZ (Goiania/GO)\tCarro",
      "Em oferta\tRBU6F30 RANGER Cinza Ano Mod.2021 km: 100000",
    ].join("\n");
    const { registros, avisos } = parseAutoAvaliar(texto);
    assert.equal(registros.length, 0);
    assert.ok(avisos.some((a) => a.codigo === "coluna_ausente"));
    assert.ok(avisos.some((a) => a.codigo === "header_nao_reconhecido"));
  });
});

describe("parseAutoAvaliar — casos de borda", () => {
  const HEADER =
    "Anunciante\tTipo\tVisualizações\tAvaliações\tAutoBid\tStatus\tVeículos\tData Validade\tR$ Compra\tR$ Mínimo / Compre por\tMédia_Fipe/Web";

  function registro(veiculo: string, compra: string, medias: string[]): string {
    return [
      HEADER,
      "NAVESA - GO/MATRIZ (Goiania/GO)\tCarro",
      "5",
      `0\tNão\tEm oferta\t${veiculo}\t03/08/2026\t${compra}\t100.000,00 / 105.000,00\t${medias[0]}`,
      ...medias.slice(1),
    ].join("\n");
  }

  it("bloco de médias com só 2 linhas → aviso bloco_medias_incompleto e web null", () => {
    const texto = registro("RBU6F30 RANGER Cinza Ano Mod.2021 km: 100000", "90.000,00", [
      "R$ 100.000,00 AA",
      "R$ 110.000,00 F",
    ]);
    const { registros, avisos } = parseAutoAvaliar(texto);
    assert.equal(registros.length, 1);
    assert.equal(registros[0].media_aa, 100000);
    assert.equal(registros[0].media_fipe, 110000);
    assert.equal(registros[0].media_web, null);
    assert.ok(avisos.some((a) => a.codigo === "bloco_medias_incompleto"));
  });

  it("placa inválida → descarta o registro + aviso placa_invalida", () => {
    const texto = registro("XX RANGER Cinza Ano Mod.2021 km: 100000", "90.000,00", [
      "R$ 100.000,00 AA",
      "R$ 110.000,00 F",
      "R$ 120.000,00 W",
    ]);
    const { registros, avisos } = parseAutoAvaliar(texto);
    assert.equal(registros.length, 0);
    assert.ok(avisos.some((a) => a.codigo === "placa_invalida"));
  });

  it("compra 'R$ 0,00' → 0 (não null)", () => {
    const texto = registro("RBU6F30 RANGER Cinza Ano Mod.2021 km: 100000", "R$ 0,00", [
      "R$ 100.000,00 AA",
      "R$ 110.000,00 F",
      "R$ 120.000,00 W",
    ]);
    const { registros } = parseAutoAvaliar(texto);
    assert.equal(registros[0].valor_compra, 0);
  });

  it("sem 'Ano Mod.' → aviso ano_ausente (mas registro sobrevive via placa válida)", () => {
    const texto = registro("RBU6F30 RANGER Cinza km: 100000", "90.000,00", [
      "R$ 100.000,00 AA",
      "R$ 110.000,00 F",
      "R$ 120.000,00 W",
    ]);
    const { registros, avisos } = parseAutoAvaliar(texto);
    assert.equal(registros.length, 1);
    assert.equal(registros[0].ano_modelo, null);
    assert.ok(avisos.some((a) => a.codigo === "ano_ausente"));
  });

  it("texto vazio → sem registros, sem avisos", () => {
    const r = parseAutoAvaliar("");
    assert.deepEqual(r, { registros: [], avisos: [] });
  });
});
