/**
 * Testes de cor_externa (filtro "Cor") no sync Oracle -> Supabase.
 *
 * Por que existe:
 *   A tela /veiculos mostrava o filtro de Cor cheio de código numérico cru
 *   do Oracle (ex: "103", "14575", "151662") em vez de nome legível. Causa
 *   raiz: NBS.VEICULOS.COR_EXTERNA só tem código numérico — não existe
 *   tabela de lookup "nome da cor" acessível no schema Oracle usado por esse
 *   sync (usuário `comissao`, ALL_TABLES LIKE '%COR%' vazio). Solução: mapa
 *   estático MAPA_COR, construído cruzando um export manual real do estoque
 *   (coluna "Cor Externa", em texto) com os COR_EXTERNA correspondentes no
 *   Oracle pros mesmos veículos (por placa) — bateu 1.089 de 1.132 veículos
 *   (96%), 30 códigos distintos, validado em 30/09/2026. Mesmo padrão de
 *   MAPA_PATIO (ver sync-nbs-patio.test.ts). Ver mapear-veiculo.ts.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapearVenda, mapearVendas } from "../scripts/sync-nbs/mapear-venda";
import { normalizarCorNbs } from "@/lib/cores-nbs";
import { mapearVeiculo, mapearVeiculos, MAPA_COR } from "../scripts/sync-nbs/mapear-veiculo";

// Tabela documentada no pedido do fix (30/09/2026) — cruzamento manual x
// Oracle, validado 96% de match. Comparar contra MAPA_COR evita erro de
// digitação na hora de copiar pro código.
const MAPA_COR_DOCUMENTADO: Record<string, string> = {
  "888": "BRANCO",
  "151662": "PRETO",
  "80": "PRATA",
  "14575": "CINZA",
  "1549197195": "CINZA",
  "8246719": "CINZA",
  "89": "AZUL",
  "84": "VERMELHO",
  "66988": "VERDE",
  "151672": "MARROM",
  "79": "PRETO C/ TETO PRATA",
  "85": "CINZA STING GRAY",
  "94": "DOURADO",
  "67008": "LARANJA",
  "81": "BRANCO POLAR",
  "310": "PRATA",
  "90": "AMARELO",
  "21": "BRANCO ÁRTICO",
  "103": "BRANCA CRISTAL",
  "1549197207": "PRATA",
  "87": "BEGE",
  "88": "PRETA",
  "8246846": "PRETO",
  "8246813": "PRATA",
  "8246731": "AMARELO",
  "1549493807": "CINZA",
  "8246635": "PRATA",
  "8246714": "PRETO",
  "1549543543": "PRETO",
  "151663": "PRATA",
};

describe("mapearVeiculo — cor_externa via MAPA_COR", () => {
  it("MAPA_COR bate exatamente com a tabela documentada (sem erro de digitação)", () => {
    assert.deepEqual(MAPA_COR, MAPA_COR_DOCUMENTADO);
  });

  it("COR_EXTERNA mapeado -> cor_externa com nome legível", () => {
    const { veiculo } = mapearVeiculo({ COR_EXTERNA: 888 });
    assert.equal(veiculo.cor_externa, "BRANCO");
  });

  it("COR_EXTERNA mapeado (código diferente, string) -> cor_externa com nome legível", () => {
    const { veiculo } = mapearVeiculo({ COR_EXTERNA: "151662" });
    assert.equal(veiculo.cor_externa, "PRETO");
  });

  it("COR_EXTERNA desconhecido -> fallback com código cru + warning", () => {
    const { veiculo, camposSemFonte } = mapearVeiculo({ COR_EXTERNA: 999 });
    assert.equal(veiculo.cor_externa, "Cor 999 (não mapeada)");
    assert.ok(camposSemFonte.includes("cor_nao_mapeada:999"));
    assert.ok(!camposSemFonte.includes("cor_externa"));
  });

  it("COR_EXTERNA ausente -> cor_externa null, reportado como campo sem fonte (mesmo comportamento antigo)", () => {
    const { veiculo, camposSemFonte } = mapearVeiculo({});
    assert.equal(veiculo.cor_externa, null);
    assert.ok(camposSemFonte.includes("cor_externa"));
  });

  it("mapearVeiculos agrega warning de código não mapeado com contagem de veículos", () => {
    const { warnings } = mapearVeiculos([{ COR_EXTERNA: 999 }, { COR_EXTERNA: 999 }, { COR_EXTERNA: 777 }]);
    assert.ok(warnings.some((w) => w.includes("Código de cor 999 não mapeado (2 veículo(s))")));
    assert.ok(warnings.some((w) => w.includes("Código de cor 777 não mapeado (1 veículo(s))")));
  });
});


describe("cores de estoque e vendas — códigos Oracle e descrições", () => {
  it("traduz todos os códigos conhecidos também nas vendas, como número e string", () => {
    for (const [codigo, nome] of Object.entries(MAPA_COR_DOCUMENTADO)) {
      assert.equal(mapearVenda({ COR_EXTERNA: Number(codigo) }).venda.cor_externa, nome);
      assert.equal(mapearVenda({ COR_EXTERNA: ` ${codigo} ` }).venda.cor_externa, nome);
    }
  });

  it("preserva descrições textuais sem gerar alerta de código desconhecido", () => {
    for (const mapear of [mapearVeiculo, mapearVenda]) {
      const resultado = mapear({ COR_EXTERNA: " azul metálico " });
      const registro = "veiculo" in resultado ? resultado.veiculo : resultado.venda;
      assert.equal(registro.cor_externa, "AZUL METÁLICO");
      assert.ok(!resultado.camposSemFonte.some((campo) => campo.startsWith("cor_nao_mapeada:")));
    }
  });

  it("não inventa nome para código desconhecido e agrega o alerta das vendas", () => {
    const { vendas, warnings } = mapearVendas([{ COR_EXTERNA: 1549275505 }, { COR_EXTERNA: "1549275505" }]);
    assert.deepEqual(vendas.map((v) => v.cor_externa), ["Cor 1549275505 (não mapeada)", "Cor 1549275505 (não mapeada)"]);
    assert.ok(warnings.some((w) => w.includes("Código de cor 1549275505 não mapeado (2 venda(s))")));
    assert.equal(normalizarCorNbs("1549275505"), null);
  });

  it("mantém valores ausentes como null, incluindo string em branco", () => {
    for (const valor of [null, undefined, "", "   "]) {
      assert.equal(normalizarCorNbs(valor), null);
      assert.equal(mapearVenda({ COR_EXTERNA: valor }).venda.cor_externa, null);
      assert.equal(mapearVeiculo({ COR_EXTERNA: valor }).veiculo.cor_externa, null);
    }
  });
});
