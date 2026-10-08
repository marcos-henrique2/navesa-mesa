import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { lerOpcoesCustos, gravarCustosVendidosNode } from "../scripts/sync-nbs/executar-custos-vendidos";
import type { CustoDetalhado } from "@/lib/parsers/nbs-custos-xls";

test("dry-run não permite passar pelos blocos gravadores de estoque/vendas", () => {
  assert.throws(() => lerOpcoesCustos(["--dry-run"]), /somente-custos/);
  assert.deepEqual(lerOpcoesCustos(["--somente-custos", "--dry-run", "--custos-desde=2026-01-01"]), { somenteCustos: true, dryRun: true, dataInicio: "2026-01-01" });
});
test("CLI rejeita datas inexistentes, opções desconhecidas e início duplicado", () => {
  for (const args of [["--custos-desde=2026-02-30"], ["--custos-desde="], ["--escrever"], ["--custos-desde=2026-01-01", "--custos-desde=2026-02-01"]]) assert.throws(() => lerOpcoesCustos(args));
});
const custo = (valor: number): CustoDetalhado => ({placa:"ABC1D23",modelo:"TESTE",data_fatura:new Date("2026-01-01T00:00:00Z"),data_venda:new Date("2026-01-02T00:00:00Z"),dias_patio:1,nota_fabrica_taxa_icms:valor,despesas_oficina:0,frete_icms_frete:0,forplan:0,impostos:0,comissoes:0,ganhos_indiretos:0,adm:0,despesas_gerais:0,custo_total:valor,valor_vendido:valor*1.1,margem_real:valor*0.1,margem_pct:10});
test("nenhum lote é enviado quando existe custo zerado ou placa inválida", async () => {
  let chamadas=0;
  const sb={from:()=>{chamadas++;throw new Error("I/O inesperado");}} as unknown as SupabaseClient;
  await assert.rejects(gravarCustosVendidosNode(sb,[custo(100),custo(0)]), /zerado/);
  await assert.rejects(gravarCustosVendidosNode(sb,[{...custo(100),placa:""}]), /Placa inválida/);
  assert.equal(chamadas,0);
});
test("upsert preserva placa mais recente e exige confirmação de todas as linhas", async () => {
  let gravado: Record<string,unknown>[]=[];
  const sb={from:(t:string)=>{assert.equal(t,"custos_detalhados");return {upsert:(rows:Record<string,unknown>[],opts:{onConflict:string})=>{assert.equal(opts.onConflict,"placa");gravado=rows;return {select:async()=>({data:rows.map(r=>({placa:r.placa})),error:null})};}};}} as unknown as SupabaseClient;
  const antigo=custo(100),novo={...custo(200),data_venda:new Date("2026-02-01T00:00:00Z")};
  assert.equal(await gravarCustosVendidosNode(sb,[novo,antigo]),1);
  assert.equal(gravado[0].custo_total,200);
  const silencioso={from:()=>({upsert:()=>({select:async()=>({data:[],error:null})})})} as unknown as SupabaseClient;
  await assert.rejects(gravarCustosVendidosNode(silencioso,[novo]), /confirmou/);
});