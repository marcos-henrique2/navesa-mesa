/**
 * Testes de valoriza/bônus (campo "Valoriza"/"Bonus" do NBS) no sync Oracle
 * -> Supabase.
 *
 * Por que existe:
 *   O relatório "Vendas Usados Matriz" usava uma APROXIMAÇÃO ruim pro campo
 *   "Valoriza" (custo?.ganhos_indiretos, campo "Ganhos Indiretos" do NBS —
 *   27% de erro validado pelo Marcos). O valor CERTO vem de
 *   NBS.VEICULOS_CUSTOS_ESPECIFICOS (55,9 milhões de linhas), somado por
 *   chassi_resumido+loja atual pros CODIGO_CUSTO 620 ("Ford Valoriza") e 462
 *   ("Bonus CVP") — os únicos dois códigos usados pelo "programa de
 *   bônus/valoriza", que varia por loja. Validado com match exato: placa
 *   SCR3B78 (Bronco Sport Wildtrak, loja 2) = R$ 30.000, batendo com o
 *   "Bonus" do relatório oficial NBS pra esse carro. Ver scripts/sync-nbs/
 *   valoriza.ts (construirMapaValoriza/buscarValoriza são funções puras,
 *   testáveis sem Oracle — a query em si, sem JOIN por design de
 *   performance, só é exercitada contra o Oracle real em
 *   scripts/sync-nbs/index.ts).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { construirMapaValoriza, buscarValoriza, chaveValoriza } from "../scripts/sync-nbs/valoriza";
import { mapearVeiculo } from "../scripts/sync-nbs/mapear-veiculo";
import { mapearVenda } from "../scripts/sync-nbs/mapear-venda";

describe("construirMapaValoriza — agregação por chassi_resumido+cod_empresa", () => {
  it("soma múltiplas linhas do MESMO chassi+empresa (um código 620 + um 462 aplicáveis)", () => {
    const mapa = construirMapaValoriza([
      { chassiResumido: "ABC123", codEmpresa: 2, valorFinal: 20000 },
      { chassiResumido: "ABC123", codEmpresa: 2, valorFinal: 10000 },
    ]);
    assert.equal(mapa.get(chaveValoriza("ABC123", 2)), 30000);
  });

  it("mantém chaves separadas pro MESMO chassi em empresas diferentes", () => {
    const mapa = construirMapaValoriza([
      { chassiResumido: "ABC123", codEmpresa: 2, valorFinal: 30000 },
      { chassiResumido: "ABC123", codEmpresa: 9, valorFinal: 5000 },
    ]);
    assert.equal(mapa.get(chaveValoriza("ABC123", 2)), 30000);
    assert.equal(mapa.get(chaveValoriza("ABC123", 9)), 5000);
  });

  it("ignora linha sem chassi_resumido", () => {
    const mapa = construirMapaValoriza([{ chassiResumido: "", codEmpresa: 2, valorFinal: 30000 }]);
    assert.equal(mapa.size, 0);
  });

  it("lista vazia -> Map vazio", () => {
    const mapa = construirMapaValoriza([]);
    assert.equal(mapa.size, 0);
  });
});

describe("buscarValoriza — caso validado (SCR3B78, Bronco Sport Wildtrak, loja 2)", () => {
  it("SCR3B78 na loja 2 dá exatamente 30000 (match exato com o relatório oficial NBS)", () => {
    const mapa = construirMapaValoriza([{ chassiResumido: "SCR3B78", codEmpresa: 2, valorFinal: 30000 }]);
    assert.equal(buscarValoriza(mapa, "SCR3B78", 2), 30000);
  });
});

describe("buscarValoriza — regras gerais", () => {
  it("chassi+empresa sem linha no Map -> 0 (fato conhecido: sem bônus), nunca null/undefined", () => {
    const mapa = construirMapaValoriza([{ chassiResumido: "XYZ999", codEmpresa: 2, valorFinal: 15000 }]);
    assert.equal(buscarValoriza(mapa, "OUTRO_CHASSI", 2), 0);
  });

  it("mesmo chassi em loja diferente da que tem o custo lançado -> 0 (chave não bate)", () => {
    const mapa = construirMapaValoriza([{ chassiResumido: "XYZ999", codEmpresa: 2, valorFinal: 15000 }]);
    assert.equal(buscarValoriza(mapa, "XYZ999", 9), 0);
  });

  it("chassi_resumido ausente (null/undefined) -> 0, não lança erro", () => {
    const mapa = construirMapaValoriza([]);
    assert.equal(buscarValoriza(mapa, null, 2), 0);
    assert.equal(buscarValoriza(mapa, undefined, 2), 0);
  });

  it("cod_empresa ausente (null/undefined) -> 0, não lança erro", () => {
    const mapa = construirMapaValoriza([{ chassiResumido: "ABC", codEmpresa: 2, valorFinal: 100 }]);
    assert.equal(buscarValoriza(mapa, "ABC", null), 0);
    assert.equal(buscarValoriza(mapa, "ABC", undefined), 0);
  });

  it("Map vazio (loja sem programa de bônus, ex: 71-Renault/91-Geely) -> sempre 0", () => {
    const mapa = new Map<string, number>();
    assert.equal(buscarValoriza(mapa, "QUALQUER", 71), 0);
    assert.equal(buscarValoriza(mapa, "QUALQUER", 91), 0);
  });
});

describe("mapearVeiculo — valoriza via mapaValoriza (CHASSI_RESUMIDO + LOJA_ATUAL da row)", () => {
  it("row com CHASSI_RESUMIDO/LOJA_ATUAL presentes no Map -> valoriza preenchido", () => {
    const mapaValoriza = construirMapaValoriza([{ chassiResumido: "SCR3B78", codEmpresa: 2, valorFinal: 30000 }]);
    const { veiculo } = mapearVeiculo({ CHASSI_RESUMIDO: "SCR3B78", LOJA_ATUAL: 2 }, { mapaValoriza });
    assert.equal(veiculo.valoriza, 30000);
  });

  it("row sem entrada correspondente no Map -> valoriza 0 (não null)", () => {
    const mapaValoriza = construirMapaValoriza([{ chassiResumido: "OUTRO", codEmpresa: 2, valorFinal: 30000 }]);
    const { veiculo } = mapearVeiculo({ CHASSI_RESUMIDO: "SCR3B78", LOJA_ATUAL: 2 }, { mapaValoriza });
    assert.equal(veiculo.valoriza, 0);
  });

  it("sem mapaValoriza nos lookups (não fornecido) -> valoriza 0, não lança erro", () => {
    const { veiculo } = mapearVeiculo({ CHASSI_RESUMIDO: "SCR3B78", LOJA_ATUAL: 2 });
    assert.equal(veiculo.valoriza, 0);
  });

  it("valoriza nunca é reportado em camposSemFonte (é campo computado, não coluna direta)", () => {
    const { camposSemFonte } = mapearVeiculo({});
    assert.ok(!camposSemFonte.includes("valoriza"));
  });
});

describe("mapearVenda — valoriza via mapaValoriza (CHASSI_RESUMIDO + LOJA_ATUAL da row)", () => {
  it("row com CHASSI_RESUMIDO/LOJA_ATUAL presentes no Map -> valoriza preenchido", () => {
    const mapaValoriza = construirMapaValoriza([{ chassiResumido: "SCR3B78", codEmpresa: 2, valorFinal: 30000 }]);
    const { venda } = mapearVenda({ CHASSI_RESUMIDO: "SCR3B78", LOJA_ATUAL: 2 }, { mapaValoriza });
    assert.equal(venda.valoriza, 30000);
  });

  it("row sem entrada correspondente no Map -> valoriza 0 (não null)", () => {
    const mapaValoriza = construirMapaValoriza([{ chassiResumido: "OUTRO", codEmpresa: 2, valorFinal: 30000 }]);
    const { venda } = mapearVenda({ CHASSI_RESUMIDO: "SCR3B78", LOJA_ATUAL: 2 }, { mapaValoriza });
    assert.equal(venda.valoriza, 0);
  });

  it("sem lookups fornecidos -> valoriza 0, não lança erro", () => {
    const { venda } = mapearVenda({ CHASSI_RESUMIDO: "SCR3B78", LOJA_ATUAL: 2 });
    assert.equal(venda.valoriza, 0);
  });
});
