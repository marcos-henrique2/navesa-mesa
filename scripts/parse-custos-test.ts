import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseNbsCustosXls, recalcularCustoTotal } from "../src/lib/parsers/nbs-custos-xls";

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Uso: npx tsx scripts/parse-custos-test.ts <xls>");
    process.exit(1);
  }

  const buf = await readFile(resolve(path));
  const result = await parseNbsCustosXls(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), path);

  const fmt = (n: number) => "R$ " + n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  console.log("=== META ===");
  console.log(`Arquivo: ${result.meta.arquivo_nome}`);
  console.log(`Período: ${result.meta.periodo}`);
  console.log(`Loja principal: ${result.meta.loja_principal}`);
  console.log(`Data geração: ${result.meta.data_geracao?.toLocaleDateString("pt-BR")}`);
  console.log(`Total vendas: ${result.meta.total_vendas}`);

  // Agregar tudo
  const tot = {
    nota: 0, oficina: 0, frete: 0, forplan: 0, impostos: 0,
    comissoes: 0, ganhos_indiretos: 0, adm: 0, gerais: 0,
    custo: 0, valor: 0, margem: 0,
  };
  let discrepancias = 0;
  for (const c of result.custos) {
    tot.nota += c.nota_fabrica_taxa_icms;
    tot.oficina += c.despesas_oficina;
    tot.frete += c.frete_icms_frete;
    tot.forplan += c.forplan;
    tot.impostos += c.impostos;
    tot.comissoes += c.comissoes;
    tot.ganhos_indiretos += c.ganhos_indiretos;
    tot.adm += c.adm;
    tot.gerais += c.despesas_gerais;
    tot.custo += c.custo_total;
    tot.valor += c.valor_vendido;
    tot.margem += c.margem_real;

    // Validar: recalculado bate com o custo_total do NBS?
    const recalc = recalcularCustoTotal(c);
    if (Math.abs(recalc - c.custo_total) > 0.05) {
      discrepancias++;
      if (discrepancias <= 3) {
        console.log(`\n⚠️  Placa ${c.placa} ${c.modelo}: custo_NBS=${c.custo_total.toFixed(2)} vs recalc=${recalc.toFixed(2)} (diff ${(recalc - c.custo_total).toFixed(2)})`);
      }
    }
  }

  console.log("\n=== AGREGADO (deve bater com a tela 'Totaliza' do NBS) ===");
  console.log(`  Nota Fábrica - ICMS .................. ${fmt(tot.nota)}`);
  console.log(`  Despesas Oficina ..................... ${fmt(tot.oficina)}`);
  console.log(`  Frete + ICMS Frete ................... ${fmt(tot.frete)}`);
  console.log(`  Forplan .............................. ${fmt(tot.forplan)}`);
  console.log(`  Impostos (PIS+COFINS+ICMS) ........... ${fmt(tot.impostos)}`);
  console.log(`  Comissões ............................ ${fmt(tot.comissoes)}`);
  console.log(`  ADM .................................. ${fmt(tot.adm)}`);
  console.log(`  Despesas Gerais ...................... ${fmt(tot.gerais)}`);
  console.log(`  (−) Ganhos Indiretos (Bônus+Valoriz) . ${fmt(tot.ganhos_indiretos)}`);
  console.log(`  ─────────────────────────────────────`);
  console.log(`  Custo Total (NBS) .................... ${fmt(tot.custo)}`);
  console.log(`  Valor Vendido ........................ ${fmt(tot.valor)}`);
  console.log(`  Margem Real .......................... ${fmt(tot.margem)}  (${(tot.margem / tot.valor * 100).toFixed(2)}%)`);
  console.log();

  // Validar: soma dos componentes = custo total
  const custoCalculado = tot.nota + tot.oficina + tot.frete + tot.forplan + tot.impostos + tot.comissoes + tot.adm + tot.gerais - tot.ganhos_indiretos;
  const diffCusto = custoCalculado - tot.custo;
  console.log(`Validação: Σ(componentes) = ${fmt(custoCalculado)} vs Σ(custo_total NBS) = ${fmt(tot.custo)}`);
  console.log(`Diferença: ${fmt(diffCusto)} ${Math.abs(diffCusto) < 1 ? "✅" : "⚠️"}`);

  const margemCalculada = tot.valor - tot.custo;
  console.log(`Validação: Valor − Custo = ${fmt(margemCalculada)} vs Margem Real NBS = ${fmt(tot.margem)}`);
  console.log(`Diferença: ${fmt(margemCalculada - tot.margem)} ${Math.abs(margemCalculada - tot.margem) < 1 ? "✅" : "⚠️"}`);

  if (discrepancias > 0) console.log(`\n${discrepancias} venda(s) com discrepância na recalculação individual.`);
  if (result.warnings.length > 0) {
    console.log(`\n${result.warnings.length} warnings:`);
    result.warnings.slice(0, 5).forEach(w => console.log(`  - ${w}`));
  }
}

main().catch(err => { console.error(err); process.exit(1); });
