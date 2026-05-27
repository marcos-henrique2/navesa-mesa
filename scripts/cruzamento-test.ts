import * as fs from "fs";
import { parseNbsVendasXlsx } from "../src/lib/parsers/nbs-vendas-xlsx";
import { parseNbsCustosXls } from "../src/lib/parsers/nbs-custos-xls";
import { agregarMargem } from "../src/lib/analytics/margem";

async function main() {
  const BASE = "C:/Users/Marcos Henrique/Documents/Mesa de Precificaçao";
  const vendasBuf = fs.readFileSync(`${BASE}/Relatorio 1.xlsx`);
  const custosBuf = fs.readFileSync(`${BASE}/Relatorio 2.xls`);

  const vendasResult = await parseNbsVendasXlsx(
    vendasBuf.buffer.slice(vendasBuf.byteOffset, vendasBuf.byteOffset + vendasBuf.byteLength),
    "Relatorio 1.xlsx"
  );
  const custosResult = await parseNbsCustosXls(
    custosBuf.buffer.slice(custosBuf.byteOffset, custosBuf.byteOffset + custosBuf.byteLength),
    "Relatorio 2.xls"
  );

  const custosPorPlaca: Record<string, (typeof custosResult.custos)[number]> = {};
  for (const c of custosResult.custos) {
    if (c.placa) custosPorPlaca[c.placa] = c;
  }

  console.log("=== TOTAIS PARSEADOS ===");
  console.log(`Vendas: ${vendasResult.vendas.length}`);
  console.log(`Custos (array): ${custosResult.custos.length}`);
  console.log(`Custos (placas únicas): ${Object.keys(custosPorPlaca).length}`);

  const placasVendas = new Set(vendasResult.vendas.map((v) => v.placa).filter(Boolean));
  const placasCustos = new Set(Object.keys(custosPorPlaca));

  let comCusto = 0,
    semCusto = 0;
  const semCustoList: string[] = [];
  for (const p of placasVendas) {
    if (placasCustos.has(p)) comCusto++;
    else {
      semCusto++;
      semCustoList.push(p);
    }
  }

  let custoSemVenda = 0;
  const custoSemVendaList: string[] = [];
  for (const p of placasCustos) {
    if (!placasVendas.has(p)) {
      custoSemVenda++;
      custoSemVendaList.push(p);
    }
  }

  console.log(`\n=== COBERTURA ===`);
  console.log(
    `Vendas com custo oficial: ${comCusto} (${((comCusto / placasVendas.size) * 100).toFixed(2)}%)`
  );
  console.log(`Vendas SEM custo oficial: ${semCusto}`);
  if (semCustoList.length > 0 && semCustoList.length <= 20)
    console.log(`  Placas: ${semCustoList.join(", ")}`);
  else if (semCustoList.length > 0)
    console.log(`  Primeiras 20 placas: ${semCustoList.slice(0, 20).join(", ")}`);
  console.log(`Custos sem venda no relatório: ${custoSemVenda}`);
  if (custoSemVendaList.length > 0 && custoSemVendaList.length <= 20)
    console.log(`  Placas: ${custoSemVendaList.join(", ")}`);

  const agg = agregarMargem(vendasResult.vendas, custosPorPlaca);
  console.log(`\n=== AGREGAÇÃO CANÔNICA (lib/analytics/margem.ts) ===`);
  console.log(`Quantidade: ${agg.qt}`);
  console.log(`Valor: R$ ${agg.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`);
  console.log(`Custo: R$ ${agg.custo.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`);
  console.log(
    `Margem: R$ ${agg.margem.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} (${agg.margemPct.toFixed(2)}%)`
  );
  console.log(`Cobertura: ${(agg.cobertura * 100).toFixed(2)}%`);
  console.log(`Com custo oficial: ${agg.qtComCustoOficial} / ${agg.qt}`);

  console.log(`\n=== COMPONENTES NBS ===`);
  const c = agg.componentes;
  console.log(
    `  Nota Fábrica: R$ ${c.nota_fabrica.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
  );
  console.log(
    `  Desp Oficina: R$ ${c.despesas_oficina.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
  );
  console.log(`  Frete: R$ ${c.frete.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`);
  console.log(`  Forplan: R$ ${c.forplan.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`);
  console.log(
    `  Impostos: R$ ${c.impostos.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
  );
  console.log(
    `  Comissões: R$ ${c.comissoes.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
  );
  console.log(`  ADM: R$ ${c.adm.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`);
  console.log(
    `  Desp Gerais: R$ ${c.despesas_gerais.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
  );
  console.log(
    `  (−) Ganhos Indiretos: R$ ${c.ganhos_indiretos.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
