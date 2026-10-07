/**
 * Testes do catálogo de colunas exportáveis do estoque.
 *
 * O catálogo é PURO: cada coluna sabe seu label pt-BR, formato e como extrair
 * o valor de um VeiculoParsed (getter). A coluna "Observações" é especial —
 * sempre em branco (sem getter), só entra no XLSX quando o usuário pede.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  COLUNAS_ESTOQUE,
  COLUNAS_DEFAULT,
  GRUPOS_ESTOQUE,
  getColuna,
  normalizarBusca,
  colunaCorrespondeABusca,
  grupoAbrePorDefault,
  gruposAbertosPorDefault,
  type ColunaKey,
  type GrupoColuna,
} from "@/lib/export/colunas-estoque";
import { veiculo, custoEstoqueDetalhado } from "./_mocks";
import type { VeiculoParsed } from "@/lib/parsers/nbs-xlsx";

describe("colunas-estoque (catálogo)", () => {
  it("expõe lista não vazia de colunas com keys únicas", () => {
    assert.ok(COLUNAS_ESTOQUE.length >= 10, "deveria ter pelo menos 10 colunas");
    const keys = COLUNAS_ESTOQUE.map((c) => c.key);
    assert.equal(new Set(keys).size, keys.length, "keys devem ser únicas");
  });

  it("toda coluna tem key, label pt-BR não vazio e formato válido", () => {
    const formatosValidos = new Set(["texto", "numero", "moeda", "km", "ano"]);
    for (const c of COLUNAS_ESTOQUE) {
      assert.ok(c.key.length > 0, "key vazia");
      assert.ok(c.label.trim().length > 0, `label vazio em ${c.key}`);
      assert.ok(formatosValidos.has(c.formato), `formato inválido em ${c.key}: ${c.formato}`);
    }
  });

  it("getColuna resolve coluna por key e undefined pra key inexistente", () => {
    const placa = getColuna("placa");
    assert.ok(placa);
    assert.equal(placa!.label, "Placa");
    assert.equal(getColuna("nao_existe" as ColunaKey), undefined);
  });

  it("getter da placa retorna a placa do veículo", () => {
    const col = getColuna("placa");
    const v = veiculo({ placa: "XYZ9Z99" });
    assert.equal(col!.getValor(v), "XYZ9Z99");
  });

  it("getter de campos numéricos (km, preço, custo) retorna o número cru", () => {
    const v = veiculo({ km: 84000, preco_venda: 110000, valor_aquisicao: 90000 });
    assert.equal(getColuna("km")!.getValor(v), 84000);
    assert.equal(getColuna("preco_venda")!.getValor(v), 110000);
    assert.equal(getColuna("valor_aquisicao")!.getValor(v), 90000);
  });

  it("getter de margem deriva preco_venda - valor_aquisicao", () => {
    const v = veiculo({ preco_venda: 110000, valor_aquisicao: 90000 });
    assert.equal(getColuna("margem")!.getValor(v), 20000);
  });

  it("getter de margem retorna null quando falta preço ou aquisição", () => {
    assert.equal(getColuna("margem")!.getValor(veiculo({ preco_venda: null })), null);
    assert.equal(getColuna("margem")!.getValor(veiculo({ valor_aquisicao: null })), null);
  });

  it("getter de ano combina fabricação/modelo em texto pt-BR", () => {
    const col = getColuna("ano");
    assert.equal(col!.getValor(veiculo({ ano_fabricacao: 2021, ano_modelo: 2022 })), "2021/2022");
    assert.equal(col!.getValor(veiculo({ ano_fabricacao: 2022, ano_modelo: 2022 })), "2022");
    assert.equal(col!.getValor(veiculo({ ano_fabricacao: null, ano_modelo: null })), null);
  });

  it("getter de campos opcionais nulos retorna null (não string vazia)", () => {
    assert.equal(getColuna("marca")!.getValor(veiculo({ marca: null })), null);
    assert.equal(getColuna("cor_externa")!.getValor(veiculo({ cor_externa: null })), null);
    assert.equal(getColuna("dias_patio")!.getValor(veiculo({ dias_patio: null })), null);
  });

  it("COLUNAS_DEFAULT contém as colunas de partida e todas existem no catálogo", () => {
    const esperadas: ColunaKey[] = [
      "placa",
      "marca",
      "modelo",
      "ano",
      "km",
      "dias_patio",
      "valor_aquisicao",
      "preco_venda",
      "margem",
    ];
    for (const k of esperadas) {
      assert.ok(COLUNAS_DEFAULT.includes(k), `default deveria incluir ${k}`);
      assert.ok(getColuna(k), `default ${k} deveria existir no catálogo`);
    }
  });

  it("NÃO existe coluna 'observacoes' no catálogo (é tratada à parte, sem getter)", () => {
    assert.equal(getColuna("observacoes" as ColunaKey), undefined);
  });

  it("tem exatamente 28 colunas (25 + custo_real/fipe/custo_detalhado_total)", () => {
    assert.equal(COLUNAS_ESTOQUE.length, 28);
  });

  it("ordem canônica: valoriza/custo_real ficam entre valor_aquisicao e custo_total; fipe antes de preco_venda", () => {
    const keys = COLUNAS_ESTOQUE.map((c) => c.key);
    const idx = (k: ColunaKey) => keys.indexOf(k);
    assert.ok(idx("valor_aquisicao") < idx("valoriza"));
    assert.ok(idx("valoriza") < idx("custo_real"));
    assert.ok(idx("custo_real") < idx("custo_total"));
    assert.ok(idx("custo_total") < idx("fipe"));
    assert.ok(idx("fipe") < idx("preco_venda"));
    assert.ok(idx("preco_venda") < idx("margem"));
    // custo_detalhado_total é a ÚLTIMA entrada do catálogo.
    assert.equal(keys[keys.length - 1], "custo_detalhado_total");
  });

  it("custo_real = valor_aquisicao - valoriza (mesma fórmula do Vendas Matriz)", () => {
    const col = getColuna("custo_real")!;
    assert.equal(col.label, "Custo Real (Entrada − Valoriza)");
    assert.equal(col.formato, "moeda");
    assert.equal(col.agregacao, "soma");
    assert.equal(col.getValor(veiculo({ valor_aquisicao: 90000, valoriza: 1000 })), 89000);
  });

  it("custo_real retorna null quando não há valor_aquisicao (mesma guarda de calcularCustoReal)", () => {
    const col = getColuna("custo_real")!;
    assert.equal(col.getValor(veiculo({ valor_aquisicao: null })), null);
  });

  it("fipe lê o campo VeiculoExportavel.fipe; null quando ausente/não resolvido", () => {
    const col = getColuna("fipe")!;
    assert.equal(col.label, "FIPE");
    assert.equal(col.formato, "moeda");
    assert.equal(col.agregacao, "soma");
    assert.equal(col.grupo, "venda_margem");
    assert.equal(col.getValor(veiculo({})), null); // campo ausente (undefined)
    assert.equal(col.getValor({ ...veiculo({}), fipe: null }), null);
    assert.equal(col.getValor({ ...veiculo({}), fipe: 120000 }), 120000);
    assert.equal(col.confianca, undefined, "fipe não tem indicador de confiança");
  });

  it("custo_detalhado_total soma as OUTRAS 7 categorias (exclui Forplan), tratando null de ADM como 0", () => {
    const col = getColuna("custo_detalhado_total")!;
    assert.equal(col.label, "Custos detalhados (total, sem Forplan)");
    assert.equal(col.formato, "moeda");
    assert.equal(col.agregacao, "soma");
    assert.equal(col.grupo, "custos_detalhados");
    assert.equal(col.confianca, "parcial");

    const v = veiculo({
      custo_revisoes: 100,
      custo_forplan: 200,
      custo_holdback: 300,
      custo_acessorios: 400,
      custo_impostos: 500,
      custo_comissoes: 600,
      custo_adm: null,
      custo_despesas_gerais: 0,
    });
    // 100+300+400+500+600 + 0 + 0 = 1900 (Forplan NÃO entra; null de ADM NÃO propaga pro total).
    assert.equal(col.getValor(v), 1900);

    const comAdmEDespesas = veiculo({
      custo_revisoes: 100,
      custo_forplan: 200,
      custo_holdback: 300,
      custo_acessorios: 400,
      custo_impostos: 500,
      custo_comissoes: 600,
      custo_adm: 50,
      custo_despesas_gerais: 25,
    });
    assert.equal(col.getValor(comAdmEDespesas), 1975);
  });

  it("as 9 colunas novas existem, no formato moeda/soma e lêem o campo certo", () => {
    const casos: [ColunaKey, string, number | null][] = [
      ["valoriza", "Valoriza (bônus fábrica)", 123],
      ["custo_revisoes", "Revisões", 456],
      ["custo_forplan", "Forplan", 10],
      ["custo_holdback", "HoldBack", 11],
      ["custo_acessorios", "Acessórios", 12],
      ["custo_impostos", "Impostos", 13],
      ["custo_comissoes", "Comissões", 14],
    ];
    for (const [key, label, valor] of casos) {
      const col = getColuna(key);
      assert.ok(col, `coluna ${key} deveria existir`);
      assert.equal(col!.label, label);
      assert.equal(col!.formato, "moeda");
      assert.equal(col!.agregacao, "soma");
      assert.equal(col!.getValor(veiculo({ [key]: valor } as unknown as Partial<VeiculoParsed>)), valor);
    }

    const adm = getColuna("custo_adm");
    assert.ok(adm);
    assert.equal(adm!.label, "ADM");
    assert.equal(adm!.getValor(veiculo({ custo_adm: null })), null);
    assert.equal(adm!.getValor(veiculo({ custo_adm: 99 })), 99);

    const despesas = getColuna("custo_despesas_gerais");
    assert.ok(despesas);
    assert.equal(despesas!.label, "Despesas Gerais");
    // ATUALIZADO 07/10/2026 (migration 048): custo_despesas_gerais deixou de
    // ser "não apurado" — agora é sempre-número (automático=0 sem manual → 0,
    // nunca mais null), mesmo padrão de HoldBack/Acessórios/Comissões/Revisões.
    assert.equal(despesas!.getValor(veiculo({ custo_despesas_gerais: 0 })), 0);
    assert.equal(despesas!.getValor(veiculo({ custo_despesas_gerais: 77 })), 77);
  });

  it("cada coluna pertence a um dos 5 grupos, nos agrupamentos esperados", () => {
    const esperado: Record<ColunaKey, GrupoColuna> = {
      placa: "identificacao",
      chassi: "identificacao",
      marca: "identificacao",
      modelo: "identificacao",
      ano: "identificacao",
      km: "identificacao",
      cor_externa: "identificacao",
      combustivel: "identificacao",
      loja: "localizacao_status",
      dias_patio: "localizacao_status",
      descricao_situacao: "localizacao_status",
      patio: "localizacao_status",
      valor_aquisicao: "custos",
      valoriza: "custos",
      custo_real: "custos",
      custo_total: "custos",
      custo_impostos: "custos_detalhados",
      custo_revisoes: "custos_detalhados",
      custo_forplan: "custos_detalhados",
      custo_holdback: "custos_detalhados",
      custo_acessorios: "custos_detalhados",
      custo_comissoes: "custos_detalhados",
      custo_adm: "custos_detalhados",
      custo_despesas_gerais: "custos_detalhados",
      custo_detalhado_total: "custos_detalhados",
      fipe: "venda_margem",
      preco_venda: "venda_margem",
      margem: "venda_margem",
      // keys do contrato genérico que não existem como coluna própria aqui:
      ano_fabricacao: "identificacao",
      ano_modelo: "identificacao",
    };
    for (const c of COLUNAS_ESTOQUE) {
      assert.equal(c.grupo, esperado[c.key], `grupo errado em ${c.key}`);
    }
    assert.equal(new Set(COLUNAS_ESTOQUE.map((c) => c.grupo)).size, GRUPOS_ESTOQUE.length);
  });

  it("confiança baixa só nas 5 colunas de custo Oracle pouco confirmadas", () => {
    // custo_forplan SAIU dessa lista em 05/10/2026: fonte corrigida pra
    // NBS.VEICULOS.CUSTO_FORPLAN_FINAL (coluna direta), confirmada ao
    // centavo contra o relatório nativo PDF em 3 veículos — ver migration 043.
    // custo_revisoes ENTROU em 07/10/2026: auditoria de 628 carros achou 29
    // casos (4,6%) de divergência vs. PDF nativo (ver custo-estoque-fallback.ts).
    // custo_despesas_gerais ENTROU em 07/10/2026 (migration 048): passou a
    // ter fonte automática real (TIPO=9), validada 99,3% (426/429) — não
    // 100%, por isso confiança baixa (igual às outras 4), não mais
    // "não apurado".
    const esperadoBaixa: ColunaKey[] = [
      "custo_holdback",
      "custo_acessorios",
      "custo_comissoes",
      "custo_revisoes",
      "custo_despesas_gerais",
    ];
    for (const key of esperadoBaixa) {
      assert.equal(getColuna(key)!.confianca, "baixa", `${key} deveria ser confiança baixa`);
    }
  });

  it("confiança 'não apurado' só em custo_adm", () => {
    assert.equal(getColuna("custo_adm")!.confianca, "nao_apurado");
  });

  it("custo_forplan NÃO tem indicador de confiança", () => {
    assert.equal(getColuna("custo_forplan")!.confianca, undefined);
  });

  it("confiança 'diverge_relatorio' só em custo_impostos (migration 046: soma de CODIGO_CUSTO real, mas diverge do valor calculado do relatório nativo)", () => {
    assert.equal(getColuna("custo_impostos")!.confianca, "diverge_relatorio");
    const comDivergeRelatorio = COLUNAS_ESTOQUE.filter((c) => c.confianca === "diverge_relatorio").map((c) => c.key);
    assert.deepEqual(comDivergeRelatorio, ["custo_impostos"]);
  });

  it("nenhuma outra coluna tem indicador de confiança além das 8 esperadas", () => {
    const comConfianca = COLUNAS_ESTOQUE.filter((c) => c.confianca != null).map((c) => c.key).sort();
    assert.deepEqual(
      comConfianca,
      [
        "custo_acessorios",
        "custo_adm",
        "custo_comissoes",
        "custo_despesas_gerais",
        "custo_detalhado_total",
        "custo_holdback",
        "custo_impostos",
        "custo_revisoes",
      ].sort(),
    );
  });

  it("confiança 'parcial' só em custo_detalhado_total", () => {
    const comParcial = COLUNAS_ESTOQUE.filter((c) => c.confianca === "parcial").map((c) => c.key);
    assert.deepEqual(comParcial, ["custo_detalhado_total"]);
  });

  it("fallbackManual marcado nas 7 categorias sem fonte automática confiável/que diverge do relatório nativo (migration 047 + decisões 06-07/10/2026 sobre Impostos/Revisões)", () => {
    const comFallback = COLUNAS_ESTOQUE.filter((c) => c.fallbackManual === true).map((c) => c.key).sort();
    assert.deepEqual(
      comFallback,
      [
        "custo_acessorios",
        "custo_adm",
        "custo_comissoes",
        "custo_despesas_gerais",
        "custo_holdback",
        "custo_impostos",
        "custo_revisoes",
      ].sort(),
    );
    // custo_detalhado_total e custo_forplan NÃO têm fallback manual.
    for (const key of ["custo_detalhado_total", "custo_forplan"] as ColunaKey[]) {
      assert.equal(getColuna(key)!.fallbackManual, undefined, `${key} não deveria ter fallbackManual`);
    }
  });

  describe("fallback manual (custo_holdback/custo_acessorios/custo_impostos/custo_comissoes/custo_adm/custo_despesas_gerais)", () => {
    it("custo_holdback: automático zerado + manual presente usa o manual", () => {
      const col = getColuna("custo_holdback")!;
      const v = { ...veiculo({ custo_holdback: 0 }), custoEstoqueManual: custoEstoqueDetalhado({ holdback: 500 }) };
      assert.equal(col.getValor(v), 500);
    });

    it("custo_holdback: automático não-zero prevalece sobre o manual", () => {
      const col = getColuna("custo_holdback")!;
      const v = { ...veiculo({ custo_holdback: 300 }), custoEstoqueManual: custoEstoqueDetalhado({ holdback: 500 }) };
      assert.equal(col.getValor(v), 300);
    });

    it("custo_holdback: nem automático nem manual tem valor → 0 (padrão já estabelecido)", () => {
      const col = getColuna("custo_holdback")!;
      assert.equal(col.getValor(veiculo({ custo_holdback: 0 })), 0);
      assert.equal(col.getValor({ ...veiculo({ custo_holdback: 0 }), custoEstoqueManual: null }), 0);
    });

    it("custo_impostos: automático=0 + manual existe → usa o manual", () => {
      const col = getColuna("custo_impostos")!;
      const v = { ...veiculo({ custo_impostos: 0 }), custoEstoqueManual: custoEstoqueDetalhado({ impostos: 850 }) };
      assert.equal(col.getValor(v), 850);
    });

    it("custo_impostos: prioridade INVERTIDA (07/10/2026) — manual vence mesmo com automático ≠0 — caso real da placa RBV7G98 (automático=1600, PDF real=2740.80)", () => {
      const col = getColuna("custo_impostos")!;
      const v = { ...veiculo({ custo_impostos: 1600 }), custoEstoqueManual: custoEstoqueDetalhado({ impostos: 2740.8 }) };
      assert.equal(col.getValor(v), 2740.8);
    });

    it("custo_impostos: sem manual → usa o automático, mesmo ≠0 (automático é dado real, mesmo divergindo do relatório nativo)", () => {
      const col = getColuna("custo_impostos")!;
      const v = { ...veiculo({ custo_impostos: 499.5 }), custoEstoqueManual: null };
      assert.equal(col.getValor(v), 499.5);
    });

    it("custo_impostos: sem automático (0) e sem manual → 0 (mesmo padrão de HoldBack/Acessórios/Comissões)", () => {
      const col = getColuna("custo_impostos")!;
      assert.equal(col.getValor(veiculo({ custo_impostos: 0 })), 0);
      assert.equal(col.getValor({ ...veiculo({ custo_impostos: 0 }), custoEstoqueManual: null }), 0);
    });

    it("custo_impostos continua com confianca 'diverge_relatorio' mesmo tendo fallbackManual agora", () => {
      const col = getColuna("custo_impostos")!;
      assert.equal(col.confianca, "diverge_relatorio");
      assert.equal(col.fallbackManual, true);
    });

    it("custo_revisoes: automático≠0 prevalece sobre o manual (regra PADRÃO, não a invertida de Impostos) — caso real da placa RBV7G98 (automático=230, PDF real=0)", () => {
      const col = getColuna("custo_revisoes")!;
      const v = { ...veiculo({ custo_revisoes: 230 }), custoEstoqueManual: custoEstoqueDetalhado({ revisoes: 0 }) };
      assert.equal(col.getValor(v), 230);
    });

    it("custo_revisoes: automático zerado + manual presente → usa o manual (fallback padrão, igual a HoldBack/Acessórios/Comissões)", () => {
      const col = getColuna("custo_revisoes")!;
      const v = { ...veiculo({ custo_revisoes: 0 }), custoEstoqueManual: custoEstoqueDetalhado({ revisoes: 500 }) };
      assert.equal(col.getValor(v), 500);
    });

    it("custo_revisoes: sem automático (0) e sem manual → 0 (mesmo padrão de HoldBack/Acessórios/Comissões)", () => {
      const col = getColuna("custo_revisoes")!;
      assert.equal(col.getValor(veiculo({ custo_revisoes: 0 })), 0);
      assert.equal(col.getValor({ ...veiculo({ custo_revisoes: 0 }), custoEstoqueManual: null }), 0);
    });

    it("custo_acessorios e custo_comissoes seguem o mesmo fallback", () => {
      const acessorios = getColuna("custo_acessorios")!;
      const comissoes = getColuna("custo_comissoes")!;
      const v = {
        ...veiculo({ custo_acessorios: 0, custo_comissoes: 0 }),
        custoEstoqueManual: custoEstoqueDetalhado({ acessorios: 120, comissoes: 340 }),
      };
      assert.equal(acessorios.getValor(v), 120);
      assert.equal(comissoes.getValor(v), 340);
    });

    it("custo_adm: automático null + manual presente usa o manual", () => {
      const col = getColuna("custo_adm")!;
      const v = { ...veiculo({ custo_adm: null }), custoEstoqueManual: custoEstoqueDetalhado({ adm: 75 }) };
      assert.equal(col.getValor(v), 75);
    });

    it("custo_adm: nem automático nem manual tem valor → null (padrão 'não apurado', não vira 0)", () => {
      const col = getColuna("custo_adm")!;
      assert.equal(col.getValor(veiculo({ custo_adm: null })), null);
      assert.equal(col.getValor({ ...veiculo({ custo_adm: null }), custoEstoqueManual: null }), null);
    });

    it("custo_despesas_gerais: automático zerado + manual presente → usa o manual (fallback padrão, igual a HoldBack/Acessórios/Comissões — ATUALIZADO 07/10/2026, migration 048)", () => {
      const col = getColuna("custo_despesas_gerais")!;
      const v = { ...veiculo({ custo_despesas_gerais: 0 }), custoEstoqueManual: custoEstoqueDetalhado({ desp_gerais: 60 }) };
      assert.equal(col.getValor(v), 60);
    });

    it("custo_despesas_gerais: automático não-zero prevalece sobre o manual", () => {
      const col = getColuna("custo_despesas_gerais")!;
      const v = { ...veiculo({ custo_despesas_gerais: 500 }), custoEstoqueManual: custoEstoqueDetalhado({ desp_gerais: 60 }) };
      assert.equal(col.getValor(v), 500);
    });

    it("custo_despesas_gerais: nem automático nem manual tem valor → 0, não mais null (deixou de ser 'não apurado')", () => {
      const col = getColuna("custo_despesas_gerais")!;
      assert.equal(col.getValor(veiculo({ custo_despesas_gerais: 0 })), 0);
      assert.equal(col.getValor({ ...veiculo({ custo_despesas_gerais: 0 }), custoEstoqueManual: null }), 0);
    });

    it("sem custoEstoqueManual (campo ausente): comporta-se como se não houvesse manual", () => {
      assert.equal(getColuna("custo_holdback")!.getValor(veiculo({ custo_holdback: 0 })), 0);
      assert.equal(getColuna("custo_adm")!.getValor(veiculo({ custo_adm: null })), null);
    });

    it("custo_detalhado_total usa o MESMO fallback resolvido das 7 colunas (não diverge do que é exibido) — Impostos com prioridade invertida (manual vence mesmo ≠0)", () => {
      const col = getColuna("custo_detalhado_total")!;
      const v = {
        ...veiculo({
          custo_revisoes: 100, // não-zero → NÃO cai pro manual (regra padrão de Revisões)
          custo_forplan: 999, // excluído do total — não deve entrar na soma
          custo_holdback: 0, // zerado → cai pro manual
          custo_acessorios: 0, // zerado → cai pro manual
          custo_impostos: 500, // ≠0, mas Impostos é prioridade invertida → cai pro manual mesmo assim
          custo_comissoes: 600, // não-zero → NÃO cai pro manual
          custo_adm: null, // null → cai pro manual
          custo_despesas_gerais: 0, // zerado → cai pro manual (ATUALIZADO 07/10/2026: não mais null)
        }),
        custoEstoqueManual: custoEstoqueDetalhado({ revisoes: 999, holdback: 50, acessorios: 40, impostos: 2740.8, comissoes: 9999, adm: 10, desp_gerais: 5 }),
      };
      // 100 (revisoes automático, NÃO o manual 999) + 50 (holdback via manual) + 40 (acessorios
      // via manual) + 2740.8 (impostos via manual, prioridade invertida — NÃO o automático 500)
      // + 600 (comissoes automático, NÃO o manual 9999) + 10 (adm via manual) + 5 (desp_gerais
      // via manual) = 3545.8
      assert.equal(col.getValor(v), 3545.8);
    });

    it("custo_detalhado_total reflete o fallback de Revisões quando o automático vem 0", () => {
      const col = getColuna("custo_detalhado_total")!;
      const v = {
        ...veiculo({
          custo_revisoes: 0, // zerado → cai pro manual
          custo_forplan: 999, // excluído do total
          custo_holdback: 0,
          custo_acessorios: 0,
          custo_impostos: 0, // zerado → cai pro manual (igual, independente da prioridade invertida)
          custo_comissoes: 0,
          custo_adm: null,
          custo_despesas_gerais: 0, // ATUALIZADO 07/10/2026: não mais null
        }),
        custoEstoqueManual: custoEstoqueDetalhado({ revisoes: 120, holdback: 0, acessorios: 0, impostos: 850, comissoes: 0, adm: 0, desp_gerais: 0 }),
      };
      // 120 (revisoes via manual) + 0 + 0 + 850 (impostos via manual) + 0 + 0 + 0 = 970
      assert.equal(col.getValor(v), 970);
    });
  });
});

describe("normalizarBusca / colunaCorrespondeABusca (busca do modal)", () => {
  it("remove acentos e ignora caixa", () => {
    assert.equal(normalizarBusca("Comissões"), "comissoes");
    assert.equal(normalizarBusca("LOCALIZAÇÃO"), "localizacao");
    assert.equal(normalizarBusca("Forplan"), "forplan");
  });

  it("termo vazio (ou só espaços) sempre corresponde", () => {
    const col = getColuna("custo_forplan")!;
    assert.equal(colunaCorrespondeABusca(col, ""), true);
    assert.equal(colunaCorrespondeABusca(col, "   "), true);
  });

  it("corresponde ao label ignorando acento/caixa, em qualquer posição", () => {
    const col = getColuna("custo_comissoes")!; // label "Comissões"
    assert.equal(colunaCorrespondeABusca(col, "comissoes"), true);
    assert.equal(colunaCorrespondeABusca(col, "COMISSÕES"), true);
    assert.equal(colunaCorrespondeABusca(col, "miss"), true);
    assert.equal(colunaCorrespondeABusca(col, "xyz"), false);
  });

  it("não corresponde a termo que não aparece no label", () => {
    const col = getColuna("placa")!;
    assert.equal(colunaCorrespondeABusca(col, "chassi"), false);
  });
});

describe("expand/collapse padrão dos grupos (sem busca)", () => {
  it("abre os grupos com ≥1 coluna em COLUNAS_DEFAULT; deixa 'custos_detalhados' fechado", () => {
    const abertos = gruposAbertosPorDefault();
    assert.ok(abertos.has("identificacao"));
    assert.ok(abertos.has("localizacao_status"));
    assert.ok(abertos.has("custos"));
    assert.ok(abertos.has("venda_margem"));
    assert.ok(!abertos.has("custos_detalhados"));
  });

  it("grupoAbrePorDefault reflete exatamente se alguma default pertence ao grupo", () => {
    assert.equal(grupoAbrePorDefault("identificacao"), true); // placa, marca, modelo, ano, km
    assert.equal(grupoAbrePorDefault("custos_detalhados"), false); // nenhuma default
  });

  it("com uma lista de defaults customizada, só os grupos tocados abrem", () => {
    const abertos = gruposAbertosPorDefault(["custo_forplan"]);
    assert.deepEqual([...abertos], ["custos_detalhados"]);
  });

  it("com defaults vazio, nenhum grupo abre sozinho", () => {
    const abertos = gruposAbertosPorDefault([]);
    assert.equal(abertos.size, 0);
  });
});
