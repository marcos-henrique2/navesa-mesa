import { test } from "node:test";
import assert from "node:assert/strict";
import { classificarVeiculo, contarPorModelo } from "@/lib/pricing/classificacao";
import { veiculo } from "./_mocks";

const ANO_REF = 2026;

test("classe A: <=2 anos e <=15.000 km/ano, em pátio comercial", () => {
  const v = veiculo({ ano_modelo: 2025, km: 10000, dias_patio: 5, patio: "AEROPORTO" });
  const c = classificarVeiculo(v, { anoReferencia: ANO_REF });
  assert.equal(c.classe, "A");
  assert.equal(c.canal, "showroom");
});

test("classe B: <=25.000 km/ano", () => {
  // 2023, ~22k km/ano (3 anos, 66k km) → B
  const v = veiculo({ ano_modelo: 2023, km: 66000, dias_patio: 5 });
  const c = classificarVeiculo(v, { anoReferencia: ANO_REF });
  assert.equal(c.classe, "B");
  assert.equal(c.canal, "showroom");
});

test("classe C: <=40.000 km/ano", () => {
  // 2024, 70k km em 2 anos = 35k/ano → C
  const v = veiculo({ ano_modelo: 2024, km: 70000, dias_patio: 5 });
  const c = classificarVeiculo(v, { anoReferencia: ANO_REF });
  assert.equal(c.classe, "C");
  assert.equal(c.canal, "repasse");
});

test("classe D obrigatória: >40.000 km/ano", () => {
  // 2024, 100k km em 2 anos = 50k/ano → D
  const v = veiculo({ ano_modelo: 2024, km: 100000, dias_patio: 5 });
  const c = classificarVeiculo(v, { anoReferencia: ANO_REF });
  assert.equal(c.classe, "D");
  assert.equal(c.canal, "repasse");
});

test(">30 dias de pátio força repasse (mesmo sendo classe A)", () => {
  const v = veiculo({ ano_modelo: 2025, km: 10000, dias_patio: 95 });
  const c = classificarVeiculo(v, { anoReferencia: ANO_REF });
  assert.equal(c.classe, "A"); // classe não muda
  assert.equal(c.canal, "repasse"); // mas canal vira repasse
  assert.equal(c.rebaixadoPorEstoque, true);
});

test(">=5 do mesmo modelo no estoque força repasse", () => {
  const contagem = new Map<string, number>([["MODELO TESTE", 6]]);
  const v = veiculo({ ano_modelo: 2025, km: 10000, dias_patio: 5, modelo: "MODELO TESTE" });
  const c = classificarVeiculo(v, { anoReferencia: ANO_REF, contagemPorModelo: contagem });
  assert.equal(c.canal, "repasse");
  assert.equal(c.rebaixadoPorEstoque, true);
});

test("cautelar reprovado força classe E", () => {
  const v = veiculo({ ano_modelo: 2025, km: 5000, dias_patio: 2 });
  const c = classificarVeiculo(v, { anoReferencia: ANO_REF, cautelar: "reprovado" });
  assert.equal(c.classe, "E");
  assert.equal(c.canal, "repasse");
});

test("cautelar com restrição desce 1 classe (A -> B)", () => {
  const v = veiculo({ ano_modelo: 2025, km: 10000, dias_patio: 5 });
  const c = classificarVeiculo(v, { anoReferencia: ANO_REF, cautelar: "com_restricao" });
  assert.equal(c.classe, "B");
});

test("cautelar aprovado não muda a classe automática", () => {
  const v = veiculo({ ano_modelo: 2025, km: 10000, dias_patio: 5 });
  const semCautelar = classificarVeiculo(v, { anoReferencia: ANO_REF });
  const comAprovado = classificarVeiculo(v, { anoReferencia: ANO_REF, cautelar: "aprovado" });
  assert.equal(comAprovado.classe, semCautelar.classe);
});

test("contarPorModelo agrupa por modelo normalizado", () => {
  const vs = [
    veiculo({ modelo: "Ranger XLS" }),
    veiculo({ modelo: "RANGER XLS" }),
    veiculo({ modelo: "Compass" }),
  ];
  const m = contarPorModelo(vs);
  assert.equal(m.get("RANGER XLS"), 2);
  assert.equal(m.get("COMPASS"), 1);
});
