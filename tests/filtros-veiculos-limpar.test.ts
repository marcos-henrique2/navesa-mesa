/**
 * Testes do helper `aplicarLimparFiltros` (botão "Limpar filtros" do estoque).
 *
 * Garante:
 *   - Todos os setters de filtro são chamados com valor inicial
 *   - Nenhum filtro é esquecido (cobertura completa via CHAVES_FILTROS_ZERADAS)
 *   - `fecharModoPrioridade` também é disparado
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  aplicarLimparFiltros,
  CHAVES_FILTROS_ZERADAS,
  type SettersFiltrosVeiculos,
} from "@/components/veiculos/filtros-iniciais";

type Chamada = { chave: string; valor: unknown };

function criarSpySetters(): { setters: SettersFiltrosVeiculos; chamadas: Chamada[] } {
  const chamadas: Chamada[] = [];
  const make = <T,>(chave: string) => (valor: T) => {
    chamadas.push({ chave, valor });
  };
  const setters: SettersFiltrosVeiculos = {
    setStatusFiltro: make("statusFiltro"),
    setSearch: make("search"),
    setFiltroLoja: make("filtroLoja"),
    setFiltroMarca: make("filtroMarca"),
    setFiltroCor: make("filtroCor"),
    setFiltroComb: make("filtroComb"),
    setFiltroSituacao: make("filtroSituacao"),
    setFiltroPatio: make("filtroPatio"),
    setFiltroClasse: make("filtroClasse"),
    setFiltroFipe: make("filtroFipe"),
    setFiltroCautelar: make("filtroCautelar"),
    setFiltroFlag: make("filtroFlag"),
    setFiltroRepasse: make("filtroRepasse"),
    setAnoMin: make("anoMin"),
    setAnoMax: make("anoMax"),
    setKmMin: make("kmMin"),
    setKmMax: make("kmMax"),
    setPrecoMin: make("precoMin"),
    setPrecoMax: make("precoMax"),
    setDiasMin: make("diasMin"),
    setDiasMax: make("diasMax"),
    setIdadeMin: make("idadeMin"),
    setIdadeMax: make("idadeMax"),
    setMargemMin: make("margemMin"),
    setMargemMax: make("margemMax"),
    fecharModoPrioridade: () => {
      chamadas.push({ chave: "modoPrioridade", valor: "fechado" });
    },
  };
  return { setters, chamadas };
}

describe("aplicarLimparFiltros", () => {
  it("zera TODOS os filtros (cobertura completa contra CHAVES_FILTROS_ZERADAS)", () => {
    const { setters, chamadas } = criarSpySetters();
    aplicarLimparFiltros(setters);

    const chavesChamadas = chamadas.map((c) => c.chave);
    assert.deepEqual(
      chavesChamadas,
      [...CHAVES_FILTROS_ZERADAS],
      "ordem/conjunto de filtros zerados precisa bater com CHAVES_FILTROS_ZERADAS",
    );
  });

  it("dropdowns voltam pra 'all'", () => {
    const { setters, chamadas } = criarSpySetters();
    aplicarLimparFiltros(setters);
    const dropdowns = [
      "statusFiltro",
      "filtroLoja",
      "filtroMarca",
      "filtroCor",
      "filtroComb",
      "filtroSituacao",
      "filtroPatio",
      "filtroClasse",
      "filtroFipe",
      "filtroCautelar",
      "filtroFlag",
      "filtroRepasse",
    ];
    for (const chave of dropdowns) {
      const c = chamadas.find((c) => c.chave === chave);
      assert.equal(c?.valor, "all", `${chave} deve ser "all"`);
    }
  });

  it("inputs de texto voltam pra string vazia", () => {
    const { setters, chamadas } = criarSpySetters();
    aplicarLimparFiltros(setters);
    const textos = [
      "search",
      "anoMin",
      "anoMax",
      "kmMin",
      "kmMax",
      "precoMin",
      "precoMax",
      "diasMin",
      "diasMax",
      "idadeMin",
      "idadeMax",
      "margemMin",
      "margemMax",
    ];
    for (const chave of textos) {
      const c = chamadas.find((c) => c.chave === chave);
      assert.equal(c?.valor, "", `${chave} deve ser string vazia`);
    }
  });

  it("fecha modo prioridade Ford", () => {
    const { setters, chamadas } = criarSpySetters();
    aplicarLimparFiltros(setters);
    const c = chamadas.find((c) => c.chave === "modoPrioridade");
    assert.ok(c, "fecharModoPrioridade deve ser chamado");
  });

  it("retorna a lista canônica das chaves zeradas", () => {
    const { setters } = criarSpySetters();
    const retorno = aplicarLimparFiltros(setters);
    assert.deepEqual([...retorno], [...CHAVES_FILTROS_ZERADAS]);
  });
});
