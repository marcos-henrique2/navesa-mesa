/**
 * Testes de patio (Localização) no sync Oracle -> Supabase.
 *
 * Por que existe:
 *   A tela /veiculos mostrava o filtro de Pátio cheio de código numérico cru
 *   do Oracle (ex: "152", "17") em vez de nome legível. Causa raiz:
 *   NBS.VEICULOS só tem COD_PATIO (numérico) — não existe tabela de lookup
 *   "nome do pátio" acessível no schema Oracle usado por esse sync (usuário
 *   `comissao`). Solução: mapa estático MAPA_PATIO, construído cruzando um
 *   export manual real do estoque (com nome em texto) com os COD_PATIO
 *   correspondentes no Oracle pros mesmos veículos (por placa) — bateu 1.090
 *   de 1.133 veículos (96%), validado em 30/09/2026. Ver mapear-veiculo.ts.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapearVeiculo, mapearVeiculos, MAPA_PATIO } from "../scripts/sync-nbs/mapear-veiculo";

// Tabela documentada no pedido do fix (30/09/2026) — cruzamento manual x
// Oracle, validado 96% de match. Comparar contra MAPA_PATIO evita erro de
// digitação na hora de copiar pro código.
const MAPA_PATIO_DOCUMENTADO: Record<string, string> = {
  "5": "AEROPORTO",
  "11": "TRÂNSITO (LOCAL)",
  "17": "CIAASA",
  "21": "ANÁPOLIS",
  "57": "POLARIS",
  "69": "APARECIDA DE GOIÂNIA",
  "76": "T-63",
  "152": "PREPARAÇÃO",
  "159": "GWM RIO VERDE",
  "160": "GWM ANÁPOLIS",
  "161": "GWM RIO VERDE",
  "162": "GWM ANÁPOLIS",
  "163": "CG VU",
  "172": "GAC",
  "173": "GEELY",
  "177": "PENDÊNCIA DOCUMENTAÇÃO",
  "178": "NAVESA NORTE (PORANGATU)",
  "180": "PORANGATU",
  "4": "CAMINHÕES GOIÂNIA",
  "54": "AEROPORTO/ACESSÓRIO",
  "79": "PRO+",
  "111": "OFICINA NAVESA AEROPORTO",
  "139": "AUTO HALL",
  "140": "PÁTIO VALCIMAR",
  "153": "GWM GOIÂNIA",
};

describe("mapearVeiculo — patio via MAPA_PATIO", () => {
  it("MAPA_PATIO bate exatamente com a tabela documentada (sem erro de digitação)", () => {
    assert.deepEqual(MAPA_PATIO, MAPA_PATIO_DOCUMENTADO);
  });

  it("COD_PATIO mapeado -> patio com nome legível", () => {
    const { veiculo } = mapearVeiculo({ COD_PATIO: 152 });
    assert.equal(veiculo.patio, "PREPARAÇÃO");
  });

  it("COD_PATIO mapeado (número diferente) -> patio com nome legível", () => {
    const { veiculo } = mapearVeiculo({ COD_PATIO: "17" });
    assert.equal(veiculo.patio, "CIAASA");
  });

  it("COD_PATIO desconhecido -> fallback com código cru + warning", () => {
    const { veiculo, camposSemFonte } = mapearVeiculo({ COD_PATIO: 999 });
    assert.equal(veiculo.patio, "Pátio 999 (não mapeado)");
    assert.ok(camposSemFonte.includes("patio_nao_mapeado:999"));
    assert.ok(!camposSemFonte.includes("patio"));
  });

  it("COD_PATIO ausente -> patio vazio, reportado como campo sem fonte", () => {
    const { veiculo, camposSemFonte } = mapearVeiculo({});
    assert.equal(veiculo.patio, "");
    assert.ok(camposSemFonte.includes("patio"));
  });

  it("mapearVeiculos agrega warning de código não mapeado com contagem de veículos", () => {
    const { warnings } = mapearVeiculos([{ COD_PATIO: 999 }, { COD_PATIO: 999 }, { COD_PATIO: 888 }]);
    assert.ok(warnings.some((w) => w.includes("Código de pátio 999 não mapeado (2 veículo(s))")));
    assert.ok(warnings.some((w) => w.includes("Código de pátio 888 não mapeado (1 veículo(s))")));
  });
});
