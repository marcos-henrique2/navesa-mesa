/**
 * Upload manual de XLSX não pode apagar cliente_tipo gravado pelo sync.
 *
 * O parser do XLSX só infere PF/PJ pelo tamanho do documento e devolve null
 * pra CPF/CNPJ com zero à esquerda perdido; o sync do Oracle tem o tipo
 * explícito (NBS.CLIENTES.COD_CLASSE). Quando o tipo parseado é null, a
 * coluna sai do upsert (lote separado) e o PostgREST preserva o valor atual.
 *
 * O teste de integração usa o supabase-js real com fetch falso, pra provar o
 * que de fato vai na requisição (`?columns=` e corpo) — misturar as duas
 * formas no mesmo lote faria o supabase-js preencher null (defaultToNull).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { separarLinhasPorTipoCliente, upsertVendasCom } from "@/lib/data/vendas";
import type { VendaParsed } from "@/lib/parsers/nbs-vendas-xlsx";

function venda(chassi: string, cliente_tipo: VendaParsed["cliente_tipo"]): VendaParsed {
  return {
    chassi, placa: "ABC1D23", modelo: "KA", marca: "FORD", ano_fabricacao: 2020, ano_modelo: 2021,
    cor_externa: null, renavam: null, km: 1000, cod_empresa: 2, empresa_nome: null, patio: null,
    vendedor_codigo: null, vendedor_nome: null, vendedor_cpf: null, vendedor_recebeu: null,
    cliente_codigo: "123456789", cliente_nome: "X", cliente_tipo, cliente_cidade: null, cliente_uf: null,
    data_venda: new Date("2026-03-10T12:00:00Z"), data_faturamento: null, data_entrada: null,
    valor_venda: 50000, preco_venda_tabela: null, total_nota_fabrica: null, custo_floor_plan: null,
    custo_total_final: null, despesas_gerais: null, margem_pct: null, comissao_vendedor: null,
    dias_estoque: null, placa_troca: null, financiado: null, financeira: null, valoriza: 0, consignado: false,
  };
}

describe("separarLinhasPorTipoCliente", () => {
  it("linha com tipo mantém a chave; linha sem tipo perde a chave (não vira null)", () => {
    const { comTipo, semTipo } = separarLinhasPorTipoCliente([
      { chassi: "A", cliente_tipo: "PF" },
      { chassi: "B", cliente_tipo: null },
      { chassi: "C", cliente_tipo: "PJ" },
      { chassi: "D" },
    ]);
    assert.deepEqual(comTipo, [{ chassi: "A", cliente_tipo: "PF" }, { chassi: "C", cliente_tipo: "PJ" }]);
    assert.deepEqual(semTipo, [{ chassi: "B" }, { chassi: "D" }]);
    for (const r of semTipo) assert.ok(!("cliente_tipo" in r));
  });
});

describe("upsertVendasCom — requisições reais do supabase-js", () => {
  it("lote sem tipo não inclui cliente_tipo em ?columns= nem no corpo", async () => {
    const chamadas: { url: URL; corpo: Record<string, unknown>[] }[] = [];
    const fetchFalso: typeof fetch = async (input, init) => {
      chamadas.push({ url: new URL(String(input)), corpo: JSON.parse(String(init?.body)) });
      return new Response("[]", { status: 201, headers: { "Content-Type": "application/json" } });
    };
    const sb = createClient("http://localhost:54321", "chave-falsa", { auth: { persistSession: false }, global: { fetch: fetchFalso } });

    const r = await upsertVendasCom(sb, [venda("A", "PF"), venda("B", null), venda("C", "PJ")]);
    assert.equal(r.total, 3);
    assert.equal(chamadas.length, 2);

    const [comTipo, semTipo] = chamadas;
    assert.match(comTipo.url.searchParams.get("columns") ?? "", /"cliente_tipo"/);
    assert.deepEqual(comTipo.corpo.map((x) => x.cliente_tipo), ["PF", "PJ"]);

    assert.doesNotMatch(semTipo.url.searchParams.get("columns") ?? "", /cliente_tipo/);
    assert.equal(semTipo.corpo.length, 1);
    assert.ok(!("cliente_tipo" in semTipo.corpo[0]));
    for (const c of chamadas) assert.equal(c.url.searchParams.get("on_conflict"), "chassi");
  });

  it("todas com tipo: um lote só, igual ao comportamento anterior", async () => {
    let n = 0;
    const fetchFalso: typeof fetch = async () => {
      n++;
      return new Response("[]", { status: 201, headers: { "Content-Type": "application/json" } });
    };
    const sb = createClient("http://localhost:54321", "chave-falsa", { auth: { persistSession: false }, global: { fetch: fetchFalso } });
    await upsertVendasCom(sb, [venda("A", "PF"), venda("B", "PJ")]);
    assert.equal(n, 1);
  });
});
