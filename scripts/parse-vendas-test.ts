import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseNbsVendasXlsx } from "../src/lib/parsers/nbs-vendas-xlsx";

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Uso: npm run parse-vendas-test -- <caminho-do-xlsx>");
    process.exit(1);
  }

  const absolute = resolve(path);
  console.log(`Lendo: ${absolute}\n`);

  const buf = await readFile(absolute);
  const result = await parseNbsVendasXlsx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), path);

  console.log("=== META ===");
  console.log(JSON.stringify({
    ...result.meta,
    data_geracao: result.meta.data_geracao?.toISOString(),
    periodo_inicio: result.meta.periodo_inicio?.toISOString(),
    periodo_fim: result.meta.periodo_fim?.toISOString(),
  }, null, 2));

  console.log(`\n=== ${result.vendas.length} VENDAS PARSEADAS ===`);

  // KPIs agregados
  let totalValor = 0, totalCusto = 0, totalCom = 0, totalDias = 0, comDias = 0;
  let pf = 0, pj = 0, troca = 0;
  const porLoja = new Map<string, { qt: number; valor: number; margem: number }>();
  const porVendedor = new Map<string, { qt: number; valor: number }>();
  const porUf = new Map<string, number>();

  for (const v of result.vendas) {
    totalValor += v.valor_venda ?? 0;
    totalCusto += v.custo_total_final ?? 0;
    totalCom += v.comissao_vendedor ?? 0;
    if (v.dias_estoque !== null) { totalDias += v.dias_estoque; comDias++; }
    if (v.cliente_tipo === "PF") pf++;
    if (v.cliente_tipo === "PJ") pj++;
    if (v.placa_troca) troca++;

    const loja = v.empresa_nome || `Loja ${v.cod_empresa}`;
    const lojaAgg = porLoja.get(loja) ?? { qt: 0, valor: 0, margem: 0 };
    lojaAgg.qt++;
    lojaAgg.valor += v.valor_venda ?? 0;
    lojaAgg.margem += (v.valor_venda ?? 0) - (v.custo_total_final ?? 0);
    porLoja.set(loja, lojaAgg);

    const vend = v.vendedor_nome || v.vendedor_codigo || "(?)";
    const vendAgg = porVendedor.get(vend) ?? { qt: 0, valor: 0 };
    vendAgg.qt++;
    vendAgg.valor += v.valor_venda ?? 0;
    porVendedor.set(vend, vendAgg);

    if (v.cliente_uf) porUf.set(v.cliente_uf, (porUf.get(v.cliente_uf) ?? 0) + 1);
  }

  const fmt = (n: number) => "R$ " + n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
  console.log(`\nValor total vendido: ${fmt(totalValor)}`);
  console.log(`Custo total: ${fmt(totalCusto)}`);
  console.log(`Margem total (valor - custo): ${fmt(totalValor - totalCusto)} (${(((totalValor - totalCusto) / totalCusto) * 100).toFixed(1)}%)`);
  console.log(`Ticket médio: ${fmt(totalValor / result.vendas.length)}`);
  console.log(`Tempo médio até venda: ${(totalDias / comDias).toFixed(1)} dias (em ${comDias} carros)`);
  console.log(`Comissão total: ${fmt(totalCom)}`);
  console.log(`Clientes: ${pf} PF / ${pj} PJ`);
  console.log(`Vendas com troca: ${troca} (${((troca / result.vendas.length) * 100).toFixed(1)}%)`);

  console.log(`\n=== TOP 5 LOJAS POR VOLUME ===`);
  [...porLoja.entries()].sort((a, b) => b[1].valor - a[1].valor).slice(0, 5).forEach(([nome, agg]) => {
    console.log(`  ${nome}: ${agg.qt} vendas — ${fmt(agg.valor)} — margem ${fmt(agg.margem)}`);
  });

  console.log(`\n=== TOP 10 VENDEDORES POR QUANTIDADE ===`);
  [...porVendedor.entries()].sort((a, b) => b[1].qt - a[1].qt).slice(0, 10).forEach(([nome, agg]) => {
    console.log(`  ${nome}: ${agg.qt} vendas — ${fmt(agg.valor)}`);
  });

  console.log(`\n=== TOP UFs ===`);
  [...porUf.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([uf, qt]) => {
    console.log(`  ${uf}: ${qt}`);
  });

  if (result.warnings.length > 0) {
    console.log(`\n=== ${result.warnings.length} WARNINGS ===`);
    for (const w of result.warnings.slice(0, 10)) console.log(`  - ${w}`);
    if (result.warnings.length > 10) console.log(`  ... +${result.warnings.length - 10}`);
  } else {
    console.log("\nSem warnings.");
  }
}

main().catch((err) => {
  console.error("Erro:", err);
  process.exit(1);
});
